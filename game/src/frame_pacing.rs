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
//!   the frame is presented with the newest input just before the display shows it. When the
//!   window is composed by the desktop window manager rather than flipped to the display
//!   directly, a frame has to be presented well before the blank to make it, so the lead also
//!   grows to whatever the swap chain's statistics show it takes (see [`present_stats`]). A
//!   composed window can't do better that way than the newest of many frames would, though, so
//!   while the statistics show composition, pacing steps aside for SC:R's own frame cap. Frames
//!   timed for a blank are presented without tearing, so they flip at the blank rather than
//!   tearing in just before it. The other modes keep frames on a fixed grid.
//! - the instant the next step comes due, so it runs on time with all input up to that instant. A
//!   step coming due within [`MERGE`] before a frame's time runs in the frame's iteration instead.
//!
//! An iteration woken for a step alone on a fixed grid without vertical sync still draws and
//! presents, so that what the step did shows right away (torn). Otherwise it skips drawing (see
//! [`OwnDraw`]) and what the step did shows in the next frame: with vertical sync on, a present
//! would queue behind the frames timed for the display; frames timed for a blank flip at it, so the
//! next replaces one presented between them before it's shown; and a variable refresh display
//! can't show frames closer together than its top rate. Where skipping a draw isn't safe (see [`iteration`]),
//! steps aren't given wakes of their own at all and run in the next frame's iteration.
//!
//! A variable refresh display shows each frame as it arrives, but no sooner than its top rate
//! allows: one presented sooner tears or waits. Frames are paced a little under that rate, and
//! because how long a frame takes to draw varies, each present is also held until a refresh at
//! the top rate has passed since the one before (see [`presenting_frame`]).
//!
//! SC:R's own frame cap sleeps between drawing a frame and presenting it, which only makes what is
//! presented older, so those sleeps are skipped for the frames pacing times (see [`skip_sleep`]).
//! Loops that draw while the game waits (on the network, or a modal dialog) are left to the cap.
//!
//! The statistics logged every [`STATS_INTERVAL`] (iteration rate, step lateness, and how often
//! BW's screen scrolling runs) are gathered whether or not pacing is on, to compare against.

mod present_stats;
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

/// How much further ahead of its blank than a frame that was presented in time for it yet shown
/// later the next ones are presented.
const DEADLINE_STEP: Duration = Duration::from_micros(500);

/// How much the learned lead shrinks for each frame shown at the blank it was timed for, to find
/// the latest a frame can be presented again once less is needed.
const DEADLINE_DECAY: Duration = Duration::from_micros(2);

/// How far from a measured blank a time the swap chain's statistics give for a flip can be and
/// still count as that blank.
const BLANK_TOLERANCE: Duration = Duration::from_micros(500);

/// Frames in a row the statistics have to show composed, or flipped, to change which pacing takes
/// the window to be.
const COMPOSITION_VOTES: i32 = 3;

/// Iterations in a row woken right away for steps already due, after which the next one waits for
/// its frame. A step stays due across iterations when BW is behind (fast replays, seeking), which
/// catching up handles, but a tick that keeps moving without a step running would otherwise spin
/// the loop.
const MAX_IMMEDIATE_STEP_WAKES: u32 = 32;

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
    if mode != Mode::Off {
        present_stats::install();
    }
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
    /// woken for a step alone then mustn't present (see [`iteration`]), and a frame presented after
    /// the refresh it was timed for takes the next one.
    vsync: bool,
    /// Whether the display refreshes as frames arrive. It can't show two closer together than its
    /// top rate, so an iteration woken for a step alone mustn't present either.
    variable_refresh: bool,
    /// The least time between two presents, on a variable refresh display.
    min_present_interval: Option<Duration>,
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
    /// The step tick the previous iteration saw.
    last_step_tick: Option<u32>,
    /// Iterations in a row woken right away for a step already due.
    immediate_step_wakes: u32,
    frame: Option<FrameInProgress>,
    /// When SC:R started presenting the frame in progress.
    present_start: Option<Instant>,
    /// When SC:R last started presenting a paced frame.
    last_present: Option<Instant>,
    /// When SC:R went to present the frame in progress, before any hold.
    present_requested: Option<Instant>,
    /// When SC:R finished presenting the frame in progress.
    frame_end: Option<Instant>,
    /// How long recent frames took from their wake to being presented, in microseconds: those
    /// that didn't run a logic step, and those that did.
    work_us: [VecDeque<u32>; 2],
    /// How long before its blank a frame has to be presented to be shown at it, as learned from
    /// frames that weren't.
    deadline_lead: Duration,
    /// Whether the desktop window manager is composing the game window, as the statistics show,
    /// and the evidence for it: up for each frame composed, down for each flipped.
    composed: bool,
    composition_votes: i32,
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
    /// Presents held back to keep them a refresh apart, and how long in all.
    held_presents: u32,
    held_present_us_total: u64,
    /// Frames the swap chain's statistics showed being shown, how long after they were presented,
    /// and of those timed for a blank, ones shown later than it though presented before it.
    shown: u32,
    shown_after_us: Vec<u32>,
    missed_deadlines: u32,
    deadline_lead_us_max: u32,
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
            held_presents: 0,
            held_present_us_total: 0,
            shown: 0,
            shown_after_us: Vec::new(),
            missed_deadlines: 0,
            deadline_lead_us_max: 0,
        }
    }
}

static STATE: Mutex<State> = Mutex::new(State {
    plan: None,
    next_frame: None,
    last_vblank: None,
    last_iteration: None,
    last_step_tick: None,
    immediate_step_wakes: 0,
    frame: None,
    present_start: None,
    last_present: None,
    present_requested: None,
    frame_end: None,
    work_us: [VecDeque::new(), VecDeque::new()],
    deadline_lead: Duration::ZERO,
    composed: false,
    composition_votes: 0,
    stats: Stats::new(),
});

thread_local! {
    /// How deeply `step_game_loop` is nested on this thread: the window procedure runs an
    /// iteration from inside the pump when the OS asks the game for a frame, as it does while
    /// the window is being moved or resized.
    static LOOP_DEPTH: Cell<u32> = const { Cell::new(0) };
    /// Set between BW queuing a paced frame's draws and handing them to the renderer, where the
    /// only sleep is SC:R's frame cap.
    static IN_CAP_WINDOW: Cell<bool> = const { Cell::new(false) };
    /// Set while the in-game loop draws its own frame (see [`OwnDraw`]).
    static IN_OWN_DRAW: Cell<bool> = const { Cell::new(false) };
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
/// returned value until the iteration finishes. `can_skip_draw` is whether the iteration may skip
/// drawing its frame: drawing is also what refreshes the vision state native sync (0x37) compares
/// between players, so only a game without it can.
pub unsafe fn iteration(bw: &BwScr, can_skip_draw: bool) -> Iteration {
    let depth = LOOP_DEPTH.get();
    LOOP_DEPTH.set(depth + 1);
    IN_CAP_WINDOW.set(false);
    if depth == 0 {
        unsafe { pace(bw, can_skip_draw) };
    }
    Iteration {
        outermost: depth == 0,
    }
}

unsafe fn pace(bw: &BwScr, can_skip_draw: bool) {
    let now = Instant::now();
    let mut state = STATE.lock();
    if state.plan.is_none() {
        state.plan = Some(resolve_plan());
    }
    // A step already due runs as soon as possible if it can have become due since the previous
    // iteration checked: the tick moved (a step ran there, and BW, being behind, owes another, or
    // a seek put the tick back), or it came due after that iteration started. A step due before
    // then whose tick hasn't moved is held back (the game is paused, or waiting on the network)
    // and doesn't schedule anything.
    let step_tick = unsafe { bw.next_game_step_tick() };
    let tick_moved = step_tick != state.last_step_tick;
    state.last_step_tick = step_tick;
    let last_iteration = state.last_iteration;
    let immediate_allowed = state.immediate_step_wakes < MAX_IMMEDIATE_STEP_WAKES;
    let step_due = step_tick
        .and_then(instant_of_tick)
        .filter(|&due| match due > now {
            true => due - now <= MAX_STEP_LOOKAHEAD,
            false => {
                immediate_allowed && (tick_moved || last_iteration.is_some_and(|last| due > last))
            }
        });
    let composed = state.composed;
    let paced = state
        .plan
        .as_ref()
        .and_then(|plan| plan.as_ref())
        .filter(|_| !composed)
        .map(|plan| (plan.period, plan.synced, plan.vsync, plan.variable_refresh));
    if let Some((period, synced, vsync, variable_refresh)) = paced {
        // An iteration for a step alone mustn't present with vertical sync on or on a variable
        // refresh display, and gains nothing presenting between frames that flip at the blank
        // (the next one replaces it before it's shown); when it can't skip drawing either, steps
        // run in frames' iterations instead.
        let no_step_presents = vsync || variable_refresh || synced;
        let fold_steps = no_step_presents && !can_skip_draw;
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
                    Some(step)
                        if step <= frame_at
                            && (fold_steps || step + MERGE >= vblank - step_lead) =>
                    {
                        merge_until = Some(frame_at);
                        (vblank.checked_sub(step_lead).unwrap_or(now), step_lead)
                    }
                    _ => (frame_at, lead),
                };
                state.stats.lead_us_total += u64::from(micros(lead));
                (frame_at, Some(vblank))
            }
            // A variable refresh display shows a frame when it's presented, so frames are timed to
            // be presented a period after the one before rather than started a period apart: how
            // long they take to draw varies, and one presented early would be held back.
            None if variable_refresh && state.last_present.is_some() => {
                let target = state.last_present.map_or(now, |last| last + period);
                (
                    target
                        .checked_sub(state.expected_work(false))
                        .unwrap_or(now),
                    None,
                )
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
            Some(step) if !fold_steps && step + MERGE < frame_at => Wake::Step,
            Some(step) if step <= merge_until => Wake::Merged,
            _ => Wake::Frame,
        };
        let wake_at = match (wake, step_due) {
            (Wake::Step, Some(step)) => step,
            (Wake::Merged, Some(step)) if !fold_steps => step.min(frame_at),
            _ => frame_at,
        };
        state.immediate_step_wakes = match wake != Wake::Frame && wake_at <= now {
            true => state.immediate_step_wakes + 1,
            false => 0,
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
        let skip_render = wake == Wake::Step && no_step_presents && can_skip_draw;
        SKIP_RENDER.set(skip_render);
        state.present_start = None;
        state.present_requested = None;
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
        self.expected_work(with_step) + margin.max(self.deadline_lead)
    }

    /// Counts a frame the statistics show composed or flipped towards deciding which the window
    /// is, changing only after several agree.
    fn note_composition(&mut self, composed: bool) {
        self.composition_votes = match composed {
            true => (self.composition_votes + 1).min(COMPOSITION_VOTES),
            false => (self.composition_votes - 1).max(-COMPOSITION_VOTES),
        };
        let now_composed = match self.composition_votes {
            COMPOSITION_VOTES => true,
            votes if votes == -COMPOSITION_VOTES => false,
            _ => self.composed,
        };
        if now_composed != self.composed {
            self.composed = now_composed;
            self.next_frame = None;
            self.last_vblank = None;
            info!(
                "Frame pacing: the game window is {}",
                match now_composed {
                    true => "composed by the desktop window manager, leaving frames to SC:R's cap",
                    false => "flipped to the display, pacing frames",
                }
            );
        }
    }

    /// Learns from a frame the display showed when it was shown relative to the blank it was
    /// timed for.
    fn note_shown(&mut self, shown: present_stats::Shown) {
        // The statistics give the time the frame was flipped to the display, which is a blank,
        // or when the desktop window manager composed it, after which it's shown at the next
        // blank. With the blanks measured, either comes out as the blank it was shown at.
        let shown_at = VBLANK
            .get()
            .and_then(|clock| clock.fit(shown.shown))
            .map_or(shown.shown, |fit| {
                fit.next_after(
                    shown
                        .shown
                        .checked_sub(BLANK_TOLERANCE)
                        .unwrap_or(shown.shown),
                )
            });
        if matches!(&self.plan, Some(Some(plan)) if plan.synced) {
            self.note_composition(
                shown_at.saturating_duration_since(shown.shown) > BLANK_TOLERANCE,
            );
        }
        let after = shown_at.saturating_duration_since(shown.presented);
        let stats = &mut self.stats;
        stats.shown += 1;
        if stats.shown_after_us.len() < 8192 {
            stats.shown_after_us.push(micros(after));
        }
        let period = match &self.plan {
            Some(Some(plan)) if plan.synced => plan.period,
            _ => return,
        };
        // Only a frame presented before its blank says anything about when it had to be: one
        // presented after it was late however the display works.
        let Some(timed_for) = shown.timed_for else {
            return;
        };
        let Some(ahead) = timed_for.checked_duration_since(shown.presented) else {
            return;
        };
        if shown_at > timed_for + period / 2 {
            stats.missed_deadlines += 1;
            self.deadline_lead = self
                .deadline_lead
                .max(ahead + DEADLINE_STEP)
                .min(period * 3 / 4);
        } else {
            self.deadline_lead = self.deadline_lead.saturating_sub(DEADLINE_DECAY);
        }
        stats.deadline_lead_us_max = stats.deadline_lead_us_max.max(micros(self.deadline_lead));
    }

    /// How long the next frame's iteration is expected to take to present it, `with_step` if it
    /// will run a logic step: longer than most recent ones took.
    fn expected_work(&self, with_step: bool) -> Duration {
        let samples = match &self.work_us {
            [_, stepped] if with_step && !stepped.is_empty() => stepped,
            [plain, _] => plain,
        };
        if samples.is_empty() {
            return Duration::from_millis(2);
        }
        let mut work: Vec<u32> = samples.iter().copied().collect();
        work.sort_unstable();
        let p90 = work[(work.len() - 1) * 9 / 10];
        Duration::from_micros(u64::from(p90))
    }
}

/// Records how long the frame the iteration drew took, once it ends.
fn finish_frame() {
    let mut state = STATE.lock();
    let present_start = state.present_start.take();
    let present_requested = state.present_requested.take();
    let (Some(frame), Some(end)) = (state.frame.take(), state.frame_end.take()) else {
        return;
    };
    let presenting = present_start.map_or(0, |start| micros(end.saturating_duration_since(start)));
    // An iteration that ran long for a reason of its own (the window being dragged, which runs
    // inside its pump) counts as no worse than two frames, so it doesn't have every frame after it
    // start as early as it could.
    let ceiling = match &state.plan {
        Some(Some(plan)) => micros(plan.period * 2),
        _ => u32::MAX,
    };
    let samples = &mut state.work_us[usize::from(frame.ran_step)];
    if samples.len() == WORK_SAMPLES {
        samples.pop_front();
    }
    // Up to when SC:R went to present it: a present held back to keep presents a refresh apart
    // isn't the frame taking longer.
    let work = present_requested
        .unwrap_or(end)
        .saturating_duration_since(frame.woke);
    samples.push_back(micros(work).min(ceiling));
    if let Some(vblank) = frame.vblank {
        // Whether it made its blank depends on when it was handed to DXGI; `swap_buffers` goes on
        // to wait for an earlier frame's GPU work after presenting.
        let presented = present_start.unwrap_or(end);
        let slack = match vblank.checked_duration_since(presented) {
            Some(early) => i32::try_from(early.as_micros()).unwrap_or(i32::MAX),
            None => -i32::try_from((presented - vblank).as_micros()).unwrap_or(i32::MAX),
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
    if !IN_OWN_DRAW.get() {
        return;
    }
    let mut state = STATE.lock();
    state.present_requested = Some(Instant::now());
    let gate = match &state.plan {
        Some(Some(plan)) => plan.min_present_interval,
        _ => None,
    };
    if let (Some(gate), Some(last)) = (gate, state.last_present) {
        let at = last + gate;
        let now = Instant::now();
        if at > now {
            drop(state);
            wait_until(at);
            state = STATE.lock();
            state.stats.held_presents += 1;
            state.stats.held_present_us_total += u64::from(micros(at - now));
        }
    }
    let now = Instant::now();
    state.present_start = Some(now);
    state.last_present = Some(now);
}

/// SC:R presented a frame.
pub fn frame_presented() {
    if !IN_OWN_DRAW.get() {
        return;
    }
    let mut state = STATE.lock();
    state.frame_end = Some(Instant::now());
    let timed_for = state.frame.and_then(|frame| frame.vblank);
    if let Some(presented) = state.present_start
        && let Some(shown) = present_stats::after_present(presented, timed_for)
    {
        state.note_shown(shown);
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
    let variable_refresh = mode == Mode::VariableRefresh;
    let mut min_present_interval = None;
    let (rate, synced) = match mode {
        Mode::Off => return None,
        Mode::Display => (display_rate(), true),
        // A variable refresh display can't show a frame that comes sooner than its top rate allows
        // (it waits, or tears), so stay a little under it, and hold presents a refresh apart.
        Mode::VariableRefresh => {
            let rate = display_rate();
            min_present_interval = Some(Duration::from_secs_f64(1.01 / rate));
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
        if vsync || variable_refresh {
            ", steps don't present frames of their own"
        } else {
            ""
        }
    );
    Some(Plan {
        period,
        synced,
        vsync,
        variable_refresh,
        min_present_interval,
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
        if IN_OWN_DRAW.get() && is_pacing() {
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
    let state = STATE.lock();
    matches!(state.plan, Some(Some(_))) && !state.composed
}

/// Whether SC:R's present in progress should flip at the next blank rather than tear in: a frame
/// pacing timed for that blank, which arrives just before it.
pub fn presents_without_tearing() -> bool {
    if !IN_OWN_DRAW.get() {
        return false;
    }
    let state = STATE.lock();
    !state.composed && state.frame.is_some_and(|frame| frame.vblank.is_some())
}

/// The in-game loop drawing the frame of an iteration pacing woke, until dropped. Other draws
/// (the loops that keep the game drawing while it waits on the network, which run inside the
/// logic step, modal dialogs, and iterations nested in the pump) aren't paced, so SC:R's frame cap
/// still holds them back and they don't count as the iteration's frame.
pub struct OwnDraw {
    skip: bool,
}

impl OwnDraw {
    /// Whether the iteration skips drawing, a step having woken it while what it would present
    /// has to wait for the frame timed for the display.
    pub fn skips(&self) -> bool {
        self.skip
    }
}

impl Drop for OwnDraw {
    fn drop(&mut self) {
        IN_OWN_DRAW.set(false);
    }
}

/// Starts a `render_screen` call that `main_loop_draw` says looks like the in-game loop's own draw,
/// returning a value to hold until it returns if it is. Only the first such call outside the logic
/// step in an outermost iteration is.
pub fn own_draw(main_loop_draw: bool) -> Option<OwnDraw> {
    if !main_loop_draw || LOOP_DEPTH.get() != 1 || IN_STEP_LOGIC.get() || IN_OWN_DRAW.get() {
        return None;
    }
    IN_OWN_DRAW.set(true);
    let skip = SKIP_RENDER.replace(false);
    if skip {
        STATE.lock().stats.skipped_renders += 1;
    }
    Some(OwnDraw { skip })
}

/// Whether a `Sleep` for `millis` is SC:R's frame cap holding back a paced frame, which the caller
/// should then skip.
pub fn skip_sleep(millis: u32) -> bool {
    // Every thread's `Sleep` comes through here, including loader worker threads that have no
    // thread-local storage to read.
    if !crate::windows::thread_has_tls() || !IN_CAP_WINDOW.get() {
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
            stats.shown_after_us.sort_unstable();
            let reads = present_stats::take_reads();
            let shown = match stats.shown {
                0 if reads.ok + reads.disjoint + reads.failed == 0 => String::new(),
                count => format!(
                    "; {:.1} frames/s shown, presented to shown p50 {:.2} ms p90 {:.2} ms, {} shown                      after the blank they were presented in time for, deadline lead max {:.2} ms                      (statistics {reads:?})",
                    per_sec(count),
                    quantile(&stats.shown_after_us, 0.5),
                    quantile(&stats.shown_after_us, 0.9),
                    stats.missed_deadlines,
                    ms(f64::from(stats.deadline_lead_us_max)),
                ),
            };
            format!(
                "paced at {:.1} fps: {} frame / {} step / {} merged wakes, {} renders skipped, \
                 oversleep avg {:.3} ms max {:.3} ms (timer {:.3} ms), waiting {:.0}% of the \
                 time, {} cap sleeps skipped ({} ms), {} presents held avg {:.2} ms{synced}{shown}",
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
                stats.held_presents,
                ms(stats.held_present_us_total as f64) / f64::from(stats.held_presents.max(1)),
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
    state.last_step_tick = None;
    state.immediate_step_wakes = 0;
    state.frame = None;
    state.present_start = None;
    state.last_present = None;
    state.present_requested = None;
    state.frame_end = None;
    state.work_us = Default::default();
    state.deadline_lead = Duration::ZERO;
    state.composed = false;
    state.composition_votes = 0;
    state.stats = Stats::new();
}
