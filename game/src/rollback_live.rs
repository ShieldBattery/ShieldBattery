//! Drives the rollback engine ([`crate::rollback`]) inside live netcode v2 games without
//! predicting anything: every tick restores a snapshot from a few frames back and re-simulates
//! those frames with the turns they were first simulated with, then steps the present frame as the
//! game would have anyway.
//!
//! Since every input is already known, a correct re-simulation changes nothing, and the game plays
//! on in step with its peers. What it proves is that the live game's per-step machinery survives
//! being run again: the re-simulated steps take their turns from the turn state's dispatch history
//! instead of the network, send nothing, and leave the turn state's counters alone, and the replay
//! recorder rewinds with the simulation. State a re-simulation gets wrong shows up as this client
//! diverging from its peers, which native sync and the rollback probe's state hashes both catch.
//!
//! Compiled out of release DLLs along with the engine it drives.

use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};
use std::time::Duration;

use parking_lot::Mutex;

use crate::bw_scr::BwScr;
use crate::game_thread;
use crate::netcode_v2;
use crate::rollback::snapshot::{SNAPSHOTS, Snapshots};
use crate::rollback::sounds;
use crate::rollback::tick::{self, TickPlan};

/// Environment variable that arms shadow rollback in live games, holding the number of frames every
/// tick re-simulates: with `SB_ROLLBACK_SHADOW=3` each tick goes back at least three frames.
const ENV_VAR: &str = "SB_ROLLBACK_SHADOW";

/// Environment variable that turns native sync (0x37) off without arming shadow rollback, with
/// `SB_ROLLBACK_NATIVE_SYNC_OFF=1`. Every client in a game has to agree on it: a client with it on
/// stops sending sync commands, which one with it off drops it for. Shadow rollback turns it on by
/// itself, so a game pairing a shadow client with a plain one needs it on the plain one.
const NATIVE_SYNC_OFF_ENV_VAR: &str = "SB_ROLLBACK_NATIVE_SYNC_OFF";

/// Frames of dispatched turns the turn state keeps beyond the depth and snapshot spacing, so a
/// rollback never reaches a frame whose turns have been forgotten.
const DISPATCH_HISTORY_MARGIN: u32 = 64;

/// How many ticks go between the timing summaries logged.
const SUMMARY_TICKS: u32 = 2400;

/// Frames every tick re-simulates, or 0 when shadow rollback is off.
static DEPTH: AtomicU32 = AtomicU32::new(0);

/// Frames between snapshots.
static SPACING: AtomicU32 = AtomicU32::new(crate::rollback_harness::DEFAULT_SNAPSHOT_SPACING);

/// Whether native sync is off for this client.
static NATIVE_SYNC_OFF: AtomicBool = AtomicBool::new(false);

/// Whether the turn state has been asked to keep the dispatch history re-simulations read from.
static HISTORY_REQUESTED: AtomicBool = AtomicBool::new(false);

/// Timing of the ticks since the last summary.
struct Summary {
    ticks: u32,
    rollbacks: u32,
    resimulated: u32,
    restore: Duration,
    snapshot: Duration,
    steps: Duration,
    worst_steps: Duration,
}

static SUMMARY: Mutex<Summary> = Mutex::new(Summary {
    ticks: 0,
    rollbacks: 0,
    resimulated: 0,
    restore: Duration::ZERO,
    snapshot: Duration::ZERO,
    steps: Duration::ZERO,
    worst_steps: Duration::ZERO,
});

/// Arms shadow rollback if the environment asks for it. Called once while the DLL initialises,
/// before the game thread exists.
pub fn init_from_env() {
    if std::env::var(NATIVE_SYNC_OFF_ENV_VAR).as_deref() == Ok("1") {
        NATIVE_SYNC_OFF.store(true, Ordering::Release);
        info!("{NATIVE_SYNC_OFF_ENV_VAR}=1: native sync commands will be neither sent nor checked");
    }
    let Ok(spec) = std::env::var(ENV_VAR) else {
        return;
    };
    match spec.parse::<u32>() {
        Ok(depth) if depth >= 1 => {
            DEPTH.store(depth, Ordering::Release);
            // Native sync hashes state a re-simulation does not reproduce, so it reports peers as
            // desynced once this client rolls back.
            NATIVE_SYNC_OFF.store(true, Ordering::Release);
            info!(
                "{ENV_VAR} armed: every live tick will re-simulate {depth} frames, with native sync off"
            );
        }
        _ => {
            error!("{ENV_VAR}={spec:?} is not a frame count of at least 1; ignoring it");
            return;
        }
    }
    if let Some(spacing) = crate::rollback_harness::snapshot_spacing_from_env() {
        SPACING.store(spacing, Ordering::Release);
    }
}

/// Whether shadow rollback is armed, which needs the snapshot's ranges resolved.
pub(crate) fn wants_ranges() -> bool {
    DEPTH.load(Ordering::Acquire) != 0
}

/// Whether native sync (0x37) is off for this client: it neither sends sync commands nor checks
/// its peers' ones, and a no-op stands in for each turn's sync command.
pub(crate) fn native_sync_off() -> bool {
    NATIVE_SYNC_OFF.load(Ordering::Acquire)
}

/// Forgets per-game state. Called when the game loop (re-)enters game init.
pub fn reset_for_game_init() {
    HISTORY_REQUESTED.store(false, Ordering::Relaxed);
}

/// Runs one tick of a live game with shadow rollback, or returns `None` to leave the tick to the
/// replay harness or a plain step: when shadow rollback is off, in replays, and before the game
/// loop is running a netcode v2 session.
pub unsafe fn run_game_logic_step(
    bw: &'static BwScr,
    param: usize,
    orig: unsafe extern "C" fn(usize) -> usize,
) -> Option<usize> {
    unsafe {
        let depth = DEPTH.load(Ordering::Relaxed);
        if depth == 0 || game_thread::is_replay() || !bw.has_game_started() {
            return None;
        }
        if !bw.rollback_observer_ui_hooked() {
            // Re-simulated frames would repeat the observer UI's notifications, and it
            // dereferences records a repeated notification has already consumed.
            DEPTH.store(0, Ordering::Release);
            error!("{ENV_VAR} needs the observer UI hooks, which analysis could not resolve");
            return None;
        }
        let spacing = SPACING.load(Ordering::Relaxed);
        let current = bw.probe_frame_count()?;
        // When the next frame's turns are not all in yet, the present step will wait for them
        // inside BW's network step, and re-simulating ahead of every one of those waits would only
        // burn time.
        let next_frame = bw.netcode_v2_next_frame();
        let ready = netcode_v2::with_turn_state(|s| {
            if !HISTORY_REQUESTED.swap(true, Ordering::Relaxed) {
                s.keep_dispatch_history((depth + spacing + DISPATCH_HISTORY_MARGIN) as usize);
            }
            s.next_turns_ready(next_frame)
        })?;

        let mut guard = SNAPSHOTS.lock();
        if guard.is_none() {
            *guard = Snapshots::build(bw);
        }
        let snapshots = guard.as_mut()?;
        let present = current + 1;
        let confirmed = present.saturating_sub(depth);
        let plan = TickPlan {
            rollback_to: ready.then(|| present.saturating_sub(depth + 1)),
            present,
            confirmed,
            spacing,
        };
        let (ret, report) = tick::run_tick(bw, snapshots, current, &plan, |_| {
            crate::rollback_probe::run_game_logic_step(bw, param, orig)
        });
        drop(guard);
        sounds::reconcile_sounds(bw, report.window_start, report.settled_through, present);

        let mut summary = SUMMARY.lock();
        summary.ticks += 1;
        if let Some(restored) = report.restored {
            summary.rollbacks += 1;
            summary.resimulated += current.saturating_sub(restored);
        }
        summary.restore += report.restore_time;
        summary.snapshot += report.snapshot_time;
        summary.steps += report.step_time;
        summary.worst_steps = summary.worst_steps.max(report.step_time);
        if summary.ticks >= SUMMARY_TICKS {
            let per_tick = |x: Duration| x.as_secs_f64() * 1000.0 / summary.ticks as f64;
            info!(
                "Shadow rollback over {} ticks to frame {present}: {} rolled back, {} frames \
                 re-simulated; per tick restore {:.2} ms, snapshot {:.2} ms, steps {:.2} ms \
                 (worst {:.1} ms)",
                summary.ticks,
                summary.rollbacks,
                summary.resimulated,
                per_tick(summary.restore),
                per_tick(summary.snapshot),
                per_tick(summary.steps),
                summary.worst_steps.as_secs_f64() * 1000.0,
            );
            *summary = Summary {
                ticks: 0,
                rollbacks: 0,
                resimulated: 0,
                restore: Duration::ZERO,
                snapshot: Duration::ZERO,
                steps: Duration::ZERO,
                worst_steps: Duration::ZERO,
            };
        }
        Some(ret)
    }
}
