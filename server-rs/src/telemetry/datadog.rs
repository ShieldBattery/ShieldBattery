use std::collections::VecDeque;
use std::sync::Arc;
use std::time::Duration;

use chrono::{DateTime, Utc};
use color_eyre::eyre;
use color_eyre::eyre::WrapErr;
use secrecy::{ExposeSecret, Secret};
use serde_json::{json, Map, Value};
use tokio::sync::mpsc::{unbounded_channel, UnboundedSender};
use tokio::sync::RwLock;
use tracing::{Event, Subscriber};
use tracing_bunyan_formatter::JsonStorage;
use tracing_subscriber::layer::Context;
use tracing_subscriber::registry::LookupSpan;
use tracing_subscriber::Layer;

const SOURCE: &str = "sb-telemetry-datadog";
const TAGS: &str = "version:0.1.0";
const MAX_BATCH_SIZE: usize = 1000;
const MAX_BATCH_DURATION: Duration = Duration::from_secs(5);
const MAX_RETRIES: u8 = 3;

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
    pub api_key: Secret<String>,
    pub service_name: String,
    pub region: Option<Region>,
    pub url: Option<String>,
    pub tags: Option<String>,
}

impl Default for DatadogOptions {
    fn default() -> Self {
        Self {
            api_key: Secret::new("".to_string()),
            service_name: "unknown".to_string(),
            region: None,
            url: None,
            tags: None,
        }
    }
}

impl DatadogOptions {
    pub fn new(service_name: impl Into<String>, api_key: impl Into<String>) -> Self {
        Self {
            api_key: Secret::new(api_key.into()),
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
    received_at: DateTime<Utc>,
}

#[derive(Debug)]
pub struct DatadogLogLayer {
    tx: Option<UnboundedSender<Log>>,
    handle: Option<std::thread::JoinHandle<()>>,
}

impl DatadogLogLayer {
    pub fn new(options: DatadogOptions) -> Self {
        let ingestor = DatadogIngestor::new(options);

        let (tx, mut rx) = unbounded_channel();
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
            let log = Self::create_log(event, &ctx);
            if let Err(e) = tx.send(log) {
                eprintln!("DatadogLogLayer failed to send log to ingestor: {e:?}");
            }
        }
    }
}

#[derive(Debug, Clone)]
struct DatadogIngestor {
    url: String,
    api_key: Secret<String>,
    client: reqwest::Client,
    queue: Arc<RwLock<VecDeque<LogEvent>>>,

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
    RetriesExceeeded,
    #[error(transparent)]
    Unexpected(#[from] eyre::Error),
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

        Self {
            url,
            api_key: options.api_key,
            client: reqwest::Client::new(),
            queue: Arc::new(RwLock::new(VecDeque::new())),

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
            let mut interval = tokio::time::interval(MAX_BATCH_DURATION);
            loop {
                interval.tick().await;
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
            received_at: Utc::now(),
        };
        self.queue.write().await.push_back(log_event);
    }

    pub async fn flush(&self) {
        self.try_send(true).await;
    }

    async fn try_send(&self, flush: bool) {
        loop {
            let queue = self.queue.read().await;
            if queue.is_empty() {
                return;
            }
            if !flush {
                let last = queue.back().unwrap();
                if (Utc::now() - last.received_at)
                    .to_std()
                    .unwrap_or(Duration::from_millis(0))
                    < MAX_BATCH_DURATION
                {
                    return;
                }
            }
            drop(queue);

            let logs = {
                let mut queue = self.queue.write().await;
                let len = usize::min(queue.len(), MAX_BATCH_SIZE);
                queue.drain(..len).map(|e| e.log).collect::<Vec<_>>()
            };

            match self.send_logs(&logs).await {
                Err(SendLogsError::PayloadTooLarge) => {
                    // Split the payload in half and try again
                    let half = logs.len() / 2;
                    let (first, second) = logs.split_at(half);
                    // TODO(tec27): To be super safe we should probably be able to keep splitting
                    // these if necessary, but doing that without recursion is annoying so I
                    // haven't implemented it for now (I think that would be a pretty rare case
                    // anyway given the size of things we log)
                    if let Err(e) = self.send_logs(first).await {
                        eprintln!("DatadogIngestor failed to send split logs: {e:?}");
                    }
                    if let Err(e) = self.send_logs(second).await {
                        eprintln!("DatadogIngestor failed to send split logs: {e:?}");
                    }
                }
                Err(SendLogsError::RetriesExceeeded) => {
                    eprintln!("DatadogIngestor failed to send logs after max retries");
                }
                Err(SendLogsError::Unexpected(e)) => {
                    eprintln!("DatadogIngestor had an unexpected error while sending logs: {e:?}");
                }
                Ok(_) => {}
            }
        }
    }

    async fn send_logs(&self, logs: &[Log]) -> Result<(), SendLogsError> {
        for _ in 0..MAX_RETRIES {
            let res = self
                .client
                .post(&self.url)
                .header("User-Agent", "sb-telemetry-datadog/0.1.0")
                .header("DD-API-KEY", self.api_key.expose_secret())
                .json(&logs)
                .send()
                .await
                .wrap_err("Failed to send logs")?;
            match res.status().as_u16() {
                202 => {
                    // Log was accepted
                    return Ok(());
                }
                400 => {
                    eprintln!("DatadogIngestor got Bad Request (probably an issue with payload formatting)");
                }
                401 => {
                    eprintln!("DatadogIngestor got Unauthorized (probably a missing API key)");
                }
                403 => {
                    eprintln!("DatadogIngestor got Forbidden (probably an invalid API key)");
                }
                408 => {
                    eprintln!("DatadogIngestor got Request Timeout, request will be retried unless at max retries");
                }
                413 => {
                    eprintln!(
                        "DatadogIngestor got Payload Too Large, splitting payload and retrying"
                    );
                    return Err(SendLogsError::PayloadTooLarge);
                }
                429 => {
                    eprintln!("DatadogIngestor got Too Many Requests, request will be retried unless at max retries");
                }
                500 => {
                    eprintln!("DatadogIngestor got Internal Server Error, request will be retried unless at max retries");
                }
                503 => {
                    eprintln!("DatadogIngestor got Service Unavailable, request will be retried unless at max retries");
                }
                status => {
                    eprintln!("DatadogIngestor got unexpected status code {status}, request will be retried unless at max retries");
                }
            }
        }

        Err(SendLogsError::RetriesExceeeded)
    }
}
