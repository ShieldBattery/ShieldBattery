//! When a game that rolls back steps each frame, paced against the relays' session clock.
//!
//! The relays keep a clock for the session: the turn with seq `n` is due at the relay
//! [`STEP_DURATION_US`] after turn `n - 1`, and the clock stops while the whole session waits.
//! This client's home relay measures how late each of its turns arrives against it and reports the
//! figures every half second ([`LeadReport`]). The client can't see the relay's clock, and doesn't
//! need to: a report says how late turns *sent at the times this client sent them* arrived, so it
//! moves its own send times by that much. It keeps `send_zero`, the time it means turn 0 to have
//! left by, so turn `n` leaves by `send_zero + n` steps, and it steps frame `k` when it sends turn
//! `k + pipe`, its own turn `pipe` steps ahead. How many turns it keeps in the pipe (its input
//! delay) is decided elsewhere, from the rollback it measures; moving the pipe doesn't move when
//! turns leave, only which frame is on screen when they do.
//!
//! A report moves `send_zero` earlier by the 90th percentile of the lateness plus a margin, so
//! about one turn in ten arrives late and the other players roll back over it. Whole steps of a
//! correction apply at once (the game steps extra frames or puts one off); the rest is slewed at
//! [`SLEW_PER_TICK_US`] a tick, which the driver applies to the game loop's own timing as well
//! ([`Pacing::tick`] returns it), so the game runs that much faster or slower for a while: a change
//! in game speed too small to see, where moving only the schedule would just make the game skip
//! or repeat a frame once the slew crossed one. One report moves the
//! schedule by at most [`MAX_CORRECTION_US`], and a report is only trusted once every turn it
//! covers was sent after the last change to the schedule took effect, so a correction is never
//! applied twice.
//!
//! The game loop runs its ticks on its own timer, a step apart, at some point within each step of
//! the schedule. A tick near a step's edge would flip between two frames with a millisecond of
//! jitter, stepping an extra frame one tick and putting the next one off the tick after, so the
//! pacing also keeps the ticks centred in their steps: [`Pacing::phase_nudge_us`] moves the next
//! tick by up to [`SLEW_PER_TICK_US`] toward the middle, which a stall, a stop of the clock, or the
//! game loop's own drift can have moved them off.
//!
//! When the session clock stops (everyone waited on a player who dropped), the report carrying the
//! stop moves `send_zero` later by exactly the stopped time, so nobody races to make up time the
//! session never ran. A client stalled at its own prediction limit holds its schedule still too,
//! provisionally: if the relay's clock stopped as well, the stopped time it reports replaces the
//! provisional hold, and if it didn't, the stall was this client's alone, and once a report shows
//! turns sent after the stall arriving with the clock unmoved, the hold is undone so the client
//! catches up.

use std::time::{Duration, Instant};

use rally_point_client::proto::messages::LeadReport;
use rally_point_client::proto::rollback::STEP_DURATION_US;

/// One step of the session clock.
pub const STEP: Duration = Duration::from_micros(STEP_DURATION_US);

const STEP_US: i64 = STEP_DURATION_US as i64;

/// What a report's 90th percentile is padded by: turns should arrive this far ahead of their
/// deadline.
const MARGIN_US: i64 = 3_000;

/// The most one report moves the schedule by: two steps.
pub const MAX_CORRECTION_US: i64 = 2 * STEP_US;

/// How fast the part of a correction smaller than a step is applied: 1 ms a tick, about 2.4% of
/// game speed.
pub const SLEW_PER_TICK_US: i64 = 1_000;

/// How far off the middle of its step a tick may start before the pacing nudges the game loop
/// back toward it.
const PHASE_DEAD_BAND_US: i64 = 2_000;

/// How many of this client's turns a report's window covers. A report is only trusted once every
/// turn in its window was sent after the last change to the schedule took effect.
const REPORT_WINDOW_TURNS: u64 = 24;

/// What the pacing did, for the driver's summary.
#[derive(Debug, Default, Clone, Copy, PartialEq, Eq)]
pub struct PacingCounts {
    /// Reports that moved the schedule.
    pub corrections: u32,
    /// Their net effect, in microseconds (negative is earlier).
    pub corrected_us: i64,
    /// Provisional holds through a stall of this client's own that were undone.
    pub holds_undone: u32,
}

/// When this client steps each frame. See the module docs.
#[derive(Debug)]
pub struct Pacing {
    /// When this client means turn 0 to have left by, as applied so far.
    send_zero: Instant,
    /// The part of the commanded correction not yet applied, in microseconds (negative is
    /// earlier).
    slewing_us: i64,
    /// The session clock's stopped time as of the newest report.
    pause_us: u64,
    /// Time this client held its schedule still while stalled at its prediction limit, not yet
    /// matched by the session clock's stopped time.
    hold: Duration,
    /// When the last tick started.
    last_tick: Instant,
    /// Whether the last tick was stalled at the prediction limit. A stalled tick waits for turns
    /// inside the game's own step, so the time it stalled for is the time until the next tick.
    last_stalled: bool,
    /// The newest turn this client had sent when the stall it is holding through ended, if one
    /// has.
    hold_ended_at: Option<u64>,
    /// Reports about turns before this one describe sends made before the newest change to the
    /// schedule took effect, and are ignored.
    trust_from: u64,
    counts: PacingCounts,
}

/// `at` moved by `us` microseconds (negative is earlier).
fn shifted(at: Instant, us: i64) -> Instant {
    let by = Duration::from_micros(us.unsigned_abs());
    if us >= 0 {
        at + by
    } else {
        at.checked_sub(by).unwrap_or(at)
    }
}

fn micros(duration: Duration) -> i64 {
    i64::try_from(duration.as_micros()).unwrap_or(i64::MAX)
}

impl Pacing {
    /// Starts pacing at the end of the lockstep start, where the tick that started at `tick_start`
    /// stepped from frame `frame` with `buffer` turns of latency buffer: until the first report
    /// moves it, the schedule is the one the lockstep start was keeping, every client stepping in
    /// time with the turns it waited for.
    pub fn new(frame: u32, buffer: u32, tick_start: Instant) -> Self {
        // Measured from half a step before the tick: the game loop starts its ticks at slightly
        // varying times after each frame's due time, and the half step keeps any variation under
        // it from moving a tick onto another frame.
        let start = tick_start.checked_sub(STEP / 2).unwrap_or(tick_start);
        let send_zero = start
            .checked_sub(STEP * frame.saturating_add(buffer))
            .unwrap_or(start);
        Self {
            send_zero,
            slewing_us: 0,
            pause_us: 0,
            hold: Duration::ZERO,
            last_tick: tick_start,
            last_stalled: false,
            hold_ended_at: None,
            trust_from: 0,
            counts: PacingCounts::default(),
        }
    }

    /// The position a tick that starts at `tick_start` should end on, with `pipe` of this client's
    /// own turns in flight.
    pub fn target(&self, tick_start: Instant, pipe: u32) -> u32 {
        let elapsed = tick_start.saturating_duration_since(self.send_zero);
        let steps = elapsed.as_micros() / STEP.as_micros();
        let target = i64::try_from(steps).unwrap_or(i64::MAX) + 1 - i64::from(pipe);
        target.clamp(0, u32::MAX.into()) as u32
    }

    /// How far to move the game loop's next tick to keep ticks centred in their steps: a tick that
    /// started at `tick_start` more than [`PHASE_DEAD_BAND_US`] off the middle of its step moves
    /// the next one by [`SLEW_PER_TICK_US`] toward it (negative is sooner). Moves only when the
    /// ticks happen, not the schedule.
    pub fn phase_nudge_us(&self, tick_start: Instant) -> i64 {
        let into = i64::try_from(
            tick_start
                .saturating_duration_since(self.send_zero)
                .as_micros()
                % STEP.as_micros(),
        )
        .unwrap_or(0);
        let off = into - STEP_US / 2;
        if off > PHASE_DEAD_BAND_US {
            -SLEW_PER_TICK_US
        } else if off < -PHASE_DEAD_BAND_US {
            SLEW_PER_TICK_US
        } else {
            0
        }
    }

    /// Notes a tick starting at `tick_start`, before it steps. `stalled` is whether it can't step
    /// because the simulation is at its prediction limit, and `newest_sent` the newest turn this
    /// client has sent. Applies a tick's worth of any slewing correction, and returns it in
    /// microseconds (negative is earlier) for the caller to move the game loop's next step by.
    #[must_use]
    pub fn tick(&mut self, tick_start: Instant, stalled: bool, newest_sent: u64) -> i64 {
        if self.last_stalled {
            // Hold the schedule still through the stall: the time spent waiting isn't time to
            // make up afterwards, unless the relay's clock shows the session kept going without
            // this client.
            let waited = tick_start.saturating_duration_since(self.last_tick);
            self.send_zero += waited;
            self.hold += waited;
            self.hold_ended_at = None;
        } else if !self.hold.is_zero() && self.hold_ended_at.is_none() {
            self.hold_ended_at = Some(newest_sent);
            // Until reports cover turns sent well after the stall, they can still describe the
            // stall itself: a relay adopts a stop of the session clock a mesh hop after it.
            self.trust_from = self.trust_from.max(newest_sent + REPORT_WINDOW_TURNS);
        }
        self.last_tick = tick_start;
        self.last_stalled = stalled;
        let step = self.slewing_us.clamp(-SLEW_PER_TICK_US, SLEW_PER_TICK_US);
        if step != 0 {
            self.send_zero = shifted(self.send_zero, step);
            self.slewing_us -= step;
        }
        step
    }

    /// Takes in a report from this client's home relay. `newest_sent` is the newest turn this
    /// client has sent.
    pub fn on_report(&mut self, report: &LeadReport, newest_sent: u64) {
        if report.pause_us > self.pause_us {
            // The session clock stopped: every later deadline moved by exactly that much, part
            // of which this client may already have held still for.
            let stopped = i64::try_from(report.pause_us - self.pause_us).unwrap_or(i64::MAX);
            self.pause_us = report.pause_us;
            self.send_zero = shifted(self.send_zero, stopped - micros(self.hold));
            self.hold = Duration::ZERO;
            self.hold_ended_at = None;
            self.trust_from = self.trust_from.max(newest_sent + REPORT_WINDOW_TURNS);
            return;
        }
        if report.samples == 0 || report.through_step < self.trust_from {
            return;
        }
        if self.hold_ended_at.take().is_some() {
            // Turns sent after the stall arrived, and the clock never stopped: the stall was this
            // client's alone, and it is behind by however long it held still.
            self.send_zero = shifted(self.send_zero, -micros(self.hold));
            self.hold = Duration::ZERO;
            self.counts.holds_undone += 1;
            self.trust_from = newest_sent + REPORT_WINDOW_TURNS;
            return;
        }
        let late_us = i64::from(report.p90_us) + MARGIN_US;
        // In whole slew steps, which the game loop's millisecond timing can follow exactly.
        let correction = ((-late_us).clamp(-MAX_CORRECTION_US, MAX_CORRECTION_US) as f64
            / SLEW_PER_TICK_US as f64)
            .round() as i64
            * SLEW_PER_TICK_US;
        if correction == 0 {
            return;
        }
        // Whole steps now, the rest slewed. A trusted report measured only turns sent after the
        // previous correction finished slewing, so there is never any of it left to merge.
        let whole = correction / STEP_US * STEP_US;
        self.send_zero = shifted(self.send_zero, whole);
        self.slewing_us = correction - whole;
        self.counts.corrections += 1;
        self.counts.corrected_us += correction;
        let slew_ticks = self
            .slewing_us
            .unsigned_abs()
            .div_ceil(SLEW_PER_TICK_US as u64);
        self.trust_from = newest_sent + REPORT_WINDOW_TURNS + slew_ticks;
    }

    /// The session clock's stopped time as of the newest report, in microseconds.
    pub fn pause_us(&self) -> u64 {
        self.pause_us
    }

    /// What the pacing did since the last call.
    pub fn take_counts(&mut self) -> PacingCounts {
        std::mem::take(&mut self.counts)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const MS: Duration = Duration::from_millis(1);

    fn report(through_step: u64, p90_us: i32, pause_us: u64) -> LeadReport {
        LeadReport {
            through_step,
            median_us: p90_us,
            p90_us,
            samples: 24,
            pause_us,
        }
    }

    /// Ticks once a step from `from` for `ticks` steps, stepping normally, and returns the time
    /// of the next tick.
    fn run(pacing: &mut Pacing, from: Instant, ticks: u32, newest_sent: u64) -> Instant {
        for i in 0..ticks {
            let _ = pacing.tick(from + STEP * i, false, newest_sent + u64::from(i));
        }
        from + STEP * ticks
    }

    #[test]
    fn it_starts_on_the_schedule_the_lockstep_start_kept() {
        let start = Instant::now();
        let pacing = Pacing::new(24, 6, start);
        // Lead 3 over a pipe of 3 (a buffer of 6): the tick that anchored it ends on frame 24 + 1
        // + 3, as the lockstep start's schedule would have it.
        assert_eq!(pacing.target(start, 3), 28);
        assert_eq!(pacing.target(start + STEP * 10, 3), 38);
        // A deeper pipe steps later against the same send times.
        assert_eq!(pacing.target(start, 5), 26);
        // Jitter under half a step doesn't move a tick onto another frame.
        assert_eq!(pacing.target(start + STEP / 2 - MS, 3), 28);
        assert_eq!(pacing.target(start - STEP / 2 + MS, 3), 28);
    }

    #[test]
    fn late_turns_move_the_schedule_earlier_whole_steps_at_once_and_the_rest_slewed() {
        let start = Instant::now();
        let mut pacing = Pacing::new(24, 6, start);
        let before = pacing.target(start, 3);
        // The 90th percentile arrived 50 ms late: with the margin, turns must leave 53 ms
        // earlier, one whole step now and 11 ms slewed.
        pacing.on_report(&report(30, 50_000, 0), 30);
        assert_eq!(
            pacing.target(start, 3),
            before + 1,
            "the whole step applies at once"
        );
        assert_eq!(pacing.slewing_us, -11_000);
        assert_eq!(
            pacing.tick(start, false, 31),
            -1_000,
            "each tick hands the game loop a millisecond of the slew",
        );
        let next = run(&mut pacing, start + STEP, 10, 32);
        assert_eq!(pacing.slewing_us, 0, "slewed at a millisecond a tick");
        // The schedule it started on, 53 ms earlier.
        let earlier = Pacing::new(24, 6, start - 53 * MS);
        assert_eq!(pacing.target(next, 3), earlier.target(next, 3));
        assert_eq!(pacing.take_counts().corrections, 1);
    }

    #[test]
    fn one_report_moves_the_schedule_two_steps_at_most() {
        let start = Instant::now();
        let mut pacing = Pacing::new(24, 6, start);
        let before = pacing.target(start, 3);
        pacing.on_report(&report(30, 900_000, 0), 30);
        assert_eq!(pacing.target(start, 3), before + 2);
        assert_eq!(pacing.slewing_us, 0);
        // Early turns move it later, just as far at most.
        let mut early = Pacing::new(24, 6, start);
        early.on_report(&report(30, -900_000, 0), 30);
        assert_eq!(early.target(start, 3), before - 2);
    }

    #[test]
    fn reports_about_turns_sent_before_a_correction_took_effect_are_ignored() {
        let start = Instant::now();
        let mut pacing = Pacing::new(24, 6, start);
        pacing.on_report(&report(30, 39_000, 0), 30);
        let corrected = pacing.target(start, 3);
        // The next reports still cover turns sent before the correction: the relay's window is
        // 24 turns.
        pacing.on_report(&report(42, 39_000, 0), 42);
        pacing.on_report(&report(53, 39_000, 0), 53);
        assert_eq!(pacing.target(start, 3), corrected);
        // One whose window was all sent after it counts.
        pacing.on_report(&report(54, 39_000, 0), 60);
        assert_eq!(pacing.target(start, 3), corrected + 1);
        assert_eq!(pacing.take_counts().corrections, 2);
    }

    #[test]
    fn a_report_without_samples_corrects_nothing() {
        let start = Instant::now();
        let mut pacing = Pacing::new(24, 6, start);
        let before = pacing.target(start, 3);
        pacing.on_report(
            &LeadReport {
                samples: 0,
                ..report(30, 900_000, 0)
            },
            30,
        );
        assert_eq!(pacing.target(start, 3), before);
    }

    #[test]
    fn ticks_are_nudged_back_to_the_middle_of_their_steps() {
        let start = Instant::now();
        let pacing = Pacing::new(24, 6, start);
        // The tick that started the pacing is the middle of its step, and so is every tick a whole
        // number of steps on.
        assert_eq!(pacing.phase_nudge_us(start), 0);
        assert_eq!(pacing.phase_nudge_us(start + STEP * 7), 0);
        assert_eq!(
            pacing.phase_nudge_us(start + STEP * 7 + 2 * MS),
            0,
            "inside the dead band"
        );
        // Later in the step: the next tick comes sooner. Earlier: later.
        assert_eq!(pacing.phase_nudge_us(start + STEP * 7 + 15 * MS), -1_000);
        assert_eq!(pacing.phase_nudge_us(start + STEP * 7 - 15 * MS), 1_000);
    }

    #[test]
    fn a_session_wide_stop_holds_still_and_never_sprints() {
        let start = Instant::now();
        let mut pacing = Pacing::new(24, 6, start);
        let mut at = run(&mut pacing, start, 10, 40);
        let before_stall = pacing.target(at, 3);
        // A tick stalls at the limit for ten seconds inside the game's wait for turns.
        let _ = pacing.tick(at, true, 50);
        at += Duration::from_secs(10);
        let _ = pacing.tick(at, false, 50);
        assert_eq!(
            pacing.target(at, 3),
            before_stall,
            "the schedule held still through the stall",
        );
        // The relay's clock stopped for slightly less (it runs its slack past the newest
        // confirmable turn before stopping): the report's stop replaces the hold, and the
        // schedule moves by the difference only.
        pacing.on_report(&report(50, 0, 9_500_000), 51);
        assert_eq!(pacing.target(at, 3), before_stall + 12);
        assert_eq!(pacing.pause_us(), 9_500_000);
        assert!(pacing.hold.is_zero());
        // A later ordinary report doesn't undo anything.
        pacing.on_report(&report(80, -10_000, 9_500_000), 80);
        assert_eq!(pacing.take_counts().holds_undone, 0);
    }

    #[test]
    fn a_stall_of_this_clients_own_is_made_up_once_reports_show_the_clock_ran_on() {
        let start = Instant::now();
        let mut pacing = Pacing::new(24, 6, start);
        let mut at = run(&mut pacing, start, 10, 40);
        let before_stall = pacing.target(at, 3);
        let _ = pacing.tick(at, true, 50);
        at += Duration::from_secs(2);
        let _ = pacing.tick(at, false, 50);
        at += STEP;
        let _ = pacing.tick(at, false, 51);
        assert_eq!(
            pacing.target(at, 3),
            before_stall + 1,
            "held through the stall"
        );
        // Reports about turns sent around the stall are not trusted yet.
        pacing.on_report(&report(60, 2_000_000, 0), 60);
        assert_eq!(pacing.target(at, 3), before_stall + 1);
        // One covering turns sent well after it, with the clock unmoved: the stall was this
        // client's alone, and it catches up by the whole hold.
        pacing.on_report(&report(80, 0, 0), 80);
        assert_eq!(
            pacing.target(at, 3),
            Pacing::new(24, 6, start).target(at, 3),
            "back on the schedule it would have kept without the stall",
        );
        assert_eq!(pacing.take_counts().holds_undone, 1);
    }
}
