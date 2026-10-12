//! Paces BW's in-game loop to the display while keeping its logic steps on time.
//!
//! Each iteration of the loop (`step_game_loop`) pumps window messages, which is where clicks and
//! hotkeys become commands, runs a logic step if one is due, then draws and presents a frame. BW
//! checks whether a step is due once per iteration, so a step runs at the first iteration after
//! it comes due, and only input pumped before that iteration makes it into the turn the step
//! sends. Iterating as fast as possible keeps both close to on time, and keeps the newest frame
//! close to the display's next refresh, at the cost of drawing far more frames than are shown.
//!
//! Pacing waits at the top of each iteration, before the pump, until whichever comes first:
//!
//! - the time to start the next frame. In [`Mode::Display`] that is the next vertical blank of the
//!   display (see [`vblank`]) minus how long a frame takes to draw and present plus [`MARGIN`], so
//!   the frame is presented with the newest input just before the display shows it. The other
//!   modes keep frames on a fixed grid.
//! - the instant the next step comes due, so it runs on time with all input up to that instant. A
//!   step coming due within [`MERGE`] before a frame's time runs in the frame's iteration instead.
//!
//! An iteration woken for a step alone still draws and presents, so that what the step did shows
//! right away (torn, without vertical sync), unless vertical sync is on: a present would then
//! queue behind the frame timed for the refresh, so the iteration skips drawing
//! (see [`skips_render`]).
//!
//! SC:R's own frame cap sleeps between drawing a frame and presenting it, which only makes what is
//! presented older, so while pacing those sleeps are skipped (see [`skip_sleep`]).
//!
//! The statistics logged every [`STATS_INTERVAL`] (iteration rate, step lateness, and how often
//! BW's screen scrolling runs) are gathered whether or not pacing is on, to compare against.

mod vblank;

use std::cell::Cell;
use std::collections::VecDeque;
use std::ptr::null_mut;
use std::sync::OnceLock;
use std::time::{Duration, Instant};

use parking_lot::Mutex;
use winapi::shared::ntdef::LARGE_INTEGER;
use winapi::um::handleapi::INVALID_HANDLE_VALUE;
use winapi::um::synchapi::{CreateWaitableTimerExW, SetWaitableTimer, WaitForSingleObject};
use winapi::um::winbase::INFINITE;
use winapi::um::winnt::{HANDLE, TIMER_ALL_ACCESS};

use crate::bw_scr::BwScr;

use self::vblank::VblankClock;

const ENV_VAR: &str = "SB_FRAME_PACE";
const MARGIN_ENV_VAR: &str = "SB_FRAME_PACE_MARGIN_US";

/// A step coming due this long or less before a frame's time runs in the frame's iteration.
const MERGE: Duration = Duration::from_micros(2000);

/// How long before a vertical blank a frame aims to be presented, beyond the time its iteration
/// has been taking: room for the GPU to finish drawing it, and for iterations that run long.
const MARGIN: Duration = Duration::from_micros(1500);

/// Frames whose iteration times decide how long the next one is expected to take.
const WORK_SAMPLES: usize = 64;

/// A step due further out than this is not a value the loop is pacing against (the game hasn't
/// started stepping, or the tick is stale), so it doesn't schedule a wake.
const MAX_STEP_LOOKAHEAD: Duration = Duration::from_millis(600);

/// The last stretch of a wait is spun rather than slept, since even a high resolution timer wakes
/// up to about half a millisecond off.
const SPIN: Duration = Duration::from_micros(700);

const STATS_INTERVAL: Duration = Duration::from_secs(10);

/// `CREATE_WAITABLE_TIMER_HIGH_RESOLUTION`, which winapi doesn't define (Windows 10 1803+).
const CREATE_WAITABLE_TIMER_HIGH_RESOLUTION: u32 = 0x2;

/// BW's screen scrolling runs in an iteration when more than this many ticks have passed since it
/// last ran.
const SCROLL_GATE_TICKS: i32 = 10;

#[derive(Clone, Copy, Debug, PartialEq)]
pub enum Mode {
    Off,
    /// One frame per refresh of the display, presented just before its vertical blank.
    Display,
    /// A little under the display's refresh rate, on a fixed grid, for displays with variable
    /// refresh rate, which refresh when a frame arrives.
    VariableRefresh,
    /// A fixed frame rate on a grid, for testing.
    Rate(f64),
}

impl Mode {
    /// The mode a `framePacing` local setting names.
    fn from_setting(value: &str) -> Option<Mode> {
        match value {
            "off" => Some(Mode::Off),
            "display" => Some(Mode::Display),
            "variableRefresh" => Some(Mode::VariableRefresh),
            _ => None,
        }
    }
}

struct Config {
    mode: Mode,
    vsync: bool,
}

static CONFIG: Mutex<Config> = Mutex::new(Config {
    mode: Mode::Off,
    vsync: false,
});

/// The mode [`ENV_VAR`] asks for, overriding the settings.
static ENV_MODE: Mutex<Option<Mode>> = Mutex::new(None);
static MARGIN_OVERRIDE: Mutex<Option<Duration>> = Mutex::new(None);

/// Reads [`ENV_VAR`] (`off`, `display`, `vrr`, or a frame rate) and [`MARGIN_ENV_VAR`]. Called once
/// while the DLL initializes.
pub fn init_from_env() {
    if let Ok(spec) = std::env::var(ENV_VAR) {
        let mode = match spec.trim() {
            "off" => Some(Mode::Off),
            "display" | "auto" => Some(Mode::Display),
            "vrr" => Some(Mode::VariableRefresh),
            rate => match rate.parse::<f64>() {
                Ok(rate) if rate >= 10.0 => Some(Mode::Rate(rate)),
                _ => None,
            },
        };
        match mode {
            Some(mode) => {
                info!("Frame pacing: {ENV_VAR} sets {mode:?}");
                *ENV_MODE.lock() = Some(mode);
            }
            None => error!(
                "{ENV_VAR}={spec:?} is none of `off`, `display`, `vrr` or a frame rate of 10 or more"
            ),
        }
    }
    if let Ok(spec) = std::env::var(MARGIN_ENV_VAR) {
        match spec.trim().parse::<u64>() {
            Ok(us) => *MARGIN_OVERRIDE.lock() = Some(Duration::from_micros(us)),
            Err(_) => error!("{MARGIN_ENV_VAR}={spec:?} is not a number of microseconds"),
        }
    }
}

/// Sets the pacing for the next game from its settings: the `framePacing` local setting, and
/// whether SC:R's vertical sync is on.
pub fn configure(setting: Option<&str>, vsync: bool) {
    let mode = ENV_MODE.lock().unwrap_or_else(|| {
        setting.and_then(Mode::from_setting).unwrap_or_else(|| {
            if let Some(setting) = setting {
                warn!("Frame pacing: unknown setting {setting:?}");
            }
            Mode::Off
        })
    });
    info!(
        "Frame pacing: {mode:?}, vertical sync {}",
        if vsync { "on" } else { "off" }
    );
    *CONFIG.lock() = Config { mode, vsync };
}

/// The clock our `GetTickCount` hook serves BW: milliseconds since the hook was installed, offset
/// by the real tick count at that point. Other APIs' timestamps (notably `GetMessageTime`) are
/// expected to be in the same range; without the offset SC:R discards some otherwise valid events,
/// so that things like keypresses take multiple presses to register.
struct TickClock {
    start: Instant,
    base: u32,
}

static TICK_CLOCK: OnceLock<TickClock> = OnceLock::new();

fn tick_clock() -> &'static TickClock {
    TICK_CLOCK.get_or_init(|| TickClock {
        start: Instant::now(),
        base: unsafe { winapi::um::sysinfoapi::GetTickCount() },
    })
}

/// Starts the clock [`tick_count`] reads. Called when the `GetTickCount` hook is installed.
pub fn start_tick_clock() {
    tick_clock();
}

/// The tick count BW sees.
pub fn tick_count() -> u32 {
    let clock = tick_clock();
    (clock.start.elapsed().as_millis() as u32).wrapping_add(clock.base)
}

/// The instant [`tick_count`] reaches `tick`, which is when BW sees a step scheduled for it as due.
fn instant_of_tick(tick: u32) -> Option<Instant> {
    let clock = TICK_CLOCK.get()?;
    let millis = tick.wrapping_sub(clock.base);
    clock
        .start
        .checked_add(Duration::from_millis(u64::from(millis)))
}

/// The vertical blank clock of the game window's display, started the first time a game paces to
/// it. The game window lives as long as the process.
static VBLANK: OnceLock<VblankClock> = OnceLock::new();

/// What a wait at the top of an iteration was for.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum Wake {
    Frame,
    Step,
    /// A step coming due shortly before a frame's time.
    Merged,
}

/// How a game is paced, resolved at its first iteration.
struct Plan {
    /// Time between frames on the grid, and between refreshes before the vertical blank clock has
    /// measured them.
    period: Duration,
    /// Whether frames are timed to the display's vertical blanks.
    synced: bool,
    /// Whether SC:R presents with vertical sync, queuing each frame for a refresh: an iteration
    /// woken for a step alone then skips drawing, and a frame presented after the refresh it was
    /// timed for takes the next one.
    vsync: bool,
}

/// The frame the iteration in progress draws, timed from its wake to when it's presented.
#[derive(Clone, Copy)]
struct FrameInProgress {
    woke: Instant,
    /// The vertical blank it was timed for.
    vblank: Option<Instant>,
    /// The refresh the frame is shown at instead if it is presented late with vertical sync on.
    shown_late_at: Option<Instant>,
    /// Whether the iteration ran a logic step.
    ran_step: bool,
}

struct State {
    /// The plan for this game, once its first iteration resolved it. `None` inside means it's
    /// unpaced.
    plan: Option<Option<Plan>>,
    /// The next slot on the frame grid.
    next_frame: Option<Instant>,
    /// The vertical blank the last frame was timed for.
    last_vblank: Option<Instant>,
    /// When the previous iteration started, after its wait.
    last_iteration: Option<Instant>,
    frame: Option<FrameInProgress>,
    /// When SC:R started presenting the frame in progress.
    present_start: Option<Instant>,
    /// When SC:R finished presenting the frame in progress.
    frame_end: Option<Instant>,
    /// How long recent frames took from their wake to being presented, in microseconds: those
    /// that didn't run a logic step, and those that did.
    work_us: [VecDeque<u32>; 2],
    stats: Stats,
}

struct Stats {
    started: Option<Instant>,
    iterations: u32,
    frame_wakes: u32,
    step_wakes: u32,
    merged_wakes: u32,
    /// Frames timed to a vertical blank, and of those, ones presented after it.
    synced_frames: u32,
    late_frames: u32,
    /// Of the late frames, ones whose iteration ran a logic step.
    late_step_frames: u32,
    /// Of the late frames, the time from their wake to being presented, and the part of it spent
    /// presenting.
    late_work_us_total: u64,
    late_present_us_total: u64,
    present_us_max: u32,
    /// How long before their vertical blank synced frames were presented, in microseconds.
    slack_us: Vec<i32>,
    lead_us_total: u64,
    skipped_renders: u32,
    /// How late each step ran after coming due, in microseconds.
    step_late_us: Vec<u32>,
    /// Wakes that had to sleep.
    slept: u32,
    oversleep_us_total: u64,
    oversleep_us_max: u32,
    timer_late_us_max: u32,
    waited_us_total: u64,
    /// Iterations in which BW's screen scrolling ran, simulated from its gate on the tick count.
    scroll_runs: u32,
    last_scroll_tick: Option<u32>,
    skipped_sleeps: u32,
    skipped_sleep_ms: u32,
}

impl Stats {
    const fn new() -> Stats {
        Stats {
            started: None,
            iterations: 0,
            frame_wakes: 0,
            step_wakes: 0,
            merged_wakes: 0,
            synced_frames: 0,
            late_frames: 0,
            late_step_frames: 0,
            late_work_us_total: 0,
            late_present_us_total: 0,
            present_us_max: 0,
            slack_us: Vec::new(),
            lead_us_total: 0,
            skipped_renders: 0,
            step_late_us: Vec::new(),
            slept: 0,
            oversleep_us_total: 0,
            oversleep_us_max: 0,
            timer_late_us_max: 0,
            waited_us_total: 0,
            scroll_runs: 0,
            last_scroll_tick: None,
            skipped_sleeps: 0,
            skipped_sleep_ms: 0,
        }
    }
}

static STATE: Mutex<State> = Mutex::new(State {
    plan: None,
    next_frame: None,
    last_vblank: None,
    last_iteration: None,
    frame: None,
    present_start: None,
    frame_end: None,
    work_us: [VecDeque::new(), VecDeque::new()],
    stats: Stats::new(),
});

thread_local! {
    /// How deeply `step_game_loop` is nested on this thread: the window procedure runs an
    /// iteration from inside the pump when the OS asks the game for a frame, as it does while
    /// the window is being moved or resized.
    static LOOP_DEPTH: Cell<u32> = const { Cell::new(0) };
    /// Set between BW queuing a frame's draws and handing them to the renderer, where the only
    /// sleep is SC:R's frame cap, while pacing has the iteration in hand.
    static IN_CAP_WINDOW: Cell<bool> = const { Cell::new(false) };
    /// Set for an iteration that skips drawing, until its draw is skipped.
    static SKIP_RENDER: Cell<bool> = const { Cell::new(false) };
    /// Set while a logic step runs.
    static IN_STEP_LOGIC: Cell<bool> = const { Cell::new(false) };
    static WAIT_TIMER: Cell<Option<usize>> = const { Cell::new(None) };
}

/// Ends an iteration of the in-game loop when dropped.
pub struct Iteration {
    outermost: bool,
}

impl Drop for Iteration {
    fn drop(&mut self) {
        LOOP_DEPTH.set(LOOP_DEPTH.get().saturating_sub(1));
        IN_CAP_WINDOW.set(false);
        if self.outermost {
            SKIP_RENDER.set(false);
            finish_frame();
        }
    }
}

/// Starts an iteration of the in-game loop, first waiting for its turn when pacing. Hold the
/// returned value until the iteration finishes.
pub unsafe fn iteration(bw: &BwScr) -> Iteration {
    let depth = LOOP_DEPTH.get();
    LOOP_DEPTH.set(depth + 1);
    IN_CAP_WINDOW.set(false);
    if depth == 0 {
        unsafe { pace(bw) };
    }
    Iteration {
        outermost: depth == 0,
    }
}

unsafe fn pace(bw: &BwScr) {
    let now = Instant::now();
    let mut state = STATE.lock();
    if state.plan.is_none() {
        state.plan = Some(resolve_plan());
    }
    // A step that came due after the previous iteration started may have come due after that
    // iteration checked for one, so it runs as soon as possible. One already due before then that
    // still hasn't run is held back (the game is paused, or waiting on the network) and doesn't
    // schedule anything.
    let last_iteration = state.last_iteration;
    let step_due = unsafe { bw.next_game_step_tick() }
        .and_then(instant_of_tick)
        .filter(|&due| match due > now {
            true => due - now <= MAX_STEP_LOOKAHEAD,
            false => last_iteration.is_some_and(|last| due > last),
        });
    let paced = state
        .plan
        .as_ref()
        .and_then(|plan| plan.as_ref())
        .map(|plan| (plan.period, plan.synced, plan.vsync));
    if let Some((period, synced, vsync)) = paced {
        let fit = synced
            .then(|| VBLANK.get().and_then(|clock| clock.fit(now)))
            .flatten();
        // The latest a step can come due and still run in the frame's iteration.
        let mut merge_until = None;
        let (frame_at, vblank) = match fit {
            Some(fit) => {
                let lead = state.lead(false);
                // One frame per refresh: never time two for the same vertical blank.
                let earliest = match state.last_vblank {
                    Some(last) => (now + lead).max(last + fit.period / 2),
                    None => now + lead,
                };
                let vblank = fit.next_after(earliest);
                let frame_at = vblank - lead;
                // A frame that runs a step takes longer, so it starts earlier for the same blank.
                let step_lead = state.lead(true).max(lead);
                let (frame_at, lead) = match step_due {
                    Some(step) if step <= frame_at && step + MERGE >= vblank - step_lead => {
                        merge_until = Some(frame_at);
                        (vblank.checked_sub(step_lead).unwrap_or(now), step_lead)
                    }
                    _ => (frame_at, lead),
                };
                state.stats.lead_us_total += u64::from(micros(lead));
                (frame_at, Some(vblank))
            }
            None => {
                // Behind by more than a frame (a slow frame, or the first iteration): restart the
                // grid rather than run the missed slots back to back.
                let slot = match state.next_frame {
                    Some(slot) if slot + period >= now => slot,
                    _ => now,
                };
                (slot, None)
            }
        };
        let merge_until = merge_until.unwrap_or(frame_at);
        let wake = match step_due {
            Some(step) if step + MERGE < frame_at => Wake::Step,
            Some(step) if step <= merge_until => Wake::Merged,
            _ => Wake::Frame,
        };
        let wake_at = match wake {
            Wake::Step | Wake::Merged => step_due.unwrap_or(frame_at),
            Wake::Frame => frame_at,
        };
        if wake != Wake::Step {
            state.next_frame = Some(frame_at + period);
            if vblank.is_some() {
                state.last_vblank = vblank;
            }
        }
        drop(state);
        let timer_late = wait_until(wake_at);
        let woke = Instant::now();
        state = STATE.lock();
        let skip_render = wake == Wake::Step && vsync;
        SKIP_RENDER.set(skip_render);
        state.present_start = None;
        state.frame_end = None;
        state.frame = (!skip_render).then_some(FrameInProgress {
            woke,
            vblank: (wake != Wake::Step).then_some(vblank).flatten(),
            shown_late_at: vblank
                .zip(fit)
                .filter(|_| vsync && wake != Wake::Step)
                .map(|(vblank, fit)| vblank + fit.period),
            ran_step: false,
        });
        let stats = &mut state.stats;
        match wake {
            Wake::Frame => stats.frame_wakes += 1,
            Wake::Step => stats.step_wakes += 1,
            Wake::Merged => stats.merged_wakes += 1,
        }
        // A wake already due (a step that came due during the previous iteration, or a frame slot
        // the grid is catching up on) didn't sleep, so it can't have overslept.
        if wake_at > now {
            let oversleep = micros(woke - wake_at);
            stats.slept += 1;
            stats.oversleep_us_total += u64::from(oversleep);
            stats.oversleep_us_max = stats.oversleep_us_max.max(oversleep);
            stats.timer_late_us_max = stats.timer_late_us_max.max(micros(timer_late));
        }
        stats.waited_us_total += u64::from(micros(woke - now));
    }
    state.last_iteration = Some(Instant::now());
    let stats = &mut state.stats;
    let started = *stats.started.get_or_insert(now);
    stats.iterations += 1;
    let tick = tick_count();
    let scrolls = stats
        .last_scroll_tick
        .is_none_or(|last| tick.wrapping_sub(last) as i32 > SCROLL_GATE_TICKS);
    if scrolls {
        stats.scroll_runs += 1;
        stats.last_scroll_tick = Some(tick);
    }
    if now - started >= STATS_INTERVAL {
        let state = &mut *state;
        let paced = state.plan.as_ref().and_then(|plan| plan.as_ref());
        log_stats(&mut state.stats, paced, now - started);
        let stats = &mut state.stats;
        let last_scroll_tick = stats.last_scroll_tick;
        *stats = Stats::new();
        stats.started = Some(now);
        stats.last_scroll_tick = last_scroll_tick;
    }
}

impl State {
    /// How long before a vertical blank the next frame's iteration should start, `with_step` if
    /// it will run a logic step.
    fn lead(&self, with_step: bool) -> Duration {
        let margin = MARGIN_OVERRIDE.lock().unwrap_or(MARGIN);
        let samples = match &self.work_us {
            [plain, stepped] if with_step && !stepped.is_empty() => stepped,
            [plain, _] => plain,
        };
        if samples.is_empty() {
            return margin + Duration::from_millis(2);
        }
        let mut work: Vec<u32> = samples.iter().copied().collect();
        work.sort_unstable();
        let p90 = work[(work.len() - 1) * 9 / 10];
        Duration::from_micros(u64::from(p90)) + margin
    }
}

/// Records how long the frame the iteration drew took, once it ends.
fn finish_frame() {
    let mut state = STATE.lock();
    let present_start = state.present_start.take();
    let (Some(frame), Some(end)) = (state.frame.take(), state.frame_end.take()) else {
        return;
    };
    let presenting = present_start.map_or(0, |start| micros(end.saturating_duration_since(start)));
    let samples = &mut state.work_us[usize::from(frame.ran_step)];
    if samples.len() == WORK_SAMPLES {
        samples.pop_front();
    }
    samples.push_back(micros(end - frame.woke));
    if let Some(vblank) = frame.vblank {
        let slack = match vblank.checked_duration_since(end) {
            Some(early) => i32::try_from(early.as_micros()).unwrap_or(i32::MAX),
            None => -i32::try_from((end - vblank).as_micros()).unwrap_or(i32::MAX),
        };
        // With vertical sync, a frame presented late is queued for the next refresh, so the next
        // frame is timed for the one after: timing it for that same refresh would queue it behind,
        // and every frame after it would be shown a refresh late too.
        if slack < 0
            && let Some(shown_at) = frame.shown_late_at
        {
            state.last_vblank = state.last_vblank.max(Some(shown_at));
        }
        let stats = &mut state.stats;
        stats.synced_frames += 1;
        stats.present_us_max = stats.present_us_max.max(presenting);
        if slack < 0 {
            stats.late_frames += 1;
            stats.late_present_us_total += u64::from(presenting);
            stats.late_work_us_total += u64::from(micros(end - frame.woke));
            if frame.ran_step {
                stats.late_step_frames += 1;
            }
        }
        if stats.slack_us.len() < 8192 {
            stats.slack_us.push(slack);
        }
    }
}

/// The renderer is taking a frame's draw commands, so SC:R's frame cap is behind it.
pub fn render_started() {
    IN_CAP_WINDOW.set(false);
}

/// SC:R is presenting a frame.
pub fn presenting_frame() {
    if LOOP_DEPTH.get() == 1 {
        STATE.lock().present_start = Some(Instant::now());
    }
}

/// SC:R presented a frame.
pub fn frame_presented() {
    if LOOP_DEPTH.get() == 1 {
        STATE.lock().frame_end = Some(Instant::now());
    }
}

/// How this game is paced, or `None` to leave it unpaced.
fn resolve_plan() -> Option<Plan> {
    let config = CONFIG.lock();
    let (mode, vsync) = (config.mode, config.vsync);
    drop(config);
    let display_rate = || {
        let rate = display_refresh_rate();
        if rate.is_none() {
            warn!("Frame pacing: couldn't find the display's refresh rate, pacing to 60 Hz");
        }
        f64::from(rate.unwrap_or(60))
    };
    let (rate, synced) = match mode {
        Mode::Off => return None,
        Mode::Display => (display_rate(), true),
        // Pacing right at a variable refresh display's top rate has it fall back to fixed
        // refreshes whenever a frame comes early, so stay a little under it.
        Mode::VariableRefresh => {
            let rate = display_rate();
            ((rate - 3.0).min(rate * 0.97), false)
        }
        Mode::Rate(rate) => (rate, false),
    };
    let period = Duration::from_secs_f64(1.0 / rate);
    if synced && let Some(window) = crate::forge::game_window_handle() {
        VBLANK.get_or_init(|| VblankClock::start(window, period));
    }
    info!(
        "Frame pacing: {mode:?} at {rate:.2} fps{}",
        if vsync {
            ", step-only iterations skip drawing"
        } else {
            ""
        }
    );
    Some(Plan {
        period,
        synced,
        vsync,
    })
}

/// The refresh rate of the monitor the game window is on, in whole Hz.
fn display_refresh_rate() -> Option<u32> {
    use winapi::um::wingdi::DEVMODEW;
    use winapi::um::winuser::{
        ENUM_CURRENT_SETTINGS, EnumDisplaySettingsW, GetMonitorInfoW, MONITOR_DEFAULTTONEAREST,
        MONITORINFOEXW, MonitorFromWindow,
    };
    unsafe {
        let window = crate::forge::game_window_handle()?;
        let monitor = MonitorFromWindow(window, MONITOR_DEFAULTTONEAREST);
        let mut info: MONITORINFOEXW = std::mem::zeroed();
        info.cbSize = size_of::<MONITORINFOEXW>() as u32;
        if GetMonitorInfoW(monitor, (&raw mut info).cast()) == 0 {
            return None;
        }
        let mut mode: DEVMODEW = std::mem::zeroed();
        mode.dmSize = size_of::<DEVMODEW>() as u16;
        if EnumDisplaySettingsW(info.szDevice.as_ptr(), ENUM_CURRENT_SETTINGS, &mut mode) == 0 {
            return None;
        }
        // 0 and 1 stand for the hardware's default rate rather than a rate.
        (mode.dmDisplayFrequency > 1).then_some(mode.dmDisplayFrequency)
    }
}

/// Waits until `deadline`: on a high resolution waitable timer for all but the last [`SPIN`] of
/// it, then spinning. Returns how late the timer woke.
fn wait_until(deadline: Instant) -> Duration {
    let now = Instant::now();
    if deadline <= now {
        return Duration::ZERO;
    }
    let remaining = deadline - now;
    let mut timer_late = Duration::ZERO;
    if remaining > SPIN {
        let sleep = remaining - SPIN;
        match wait_timer() {
            Some(timer) => unsafe {
                // Negative due times are relative, in 100 ns units.
                let mut due: LARGE_INTEGER = std::mem::zeroed();
                *due.QuadPart_mut() = -((sleep.as_nanos() / 100) as i64);
                if SetWaitableTimer(timer, &due, 0, None, null_mut(), 0) != 0 {
                    WaitForSingleObject(timer, INFINITE);
                }
            },
            None => std::thread::sleep(sleep),
        }
        timer_late = Instant::now().saturating_duration_since(now + sleep);
    }
    while Instant::now() < deadline {
        std::hint::spin_loop();
    }
    timer_late
}

/// This thread's high resolution waitable timer, created on first use. It lives as long as the
/// thread, which for the game thread is as long as the process.
fn wait_timer() -> Option<HANDLE> {
    let timer = WAIT_TIMER.get().unwrap_or_else(|| {
        let handle = unsafe {
            CreateWaitableTimerExW(
                null_mut(),
                null_mut(),
                CREATE_WAITABLE_TIMER_HIGH_RESOLUTION,
                TIMER_ALL_ACCESS,
            )
        };
        if handle.is_null() || handle == INVALID_HANDLE_VALUE {
            warn!(
                "Frame pacing: no high resolution timer ({}), waits will be less precise",
                std::io::Error::last_os_error()
            );
            WAIT_TIMER.set(Some(0));
            return 0;
        }
        WAIT_TIMER.set(Some(handle as usize));
        handle as usize
    });
    (timer != 0).then_some(timer as HANDLE)
}

/// Ends the draw queuing of the iteration in progress when dropped, after which SC:R's frame cap
/// would sleep before handing the frame to the renderer.
pub struct Draw(());

impl Drop for Draw {
    fn drop(&mut self) {
        if LOOP_DEPTH.get() != 0 && is_pacing() {
            IN_CAP_WINDOW.set(true);
        }
    }
}

/// Starts one of BW's draws. Hold the returned value until the draw returns.
pub fn draw() -> Draw {
    IN_CAP_WINDOW.set(false);
    Draw(())
}

fn is_pacing() -> bool {
    matches!(STATE.lock().plan, Some(Some(_)))
}

/// Whether the in-game loop's own draw, which `main_loop_draw` says this `render_screen` call
/// looks like, should be skipped this iteration: a step having woken it while what it would present
/// has to wait for the frame timed for the display's refresh. Only the first such draw outside the
/// logic step is skipped; the loops that keep the game drawing while it waits on the network run
/// inside the step, and modal dialogs draw without the in-game layers.
pub fn take_render_skip(main_loop_draw: bool) -> bool {
    if !main_loop_draw || LOOP_DEPTH.get() != 1 || IN_STEP_LOGIC.get() || !SKIP_RENDER.get() {
        return false;
    }
    SKIP_RENDER.set(false);
    STATE.lock().stats.skipped_renders += 1;
    true
}

/// Whether a `Sleep` for `millis` is SC:R's frame cap holding back a paced frame, which the caller
/// should then skip.
pub fn skip_sleep(millis: u32) -> bool {
    if !IN_CAP_WINDOW.get() {
        return false;
    }
    let mut state = STATE.lock();
    state.stats.skipped_sleeps += 1;
    state.stats.skipped_sleep_ms = state.stats.skipped_sleep_ms.saturating_add(millis);
    true
}

/// Ends a logic step when dropped.
pub struct Step {
    was_in_step: bool,
}

impl Drop for Step {
    fn drop(&mut self) {
        IN_STEP_LOGIC.set(self.was_in_step);
    }
}

/// Starts a logic step scheduled for `due_tick`. Hold the returned value until it returns.
pub fn step(due_tick: Option<u32>) -> Step {
    let step = Step {
        was_in_step: IN_STEP_LOGIC.replace(true),
    };
    if LOOP_DEPTH.get() == 1
        && let Some(frame) = STATE.lock().frame.as_mut()
    {
        frame.ran_step = true;
    }
    if let Some(due) = due_tick.and_then(instant_of_tick) {
        let late = micros(Instant::now().saturating_duration_since(due));
        let mut state = STATE.lock();
        if state.stats.step_late_us.len() < 4096 {
            state.stats.step_late_us.push(late);
        }
    }
    step
}

fn log_stats(stats: &mut Stats, plan: Option<&Plan>, elapsed: Duration) {
    let secs = elapsed.as_secs_f64();
    let per_sec = |count: u32| f64::from(count) / secs;
    let ms = |us: f64| us / 1000.0;
    let quantile = |values: &[u32], q: f64| {
        values
            .get(((values.len().saturating_sub(1)) as f64 * q).round() as usize)
            .map_or(0.0, |&us| ms(f64::from(us)))
    };
    stats.step_late_us.sort_unstable();
    let late = &stats.step_late_us;
    let steps = format!(
        "{} steps late p50 {:.2} ms p90 {:.2} ms max {:.2} ms",
        late.len(),
        quantile(late, 0.5),
        quantile(late, 0.9),
        quantile(late, 1.0),
    );
    let pacing = match plan {
        None => "unpaced".to_owned(),
        Some(plan) => {
            let synced = match plan.synced {
                false => String::new(),
                true => {
                    stats.slack_us.sort_unstable();
                    let slack = &stats.slack_us;
                    let at = |q: f64| {
                        slack
                            .get(((slack.len().saturating_sub(1)) as f64 * q).round() as usize)
                            .map_or(0.0, |&us| ms(f64::from(us)))
                    };
                    let frames = stats.frame_wakes + stats.merged_wakes;
                    format!(
                        "; {} of {} frames timed to a refresh (period {}), lead avg {:.2} ms, \
                         presented before the refresh p10 {:.2} ms p50 {:.2} ms min {:.2} ms, \
                         {} after it ({} running a step, taking avg {:.2} ms of which {:.2} ms \
                         presenting), presenting max {:.2} ms",
                        stats.synced_frames,
                        frames,
                        VBLANK
                            .get()
                            .and_then(|clock| clock.fit(Instant::now()))
                            .map_or("unmeasured".to_owned(), |fit| format!(
                                "{:.4} ms, blanks seen within {:.3} ms",
                                fit.period.as_secs_f64() * 1000.0,
                                fit.spread.as_secs_f64() * 1000.0,
                            )),
                        ms(stats.lead_us_total as f64) / f64::from(frames.max(1)),
                        at(0.1),
                        at(0.5),
                        at(0.0),
                        stats.late_frames,
                        stats.late_step_frames,
                        ms(stats.late_work_us_total as f64) / f64::from(stats.late_frames.max(1)),
                        ms(stats.late_present_us_total as f64)
                            / f64::from(stats.late_frames.max(1)),
                        ms(f64::from(stats.present_us_max)),
                    )
                }
            };
            format!(
                "paced at {:.1} fps: {} frame / {} step / {} merged wakes, {} renders skipped, \
                 oversleep avg {:.3} ms max {:.3} ms (timer {:.3} ms), waiting {:.0}% of the \
                 time, {} cap sleeps skipped ({} ms){synced}",
                1.0 / plan.period.as_secs_f64(),
                stats.frame_wakes,
                stats.step_wakes,
                stats.merged_wakes,
                stats.skipped_renders,
                ms(stats.oversleep_us_total as f64) / f64::from(stats.slept.max(1)),
                ms(f64::from(stats.oversleep_us_max)),
                ms(f64::from(stats.timer_late_us_max)),
                stats.waited_us_total as f64 / elapsed.as_micros() as f64 * 100.0,
                stats.skipped_sleeps,
                stats.skipped_sleep_ms,
            )
        }
    };
    debug!(
        "Frame pacing: {:.1} iterations/s, {steps}, scrolling {:.1}/s, {pacing}",
        per_sec(stats.iterations),
        per_sec(stats.scroll_runs),
    );
}

fn micros(duration: Duration) -> u32 {
    u32::try_from(duration.as_micros()).unwrap_or(u32::MAX)
}

/// Forgets the previous game's pacing, so the next one resolves its plan again.
pub fn reset() {
    let mut state = STATE.lock();
    state.plan = None;
    state.next_frame = None;
    state.last_vblank = None;
    state.last_iteration = None;
    state.frame = None;
    state.present_start = None;
    state.frame_end = None;
    state.work_us = Default::default();
    state.stats = Stats::new();
}
