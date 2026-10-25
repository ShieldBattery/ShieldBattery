//! A live game's pacing from tick to tick: the schedule against the session clock ([`Pacing`]),
//! the window of rollback that moves the lead ([`LeadWindow`]), and how the lead in effect follows
//! it, without the game or the network behind them, so the rollback driver and the tests run the
//! same decisions.
//!
//! The lead in effect drops to a lower lead at once (each frame a frame the player sees repeat, as
//! the game puts its next steps off), and rises to a higher one a frame at a time, each frame taken
//! up by the frame schedule's slew ([`Pacing::lag_frame`]) rather than by stepping a frame twice in
//! one tick. A report that moves the schedule later by whole steps while frames of a rise are still
//! to be taken up takes them up at once instead: a later schedule holds frames back, a smaller pipe
//! steps them sooner, and together nothing shows.
//!
//! For the first minute of a game it also logs what it does, a line per event (see
//! [`STARTUP_LOG_STEPS`]): the summaries give totals, these give the order.

use std::time::Instant;

use rally_point_client::proto::messages::LeadReport;

use super::lead_window::{LeadWindow, RollbackTarget};
use super::pacing::{Pacing, PacingCounts, STEP};
use crate::netcode_v2::Lead;

/// How many steps from the start of the game the startup log covers: the lockstep start and the
/// first minute after it.
pub const STARTUP_LOG_STEPS: u32 = 24 + 60 * 24;

/// The most lines the startup log writes for one game.
const MAX_STARTUP_LOG_LINES: u32 = 64;

/// A tick, as the pacing sees it.
#[derive(Clone, Copy, Debug)]
pub struct TickInfo {
    /// When the tick started.
    pub start: Instant,
    /// The frame the simulation was on as the tick started.
    pub current: u32,
    /// Whether the tick can step at all, rather than waiting at the prediction limit.
    pub can_run: bool,
    /// Whether that wait is the whole session's, rather than one on this client's own downlink.
    pub session_stall: bool,
    /// The newest of this client's own turns sent.
    pub newest_sent: u64,
}

/// What the schedule asks of a tick before it steps.
#[derive(Clone, Copy, Debug, Default)]
pub struct BeforeSteps {
    /// The frame the schedule has the tick end on, once pacing has started.
    pub scheduled: Option<u32>,
    /// How many of this client's own turns the schedule has due beyond those it has sent.
    pub owed: u32,
}

/// What a tick did once it stepped.
#[derive(Clone, Copy, Debug, Default)]
pub struct AfterSteps {
    /// Whether a lead window moved the lead this client means to run with.
    pub lead_changed: bool,
    /// Whether the game loop's next step is put off a frame, the simulation being ahead of its
    /// schedule.
    pub held_back: bool,
    /// How far to move the game loop's next step, in milliseconds (negative is sooner).
    pub delay_ms: i32,
}

/// See the [module docs](self).
pub struct TickPacer {
    pacing: Option<Pacing>,
    window: LeadWindow,
    /// How far this tick moves the game loop's next step so far, in microseconds.
    timing_us: i64,
    log: StartupLog,
}

impl TickPacer {
    pub const fn new() -> TickPacer {
        TickPacer {
            pacing: None,
            window: LeadWindow::new(),
            timing_us: 0,
            log: StartupLog::new(),
        }
    }

    /// The schedule, once pacing has started.
    #[cfg(test)]
    pub fn pacing(&self) -> Option<&Pacing> {
        self.pacing.as_ref()
    }

    /// What the pacing did since the last call, and the session clock's stopped time, once pacing
    /// has started.
    pub fn take_counts(&mut self) -> Option<(PacingCounts, u64)> {
        self.pacing
            .as_mut()
            .map(|pacing| (pacing.take_counts(), pacing.pause_us()))
    }

    /// Before a tick steps: moves the schedule along and takes in the relay's newest report, if
    /// one came, then says what the schedule asks of the tick. `lead` is this client's lead over a
    /// latency buffer of `buffer` turns, which a report moving the schedule later takes pending
    /// frames of up against.
    pub fn before_steps(
        &mut self,
        tick: &TickInfo,
        report: Option<&LeadReport>,
        lead: &mut Lead,
        buffer: u32,
    ) -> BeforeSteps {
        self.timing_us = 0;
        let Some(pacing) = &mut self.pacing else {
            return BeforeSteps::default();
        };
        self.timing_us += pacing.tick(tick.start, tick.session_stall, tick.newest_sent);
        if let Some(report) = report {
            let outcome = pacing.on_report(report, tick.newest_sent);
            let mut folded = 0;
            if outcome.whole_steps > 0 {
                let later = outcome.whole_steps as u32;
                folded = lead.follow(buffer, later);
                if folded < later && pacing.frame_lag_us() > 0 {
                    pacing.fold_frame_lag();
                    folded += 1;
                }
            }
            // A report that only slews the schedule by a few milliseconds is routine; the ones
            // that move frames, stop the clock or settle the pacing are the events.
            if outcome.whole_steps != 0
                || outcome.stopped_us != 0
                || outcome.hold_undone_us != 0
                || outcome.settled
            {
                let settled = outcome
                    .settled
                    .then(|| self.log.since_start(tick.start))
                    .flatten();
                let ms = |us: i64| us as f64 / 1000.0;
                self.log.line(
                    tick.current,
                    format_args!(
                        "report through {} ({} turns, median {:+.1} ms, p90 {:+.1} ms): moved \
                         {:+.1} ms ({} steps at once, {} lead frames folded in), clock stopped \
                         {:+.1} ms, hold undone {:.1} ms{}",
                        report.through_step,
                        report.samples,
                        ms(report.median_us.into()),
                        ms(report.p90_us.into()),
                        ms(outcome.correction_us),
                        outcome.whole_steps,
                        folded,
                        ms(outcome.stopped_us),
                        ms(outcome.hold_undone_us),
                        match settled {
                            Some(after) => format!(", settled {after} ms after pacing started"),
                            None => String::new(),
                        },
                    ),
                );
            }
        }
        self.timing_us += pacing.phase_nudge_us(tick.start);
        let owed = pacing.due_turn(tick.start).saturating_sub(tick.newest_sent);
        BeforeSteps {
            scheduled: Some(pacing.target(tick.start, pipe_depth(lead, buffer))),
            owed: u32::try_from(owed).unwrap_or(u32::MAX),
        }
    }

    /// After a tick stepped (or waited at the prediction limit), having reached frame `reached`
    /// with `known_until` the newest step whose turns were all known, under the rollback target
    /// `target`: notes the rollback it ran with, moves the lead when a window says to, takes up a
    /// frame of a rise, and says how the game loop's next step moves. Ticks of the lockstep start
    /// (`start_steps` of them) only start the pacing once it ends.
    pub fn after_steps(
        &mut self,
        tick: &TickInfo,
        start_steps: u32,
        reached: u32,
        known_until: u32,
        target: RollbackTarget,
        lead: &mut Lead,
        buffer: u32,
    ) -> AfterSteps {
        let mut result = AfterSteps::default();
        if tick.current < start_steps {
            return result;
        }
        let lead_before = lead.in_effect(buffer);
        let pipe_before = pipe_depth(lead, buffer);
        let lag_frames = self.pacing.as_ref().map_or(0, |pacing| {
            // The frame being taken up counts as not in effect yet once most of it is still to
            // come: the frames stepped are that much behind where it puts them.
            let step_us = STEP.as_micros() as i64;
            (pacing.frame_lag_us().max(0) + step_us / 2) / step_us
        }) as i32;
        let verdict = self.window.note(
            reached,
            known_until,
            lead.pending(buffer) + lag_frames,
            target,
        );
        if let Some(verdict) = verdict
            && verdict.adjustment != 0
        {
            result.lead_changed = lead.adjust(buffer, verdict.adjustment);
            if lead.in_effect(buffer) < lead_before
                && let Some(pacing) = &mut self.pacing
            {
                pacing.drop_frame_lag();
            }
            if result.lead_changed {
                self.log.line(
                    tick.current,
                    format_args!(
                        "lead {:+} (in effect {lead_before} over a pipe of {pipe_before}, now \
                         {} over {}): window median {}, p90 {}, target {}{}",
                        verdict.adjustment,
                        lead.in_effect(buffer),
                        pipe_depth(lead, buffer),
                        verdict.median,
                        verdict.p90,
                        target.frames,
                        if verdict.ramp { " (opening ramp)" } else { "" },
                    ),
                );
            }
        }
        match &mut self.pacing {
            None => {
                if reached > tick.current {
                    let pacing_buffer =
                        u32::try_from(lead_before + pipe_before as i32).unwrap_or(pipe_before);
                    self.pacing = Some(Pacing::new(tick.current, pacing_buffer, tick.start));
                    self.log.start(tick.start);
                    self.log.line(
                        tick.current,
                        format_args!(
                            "pacing started with a buffer of {pacing_buffer}, lead {lead_before} \
                             to rise by {}",
                            lead.pending(buffer),
                        ),
                    );
                }
            }
            Some(pacing) => {
                if tick.can_run {
                    if pacing.frame_lag_us() <= 0 && lead.follow(buffer, 1) == 1 {
                        pacing.lag_frame();
                        if lead.pending(buffer) == 0 {
                            self.log.line(
                                tick.current,
                                format_args!(
                                    "last frame of a lead rise slewing in, to {} over a pipe of {}",
                                    lead.in_effect(buffer),
                                    pipe_depth(lead, buffer),
                                ),
                            );
                        }
                    }
                    self.timing_us += pacing.slew_frame_lag();
                }
                // A simulation ahead of its schedule (a pipe that just grew, the relay's reports
                // moving its turns later, or a game loop running its ticks early) puts its next
                // step off by a frame at a time until the schedule catches up.
                result.held_back = reached > pacing.target(tick.start, pipe_depth(lead, buffer));
            }
        }
        let caught_up = reached.saturating_sub(tick.current + 1);
        self.log.note_tick(tick, caught_up, result.held_back);
        result.delay_ms = (self.timing_us / 1000) as i32
            + if result.held_back {
                STEP.as_millis() as i32
            } else {
                0
            };
        result
    }
}

/// How many of its own turns this client keeps in flight with `lead` over `buffer`.
fn pipe_depth(lead: &Lead, buffer: u32) -> u32 {
    lead.pipe_depth(buffer, lead.in_effect(buffer))
}

/// What kind of run of ticks the startup log has open.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum TickRun {
    /// Ticks that stepped extra frames to catch up with the schedule (frames the player sees
    /// skipped), counting the frames.
    Skipped,
    /// Ticks after which the next step was put off a frame (frames the player sees repeat).
    Held,
    /// Ticks waiting at the prediction limit, counting the polls.
    Stalled,
}

/// The startup log's state. See the [module docs](self).
struct StartupLog {
    lines: u32,
    /// When pacing started.
    started: Option<Instant>,
    /// The run of ticks of one kind in progress: its kind, the frame it started from, how many
    /// it counts, and when it started.
    run: Option<(TickRun, u32, u32, Instant)>,
}

impl StartupLog {
    const fn new() -> StartupLog {
        StartupLog {
            lines: 0,
            started: None,
            run: None,
        }
    }

    fn start(&mut self, at: Instant) {
        self.started = Some(at);
    }

    /// Milliseconds from the start of pacing to `at`.
    fn since_start(&self, at: Instant) -> Option<u128> {
        self.started
            .map(|started| at.saturating_duration_since(started).as_millis())
    }

    fn line(&mut self, step: u32, what: std::fmt::Arguments) {
        if step >= STARTUP_LOG_STEPS || self.lines >= MAX_STARTUP_LOG_LINES {
            return;
        }
        self.lines += 1;
        let full = match self.lines == MAX_STARTUP_LOG_LINES {
            true => " (startup log full)",
            false => "",
        };
        info!("Startup pacing at frame {step}: {what}{full}");
    }

    /// Notes what a tick did, logging a run of skipped, held or stalled ticks once it ends.
    fn note_tick(&mut self, tick: &TickInfo, caught_up: u32, held_back: bool) {
        let kind = if !tick.can_run {
            Some((TickRun::Stalled, 1))
        } else if caught_up != 0 {
            Some((TickRun::Skipped, caught_up))
        } else if held_back {
            Some((TickRun::Held, 1))
        } else {
            None
        };
        match (&mut self.run, kind) {
            (Some((run, _, count, _)), Some((kind, n))) if *run == kind => *count += n,
            _ => {
                if let Some((run, from, count, since)) = self.run.take() {
                    let ms = tick.start.saturating_duration_since(since).as_millis();
                    let what = match run {
                        TickRun::Skipped => format!("{count} frames skipped catching up"),
                        TickRun::Held => format!("{count} frames held back"),
                        TickRun::Stalled => "stalled at the prediction limit".to_owned(),
                    };
                    self.line(from, format_args!("{what} over {ms} ms"));
                }
                self.run = kind.map(|(kind, n)| (kind, tick.current, n, tick.start));
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    use std::time::Duration;

    use crate::rollback::lead_window::rollback_target_at;

    const BUFFER: u32 = 6;

    /// A client paced from the end of its start, with `BUFFER` turns of buffer and a lead of 5 to
    /// rise to. Its peers' turns all arrive in time, so the lead window says nothing.
    struct Harness {
        pacer: TickPacer,
        lead: Lead,
        now: Instant,
        frame: u32,
        newest_sent: u64,
    }

    /// What one tick did.
    #[derive(Debug)]
    struct Ticked {
        steps: u32,
        held_back: bool,
    }

    impl Harness {
        fn new() -> Harness {
            let mut lead = Lead::new(1);
            lead.set_intended(5);
            let mut harness = Harness {
                pacer: TickPacer::new(),
                lead,
                now: Instant::now(),
                frame: 24,
                newest_sent: 24 + u64::from(BUFFER),
            };
            // The tick that ends the start starts the pacing.
            let ticked = harness.tick(None);
            assert_eq!(ticked.steps, 1);
            assert!(harness.pacer.pacing().is_some());
            harness
        }

        fn lag_us(&self) -> i64 {
            self.pacer.pacing().map_or(0, |x| x.frame_lag_us())
        }

        fn tick(&mut self, report: Option<&LeadReport>) -> Ticked {
            let tick = TickInfo {
                start: self.now,
                current: self.frame,
                can_run: true,
                session_stall: false,
                newest_sent: self.newest_sent,
            };
            let before = self
                .pacer
                .before_steps(&tick, report, &mut self.lead, BUFFER);
            let catch_up = before
                .scheduled
                .map_or(0, |x| x.saturating_sub(self.frame + 1).min(2));
            let steps = 1 + catch_up;
            self.frame += steps;
            // Turns leave on the schedule, or to keep the pipe full.
            let pipe = pipe_depth(&self.lead, BUFFER);
            let in_flight = (self.newest_sent - u64::from(self.frame)) as u32;
            self.newest_sent += u64::from(pipe.saturating_sub(in_flight).max(before.owed));
            let target = rollback_target_at(self.frame, 2, 8, true);
            let after = self.pacer.after_steps(
                &tick,
                24,
                self.frame,
                u32::MAX,
                target,
                &mut self.lead,
                BUFFER,
            );
            let next = STEP.as_millis() as i64 + i64::from(after.delay_ms);
            self.now += Duration::from_millis(next as u64);
            Ticked {
                steps,
                held_back: after.held_back,
            }
        }
    }

    #[test]
    fn a_rise_in_the_lead_is_slewed_in_without_stepping_a_frame_twice() {
        let mut harness = Harness::new();
        let mut ticks = 0;
        while pipe_depth(&harness.lead, BUFFER) > 1 || harness.lag_us() != 0 {
            let ticked = harness.tick(None);
            ticks += 1;
            assert_eq!(
                (ticked.steps, ticked.held_back),
                (1, false),
                "tick {ticks}: {ticked:?}"
            );
            assert!(ticks <= 5 * 11, "a frame of lead takes 11 ticks at most");
        }
        assert_eq!(harness.lead.in_effect(BUFFER), 5);
        // Once it is in, the game runs a frame a step again.
        for tick in 0..100 {
            let ticked = harness.tick(None);
            assert_eq!(
                (ticked.steps, ticked.held_back),
                (1, false),
                "tick {tick}: {ticked:?}"
            );
        }
    }

    #[test]
    fn a_later_schedule_is_folded_into_a_rise_still_being_taken_up() {
        let mut harness = Harness::new();
        for _ in 0..3 {
            harness.tick(None);
        }
        assert!(
            harness.lag_us() > 0,
            "a frame of the rise is being slewed in"
        );
        let lead_before = harness.lead.in_effect(BUFFER);
        let frame_before = harness.frame;
        // The relay's first reports find this client's turns 170 ms early: three whole steps
        // later at once, the rest slewed.
        let report = LeadReport {
            through_step: 26,
            median_us: -170_000,
            p90_us: -170_000,
            samples: 3,
            pause_us: 0,
        };
        let ticked = harness.tick(Some(&report));
        assert_eq!(
            (ticked.steps, ticked.held_back),
            (1, false),
            "the tick steps on as if nothing moved"
        );
        assert_eq!(harness.frame, frame_before + 1);
        assert!(
            harness.lead.in_effect(BUFFER) >= lead_before + 2,
            "the rise's pending frames were taken up against the later schedule"
        );
        for tick in 0..200 {
            let ticked = harness.tick(None);
            assert_eq!(
                (ticked.steps, ticked.held_back),
                (1, false),
                "tick {tick}: {ticked:?}"
            );
        }
        assert_eq!(harness.lead.in_effect(BUFFER), 5);
    }

    #[test]
    fn a_later_schedule_with_no_rise_to_fold_into_holds_frames_back() {
        let mut harness = Harness::new();
        while harness.lead.pending(BUFFER) > 0 || harness.lag_us() != 0 {
            harness.tick(None);
        }
        let report = LeadReport {
            through_step: 26,
            median_us: -130_000,
            p90_us: -130_000,
            samples: 3,
            pause_us: 0,
        };
        let mut held = u32::from(harness.tick(Some(&report)).held_back);
        for _ in 0..10 {
            held += u32::from(harness.tick(None).held_back);
        }
        assert_eq!(held, 3, "three whole steps later, three frames held back");
    }
}
