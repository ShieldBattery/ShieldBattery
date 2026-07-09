//! Observation-only network-stats instrumentation for the `/netstat` overlay.
//!
//! [`NetStats`] is owned by [`TurnState`](super::TurnState) and touched only from the BW/sync thread,
//! the same as the rest of the turn state. Every method here records or reads; none of it feeds back
//! into turn/sim behavior, so the instrumentation cannot change what the game does — it only watches.
//! The rings are bounded (per-slot events to [`HISTORY_HORIZON`], the buffer/link histories to a fixed
//! entry cap) so a long game can't grow them without bound, and each record path is a small push plus
//! a bounded prune on the hot receive path.
//!
//! The read models ([`NetStatsStatus`] / [`NetStatRow`]) are plain data carrying only ids, mirroring
//! [`DisconnectStatus`](super::DisconnectStatus): the draw-side adapter resolves each slot's user id
//! to a display name and normalizes it into the overlay-ui view-model.

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
/// Cap on the buffer-directive history ring — also the tier-2 sparkline series, so generous.
const BUFFER_HISTORY_CAP: usize = 256;
/// Cap on the own-link transition ring.
const LINK_HISTORY_CAP: usize = 128;

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
        let max_gap = self
            .arrivals
            .iter()
            .filter(|&&(t, _)| now.saturating_duration_since(t) <= RECENT_WINDOW)
            .map(|&(_, d)| d)
            .max()
            .unwrap_or(Duration::ZERO);
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

/// All of the `/netstat` overlay's instrumentation, owned by the turn state. Records on the receive
/// hot path (arrivals, stall attribution), the directive-apply step (buffer changes), and the
/// connectivity pump (own-link transitions); read when the overlay builds its view or `queryState`
/// snapshots.
pub struct NetStats {
    /// Per-storm-slot stats, indexed by storm id.
    slots: [SlotStats; bw::MAX_STORM_PLAYERS],
    /// The buffer depth (in turns) currently in force.
    buffer_turns: u32,
    /// How many times the buffer depth has changed since the game started.
    buffer_change_count: u32,
    /// `(instant, value)` buffer-directive points since game start (seeded with the starting value),
    /// capped at [`BUFFER_HISTORY_CAP`]; the sparkline series.
    buffer_history: VecDeque<(Instant, u32)>,
    /// Whether this client's own relay link is currently up.
    link_up: bool,
    /// How many times the own link has gone down since the game started.
    link_down_count: u32,
    /// `(instant, up)` own-link transitions, capped at [`LINK_HISTORY_CAP`].
    link_history: VecDeque<(Instant, bool)>,
}

impl NetStats {
    /// Builds the instrumentation with the pipe's starting buffer depth, seeding the buffer history
    /// with that value at `now` so the sparkline has a baseline before any relay retune.
    pub fn new(initial_buffer_turns: u32, now: Instant) -> Self {
        let mut buffer_history = VecDeque::new();
        buffer_history.push_back((now, initial_buffer_turns));
        NetStats {
            slots: std::array::from_fn(|_| SlotStats::default()),
            buffer_turns: initial_buffer_turns,
            buffer_change_count: 0,
            buffer_history,
            link_up: true,
            link_down_count: 0,
            link_history: VecDeque::new(),
        }
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

    /// Records a buffer-depth change (a relay directive that actually moved the depth). A no-op when
    /// the value is unchanged, so a redundant directive doesn't inflate the change count or history.
    pub fn record_buffer(&mut self, value: u32, now: Instant) {
        if value == self.buffer_turns {
            return;
        }
        self.buffer_turns = value;
        self.buffer_change_count += 1;
        self.buffer_history.push_back((now, value));
        while self.buffer_history.len() > BUFFER_HISTORY_CAP {
            self.buffer_history.pop_front();
        }
    }

    /// Records the own-link state, capturing a transition. A no-op when the state is unchanged.
    pub fn record_link(&mut self, up: bool, now: Instant) {
        if up == self.link_up {
            return;
        }
        self.link_up = up;
        if !up {
            self.link_down_count += 1;
        }
        self.link_history.push_back((now, up));
        while self.link_history.len() > LINK_HISTORY_CAP {
            self.link_history.pop_front();
        }
    }

    pub fn buffer_turns(&self) -> u32 {
        self.buffer_turns
    }

    pub fn buffer_change_count(&self) -> u32 {
        self.buffer_change_count
    }

    /// Time since the most recent buffer-depth change, or `None` if it has never changed (the seed
    /// entry is the starting value, not a change).
    pub fn buffer_last_change(&self, now: Instant) -> Option<Duration> {
        if self.buffer_change_count == 0 {
            return None;
        }
        self.buffer_history
            .back()
            .map(|&(t, _)| now.saturating_duration_since(t))
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

    /// The buffer-directive series normalized to `[0, 1]` on both axes for the sparkline: `x` across
    /// the series' time span (0 oldest, 1 newest), `y` across its min..max value range (0 lowest, 1
    /// highest). Returns an empty series when there are fewer than two points to connect.
    pub fn normalized_buffer_series(&self) -> Vec<(f32, f32)> {
        let points = &self.buffer_history;
        if points.len() < 2 {
            return Vec::new();
        }
        let start = points.front().expect("checked non-empty").0;
        let span = points
            .back()
            .expect("checked non-empty")
            .0
            .saturating_duration_since(start)
            .as_secs_f32();
        let (mut min, mut max) = (u32::MAX, 0u32);
        for &(_, value) in points {
            min = min.min(value);
            max = max.max(value);
        }
        // A flat series has a zero value range; a floor of 1 keeps every point at the strip's bottom
        // rather than dividing by zero.
        let range = max.saturating_sub(min).max(1) as f32;
        points
            .iter()
            .map(|&(t, value)| {
                let x = if span > 0.0 {
                    t.saturating_duration_since(start).as_secs_f32() / span
                } else {
                    0.0
                };
                let y = (value - min) as f32 / range;
                (x, y)
            })
            .collect()
    }
}

/// A render-side snapshot of the session's network health, for the `/netstat` overlay. Built by
/// [`TurnState::net_stats_status`](super::TurnState::net_stats_status) and read from the draw thread;
/// it names peers only by user id (resolved to a display name at render time) and carries the
/// sparkline pre-normalized, so the draw-side adapter only resolves names.
pub struct NetStatsStatus {
    /// The current simulation turn rate (turns per second), read from live game data at snapshot time.
    pub turn_rate: u32,
    pub buffer_turns: u32,
    pub buffer_change_count: u32,
    pub buffer_last_change: Option<Duration>,
    /// The buffer sparkline series, normalized (see [`NetStats::normalized_buffer_series`]).
    pub buffer_series: Vec<(f32, f32)>,
    pub link_up: bool,
    pub link_down_count: u32,
    pub link_last_change: Option<Duration>,
    /// One row per remote roster slot with a storm mapping.
    pub rows: Vec<NetStatRow>,
}

/// One remote slot's row within a [`NetStatsStatus`]: the slot and its occupant, plus that slot's
/// arrival/stall figures.
pub struct NetStatRow {
    pub slot: SlotId,
    pub user_id: SbUserId,
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

        // The starting value seeds the history but is not a change.
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
    fn buffer_series_normalizes_once_there_are_two_points() {
        let t0 = Instant::now();
        let mut stats = NetStats::new(2, t0);
        // Only the seed so far — nothing to connect.
        assert!(stats.normalized_buffer_series().is_empty());

        stats.record_buffer(6, t0 + Duration::from_secs(4));
        let series = stats.normalized_buffer_series();
        assert_eq!(series.len(), 2);
        // The seed (value 2) is the min at the bottom-left; the change (value 6) the max at top-right.
        assert_eq!(series[0], (0.0, 0.0));
        assert_eq!(series[1], (1.0, 1.0));
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
}
