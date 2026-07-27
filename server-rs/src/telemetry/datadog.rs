use std::collections::VecDeque;
use std::sync::{Arc, OnceLock};
use std::time::{Duration, Instant};

use chrono::Utc;
use rand::RngExt;
use secrecy::{ExposeSecret, SecretString};
use serde_json::{Map, Value, json};
use tokio::sync::mpsc::{Sender, channel, error::TrySendError};
use tokio::sync::{Mutex, Notify};
use tracing::{Event, Subscriber};
use tracing_bunyan_formatter::JsonStorage;
use tracing_subscriber::Layer;
use tracing_subscriber::layer::Context;
use tracing_subscriber::registry::LookupSpan;

const SOURCE: &str = "sb-telemetry-datadog";
const TAGS: &str = "version:0.1.0";
const MAX_BATCH_SIZE: usize = 1000;
const MAX_BATCH_DURATION: Duration = Duration::from_secs(5);
const LOG_CHANNEL_CAPACITY: usize = MAX_BATCH_SIZE * 2;
const MAX_QUEUED_LOGS: usize = MAX_BATCH_SIZE * 10;
const MAX_RETRIES: u8 = 3;
const HTTP_CONNECT_TIMEOUT: Duration = Duration::from_secs(2);
const HTTP_REQUEST_TIMEOUT: Duration = Duration::from_secs(5);
const INITIAL_RETRY_DELAY: Duration = Duration::from_millis(100);

const QUEUE_SIZE_METRIC: &str = "datadog_log_queue_size";
const DROPPED_LOGS_METRIC: &str = "datadog_logs_dropped_total";
const BATCH_SIZE_METRIC: &str = "datadog_log_batch_size";
const SEND_DURATION_METRIC: &str = "datadog_log_send_duration_seconds";
const SEND_FAILURES_METRIC: &str = "datadog_log_send_failures_total";

/// How long [flush_datadog_logs] waits for the ingestor thread to drain the log channel into its
/// queue before forcing a send. Logging is asynchronous (`on_event` -> channel -> thread -> queue),
/// so a brief pause ensures a log emitted immediately before the flush is actually in the queue.
const FLUSH_DRAIN_GRACE: Duration = Duration::from_millis(250);

/// Hard upper bound on how long [flush_datadog_logs] will spend trying to send. This is shorter than
/// the ingestor's normal HTTP timeout because fatal shutdown is best-effort and time-sensitive.
const FLUSH_TIMEOUT: Duration = Duration::from_secs(2);

/// A clone of the running ingestor, stashed so a fatal shutdown path can force a synchronous flush
/// of buffered logs before the process exits. The clone shares the underlying queue and HTTP client
/// (both `Arc`-backed), so flushing through it drains the same buffer the layer is filling. `None`
/// when Datadog logging isn't configured.
static INGESTOR: OnceLock<DatadogIngestor> = OnceLock::new();

/// Forces a best-effort, synchronous flush of any buffered Datadog logs, bounded by
/// [FLUSH_TIMEOUT]. Intended for fatal paths that call [`std::process::exit`], which skips both the
/// periodic flush and the Drop-based flush, so a log emitted just before exiting would otherwise
/// never reach Datadog (it still reaches stdout synchronously). No-op when Datadog logging isn't
/// configured.
pub async fn flush_datadog_logs() {
    let Some(ingestor) = INGESTOR.get() else {
        return;
    };
    // Let the ingestor thread move any logs still sitting in the channel into its queue first.
    tokio::time::sleep(FLUSH_DRAIN_GRACE).await;
    // Bounded: this is best-effort and runs on a time-sensitive shutdown path, so we'd rather lose
    // the log than hang the exit if Datadog is unreachable.
    if tokio::time::timeout(FLUSH_TIMEOUT, ingestor.flush())
        .await
        .is_err()
    {
        tracing::warn!("Timed out flushing Datadog logs before exit");
    }
}

#[allow(dead_code)]
#[derive(Debug, Copy, Clone, PartialEq, Eq)]
pub enum Region {
    US1,
    US3,
    US5,
    US1FED,
    EU,
}

#[derive(Debug, Clone)]
pub struct DatadogOptions {
    pub api_key: SecretString,
    pub service_name: String,
    pub region: Option<Region>,
    pub url: Option<String>,
    pub tags: Option<String>,
}

impl Default for DatadogOptions {
    fn default() -> Self {
        Self {
            api_key: "".into(),
            service_name: "unknown".to_string(),
            region: None,
            url: None,
            tags: None,
        }
    }
}

impl DatadogOptions {
    pub fn new(service_name: impl Into<String>, api_key: impl Into<String>) -> Self {
        let api_key: String = api_key.into();
        Self {
            api_key: api_key.into(),
            service_name: service_name.into(),
            ..Default::default()
        }
    }

    #[allow(dead_code)]
    #[must_use]
    pub const fn with_region(mut self, region: Region) -> Self {
        self.region = Some(region);
        self
    }

    #[allow(dead_code)]
    #[must_use]
    pub fn with_tags(mut self, tags: impl Into<String>) -> Self {
        self.tags = Some(tags.into());
        self
    }

    #[allow(dead_code)]
    #[must_use]
    pub fn with_url(mut self, url: impl Into<String>) -> Self {
        self.url = Some(url.into());
        self
    }
}

type Log = Map<String, Value>;

#[derive(Debug)]
struct LogEvent {
    log: Log,
    received_at: Instant,
}

#[derive(Debug, Default)]
struct LogQueue {
    events: VecDeque<LogEvent>,
}

impl LogQueue {
    fn push(&mut self, event: LogEvent) -> bool {
        let dropped = if self.events.len() >= MAX_QUEUED_LOGS {
            self.events.pop_front();
            true
        } else {
            false
        };
        self.events.push_back(event);
        dropped
    }

    fn should_send(&self, now: Instant, flush: bool) -> bool {
        let Some(first) = self.events.front() else {
            return false;
        };

        flush
            || self.events.len() >= MAX_BATCH_SIZE
            || now.saturating_duration_since(first.received_at) >= MAX_BATCH_DURATION
    }

    fn next_send_deadline(&self) -> Option<Instant> {
        self.events
            .front()
            .map(|event| event.received_at + MAX_BATCH_DURATION)
    }

    fn take_batch(&mut self) -> Vec<Log> {
        let len = usize::min(self.events.len(), MAX_BATCH_SIZE);
        self.events.drain(..len).map(|e| e.log).collect()
    }

    fn len(&self) -> usize {
        self.events.len()
    }
}

#[derive(Debug)]
pub struct DatadogLogLayer {
    tx: Option<Sender<Log>>,
    handle: Option<std::thread::JoinHandle<()>>,
}

impl DatadogLogLayer {
    pub fn new(options: DatadogOptions) -> Self {
        let ingestor = DatadogIngestor::new(options);
        // Stash a clone (sharing the same queue + client) so a fatal shutdown can force a flush.
        // Ignore the error if it's already set — only one layer is ever created per process.
        let _ = INGESTOR.set(ingestor.clone());

        let (tx, mut rx) = channel(LOG_CHANNEL_CAPACITY);
        let handle = std::thread::Builder::new()
            .name("datadog-log-layer".to_string())
            .spawn(move || {
                let rt = match tokio::runtime::Builder::new_current_thread()
                    .enable_all()
                    .build()
                {
                    Ok(r) => r,
                    Err(e) => {
                        eprintln!("Failed to create runtime for DatadogLogLayer: {e:?}");
                        return;
                    }
                };

                rt.block_on(async move {
                    ingestor.start();
                    while let Some(log) = rx.recv().await {
                        ingestor.ingest(log).await;
                    }
                    ingestor.flush().await;
                });
                drop(rt);
            })
            .expect("Failed to spawn DatadogLogLayer thread");

        Self {
            tx: Some(tx),
            handle: Some(handle),
        }
    }

    fn create_log<S: Subscriber + for<'a> LookupSpan<'a>>(
        event: &Event<'_>,
        ctx: &Context<'_, S>,
    ) -> Map<String, Value> {
        let mut spans = vec![];
        if let Some(scope) = ctx.event_scope(event) {
            for span in scope.from_root() {
                let mut new_span: Map<String, Value> = Map::new();
                if let Some(visitor) = span.extensions().get::<JsonStorage>() {
                    for (&key, value) in visitor.values() {
                        new_span.insert(key.to_string(), value.clone());
                    }
                }

                // Insert this last to make sure it overwrites any keys with the same name
                new_span.insert("name".to_string(), json!(span.name()));

                spans.push(new_span);
            }
        }

        let mut log = if let Some(current) = spans.last() {
            // We use the current span as the base of the log, then attach the full list of spans
            // to it (we clone so this isn't recursive). This format is mainly to match the existing
            // Node logs which put the context of the log at the top level
            let mut log = current.clone();
            log.insert("spans".to_string(), json!(spans));
            log
        } else {
            Map::new()
        };

        let mut event_visitor = JsonStorage::default();
        event.record(&mut event_visitor);
        for (key, value) in event_visitor.values() {
            log.insert(key.to_string(), value.clone());
        }

        log.insert(
            "level".to_string(),
            json!(event.metadata().level().as_str()),
        );
        log.insert(
            "src".to_string(),
            json!({
                "target": json!(event.metadata().target()),
                "file": event.metadata().file().unwrap_or("unknown"),
                "line": event.metadata().line().unwrap_or(0),
            }),
        );
        log.insert("timestamp".to_string(), json!(Utc::now().to_rfc3339()));

        log
    }
}

impl Drop for DatadogLogLayer {
    fn drop(&mut self) {
        if let Some(tx) = self.tx.take() {
            drop(tx);
        }
        if let Some(handle) = self.handle.take() {
            let _ = handle.join();
        }
    }
}

impl<S> Layer<S> for DatadogLogLayer
where
    S: Subscriber + for<'a> LookupSpan<'a>,
{
    fn on_event(&self, event: &Event<'_>, ctx: Context<'_, S>) {
        if let Some(tx) = &self.tx {
            match tx.try_reserve() {
                Ok(permit) => permit.send(Self::create_log(event, &ctx)),
                Err(TrySendError::Full(_)) => {
                    ::metrics::counter!(
                        DROPPED_LOGS_METRIC,
                        "reason" => "ingest_channel_full"
                    )
                    .increment(1);
                }
                Err(TrySendError::Closed(_)) => {
                    eprintln!("DatadogLogLayer failed to send log: ingestor channel closed");
                }
            }
        }
    }
}

#[derive(Debug, Clone)]
struct DatadogIngestor {
    url: String,
    api_key: SecretString,
    client: reqwest::Client,
    queue: Arc<Mutex<LogQueue>>,
    send_lock: Arc<Mutex<()>>,
    wake_sender: Arc<Notify>,

    service_name: Value,
    source: Value,
    tags: Value,
    pid: Value,
    hostname: Value,
}

#[derive(thiserror::Error, Debug)]
enum SendLogsError {
    #[error("Logs payload too large")]
    PayloadTooLarge,
    #[error("Maximum send retries exceeded")]
    RetriesExceeded,
    #[error("Datadog rejected the logs with status {0}")]
    Rejected(u16),
}

impl DatadogIngestor {
    pub fn new(options: DatadogOptions) -> Self {
        let url = options.url.unwrap_or_else(|| {
            match options.region {
                Some(Region::US1) | None => "https://http-intake.logs.datadoghq.com/api/v2/logs",
                Some(Region::US3) => "https://http-intake.logs.us3.datadoghq.com/api/v2/logs",
                Some(Region::US5) => "https://http-intake.logs.us5.datadoghq.com/api/v2/logs",
                Some(Region::US1FED) => "https://http-intake.logs.ddog-gov.com/api/v2/logs",
                Some(Region::EU) => "https://http-intake.logs.datadoghq.eu/api/v2/logs",
            }
            .to_string()
        });

        let tags = options
            .tags
            .map_or_else(|| TAGS.into(), |t| format!("{t}, {TAGS}"));
        let client = reqwest::Client::builder()
            .connect_timeout(HTTP_CONNECT_TIMEOUT)
            .timeout(HTTP_REQUEST_TIMEOUT)
            .build()
            .expect("Datadog HTTP client configuration should be valid");

        Self {
            url,
            api_key: options.api_key,
            client,
            queue: Arc::new(Mutex::new(LogQueue::default())),
            send_lock: Arc::new(Mutex::new(())),
            wake_sender: Arc::new(Notify::new()),

            service_name: json!(options.service_name),
            source: json!(SOURCE),
            tags: json!(tags),
            pid: json!(std::process::id()),
            hostname: json!(gethostname::gethostname().to_string_lossy().into_owned()),
        }
    }

    pub fn start(&self) {
        let this = self.clone();
        tokio::spawn(async move {
            loop {
                let deadline = this.queue.lock().await.next_send_deadline();
                if let Some(deadline) = deadline {
                    tokio::select! {
                        _ = tokio::time::sleep_until(tokio::time::Instant::from_std(deadline)) => {}
                        () = this.wake_sender.notified() => {}
                    }
                } else {
                    this.wake_sender.notified().await;
                }
                this.try_send(false).await;
            }
        });
    }

    pub async fn ingest(&self, mut log: Log) {
        log.insert("ddsource".to_string(), self.source.clone());
        log.insert("ddtags".to_string(), self.tags.clone());
        log.insert("service".to_string(), self.service_name.clone());
        log.insert("pid".to_string(), self.pid.clone());
        log.insert("hostname".to_string(), self.hostname.clone());

        let log_event = LogEvent {
            log,
            received_at: Instant::now(),
        };
        let mut queue = self.queue.lock().await;
        let was_empty = queue.len() == 0;
        let dropped = queue.push(log_event);
        let queue_len = queue.len();
        drop(queue);

        ::metrics::gauge!(QUEUE_SIZE_METRIC).set(queue_len as f64);
        if dropped {
            ::metrics::counter!(DROPPED_LOGS_METRIC, "reason" => "queue_full").increment(1);
        }
        if was_empty || queue_len >= MAX_BATCH_SIZE {
            self.wake_sender.notify_one();
        }
    }

    pub async fn flush(&self) {
        self.try_send(true).await;
    }

    async fn try_send(&self, flush: bool) {
        let _send_guard = self.send_lock.lock().await;
        loop {
            let logs = {
                let mut queue = self.queue.lock().await;
                if !queue.should_send(Instant::now(), flush) {
                    return;
                }
                let logs = queue.take_batch();
                ::metrics::gauge!(QUEUE_SIZE_METRIC).set(queue.len() as f64);
                logs
            };
            ::metrics::histogram!(BATCH_SIZE_METRIC).record(logs.len() as f64);

            let send_start = Instant::now();
            let result = self.send_logs(&logs).await;
            ::metrics::histogram!(SEND_DURATION_METRIC).record(send_start.elapsed().as_secs_f64());

            match result {
                Err(SendLogsError::PayloadTooLarge) => {
                    // Split the payload in half and try again
                    let half = logs.len() / 2;
                    let (first, second) = logs.split_at(half);
                    // TODO(tec27): To be super safe we should probably be able to keep splitting
                    // these if necessary, but doing that without recursion is annoying so I
                    // haven't implemented it for now (I think that would be a pretty rare case
                    // anyway given the size of things we log)
                    if let Err(e) = self.send_logs(first).await {
                        ::metrics::counter!(SEND_FAILURES_METRIC, "reason" => "split_send")
                            .increment(1);
                        ::metrics::counter!(
                            DROPPED_LOGS_METRIC,
                            "reason" => "split_send_failed"
                        )
                        .increment(first.len() as u64);
                        eprintln!("DatadogIngestor failed to send split logs: {e:?}");
                    }
                    if let Err(e) = self.send_logs(second).await {
                        ::metrics::counter!(SEND_FAILURES_METRIC, "reason" => "split_send")
                            .increment(1);
                        ::metrics::counter!(
                            DROPPED_LOGS_METRIC,
                            "reason" => "split_send_failed"
                        )
                        .increment(second.len() as u64);
                        eprintln!("DatadogIngestor failed to send split logs: {e:?}");
                    }
                }
                Err(SendLogsError::RetriesExceeded) => {
                    ::metrics::counter!(SEND_FAILURES_METRIC, "reason" => "retries_exceeded")
                        .increment(1);
                    ::metrics::counter!(DROPPED_LOGS_METRIC, "reason" => "send_failed")
                        .increment(logs.len() as u64);
                    eprintln!("DatadogIngestor failed to send logs after max retries");
                }
                Err(SendLogsError::Rejected(status)) => {
                    ::metrics::counter!(SEND_FAILURES_METRIC, "reason" => "rejected").increment(1);
                    ::metrics::counter!(DROPPED_LOGS_METRIC, "reason" => "rejected")
                        .increment(logs.len() as u64);
                    eprintln!("DatadogIngestor failed to send logs: Datadog returned {status}");
                }
                Ok(_) => {}
            }
        }
    }

    async fn send_logs(&self, logs: &[Log]) -> Result<(), SendLogsError> {
        for attempt in 0..MAX_RETRIES {
            let result = self
                .client
                .post(&self.url)
                .header("User-Agent", "sb-telemetry-datadog/0.1.0")
                .header("DD-API-KEY", self.api_key.expose_secret())
                .json(&logs)
                .send()
                .await;
            let res = match result {
                Ok(res) => res,
                Err(e) => {
                    eprintln!(
                        "DatadogIngestor failed to send logs ({e}), request will be retried unless at max retries"
                    );
                    if attempt + 1 < MAX_RETRIES {
                        tokio::time::sleep(retry_delay(attempt)).await;
                    }
                    continue;
                }
            };
            match res.status().as_u16() {
                202 => {
                    // Log was accepted
                    return Ok(());
                }
                400 => {
                    eprintln!(
                        "DatadogIngestor got Bad Request (probably an issue with payload formatting)"
                    );
                    return Err(SendLogsError::Rejected(400));
                }
                401 => {
                    eprintln!("DatadogIngestor got Unauthorized (probably a missing API key)");
                    return Err(SendLogsError::Rejected(401));
                }
                403 => {
                    eprintln!("DatadogIngestor got Forbidden (probably an invalid API key)");
                    return Err(SendLogsError::Rejected(403));
                }
                408 => {
                    eprintln!(
                        "DatadogIngestor got Request Timeout, request will be retried unless at max retries"
                    );
                }
                413 => {
                    eprintln!(
                        "DatadogIngestor got Payload Too Large, splitting payload and retrying"
                    );
                    return Err(SendLogsError::PayloadTooLarge);
                }
                429 => {
                    eprintln!(
                        "DatadogIngestor got Too Many Requests, request will be retried unless at max retries"
                    );
                }
                500 => {
                    eprintln!(
                        "DatadogIngestor got Internal Server Error, request will be retried unless at max retries"
                    );
                }
                503 => {
                    eprintln!(
                        "DatadogIngestor got Service Unavailable, request will be retried unless at max retries"
                    );
                }
                status => {
                    eprintln!(
                        "DatadogIngestor got unexpected status code {status}, request will be retried unless at max retries"
                    );
                }
            }
            if attempt + 1 < MAX_RETRIES {
                tokio::time::sleep(retry_delay(attempt)).await;
            }
        }

        Err(SendLogsError::RetriesExceeded)
    }
}

fn retry_delay(attempt: u8) -> Duration {
    let base = INITIAL_RETRY_DELAY.saturating_mul(1_u32 << attempt);
    let jitter = rand::rng().random_range(0..=base.as_millis() as u64);
    base + Duration::from_millis(jitter)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn event(received_at: Instant) -> LogEvent {
        LogEvent {
            log: Map::new(),
            received_at,
        }
    }

    #[test]
    fn continuous_traffic_does_not_postpone_aged_batch() {
        let start = Instant::now();
        let mut queue = LogQueue::default();
        for offset in 0..=MAX_BATCH_DURATION.as_secs() {
            queue.push(event(start + Duration::from_secs(offset)));
        }

        assert!(queue.should_send(start + MAX_BATCH_DURATION, false));
    }

    #[test]
    fn send_deadline_is_based_on_oldest_event() {
        let start = Instant::now();
        let mut queue = LogQueue::default();
        queue.push(event(start));
        queue.push(event(start + Duration::from_secs(3)));

        assert_eq!(queue.next_send_deadline(), Some(start + MAX_BATCH_DURATION));
    }

    #[test]
    fn full_batch_is_ready_before_max_duration() {
        let now = Instant::now();
        let mut queue = LogQueue::default();
        for _ in 0..MAX_BATCH_SIZE {
            queue.push(event(now));
        }

        assert!(queue.should_send(now, false));
    }

    #[test]
    fn queue_is_bounded_and_keeps_most_recent_logs() {
        let start = Instant::now();
        let mut queue = LogQueue::default();
        let overflow = 5;
        let mut dropped = 0;
        for offset in 0..MAX_QUEUED_LOGS + overflow {
            dropped += usize::from(queue.push(event(start + Duration::from_millis(offset as u64))));
        }

        assert_eq!(dropped, overflow);
        assert_eq!(queue.len(), MAX_QUEUED_LOGS);
        assert_eq!(
            queue.events.front().unwrap().received_at,
            start + Duration::from_millis(overflow as u64)
        );
    }

    #[test]
    fn take_batch_preserves_queue_order() {
        let start = Instant::now();
        let mut queue = LogQueue::default();
        for offset in 0..MAX_BATCH_SIZE + 1 {
            let mut log = Map::new();
            log.insert("offset".to_string(), json!(offset));
            queue.push(LogEvent {
                log,
                received_at: start,
            });
        }

        let batch = queue.take_batch();

        assert_eq!(batch.len(), MAX_BATCH_SIZE);
        assert_eq!(batch.first().unwrap()["offset"], json!(0));
        assert_eq!(batch.last().unwrap()["offset"], json!(MAX_BATCH_SIZE - 1));
        assert_eq!(queue.len(), 1);
        assert_eq!(
            queue.events.front().unwrap().log["offset"],
            json!(MAX_BATCH_SIZE)
        );
    }
}
