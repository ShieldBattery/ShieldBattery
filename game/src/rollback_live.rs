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
use std::time::Duration;

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

/// Environment variable that turns native sync (0x37) off without arming rollback, with
/// `SB_ROLLBACK_NATIVE_SYNC_OFF=1`. Every client in a game has to agree on it: a client with it on
/// stops sending sync commands, which one with it off drops it for.
const NATIVE_SYNC_OFF_ENV_VAR: &str = "SB_ROLLBACK_NATIVE_SYNC_OFF";

/// A frame at the Fastest game speed.
const FRAME_DURATION: Duration = Duration::from_micros(41_667);

/// How many ticks go between the summaries logged.
const SUMMARY_TICKS: u32 = 720;

/// The debug knobs, as read from the environment.
struct Settings {
    /// Steps a step may run past the newest one whose turns are all known.
    limit: u32,
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
    let settings = Settings {
        limit: limit.unwrap_or(0),
        shadow_depth: shadow_depth.unwrap_or(0),
        held,
        monkey_interval,
    };
    info!(
        "Live rollback armed with native sync off: prediction limit {}, shadow depth {}, turns \
         held back {:?}, monkey every {} frames",
        settings.limit, settings.shadow_depth, settings.held, settings.monkey_interval,
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
    Some(InputTable::new(settings.limit, settings.held))
}

/// Forgets per-game state. Called when the game loop (re-)enters game init.
pub fn reset_for_game_init() {
    *SUMMARY.lock() = None;
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
        let spacing = SPACING.load(Ordering::Relaxed);
        let current = bw.probe_frame_count()?;
        // What the turn state's receive will be given for the step from `current`: the turn
        // counter reads one past the frame count while the step takes its turns.
        let next_frame = current + 1;
        if monkey_interval != 0 && current.is_multiple_of(monkey_interval) {
            bw.rollback_issue_random_commands(next_random);
        }
        let (target, known_until, can_run) = netcode_v2::with_turn_state(|s| {
            let target = s.take_rollback_target(next_frame);
            (target, s.known_until(), s.can_run(next_frame))
        })?;
        // A turn state without an input table is one that started before rollback was armed.
        let known_until = known_until?;

        let mut guard = SNAPSHOTS.lock();
        if guard.is_none() {
            *guard = Snapshots::build(bw);
        }
        let snapshots = guard.as_mut()?;
        if let (Some(target), Some(oldest)) = (target, snapshots.oldest_frame())
            && target < oldest
        {
            // The ring only drops snapshots from before the newest known step, so a turn that
            // contradicts a prediction can only be for a step after the oldest snapshot.
            error!(
                "Live rollback asked to re-simulate from frame {target}, but the oldest snapshot \
                 is of frame {oldest}; this client will diverge"
            );
        }
        let present = current + 1;
        // While the present step cannot run, the step it stalls in polls for turns again and
        // again, and rolling back ahead of every poll would only burn time.
        let forced =
            (shadow_depth != 0 && can_run).then(|| present.saturating_sub(shadow_depth + 1));
        let rollback_to = [target, forced].into_iter().flatten().min();
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
         ahead of known turns by {:.2} frames on average (at most {}), {} ticks at the limit; per \
         tick restore {:.2} ms, snapshot {:.2} ms, steps {:.2} ms (worst {:.1} ms)",
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
