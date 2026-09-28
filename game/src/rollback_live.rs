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
//! A game rolls back when its netcode v2 session does, which the server decides for every client
//! in the session alike ([`arm_for_session`]). Such a game sends no native sync commands; it reports
//! hashes of confirmed positions for the relay to compare instead ([`hash_reports`]).
//!
//! Debug knobs, all read once at startup, which tune a game that rolls back:
//!
//! - `SB_ROLLBACK_PREDICT=<limit>` runs up to `limit` steps ahead of the known turns (8 unless
//!   set). 0 predicts nothing and waits for every turn, like lockstep.
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
//! - `SB_ROLLBACK_WITHHOLD_HASHES_FROM=<position>` sends no state hash reports from that position
//!   on while playing on, as a client hiding its state would, for the relay to name.
//!
//! Compiled out of release DLLs along with the engine it drives, so a release DLL refuses a session
//! that rolls back.

use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};
use std::time::{Duration, Instant};

use parking_lot::Mutex;

use crate::bw::{self, Bw};
use crate::bw_scr::BwScr;
use crate::game_thread;
use crate::netcode_v2::{self, InputCounts, InputTable};
use crate::rollback::snapshot::{SNAPSHOTS, Snapshots};
use crate::rollback::tick::{self, TickPlan};
use crate::rollback::{game_end, hash_reports, sounds};

const PREDICT_ENV_VAR: &str = "SB_ROLLBACK_PREDICT";
const SHADOW_ENV_VAR: &str = "SB_ROLLBACK_SHADOW";
const DELAY_ENV_VAR: &str = "SB_ROLLBACK_LIVE_DELAY";
const MONKEY_ENV_VAR: &str = "SB_ROLLBACK_MONKEY";
const WITHHOLD_HASHES_ENV_VAR: &str = "SB_ROLLBACK_WITHHOLD_HASHES_FROM";
const TARGET_ENV_VAR: &str = "SB_ROLLBACK_TARGET";
const MIN_BUFFER_ENV_VAR: &str = "SB_ROLLBACK_MIN_BUFFER";

/// The prediction limit when the environment doesn't set one.
const DEFAULT_PREDICTION_LIMIT: u32 = 8;

/// The rollback target when the environment doesn't set one.
const DEFAULT_ROLLBACK_TARGET: u32 = 3;

/// How many steps at the start of a game run in lockstep, lining the clients' simulations up
/// before each keeps its own schedule: one second.
const LOCKSTEP_START_STEPS: u32 = 24;

/// The most frames a tick steps beyond the one it would anyway, when the simulation has fallen
/// behind its schedule.
const MAX_CATCH_UP_PER_TICK: u32 = 2;

/// The game loop's interval between logic steps at the Fastest game speed.
const FRAME_DURATION: Duration = Duration::from_millis(42);

/// How many ticks go between the summaries logged.
const SUMMARY_TICKS: u32 = 720;

/// How a game that rolls back runs: the defaults, with whatever the debug knobs change.
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
    /// The first position whose state hash report is not sent.
    withhold_hashes_from: u32,
}

static SETTINGS: Mutex<Option<Settings>> = Mutex::new(None);

/// Whether the current game rolls back.
static ARMED: AtomicBool = AtomicBool::new(false);

/// Frames between snapshots.
static SPACING: AtomicU32 = AtomicU32::new(crate::rollback_harness::DEFAULT_SNAPSHOT_SPACING);

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

    /// The position a tick that starts at `tick_start` should end on, running `lead` frames ahead
    /// of the schedule (behind it when negative).
    fn target(&self, tick_start: Instant, lead: i32) -> u32 {
        let elapsed = tick_start.saturating_duration_since(self.start);
        let frames = (elapsed.as_micros() / FRAME_DURATION.as_micros()).min(u32::MAX as u128);
        let target = self.frame as i64 + frames as i64 + 1 + lead as i64;
        target.clamp(0, u32::MAX as i64) as u32
    }
}

static SCHEDULE: Mutex<Option<Schedule>> = Mutex::new(None);

/// The rollback this client runs, smoothed over about two seconds of ticks, for the latency
/// readout.
static SMOOTHED_ROLLBACK: Mutex<f32> = Mutex::new(0.0);

/// The rollback the latency readout shows: the frames this client runs past the newest step whose
/// turns are all known, smoothed so that a burst doesn't make the number flicker.
pub fn shown_rollback() -> u32 {
    SMOOTHED_ROLLBACK.lock().round() as u32
}

/// How many ticks the rollback a client runs has to stay clear of its target, all one way, before
/// the client moves its lead: two seconds. A burst of lateness shorter than that is rolled back
/// over, up to the prediction limit, and the lead only follows lateness that holds.
const LEAD_WINDOW_TICKS: usize = 48;

/// The lowest and highest rollback the ticks since the lead last moved ran with.
struct LeadWindow {
    ticks: usize,
    lowest: u32,
    highest: u32,
    /// The newest step whose turns were all known as of the last tick noted.
    known_until: u32,
}

static LEAD_WINDOW: Mutex<LeadWindow> = Mutex::new(LeadWindow {
    ticks: 0,
    lowest: u32::MAX,
    highest: 0,
    known_until: 0,
});

/// Notes the rollback a tick ran with, `ahead` frames past `known_until`, the newest step whose
/// turns were all known, and returns how far to move the lead once a whole window has stayed above
/// `target` (down by the smallest excess) or below it (up by the smallest shortfall).
///
/// Only ticks by which more turns became known count. The lead follows how late turns arrive, and
/// while none arrive at all (a peer that stopped sending, or a lost link) the rollback just sits at
/// the prediction limit, which says nothing about lateness: following it would pile input delay on
/// for when turns resume.
fn lead_adjustment(ahead: u32, known_until: u32, target: u32) -> i32 {
    let mut window = LEAD_WINDOW.lock();
    if known_until <= window.known_until {
        return 0;
    }
    window.known_until = known_until;
    window.ticks += 1;
    window.lowest = window.lowest.min(ahead);
    window.highest = window.highest.max(ahead);
    if window.ticks < LEAD_WINDOW_TICKS {
        return 0;
    }
    let adjustment = if window.lowest > target {
        -((window.lowest - target) as i32)
    } else if window.highest < target {
        (target - window.highest) as i32
    } else {
        0
    };
    *window = LeadWindow {
        ticks: 0,
        lowest: u32::MAX,
        highest: 0,
        known_until,
    };
    adjustment
}

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
    lead: i32,
    /// The pipe depth in force at the end of the stretch.
    pipe_depth: u32,
    inputs: InputCounts,
    restore: Duration,
    snapshot: Duration,
    steps: Duration,
    worst_steps: Duration,
}

static SUMMARY: Mutex<Option<Summary>> = Mutex::new(None);

/// Reads the debug knobs. Called once while the DLL initialises, before the game thread exists.
pub fn init_from_env() {
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
    let limit = read_count(PREDICT_ENV_VAR).unwrap_or(DEFAULT_PREDICTION_LIMIT);
    let settings = Settings {
        limit,
        rollback_target: read_count(TARGET_ENV_VAR)
            .unwrap_or(DEFAULT_ROLLBACK_TARGET)
            .min(limit),
        min_buffer_turns: read_count(MIN_BUFFER_ENV_VAR).unwrap_or(0),
        shadow_depth: read_count(SHADOW_ENV_VAR).unwrap_or(0),
        held,
        monkey_interval,
        withhold_hashes_from: read_count(WITHHOLD_HASHES_ENV_VAR).unwrap_or(u32::MAX),
    };
    *SETTINGS.lock() = Some(settings);
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

/// Whether native sync (0x37) is off for this client: it neither sends sync commands nor checks
/// its peers' ones, and a no-op stands in for each turn's sync command. Off exactly in a game that
/// rolls back, since native sync hashes state that a re-simulation does not reproduce, and a
/// predicted step would hash state its peers never had.
pub(crate) fn native_sync_off() -> bool {
    ARMED.load(Ordering::Acquire)
}

/// Whether this DLL can run a game that rolls back: analysis resolved what the engine snapshots,
/// and the observer UI hooks that keep re-simulated frames from repeating the observer UI's
/// notifications, which dereference records a repeated notification has already consumed.
pub fn supported() -> bool {
    let bw = crate::bw::get_bw();
    !bw.rollback_range_specs().is_empty() && bw.rollback_observer_ui_hooked()
}

/// Sets whether the game about to start rolls back, as its session says, and returns the input
/// table its turn state keeps its turns in when it does. The server tells every client in the
/// session the same, which matters because a game that rolls back turns native sync off.
pub fn arm_for_session(rollback: bool) -> Option<InputTable> {
    ARMED.store(rollback, Ordering::Release);
    if !rollback {
        return None;
    }
    let settings = SETTINGS.lock();
    let settings = settings.as_ref()?;
    info!(
        "This game rolls back, with native sync off: prediction limit {}, rollback target {}, \
         minimum buffer {}, shadow depth {}, turns held back {:?}, monkey every {} frames, \
         hash reports withheld from position {}",
        settings.limit,
        settings.rollback_target,
        settings.min_buffer_turns,
        settings.shadow_depth,
        settings.held,
        settings.monkey_interval,
        settings.withhold_hashes_from,
    );
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
    *SMOOTHED_ROLLBACK.lock() = 0.0;
    *LEAD_WINDOW.lock() = LeadWindow {
        ticks: 0,
        lowest: u32::MAX,
        highest: 0,
        known_until: 0,
    };
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
        let (shadow_depth, monkey_interval, rollback_target, withhold_hashes_from) = {
            let settings = SETTINGS.lock();
            let settings = settings.as_ref()?;
            (
                settings.shadow_depth,
                settings.monkey_interval,
                settings.rollback_target,
                settings.withhold_hashes_from,
            )
        };
        let tick_start = Instant::now();
        let spacing = SPACING.load(Ordering::Relaxed);
        // Positions on the rollback timeline are turns, which a paused game keeps taking without
        // advancing frames; see `rollback::count_turns`.
        crate::rollback::count_turns(true);
        let current = crate::rollback::position(bw)?;
        // What the turn state's receive will be given for the step from `current`: BW's turn
        // counter, which reads one past the turns dispatched while a step takes its turns.
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
        let (ret, report) = tick::run_tick(bw, snapshots, current, &plan, |step| {
            let ret = crate::rollback_probe::run_game_logic_step(bw, param, orig);
            let game = bw.game();
            if !game.is_null() {
                game_end::record_outcome(
                    step.frame,
                    game_end::Outcome {
                        victory_state: (*game).victory_state,
                        alliances: (*game).alliances,
                        player_was_dropped: (*game).player_was_dropped,
                    },
                );
            }
            if hash_reports::is_report_position(step.frame)
                && let Some(fingerprint) = bw.probe_fingerprint()
            {
                hash_reports::record(step.frame, fingerprint.state_hash);
            }
            ret
        });
        drop(guard);
        let reached = crate::rollback::position(bw).unwrap_or(current);
        // The rollback this client runs: how far the frame it now shows is past the newest frame
        // whose turns are all known. A tick stalled at the prediction limit shows the frame it was
        // already on, exactly the limit past them.
        let ahead = reached.saturating_sub(known_until);
        if current >= LOCKSTEP_START_STEPS {
            {
                let mut smoothed = SMOOTHED_ROLLBACK.lock();
                *smoothed += (ahead as f32 - *smoothed) / LEAD_WINDOW_TICKS as f32;
            }
            let adjustment = lead_adjustment(ahead, known_until, rollback_target);
            if adjustment != 0 {
                netcode_v2::with_turn_state(|s| s.adjust_lead(adjustment));
            }
        }
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
        game_end::confirm_outcomes_through(plan.confirmed);
        let reports = hash_reports::take_confirmed(plan.confirmed);
        if !reports.is_empty() {
            netcode_v2::with_turn_state(|s| {
                for &(position, hash) in &reports {
                    if position < withhold_hashes_from {
                        s.queue_state_hash(position, hash);
                    }
                }
            });
        }
        if let Some(dialog) = game_end::take_confirmed(plan.confirmed) {
            info!(
                "Opening the {dialog:?} dialog a step asked for, now that frames through {} are \
                 confirmed",
                plan.confirmed
            );
            bw.rollback_open_mission_dialog(dialog);
        }
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
        "Live rollback over {} ticks to turn {present}: {} steps ran predicted, {} predicted \
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
