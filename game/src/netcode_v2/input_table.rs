//! The turns of a game whose simulation runs ahead of turns it has not received yet, kept by the
//! step that dispatches them.
//!
//! Every simulation step dispatches exactly one turn from every slot still in the game, so a
//! slot's k-th in-game turn is dispatched by step k (the step that starts from frame k) on every
//! client. A client that has not received a slot's turn for a step can still run the step with a
//! stand-in that issues no commands, [`PREDICTED_TURN`], and run it again once the real turn
//! arrives if that turn did issue any. [`InputTable`] keeps each slot's turns for as long as a
//! rollback may simulate their steps again, reports the earliest step whose prediction a turn has
//! since contradicted, and schedules the relay's leaves at the step each belongs to.

use std::collections::VecDeque;
use std::time::{Duration, Instant};

use bytes::Bytes;

use crate::bw;
use crate::bw::players::StormPlayerId;

/// The turn a step runs with for a slot whose turn has not arrived: an empty one, which is what an
/// idle player's turn holds once native sync commands are stripped from it.
pub const PREDICTED_TURN: &[u8] = &[];

/// Whether a turn does exactly what [`PREDICTED_TURN`] does. The command processing hook stands a
/// single no-op in for a turn with no sync command, so a turn holding just that no-op is the same.
fn matches_prediction(turn: &[u8]) -> bool {
    turn.is_empty() || turn == [bw::commands::id::NOP]
}

/// Every slot's turns by step. See the [module docs](self).
pub struct InputTable {
    /// How many steps a step whose turns are not all known may run past the newest one whose turns
    /// are, counting itself: 0 runs only steps with every turn known, which is lockstep.
    limit: u32,
    /// How many frames of lateness this client means to absorb by rolling back rather than with
    /// input delay, when nothing is going wrong. At most `limit`.
    rollback_target: u32,
    /// How many steps at the start of the game wait for every turn, as lockstep does. Clients start
    /// their game loops at different moments, and running the first steps in lockstep lines their
    /// simulations up before each keeps its own schedule.
    lockstep_steps: u32,
    /// The latency buffer this client acts as if the relay asked for at least, for testing a
    /// deeper buffer than the one the relay chose.
    min_buffer_turns: u32,
    slots: [SlotTurns; bw::MAX_STORM_PLAYERS],
    /// How long each slot's turns are held back after they arrive before a step may use them, for
    /// testing a slow link with a fast one.
    held: [Duration; bw::MAX_STORM_PLAYERS],
    /// The first step no simulation has run yet.
    frontier: u32,
    /// The earliest step that ran on a prediction a turn has since contradicted.
    mispredicted: Option<u32>,
    /// Counts since the last [`take_counts`](Self::take_counts).
    counts: InputCounts,
    /// One leave per slot, in the order the relay directed them.
    leaves: Vec<ScheduledLeave>,
    /// The chat each step injected into the simulation, oldest step first, so that the step injects
    /// the same chat when it is simulated again.
    chat: VecDeque<(u32, Vec<(StormPlayerId, String)>)>,
}

/// What the table saw over a stretch of steps, for logging.
#[derive(Clone, Copy, Default, Debug)]
pub struct InputCounts {
    /// Steps that ran for the first time with at least one turn predicted.
    pub predicted_steps: u32,
    /// Predicted turns a later turn contradicted.
    pub mispredicted_turns: u32,
    /// Predicted turns that turned out right.
    pub confirmed_predictions: u32,
}

#[derive(Default)]
struct SlotTurns {
    /// The step that dispatches `turns[0]`.
    first: u32,
    turns: VecDeque<HeldTurn>,
    /// How many of `turns`, from the front, steps may use: turns arrive in step order, and one held
    /// back also holds back every turn after it.
    usable: usize,
}

struct HeldTurn {
    bytes: Bytes,
    /// When steps may start using the turn, or `None` from the moment it arrived.
    usable_at: Option<Instant>,
}

struct ScheduledLeave {
    storm: StormPlayerId,
    reason: u32,
    /// The step that applies the leave instead of dispatching the slot's turn.
    step: u32,
    applied: bool,
}

impl InputTable {
    pub fn new(
        limit: u32,
        rollback_target: u32,
        lockstep_steps: u32,
        held: [Duration; bw::MAX_STORM_PLAYERS],
    ) -> Self {
        Self {
            limit,
            rollback_target: rollback_target.min(limit),
            lockstep_steps,
            min_buffer_turns: 0,
            slots: std::array::from_fn(|_| SlotTurns::default()),
            held,
            frontier: 0,
            mispredicted: None,
            counts: InputCounts::default(),
            leaves: Vec::new(),
            chat: VecDeque::new(),
        }
    }

    /// Adds the next turn of `storm`'s slot, which the step after that slot's previous turn's
    /// dispatches. `now` is when it arrived.
    pub fn push(&mut self, storm: StormPlayerId, bytes: Bytes, now: Instant) {
        let Some(slot) = self.slots.get_mut(storm.0 as usize) else {
            return;
        };
        let held = self.held[storm.0 as usize];
        let usable_at = (!held.is_zero()).then(|| now + held);
        slot.turns.push_back(HeldTurn { bytes, usable_at });
        self.release_held(now);
    }

    /// Makes turns whose hold has run out by `now` usable, noting any whose step already ran on a
    /// prediction that the turn contradicts.
    pub fn release_held(&mut self, now: Instant) {
        for slot in &mut self.slots {
            while let Some(turn) = slot.turns.get(slot.usable)
                && turn.usable_at.is_none_or(|x| x <= now)
            {
                let step = slot.first + slot.usable as u32;
                if step < self.frontier {
                    if !matches_prediction(&turn.bytes) {
                        self.mispredicted = Some(self.mispredicted.map_or(step, |x| x.min(step)));
                        self.counts.mispredicted_turns += 1;
                    } else {
                        self.counts.confirmed_predictions += 1;
                    }
                }
                slot.usable += 1;
            }
        }
    }

    /// The first step `storm`'s slot has no usable turn for.
    fn known_until(&self, storm: usize) -> u32 {
        let slot = &self.slots[storm];
        slot.first + slot.usable as u32
    }

    /// The first step whose turns are not all known: every step before it dispatches the turns
    /// every other client dispatches for it. `required` holds the slots whose turns steps still
    /// dispatch. A slot whose leave the relay has scheduled stops holding it back once every turn
    /// it has before that leave is in.
    pub fn known_until_for(&self, required: &[bool; bw::MAX_STORM_PLAYERS]) -> u32 {
        (0..bw::MAX_STORM_PLAYERS)
            .filter(|&storm| required[storm])
            .map(|storm| {
                let known = self.known_until(storm);
                let leaves_after_known = self
                    .leaves
                    .iter()
                    .any(|x| x.storm.0 as usize == storm && x.step <= known);
                match leaves_after_known {
                    true => u32::MAX,
                    false => known,
                }
            })
            .min()
            .unwrap_or(u32::MAX)
    }

    /// Whether a step that has never run may run now, predicting whatever turns it lacks. The
    /// game's first `lockstep_steps` steps wait for every turn.
    pub fn can_run(&self, step: u32, required: &[bool; bw::MAX_STORM_PLAYERS]) -> bool {
        let limit = match step < self.lockstep_steps {
            true => 0,
            false => self.limit,
        };
        step < self.known_until_for(required).saturating_add(limit)
    }

    /// How many frames of lateness this client means to absorb by rolling back rather than with
    /// input delay.
    pub fn rollback_target(&self) -> u32 {
        self.rollback_target
    }

    /// Whether the game is still in the steps at its start that wait for every turn.
    pub fn in_lockstep_start(&self) -> bool {
        self.frontier < self.lockstep_steps
    }

    /// Makes this client act as if the relay asked for a latency buffer of at least `turns`.
    pub fn set_min_buffer_turns(&mut self, turns: u32) {
        self.min_buffer_turns = turns;
    }

    /// The latency buffer this client acts as if the relay asked for at least.
    pub fn min_buffer_turns(&self) -> u32 {
        self.min_buffer_turns
    }

    /// The slots of `required` that `step` has no usable turn for.
    pub fn missing(
        &self,
        step: u32,
        required: &[bool; bw::MAX_STORM_PLAYERS],
    ) -> impl Iterator<Item = StormPlayerId> + '_ {
        let required = *required;
        (0..bw::MAX_STORM_PLAYERS)
            .filter(move |&storm| required[storm] && self.known_until(storm) <= step)
            .map(|storm| StormPlayerId(storm as u8))
    }

    /// The turns `step` dispatches for each slot of `required`, the known turn or the prediction,
    /// and how many were predicted. Notes the step as run.
    pub fn dispatch(
        &mut self,
        step: u32,
        required: &[bool; bw::MAX_STORM_PLAYERS],
    ) -> ([Option<Bytes>; bw::MAX_STORM_PLAYERS], u32) {
        let mut predicted = 0;
        let turns = std::array::from_fn(|storm| {
            if !required[storm] {
                return None;
            }
            let slot = &self.slots[storm];
            let known = step
                .checked_sub(slot.first)
                .map(|x| x as usize)
                .filter(|&x| x < slot.usable)
                .map(|x| slot.turns[x].bytes.clone());
            if known.is_none() {
                predicted += 1;
            }
            Some(known.unwrap_or_else(|| Bytes::from_static(PREDICTED_TURN)))
        });
        if step >= self.frontier {
            if predicted != 0 {
                self.counts.predicted_steps += 1;
            }
            self.frontier = step + 1;
        }
        (turns, predicted)
    }

    /// Schedules a leave the relay directed for `storm`'s slot at `step`, unless one has been
    /// scheduled for the slot already: a slot leaves once, and the relay directs every copy of a
    /// slot's leave the same way.
    pub fn schedule_leave(&mut self, storm: StormPlayerId, reason: u32, step: u32) {
        if self.leaves.iter().any(|x| x.storm == storm) {
            return;
        }
        self.leaves.push(ScheduledLeave {
            storm,
            reason,
            step,
            applied: false,
        });
    }

    /// The step that applies `storm`'s slot's leave when no count of its turns came with it: the
    /// first step its turns have not been received for.
    pub fn first_step_without_turn(&self, storm: StormPlayerId) -> u32 {
        self.slots
            .get(storm.0 as usize)
            .map_or(0, |slot| slot.first + slot.turns.len() as u32)
    }

    /// The leaves `step` applies, as `(storm id, native leave reason)` pairs, noting them applied. A
    /// leave is applied by its own step, and only once nothing can contradict that step any more:
    /// applying one cannot be undone, so no rollback may reach back to its step afterwards. That
    /// takes the turns of every step before it, and the turns the slots that stay dispatch at the
    /// step itself; and no correction still to make at or before it, since turns and leaves arrive
    /// in the middle of a tick, after it chose how far back to roll: a step that ran on a
    /// prediction a turn has since contradicted, or an earlier leave not applied yet.
    pub fn take_due_leaves(
        &mut self,
        step: u32,
        required: &[bool; bw::MAX_STORM_PLAYERS],
    ) -> Vec<(StormPlayerId, u32)> {
        if !self.leaves_can_apply(step, required) {
            return Vec::new();
        }
        self.leaves
            .iter_mut()
            .filter(|x| !x.applied && x.step == step)
            .map(|x| {
                x.applied = true;
                (x.storm, x.reason)
            })
            .collect()
    }

    /// Whether the leaves due at `step` may be applied (see
    /// [`take_due_leaves`](Self::take_due_leaves)).
    fn leaves_can_apply(&self, step: u32, required: &[bool; bw::MAX_STORM_PLAYERS]) -> bool {
        if self.known_until_for(required) < step
            || self.mispredicted.is_some_and(|x| x <= step)
            || self.leaves.iter().any(|x| !x.applied && x.step < step)
        {
            return false;
        }
        let mut remaining = *required;
        for leave in self.leaves.iter().filter(|x| !x.applied && x.step == step) {
            remaining[leave.storm.0 as usize] = false;
        }
        self.known_until_for(&remaining) > step
    }

    /// Whether the leave of `storm`'s slot has been applied, by its step or outside its schedule.
    pub fn leave_applied(&self, storm: StormPlayerId) -> bool {
        self.leaves.iter().any(|x| x.storm == storm && x.applied)
    }

    /// Notes a leave applied outside its schedule, so the schedule never applies it again.
    pub fn mark_leave_applied(&mut self, storm: StormPlayerId) {
        for leave in &mut self.leaves {
            if leave.storm == storm {
                leave.applied = true;
            }
        }
    }

    /// The earliest step that has to be simulated again, or `None`: the earliest step that ran on a
    /// contradicted prediction, or ran without a leave that it may now apply. Forgets the
    /// contradicted prediction, on the understanding that the caller rolls back to the step
    /// returned; a leave stays due until a step applies it.
    pub fn take_rollback_target(
        &mut self,
        required: &[bool; bw::MAX_STORM_PLAYERS],
    ) -> Option<u32> {
        let leave = self
            .leaves
            .iter()
            .filter(|x| !x.applied && x.step < self.frontier)
            .map(|x| x.step)
            .filter(|&step| self.leaves_can_apply(step, required))
            .min();
        match (self.mispredicted.take(), leave) {
            (Some(a), Some(b)) => Some(a.min(b)),
            (a, b) => a.or(b),
        }
    }

    /// Records chat a step injected into the simulation, for the step to inject again when it is
    /// simulated again.
    pub fn record_chat(&mut self, step: u32, storm: StormPlayerId, text: String) {
        match self.chat.back_mut() {
            Some((last, messages)) if *last == step => messages.push((storm, text)),
            _ => self.chat.push_back((step, vec![(storm, text)])),
        }
    }

    /// The chat `step` injected when it was first simulated.
    pub fn chat_at(&self, step: u32) -> Vec<(StormPlayerId, String)> {
        self.chat
            .iter()
            .find(|(x, _)| *x == step)
            .map(|(_, messages)| messages.clone())
            .unwrap_or_default()
    }

    /// Forgets the turns and chat of every step before `step`, which no rollback will simulate
    /// again.
    pub fn forget_before(&mut self, step: u32) {
        for slot in &mut self.slots {
            while slot.first < step && slot.usable != 0 {
                slot.turns.pop_front();
                slot.first += 1;
                slot.usable -= 1;
            }
        }
        while self.chat.front().is_some_and(|(x, _)| *x < step) {
            self.chat.pop_front();
        }
    }

    /// The first step no simulation has run yet.
    pub fn frontier(&self) -> u32 {
        self.frontier
    }

    /// What the table has seen since the last call.
    pub fn take_counts(&mut self) -> InputCounts {
        std::mem::take(&mut self.counts)
    }

    /// How many of `storm`'s slot's turns are waiting for steps that have not run yet.
    pub fn queued(&self, storm: StormPlayerId) -> usize {
        self.slots.get(storm.0 as usize).map_or(0, |slot| {
            let pending_from = self.frontier.saturating_sub(slot.first) as usize;
            slot.turns.len().saturating_sub(pending_from)
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const A: StormPlayerId = StormPlayerId(0);
    const B: StormPlayerId = StormPlayerId(1);

    fn required() -> [bool; bw::MAX_STORM_PLAYERS] {
        let mut x = [false; bw::MAX_STORM_PLAYERS];
        x[0] = true;
        x[1] = true;
        x
    }

    fn idle() -> Bytes {
        Bytes::from_static(PREDICTED_TURN)
    }

    fn command(x: u8) -> Bytes {
        Bytes::from(vec![0x20, x])
    }

    fn table(limit: u32) -> InputTable {
        InputTable::new(limit, 0, 1, [Duration::ZERO; bw::MAX_STORM_PLAYERS])
    }

    /// The instant every test turn arrives at.
    fn start() -> Instant {
        static START: std::sync::OnceLock<Instant> = std::sync::OnceLock::new();
        *START.get_or_init(Instant::now)
    }

    #[test]
    fn a_step_with_every_turn_known_dispatches_them() {
        let mut t = table(0);
        t.push(A, command(1), start());
        t.push(B, command(2), start());
        assert!(t.can_run(0, &required()));
        assert!(!t.can_run(1, &required()));
        let (turns, predicted) = t.dispatch(0, &required());
        assert_eq!(predicted, 0);
        assert_eq!(turns[0].as_deref(), Some(&[0x20, 1][..]));
        assert_eq!(turns[1].as_deref(), Some(&[0x20, 2][..]));
        assert_eq!(turns[2], None);
    }

    #[test]
    fn missing_turns_are_predicted_within_the_limit() {
        let mut t = table(2);
        for _ in 0..4 {
            t.push(A, idle(), start());
        }
        assert!(
            !t.can_run(0, &required()),
            "the first step waits for every turn"
        );
        t.push(B, idle(), start());
        t.dispatch(0, &required());
        assert!(t.can_run(1, &required()));
        assert!(t.can_run(2, &required()));
        assert!(!t.can_run(3, &required()));
        let (turns, predicted) = t.dispatch(1, &required());
        assert_eq!(predicted, 1);
        assert_eq!(turns[1].as_deref(), Some(PREDICTED_TURN));
        assert_eq!(t.missing(1, &required()).collect::<Vec<_>>(), vec![B]);
    }

    #[test]
    fn a_late_turn_with_commands_asks_for_its_step_again() {
        let mut t = table(8);
        for step in 0..4 {
            t.push(A, idle(), start());
            t.dispatch(step, &required());
        }
        t.push(B, idle(), start());
        assert_eq!(t.take_rollback_target(&required()), None);
        t.push(B, command(1), start());
        t.push(B, command(2), start());
        assert_eq!(t.take_rollback_target(&required()), Some(1));
        assert_eq!(t.take_rollback_target(&required()), None, "taken once");
        let (turns, predicted) = t.dispatch(1, &required());
        assert_eq!(predicted, 0);
        assert_eq!(turns[1].as_deref(), Some(&[0x20, 1][..]));
    }

    #[test]
    fn a_late_turn_holding_only_a_no_op_matches_the_prediction() {
        let mut t = table(8);
        for step in 0..2 {
            t.push(A, idle(), start());
            t.dispatch(step, &required());
        }
        t.push(B, Bytes::from_static(&[bw::commands::id::NOP]), start());
        t.push(B, idle(), start());
        assert_eq!(t.take_rollback_target(&required()), None);
        assert_eq!(t.take_counts().confirmed_predictions, 2);
    }

    #[test]
    fn a_turn_for_a_step_not_run_yet_asks_for_nothing() {
        let mut t = table(8);
        t.push(A, idle(), start());
        t.dispatch(0, &required());
        t.push(B, idle(), start());
        t.push(B, command(1), start());
        assert_eq!(t.take_rollback_target(&required()), None);
    }

    #[test]
    fn held_turns_become_usable_once_their_hold_runs_out() {
        let mut held = [Duration::ZERO; bw::MAX_STORM_PLAYERS];
        held[1] = Duration::from_millis(100);
        let mut t = InputTable::new(8, 0, 1, held);
        for step in 0..3 {
            t.push(A, idle(), start());
            t.push(B, command(step as u8), start());
        }
        assert_eq!(t.known_until_for(&required()), 0);
        t.dispatch(0, &required());
        t.release_held(start() + Duration::from_millis(99));
        assert_eq!(t.take_rollback_target(&required()), None);
        t.dispatch(1, &required());
        t.release_held(start() + Duration::from_millis(100));
        // Steps 0 and 1 ran on predictions before the hold ran out.
        assert_eq!(t.take_rollback_target(&required()), Some(0));
        assert_eq!(t.known_until_for(&required()), 3);
    }

    #[test]
    fn a_leave_waits_for_every_earlier_step_to_be_known() {
        let mut t = table(8);
        for step in 0..6 {
            t.push(A, idle(), start());
            if step < 3 {
                t.push(B, idle(), start());
            }
        }
        let mut third = required();
        third[2] = true;
        t.push(StormPlayerId(2), idle(), start());
        t.schedule_leave(B, 0x40000006, 3);
        // Slot 2 has only turn 0, so step 3 does not know everything before it yet.
        assert_eq!(t.known_until_for(&third), 1);
        assert!(t.take_due_leaves(3, &third).is_empty());
        for step in 0..5 {
            t.dispatch(step, &third);
        }
        assert_eq!(t.take_rollback_target(&third), None);
        for _ in 0..4 {
            t.push(StormPlayerId(2), idle(), start());
        }
        assert_eq!(t.take_rollback_target(&third), Some(3));
        assert_eq!(
            t.take_rollback_target(&third),
            Some(3),
            "a leave stays due until applied"
        );
        assert_eq!(t.take_due_leaves(3, &third), vec![(B, 0x40000006)]);
        assert_eq!(t.take_rollback_target(&third), None);
        assert!(t.take_due_leaves(3, &third).is_empty(), "applied once");
    }

    #[test]
    fn a_leave_waits_for_its_own_step_from_the_slots_that_stay() {
        let mut t = table(8);
        let c = StormPlayerId(2);
        let mut third = required();
        third[2] = true;
        for _ in 0..6 {
            t.push(A, idle(), start());
        }
        for _ in 0..3 {
            t.push(B, idle(), start());
            t.push(c, idle(), start());
        }
        t.schedule_leave(B, 0x40000006, 3);
        for step in 0..5 {
            t.dispatch(step, &third);
        }
        // Every step before 3 is known, but slot 2's turn for step 3 is not: once the leave is
        // applied, no rollback could reach step 3 to run that turn.
        assert_eq!(t.take_rollback_target(&third), None);
        assert!(t.take_due_leaves(3, &third).is_empty());
        t.push(c, command(1), start());
        assert_eq!(t.take_rollback_target(&third), Some(3));
        assert_eq!(t.take_due_leaves(3, &third), vec![(B, 0x40000006)]);
        assert!(t.leave_applied(B));
    }

    #[test]
    fn a_leave_waits_for_an_earlier_one() {
        let mut t = table(8);
        let (c, d) = (StormPlayerId(2), StormPlayerId(3));
        let mut four = required();
        four[2] = true;
        four[3] = true;
        for _ in 0..10 {
            t.push(A, idle(), start());
            t.push(d, idle(), start());
        }
        for _ in 0..3 {
            t.push(B, idle(), start());
        }
        for _ in 0..6 {
            t.push(c, idle(), start());
        }
        for step in 0..8 {
            t.dispatch(step, &four);
        }
        // Both leaves arrive during a tick that has rolled back to neither.
        t.schedule_leave(B, 1, 3);
        t.schedule_leave(c, 1, 6);
        assert!(
            t.take_due_leaves(6, &four).is_empty(),
            "the leave at step 3 comes first"
        );
        assert_eq!(t.take_rollback_target(&four), Some(3));
        assert_eq!(t.take_due_leaves(3, &four), vec![(B, 1)]);
        let mut after_b = four;
        after_b[1] = false;
        assert_eq!(t.take_due_leaves(6, &after_b), vec![(c, 1)]);
    }

    #[test]
    fn a_leave_waits_for_a_correction_before_it() {
        let mut t = table(8);
        let c = StormPlayerId(2);
        let mut third = required();
        third[2] = true;
        for _ in 0..10 {
            t.push(A, idle(), start());
        }
        for _ in 0..7 {
            t.push(B, idle(), start());
        }
        for _ in 0..3 {
            t.push(c, idle(), start());
        }
        for step in 0..9 {
            t.dispatch(step, &third);
        }
        t.schedule_leave(B, 1, 7);
        // A late command for step 3 arrives during the tick, after it chose how far back to roll.
        t.push(c, command(1), start());
        for _ in 4..10 {
            t.push(c, idle(), start());
        }
        assert!(
            t.take_due_leaves(7, &third).is_empty(),
            "step 3 is simulated again first"
        );
        assert_eq!(t.take_rollback_target(&third), Some(3));
        assert_eq!(t.take_due_leaves(7, &third), vec![(B, 1)]);
    }

    #[test]
    fn a_slot_whose_leave_is_scheduled_stops_holding_back_known_steps() {
        let mut t = table(0);
        for _ in 0..5 {
            t.push(A, idle(), start());
        }
        t.push(B, idle(), start());
        t.push(B, idle(), start());
        assert_eq!(t.known_until_for(&required()), 2);
        t.schedule_leave(B, 1, 3);
        assert_eq!(t.known_until_for(&required()), 2, "turn 2 is still missing");
        t.push(B, idle(), start());
        assert_eq!(t.known_until_for(&required()), 5);
    }

    #[test]
    fn the_first_leave_scheduled_for_a_slot_wins() {
        let mut t = table(0);
        t.schedule_leave(B, 1, 3);
        t.schedule_leave(B, 2, 7);
        let mut both = required();
        both[0] = false;
        for _ in 0..3 {
            t.push(B, idle(), start());
        }
        assert_eq!(t.take_due_leaves(3, &both), vec![(B, 1)]);
    }

    #[test]
    fn forgetting_keeps_every_step_a_rollback_can_still_reach() {
        let mut t = table(8);
        for step in 0..5 {
            t.push(A, command(step as u8), start());
            t.push(B, idle(), start());
            t.dispatch(step, &required());
        }
        t.record_chat(1, A, "one".into());
        t.record_chat(3, B, "three".into());
        t.record_chat(3, A, "three again".into());
        t.forget_before(3);
        assert!(t.chat_at(1).is_empty());
        assert_eq!(
            t.chat_at(3),
            vec![(B, "three".into()), (A, "three again".into())]
        );
        let (turns, predicted) = t.dispatch(3, &required());
        assert_eq!(predicted, 0);
        assert_eq!(turns[0].as_deref(), Some(&[0x20, 3][..]));
        t.push(A, idle(), start());
        assert_eq!(t.queued(A), 1);
    }
}
