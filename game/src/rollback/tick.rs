//! One game loop tick of the rollback engine: roll back as far as the driver asks, re-simulate,
//! and step on to the present, snapshotting on a fixed spacing along the way.

use std::sync::atomic::Ordering;
use std::time::{Duration, Instant};

use crate::bw_scr::BwScr;

use super::snapshot::Snapshots;
use super::{FINAL_STEP, STEP_FRAME, TICK_RUNNING, WINDOW_START, announcements};

/// What one tick should do. Frames are frame counts: frame `n` is the simulation state after `n`
/// logic steps, and the step that produces it is the step from `n - 1`.
pub(crate) struct TickPlan {
    /// The earliest frame whose simulation has to be redone: the tick restores the newest snapshot
    /// at or before it and steps forward from there. `None`, or a frame the simulation has not
    /// passed yet, re-simulates nothing.
    pub(crate) rollback_to: Option<u32>,
    /// The frame the tick ends on, which is shown next.
    pub(crate) present: u32,
    /// The newest frame no later tick will simulate differently. Snapshots from before the newest
    /// one at or before it are dropped, since no rollback will reach back past it.
    pub(crate) confirmed: u32,
    /// Snapshots are taken of every frame that is a multiple of this.
    pub(crate) spacing: u32,
}

/// The step about to run.
pub(crate) struct StepInfo {
    /// The frame the step produces.
    pub(crate) frame: u32,
    /// How many steps the tick runs after this one.
    pub(crate) steps_after: u32,
    /// Whether the frame it produces is confirmed, so no later tick simulates it again.
    pub(crate) is_final: bool,
    /// Whether this is the first step after the tick restored a snapshot, so the simulation is
    /// still exactly as that snapshot holds it.
    pub(crate) resumes_from_restore: bool,
}

/// What one tick did.
#[derive(Default)]
pub(crate) struct TickReport {
    /// The frame the tick restored, when it rolled back.
    pub(crate) restored: Option<u32>,
    /// The first frame the tick's steps produced.
    pub(crate) window_start: u32,
    pub(crate) steps: u32,
    /// Snapshots taken.
    pub(crate) snapshots: u32,
    /// Announcements an earlier tick made for a frame this one re-simulated without making them:
    /// they belonged to a prediction that did not happen, and cannot be taken back.
    pub(crate) retracted_announcements: u32,
    pub(crate) restore_time: Duration,
    pub(crate) snapshot_time: Duration,
    pub(crate) step_time: Duration,
}

/// Runs one tick from `current`, the frame the simulation is on now, calling `step` for every
/// logic step (which runs BW's own step and returns what it returned). Returns the last step's
/// return value, 0 if none ran.
pub(crate) unsafe fn run_tick(
    bw: &BwScr,
    snapshots: &mut Snapshots,
    mut current: u32,
    plan: &TickPlan,
    mut step: impl FnMut(&StepInfo) -> usize,
) -> (usize, TickReport) {
    unsafe {
        let mut report = TickReport::default();
        let spacing = plan.spacing.max(1);
        // Selection circles come from a small pool of their own, outside the snapshot, so they go
        // back to it before a restore drops the sprites they are attached to and before a snapshot
        // would capture them; otherwise every tick would leak them until none are left to show.
        // They are put back for the frame being shown once the steps are done.
        let take = |snapshots: &mut Snapshots, frame: u32, report: &mut TickReport| {
            let start = Instant::now();
            bw.rollback_clear_selection_visuals();
            snapshots.take(frame);
            report.snapshot_time += start.elapsed();
            report.snapshots += 1;
        };
        if snapshots.is_empty() {
            take(snapshots, current, &mut report);
        }
        if let Some(target) = plan.rollback_to
            && target < current
        {
            let start = Instant::now();
            bw.rollback_clear_selection_visuals();
            if let Some(restored) = snapshots.restore_at_or_before(target, bw) {
                current = restored;
                report.restored = Some(restored);
            }
            report.restore_time = start.elapsed();
        }

        report.window_start = current + 1;
        WINDOW_START.store(report.window_start, Ordering::Relaxed);
        TICK_RUNNING.store(true, Ordering::Relaxed);
        let mut ret = 0;
        // Every step pushes the tick the game loop paces itself against one frame further into the
        // future, so after a tick that simulates several frames it goes back to the value the
        // first step left it at, keeping real-time pacing at exactly one frame per tick.
        let mut paced_tick = None;
        while current < plan.present {
            let info = StepInfo {
                frame: current + 1,
                steps_after: plan.present - current - 1,
                is_final: current < plan.confirmed,
                resumes_from_restore: report.restored.is_some() && report.steps == 0,
            };
            STEP_FRAME.store(info.frame, Ordering::Relaxed);
            FINAL_STEP.store(info.is_final, Ordering::Relaxed);
            let start = Instant::now();
            ret = step(&info);
            report.step_time += start.elapsed();
            report.steps += 1;
            if paced_tick.is_none() {
                paced_tick = Some(bw.probe_next_game_step_tick());
            }
            match bw.probe_frame_count() {
                // The simulation did not advance, which it does not once a replay has ended.
                Some(after) if after > current => current = after,
                _ => break,
            }
            if current.is_multiple_of(spacing) && !snapshots.has(current) {
                take(snapshots, current, &mut report);
            }
        }
        TICK_RUNNING.store(false, Ordering::Relaxed);
        FINAL_STEP.store(false, Ordering::Relaxed);

        snapshots.drop_older_than_needed_for(plan.confirmed);
        report.retracted_announcements =
            announcements::finish_tick(report.window_start, plan.confirmed);
        bw.rollback_rebuild_selection_visuals();
        if let Some(paced_tick) = paced_tick {
            bw.probe_set_next_game_step_tick(paced_tick);
        }
        (ret, report)
    }
}
