//! Opt-in timing diagnostics for the window and render paths that affect mouse responsiveness.
//!
//! The collected values describe time spent in ShieldBattery's hooks and the cadence at which
//! their entry points run. They do not measure device, HID, or end-to-end input latency.

use std::cell::Cell;
use std::fs::File;
use std::io::{self, Read};
use std::marker::PhantomData;
use std::path::Path;
use std::rc::Rc;
use std::sync::OnceLock;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::{Duration, Instant};

use parking_lot::Mutex;
use serde::{Deserialize, Serialize};

const CONFIG_FILE_NAME: &str = "mouse-diagnostics.json";
const MAX_CONFIG_BYTES: u64 = 4096;
const KIND_COUNT: usize = 3;
const BUCKET_UPPER_BOUNDS_US: [u64; 12] = [
    50, 100, 250, 500, 1_000, 2_000, 4_000, 8_000, 16_000, 33_000, 66_000, 1_000_000,
];
const BUCKET_COUNT: usize = BUCKET_UPPER_BOUNDS_US.len() + 1;

static SETTINGS: OnceLock<Settings> = OnceLock::new();
static USE_NATIVE_CLOCK: AtomicBool = AtomicBool::new(false);
static TIMING_ENABLED: AtomicBool = AtomicBool::new(false);
static STATE: Mutex<State> = parking_lot::const_mutex(State::new());

thread_local! {
    static ACTIVE_KINDS: Cell<u8> = const { Cell::new(0) };
}

/// Selects the implementation used for `GetTickCount` by the game hook.
#[derive(Clone, Copy, Debug, Deserialize, Serialize)]
#[serde(rename_all = "lowercase")]
enum Clock {
    Shieldbattery,
    Native,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct FileConfig {
    clock: Clock,
    #[serde(default)]
    timing: bool,
    #[serde(default)]
    label: Option<String>,
}

#[derive(Clone, Debug)]
struct Settings {
    clock: Clock,
    timing: bool,
    label: Option<String>,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            clock: Clock::Shieldbattery,
            timing: false,
            label: None,
        }
    }
}

/// Initializes the optional diagnostic configuration.
///
/// Missing configuration intentionally has no log output so normal installs remain quiet. Any
/// unreadable or invalid configuration keeps the ShieldBattery clock and disables timing.
pub fn initialize(user_data_path: &Path) {
    let (settings, should_log_startup) = match read_config(&user_data_path.join(CONFIG_FILE_NAME)) {
        Ok(Some(settings)) => (settings, true),
        Ok(None) => (Settings::default(), false),
        Err(error) => {
            log::warn!(
                "Unable to load mouse diagnostics configuration; using ShieldBattery clock with timing disabled: {error}"
            );
            (Settings::default(), false)
        }
    };

    if SETTINGS.set(settings.clone()).is_err() {
        log::warn!(
            "Mouse diagnostics were initialized more than once; ignoring later configuration"
        );
        return;
    }

    USE_NATIVE_CLOCK.store(matches!(settings.clock, Clock::Native), Ordering::Relaxed);
    TIMING_ENABLED.store(settings.timing, Ordering::Relaxed);
    if should_log_startup {
        log_startup(&settings);
    }
}

/// Returns whether the unmodified Windows `GetTickCount` implementation should be used.
pub fn use_native_clock() -> bool {
    USE_NATIVE_CLOCK.load(Ordering::Relaxed)
}

/// Returns whether instrumentation should be installed and capture timing data.
pub fn timing_enabled() -> bool {
    TIMING_ENABLED.load(Ordering::Relaxed)
}

/// The hook entry point being timed.
#[derive(Clone, Copy, Debug)]
pub enum Kind {
    ProcessEvents,
    RenderScreen,
    MouseMove,
}

impl Kind {
    const fn index(self) -> usize {
        match self {
            Self::ProcessEvents => 0,
            Self::RenderScreen => 1,
            Self::MouseMove => 2,
        }
    }

    const fn name(self) -> &'static str {
        match self {
            Self::ProcessEvents => "processEvents",
            Self::RenderScreen => "renderScreen",
            Self::MouseMove => "mouseMove",
        }
    }

    const fn cadence_description(self) -> &'static str {
        match self {
            Self::ProcessEvents => "Time between ProcessEvents hook entries.",
            Self::RenderScreen => "Time between RenderScreen hook entries.",
            Self::MouseMove => {
                "Time between WM_MOUSEMOVE handler entries; this measures window-message delivery cadence, not HID or input latency."
            }
        }
    }
}

/// Starts timing a hook invocation when foreground gameplay capture is active.
///
/// A same-kind recursive invocation on one thread is excluded so it cannot replace or clear the
/// outer invocation's recursion guard.
pub fn begin(kind: Kind) -> Option<Scope> {
    if !timing_enabled() || !enter_kind(kind) {
        return None;
    }

    let started = Instant::now();
    let mut state = STATE.lock();
    let Some(epoch) = state.begin(kind, started) else {
        leave_kind(kind);
        return None;
    };

    Some(Scope {
        kind,
        started,
        epoch,
        // A hook scope must drop on its originating thread to clear that thread's guard.
        _not_send: PhantomData,
    })
}

/// RAII timer returned by [`begin`]. It only locks after the original hook call has returned.
pub struct Scope {
    kind: Kind,
    started: Instant,
    epoch: u64,
    _not_send: PhantomData<Rc<()>>,
}

impl Drop for Scope {
    fn drop(&mut self) {
        leave_kind(self.kind);

        let finished = Instant::now();
        let mut state = STATE.lock();
        state.finish_scope(self.kind, self.epoch, self.started, finished);
    }
}

/// Updates whether the game window owns the foreground. A change discards incomplete cadence
/// intervals and prevents a scope from one focus epoch contributing to another.
pub fn set_foreground(active: bool) {
    if !timing_enabled() {
        return;
    }

    let mut state = STATE.lock();
    state.set_foreground(active);
}

/// Starts a fresh foreground-only capture period for one gameplay session.
pub fn start_gameplay() {
    if !timing_enabled() {
        return;
    }

    let mut state = STATE.lock();
    state.start_gameplay();
}

/// Stops capture and emits one JSON summary after releasing the aggregation lock.
pub fn finish_gameplay() {
    if !timing_enabled() {
        return;
    }

    let summary = {
        let mut state = STATE.lock();
        state.finish_gameplay().map(|metrics| Summary {
            event: "summary",
            schema_version: 1,
            clock: SETTINGS
                .get()
                .map_or(Clock::Shieldbattery, |settings| settings.clock),
            label: SETTINGS.get().and_then(|settings| settings.label.clone()),
            foreground_only: true,
            metrics: metrics.map(|(kind, metrics)| MetricSummary::from_metrics(kind, metrics)),
        })
    };

    if let Some(summary) = summary {
        match serde_json::to_string(&summary) {
            Ok(json) => log::info!("[MOUSE_DIAGNOSTICS] {json}"),
            Err(error) => log::warn!("Unable to serialize mouse diagnostics summary: {error}"),
        }
    }
}

fn read_config(path: &Path) -> Result<Option<Settings>, String> {
    let mut file = match File::open(path) {
        Ok(file) => file,
        Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(None),
        Err(error) => return Err(error.to_string()),
    };

    let mut bytes = Vec::with_capacity((MAX_CONFIG_BYTES + 1) as usize);
    file.by_ref()
        .take(MAX_CONFIG_BYTES + 1)
        .read_to_end(&mut bytes)
        .map_err(|error| error.to_string())?;
    if bytes.len() as u64 > MAX_CONFIG_BYTES {
        return Err(format!("configuration exceeds {MAX_CONFIG_BYTES} bytes"));
    }

    parse_config(&bytes).map(Some)
}

fn parse_config(bytes: &[u8]) -> Result<Settings, String> {
    let config: FileConfig = serde_json::from_slice(bytes).map_err(|error| error.to_string())?;
    if config
        .label
        .as_ref()
        .is_some_and(|label| label.chars().count() > 80)
    {
        return Err("label exceeds 80 characters".to_owned());
    }

    Ok(Settings {
        clock: config.clock,
        timing: config.timing,
        label: config.label,
    })
}

fn enter_kind(kind: Kind) -> bool {
    let bit = 1_u8 << kind.index();
    ACTIVE_KINDS.with(|active_kinds| {
        let previous = active_kinds.get();
        if previous & bit != 0 {
            false
        } else {
            active_kinds.set(previous | bit);
            true
        }
    })
}

fn leave_kind(kind: Kind) {
    let bit = 1_u8 << kind.index();
    ACTIVE_KINDS.with(|active_kinds| active_kinds.set(active_kinds.get() & !bit));
}

#[derive(Clone, Copy)]
struct State {
    gameplay: bool,
    foreground: bool,
    epoch: u64,
    last_starts: [Option<Instant>; KIND_COUNT],
    metrics: [Metrics; KIND_COUNT],
}

impl State {
    const fn new() -> Self {
        Self {
            gameplay: false,
            foreground: false,
            epoch: 0,
            last_starts: [None; KIND_COUNT],
            metrics: [Metrics::new(); KIND_COUNT],
        }
    }

    fn begin(&mut self, kind: Kind, started: Instant) -> Option<u64> {
        if !self.gameplay || !self.foreground {
            return None;
        }

        let index = kind.index();
        if let Some(previous) = self.last_starts[index] {
            self.metrics[index]
                .intervals
                .record(started.saturating_duration_since(previous));
        }
        self.last_starts[index] = Some(started);
        Some(self.epoch)
    }

    fn finish_scope(&mut self, kind: Kind, epoch: u64, started: Instant, finished: Instant) {
        if self.gameplay && self.foreground && self.epoch == epoch {
            self.metrics[kind.index()]
                .durations
                .record(finished.saturating_duration_since(started));
        }
    }

    fn set_foreground(&mut self, foreground: bool) {
        if self.foreground != foreground {
            self.foreground = foreground;
            self.epoch = self.epoch.wrapping_add(1);
            self.last_starts = [None; KIND_COUNT];
        }
    }

    fn start_gameplay(&mut self) {
        self.gameplay = true;
        self.epoch = self.epoch.wrapping_add(1);
        self.last_starts = [None; KIND_COUNT];
        self.metrics = [Metrics::new(); KIND_COUNT];
    }

    fn finish_gameplay(&mut self) -> Option<[(Kind, Metrics); KIND_COUNT]> {
        if !self.gameplay {
            return None;
        }

        self.gameplay = false;
        self.epoch = self.epoch.wrapping_add(1);
        self.last_starts = [None; KIND_COUNT];
        Some([
            (
                Kind::ProcessEvents,
                self.metrics[Kind::ProcessEvents.index()],
            ),
            (Kind::RenderScreen, self.metrics[Kind::RenderScreen.index()]),
            (Kind::MouseMove, self.metrics[Kind::MouseMove.index()]),
        ])
    }
}

#[derive(Clone, Copy)]
struct Metrics {
    intervals: Histogram,
    durations: Histogram,
}

impl Metrics {
    const fn new() -> Self {
        Self {
            intervals: Histogram::new(),
            durations: Histogram::new(),
        }
    }
}

#[derive(Clone, Copy)]
struct Histogram {
    buckets: [u64; BUCKET_COUNT],
    count: u64,
    sum_us: u64,
    max_us: u64,
}

impl Histogram {
    const fn new() -> Self {
        Self {
            buckets: [0; BUCKET_COUNT],
            count: 0,
            sum_us: 0,
            max_us: 0,
        }
    }

    fn record(&mut self, value: Duration) {
        let micros = u64::try_from(value.as_micros()).unwrap_or(u64::MAX);
        let bucket = BUCKET_UPPER_BOUNDS_US
            .iter()
            .position(|&upper_bound| micros <= upper_bound)
            .unwrap_or(BUCKET_COUNT - 1);
        self.buckets[bucket] = self.buckets[bucket].saturating_add(1);
        self.count = self.count.saturating_add(1);
        self.sum_us = self.sum_us.saturating_add(micros);
        self.max_us = self.max_us.max(micros);
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Startup {
    event: &'static str,
    schema_version: u32,
    clock: Clock,
    timing: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    label: Option<String>,
    arch: &'static str,
}

fn log_startup(settings: &Settings) {
    let startup = Startup {
        event: "startup",
        schema_version: 1,
        clock: settings.clock,
        timing: settings.timing,
        label: settings.label.clone(),
        arch: std::env::consts::ARCH,
    };
    match serde_json::to_string(&startup) {
        Ok(json) => log::info!("[MOUSE_DIAGNOSTICS] {json}"),
        Err(error) => log::warn!("Unable to serialize mouse diagnostics startup: {error}"),
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Summary {
    event: &'static str,
    schema_version: u32,
    clock: Clock,
    #[serde(skip_serializing_if = "Option::is_none")]
    label: Option<String>,
    foreground_only: bool,
    metrics: [MetricSummary; KIND_COUNT],
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct MetricSummary {
    kind: &'static str,
    cadence_description: &'static str,
    cadence_us: HistogramSummary,
    duration_us: HistogramSummary,
}

impl MetricSummary {
    fn from_metrics(kind: Kind, metrics: Metrics) -> Self {
        Self {
            kind: kind.name(),
            cadence_description: kind.cadence_description(),
            cadence_us: HistogramSummary::from_histogram(metrics.intervals),
            duration_us: HistogramSummary::from_histogram(metrics.durations),
        }
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct HistogramSummary {
    count: u64,
    sum_us: u64,
    max_us: u64,
    buckets: [BucketSummary; BUCKET_COUNT],
}

impl HistogramSummary {
    fn from_histogram(histogram: Histogram) -> Self {
        Self {
            count: histogram.count,
            sum_us: histogram.sum_us,
            max_us: histogram.max_us,
            buckets: std::array::from_fn(|index| BucketSummary {
                upper_bound_us: BUCKET_UPPER_BOUNDS_US.get(index).copied(),
                count: histogram.buckets[index],
            }),
        }
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct BucketSummary {
    upper_bound_us: Option<u64>,
    count: u64,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn config_requires_a_known_clock_and_bounds_the_label() {
        let valid =
            parse_config(br#"{"clock":"native","timing":true,"label":"capture-a"}"#).unwrap();
        assert!(matches!(valid.clock, Clock::Native));
        assert!(valid.timing);
        assert_eq!(valid.label.as_deref(), Some("capture-a"));

        assert!(parse_config(br#"{"timing":true}"#).is_err());
        assert!(parse_config(br#"{"clock":"native","extra":true}"#).is_err());
        assert!(parse_config(br#"{"clock":"other"}"#).is_err());
        assert!(
            !parse_config(br#"{"clock":"shieldbattery"}"#)
                .unwrap()
                .timing
        );
        let too_long = "x".repeat(81);
        let json = format!(r#"{{"clock":"shieldbattery","label":"{too_long}"}}"#);
        assert!(parse_config(json.as_bytes()).is_err());
    }

    #[test]
    fn histogram_includes_values_at_their_upper_bound() {
        let mut histogram = Histogram::new();
        histogram.record(Duration::from_micros(50));
        histogram.record(Duration::from_micros(51));
        histogram.record(Duration::from_micros(1_000_001));

        assert_eq!(histogram.count, 3);
        assert_eq!(histogram.sum_us, 1_000_102);
        assert_eq!(histogram.max_us, 1_000_001);
        assert_eq!(histogram.buckets[0], 1);
        assert_eq!(histogram.buckets[1], 1);
        assert_eq!(histogram.buckets[BUCKET_COUNT - 1], 1);
    }

    #[test]
    fn focus_transition_invalidates_scopes_and_cadence_bases() {
        let mut state = State::new();
        state.set_foreground(true);
        state.start_gameplay();
        let start = Instant::now();
        let epoch = state.begin(Kind::MouseMove, start).unwrap();
        state.set_foreground(false);
        state.set_foreground(true);
        state.finish_scope(
            Kind::MouseMove,
            epoch,
            start,
            start + Duration::from_micros(100),
        );
        let next_epoch = state
            .begin(Kind::MouseMove, start + Duration::from_micros(200))
            .unwrap();

        assert_ne!(epoch, next_epoch);
        assert_eq!(state.metrics[Kind::MouseMove.index()].durations.count, 0);
        assert_eq!(state.metrics[Kind::MouseMove.index()].intervals.count, 0);
    }

    #[test]
    fn recursive_same_kind_guard_preserves_the_outer_guard() {
        leave_kind(Kind::RenderScreen);
        assert!(enter_kind(Kind::RenderScreen));
        assert!(!enter_kind(Kind::RenderScreen));
        leave_kind(Kind::RenderScreen);
        assert!(enter_kind(Kind::RenderScreen));
        leave_kind(Kind::RenderScreen);
    }
}
