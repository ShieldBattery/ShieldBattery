//! Observation-only network-stats instrumentation for the `/netstat` overlay.
//!
//! [`NetStats`] is owned by [`TurnState`](super::TurnState) and touched only from the BW/sync thread,
//! the same as the rest of the turn state — except [`record_rehome`](NetStats::record_rehome), which
//! the re-home provider drives from the async thread while it holds the turn-state lock. Every method
//! here records or reads; none of it feeds back into turn/sim behavior, so the instrumentation cannot
//! change what the game does — it only watches. The rings are bounded (per-slot events to
//! [`HISTORY_HORIZON`], the sampled strips and the event ticker to fixed entry caps) so a long game
//! can't grow them without bound, and each record path is a small push plus a bounded prune on the
//! hot receive path.
//!
//! The read models ([`NetStatsStatus`] / [`NetStatRow`]) are plain data carrying only ids, mirroring
//! [`DisconnectStatus`](super::DisconnectStatus): the draw-side adapter resolves each slot's user id
//! to a display name, formats each event into a line, and normalizes it into the overlay-ui
//! view-model.

use std::collections::VecDeque;
use std::time::{Duration, Instant};

use rally_point_client::proto::ids::SlotId;

use crate::app_messages::SbUserId;
use crate::bw;
use crate::bw::players::StormPlayerId;

/// The rolling window over which a slot's "recent" stall and inter-arrival-gap figures are computed.
const RECENT_WINDOW: Duration = Duration::from_secs(60);
/// How far back the per-slot event rings retain data before pruning — roughly the last five minutes,
/// enough to cover the recent window with margin while bounding memory on a long game.
const HISTORY_HORIZON: Duration = Duration::from_secs(300);
/// EWMA smoothing factor for a slot's inter-arrival interval: each new interval contributes this
/// fraction, so the estimate tracks recent pacing without swinging on a single outlier.
const EWMA_ALPHA: f64 = 0.2;
/// Cap on the own-link transition ring.
const LINK_HISTORY_CAP: usize = 128;
/// Cadence of the time-sampled history strips: one sample per second, no more.
const SAMPLE_INTERVAL: Duration = Duration::from_secs(1);
/// Fixed capacity of each history strip's ring — two minutes of once-a-second samples.
const STRIP_CAPACITY: usize = 120;
/// How many recent events the ticker retains, oldest dropped first.
const EVENT_CAP: usize = 5;

/// One remote slot's instrumentation: turn-arrival pacing and sim-stall attribution.
#[derive(Default)]
struct SlotStats {
    /// When this slot's most recent turn arrived.
    last_arrival: Option<Instant>,
    /// The EWMA of this slot's inter-arrival interval, once at least two turns have arrived.
    ewma_interval: Option<Duration>,
    /// `(arrival instant, interval since the previous arrival)` for each arrival, pruned to
    /// [`HISTORY_HORIZON`]; the recent max gap is the largest interval within [`RECENT_WINDOW`].
    arrivals: VecDeque<(Instant, Duration)>,
    /// Total stall time attributed to this slot from *closed* episodes over the game's life.
    cumulative_stall: Duration,
    /// `(episode end, duration)` for each closed episode, pruned to [`HISTORY_HORIZON`]; the recent
    /// stall is the sum of durations whose end falls within [`RECENT_WINDOW`].
    recent_stalls: VecDeque<(Instant, Duration)>,
    /// How many distinct stall episodes this slot has caused (each blocking→unblocking cycle).
    episode_count: u32,
    /// When the currently-open episode began, while the sim is blocked on this slot right now.
    episode_start: Option<Instant>,
}

impl SlotStats {
    /// Records that a turn for this slot just arrived at `now`, updating its inter-arrival pacing.
    fn record_arrival(&mut self, now: Instant) {
        if let Some(prev) = self.last_arrival {
            let interval = now.saturating_duration_since(prev);
            self.ewma_interval = Some(match self.ewma_interval {
                Some(cur) => ewma(cur, interval),
                None => interval,
            });
            self.arrivals.push_back((now, interval));
        }
        self.last_arrival = Some(now);
        self.prune(now);
    }

    /// Applies this slot's blocking state for the current receive poll: opening a new episode the
    /// first poll it blocks the sim, and closing the open one (accruing its duration) the first poll
    /// it no longer does.
    fn set_blocking(&mut self, blocking: bool, now: Instant) {
        if blocking {
            if self.episode_start.is_none() {
                self.episode_start = Some(now);
                self.episode_count += 1;
            }
        } else if let Some(start) = self.episode_start.take() {
            let duration = now.saturating_duration_since(start);
            self.cumulative_stall += duration;
            self.recent_stalls.push_back((now, duration));
        }
        self.prune(now);
    }

    /// Drops per-slot ring entries older than [`HISTORY_HORIZON`].
    fn prune(&mut self, now: Instant) {
        let stale = |t: Instant| now.saturating_duration_since(t) > HISTORY_HORIZON;
        while self.arrivals.front().is_some_and(|&(t, _)| stale(t)) {
            self.arrivals.pop_front();
        }
        while self.recent_stalls.front().is_some_and(|&(t, _)| stale(t)) {
            self.recent_stalls.pop_front();
        }
    }

    /// The largest inter-arrival gap this slot recorded within `window` of `now`, or zero if it saw
    /// no arrival in that window. A stall shows up here the instant the delayed turn lands, since its
    /// long interval is recorded at that arrival.
    fn max_gap_within(&self, now: Instant, window: Duration) -> Duration {
        self.arrivals
            .iter()
            .filter(|&&(t, _)| now.saturating_duration_since(t) <= window)
            .map(|&(_, d)| d)
            .max()
            .unwrap_or(Duration::ZERO)
    }

    /// A read of this slot's stats at `now`. In-progress stall time (the open episode) is folded into
    /// both the recent and lifetime totals so a live stall visibly grows rather than only appearing
    /// once it ends.
    fn view(&self, now: Instant) -> SlotStatView {
        let in_progress = self
            .episode_start
            .map_or(Duration::ZERO, |start| now.saturating_duration_since(start));
        let recent_stall: Duration = self
            .recent_stalls
            .iter()
            .filter(|&&(t, _)| now.saturating_duration_since(t) <= RECENT_WINDOW)
            .map(|&(_, d)| d)
            .sum::<Duration>()
            + in_progress;
        let lifetime_stall = self.cumulative_stall + in_progress;
        let max_gap = self.max_gap_within(now, RECENT_WINDOW);
        SlotStatView {
            last_turn_age: self.last_arrival.map(|t| now.saturating_duration_since(t)),
            ewma_interval: self.ewma_interval,
            max_gap,
            recent_stall,
            lifetime_stall,
            episode_count: self.episode_count,
        }
    }
}

/// Blends a new inter-arrival interval into the running EWMA at [`EWMA_ALPHA`].
fn ewma(current: Duration, sample: Duration) -> Duration {
    let blended = current.as_secs_f64() * (1.0 - EWMA_ALPHA) + sample.as_secs_f64() * EWMA_ALPHA;
    Duration::from_secs_f64(blended.max(0.0))
}

/// A point-in-time read of one slot's arrival and stall figures.
#[derive(Default, Clone, Copy)]
pub struct SlotStatView {
    pub last_turn_age: Option<Duration>,
    pub ewma_interval: Option<Duration>,
    pub max_gap: Duration,
    pub recent_stall: Duration,
    pub lifetime_stall: Duration,
    pub episode_count: u32,
}

/// A single notable moment in the session's network life, for the recent-events ticker. Timestamped
/// with an [`Instant`] internally; the elapsed-since-game-start figure the overlay shows is derived
/// at read (see [`NetStats::recent_events`]).
#[derive(Clone, Copy)]
pub enum NetEvent {
    /// The latency buffer depth changed from `from` to `to` turns.
    BufferChanged { from: u32, to: u32 },
    /// This client's own relay link went down.
    LinkLost,
    /// This client's own relay link came back after being down for `outage`.
    LinkRestored { outage: Duration },
    /// The session re-homed off a dead relay, from `from` to `to`.
    Rehomed { from: u64, to: u64 },
}

/// One entry of the recent-events ticker: an event and how long into the game it happened.
#[derive(Clone, Copy)]
pub struct NetEventEntry {
    /// Time since game start when the event happened.
    pub elapsed: Duration,
    pub event: NetEvent,
}

/// All of the `/netstat` overlay's instrumentation, owned by the turn state. Records on the receive
/// hot path (arrivals, stall attribution, the once-a-second strip sample), the directive-apply step
/// (buffer changes), the connectivity pump (own-link transitions), and the re-home provider (relay
/// moves); read when the overlay builds its view or `queryState` snapshots.
pub struct NetStats {
    /// Per-storm-slot stats, indexed by storm id.
    slots: [SlotStats; bw::MAX_STORM_PLAYERS],
    /// The rally-point2 session id, seeded from the launch handoff's signed token.
    session_id: u64,
    /// This client's current home relay id. Seeded at session establish and advanced by
    /// [`record_rehome`](Self::record_rehome) on each move — so it is live truth, not launch state.
    relay_id: u64,
    /// The current relay's region label, or `None` when the setup carried none.
    region: Option<String>,
    /// When this instrumentation was created (session establish). The fallback origin for event
    /// timestamps before [`game_start`](Self::game_start) is latched.
    created_at: Instant,
    /// When the first in-game strip sample was taken, latched once — effectively game start, since
    /// sampling is driven from the in-game receive poll. Events time their `mm:ss` from here.
    game_start: Option<Instant>,
    /// When the most recent strip sample was taken, gating sampling to [`SAMPLE_INTERVAL`].
    last_sample: Option<Instant>,
    /// The buffer depth (in turns) currently in force.
    buffer_turns: u32,
    /// How many times the buffer depth has changed since the game started.
    buffer_change_count: u32,
    /// When the buffer depth most recently changed, or `None` if it never has.
    last_buffer_change: Option<Instant>,
    /// Buffer depth sampled once per second, oldest first, capped at [`STRIP_CAPACITY`].
    buffer_samples: VecDeque<u32>,
    /// The worst remote per-slot arrival gap in each one-second window, oldest first, capped at
    /// [`STRIP_CAPACITY`].
    gap_samples: VecDeque<Duration>,
    /// Whether this client's own relay link is currently up.
    link_up: bool,
    /// How many times the own link has gone down since the game started.
    link_down_count: u32,
    /// When the own link last went down while it is still down, for the outage figure on restore.
    link_down_since: Option<Instant>,
    /// `(instant, up)` own-link transitions, capped at [`LINK_HISTORY_CAP`].
    link_history: VecDeque<(Instant, bool)>,
    /// The recent-events ticker, oldest first, capped at [`EVENT_CAP`].
    events: VecDeque<(Instant, NetEvent)>,
}

impl NetStats {
    /// Builds the instrumentation with the pipe's starting buffer depth. Identity (session / relay /
    /// region) is unknown until [`set_identity`](Self::set_identity) seeds it from the launch handoff;
    /// it defaults to zero ids and no region so a sessionless game reads harmlessly.
    pub fn new(initial_buffer_turns: u32, now: Instant) -> Self {
        NetStats {
            slots: std::array::from_fn(|_| SlotStats::default()),
            session_id: 0,
            relay_id: 0,
            region: None,
            created_at: now,
            game_start: None,
            last_sample: None,
            buffer_turns: initial_buffer_turns,
            buffer_change_count: 0,
            last_buffer_change: None,
            buffer_samples: VecDeque::new(),
            gap_samples: VecDeque::new(),
            link_up: true,
            link_down_count: 0,
            link_down_since: None,
            link_history: VecDeque::new(),
            events: VecDeque::new(),
        }
    }

    /// Seeds the identity the operator header carries: the session id, this client's home relay id at
    /// session create, and that relay's region. Called once from session establish.
    pub fn set_identity(&mut self, session_id: u64, relay_id: u64, region: Option<String>) {
        self.session_id = session_id;
        self.relay_id = relay_id;
        self.region = region;
    }

    /// Records a turn arrival for a storm slot.
    pub fn record_arrival(&mut self, storm: StormPlayerId, now: Instant) {
        if let Some(slot) = self.slots.get_mut(storm.0 as usize) {
            slot.record_arrival(now);
        }
    }

    /// Applies the current receive poll's per-slot blocking mask (indexed by storm id), advancing
    /// each slot's stall-episode accounting.
    pub fn note_blocking(&mut self, blocking: &[bool; bw::MAX_STORM_PLAYERS], now: Instant) {
        for (storm, slot) in self.slots.iter_mut().enumerate() {
            slot.set_blocking(blocking[storm], now);
        }
    }

    /// Takes a once-a-second sample of the history strips — buffer depth and worst per-slot arrival
    /// gap — into their fixed rings. Latches game start on the first call and gates every call to at
    /// most one sample per [`SAMPLE_INTERVAL`], so it is cheap to call every receive poll. A gated
    /// call (less than a second since the last sample) is a no-op.
    pub fn sample(&mut self, now: Instant) {
        if self.game_start.is_none() {
            self.game_start = Some(now);
        }
        if let Some(last) = self.last_sample
            && now.saturating_duration_since(last) < SAMPLE_INTERVAL
        {
            return;
        }
        self.last_sample = Some(now);

        self.buffer_samples.push_back(self.buffer_turns);
        while self.buffer_samples.len() > STRIP_CAPACITY {
            self.buffer_samples.pop_front();
        }

        let gap = self.worst_gap(now);
        self.gap_samples.push_back(gap);
        while self.gap_samples.len() > STRIP_CAPACITY {
            self.gap_samples.pop_front();
        }
    }

    /// The worst per-slot arrival gap across every slot within the last sample window at `now`.
    fn worst_gap(&self, now: Instant) -> Duration {
        self.slots
            .iter()
            .map(|slot| slot.max_gap_within(now, SAMPLE_INTERVAL))
            .max()
            .unwrap_or(Duration::ZERO)
    }

    /// Re-seeds the current buffer depth WITHOUT recording a change: no counter moves, no timestamp
    /// updates, no ticker event fires. For the session's relay-computed initial depth, stamped before
    /// the first frame — the buffer strip should simply start at this depth rather than show it as a
    /// mid-game correction. Use [`record_buffer`](Self::record_buffer) for an actual in-game change.
    pub fn seed_buffer_turns(&mut self, value: u32) {
        self.buffer_turns = value;
    }

    /// Records a buffer-depth change (a relay directive that actually moved the depth). A no-op when
    /// the value is unchanged, so a redundant directive doesn't inflate the change count or push a
    /// spurious event.
    pub fn record_buffer(&mut self, value: u32, now: Instant) {
        if value == self.buffer_turns {
            return;
        }
        let from = self.buffer_turns;
        self.buffer_turns = value;
        self.buffer_change_count += 1;
        self.last_buffer_change = Some(now);
        self.push_event(now, NetEvent::BufferChanged { from, to: value });
    }

    /// Records the own-link state, capturing a transition and the event it produces (a loss, or a
    /// restore with the outage it just ended). A no-op when the state is unchanged.
    pub fn record_link(&mut self, up: bool, now: Instant) {
        if up == self.link_up {
            return;
        }
        self.link_up = up;
        if up {
            let outage = self
                .link_down_since
                .take()
                .map_or(Duration::ZERO, |since| now.saturating_duration_since(since));
            self.push_event(now, NetEvent::LinkRestored { outage });
        } else {
            self.link_down_count += 1;
            self.link_down_since = Some(now);
            self.push_event(now, NetEvent::LinkLost);
        }
        self.link_history.push_back((now, up));
        while self.link_history.len() > LINK_HISTORY_CAP {
            self.link_history.pop_front();
        }
    }

    /// Adopts a new current relay id after a successful re-home, recording the move as an event. A
    /// no-op when the id is unchanged. Driven from the async re-home provider (which holds the
    /// turn-state lock across the call), so the header's relay id tracks re-homes live. The region
    /// label is dropped: a re-home descriptor names no region, so the replacement relay's is unknown,
    /// and a stale label would mislead.
    pub fn record_rehome(&mut self, new_relay_id: u64, now: Instant) {
        if new_relay_id == self.relay_id {
            return;
        }
        let from = self.relay_id;
        self.relay_id = new_relay_id;
        self.region = None;
        self.push_event(
            now,
            NetEvent::Rehomed {
                from,
                to: new_relay_id,
            },
        );
    }

    /// Appends an event to the ticker ring, dropping the oldest once it is full.
    fn push_event(&mut self, now: Instant, event: NetEvent) {
        self.events.push_back((now, event));
        while self.events.len() > EVENT_CAP {
            self.events.pop_front();
        }
    }

    pub fn session_id(&self) -> u64 {
        self.session_id
    }

    pub fn relay_id(&self) -> u64 {
        self.relay_id
    }

    pub fn region(&self) -> Option<&str> {
        self.region.as_deref()
    }

    pub fn buffer_turns(&self) -> u32 {
        self.buffer_turns
    }

    pub fn buffer_change_count(&self) -> u32 {
        self.buffer_change_count
    }

    /// Time since the most recent buffer-depth change, or `None` if it has never changed.
    pub fn buffer_last_change(&self, now: Instant) -> Option<Duration> {
        self.last_buffer_change
            .map(|t| now.saturating_duration_since(t))
    }

    pub fn link_up(&self) -> bool {
        self.link_up
    }

    pub fn link_down_count(&self) -> u32 {
        self.link_down_count
    }

    /// Time since the most recent own-link transition, or `None` if it has never changed.
    pub fn link_last_change(&self, now: Instant) -> Option<Duration> {
        self.link_history
            .back()
            .map(|&(t, _)| now.saturating_duration_since(t))
    }

    /// A read of one storm slot's stats at `now`; a default (all-zero) read for an out-of-range slot.
    pub fn slot_view(&self, storm: StormPlayerId, now: Instant) -> SlotStatView {
        self.slots
            .get(storm.0 as usize)
            .map(|slot| slot.view(now))
            .unwrap_or_default()
    }

    /// The buffer-depth history strip: one sample per second, oldest first.
    pub fn buffer_samples(&self) -> Vec<u32> {
        self.buffer_samples.iter().copied().collect()
    }

    /// The worst-arrival-gap history strip: one sample per second, oldest first.
    pub fn gap_samples(&self) -> Vec<Duration> {
        self.gap_samples.iter().copied().collect()
    }

    /// The recent-events ticker, oldest first, each timed from game start (or session establish
    /// before the first sample latched game start).
    pub fn recent_events(&self) -> Vec<NetEventEntry> {
        let origin = self.game_start.unwrap_or(self.created_at);
        self.events
            .iter()
            .map(|&(t, event)| NetEventEntry {
                elapsed: t.saturating_duration_since(origin),
                event,
            })
            .collect()
    }
}

/// A render-side snapshot of the session's network health, for the `/netstat` overlay. Built by
/// [`TurnState::net_stats_status`](super::TurnState::net_stats_status) and read from the draw thread;
/// it names peers only by user id (resolved to a display name at render time) and carries the strips
/// and events as plain data, so the draw-side adapter only resolves names and formats event lines.
pub struct NetStatsStatus {
    pub session_id: u64,
    pub relay_id: u64,
    pub region: Option<String>,
    pub buffer_turns: u32,
    pub buffer_change_count: u32,
    pub buffer_last_change: Option<Duration>,
    pub link_up: bool,
    pub link_down_count: u32,
    pub link_last_change: Option<Duration>,
    /// The buffer-depth history strip (see [`NetStats::buffer_samples`]).
    pub buffer_samples: Vec<u32>,
    /// The worst-arrival-gap history strip (see [`NetStats::gap_samples`]).
    pub gap_samples: Vec<Duration>,
    /// The recent-events ticker (see [`NetStats::recent_events`]).
    pub events: Vec<NetEventEntry>,
    /// One row per remote roster slot with a storm mapping.
    pub rows: Vec<NetStatRow>,
}

/// One remote slot's row within a [`NetStatsStatus`]: the slot and its occupant, that slot's home
/// relay at session create, plus its arrival/stall figures.
pub struct NetStatRow {
    pub slot: SlotId,
    pub user_id: SbUserId,
    /// The slot's home relay id at session create, or `None` when the setup carried none.
    pub home_relay_id: Option<u64>,
    /// The slot's home relay region at session create, or `None` when the setup carried none.
    pub home_region: Option<String>,
    pub stats: SlotStatView,
}

#[cfg(test)]
mod tests {
    use super::*;

    const STORM: StormPlayerId = StormPlayerId(1);

    fn blocking_only(storm: usize) -> [bool; bw::MAX_STORM_PLAYERS] {
        let mut mask = [false; bw::MAX_STORM_PLAYERS];
        mask[storm] = true;
        mask
    }

    #[test]
    fn a_stall_episode_accrues_its_duration_and_counts_once() {
        let t0 = Instant::now();
        let mut stats = NetStats::new(2, t0);
        let blocked = blocking_only(STORM.0 as usize);
        let clear = [false; bw::MAX_STORM_PLAYERS];

        // Blocking across two polls is one open episode; unblocking closes it with the full span.
        stats.note_blocking(&blocked, t0);
        stats.note_blocking(&blocked, t0 + Duration::from_millis(100));
        stats.note_blocking(&clear, t0 + Duration::from_millis(300));

        let view = stats.slot_view(STORM, t0 + Duration::from_millis(300));
        assert_eq!(view.episode_count, 1);
        assert_eq!(view.lifetime_stall, Duration::from_millis(300));
        assert_eq!(view.recent_stall, Duration::from_millis(300));
    }

    #[test]
    fn an_open_episode_is_folded_into_the_live_totals() {
        let t0 = Instant::now();
        let mut stats = NetStats::new(2, t0);
        stats.note_blocking(&blocking_only(STORM.0 as usize), t0);

        // Read mid-stall: the in-progress episode contributes its elapsed time so it grows live.
        let view = stats.slot_view(STORM, t0 + Duration::from_millis(200));
        assert_eq!(view.episode_count, 1);
        assert_eq!(view.lifetime_stall, Duration::from_millis(200));
    }

    #[test]
    fn a_separate_block_after_a_clear_counts_as_a_second_episode() {
        let t0 = Instant::now();
        let mut stats = NetStats::new(2, t0);
        let blocked = blocking_only(STORM.0 as usize);
        let clear = [false; bw::MAX_STORM_PLAYERS];

        stats.note_blocking(&blocked, t0);
        stats.note_blocking(&clear, t0 + Duration::from_millis(100));
        stats.note_blocking(&blocked, t0 + Duration::from_millis(500));
        stats.note_blocking(&clear, t0 + Duration::from_millis(700));

        let view = stats.slot_view(STORM, t0 + Duration::from_millis(700));
        assert_eq!(view.episode_count, 2);
        assert_eq!(view.lifetime_stall, Duration::from_millis(300));
    }

    #[test]
    fn buffer_changes_count_and_collapse_duplicates() {
        let t0 = Instant::now();
        let mut stats = NetStats::new(2, t0);

        // The starting value is not a change.
        stats.record_buffer(2, t0 + Duration::from_secs(1));
        assert_eq!(stats.buffer_change_count(), 0);
        assert_eq!(stats.buffer_last_change(t0 + Duration::from_secs(1)), None);

        stats.record_buffer(4, t0 + Duration::from_secs(2));
        assert_eq!(stats.buffer_change_count(), 1);
        assert_eq!(stats.buffer_turns(), 4);

        // A redundant directive for the current value neither counts nor re-timestamps.
        stats.record_buffer(4, t0 + Duration::from_secs(3));
        assert_eq!(stats.buffer_change_count(), 1);
        assert_eq!(
            stats.buffer_last_change(t0 + Duration::from_secs(4)),
            Some(Duration::from_secs(2))
        );
    }

    #[test]
    fn link_downs_count_only_on_a_down_transition() {
        let t0 = Instant::now();
        let mut stats = NetStats::new(2, t0);
        assert!(stats.link_up());
        assert_eq!(stats.link_last_change(t0), None);

        // A redundant "up" is a no-op; a down counts; back up doesn't add to the down count.
        stats.record_link(true, t0 + Duration::from_secs(1));
        assert_eq!(stats.link_down_count(), 0);
        stats.record_link(false, t0 + Duration::from_secs(2));
        assert_eq!(stats.link_down_count(), 1);
        assert!(!stats.link_up());
        stats.record_link(true, t0 + Duration::from_secs(3));
        assert_eq!(stats.link_down_count(), 1);
        assert_eq!(
            stats.link_last_change(t0 + Duration::from_secs(5)),
            Some(Duration::from_secs(2))
        );
    }

    #[test]
    fn arrivals_track_age_and_ewma_after_a_second_turn() {
        let t0 = Instant::now();
        let mut stats = NetStats::new(2, t0);

        stats.record_arrival(STORM, t0);
        let view = stats.slot_view(STORM, t0 + Duration::from_millis(30));
        assert_eq!(view.last_turn_age, Some(Duration::from_millis(30)));
        // A single arrival has no interval yet.
        assert_eq!(view.ewma_interval, None);
        assert_eq!(view.max_gap, Duration::ZERO);

        stats.record_arrival(STORM, t0 + Duration::from_millis(50));
        let view = stats.slot_view(STORM, t0 + Duration::from_millis(50));
        assert_eq!(view.last_turn_age, Some(Duration::ZERO));
        // First interval seeds the EWMA directly at the sample.
        assert_eq!(view.ewma_interval, Some(Duration::from_millis(50)));
        assert_eq!(view.max_gap, Duration::from_millis(50));
    }

    #[test]
    fn sampling_is_gated_to_one_entry_per_second() {
        let t0 = Instant::now();
        let mut stats = NetStats::new(3, t0);

        // The first sample always lands and latches game start.
        stats.sample(t0);
        assert_eq!(stats.buffer_samples(), vec![3]);

        // A second call under a second later is gated out.
        stats.sample(t0 + Duration::from_millis(400));
        stats.sample(t0 + Duration::from_millis(999));
        assert_eq!(stats.buffer_samples(), vec![3]);

        // A full second on lands the next sample, and picks up the current buffer depth.
        stats.record_buffer(5, t0 + Duration::from_millis(1200));
        stats.sample(t0 + Duration::from_millis(1000));
        assert_eq!(stats.buffer_samples(), vec![3, 5]);
    }

    #[test]
    fn strip_rings_hold_a_fixed_capacity() {
        let t0 = Instant::now();
        let mut stats = NetStats::new(2, t0);

        // Far more than the cap, one sample per second apart, so none is gated out.
        for i in 0..(STRIP_CAPACITY as u64 + 40) {
            stats.sample(t0 + Duration::from_secs(i));
        }
        assert_eq!(stats.buffer_samples().len(), STRIP_CAPACITY);
        assert_eq!(stats.gap_samples().len(), STRIP_CAPACITY);
    }

    #[test]
    fn the_gap_strip_reports_the_worst_slot_gap_in_the_last_second() {
        let t0 = Instant::now();
        let mut stats = NetStats::new(2, t0);

        // Two arrivals 700ms apart record a 700ms interval at the second arrival.
        stats.record_arrival(STORM, t0);
        stats.record_arrival(STORM, t0 + Duration::from_millis(700));

        // Sampling right after sees that 700ms gap in the last-second window.
        stats.sample(t0 + Duration::from_millis(700));
        assert_eq!(stats.gap_samples(), vec![Duration::from_millis(700)]);

        // A second later, the 700ms interval has aged out of the window, so the gap reads zero.
        stats.sample(t0 + Duration::from_millis(2000));
        assert_eq!(
            stats.gap_samples(),
            vec![Duration::from_millis(700), Duration::ZERO]
        );
    }

    #[test]
    fn the_event_ring_keeps_the_five_newest_oldest_first() {
        let t0 = Instant::now();
        let mut stats = NetStats::new(2, t0);
        stats.set_identity(42, 1, Some("local-a".to_string()));
        // Latch game start at t0 so event elapsed reads from there.
        stats.sample(t0);

        // Seven events; only the five newest survive, in chronological order.
        stats.record_buffer(3, t0 + Duration::from_secs(1));
        stats.record_buffer(4, t0 + Duration::from_secs(2));
        stats.record_link(false, t0 + Duration::from_secs(3));
        stats.record_link(true, t0 + Duration::from_secs(5));
        stats.record_rehome(2, t0 + Duration::from_secs(8));
        stats.record_buffer(5, t0 + Duration::from_secs(9));
        stats.record_buffer(6, t0 + Duration::from_secs(10));

        let events = stats.recent_events();
        assert_eq!(events.len(), EVENT_CAP);
        // The two earliest buffer changes (to 3 and to 4) were dropped; the oldest survivor is the
        // link loss at 3s.
        assert!(matches!(events[0].event, NetEvent::LinkLost));
        assert_eq!(events[0].elapsed, Duration::from_secs(3));
        assert!(matches!(
            events[1].event,
            NetEvent::LinkRestored {
                outage
            } if outage == Duration::from_secs(2)
        ));
        assert!(matches!(
            events[2].event,
            NetEvent::Rehomed { from: 1, to: 2 }
        ));
        assert!(matches!(
            events[4].event,
            NetEvent::BufferChanged { from: 5, to: 6 }
        ));
    }

    #[test]
    fn a_rehome_advances_the_current_relay_id() {
        let t0 = Instant::now();
        let mut stats = NetStats::new(2, t0);
        stats.set_identity(7, 1, None);
        assert_eq!(stats.relay_id(), 1);

        stats.record_rehome(4, t0 + Duration::from_secs(30));
        assert_eq!(stats.relay_id(), 4);

        // A redundant re-home to the current relay neither moves the id nor logs an event.
        stats.record_rehome(4, t0 + Duration::from_secs(31));
        assert_eq!(stats.relay_id(), 4);
        assert_eq!(stats.recent_events().len(), 1);
    }
}
