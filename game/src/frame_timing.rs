//! Times the game loop's frames, so a frame rate dip can be pinned on what caused it.
//!
//! A frame runs from the start of one of BW's draws to the start of the next. In between, the game
//! loop draws (BW queuing its draw commands, then our overlays), hands the commands to the
//! renderer, pumps messages, and when a logic step is due runs it (a rollback tick, in a game that
//! rolls back) before it draws again. Each frame's record splits its time between those, and notes
//! what kind of tick ran in it and what the tick before its draw was, since a tick's cost shows up
//! in the frame it runs in while whatever it leaves rendering to do shows up in the frames after.

use std::time::{Duration, Instant};

use parking_lot::Mutex;

/// What a frame's logic step did.
#[derive(Clone, Copy, Debug, Default, Eq, PartialEq)]
pub enum TickKind {
    /// No step ran.
    #[default]
    None,
    /// BW's own step ran, outside the rollback engine.
    Plain,
    /// A rollback tick that only stepped forward.
    Forward,
    /// A rollback tick that restored a snapshot and simulated frames again.
    Rollback,
}

/// One frame's timings, in microseconds.
#[derive(Clone, Copy, Debug, Default)]
pub struct FrameRecord {
    /// From the start of this frame's draw to the start of the next one.
    pub interval_us: u32,
    /// Queuing the draw commands: BW's layers and our overlays.
    pub draw_us: u32,
    /// The renderer turning the commands into a frame.
    pub render_us: u32,
    /// Logic steps run after the draw, before the next one.
    pub tick_us: u32,
    /// What the step after the draw did.
    pub tick: TickKind,
    /// Frames the tick after the draw simulated again, when it rolled back.
    pub resimulated: u8,
    /// Logic steps the tick after the draw ran.
    pub steps: u8,
    /// What the last step before this frame's draw did: the state the frame shows.
    #[cfg(debug_assertions)]
    pub drawn_after: TickKind,
    /// Frames drawn since the last one drawn right after a rollback, 0 for that one (saturating).
    #[cfg(debug_assertions)]
    pub frames_since_rollback: u16,
    /// A label the code driving the ticks put on the frame (see [`set_label`]).
    #[cfg(debug_assertions)]
    pub label: u8,
}

/// Frames kept for whoever reads them back, which is only debug instrumentation.
#[cfg(debug_assertions)]
const MAX_RECORDS: usize = 1 << 20;

struct State {
    /// When the frame in progress started drawing.
    started: Option<Instant>,
    current: FrameRecord,
    /// What the tick before the frame in progress drew after.
    last_tick: TickKind,
    #[cfg(debug_assertions)]
    frames_since_rollback: u16,
    #[cfg(debug_assertions)]
    label: u8,
    /// When the step in progress started.
    tick_started: Option<Instant>,
    draw_started: Option<Instant>,
    render_started: Option<Instant>,
    stats: FrameStats,
    #[cfg(debug_assertions)]
    records: Vec<FrameRecord>,
    /// When the game's first logic step ran.
    #[cfg(debug_assertions)]
    first_step: Option<Instant>,
}

static STATE: Mutex<State> = Mutex::new(State {
    started: None,
    current: FrameRecord {
        interval_us: 0,
        draw_us: 0,
        render_us: 0,
        tick_us: 0,
        tick: TickKind::None,
        resimulated: 0,
        steps: 0,
        #[cfg(debug_assertions)]
        drawn_after: TickKind::None,
        #[cfg(debug_assertions)]
        frames_since_rollback: 0,
        #[cfg(debug_assertions)]
        label: 0,
    },
    last_tick: TickKind::None,
    #[cfg(debug_assertions)]
    frames_since_rollback: u16::MAX,
    #[cfg(debug_assertions)]
    label: 0,
    tick_started: None,
    draw_started: None,
    render_started: None,
    stats: FrameStats::new(),
    #[cfg(debug_assertions)]
    records: Vec::new(),
    #[cfg(debug_assertions)]
    first_step: None,
});

/// A frame that takes longer than this shows as a stutter at the frame rates the game runs at.
pub const SLOW_FRAME: Duration = Duration::from_millis(20);

/// Running totals over the frames since they were last taken.
#[derive(Clone, Copy, Debug, Default)]
pub struct FrameStats {
    pub frames: u32,
    pub worst_us: u32,
    /// Frames longer than [`SLOW_FRAME`].
    pub slow: u32,
    /// Of those, frames whose tick rolled back.
    pub slow_with_rollback: u32,
    /// Of those, frames whose tick only stepped forward, or ran a plain step.
    pub slow_with_step: u32,
    /// The worst frame's split.
    pub worst_draw_us: u32,
    pub worst_render_us: u32,
    pub worst_tick_us: u32,
    pub interval_us: u64,
}

impl FrameStats {
    const fn new() -> FrameStats {
        FrameStats {
            frames: 0,
            worst_us: 0,
            slow: 0,
            slow_with_rollback: 0,
            slow_with_step: 0,
            worst_draw_us: 0,
            worst_render_us: 0,
            worst_tick_us: 0,
            interval_us: 0,
        }
    }

    fn add(&mut self, record: &FrameRecord) {
        self.frames += 1;
        self.interval_us += u64::from(record.interval_us);
        if record.interval_us > self.worst_us {
            self.worst_us = record.interval_us;
            self.worst_draw_us = record.draw_us;
            self.worst_render_us = record.render_us;
            self.worst_tick_us = record.tick_us;
        }
        if u128::from(record.interval_us) > SLOW_FRAME.as_micros() {
            self.slow += 1;
            match record.tick {
                TickKind::Rollback => self.slow_with_rollback += 1,
                TickKind::Forward | TickKind::Plain => self.slow_with_step += 1,
                TickKind::None => (),
            }
        }
    }
}

fn micros(duration: Duration) -> u32 {
    u32::try_from(duration.as_micros()).unwrap_or(u32::MAX)
}

/// Calls the function it holds when dropped, ending a span the code that made it started.
pub struct Finish(fn());

impl Drop for Finish {
    fn drop(&mut self) {
        (self.0)()
    }
}

/// Times one of BW's draws until the returned value is dropped. The first draw of a frame ends the
/// frame before it; a second one (BW draws twice while fading between SD and HD) adds to it.
pub fn draw(first_of_frame: bool) -> Finish {
    match first_of_frame {
        true => draw_started(),
        false => STATE.lock().draw_started = Some(Instant::now()),
    }
    Finish(draw_finished)
}

/// Times the renderer's work on a frame until the returned value is dropped.
pub fn render() -> Finish {
    STATE.lock().render_started = Some(Instant::now());
    Finish(render_finished)
}

/// Times a logic step until the returned value is dropped. Until [`note_tick`] says otherwise, it
/// is a plain step.
pub fn step() -> Finish {
    step_started();
    Finish(step_finished)
}

fn draw_started() {
    let now = Instant::now();
    let mut state = STATE.lock();
    if let Some(started) = state.started {
        let mut record = state.current;
        record.interval_us = micros(now - started);
        state.stats.add(&record);
        #[cfg(debug_assertions)]
        if state.records.len() < MAX_RECORDS {
            state.records.push(record);
        }
    }
    #[cfg(debug_assertions)]
    let current = {
        let drawn_after = state.last_tick;
        state.frames_since_rollback = match drawn_after {
            TickKind::Rollback => 0,
            _ => state.frames_since_rollback.saturating_add(1),
        };
        FrameRecord {
            drawn_after,
            frames_since_rollback: state.frames_since_rollback,
            label: state.label,
            ..FrameRecord::default()
        }
    };
    #[cfg(not(debug_assertions))]
    let current = FrameRecord::default();
    state.last_tick = TickKind::None;
    state.current = current;
    state.started = Some(now);
    state.draw_started = Some(now);
    #[cfg(debug_assertions)]
    {
        let due = DUMP.lock().as_ref().and_then(|(after, path)| {
            let first = state.first_step?;
            (now - first >= *after).then(|| path.clone())
        });
        if let Some(path) = due {
            let records = std::mem::take(&mut state.records);
            drop(state);
            dump(&path, &records);
        }
    }
}

/// Environment variable that has a debug build write every frame's timings to a JSON file once
/// that many seconds have passed since the game's first logic step, then exit: `SB_FRAME_TIMING=60`.
/// The file is named by `SB_FRAME_TIMING_OUT`, or else `frame-timing-<secs>-<pid>.json` in the logs
/// directory.
#[cfg(debug_assertions)]
const DUMP_ENV_VAR: &str = "SB_FRAME_TIMING";

#[cfg(debug_assertions)]
static DUMP: Mutex<Option<(Duration, std::path::PathBuf)>> = Mutex::new(None);

/// Reads [`DUMP_ENV_VAR`]. Called once while the DLL initialises.
#[cfg(debug_assertions)]
pub fn init_from_env() {
    let Ok(spec) = std::env::var(DUMP_ENV_VAR) else {
        return;
    };
    let Ok(seconds) = spec.parse::<u64>() else {
        error!("{DUMP_ENV_VAR}={spec:?} is not a number of seconds; ignoring it");
        return;
    };
    let path = match std::env::var(format!("{DUMP_ENV_VAR}_OUT")) {
        Ok(path) => path.into(),
        Err(_) => {
            let now = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap_or(Duration::ZERO)
                .as_secs();
            crate::parse_args()
                .user_data_path
                .join("logs")
                .join(format!("frame-timing-{now}-{}.json", std::process::id()))
        }
    };
    info!(
        "{DUMP_ENV_VAR}: writing frame timings to {} {seconds} s into the game",
        path.display()
    );
    *DUMP.lock() = Some((Duration::from_secs(seconds), path));
}

/// Writes `records` out as JSON, one array per frame in [`FrameRecord`]'s field order, and exits.
#[cfg(debug_assertions)]
fn dump(path: &std::path::Path, records: &[FrameRecord]) {
    use std::io::Write;
    let kind = |x: TickKind| x as u8;
    let mut out = String::with_capacity(records.len() * 40 + 256);
    out.push_str(
        "{\"fields\":[\"interval_us\",\"draw_us\",\"render_us\",\"tick_us\",\"tick\",\
         \"resimulated\",\"steps\",\"drawn_after\",\"frames_since_rollback\",\"label\"],\
         \"tick_kinds\":[\"none\",\"plain\",\"forward\",\"rollback\"],\"frames\":[",
    );
    for (i, x) in records.iter().enumerate() {
        if i != 0 {
            out.push(',');
        }
        out.push_str(&format!(
            "[{},{},{},{},{},{},{},{},{},{}]",
            x.interval_us,
            x.draw_us,
            x.render_us,
            x.tick_us,
            kind(x.tick),
            x.resimulated,
            x.steps,
            kind(x.drawn_after),
            x.frames_since_rollback,
            x.label,
        ));
    }
    out.push_str("]}");
    let partial = path.with_extension("partial");
    let written = std::fs::File::create(&partial)
        .and_then(|mut file| file.write_all(out.as_bytes()))
        .and_then(|()| std::fs::rename(&partial, path));
    match written {
        Ok(()) => info!("Frame timings written to {}", path.display()),
        Err(e) => error!("Could not write frame timings to {}: {e}", path.display()),
    }
    unsafe {
        winapi::um::processthreadsapi::TerminateProcess(
            winapi::um::processthreadsapi::GetCurrentProcess(),
            0,
        );
    }
}

fn draw_finished() {
    let mut state = STATE.lock();
    if let Some(started) = state.draw_started.take() {
        state.current.draw_us = state
            .current
            .draw_us
            .saturating_add(micros(started.elapsed()));
    }
}

fn render_finished() {
    let mut state = STATE.lock();
    if let Some(started) = state.render_started.take() {
        state.current.render_us = state
            .current
            .render_us
            .saturating_add(micros(started.elapsed()));
    }
}

fn step_started() {
    let mut state = STATE.lock();
    let now = Instant::now();
    state.tick_started = Some(now);
    #[cfg(debug_assertions)]
    if state.first_step.is_none() {
        state.first_step = Some(now);
    }
    if state.current.tick == TickKind::None {
        state.current.tick = TickKind::Plain;
    }
}

fn step_finished() {
    let mut state = STATE.lock();
    if let Some(started) = state.tick_started.take() {
        state.current.tick_us = state
            .current
            .tick_us
            .saturating_add(micros(started.elapsed()));
    }
    if state.current.tick != TickKind::None {
        state.last_tick = state.current.tick;
    }
}

/// Notes what the rollback tick in progress did: how many steps it ran, and how many of those
/// simulated frames again after restoring a snapshot.
pub fn note_tick(steps: u32, resimulated: Option<u32>) {
    let mut state = STATE.lock();
    let record = &mut state.current;
    record.steps = record
        .steps
        .saturating_add(u8::try_from(steps).unwrap_or(u8::MAX));
    match resimulated {
        Some(frames) => {
            record.tick = TickKind::Rollback;
            record.resimulated = record
                .resimulated
                .max(u8::try_from(frames).unwrap_or(u8::MAX));
        }
        None if record.tick != TickKind::Rollback => record.tick = TickKind::Forward,
        None => (),
    }
}

/// Labels the frames from the one in progress on, for instrumentation that tells its phases apart.
#[cfg(debug_assertions)]
pub fn set_label(label: u8) {
    let mut state = STATE.lock();
    state.label = label;
    state.current.label = label;
}

/// Takes the totals over the frames since they were last taken.
pub fn take_stats() -> FrameStats {
    std::mem::take(&mut STATE.lock().stats)
}

/// Takes the frames recorded so far.
#[cfg(debug_assertions)]
pub fn take_records() -> Vec<FrameRecord> {
    std::mem::take(&mut STATE.lock().records)
}

/// Forgets everything recorded, for a new game.
pub fn reset() {
    let mut state = STATE.lock();
    state.started = None;
    state.last_tick = TickKind::None;
    #[cfg(debug_assertions)]
    {
        state.frames_since_rollback = u16::MAX;
    }
    state.stats = FrameStats::new();
    #[cfg(debug_assertions)]
    {
        state.records.clear();
        state.first_step = None;
    }
}
