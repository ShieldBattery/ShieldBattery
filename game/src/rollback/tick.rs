//! One game loop tick of the rollback engine: roll back as far as the driver asks, re-simulate,
//! and step on to the present, snapshotting on a fixed spacing along the way.

use std::sync::atomic::Ordering;
use std::time::{Duration, Instant};

use crate::bw_scr::BwScr;

use super::snapshot::Snapshots;
use super::{
    FINAL_STEP, IRREVERSIBLE_STEP, RESIMULATING, STEP_FRAME, TICK_RUNNING, WINDOW_START,
    announcements, game_end, selection, ui_writes,
};

/// Frames between snapshots unless a debug knob says otherwise. A rollback re-simulates from the
/// newest snapshot at or before the frame it needs, so a wider spacing snapshots less often and
/// re-simulates more per rollback.
pub(crate) const DEFAULT_SNAPSHOT_SPACING: u32 = 3;

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
    #[cfg(debug_assertions)]
    pub(crate) steps_after: u32,
    /// Whether the frame it produces is confirmed, so no later tick simulates it again.
    pub(crate) is_final: bool,
    /// Whether this is the first step after the tick restored a snapshot, so the simulation is
    /// still exactly as that snapshot holds it.
    #[cfg(debug_assertions)]
    pub(crate) resumes_from_restore: bool,
    /// Whether the frame it produces was produced before, by the simulation the tick rolled back.
    pub(crate) is_resimulation: bool,
}

/// What one tick did.
#[derive(Default)]
pub(crate) struct TickReport {
    /// The frame the tick restored, when it rolled back.
    pub(crate) restored: Option<u32>,
    /// The first frame the tick's steps produced.
    pub(crate) window_start: u32,
    /// The newest frame no later tick can simulate again: the oldest snapshot kept. Confirmed
    /// frames after it can still be re-simulated when a rollback restores it, which reproduces
    /// them exactly but repeats whatever they announced unless the ledgers still hold it.
    pub(crate) settled_through: u32,
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
        let take = |snapshots: &mut Snapshots, frame: u32, report: &mut TickReport| {
            let start = Instant::now();
            with_ui_images_off(bw, || snapshots.take(frame));
            report.snapshot_time += start.elapsed();
            report.snapshots += 1;
        };
        // A frame due a snapshot that the previous tick ended on is snapshotted now, before
        // anything runs. Taking it right after the step that produced it would strip the
        // selection circles that step drew, and the frame would be shown without them: putting
        // them back only puts back the local selection's, not those of a right-clicked target
        // that is blinking. A tick that restores an earlier snapshot drops every one after it, so
        // it skips this one.
        let restores_earlier = plan.rollback_to.is_some_and(|target| {
            target < current && snapshots.newest_at_or_before(target).is_some()
        });
        if snapshots.is_empty()
            || (!restores_earlier && current.is_multiple_of(spacing) && !snapshots.has(current))
        {
            take(snapshots, current, &mut report);
        }
        // Every frame up to the one the simulation is on now has been shown already.
        let shown_through = current;
        let mut selection_before_restore = None;
        if let Some(target) = plan.rollback_to
            && target < current
        {
            let start = Instant::now();
            selection_before_restore = Some(bw.rollback_local_selection());
            if let Some(restored) =
                with_ui_images_off(bw, || snapshots.restore_at_or_before(target, bw))
            {
                current = restored;
                report.restored = Some(restored);
                selection::undo_after(bw, restored);
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
                #[cfg(debug_assertions)]
                steps_after: plan.present - current - 1,
                is_final: current < plan.confirmed,
                #[cfg(debug_assertions)]
                resumes_from_restore: report.restored.is_some() && report.steps == 0,
                is_resimulation: current < shown_through,
            };
            STEP_FRAME.store(info.frame, Ordering::Relaxed);
            FINAL_STEP.store(info.is_final, Ordering::Relaxed);
            RESIMULATING.store(info.is_resimulation, Ordering::Relaxed);
            game_end::begin_step(info.frame);
            // What the UI wrote into the simulation between the steps the restore undid happened
            // before the step from this frame, so it happens there again.
            if report.restored.is_some() {
                ui_writes::replay(bw, current);
            }
            let start = Instant::now();
            ret = step(&info);
            report.step_time += start.elapsed();
            report.steps += 1;
            if paced_tick.is_none() {
                paced_tick = Some(bw.rollback_next_game_step_tick());
            }
            match super::position(bw) {
                // The simulation did not advance, which it does not once a replay has ended.
                Some(after) if after > current => current = after,
                _ => break,
            }
            if IRREVERSIBLE_STEP.swap(false, Ordering::Relaxed) {
                take(snapshots, current, &mut report);
                snapshots.drop_older_than_needed_for(current);
            } else if current < plan.present
                && current.is_multiple_of(spacing)
                && !snapshots.has(current)
            {
                // The tick drops every snapshot older than the newest one at or before the
                // confirmed frame once its steps are done, so a frame with a later one due before
                // the present that is still confirmed is not worth snapshotting.
                let next_due = current + spacing;
                if !(next_due <= plan.confirmed && next_due < plan.present) {
                    take(snapshots, current, &mut report);
                }
            }
        }
        TICK_RUNNING.store(false, Ordering::Relaxed);
        FINAL_STEP.store(false, Ordering::Relaxed);
        RESIMULATING.store(false, Ordering::Relaxed);

        snapshots.drop_older_than_needed_for(plan.confirmed);
        report.settled_through = snapshots.oldest_frame().unwrap_or(plan.confirmed);
        ui_writes::prune(report.settled_through);
        selection::forget_through(report.settled_through);
        report.retracted_announcements =
            announcements::finish_tick(report.window_start, report.settled_through);
        // Between the restore and here, what looks at the units the selection holds skips a unit
        // without a sprite or reads only the unit itself; input that reads them waits for the
        // tick.
        if let Some(before) = &selection_before_restore
            && let Some(restored) = report.restored
        {
            bw.rollback_settle_local_selection(before);
            selection::reconcile(bw, restored, current);
        }
        if let Some(paced_tick) = paced_tick {
            bw.rollback_set_next_game_step_tick(paced_tick);
        }
        (ret, report)
    }
}

/// Runs `f`, which snapshots or restores, with the images the UI links into the simulation's
/// sprites taken off them, and puts them straight back once it is done.
///
/// The UI takes those images from pools of its own, outside the snapshot: selection circles and
/// health bars, and the overlays building placement shows over the units a building could go on.
/// They have to be off before a snapshot would capture them and before a restore drops the sprites
/// they are attached to, or every tick would leak them, and a restore would link sprites to images
/// the pools have handed out again since. And they have to be back for the steps, which rely on
/// them: a unit only leaves the local selection when it dies or changes owner if its sprite shows
/// it selected, and a refinery started on a geyser takes the placement overlay off it.
unsafe fn with_ui_images_off<R>(bw: &BwScr, f: impl FnOnce() -> R) -> R {
    unsafe {
        bw.rollback_clear_selection_visuals();
        let overlays = bw.rollback_detach_placement_overlays();
        let ret = f();
        bw.rollback_reattach_placement_overlays(overlays);
        bw.rollback_rebuild_selection_visuals();
        ret
    }
}
