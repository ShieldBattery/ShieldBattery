//! Drives the rollback engine ([`crate::rollback`]) inside live netcode v2 games.
//!
//! The turn state keeps every slot's turns by step in an [`InputTable`] and runs a step whose
//! remote turns have not all arrived with a no-op standing in for each missing one, up to a limit
//! of steps past the newest step whose turns are all known. Every tick asks the turn state which
//! step, if any, ran on a prediction that an arrived turn has since contradicted (or ran without a
//! leave that has since become due), restores the newest snapshot from before it, and simulates
//! forward to the present again. Steps that are simulated again take their turns from the same
//! table and send nothing.
//!
//! Debug knobs, all read once at startup:
//!
//! - `SB_ROLLBACK_PREDICT=<limit>` runs up to `limit` steps ahead of the known turns. 0 predicts
//!   nothing and waits for every turn, like lockstep.
//! - `SB_ROLLBACK_TARGET=<frames>` is the rollback this client takes on in place of input delay
//!   (3 unless set, and never more than the limit): it runs that many frames ahead of the
//!   lockstep schedule and keeps that many fewer of its own turns in flight. See
//!   [`TurnState::lead`](netcode_v2::TurnState::lead).
//! - `SB_ROLLBACK_MIN_BUFFER=<turns>` acts as if the relay asked for a latency buffer of at least
//!   that many turns, which a relay only does for slower links than a test machine's.
//! - `SB_ROLLBACK_SHADOW=<depth>` additionally rolls back at least `depth` steps every tick,
//!   whether anything was mispredicted or not, to exercise re-simulation constantly.
//! - `SB_ROLLBACK_LIVE_DELAY=<storm id>:<frames>,...` holds back the turns of the given slots for
//!   that many frames' worth of time after they arrive, as if their link were that much slower.
//! - `SB_ROLLBACK_MONKEY=<actions per minute>` selects random units of the local player and
//!   right-clicks random map positions with them, so a game can be tested without anyone playing.
//!
//! Arming any of the first two turns native sync (0x37) off for this client. Every client in the
//! game has to agree on that, so a plain client in the same game needs
//! `SB_ROLLBACK_NATIVE_SYNC_OFF=1`.
//!
//! Compiled out of release DLLs along with the engine it drives.

use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};
use std::time::{Duration, Instant};

use parking_lot::Mutex;

use crate::bw;
use crate::bw_scr::BwScr;
use crate::game_thread;
use crate::netcode_v2::{self, InputCounts, InputTable};
use crate::rollback::snapshot::{SNAPSHOTS, Snapshots};
use crate::rollback::sounds;
use crate::rollback::tick::{self, TickPlan};

const PREDICT_ENV_VAR: &str = "SB_ROLLBACK_PREDICT";
const SHADOW_ENV_VAR: &str = "SB_ROLLBACK_SHADOW";
const DELAY_ENV_VAR: &str = "SB_ROLLBACK_LIVE_DELAY";
const MONKEY_ENV_VAR: &str = "SB_ROLLBACK_MONKEY";
const TARGET_ENV_VAR: &str = "SB_ROLLBACK_TARGET";
const MIN_BUFFER_ENV_VAR: &str = "SB_ROLLBACK_MIN_BUFFER";

/// The rollback target when the environment doesn't set one.
const DEFAULT_ROLLBACK_TARGET: u32 = 3;

/// How many steps at the start of a game run in lockstep, lining the clients' simulations up
/// before each keeps its own schedule: one second.
const LOCKSTEP_START_STEPS: u32 = 24;

/// The most frames a tick steps beyond the one it would anyway, when the simulation has fallen
/// behind its schedule.
const MAX_CATCH_UP_PER_TICK: u32 = 2;

/// Environment variable that turns native sync (0x37) off without arming rollback, with
/// `SB_ROLLBACK_NATIVE_SYNC_OFF=1`. Every client in a game has to agree on it: a client with it on
/// stops sending sync commands, which one with it off drops it for.
const NATIVE_SYNC_OFF_ENV_VAR: &str = "SB_ROLLBACK_NATIVE_SYNC_OFF";

/// The game loop's interval between logic steps at the Fastest game speed.
const FRAME_DURATION: Duration = Duration::from_millis(42);

/// How many ticks go between the summaries logged.
const SUMMARY_TICKS: u32 = 720;

/// The debug knobs, as read from the environment.
struct Settings {
    /// Steps a step may run past the newest one whose turns are all known.
    limit: u32,
    /// Frames of lateness to absorb by rolling back rather than with input delay.
    rollback_target: u32,
    /// The latency buffer to act as if the relay asked for at least.
    min_buffer_turns: u32,
    /// Steps every tick rolls back at least, or 0.
    shadow_depth: u32,
    /// How long each storm slot's turns are held back after they arrive.
    held: [Duration; bw::MAX_STORM_PLAYERS],
    /// Frames between the monkey's commands, or 0 for no monkey.
    monkey_interval: u32,
}

static SETTINGS: Mutex<Option<Settings>> = Mutex::new(None);

/// Whether rollback is armed for live games.
static ARMED: AtomicBool = AtomicBool::new(false);

/// Frames between snapshots.
static SPACING: AtomicU32 = AtomicU32::new(crate::rollback_harness::DEFAULT_SNAPSHOT_SPACING);

/// Whether native sync is off for this client.
static NATIVE_SYNC_OFF: AtomicBool = AtomicBool::new(false);

/// State of the monkey's random number generator (xorshift32, never 0).
static MONKEY_RANDOM: AtomicU32 = AtomicU32::new(0);

/// The schedule the simulation keeps to, one step every [`FRAME_DURATION`]: the tick that starts
/// `k` frame durations after `start` steps from frame `frame + k`. Set by the tick that runs the
/// first step after the game's lockstep start, which kept every client's simulation in step with
/// the others' until then.
struct Schedule {
    frame: u32,
    /// Half a frame before the start of the tick that ran the first step. The game loop starts its
    /// ticks at slightly varying times after each frame's due time, and measuring from half a frame
    /// early keeps any variation under half a frame from moving a tick onto another frame.
    start: Instant,
}

impl Schedule {
    fn new(frame: u32, tick_start: Instant) -> Schedule {
        Schedule {
            frame,
            start: tick_start
                .checked_sub(FRAME_DURATION / 2)
                .unwrap_or(tick_start),
        }
    }

    /// The frame count a tick that starts at `tick_start` should end on, running `lead` frames
    /// ahead of the schedule.
    fn target(&self, tick_start: Instant, lead: u32) -> u32 {
        let elapsed = tick_start.saturating_duration_since(self.start);
        let frames = elapsed.as_micros() / FRAME_DURATION.as_micros();
        self.frame
            .saturating_add(frames.min(u32::MAX as u128) as u32)
            .saturating_add(1 + lead)
    }
}

static SCHEDULE: Mutex<Option<Schedule>> = Mutex::new(None);

/// What the ticks since the last summary did.
#[derive(Default)]
struct Summary {
    ticks: u32,
    rollbacks: u32,
    resimulated: u32,
    /// The most steps any tick simulated again.
    deepest: u32,
    /// Summed over ticks, how many steps the present was past the newest known step.
    predicted_depth: u64,
    deepest_prediction: u32,
    /// Ticks whose present step could not run because it was too far ahead of the known turns.
    capped: u32,
    /// Frames stepped to catch up with the schedule.
    caught_up: u32,
    /// Ticks after which the next step was put off because the simulation was ahead of its
    /// schedule.
    held_back: u32,
    /// The lead in force at the end of the stretch.
    lead: u32,
    /// The pipe depth in force at the end of the stretch.
    pipe_depth: u32,
    inputs: InputCounts,
    restore: Duration,
    snapshot: Duration,
    steps: Duration,
    worst_steps: Duration,
}

static SUMMARY: Mutex<Option<Summary>> = Mutex::new(None);

/// Arms rollback in live games if the environment asks for it. Called once while the DLL
/// initialises, before the game thread exists.
pub fn init_from_env() {
    if std::env::var(NATIVE_SYNC_OFF_ENV_VAR).as_deref() == Ok("1") {
        NATIVE_SYNC_OFF.store(true, Ordering::Release);
        info!("{NATIVE_SYNC_OFF_ENV_VAR}=1: native sync commands will be neither sent nor checked");
    }
    let limit = read_count(PREDICT_ENV_VAR);
    let shadow_depth = read_count(SHADOW_ENV_VAR);
    let rollback_target = read_count(TARGET_ENV_VAR);
    if limit.is_none() && shadow_depth.is_none() {
        return;
    }
    let mut held = [Duration::ZERO; bw::MAX_STORM_PLAYERS];
    if let Ok(spec) = std::env::var(DELAY_ENV_VAR) {
        for entry in spec.split(',').filter(|x| !x.is_empty()) {
            let parsed = entry.split_once(':').and_then(|(storm, steps)| {
                Some((storm.parse::<usize>().ok()?, steps.parse().ok()?))
            });
            match parsed {
                Some((storm, frames)) if storm < bw::MAX_STORM_PLAYERS => {
                    held[storm] = FRAME_DURATION * frames;
                }
                _ => {
                    error!(
                        "{DELAY_ENV_VAR} entry {entry:?} is not <storm id>:<frames>; ignoring it"
                    )
                }
            }
        }
    }
    let monkey_interval = read_count(MONKEY_ENV_VAR)
        .filter(|&apm| apm != 0)
        // Each action is a select and a right click, and a minute is 24 * 60 frames.
        .map_or(0, |apm| (24 * 60 * 2 / apm).max(1));
    let seed = std::process::id()
        ^ std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map_or(0, |x| x.subsec_nanos());
    MONKEY_RANDOM.store(seed | 1, Ordering::Relaxed);
    let limit = limit.unwrap_or(0);
    let settings = Settings {
        limit,
        rollback_target: rollback_target
            .unwrap_or(DEFAULT_ROLLBACK_TARGET)
            .min(limit),
        min_buffer_turns: read_count(MIN_BUFFER_ENV_VAR).unwrap_or(0),
        shadow_depth: shadow_depth.unwrap_or(0),
        held,
        monkey_interval,
    };
    info!(
        "Live rollback armed with native sync off: prediction limit {}, rollback target {}, \
         minimum buffer {}, shadow depth {}, turns held back {:?}, monkey every {} frames",
        settings.limit,
        settings.rollback_target,
        settings.min_buffer_turns,
        settings.shadow_depth,
        settings.held,
        settings.monkey_interval,
    );
    *SETTINGS.lock() = Some(settings);
    ARMED.store(true, Ordering::Release);
    // Native sync hashes state that a re-simulation does not reproduce, and a predicted step would
    // hash state its peers never had.
    NATIVE_SYNC_OFF.store(true, Ordering::Release);
    if let Some(spacing) = crate::rollback_harness::snapshot_spacing_from_env() {
        SPACING.store(spacing, Ordering::Release);
    }
}

fn read_count(var: &str) -> Option<u32> {
    let spec = std::env::var(var).ok()?;
    match spec.parse::<u32>() {
        Ok(x) => Some(x),
        Err(_) => {
            error!("{var}={spec:?} is not a count; ignoring it");
            None
        }
    }
}

/// Whether live rollback is armed, which needs the snapshot's ranges resolved.
pub(crate) fn wants_ranges() -> bool {
    ARMED.load(Ordering::Acquire)
}

/// Whether native sync (0x37) is off for this client: it neither sends sync commands nor checks
/// its peers' ones, and a no-op stands in for each turn's sync command.
pub(crate) fn native_sync_off() -> bool {
    NATIVE_SYNC_OFF.load(Ordering::Acquire)
}

/// The input table a new game's turn state keeps its turns in, or `None` when live rollback is
/// not armed.
pub fn input_table() -> Option<InputTable> {
    let settings = SETTINGS.lock();
    let settings = settings.as_ref()?;
    let mut table = InputTable::new(
        settings.limit,
        settings.rollback_target,
        LOCKSTEP_START_STEPS,
        settings.held,
    );
    table.set_min_buffer_turns(settings.min_buffer_turns);
    Some(table)
}

/// Forgets per-game state. Called when the game loop (re-)enters game init.
pub fn reset_for_game_init() {
    *SUMMARY.lock() = None;
    *SCHEDULE.lock() = None;
}

/// Runs one tick of a live game that rolls back, or returns `None` to leave the tick to the replay
/// harness or a plain step: when live rollback is off, in replays, and before the game loop is
/// running a netcode v2 session.
pub unsafe fn run_game_logic_step(
    bw: &'static BwScr,
    param: usize,
    orig: unsafe extern "C" fn(usize) -> usize,
) -> Option<usize> {
    unsafe {
        if !ARMED.load(Ordering::Relaxed) || game_thread::is_replay() || !bw.has_game_started() {
            return None;
        }
        if !bw.rollback_observer_ui_hooked() {
            // Re-simulated frames would repeat the observer UI's notifications, and it
            // dereferences records a repeated notification has already consumed.
            ARMED.store(false, Ordering::Release);
            error!("Live rollback needs the observer UI hooks, which analysis could not resolve");
            return None;
        }
        let (shadow_depth, monkey_interval) = {
            let settings = SETTINGS.lock();
            let settings = settings.as_ref()?;
            (settings.shadow_depth, settings.monkey_interval)
        };
        let tick_start = Instant::now();
        let spacing = SPACING.load(Ordering::Relaxed);
        let current = bw.probe_frame_count()?;
        // What the turn state's receive will be given for the step from `current`: the turn
        // counter reads one past the frame count while the step takes its turns.
        let next_frame = current + 1;
        if monkey_interval != 0 && current.is_multiple_of(monkey_interval) {
            bw.rollback_issue_random_commands(next_random);
        }
        let (resimulate_from, known_until, can_run, lead, pipe_depth) =
            netcode_v2::with_turn_state(|s| {
                let target = s.take_rollback_target(next_frame);
                (
                    target,
                    s.known_until(),
                    s.can_run(next_frame),
                    s.lead(),
                    s.pipe_depth(),
                )
            })?;
        // A turn state without an input table is one that started before rollback was armed.
        let known_until = known_until?;

        let mut guard = SNAPSHOTS.lock();
        if guard.is_none() {
            *guard = Snapshots::build(bw);
        }
        let snapshots = guard.as_mut()?;
        if let (Some(target), Some(oldest)) = (resimulate_from, snapshots.oldest_frame())
            && target < oldest
        {
            // The ring only drops snapshots from before the newest known step, so a turn that
            // contradicts a prediction can only be for a step after the oldest snapshot.
            error!(
                "Live rollback asked to re-simulate from frame {target}, but the oldest snapshot \
                 is of frame {oldest}; this client will diverge"
            );
        }
        // A simulation that has fallen behind its schedule (a stall at the prediction limit, a
        // hitch, or a lead that just grew) steps extra frames until it is back on it, rather than
        // making anyone wait for it.
        let scheduled = SCHEDULE.lock().as_ref().map(|x| x.target(tick_start, lead));
        let catch_up = match (scheduled, can_run) {
            (Some(scheduled), true) => scheduled
                .saturating_sub(current + 1)
                .min(MAX_CATCH_UP_PER_TICK),
            _ => 0,
        };
        let present = current + 1 + catch_up;
        // While the present step cannot run, the step it stalls in polls for turns again and
        // again, and rolling back ahead of every poll would only burn time.
        let forced =
            (shadow_depth != 0 && can_run).then(|| present.saturating_sub(shadow_depth + 1));
        let rollback_to = [resimulate_from, forced].into_iter().flatten().min();
        let plan = TickPlan {
            rollback_to,
            present,
            confirmed: known_until.min(present),
            spacing,
        };
        let (ret, report) = tick::run_tick(bw, snapshots, current, &plan, |_| {
            crate::rollback_probe::run_game_logic_step(bw, param, orig)
        });
        drop(guard);
        let reached = bw.probe_frame_count().unwrap_or(current);
        let mut held_back = false;
        {
            let mut schedule = SCHEDULE.lock();
            match &*schedule {
                None if reached > current && current >= LOCKSTEP_START_STEPS => {
                    *schedule = Some(Schedule::new(current, tick_start));
                }
                // A simulation ahead of its schedule (a lead that just shrank, or a game loop
                // running its ticks early) puts its next step off by a frame at a time until the
                // schedule catches up.
                Some(x) if reached > x.target(tick_start, lead) => {
                    let delay = FRAME_DURATION.as_millis() as u32;
                    bw.probe_set_next_game_step_tick(
                        bw.probe_next_game_step_tick().wrapping_add(delay),
                    );
                    held_back = true;
                }
                _ => (),
            }
        }
        sounds::reconcile_sounds(bw, report.window_start, report.settled_through, present);
        let counts = netcode_v2::with_turn_state(|s| {
            s.forget_inputs_before(report.settled_through);
            s.take_input_counts()
        })
        .flatten()
        .unwrap_or_default();

        let mut summary = SUMMARY.lock();
        let summary = summary.get_or_insert_with(Summary::default);
        summary.ticks += 1;
        if let Some(restored) = report.restored {
            let resimulated = current.saturating_sub(restored);
            summary.rollbacks += 1;
            summary.resimulated += resimulated;
            summary.deepest = summary.deepest.max(resimulated);
        }
        let ahead = present.saturating_sub(known_until.min(present));
        summary.predicted_depth += ahead as u64;
        summary.deepest_prediction = summary.deepest_prediction.max(ahead);
        if !can_run {
            summary.capped += 1;
        }
        summary.caught_up += reached.saturating_sub(current + 1);
        if held_back {
            summary.held_back += 1;
        }
        summary.lead = lead;
        summary.pipe_depth = pipe_depth;
        summary.inputs.predicted_steps += counts.predicted_steps;
        summary.inputs.mispredicted_turns += counts.mispredicted_turns;
        summary.inputs.confirmed_predictions += counts.confirmed_predictions;
        summary.restore += report.restore_time;
        summary.snapshot += report.snapshot_time;
        summary.steps += report.step_time;
        summary.worst_steps = summary.worst_steps.max(report.step_time);
        if summary.ticks >= SUMMARY_TICKS {
            log_summary(summary, present);
            *summary = Summary::default();
        }
        Some(ret)
    }
}

fn log_summary(summary: &Summary, present: u32) {
    let per_tick = |x: Duration| x.as_secs_f64() * 1000.0 / summary.ticks as f64;
    info!(
        "Live rollback over {} ticks to frame {present}: {} steps ran predicted, {} predicted \
         turns held and {} did not; {} rollbacks re-simulated {} frames (deepest {}); present \
         ahead of known turns by {:.2} frames on average (at most {}), {} ticks at the limit; lead \
         {} frames over a pipe of {}, {} frames caught up, {} ticks held back; per tick restore \
         {:.2} ms, snapshot {:.2} ms, steps {:.2} ms (worst {:.1} ms)",
        summary.ticks,
        summary.inputs.predicted_steps,
        summary.inputs.confirmed_predictions,
        summary.inputs.mispredicted_turns,
        summary.rollbacks,
        summary.resimulated,
        summary.deepest,
        summary.predicted_depth as f64 / summary.ticks as f64,
        summary.deepest_prediction,
        summary.capped,
        summary.lead,
        summary.pipe_depth,
        summary.caught_up,
        summary.held_back,
        per_tick(summary.restore),
        per_tick(summary.snapshot),
        per_tick(summary.steps),
        summary.worst_steps.as_secs_f64() * 1000.0,
    );
}

/// The monkey's next random number.
fn next_random() -> u32 {
    let mut x = MONKEY_RANDOM.load(Ordering::Relaxed);
    x ^= x << 13;
    x ^= x >> 17;
    x ^= x << 5;
    MONKEY_RANDOM.store(x, Ordering::Relaxed);
    x
}
