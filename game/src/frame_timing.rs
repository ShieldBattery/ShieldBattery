//! Times the game loop's frames, so a frame rate dip can be pinned on what caused it.
//!
//! A frame runs from the start of one of BW's draws to the start of the next. In between, the game
//! loop draws (BW queuing its draw commands, then our overlays), hands the commands to the
//! renderer, pumps messages, and when a logic step is due runs it (a rollback tick, in a game that
//! rolls back) before it draws again. Each frame's record splits its time between those, and notes
//! what kind of tick ran in it and what the tick before its draw was, since a tick's cost shows up
//! in the frame it runs in while whatever it leaves rendering to do shows up in the frames after.
//!
//! A frame longer than [`LONG_FRAME`] anywhere in a game is logged on its own with that split, as
//! the game seen from outside has frozen for it.

use std::cell::Cell;
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
    /// Pumping window messages outside logic steps: the game loop's `PeekMessageW` calls and the
    /// window procedure handling what they return.
    pub pump_us: u32,
    /// Messages those calls took off the queue, counting each raw mouse report.
    pub pump_messages: u32,
    /// Handing the rendered frame to the swap chain.
    pub present_us: u32,
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
    present_started: Option<Instant>,
    /// Whether the game window was in front when the frame in progress started, and
    /// [`crate::forge::game_window_front_changes`] then.
    in_front_at_start: bool,
    front_changes_at_start: u32,
    /// Frames over [`LONG_FRAME`] logged this game.
    long_frames_logged: u32,
    stats: FrameStats,
    #[cfg(debug_assertions)]
    records: Vec<FrameRecord>,
    /// When the game's first logic step ran.
    first_step: Option<Instant>,
    startup: StartupFrames,
}

/// How long from the game's first logic step the frames are logged one by one when slow: the
/// first frames of a session tend to hitch while the renderer settles, rollback or not.
const STARTUP_FRAMES: Duration = Duration::from_secs(10);

/// How many of the slowest frames of a game's start its log line lists.
const STARTUP_SLOW_FRAMES_LOGGED: usize = 6;

/// The frames of a game's first [`STARTUP_FRAMES`], for one log line once it is over.
struct StartupFrames {
    frames: u32,
    slow: u32,
    /// The slowest frames, slowest first, with how far into the start each one began.
    slowest: [Option<(Duration, FrameRecord)>; STARTUP_SLOW_FRAMES_LOGGED],
    logged: bool,
}

impl StartupFrames {
    const fn new() -> StartupFrames {
        StartupFrames {
            frames: 0,
            slow: 0,
            slowest: [None; STARTUP_SLOW_FRAMES_LOGGED],
            logged: false,
        }
    }

    /// Notes a frame that started `at` into the game's start, and logs the start's frames once
    /// `now` is past it.
    fn note(&mut self, at: Duration, record: &FrameRecord, now: Duration) {
        if self.logged {
            return;
        }
        if at < STARTUP_FRAMES {
            self.frames += 1;
            if u128::from(record.interval_us) > SLOW_FRAME.as_micros() {
                self.slow += 1;
                let rank = self
                    .slowest
                    .iter()
                    .position(|x| x.is_none_or(|(_, x)| x.interval_us < record.interval_us));
                if let Some(rank) = rank {
                    self.slowest[rank..].rotate_right(1);
                    self.slowest[rank] = Some((at, *record));
                }
            }
        }
        if now >= STARTUP_FRAMES {
            self.logged = true;
            let ms = |us: u32| f64::from(us) / 1000.0;
            let slowest = self
                .slowest
                .iter()
                .flatten()
                .map(|(at, x)| {
                    format!(
                        "{:.1} ms at {:.2} s (draw {:.1}, render {:.1}, tick {:.1}, {:?})",
                        ms(x.interval_us),
                        at.as_secs_f64(),
                        ms(x.draw_us),
                        ms(x.render_us),
                        ms(x.tick_us),
                        x.tick,
                    )
                })
                .collect::<Vec<_>>()
                .join(", ");
            info!(
                "Frames over the game's first {} s: {}, {} over {} ms; slowest: {}",
                STARTUP_FRAMES.as_secs(),
                self.frames,
                self.slow,
                SLOW_FRAME.as_millis(),
                if slowest.is_empty() { "none" } else { &slowest },
            );
        }
    }
}

static STATE: Mutex<State> = Mutex::new(State {
    started: None,
    current: FrameRecord {
        interval_us: 0,
        draw_us: 0,
        render_us: 0,
        tick_us: 0,
        pump_us: 0,
        pump_messages: 0,
        present_us: 0,
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
    present_started: None,
    in_front_at_start: false,
    front_changes_at_start: 0,
    long_frames_logged: 0,
    stats: FrameStats::new(),
    #[cfg(debug_assertions)]
    records: Vec::new(),
    first_step: None,
    startup: StartupFrames::new(),
});

/// A frame that takes longer than this shows as a stutter at the frame rates the game runs at.
pub const SLOW_FRAME: Duration = Duration::from_millis(20);

/// A frame that takes longer than this is a freeze, which gets a log line of its own.
const LONG_FRAME: Duration = Duration::from_millis(250);

/// How many frames over [`LONG_FRAME`] a game logs one by one. A game that keeps freezing has
/// shown what it's doing by then, and the log stays readable.
const LONG_FRAMES_LOGGED: u32 = 20;

thread_local! {
    /// The pump time and messages of the frame in progress, kept on the game loop's thread so that
    /// every `PeekMessageW` call doesn't take the state's lock.
    static PUMP: Cell<PumpTally> = const { Cell::new(PumpTally::new()) };
    /// How deeply logic steps are nested on this thread. A step waiting for turns pumps messages
    /// itself, and that time is the step's.
    static STEP_DEPTH: Cell<u32> = const { Cell::new(0) };
}

#[derive(Clone, Copy)]
struct PumpTally {
    /// How deeply pump spans are nested: the window procedure runs inside `PeekMessageW` for sent
    /// messages, and only the outermost span is timed.
    depth: u32,
    started: Option<Instant>,
    us: u32,
    messages: u32,
}

impl PumpTally {
    const fn new() -> PumpTally {
        PumpTally {
            depth: 0,
            started: None,
            us: 0,
            messages: 0,
        }
    }
}

/// Ends a pump span when dropped.
pub struct PumpSpan(());

impl Drop for PumpSpan {
    fn drop(&mut self) {
        PUMP.with(|pump| {
            let mut tally = pump.get();
            tally.depth -= 1;
            if tally.depth == 0
                && let Some(started) = tally.started.take()
            {
                tally.us = tally.us.saturating_add(micros(started.elapsed()));
            }
            pump.set(tally);
        });
    }
}

/// Times the game loop pumping messages until the returned value is dropped. Only for the thread
/// running the game loop, once it runs; the time goes to the frame the pump ends in.
pub fn pump() -> PumpSpan {
    PUMP.with(|pump| {
        let mut tally = pump.get();
        if tally.depth == 0 && STEP_DEPTH.get() == 0 {
            tally.started = Some(Instant::now());
        }
        tally.depth += 1;
        pump.set(tally);
    });
    PumpSpan(())
}

/// Counts a message the game loop's pump took off the queue. Same thread rules as [`pump`].
pub fn pumped_message() {
    PUMP.with(|pump| {
        let mut tally = pump.get();
        tally.messages = tally.messages.saturating_add(1);
        pump.set(tally);
    });
}

/// Takes the pump time and messages counted since the last call.
fn take_pump() -> (u32, u32) {
    PUMP.with(|pump| {
        let mut tally = pump.get();
        let taken = (tally.us, tally.messages);
        tally.us = 0;
        tally.messages = 0;
        pump.set(tally);
        taken
    })
}

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

/// Times handing a frame to the swap chain until the returned value is dropped.
pub fn present() -> Finish {
    STATE.lock().present_started = Some(Instant::now());
    Finish(present_finished)
}

/// Times a logic step until the returned value is dropped. Until [`note_tick`] says otherwise, it
/// is a plain step.
pub fn step() -> Finish {
    step_started();
    Finish(step_finished)
}

fn draw_started() {
    let now = Instant::now();
    let (pump_us, pump_messages) = take_pump();
    let in_front = crate::forge::game_window_in_front();
    let front_changes = crate::forge::game_window_front_changes();
    let mut long_frame = None;
    let mut state = STATE.lock();
    if let Some(started) = state.started {
        let mut record = state.current;
        record.interval_us = micros(now - started);
        record.pump_us = pump_us;
        record.pump_messages = pump_messages;
        state.stats.add(&record);
        if let Some(first) = state.first_step {
            let at = started.saturating_duration_since(first);
            state.startup.note(at, &record, now - first);
            if started >= first
                && u128::from(record.interval_us) > LONG_FRAME.as_micros()
                && state.long_frames_logged < LONG_FRAMES_LOGGED
            {
                state.long_frames_logged += 1;
                let window = match (state.in_front_at_start, in_front) {
                    (true, true) if state.front_changes_at_start != front_changes => {
                        "window left the front and came back"
                    }
                    (true, true) => "window in front",
                    (false, false) => "window not in front",
                    (true, false) => "window left the front",
                    (false, true) => "window came to the front",
                };
                long_frame = Some(describe_long_frame(
                    &record,
                    at,
                    window,
                    state.long_frames_logged == LONG_FRAMES_LOGGED,
                ));
            }
        }
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
    state.in_front_at_start = in_front;
    state.front_changes_at_start = front_changes;
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
            return;
        }
    }
    drop(state);
    if let Some(line) = long_frame {
        info!("{line}");
    }
}

/// The log line for a frame over [`LONG_FRAME`] that started `at` into the game. Whatever the split
/// doesn't account for is time between those parts: SC:R's own work in the loop, or the thread not
/// running at all.
fn describe_long_frame(
    record: &FrameRecord,
    at: Duration,
    window: &str,
    last_logged: bool,
) -> String {
    let ms = |us: u32| f64::from(us) / 1000.0;
    let accounted = record
        .pump_us
        .saturating_add(record.tick_us)
        .saturating_add(record.draw_us)
        .saturating_add(record.render_us)
        .saturating_add(record.present_us);
    format!(
        "Long frame: {:.1} ms at {:.2} s into the game: pump {:.1} ms ({} messages), tick {:.1} ms \
         ({:?}), draw {:.1} ms, render {:.1} ms, present {:.1} ms, unaccounted {:.1} ms; {window}{}",
        ms(record.interval_us),
        at.as_secs_f64(),
        ms(record.pump_us),
        record.pump_messages,
        ms(record.tick_us),
        record.tick,
        ms(record.draw_us),
        ms(record.render_us),
        ms(record.present_us),
        ms(record.interval_us.saturating_sub(accounted)),
        match last_logged {
            true => " (further long frames this game go unlogged)",
            false => "",
        },
    )
}

/// Environment variable that has a debug build write every frame's timings to a JSON file once
/// that many seconds have passed since the game's first logic step, then exit: `SB_FRAME_TIMING=60`.
/// The file is named by `SB_FRAME_TIMING_OUT`, or else `frame-timing-<secs>-<pid>.json` in the logs
/// directory.
#[cfg(debug_assertions)]
const DUMP_ENV_VAR: &str = "SB_FRAME_TIMING";

#[cfg(debug_assertions)]
static DUMP: Mutex<Option<(Duration, std::path::PathBuf)>> = Mutex::new(None);

/// Reads [`DUMP_ENV_VAR`]. Called once while the DLL initializes.
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

fn present_finished() {
    let mut state = STATE.lock();
    if let Some(started) = state.present_started.take() {
        state.current.present_us = state
            .current
            .present_us
            .saturating_add(micros(started.elapsed()));
    }
}

fn step_started() {
    STEP_DEPTH.set(STEP_DEPTH.get() + 1);
    let mut state = STATE.lock();
    let now = Instant::now();
    state.tick_started = Some(now);
    if state.first_step.is_none() {
        state.first_step = Some(now);
    }
    if state.current.tick == TickKind::None {
        state.current.tick = TickKind::Plain;
    }
}

fn step_finished() {
    STEP_DEPTH.set(STEP_DEPTH.get().saturating_sub(1));
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
    state.first_step = None;
    state.startup = StartupFrames::new();
    state.long_frames_logged = 0;
    #[cfg(debug_assertions)]
    state.records.clear();
}
