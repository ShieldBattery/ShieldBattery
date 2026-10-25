//! A deterministic simulation of a two-player rollback game's first half minute, driving the real
//! pacing ([`TickPacer`], and through it [`Pacing`] and [`LeadWindow`]), the real rollback target
//! ([`rollback_target_at`]) and the real lead ([`Lead`]) with synthetic links and a stand-in for the
//! relays' session clock, to measure what players see at the start: frames skipped (a tick stepping
//! more than one frame) and held (a tick putting the next step off a frame).
//!
//! Its models, at a millisecond's resolution:
//!
//! - **Links.** Each player's turns reach their home relay after a fixed uplink, a few of them
//!   later (jitter); the relays forward them at once, across the hop between them, and down to the
//!   other player.
//! - **The session clock.** Step 23's deadline (the lockstep start's last) is placed either where
//!   its turns became confirmable on the authority relay, slot 0's home ([`ClockStart::Authority`])
//!   or at the latest arrival of any slot's turn 23 at its own home relay
//!   ([`ClockStart::HomeRelay`]). Each later step's deadline follows a step after the one before,
//!   and the clock stands still while it would run more than [`STALL_SLACK_STEPS`] past the
//!   newest confirmable step. Each home relay measures its slot's turns against their deadlines
//!   and reports the median and 90th percentile of the last 24 every 12 steps.
//! - **The game loop.** A tick every step, moved by what the pacing asks; a tick stalled at the
//!   prediction limit polls again 3 ms later. Each step takes one of the player's own turns out of
//!   the pipe, and the turns sent after it keep the pipe full or the schedule's sends on time,
//!   whichever is more, as the PIPE hook does.
//!
//! [`TodayPacer`] is the pacing glue as it was before the lead's rise was slewed and folded into
//! later schedules and the ramp out of the opening capped, for the comparison.

use std::collections::VecDeque;
use std::time::{Duration, Instant};

use rally_point_client::proto::messages::LeadReport;

use super::lead_window::{LeadWindow, RollbackTarget, rollback_target_at};
use super::live_pacing::{AfterSteps, BeforeSteps, TickInfo, TickPacer};
use super::pacing::Pacing;
use crate::netcode_v2::Lead;

const STEP_US: i64 = 42_000;
const START_STEPS: u32 = 24;
const LIMIT: u32 = 8;
const CHOSEN_TARGET: u32 = 2;
const STALL_SLACK_STEPS: u32 = 6;
const REPORT_EVERY_STEPS: u32 = 12;
const REPORT_WINDOW: usize = 24;
const STALL_POLL_US: i64 = 3_000;
const MAX_CATCH_UP_PER_TICK: u32 = 2;
const MAX_STALLED_SEND_TURNS: u32 = 48;

/// Where the relays place the session clock's start.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum ClockStart {
    /// Where step 23 became confirmable on the authority relay: a remote slot's turn counts from
    /// when it got there, a hop after it reached its own relay.
    Authority,
    /// At the latest arrival of any slot's turn 23 at its own home relay.
    HomeRelay,
}

/// Which pacing the clients run.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Rules {
    Today,
    Fixed,
}

#[derive(Clone, Copy, Debug)]
struct Jitter {
    /// Percent of turns delayed.
    percent: u32,
    min_us: i64,
    max_us: i64,
}

const NO_JITTER: Jitter = Jitter {
    percent: 0,
    min_us: 0,
    max_us: 0,
};

#[derive(Clone, Copy, Debug)]
struct Scenario {
    name: &'static str,
    /// One-way link to the home relay of each slot, both ways. Slot 0's home is the authority.
    link_us: [i64; 2],
    /// Between the two home relays, 0 when both slots share one.
    hop_us: i64,
    jitter: [Jitter; 2],
    /// The latency buffer the relay starts the session with.
    buffer: u32,
}

/// One tick of one client.
#[derive(Clone, Copy, Debug)]
struct TickRecord {
    at_us: i64,
    /// Frames stepped.
    steps: u32,
    held: bool,
    pipe: u32,
    /// How far the frame shown is past the newest frame whose turns are all known.
    rollback: u32,
    lead_changed: bool,
}

/// Either pacing, behind one interface.
enum Pacer {
    Today(TodayPacer),
    Fixed(TickPacer),
}

impl Pacer {
    fn before_steps(
        &mut self,
        tick: &TickInfo,
        report: Option<&LeadReport>,
        lead: &mut Lead,
        buffer: u32,
    ) -> BeforeSteps {
        match self {
            Pacer::Today(x) => x.before_steps(tick, report, lead, buffer),
            Pacer::Fixed(x) => x.before_steps(tick, report, lead, buffer),
        }
    }

    fn after_steps(
        &mut self,
        tick: &TickInfo,
        reached: u32,
        known_until: u32,
        target: RollbackTarget,
        lead: &mut Lead,
        buffer: u32,
    ) -> AfterSteps {
        match self {
            Pacer::Today(x) => x.after_steps(tick, reached, known_until, target, lead, buffer),
            Pacer::Fixed(x) => x.after_steps(
                tick,
                START_STEPS,
                reached,
                known_until,
                target,
                lead,
                buffer,
            ),
        }
    }

    fn corrected_us(&mut self) -> i64 {
        let counts = match self {
            Pacer::Today(x) => x.pacing.as_mut().map(|x| x.take_counts()),
            Pacer::Fixed(x) => x.take_counts().map(|x| x.0),
        };
        counts.map_or(0, |x| x.corrected_us)
    }
}

/// The pacing glue as the rollback driver ran it before: the lead in effect rose a frame every six
/// ticks, each frame a tick stepping twice; a report moving the schedule later held frames back
/// whatever rise was pending; and the lead came down from the opening up to two frames a window.
struct TodayPacer {
    pacing: Option<Pacing>,
    window: LeadWindow,
    timing_us: i64,
    follow_wait: u32,
}

impl TodayPacer {
    fn new() -> TodayPacer {
        TodayPacer {
            pacing: None,
            window: LeadWindow::new(),
            timing_us: 0,
            follow_wait: 0,
        }
    }

    fn before_steps(
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
            let _ = pacing.on_report(report, tick.newest_sent);
        }
        self.timing_us += pacing.phase_nudge_us(tick.start);
        let owed = pacing.due_turn(tick.start).saturating_sub(tick.newest_sent);
        BeforeSteps {
            scheduled: Some(pacing.target(tick.start, pipe_of(lead, buffer))),
            owed: owed as u32,
        }
    }

    fn after_steps(
        &mut self,
        tick: &TickInfo,
        reached: u32,
        known_until: u32,
        target: RollbackTarget,
        lead: &mut Lead,
        buffer: u32,
    ) -> AfterSteps {
        let mut result = AfterSteps::default();
        if tick.current < START_STEPS {
            return result;
        }
        let lead_before = lead.in_effect(buffer);
        let pipe_before = pipe_of(lead, buffer);
        let uncapped = RollbackTarget {
            frames: target.frames,
            chosen: target.frames,
            after_opening: false,
        };
        let adjustment = self
            .window
            .note(reached, known_until, lead.pending(buffer), uncapped)
            .map_or(0, |x| x.adjustment);
        self.follow_wait += 1;
        let follow = self.follow_wait >= 6;
        if follow {
            self.follow_wait = 0;
        }
        result.lead_changed = adjustment != 0 && lead.adjust(buffer, adjustment);
        if follow {
            lead.follow(buffer, 1);
        }
        match &self.pacing {
            None => {
                if reached > tick.current {
                    let pacing_buffer = (lead_before + pipe_before as i32) as u32;
                    self.pacing = Some(Pacing::new(tick.current, pacing_buffer, tick.start));
                }
            }
            Some(pacing) => result.held_back = reached > pacing.target(tick.start, pipe_before),
        }
        result.delay_ms = (self.timing_us / 1000) as i32 + if result.held_back { 42 } else { 0 };
        result
    }
}

fn pipe_of(lead: &Lead, buffer: u32) -> u32 {
    lead.pipe_depth(buffer, lead.in_effect(buffer))
}

/// A deterministic xorshift32.
struct Random(u32);

impl Random {
    fn next(&mut self) -> u32 {
        self.0 ^= self.0 << 13;
        self.0 ^= self.0 >> 17;
        self.0 ^= self.0 << 5;
        self.0
    }
}

struct Client {
    link_us: i64,
    jitter: Jitter,
    random: Random,
    next_tick_us: i64,
    frame: u32,
    /// When each of this client's turns reached its home relay.
    home_arrivals: Vec<i64>,
    lead: Lead,
    pacer: Pacer,
    reports: VecDeque<(i64, LeadReport)>,
    newest_report: Option<LeadReport>,
    records: Vec<TickRecord>,
    corrected_us: i64,
}

impl Client {
    fn new(link_us: i64, jitter: Jitter, seed: u32, rules: Rules) -> Client {
        let mut lead = Lead::new(1);
        lead.set_intended(rollback_target_at(0, CHOSEN_TARGET, LIMIT, true).frames as i32);
        Client {
            link_us,
            jitter,
            random: Random(seed),
            next_tick_us: 0,
            frame: 0,
            home_arrivals: Vec::new(),
            lead,
            pacer: match rules {
                Rules::Today => Pacer::Today(TodayPacer::new()),
                Rules::Fixed => Pacer::Fixed(TickPacer::new()),
            },
            reports: VecDeque::new(),
            newest_report: None,
            records: Vec::new(),
            corrected_us: 0,
        }
    }

    fn sent(&self) -> u32 {
        self.home_arrivals.len() as u32
    }

    fn send(&mut self, at_us: i64) {
        let mut arrival = at_us + self.link_us;
        if self.jitter.percent != 0 && self.random.next() % 100 < self.jitter.percent {
            let spread = (self.jitter.max_us - self.jitter.min_us) as u32;
            arrival += self.jitter.min_us + i64::from(self.random.next() % (spread + 1));
        }
        self.home_arrivals.push(arrival);
    }

    fn pipe(&self, buffer: u32) -> u32 {
        match self.frame < START_STEPS {
            true => buffer,
            false => pipe_of(&self.lead, buffer),
        }
    }

    /// Runs a tick at `now_us` (since `base`), against the other client's turns reaching this one
    /// at `peer_arrivals`.
    fn tick(&mut self, base: Instant, now_us: i64, peer_arrivals: &[i64], buffer: u32) {
        let known_peer = peer_arrivals.iter().take_while(|&&x| x <= now_us).count() as u32;
        let known_until = known_peer.min(self.sent());
        let current = self.frame;
        let predict_from = buffer.max(2) + 1;
        let limit_at = |step: u32| match step < predict_from.min(START_STEPS) {
            true => 0,
            false => LIMIT,
        };
        let can_run = current < known_until + limit_at(current);
        let target = rollback_target_at(current, CHOSEN_TARGET, LIMIT, true);
        let tick = TickInfo {
            start: base + Duration::from_micros(now_us as u64),
            current,
            can_run,
            session_stall: !can_run,
            newest_sent: u64::from(self.sent()),
        };
        let report = self.newest_report.take();
        let before = self
            .pacer
            .before_steps(&tick, report.as_ref(), &mut self.lead, buffer);
        let mut owed = before.owed;
        let catch_up = match (before.scheduled, can_run) {
            (Some(scheduled), true) => scheduled
                .saturating_sub(current + 1)
                .min(MAX_CATCH_UP_PER_TICK),
            _ => 0,
        };
        let mut steps = 0;
        if can_run {
            for _ in 0..=catch_up {
                if self.frame >= known_until + limit_at(self.frame) {
                    break;
                }
                self.frame += 1;
                steps += 1;
                let in_flight = self.sent() - self.frame;
                let pipe = self.pipe(buffer);
                let wanted = pipe.saturating_sub(in_flight).max(owed);
                let room = (pipe + MAX_STALLED_SEND_TURNS).saturating_sub(in_flight);
                let flushed = wanted.min(room);
                owed = owed.saturating_sub(flushed);
                for _ in 0..flushed {
                    self.send(now_us);
                }
            }
        }
        let reached = self.frame;
        let after =
            self.pacer
                .after_steps(&tick, reached, known_until, target, &mut self.lead, buffer);
        self.corrected_us += self.pacer.corrected_us();
        self.records.push(TickRecord {
            at_us: now_us,
            steps,
            held: after.held_back,
            pipe: self.pipe(buffer),
            rollback: reached.saturating_sub(known_until),
            lead_changed: after.lead_changed,
        });
        self.next_tick_us = match can_run {
            true => now_us + STEP_US + i64::from(after.delay_ms) * 1000,
            false => now_us + STALL_POLL_US,
        };
    }
}

/// The relays' session clock and lateness reports.
struct Relays {
    hop_us: i64,
    start: ClockStart,
    /// Step 23's deadline, once placed.
    anchor: Option<i64>,
    pause_us: i64,
    /// Deadlines from step 23 on.
    deadlines: Vec<i64>,
    /// Each slot's lateness, from step 23 on, in step order.
    lateness: [Vec<i64>; 2],
}

impl Relays {
    /// When `slot`'s turn `step` reached the authority relay.
    fn at_authority(&self, clients: &[Client; 2], slot: usize, step: usize) -> Option<i64> {
        let hop = if slot == 0 { 0 } else { self.hop_us };
        clients[slot].home_arrivals.get(step).map(|x| x + hop)
    }

    fn update(&mut self, clients: &mut [Client; 2], now_us: i64) {
        let last_start = START_STEPS as usize - 1;
        if self.anchor.is_none() {
            let arrivals = [0, 1].map(|slot| {
                self.at_authority(clients, slot, last_start)
                    .filter(|&x| x <= now_us)
            });
            if let [Some(a), Some(b)] = arrivals {
                self.anchor = Some(match self.start {
                    ClockStart::Authority => a.max(b),
                    ClockStart::HomeRelay => clients[0].home_arrivals[last_start]
                        .max(clients[1].home_arrivals[last_start]),
                });
            }
        }
        let Some(anchor) = self.anchor else {
            return;
        };
        let confirmable = (0..2)
            .map(|slot| {
                let hop = if slot == 0 { 0 } else { self.hop_us };
                clients[slot]
                    .home_arrivals
                    .iter()
                    .take_while(|&&x| x + hop <= now_us)
                    .count() as u32
            })
            .min()
            .unwrap_or(0)
            .saturating_sub(1);
        loop {
            let step = START_STEPS - 1 + self.deadlines.len() as u32;
            let nominal = anchor + i64::from(step - (START_STEPS - 1)) * STEP_US + self.pause_us;
            if now_us < nominal {
                break;
            }
            if step > confirmable + STALL_SLACK_STEPS {
                self.pause_us += 1_000;
                break;
            }
            self.deadlines.push(nominal);
            if step.is_multiple_of(REPORT_EVERY_STEPS) {
                for (slot, client) in clients.iter_mut().enumerate() {
                    if let Some(report) = self.report(slot) {
                        let deliver = now_us + client.link_us;
                        client.reports.push_back((deliver, report));
                    }
                }
            }
        }
        for (lateness, client) in self.lateness.iter_mut().zip(clients.iter()) {
            loop {
                let index = lateness.len();
                let step = last_start + index;
                let (Some(&deadline), Some(&arrival)) =
                    (self.deadlines.get(index), client.home_arrivals.get(step))
                else {
                    break;
                };
                if arrival > now_us {
                    break;
                }
                lateness.push(arrival - deadline);
            }
        }
    }

    fn report(&self, slot: usize) -> Option<LeadReport> {
        let measured = &self.lateness[slot];
        if measured.is_empty() {
            return None;
        }
        let mut window: Vec<i64> =
            measured[measured.len().saturating_sub(REPORT_WINDOW)..].to_vec();
        window.sort_unstable();
        let rank = |percent: usize| window[(window.len() * percent).div_ceil(100).max(1) - 1];
        Some(LeadReport {
            through_step: (START_STEPS as usize - 1 + measured.len() - 1) as u64,
            median_us: rank(50) as i32,
            p90_us: rank(90) as i32,
            samples: window.len() as u32,
            pause_us: self.pause_us as u64,
        })
    }
}

/// How long the start of a game counts as its start, for [`Outcome::startup_shown`]: up to where
/// the opening's target starts coming down.
const STARTUP_MS: i64 = 12_000;

/// What one client saw over the simulated stretch.
#[derive(Debug, Default, Clone, Copy)]
struct Outcome {
    /// Frames skipped or held in the game's first [`STARTUP_MS`].
    startup_shown: u32,
    /// Frames skipped: extra frames stepped in a tick.
    skipped: u32,
    /// Ticks that stepped more than one frame.
    doubled: u32,
    held: u32,
    lead_changes: u32,
    worst_rollback: u32,
    /// The pipe 2.5 s in, and when it first reached its floor of 1, in milliseconds.
    pipe_at_2500_ms: u32,
    pipe_floor_at_ms: Option<i64>,
    /// The net schedule correction.
    corrected_ms: i64,
}

fn simulate(scenario: &Scenario, start: ClockStart, rules: Rules, until_ms: i64) -> [Outcome; 2] {
    let base = Instant::now();
    let mut clients = [0, 1].map(|slot| {
        Client::new(
            scenario.link_us[slot],
            scenario.jitter[slot],
            0x9e37_79b9_u32 ^ (slot as u32 + 1).wrapping_mul(0x85eb_ca6b),
            rules,
        )
    });
    let mut relays = Relays {
        hop_us: scenario.hop_us,
        start,
        anchor: None,
        pause_us: 0,
        deadlines: Vec::new(),
        lateness: [Vec::new(), Vec::new()],
    };
    // Both game loops start together, each sending its pipe's worth of turns ahead of its loop.
    for client in &mut clients {
        for _ in 0..scenario.buffer {
            client.send(0);
        }
    }
    for now_ms in 0..until_ms {
        let now_us = now_ms * 1000;
        relays.update(&mut clients, now_us);
        for slot in 0..2 {
            let peer = 1 - slot;
            let to_this = scenario.hop_us + clients[slot].link_us;
            let peer_arrivals: Vec<i64> = clients[peer]
                .home_arrivals
                .iter()
                .map(|x| x + to_this)
                .collect();
            let client = &mut clients[slot];
            while client.reports.front().is_some_and(|x| x.0 <= now_us) {
                client.newest_report = client.reports.pop_front().map(|x| x.1);
            }
            if now_us >= client.next_tick_us {
                client.tick(base, now_us, &peer_arrivals, scenario.buffer);
            }
        }
    }
    clients.map(|client| {
        let mut outcome = Outcome {
            corrected_ms: client.corrected_us / 1000,
            ..Outcome::default()
        };
        for record in &client.records {
            if record.at_us < STARTUP_MS * 1000 {
                outcome.startup_shown += record.steps.saturating_sub(1) + u32::from(record.held);
            }
            outcome.skipped += record.steps.saturating_sub(1);
            outcome.doubled += u32::from(record.steps > 1);
            outcome.held += u32::from(record.held);
            outcome.lead_changes += u32::from(record.lead_changed);
            if record.at_us >= START_STEPS as i64 * STEP_US {
                outcome.worst_rollback = outcome.worst_rollback.max(record.rollback);
            }
            if record.at_us <= 2_500_000 {
                outcome.pipe_at_2500_ms = record.pipe;
            }
            if record.pipe == 1 && outcome.pipe_floor_at_ms.is_none() {
                outcome.pipe_floor_at_ms = Some(record.at_us / 1000);
            }
        }
        outcome
    })
}

const SCENARIOS: [Scenario; 4] = [
    // KR (slot 0, the authority's) against Sao Paulo, with one side's link jittery.
    Scenario {
        name: "far, jittery",
        link_us: [2_000, 28_000],
        hop_us: 147_000,
        jitter: [
            Jitter {
                percent: 4,
                min_us: 20_000,
                max_us: 80_000,
            },
            NO_JITTER,
        ],
        buffer: 6,
    },
    Scenario {
        name: "cross-region, clean",
        link_us: [30_000, 30_000],
        hop_us: 100_000,
        jitter: [NO_JITTER, NO_JITTER],
        buffer: 5,
    },
    Scenario {
        name: "same region",
        link_us: [5_000, 5_000],
        hop_us: 0,
        jitter: [NO_JITTER, NO_JITTER],
        buffer: 1,
    },
    Scenario {
        name: "same relay, one jittery player",
        link_us: [5_000, 5_000],
        hop_us: 0,
        jitter: [
            Jitter {
                percent: 10,
                min_us: 20_000,
                max_us: 80_000,
            },
            NO_JITTER,
        ],
        buffer: 1,
    },
];

/// How long each run covers: the game's first 30 s.
const RUN_MS: i64 = 30_000;

#[test]
fn startup_pacing_ab() {
    let mut table = String::new();
    for scenario in &SCENARIOS {
        for start in [ClockStart::Authority, ClockStart::HomeRelay] {
            for rules in [Rules::Today, Rules::Fixed] {
                let outcomes = simulate(scenario, start, rules, RUN_MS);
                for (slot, x) in outcomes.iter().enumerate() {
                    table.push_str(&format!(
                        "{:<30} {:<9} {:<5} slot {slot}: first 12 s {:>2} | 30 s: skipped {:>2} \
                         (doubled ticks {:>2}), held {:>2}, lead changes {:>2}, worst rollback {}, \
                         pipe at 2.5 s {}, pipe floor at {:>5} ms, schedule moved {:+} ms\n",
                        scenario.name,
                        format!("{start:?}"),
                        format!("{rules:?}"),
                        x.startup_shown,
                        x.skipped,
                        x.doubled,
                        x.held,
                        x.lead_changes,
                        x.worst_rollback,
                        x.pipe_at_2500_ms,
                        x.pipe_floor_at_ms
                            .map_or("never".to_owned(), |x| x.to_string()),
                        x.corrected_ms,
                    ));
                }
            }
        }
    }
    println!("{table}");
    let run = |name: &str, start, rules| {
        let scenario = SCENARIOS.iter().find(|x| x.name == name).unwrap();
        simulate(scenario, start, rules, RUN_MS)
    };

    // The simulation reproduces the reported start: each player skips and holds frames over and
    // over in the first seconds.
    for x in run("far, jittery", ClockStart::Authority, Rules::Today) {
        assert!(x.startup_shown >= 6, "far, jittery today: {x:?}\n{table}");
    }
    for start in [ClockStart::Authority, ClockStart::HomeRelay] {
        // With the client's pacing fixed, nothing shows at the start whichever way the relays
        // start the clock: the delay cut is slewed, and the clock's correction is folded into it.
        for x in run("far, jittery", start, Rules::Fixed) {
            assert_eq!(
                x.startup_shown, 0,
                "far, jittery, {start:?}: {x:?}\n{table}"
            );
        }
        // What is left of the first half minute is the opening's delay given back a frame a
        // window.
        for x in run("cross-region, clean", start, Rules::Fixed) {
            assert!(
                x.skipped + x.held <= 1 && x.doubled == 0,
                "cross-region, {start:?}: {x:?}\n{table}"
            );
        }
    }
    let shown = |x: &Outcome| x.skipped + x.held;
    let today = run("same region", ClockStart::Authority, Rules::Today);
    for start in [ClockStart::Authority, ClockStart::HomeRelay] {
        let fixed = run("same region", start, Rules::Fixed);
        for slot in 0..2 {
            assert!(shown(&fixed[slot]) <= 1, "same region: {fixed:?}\n{table}");
            assert_eq!(
                shown(&fixed[slot]),
                shown(&today[slot]),
                "same region is unchanged: {fixed:?} against {today:?}\n{table}"
            );
        }
    }
    let today = run(
        "same relay, one jittery player",
        ClockStart::Authority,
        Rules::Today,
    );
    let fixed = run(
        "same relay, one jittery player",
        ClockStart::HomeRelay,
        Rules::Fixed,
    );
    for slot in 0..2 {
        assert!(
            fixed[slot].lead_changes <= today[slot].lead_changes,
            "jittery player, lead changes: {fixed:?} against {today:?}\n{table}"
        );
    }
}
