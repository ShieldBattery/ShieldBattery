//! Paces BW's in-game loop to a frame rate while keeping its logic steps on time.
//!
//! Each iteration of the loop (`step_game_loop`) pumps window messages, which is where clicks and
//! hotkeys become commands, runs a logic step if one is due, then draws and presents a frame. BW
//! checks whether a step is due once per iteration, so a step runs at the first iteration after
//! it comes due, and only input pumped before that iteration makes it into the turn the step
//! sends. Iterating as fast as possible keeps both close to on time, at the cost of drawing far
//! more frames than the display shows.
//!
//! Pacing waits at the top of each iteration, before the pump, until whichever comes first: the
//! next slot on a grid of frames at the target rate, or the instant the next step comes due. A
//! frame slot then has the newest input in it, and a step runs on time with all input up to that
//! instant. A frame slot within [`MERGE`] of a step coming due is served by the step's iteration
//! rather than one of its own.
//!
//! SC:R's own frame cap sleeps between drawing a frame and presenting it, which only makes what is
//! presented older, so while pacing those sleeps are skipped (see [`skip_sleep`]).
//!
//! The statistics logged every [`STATS_INTERVAL`] (iteration rate, step lateness, and how often
//! BW's screen scrolling runs) are gathered whether or not pacing is on, to compare against.

use std::cell::Cell;
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

const ENV_VAR: &str = "SB_FRAME_PACE";

/// A frame slot this close to a step coming due is drawn by the step's iteration instead.
const MERGE: Duration = Duration::from_micros(2000);

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
enum Target {
    Off,
    /// Frames per second.
    Rate(f64),
    /// The refresh rate of the monitor the game window is on.
    DisplayRate,
}

static TARGET: Mutex<Target> = Mutex::new(Target::Off);

/// Reads [`ENV_VAR`]: a frame rate, or `auto` for the display's refresh rate. Called once while the
/// DLL initializes.
pub fn init_from_env() {
    let Ok(spec) = std::env::var(ENV_VAR) else {
        return;
    };
    let target = match spec.trim() {
        "auto" => Target::DisplayRate,
        rate => match rate.parse::<f64>() {
            Ok(rate) if rate >= 10.0 => Target::Rate(rate),
            _ => {
                error!("{ENV_VAR}={spec:?} is neither a frame rate of 10 or more nor `auto`");
                return;
            }
        },
    };
    info!("Frame pacing: {target:?}");
    *TARGET.lock() = target;
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

/// What a wait at the top of an iteration was for.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum Wake {
    Frame,
    Step,
    /// A step coming due within [`MERGE`] of a frame slot.
    Merged,
}

struct State {
    /// The resolved target frame time for this game, once the first iteration resolved it. `None`
    /// inside means pacing is off for this game.
    period: Option<Option<Duration>>,
    /// The next slot on the frame grid.
    next_frame: Option<Instant>,
    /// When the previous iteration started, after its wait.
    last_iteration: Option<Instant>,
    stats: Stats,
}

struct Stats {
    started: Option<Instant>,
    iterations: u32,
    frame_wakes: u32,
    step_wakes: u32,
    merged_wakes: u32,
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
    period: None,
    next_frame: None,
    last_iteration: None,
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
    static WAIT_TIMER: Cell<Option<usize>> = const { Cell::new(None) };
}

/// Ends an iteration of the in-game loop when dropped.
pub struct Iteration(());

impl Drop for Iteration {
    fn drop(&mut self) {
        LOOP_DEPTH.set(LOOP_DEPTH.get().saturating_sub(1));
        IN_CAP_WINDOW.set(false);
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
    Iteration(())
}

unsafe fn pace(bw: &BwScr) {
    let now = Instant::now();
    let mut state = STATE.lock();
    let period = *state.period.get_or_insert_with(resolve_period);
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
    if let Some(period) = period {
        // Behind by more than a frame (a slow frame, or the first iteration): restart the grid
        // rather than run the missed slots back to back.
        let frame_at = match state.next_frame {
            Some(slot) if slot + period >= now => slot,
            _ => now,
        };
        let (wake_at, wake) = match step_due {
            Some(step) if step + MERGE < frame_at => (step, Wake::Step),
            Some(step) if step <= frame_at + MERGE => (step, Wake::Merged),
            _ => (frame_at, Wake::Frame),
        };
        if wake != Wake::Step {
            state.next_frame = Some(frame_at + period);
        }
        drop(state);
        let timer_late = wait_until(wake_at);
        let woke = Instant::now();
        state = STATE.lock();
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
        log_stats(stats, period, now - started);
        let last_scroll_tick = stats.last_scroll_tick;
        *stats = Stats::new();
        stats.started = Some(now);
        stats.last_scroll_tick = last_scroll_tick;
    }
}

/// The frame time to pace this game to, or `None` to leave it unpaced.
fn resolve_period() -> Option<Duration> {
    let rate = match *TARGET.lock() {
        Target::Off => return None,
        Target::Rate(rate) => rate,
        Target::DisplayRate => match display_refresh_rate() {
            Some(rate) => {
                info!("Frame pacing: display refreshes at {rate} Hz");
                f64::from(rate)
            }
            None => {
                warn!("Frame pacing: couldn't find the display's refresh rate, not pacing");
                return None;
            }
        },
    };
    Some(Duration::from_secs_f64(1.0 / rate))
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

/// The renderer is taking a frame's draw commands, so SC:R's frame cap is behind it.
pub fn render_started() {
    IN_CAP_WINDOW.set(false);
}

fn is_pacing() -> bool {
    matches!(STATE.lock().period, Some(Some(_)))
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

/// Notes a logic step starting, scheduled for `due_tick`.
pub fn note_step(due_tick: Option<u32>) {
    let Some(due) = due_tick.and_then(instant_of_tick) else {
        return;
    };
    let late = micros(Instant::now().saturating_duration_since(due));
    let mut state = STATE.lock();
    if state.stats.step_late_us.len() < 4096 {
        state.stats.step_late_us.push(late);
    }
}

fn log_stats(stats: &mut Stats, period: Option<Duration>, elapsed: Duration) {
    let secs = elapsed.as_secs_f64();
    let per_sec = |count: u32| f64::from(count) / secs;
    let ms = |us: u64| us as f64 / 1000.0;
    let late = &mut stats.step_late_us;
    late.sort_unstable();
    let quantile = |q: f64| {
        late.get(((late.len().saturating_sub(1)) as f64 * q).round() as usize)
            .map_or(0.0, |&us| ms(u64::from(us)))
    };
    let steps = format!(
        "{} steps late p50 {:.2} ms p90 {:.2} ms max {:.2} ms",
        late.len(),
        quantile(0.5),
        quantile(0.9),
        quantile(1.0),
    );
    let pacing = match period {
        None => "unpaced".to_owned(),
        Some(period) => {
            format!(
                "paced at {:.1} fps: {} frame / {} step / {} merged wakes, oversleep avg {:.3} ms \
                 max {:.3} ms (timer {:.3} ms), waiting {:.0}% of the time, {} cap sleeps skipped                  ({} ms)",
                1.0 / period.as_secs_f64(),
                stats.frame_wakes,
                stats.step_wakes,
                stats.merged_wakes,
                ms(stats.oversleep_us_total) / f64::from(stats.slept.max(1)),
                ms(u64::from(stats.oversleep_us_max)),
                ms(u64::from(stats.timer_late_us_max)),
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

/// Forgets the previous game's pacing, so the next one resolves its target again.
pub fn reset() {
    let mut state = STATE.lock();
    state.period = None;
    state.next_frame = None;
    state.last_iteration = None;
    state.stats = Stats::new();
}
