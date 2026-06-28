use std::{
    collections::HashMap,
    time::{Duration, Instant},
};

use enumset::EnumSet;
use itertools::Itertools;
use rand::{Rng, seq::SliceRandom};
use strum::IntoEnumIterator;

use crate::matchmaking::MatchmakingType;

/*
Match quality is expressed in seconds of wait time: a positive value means the match is good
enough to form right now, a negative value means it needs more wait time to become acceptable.

    quality = wait_time − (W_var * skill_variance + W_prob * win_prob_diff
                           + W_lat * latency_value(max_latency))

Where:
    - W_var  = "How many seconds I would wait for a 1-unit improvement in skill variance"
    - W_prob = "How many seconds I would wait for a 1-unit improvement in win-probability balance"
    - W_lat  = "How many seconds I would wait to drop a match's latency by one turn-rate step"

`max_latency` is the estimated one-way latency (in milliseconds) of the candidate match's worst
pairwise link, derived from each player's rally-point server pings (see [`match_latency`]). Latency
only changes the play experience in discrete jumps — the game holds a fixed turn rate / input buffer
until latency crosses a threshold, so anything under ~100ms one-way plays identically. The quality
formula therefore penalizes `latency_value(max_latency)` (a count of turn-rate steps) rather than
raw milliseconds (see [`latency_value`]). Routeability is a hard constraint rather than a penalty: a
candidate where any player pair shares no pinged rally-point server is rejected outright, since the
game loader couldn't build a route for it and the launch would fail (see [`match_latency`]).

Skill variance is computed over each player's *effective rating* (rating − k*σ), so newly-placed
players with high uncertainty contribute less variance and match more freely until their rating
stabilizes.

The minimum acceptable quality (min_quality) is adaptive: when a mode's *smoothed population
estimate* is below a comfortable threshold it is relaxed by ADAPTIVE_DECAY_PER_MISSING seconds per
missing player, ensuring matches can still form in low-population conditions. The estimate is a
time-smoothed (EWMA) measure of how many players have been around recently — deliberately *not* the
instantaneous queue size, which the matchmaker drains to its unmatched residual every tick and would
therefore read as "low population" even at peak hours (see [`update_population_estimates`]).

See also Menke's talk for background on this scoring approach:
https://www.youtube.com/watch?v=Q8BX0nXfPjY
*/

const WEIGHT_RATING_VARIANCE: f32 = 0.005;
const WEIGHT_WIN_PROB: f32 = 50.0;
/// Seconds of wait time we'll trade to drop a match's latency by one turn-rate step (one unit of
/// [`latency_value`]). Latency below the first step (~100ms one-way) plays identically, so this only
/// bites once a match would force the game onto a slower turn rate / longer input buffer. The
/// match-formation telemetry records the raw `max_latency` (in ms) so this can be tuned against real
/// game outcomes.
const WEIGHT_LATENCY: f32 = 30.0;

/// How many σ below their mean rating a player's effective rating is.
/// Controls how strongly uncertainty drags down effective rating.
/// k=1.0 → 68% confidence lower bound. k=2.0 → 95% lower bound.
const UNCERTAINTY_K: f32 = 1.0;

/// Smoothed population (see [`Matchmaker::update_population_estimates`]) at or above which the full
/// MIN_QUALITY threshold applies. Below this, the threshold decays by ADAPTIVE_DECAY_PER_MISSING per
/// missing player. This multiplier is applied to mode.total_players() so it scales with mode size.
const ADAPTIVE_COMFORTABLE_MULTIPLIER: usize = 2;

/// Seconds the quality threshold drops per player below the comfortable population.
const ADAPTIVE_DECAY_PER_MISSING: f32 = 15.0;

/// Length of one population-sampling window. At each boundary the window's peak concurrent queue size
/// is folded into the smoothed per-mode population estimate (see
/// [`Matchmaker::update_population_estimates`]).
const POPULATION_WINDOW: Duration = Duration::from_secs(60);

/// Half-life of the population estimate: the time a mode's estimate takes to decay halfway toward a
/// lower level once the queue goes quiet (and, symmetrically, to climb halfway toward a higher one).
///
/// This is the knob that controls how reactive the adaptive threshold is, and it wants to be *long*.
/// A matched player vanishes from the queue for the length of a game (~15-20 minutes for BW) before
/// requeueing, so the estimate has to remember the population across at least one game-and-requeue
/// cycle or it would forget the active player base mid-game and spuriously relax the threshold. A
/// half-life around a game length also smooths over the multi-minute lulls that are normal even at
/// peak hours, while still relaxing the threshold over the better part of an hour during a genuinely
/// dead period. [`POPULATION_WINDOW`] only sets the sampling granularity; this sets the time
/// constant. (The previous value — inherited verbatim from the old TS matchmaker, where it was an
/// admittedly arbitrary placeholder — was a ~2.4-minute half-life, far too twitchy.)
const POPULATION_HALF_LIFE: Duration = Duration::from_secs(20 * 60);

/// Per-window EWMA blend factor derived from [`POPULATION_HALF_LIFE`] and [`POPULATION_WINDOW`]:
/// `alpha = 1 - 0.5^(window / half_life)`, i.e. the fraction of a window's peak folded into the
/// estimate each fold, chosen so the estimate halves over exactly one half-life of idle windows.
fn population_alpha() -> f32 {
    1.0 - 0.5_f32.powf(POPULATION_WINDOW.as_secs_f32() / POPULATION_HALF_LIFE.as_secs_f32())
}

/// Identifies a map. Opaque to the matchmaker — only compared for equality when verifying that the
/// players in a positive-selection mode share at least one map. Matches the string `SbMapId` used
/// elsewhere in the codebase.
pub type MapId = String;

#[derive(Debug, Copy, Clone, PartialEq, Default)]
pub struct PlayerModeRating {
    pub rating: f32,
    /// Glicko-2 σ (uncertainty). None treated as 0 (fully certain).
    pub uncertainty: Option<f32>,
}

#[derive(Debug, Clone, PartialEq)]
pub struct Player {
    pub id: usize,
    /// Per-mode ratings. The matchmaker looks up the relevant rating for the mode being evaluated.
    /// The set of keys *is* the set of modes the player is queued for: the queue entry's modes are
    /// derived from this map (see `create_entry_and_update_modes`).
    pub ratings: HashMap<MatchmakingType, PlayerModeRating>,
    /// Per-mode positive map selections, present only for modes that use positive map selection
    /// ("pick"). When every player in a candidate match carries selections for the mode, the match
    /// is only formed if they share at least one map (see `find_matches_for_modes`); otherwise no
    /// map could be chosen and the match would fail downstream. Veto/fixed modes have no entry here
    /// and are unconstrained.
    pub map_selections: HashMap<MatchmakingType, Vec<MapId>>,
    /// Most recently reported round-trip ping (ms) from this player to each rally-point server,
    /// keyed by server id. The matchmaker uses these to estimate a candidate match's latency by
    /// reproducing the route selection the game server performs at launch (see [`match_latency`]).
    /// Players are required to have measured their pings before queueing (the Node.js side waits for
    /// a ping result before enqueuing), so this is normally non-empty; a player carrying no pings
    /// contributes no latency information and matches involving them are not penalized.
    pub server_pings: HashMap<u32, f32>,
}

/// Returns the conservative skill estimate: the player's rating minus k standard deviations.
/// A player with high uncertainty will have a lower effective rating, meaning they can match
/// against a wider range of opponents without the quality formula penalizing the match.
fn effective_rating(player: &Player, mode: MatchmakingType) -> f32 {
    let mode_rating = player.ratings.get(&mode).copied().unwrap_or_default();
    mode_rating.rating - UNCERTAINTY_K * mode_rating.uncertainty.unwrap_or(0.0)
}

/// Estimates the one-way latency (ms) of a candidate match by reproducing the route selection the
/// game server performs at launch, or returns `None` if the match is *unrouteable* and must be
/// rejected. The game meshes players with one rally-point route per pair, choosing for each pair the
/// server that minimizes their combined round-trip ping (see `RallyPointService::createBestRoute` on
/// the Node.js side); that pair's estimated one-way latency is `combined / 2`. A lockstep game is
/// bottlenecked by its slowest link, so the match's latency is the maximum across all pairs.
///
/// `createBestRoute` can only build a route when both players pinged a common server; if their pings
/// are disjoint it throws and the launch fails. So a pair where both players carry ping data but
/// share no server makes the whole match unrouteable, and we return `None` so the caller rejects it
/// rather than forming a match that can't launch.
///
/// Players measure their pings before queueing, so every player normally carries ping data. A pair
/// where one side carries *no* pings at all is a defensive degenerate case (the loader would also
/// fail it, but it shouldn't occur in practice); rather than wedge such a player out of matchmaking
/// entirely we skip the pair, contributing no latency information instead of blocking the match.
fn match_latency(entries: &[&QueueEntry]) -> Option<f32> {
    let mut worst = 0.0f32;
    for (i, a) in entries.iter().enumerate() {
        let a_pings = &a.player.server_pings;
        for b in &entries[i + 1..] {
            let b_pings = &b.player.server_pings;
            // A pair with no ping data on either side carries no routing information; don't block on
            // it (see the doc comment above).
            if a_pings.is_empty() || b_pings.is_empty() {
                continue;
            }
            let best_combined = a_pings
                .iter()
                .filter_map(|(server, &ping_a)| b_pings.get(server).map(|&ping_b| ping_a + ping_b))
                .fold(f32::INFINITY, f32::min);
            if best_combined.is_finite() {
                worst = worst.max(best_combined / 2.0);
            } else {
                // Both players pinged servers but share none: the loader can't route this pair, so
                // the whole match is unrouteable.
                return None;
            }
        }
    }
    Some(worst)
}

/// Converts an estimated one-way latency (ms) into the number of turn-rate "steps" it costs — the
/// form the quality formula actually penalizes (see [`WEIGHT_LATENCY`]). Network latency only changes
/// the play experience in discrete jumps: StarCraft holds a fixed turn rate / input buffer until
/// latency crosses a threshold, then drops to a slower one. So a 30ms match and a 100ms match are
/// equivalent, while a 200ms match is meaningfully worse. This reproduces the game's turn-rate
/// selection (`ceil(latency * 0.9 / 30)`), clamped so the first ~100ms one-way costs nothing (0).
fn latency_value(latency_ms: f32) -> f32 {
    (latency_ms * 0.9 / 30.0).ceil().max(3.0) - 3.0
}

#[derive(Debug, Clone, PartialEq)]
pub struct QueueEntry {
    pub queue_time: Instant,
    pub player: Player,
    pub modes: EnumSet<MatchmakingType>,
}

#[derive(Debug, Clone)]
pub struct Matchmaker<T: QueueSelector> {
    start: Instant,
    max_players_examined: usize,
    queue: Vec<QueueEntry>,
    queue_sizes: HashMap<MatchmakingType, usize>,
    /// Smoothed (EWMA) estimate of how many players have recently been queued for each mode, used to
    /// relax the quality threshold in low population. Updated once per [`POPULATION_WINDOW`] by
    /// [`Matchmaker::update_population_estimates`]; absent until the first non-empty window seeds it.
    population_estimate: HashMap<MatchmakingType, f32>,
    /// Peak concurrent queue size per mode observed within the current (not-yet-folded) sampling
    /// window. Raised as players join; folded into `population_estimate` and reset to the live size
    /// at each window boundary.
    population_peak: HashMap<MatchmakingType, usize>,
    /// Start of the current sampling window, advanced by whole [`POPULATION_WINDOW`]s as they elapse.
    population_window_start: Instant,
    queue_selector: T,
}

#[derive(thiserror::Error, Debug)]
pub enum MatchmakerError {
    #[error("player {0} is already in the queue")]
    AlreadyInQueue(usize),
    #[error("must queue for at least one mode")]
    NoModesSelected,
}

#[derive(Debug, Clone)]
pub struct Match {
    pub mode: MatchmakingType,
    pub team_a: Vec<QueueEntry>,
    pub team_b: Vec<QueueEntry>,
    pub quality: f32,
    /// Variance of the matched players' effective ratings — the raw skill-spread input to the
    /// quality score, before `WEIGHT_RATING_VARIANCE` is applied. Persisted as match-formation
    /// telemetry so the weights can later be calibrated against real game outcomes.
    pub skill_variance: f32,
    /// Win probability of team A vs team B from the matchmaker's logistic, computed over effective
    /// (uncertainty-discounted) ratings — see [`get_team_rating`]/[`effective_rating`]. Uncertainty
    /// is folded in via the effective rating rather than a separate σ-weight, so this differs from
    /// the Glicko-2 rating update's σ-weighted expected score (the comparison this telemetry
    /// enables). 0.5 means a perfectly balanced match.
    pub win_probability: f32,
    /// Effective team ratings (see [`get_team_rating`]) used to compute `win_probability`.
    pub team_a_rating: f32,
    pub team_b_rating: f32,
    /// Estimated one-way latency (ms) of the match's worst pairwise link (see [`match_latency`]).
    /// Recorded in raw milliseconds for calibration (it joins against the launch-time route latency
    /// in `games.routes`); the quality score itself penalizes `latency_value(max_latency)` weighted
    /// by `WEIGHT_LATENCY`, not these raw ms.
    pub max_latency: f32,
}

pub trait QueueSelector {
    /// Selects `amount` players from `queue``.
    fn select<'a>(
        &self,
        queue: impl IntoIterator<Item = &'a QueueEntry>,
        amount: usize,
    ) -> Vec<&'a QueueEntry>;
}

/// Selects players uniformly at random from the queue using reservoir sampling, so every queued
/// player has an equal chance of being examined regardless of their position in the queue.
pub struct RandomQueueSelector;

impl QueueSelector for RandomQueueSelector {
    fn select<'a>(
        &self,
        queue: impl IntoIterator<Item = &'a QueueEntry>,
        amount: usize,
    ) -> Vec<&'a QueueEntry> {
        let mut rng = rand::rng();
        let mut selected = Vec::with_capacity(amount);
        for (i, player) in queue.into_iter().enumerate() {
            if selected.len() < amount {
                selected.push(player);
            } else {
                // Reservoir sampling (Algorithm R): pick a random index in 0..=i and, if it falls
                // within the reservoir, replace that slot with the current player. This produces a
                // uniform sample — every player in the queue ends up with an equal amount/len
                // chance of being selected, independent of their position.
                let j = rng.random_range(0..=i);
                if j < amount {
                    selected[j] = player;
                }
            }
        }

        selected
    }
}

impl Matchmaker<RandomQueueSelector> {
    pub fn new(max_players_examined: usize) -> Matchmaker<RandomQueueSelector> {
        Matchmaker::with_queue_selector(max_players_examined, RandomQueueSelector)
    }
}

/// Calculates an effective rating for a team, as if they were a single player. This attempts to
/// weight things such that more skilled players influence the resulting rating more than less
/// skilled ones. Note that this differs from how we determine this in rating change calculations,
/// because this method would be inflationary there.
fn get_team_rating(team: &[&QueueEntry], mode: MatchmakingType) -> f32 {
    if team.len() == 1 {
        effective_rating(&team[0].player, mode)
    } else {
        let sum: f32 = team
            .iter()
            .map(|q| {
                let r = effective_rating(&q.player, mode);
                r * r
            })
            .sum();
        // TODO(tec27): Determine what the proper exponent is for this from win/loss data
        (sum / team.len() as f32).sqrt()
    }
}

/// Returns the win probability for player A vs player B (or effective team rating A vs effective
/// team rating B). This is only an approximation as we don't have the uncertainty values for either
/// side.
fn get_win_probability(rating_a: f32, rating_b: f32) -> f32 {
    1.0 / (1.0 + 10.0f32.powf((rating_b - rating_a) / 400.0))
}

/// Returns whether every player's positive map selections share at least one common map. Used to
/// avoid forming matches for positive-selection ("pick") modes where no single map satisfies
/// everyone — such a match could not have its map chosen and would fail when it tried to start. An
/// empty input (no players carry selections) is treated as having overlap, i.e. no constraint.
fn selections_share_a_map(selections: &[&Vec<MapId>]) -> bool {
    match selections.split_first() {
        Some((first, rest)) => first
            .iter()
            .any(|map| rest.iter().all(|other| other.contains(map))),
        None => true,
    }
}

impl<T: QueueSelector> Matchmaker<T> {
    fn with_queue_selector(max_players_examined: usize, queue_selector: T) -> Matchmaker<T> {
        let start = Instant::now();
        Self {
            start,
            max_players_examined,
            queue: Vec::new(),
            queue_sizes: HashMap::new(),
            population_estimate: HashMap::new(),
            population_peak: HashMap::new(),
            population_window_start: start,
            queue_selector,
        }
    }

    /// Returns the instant at which this matchmaker was created. Queue times in serialized tickets
    /// are stored as milliseconds relative to this instant so that `Instant` values (which are
    /// monotonic but not serializable) can survive a round-trip through the ticket format.
    pub fn start(&self) -> Instant {
        self.start
    }

    pub fn insert_player(&mut self, player: Player) -> Result<&mut Self, MatchmakerError> {
        let entry = self.create_entry_and_update_modes(player, Instant::now())?;
        self.queue.push(entry);
        Ok(self)
    }

    /// Re-inserts a player in the queue who had been queued previously, keeping their queue_time
    /// as before. This is meant to be used when players need to return to the queue after the match
    /// they were placed in failed to start.
    pub fn requeue_player(
        &mut self,
        player: Player,
        queue_time: Instant,
    ) -> Result<&mut Self, MatchmakerError> {
        let entry = self.create_entry_and_update_modes(player, queue_time)?;

        match self
            .queue
            .binary_search_by_key(&entry.queue_time, |e| e.queue_time)
        {
            Ok(pos) | Err(pos) => self.queue.insert(pos, entry),
        };

        Ok(self)
    }

    fn create_entry_and_update_modes(
        &mut self,
        player: Player,
        queue_time: Instant,
    ) -> Result<QueueEntry, MatchmakerError> {
        // The modes a player is queued for are exactly the modes they have a rating for. Deriving
        // `modes` from `ratings` here (rather than accepting it as a separate argument) makes it
        // impossible for the two to disagree, which would otherwise let a player be matched in a
        // mode they have no rating for — silently treated as a 0.0 rating by `effective_rating`.
        let modes: EnumSet<MatchmakingType> = player.ratings.keys().copied().collect();
        if modes.is_empty() {
            return Err(MatchmakerError::NoModesSelected);
        }
        if self.queue.iter().any(|x| x.player.id == player.id) {
            return Err(MatchmakerError::AlreadyInQueue(player.id));
        }

        let entry = QueueEntry {
            queue_time,
            player,
            modes,
        };

        for mode in entry.modes.iter() {
            let size = {
                let n = self.queue_sizes.entry(mode).or_insert(0);
                *n += 1;
                *n
            };
            // Raise the current window's high-water mark. The population estimate samples this peak
            // rather than the instantaneous size so it isn't dragged down by the matchmaker draining
            // the queue between windows.
            let peak = self.population_peak.entry(mode).or_insert(0);
            *peak = (*peak).max(size);
        }

        Ok(entry)
    }

    pub fn remove_player(&mut self, id: usize) -> Option<Player> {
        let index = self.queue.iter().position(|x| x.player.id == id);
        if let Some(index) = index {
            let entry = self.queue.remove(index);
            for mode in entry.modes.iter() {
                self.queue_sizes.entry(mode).and_modify(|n| *n -= 1);
            }
            Some(entry.player)
        } else {
            None
        }
    }

    /// Folds any elapsed sampling windows into the smoothed per-mode population estimate. The search
    /// loop calls this once per tick; for each whole [`POPULATION_WINDOW`] that has passed since the
    /// last fold, that window's peak concurrent queue size is blended into an exponential moving
    /// average (factor [`population_alpha`], derived from [`POPULATION_HALF_LIFE`]) and the peak is
    /// reset to the live queue size for the next window.
    ///
    /// Sampling the *window peak* rather than the instantaneous queue size is the whole point: the
    /// matchmaker removes every match it forms each tick, so the instantaneous size sits near the
    /// unmatched residual almost always and would read as low population even at peak hours. The peak
    /// captures the players who passed through the window, and the EWMA decays toward 0 across idle
    /// windows so the threshold still relaxes during a genuine dead hour.
    pub fn update_population_estimates(&mut self, now: Instant) {
        let alpha = population_alpha();
        while now.duration_since(self.population_window_start) >= POPULATION_WINDOW {
            for mode in MatchmakingType::iter() {
                let peak = self.population_peak.get(&mode).copied().unwrap_or(0) as f32;
                match self.population_estimate.entry(mode) {
                    std::collections::hash_map::Entry::Occupied(mut e) => {
                        let v = e.get_mut();
                        *v = peak * alpha + (1.0 - alpha) * *v;
                    }
                    // Seed straight from the first non-empty window so the estimate converges at once
                    // instead of crawling up from 0 over several windows after a (re)start.
                    std::collections::hash_map::Entry::Vacant(e) => {
                        if peak > 0.0 {
                            e.insert(peak);
                        }
                    }
                }
                // The next window's peak starts at the live size; it can only rise from there.
                let live = self.queue_sizes.get(&mode).copied().unwrap_or(0);
                self.population_peak.insert(mode, live);
            }
            self.population_window_start += POPULATION_WINDOW;
        }
    }

    /// The number of players currently queued for `mode` (0 if none). This is the live,
    /// instantaneous size, which the matchmaker drains each tick — see [`Self::population_estimate`]
    /// for the smoothed measure the adaptive threshold actually uses.
    pub fn queue_size(&self, mode: MatchmakingType) -> usize {
        self.queue_sizes.get(&mode).copied().unwrap_or(0)
    }

    /// The current smoothed (EWMA) population estimate for `mode`, or `None` until the first sampling
    /// window has folded (see [`Self::update_population_estimates`]).
    pub fn population_estimate(&self, mode: MatchmakingType) -> Option<f32> {
        self.population_estimate.get(&mode).copied()
    }

    /// The minimum quality a match in `mode` must reach to form right now. Equal to `min_quality`
    /// when the mode's smoothed population is comfortable, and relaxed by [`ADAPTIVE_DECAY_PER_MISSING`]
    /// seconds per player below the comfortable population so matches still form when few are around.
    pub fn effective_min_quality(&self, mode: MatchmakingType, min_quality: f32) -> f32 {
        let comfortable = (mode.total_players() * ADAPTIVE_COMFORTABLE_MULTIPLIER) as f32;
        // Until the first window folds (e.g. the first minute after a restart) the smoothed estimate
        // is absent; fall back to the current window's peak so a healthy queue isn't mistaken for zero
        // population and maximally relaxed. Using the peak rather than the live size keeps this
        // drain-resistant, matching the smoothed path.
        let population = self
            .population_estimate
            .get(&mode)
            .copied()
            .or_else(|| self.population_peak.get(&mode).map(|&p| p as f32))
            .unwrap_or(0.0);
        if population < comfortable {
            min_quality - ADAPTIVE_DECAY_PER_MISSING * (comfortable - population)
        } else {
            min_quality
        }
    }

    /// Finds matches for all modes, returning a Vec the proposed matches. Matches will be returned
    /// ordered by [MatchmakingType] and then the value of that match (so "better" matches will
    /// appear first). Only matches of at least `min_quality` quality will be returned.
    pub fn find_matches(&self, min_quality: f32, now: Instant) -> Vec<Match> {
        let mut modes = MatchmakingType::iter().collect::<Vec<_>>();
        modes.shuffle(&mut rand::rng());
        self.find_matches_for_modes(&modes, min_quality, now)
    }

    /// Finds matches for the given [MatchmakingType]s, returning a Vec of the proposed matches.
    /// Matches will be returned ordered by [MatchmakingType] (in the order given) and then the
    /// value of that match (so "better" matches will appear first). Only matches of at least
    /// `min_quality` quality will be returned.
    pub fn find_matches_for_modes(
        &self,
        modes: &[MatchmakingType],
        min_quality: f32,
        now: Instant,
    ) -> Vec<Match> {
        let mut matches = Vec::new();

        for mode in modes {
            if let Some(&size) = self.queue_sizes.get(mode)
                && size < mode.total_players()
            {
                // Avoid iterating the whole queue if this mode couldn't generate a valid match
                continue;
            }

            let effective_min = self.effective_min_quality(*mode, min_quality);

            // Only look at players queued for this mode
            let mode_queue = self.queue.iter().filter(|e| e.modes.contains(*mode));
            // Select a small number of possible players to look at to limit the total possible
            // matches we need to examine
            let selected = self
                .queue_selector
                .select(mode_queue, self.max_players_examined);

            let mode_matches = selected
                .iter()
                .copied()
                // Get all the potential combinations of these players (we will decide teams later)
                .combinations(mode.total_players())
                // Calculate match quality
                .filter_map(|queue_entries| {
                    // For positive-selection ("pick") modes, every player carries their map
                    // selections; reject any combination whose players share no map, since the
                    // match map couldn't be chosen and the match would fail. Veto/fixed modes store
                    // no selections, so this check is a no-op for them.
                    let mode_selections: Vec<&Vec<MapId>> = queue_entries
                        .iter()
                        .filter_map(|q| q.player.map_selections.get(mode))
                        .collect();
                    if mode_selections.len() == queue_entries.len()
                        && !selections_share_a_map(&mode_selections)
                    {
                        return None;
                    }

                    // Reject candidates the game loader couldn't route. If any player pair pinged
                    // servers but shares none, `RallyPointService.createBestRoute` would fail to pick
                    // a server both can use and the launch would fail. Scoring such a match instead
                    // of rejecting it lets a low-population queue repeatedly form the same impossible
                    // pair, send it through accept/load, fail, and requeue it. Computed here so the
                    // value can be reused for the quality score below.
                    let max_latency = match_latency(&queue_entries)?;

                    let mut oldest_queue_time = queue_entries[0].queue_time;
                    let mut count = 0;
                    let mut mean = 0.0;
                    let mut m2 = 0.0;

                    for q in &queue_entries {
                        if q.queue_time < oldest_queue_time {
                            oldest_queue_time = q.queue_time;
                        }
                        // Calculate variance with Welford's algorithm over effective ratings
                        count += 1;
                        let r = effective_rating(&q.player, *mode);
                        let delta = r - mean;
                        mean += delta / count as f32;
                        m2 += delta * (r - mean);
                    }
                    let variance = m2 / (count as f32 - 1.0);
                    let wait_time = now - oldest_queue_time;

                    // Find teams that minimize the difference in effective rating (if necessary)
                    let (team_a, team_b) = if mode.team_size() == 1 {
                        // For 1v1 modes we obviously don't need teams, just split in order
                        (vec![queue_entries[0]], vec![queue_entries[1]])
                    } else {
                        queue_entries
                            .iter()
                            .copied()
                            .combinations(mode.team_size())
                            .map(|team_a| {
                                let team_b = queue_entries
                                    .iter()
                                    .filter(|q| !team_a.iter().any(|a| a.player.id == q.player.id))
                                    .copied()
                                    .collect::<Vec<_>>();

                                let rating_a = get_team_rating(&team_a, *mode);
                                let rating_b = get_team_rating(&team_b, *mode);

                                ((rating_a - rating_b).abs(), team_a, team_b)
                            })
                            .min_by(|a, b| a.0.total_cmp(&b.0))
                            .map(|(_, a, b)| (a, b))
                            .unwrap()
                    };

                    // Calculate the win probability for team_a vs team_b
                    let rating_a = get_team_rating(&team_a, *mode);
                    let rating_b = get_team_rating(&team_b, *mode);
                    let win_prob = get_win_probability(rating_a, rating_b);
                    let win_prob_diff = (0.5 - win_prob).abs();

                    let quality = wait_time.as_secs_f32()
                        - (WEIGHT_RATING_VARIANCE * variance
                            + WEIGHT_WIN_PROB * win_prob_diff
                            + WEIGHT_LATENCY * latency_value(max_latency));

                    // Filter any matches that are too low quality
                    if quality >= effective_min {
                        Some(Match {
                            mode: *mode,
                            team_a: team_a.into_iter().cloned().collect(),
                            team_b: team_b.into_iter().cloned().collect(),
                            quality,
                            skill_variance: variance,
                            win_probability: win_prob,
                            team_a_rating: rating_a,
                            team_b_rating: rating_b,
                            max_latency,
                        })
                    } else {
                        None
                    }
                })
                // Sort by match quality (descending)
                .sorted_by(|a, b| b.quality.total_cmp(&a.quality));

            matches.extend(mode_matches);
        }

        matches
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashMap;
    use std::time::Duration;

    /// A [QueueSelector] that just takes the front `amount` players from the queue.
    pub struct TestQueueSelector;

    impl QueueSelector for TestQueueSelector {
        fn select<'a>(
            &self,
            queue: impl IntoIterator<Item = &'a QueueEntry>,
            amount: usize,
        ) -> Vec<&'a QueueEntry> {
            queue.into_iter().take(amount).collect()
        }
    }

    fn make_player(id: usize, rating: f32, mode: MatchmakingType) -> Player {
        Player {
            id,
            ratings: HashMap::from([(
                mode,
                PlayerModeRating {
                    rating,
                    uncertainty: None,
                },
            )]),
            map_selections: HashMap::new(),
            server_pings: HashMap::new(),
        }
    }

    /// Builds a player queued for several modes, using the same rating for each. The queued modes
    /// are derived from the ratings map, so every mode passed here gets an entry.
    fn make_multi_player(id: usize, rating: f32, modes: EnumSet<MatchmakingType>) -> Player {
        Player {
            id,
            ratings: modes
                .iter()
                .map(|mode| {
                    (
                        mode,
                        PlayerModeRating {
                            rating,
                            uncertainty: None,
                        },
                    )
                })
                .collect(),
            map_selections: HashMap::new(),
            server_pings: HashMap::new(),
        }
    }

    #[test]
    fn not_enough_players() {
        let mut matchmaker = Matchmaker::with_queue_selector(16, TestQueueSelector);
        matchmaker
            .insert_player(make_player(0, 1000.0, MatchmakingType::Match1v1))
            .unwrap();

        let result = matchmaker.find_matches_for_modes(
            &[MatchmakingType::Match1v1],
            f32::NEG_INFINITY,
            Instant::now(),
        );
        assert!(result.is_empty());
    }

    #[test]
    fn exact_number_of_players() {
        let mut matchmaker = Matchmaker::with_queue_selector(16, TestQueueSelector);
        matchmaker
            .insert_player(make_player(0, 1000.0, MatchmakingType::Match1v1))
            .unwrap();
        matchmaker
            .insert_player(make_player(1, 1200.0, MatchmakingType::Match1v1))
            .unwrap();

        assert_eq!(
            matchmaker.queue_sizes.get(&MatchmakingType::Match1v1),
            Some(&2)
        );

        let result = matchmaker.find_matches_for_modes(
            &[MatchmakingType::Match1v1],
            f32::NEG_INFINITY,
            Instant::now(),
        );
        assert_eq!(result.len(), 1);
        assert_eq!(result[0].mode, MatchmakingType::Match1v1);
        assert_eq!(
            result[0]
                .team_a
                .iter()
                .map(|q| q.player.id)
                .collect::<Vec<_>>(),
            vec![0]
        );
        assert_eq!(
            result[0]
                .team_b
                .iter()
                .map(|q| q.player.id)
                .collect::<Vec<_>>(),
            vec![1]
        );
    }

    #[test]
    fn finds_all_modes_in_order() {
        let mut matchmaker = Matchmaker::with_queue_selector(16, TestQueueSelector);
        matchmaker
            .insert_player(make_multi_player(
                0,
                1000.0,
                MatchmakingType::Match1v1 | MatchmakingType::Match1v1Fastest,
            ))
            .unwrap();
        matchmaker
            .insert_player(make_multi_player(
                1,
                1200.0,
                MatchmakingType::Match1v1Fastest | MatchmakingType::Match1v1,
            ))
            .unwrap();

        let result = matchmaker.find_matches_for_modes(
            &[MatchmakingType::Match1v1Fastest, MatchmakingType::Match1v1],
            f32::NEG_INFINITY,
            Instant::now(),
        );
        assert_eq!(result.len(), 2);

        assert_eq!(result[0].mode, MatchmakingType::Match1v1Fastest);
        assert_eq!(
            result[0]
                .team_a
                .iter()
                .map(|q| q.player.id)
                .collect::<Vec<_>>(),
            vec![0]
        );
        assert_eq!(
            result[0]
                .team_b
                .iter()
                .map(|q| q.player.id)
                .collect::<Vec<_>>(),
            vec![1]
        );

        assert_eq!(result[1].mode, MatchmakingType::Match1v1);
        assert_eq!(
            result[1]
                .team_a
                .iter()
                .map(|q| q.player.id)
                .collect::<Vec<_>>(),
            vec![0]
        );
        assert_eq!(
            result[1]
                .team_b
                .iter()
                .map(|q| q.player.id)
                .collect::<Vec<_>>(),
            vec![1]
        );
    }

    #[test]
    fn requeue() {
        let start = Instant::now();
        let mut matchmaker = Matchmaker::with_queue_selector(16, TestQueueSelector);
        matchmaker
            .insert_player(make_player(0, 1000.0, MatchmakingType::Match1v1))
            .unwrap();
        matchmaker
            .requeue_player(make_player(1, 1200.0, MatchmakingType::Match1v1), start)
            .unwrap();

        assert_eq!(
            matchmaker.queue_sizes.get(&MatchmakingType::Match1v1),
            Some(&2)
        );

        let result = matchmaker.find_matches_for_modes(
            &[MatchmakingType::Match1v1],
            f32::NEG_INFINITY,
            Instant::now(),
        );
        assert_eq!(result.len(), 1);
        assert_eq!(result[0].mode, MatchmakingType::Match1v1);
        assert_eq!(
            result[0]
                .team_a
                .iter()
                .map(|q| q.player.id)
                .collect::<Vec<_>>(),
            vec![1]
        );
        assert_eq!(
            result[0]
                .team_b
                .iter()
                .map(|q| q.player.id)
                .collect::<Vec<_>>(),
            vec![0]
        );
    }

    #[test]
    fn insert_player_new_player_succeeds() {
        let mut matchmaker = Matchmaker::with_queue_selector(16, TestQueueSelector);
        let result = matchmaker.insert_player(make_player(0, 1000.0, MatchmakingType::Match1v1));
        assert!(result.is_ok());
        assert_eq!(
            matchmaker.queue_sizes.get(&MatchmakingType::Match1v1),
            Some(&1)
        );
    }

    #[test]
    fn insert_player_duplicate_fails() {
        let mut matchmaker = Matchmaker::with_queue_selector(16, TestQueueSelector);
        matchmaker
            .insert_player(make_player(0, 1000.0, MatchmakingType::Match1v1))
            .unwrap();
        let result = matchmaker.insert_player(make_player(0, 1000.0, MatchmakingType::Match1v1));
        assert!(matches!(result, Err(MatchmakerError::AlreadyInQueue(0))));
        // Queue size must not have been double-incremented
        assert_eq!(
            matchmaker.queue_sizes.get(&MatchmakingType::Match1v1),
            Some(&1)
        );
    }

    #[test]
    fn requeue_duplicate_fails() {
        let mut matchmaker = Matchmaker::with_queue_selector(16, TestQueueSelector);
        matchmaker
            .insert_player(make_player(0, 1000.0, MatchmakingType::Match1v1))
            .unwrap();
        let result = matchmaker.requeue_player(
            make_player(0, 1000.0, MatchmakingType::Match1v1),
            Instant::now(),
        );
        assert!(matches!(result, Err(MatchmakerError::AlreadyInQueue(0))));
    }

    #[test]
    fn random_queue_selector_first_player_past_window_not_always_selected() {
        // With 0..i (buggy), the player at position `amount` (index `amount` in 0-based iteration)
        // would be selected 100% of the time. With 0..=i (correct), it should be selected roughly
        // amount/(amount+1) ≈ 80% of the time for amount=4.
        //
        // We run 200 trials and verify the player is NOT selected at least once (probability of
        // seeing zero misses with correct code is (4/5)^200 ≈ 1.5×10^-20, so this is reliable).
        let selector = RandomQueueSelector;
        let amount = 4usize;

        // Build a pool: positions 0..amount fill the initial window,
        // position `amount` is the first player past it.
        let base = Instant::now();
        let entries: Vec<QueueEntry> = (0..=amount)
            .map(|i| QueueEntry {
                queue_time: base + Duration::from_secs(i as u64),
                player: make_player(i, 1000.0, MatchmakingType::Match1v1),
                modes: MatchmakingType::Match1v1.into(),
            })
            .collect();

        let target_id = amount; // the player just past the window
        let mut selected_count = 0usize;
        let trials = 200;

        for _ in 0..trials {
            let selected = selector.select(entries.iter(), amount);
            if selected.iter().any(|e| e.player.id == target_id) {
                selected_count += 1;
            }
        }

        // With the bug: selected_count == trials (100%)
        // With the fix: selected_count < trials (approx 80% for amount=4 → expect ~160/200)
        assert!(
            selected_count < trials,
            "player just past the window was selected in every trial — off-by-one still present"
        );
        // Also verify it's selected a meaningful number of times (not broken in the other direction)
        assert!(
            selected_count > trials / 2,
            "player just past the window was selected too rarely ({}/{})",
            selected_count,
            trials
        );
    }

    #[test]
    fn queue_time_survives_serialization_roundtrip() {
        // Simulate what api.rs does: take an Instant, convert to millis relative to matchmaker.start
        // (as stored in the ticket), then convert back. The round-trip should not lose more than
        // 1ms of precision.
        let matchmaker = Matchmaker::with_queue_selector(16, TestQueueSelector);
        let original = Instant::now();
        let millis = original.duration_since(matchmaker.start()).as_millis() as u64;
        let recovered = matchmaker.start() + Duration::from_millis(millis);

        let diff = if original > recovered {
            original - recovered
        } else {
            recovered - original
        };
        assert!(
            diff < Duration::from_millis(1),
            "round-trip error too large: {:?}",
            diff
        );
    }

    /// Builds a player rated for `mode` with the given round-trip pings (`[server_id, ping_ms]`).
    fn make_player_with_pings(id: usize, mode: MatchmakingType, pings: &[(u32, f32)]) -> Player {
        Player {
            server_pings: pings.iter().copied().collect(),
            ..make_player(id, 1000.0, mode)
        }
    }

    #[test]
    fn latency_value_buckets_by_turn_rate_step() {
        // Latency only matters once it crosses a turn-rate threshold: everything up to ~100ms one-way
        // is free (value 0), then each ~33ms step above that adds one unit.
        assert_eq!(latency_value(0.0), 0.0);
        assert_eq!(latency_value(90.0), 0.0);
        assert_eq!(latency_value(110.0), 1.0);
        assert_eq!(latency_value(160.0), 2.0);
        assert_eq!(latency_value(250.0), 5.0);
    }

    #[test]
    fn find_matches_with_latency_penalty() {
        let mut matchmaker = Matchmaker::with_queue_selector(16, TestQueueSelector);
        // Both players ping rally-point server 0 at 200ms round-trip. The match's only pair shares
        // that server, so combined = 400ms and estimated one-way latency = 200ms.
        matchmaker
            .insert_player(make_player_with_pings(
                0,
                MatchmakingType::Match1v1,
                &[(0, 200.0)],
            ))
            .unwrap();
        matchmaker
            .insert_player(make_player_with_pings(
                1,
                MatchmakingType::Match1v1,
                &[(0, 200.0)],
            ))
            .unwrap();

        // Seed a comfortable population so the adaptive relaxation is inactive and effective_min ==
        // min_quality; this test exercises the latency penalty in isolation (the adaptive threshold
        // has its own tests below).
        matchmaker
            .population_estimate
            .insert(MatchmakingType::Match1v1, 100.0);

        // At t=0 with no wait time: quality = 0 - (variance_penalty + win_prob_penalty + latency_penalty)
        // With equal ratings: variance ≈ 0, win_prob_diff ≈ 0.
        // max_latency = 200ms (one-way). latency_value(200) = 3, WEIGHT_LATENCY = 30.0, so the
        // latency penalty = 30.0 * 3 = 90.0. Quality ≈ 0 - 90.0 = -90.0.
        //
        // min_quality = -85.0 → quality (-90.0) < effective_min (-85.0) → match rejected.
        let result_strict =
            matchmaker.find_matches_for_modes(&[MatchmakingType::Match1v1], -85.0, Instant::now());
        assert!(
            result_strict.is_empty(),
            "expected no match when min_quality (-85.0) exceeds quality (-90.0) at 200ms latency"
        );

        // min_quality = -95.0 → quality (-90.0) >= effective_min (-95.0) → match forms.
        let result_lenient =
            matchmaker.find_matches_for_modes(&[MatchmakingType::Match1v1], -95.0, Instant::now());
        assert_eq!(result_lenient.len(), 1);
        assert_eq!(result_lenient[0].max_latency, 200.0);
    }

    #[test]
    fn find_matches_no_ping_data_treated_as_zero() {
        let mut matchmaker = Matchmaker::with_queue_selector(16, TestQueueSelector);
        matchmaker
            .insert_player(make_player(0, 1000.0, MatchmakingType::Match1v1))
            .unwrap();
        matchmaker
            .insert_player(make_player(1, 1000.0, MatchmakingType::Match1v1))
            .unwrap();

        // Defensive: players are required to have pings before queueing, but if a player somehow
        // carries none, latency is unknown and no penalty is applied rather than blocking the match.
        // With equal ratings: variance ≈ 0, win_prob_diff ≈ 0. Quality ≈ 0.
        let result = matchmaker.find_matches_for_modes(
            &[MatchmakingType::Match1v1],
            f32::NEG_INFINITY,
            Instant::now(),
        );
        assert_eq!(result.len(), 1);
        assert_eq!(result[0].max_latency, 0.0);
    }

    #[test]
    fn latency_picks_lowest_combined_server() {
        let mut matchmaker = Matchmaker::with_queue_selector(16, TestQueueSelector);
        // Player 0 is closest to server 1, player 1 is closest to server 2, but the cheapest server
        // they *share* is server 0 (combined 80ms → 40ms one-way). The lopsided servers must not be
        // chosen since the other player pings them poorly.
        matchmaker
            .insert_player(make_player_with_pings(
                0,
                MatchmakingType::Match1v1,
                &[(0, 40.0), (1, 10.0), (2, 500.0)],
            ))
            .unwrap();
        matchmaker
            .insert_player(make_player_with_pings(
                1,
                MatchmakingType::Match1v1,
                &[(0, 40.0), (1, 500.0), (2, 10.0)],
            ))
            .unwrap();

        let result = matchmaker.find_matches_for_modes(
            &[MatchmakingType::Match1v1],
            f32::NEG_INFINITY,
            Instant::now(),
        );
        assert_eq!(result.len(), 1);
        assert_eq!(result[0].max_latency, 40.0);
    }

    #[test]
    fn latency_no_shared_server_rejects_match() {
        let mut matchmaker = Matchmaker::with_queue_selector(16, TestQueueSelector);
        // Both players have pings, but to disjoint servers. The game loader's `createBestRoute` could
        // not pick a server both can use, so the launch would fail; the matchmaker must not form this
        // match (even at the most lenient quality threshold) rather than repeatedly matching the same
        // impossible pair and failing to launch.
        matchmaker
            .insert_player(make_player_with_pings(
                0,
                MatchmakingType::Match1v1,
                &[(1, 20.0)],
            ))
            .unwrap();
        matchmaker
            .insert_player(make_player_with_pings(
                1,
                MatchmakingType::Match1v1,
                &[(2, 20.0)],
            ))
            .unwrap();

        let result = matchmaker.find_matches_for_modes(
            &[MatchmakingType::Match1v1],
            f32::NEG_INFINITY,
            Instant::now(),
        );
        assert!(
            result.is_empty(),
            "expected no match when players share no pinged rally-point server",
        );
    }

    #[test]
    fn latency_unrouteable_pair_rejects_team_match() {
        let mut matchmaker = Matchmaker::with_queue_selector(16, TestQueueSelector);
        // A 2v2 where three players share server 0 but player 2 only pinged server 1. Every team
        // split still leaves at least one pair involving player 2 with no shared server, so the match
        // is unrouteable regardless of how teams are formed and must be rejected.
        matchmaker
            .insert_player(make_player_with_pings(
                0,
                MatchmakingType::Match2v2,
                &[(0, 20.0)],
            ))
            .unwrap();
        matchmaker
            .insert_player(make_player_with_pings(
                1,
                MatchmakingType::Match2v2,
                &[(0, 20.0)],
            ))
            .unwrap();
        matchmaker
            .insert_player(make_player_with_pings(
                2,
                MatchmakingType::Match2v2,
                &[(1, 20.0)],
            ))
            .unwrap();
        matchmaker
            .insert_player(make_player_with_pings(
                3,
                MatchmakingType::Match2v2,
                &[(0, 20.0)],
            ))
            .unwrap();

        let result = matchmaker.find_matches_for_modes(
            &[MatchmakingType::Match2v2],
            f32::NEG_INFINITY,
            Instant::now(),
        );
        assert!(
            result.is_empty(),
            "expected no match when a player pair shares no pinged rally-point server",
        );
    }

    #[test]
    fn latency_team_mode_uses_worst_pair_across_all_pairs() {
        let mut matchmaker = Matchmaker::with_queue_selector(16, TestQueueSelector);
        // A 2v2 has six pairwise links. Three players ping server 0 at 20ms; player 2 pings it at
        // 200ms. The worst link is therefore any pair involving player 2: (20 + 200) / 2 = 110ms.
        // Latency is independent of how the matcher splits the teams — it's the worst pair overall.
        matchmaker
            .insert_player(make_player_with_pings(
                0,
                MatchmakingType::Match2v2,
                &[(0, 20.0)],
            ))
            .unwrap();
        matchmaker
            .insert_player(make_player_with_pings(
                1,
                MatchmakingType::Match2v2,
                &[(0, 20.0)],
            ))
            .unwrap();
        matchmaker
            .insert_player(make_player_with_pings(
                2,
                MatchmakingType::Match2v2,
                &[(0, 200.0)],
            ))
            .unwrap();
        matchmaker
            .insert_player(make_player_with_pings(
                3,
                MatchmakingType::Match2v2,
                &[(0, 20.0)],
            ))
            .unwrap();

        let result = matchmaker.find_matches_for_modes(
            &[MatchmakingType::Match2v2],
            f32::NEG_INFINITY,
            Instant::now(),
        );
        assert_eq!(result.len(), 1);
        assert_eq!(result[0].max_latency, 110.0);
    }

    #[test]
    fn effective_rating_reduces_for_uncertain_player() {
        // With UNCERTAINTY_K = 1.0:
        // effective_rating(1500, σ=350) = 1500 - 1.0 * 350 = 1150
        // effective_rating(1500, σ=0)   = 1500 (certain player, no reduction)
        // Two certain 1500-rated players: variance = 0, forms immediately at quality ≈ 0.
        // One 1500/certain + one 1500/uncertain: effective ratings are 1500 and 1150.
        // Variance of [1500, 1150] = (1500-1325)^2 + (1150-1325)^2 = 30625.
        // Penalty = WEIGHT_RATING_VARIANCE * 30625 = 0.005 * 30625 = 153.125 s.
        // So quality ≈ 0 - 153.125 = -153.125 (very negative at t=0).
        let uncertain = Player {
            id: 0,
            ratings: HashMap::from([(
                MatchmakingType::Match1v1,
                PlayerModeRating {
                    rating: 1500.0,
                    uncertainty: Some(350.0),
                },
            )]),
            map_selections: HashMap::new(),
            server_pings: HashMap::new(),
        };
        let certain = Player {
            id: 1,
            ratings: HashMap::from([(
                MatchmakingType::Match1v1,
                PlayerModeRating {
                    rating: 1500.0,
                    uncertainty: None,
                },
            )]),
            map_selections: HashMap::new(),
            server_pings: HashMap::new(),
        };

        let mut mm = Matchmaker::with_queue_selector(16, TestQueueSelector);
        mm.insert_player(uncertain).unwrap();
        mm.insert_player(certain).unwrap();

        let result = mm.find_matches_for_modes(
            &[MatchmakingType::Match1v1],
            f32::NEG_INFINITY,
            Instant::now(),
        );
        assert_eq!(result.len(), 1);
        // Quality is significantly negative at t=0 due to variance penalty from σ=350
        assert!(
            result[0].quality < 0.0,
            "uncertain player should cause negative quality at t=0: got {}",
            result[0].quality
        );
    }

    #[test]
    fn per_mode_ratings_used_for_matching() {
        // Player A queued for 1v1 (rating 1500) and Fastest (rating 500)
        // Player B queued for 1v1 (rating 1500) and Fastest (rating 500)
        // They should match in both modes with near-zero quality penalty (equal ratings)
        let mut matchmaker = Matchmaker::with_queue_selector(16, TestQueueSelector);
        let player_a = Player {
            id: 0,
            ratings: HashMap::from([
                (
                    MatchmakingType::Match1v1,
                    PlayerModeRating {
                        rating: 1500.0,
                        uncertainty: None,
                    },
                ),
                (
                    MatchmakingType::Match1v1Fastest,
                    PlayerModeRating {
                        rating: 500.0,
                        uncertainty: None,
                    },
                ),
            ]),
            map_selections: HashMap::new(),
            server_pings: HashMap::new(),
        };
        let player_b = Player {
            id: 1,
            ratings: HashMap::from([
                (
                    MatchmakingType::Match1v1,
                    PlayerModeRating {
                        rating: 1500.0,
                        uncertainty: None,
                    },
                ),
                (
                    MatchmakingType::Match1v1Fastest,
                    PlayerModeRating {
                        rating: 500.0,
                        uncertainty: None,
                    },
                ),
            ]),
            map_selections: HashMap::new(),
            server_pings: HashMap::new(),
        };
        matchmaker.insert_player(player_a).unwrap();
        matchmaker.insert_player(player_b).unwrap();

        // Both modes match. With equal ratings in each mode, quality penalty is near zero.
        let result = matchmaker.find_matches_for_modes(
            &[MatchmakingType::Match1v1, MatchmakingType::Match1v1Fastest],
            f32::NEG_INFINITY,
            Instant::now(),
        );
        assert_eq!(result.len(), 2);
        // Both matches form (one per mode)
        assert!(result.iter().any(|m| m.mode == MatchmakingType::Match1v1));
        assert!(
            result
                .iter()
                .any(|m| m.mode == MatchmakingType::Match1v1Fastest)
        );
    }

    /// Builds a player queued for a single mode with the given positive map selections.
    fn make_player_with_maps(
        id: usize,
        rating: f32,
        mode: MatchmakingType,
        maps: &[&str],
    ) -> Player {
        Player {
            id,
            ratings: HashMap::from([(
                mode,
                PlayerModeRating {
                    rating,
                    uncertainty: None,
                },
            )]),
            map_selections: HashMap::from([(mode, maps.iter().map(|m| m.to_string()).collect())]),
            server_pings: HashMap::new(),
        }
    }

    #[test]
    fn pick_mode_does_not_match_disjoint_map_selections() {
        let mut matchmaker = Matchmaker::with_queue_selector(16, TestQueueSelector);
        matchmaker
            .insert_player(make_player_with_maps(
                0,
                1000.0,
                MatchmakingType::Match1v1,
                &["a"],
            ))
            .unwrap();
        matchmaker
            .insert_player(make_player_with_maps(
                1,
                1000.0,
                MatchmakingType::Match1v1,
                &["b"],
            ))
            .unwrap();

        // Even at the most lenient quality, players who share no map must not be matched (the match
        // map could not be chosen and the match would fail to start).
        let result = matchmaker.find_matches_for_modes(
            &[MatchmakingType::Match1v1],
            f32::NEG_INFINITY,
            Instant::now(),
        );
        assert!(result.is_empty());
    }

    #[test]
    fn pick_mode_matches_when_selections_share_a_map() {
        let mut matchmaker = Matchmaker::with_queue_selector(16, TestQueueSelector);
        matchmaker
            .insert_player(make_player_with_maps(
                0,
                1000.0,
                MatchmakingType::Match1v1,
                &["a", "b"],
            ))
            .unwrap();
        matchmaker
            .insert_player(make_player_with_maps(
                1,
                1000.0,
                MatchmakingType::Match1v1,
                &["b", "c"],
            ))
            .unwrap();

        let result = matchmaker.find_matches_for_modes(
            &[MatchmakingType::Match1v1],
            f32::NEG_INFINITY,
            Instant::now(),
        );
        assert_eq!(result.len(), 1);
    }

    #[test]
    fn effective_min_relaxes_only_when_smoothed_population_low() {
        let mut mm = Matchmaker::with_queue_selector(16, TestQueueSelector);
        let mode = MatchmakingType::Match1v1; // total_players 2 → comfortable 4

        // No population history yet: treated as 0 → maximally relaxed.
        assert_eq!(mm.effective_min_quality(mode, -30.0), -30.0 - 15.0 * 4.0);

        // Comfortably populated → no relaxation.
        mm.population_estimate.insert(mode, 10.0);
        assert_eq!(mm.effective_min_quality(mode, -30.0), -30.0);

        // Exactly at the comfortable line → no relaxation.
        mm.population_estimate.insert(mode, 4.0);
        assert_eq!(mm.effective_min_quality(mode, -30.0), -30.0);

        // Persistently low population → partial relaxation (1 player short of comfortable).
        mm.population_estimate.insert(mode, 3.0);
        assert_eq!(mm.effective_min_quality(mode, -30.0), -30.0 - 15.0 * 1.0);
    }

    #[test]
    fn population_falls_back_to_window_peak_before_first_fold() {
        let mut mm = Matchmaker::with_queue_selector(16, TestQueueSelector);
        let mode = MatchmakingType::Match1v1; // comfortable 4

        // A healthy queue forms right after a (re)start, before any window has folded — the smoothed
        // estimate is still absent. The threshold must not relax: a full queue is not low population.
        for i in 0..6 {
            mm.insert_player(make_player(i, 1500.0, mode)).unwrap();
        }
        assert!(!mm.population_estimate.contains_key(&mode));
        assert_eq!(mm.effective_min_quality(mode, -30.0), -30.0);

        // Draining the queue during the warmup window must not relax it either — the peak holds.
        for i in 0..4 {
            mm.remove_player(i);
        }
        assert_eq!(mm.queue_sizes.get(&mode), Some(&2));
        assert_eq!(mm.effective_min_quality(mode, -30.0), -30.0);
    }

    #[test]
    fn population_estimate_uses_window_peak_not_instantaneous() {
        let mut mm = Matchmaker::with_queue_selector(16, TestQueueSelector);
        let mode = MatchmakingType::Match1v1; // comfortable 4
        let start = mm.start();

        // A healthy burst of players queue during the first window (peak 8, well above comfortable).
        for i in 0..8 {
            mm.insert_player(make_player(i, 1500.0, mode)).unwrap();
        }
        assert_eq!(mm.queue_sizes.get(&mode), Some(&8));

        // Fold the first window: the estimate seeds directly to the window peak.
        mm.update_population_estimates(start + POPULATION_WINDOW);
        assert_eq!(mm.population_estimate.get(&mode).copied(), Some(8.0));

        // The matchmaker drains most of the queue (3 matches formed, 6 players removed), leaving 2 —
        // below the comfortable size of 4.
        for i in 0..6 {
            mm.remove_player(i);
        }
        assert_eq!(mm.queue_sizes.get(&mode), Some(&2));

        // Despite the instantaneous queue being below comfortable, the smoothed population is still
        // high, so the threshold stays strict. Keying off the instantaneous size — the old bug —
        // would relax it here even though the population is healthy.
        assert_eq!(mm.effective_min_quality(mode, -30.0), -30.0);
    }

    #[test]
    fn population_estimate_decays_across_idle_windows() {
        let mut mm = Matchmaker::with_queue_selector(16, TestQueueSelector);
        let mode = MatchmakingType::Match1v1;
        let start = mm.start();

        // 4 players present during the first window.
        for i in 0..4 {
            mm.insert_player(make_player(i, 1500.0, mode)).unwrap();
        }
        mm.update_population_estimates(start + POPULATION_WINDOW);
        assert_eq!(mm.population_estimate.get(&mode).copied(), Some(4.0));

        // Everyone leaves. The boundary carried the live size (4) into the next window's peak, so the
        // following fold still sees them (they were present at window start) and the estimate holds.
        for i in 0..4 {
            mm.remove_player(i);
        }
        mm.update_population_estimates(start + 2 * POPULATION_WINDOW);
        assert!((mm.population_estimate[&mode] - 4.0).abs() < 1e-4);

        // Subsequent idle windows have peak 0 and decay the estimate by the per-window retention
        // factor (1 - alpha) each, where alpha is derived from POPULATION_HALF_LIFE.
        let retention = 1.0 - population_alpha();
        mm.update_population_estimates(start + 3 * POPULATION_WINDOW);
        assert!((mm.population_estimate[&mode] - 4.0 * retention).abs() < 1e-4);
        mm.update_population_estimates(start + 4 * POPULATION_WINDOW);
        assert!((mm.population_estimate[&mode] - 4.0 * retention * retention).abs() < 1e-4);
    }

    #[test]
    fn population_half_life_matches_decay() {
        // One half-life of idle windows should decay the estimate to half. Guards against
        // POPULATION_HALF_LIFE and POPULATION_WINDOW drifting out of the alpha derivation.
        let mut mm = Matchmaker::with_queue_selector(16, TestQueueSelector);
        let mode = MatchmakingType::Match1v1;
        let start = mm.start();

        mm.population_estimate.insert(mode, 8.0);
        // Park the window start so exactly the windows we fold below have elapsed.
        let windows = (POPULATION_HALF_LIFE.as_secs() / POPULATION_WINDOW.as_secs()) as u32;
        for w in 1..=windows {
            mm.update_population_estimates(start + w * POPULATION_WINDOW);
        }
        assert!(
            (mm.population_estimate[&mode] - 4.0).abs() < 1e-3,
            "after one half-life of idle windows the estimate should halve, got {}",
            mm.population_estimate[&mode]
        );
    }
}
