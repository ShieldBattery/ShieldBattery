use std::{
    collections::{HashMap, HashSet},
    sync::Arc,
    time::{Duration, Instant},
};

use enumset::EnumSet;
use itertools::Itertools;
use rand::{RngExt, seq::SliceRandom};
use strum::IntoEnumIterator;

use crate::matchmaking::MatchmakingType;
use crate::matchmaking::backbone::BackboneRttTable;
use crate::matchmaking::config::MatchmakerConfig;

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
pairwise link, derived from each player's chosen region and their measured round-trip time to it
(see [`prepared_match_latency`]). Latency only changes the play experience in discrete jumps — the game holds
a fixed turn rate / input buffer until latency crosses a threshold, so anything under ~100ms one-way
plays identically. The quality formula therefore penalizes `latency_value(max_latency)` (a count of
turn-rate steps) rather than raw milliseconds (see [`latency_value`]).

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

/// Length of one population-sampling window. At each boundary the window's peak concurrent queue size
/// is folded into the smoothed per-mode population estimate (see
/// [`Matchmaker::update_population_estimates`]). This sets the sampling granularity only; the EWMA
/// time constant is the per-mode, runtime-configurable `population_half_life` (see
/// [`crate::matchmaking::config::ModeConfig`]).
const POPULATION_WINDOW: Duration = Duration::from_secs(60);

/// Per-window EWMA blend factor for a given half-life and sampling window:
/// `alpha = 1 - 0.5^(window / half_life)`, i.e. the fraction of a window's peak folded into the
/// estimate each fold, chosen so the estimate halves over exactly one `half_life` of idle windows.
fn ewma_alpha(half_life: Duration, window: Duration) -> f32 {
    1.0 - 0.5_f32.powf(window.as_secs_f32() / half_life.as_secs_f32())
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
    /// The game server region this player asked to home in, if any. Combined with `rtt_ms` and the
    /// backbone table to estimate a candidate match's latency (see [`prepared_match_latency`]). A player with
    /// no region (dev loopback, or no coordinator-configured regions) contributes no latency
    /// information and matches involving them are not penalized.
    pub region: Option<String>,
    /// This player's measured round-trip time (ms) to `region`. Present only alongside a `region`;
    /// a player missing either carries no latency signal.
    pub rtt_ms: Option<f32>,
}

/// Returns the conservative skill estimate: the player's rating minus `uncertainty_k` standard
/// deviations. A player with high uncertainty will have a lower effective rating, meaning they can
/// match against a wider range of opponents without the quality formula penalizing the match.
fn effective_rating(player: &Player, mode: MatchmakingType, uncertainty_k: f32) -> f32 {
    let mode_rating = player.ratings.get(&mode).copied().unwrap_or_default();
    mode_rating.rating - uncertainty_k * mode_rating.uncertainty.unwrap_or(0.0)
}

/// Converts an estimated one-way latency (ms) into the number of turn-rate "steps" it costs — the
/// form the quality formula actually penalizes (weighted by the configurable `weight_latency`).
/// Network latency only changes
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
    /// Runtime-tunable configuration (weights, adaptive-threshold knobs, max players examined). Read
    /// fresh on each search tick and replaceable via [`Matchmaker::set_config`] so an admin change
    /// takes effect without a restart.
    config: Arc<MatchmakerConfig>,
    /// Region-to-region backbone latency table used to estimate a candidate match's latency. Read
    /// fresh on each search tick and replaceable via [`Matchmaker::set_backbone`], so a refreshed
    /// coordinator-served table (or an operator override change) takes effect without a restart, like
    /// `config`.
    backbone: Arc<BackboneRttTable>,
    queue: Vec<QueueEntry>,
    queued_player_ids: HashSet<usize>,
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
    /// (uncertainty-discounted) ratings — see
    /// [`team_rating_for_indices`]/[`effective_rating`]. Uncertainty
    /// is folded in via the effective rating rather than a separate σ-weight, so this differs from
    /// the Glicko-2 rating update's σ-weighted expected score (the comparison this telemetry
    /// enables). 0.5 means a perfectly balanced match.
    pub win_probability: f32,
    /// Effective team ratings (see [`team_rating_for_indices`]) used to compute `win_probability`.
    pub team_a_rating: f32,
    pub team_b_rating: f32,
    /// Estimated one-way latency (ms) of the match's worst pairwise link (see
    /// [`prepared_match_latency`]).
    /// Recorded in raw milliseconds for calibration; the quality score itself penalizes
    /// `latency_value(max_latency)` weighted by `WEIGHT_LATENCY`, not these raw ms.
    pub max_latency: f32,
}

#[derive(Debug, Clone, PartialEq)]
pub struct ModeQueueState {
    pub mode: MatchmakingType,
    pub queue_size: usize,
    pub population_estimate: Option<f32>,
    pub effective_min_quality: f32,
}

#[derive(Debug)]
pub struct TickResult {
    /// Queue and adaptive-threshold state after population roll-forward and before matched players
    /// are removed.
    pub queue_before_matching: Vec<ModeQueueState>,
    /// Mutually disjoint matches whose players have already been removed from the queue.
    pub matches: Vec<Match>,
    pub search_stats: Vec<ModeSearchStats>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ModeSearchStats {
    pub mode: MatchmakingType,
    pub players_examined: usize,
    pub rosters_evaluated: u64,
    pub map_rejections: u64,
    pub upper_bound_rejections: u64,
    pub team_partitions_evaluated: u64,
    pub quality_rejections: u64,
    pub qualifying_candidates: u64,
    pub conflict_rejections: u64,
    pub matches_formed: u64,
}

impl ModeSearchStats {
    fn new(mode: MatchmakingType) -> Self {
        Self {
            mode,
            players_examined: 0,
            rosters_evaluated: 0,
            map_rejections: 0,
            upper_bound_rejections: 0,
            team_partitions_evaluated: 0,
            quality_rejections: 0,
            qualifying_candidates: 0,
            conflict_rejections: 0,
            matches_formed: 0,
        }
    }
}

struct PreparedPlayer<'a> {
    selected_index: usize,
    entry: &'a QueueEntry,
    effective_rating: f32,
    map_selection_bits: Option<Vec<u64>>,
}

struct PairLatencies {
    player_count: usize,
    values: Vec<f32>,
}

impl PairLatencies {
    fn new(entries: &[&QueueEntry], backbone: &BackboneRttTable) -> Self {
        let player_count = entries.len();
        let mut values = vec![0.0; player_count * player_count];
        for (i, a) in entries.iter().enumerate() {
            for (j, b) in entries.iter().enumerate().skip(i + 1) {
                let latency = pair_latency(a, b, backbone);
                values[i * player_count + j] = latency;
                values[j * player_count + i] = latency;
            }
        }
        Self {
            player_count,
            values,
        }
    }

    fn get(&self, a: usize, b: usize) -> f32 {
        self.values[a * self.player_count + b]
    }
}

fn pair_latency(a: &QueueEntry, b: &QueueEntry, backbone: &BackboneRttTable) -> f32 {
    if let (Some(region_a), Some(rtt_a), Some(region_b), Some(rtt_b)) = (
        a.player.region.as_deref(),
        a.player.rtt_ms,
        b.player.region.as_deref(),
        b.player.rtt_ms,
    ) {
        rtt_a / 2.0 + backbone.rtt(region_a, region_b) / 2.0 + rtt_b / 2.0
    } else {
        0.0
    }
}

fn prepared_match_latency(entries: &[&PreparedPlayer<'_>], latencies: &PairLatencies) -> f32 {
    entries
        .iter()
        .enumerate()
        .flat_map(|(i, a)| {
            entries[i + 1..]
                .iter()
                .map(move |b| latencies.get(a.selected_index, b.selected_index))
        })
        .fold(0.0, f32::max)
}

fn prepared_selections_share_a_map(entries: &[&PreparedPlayer<'_>]) -> bool {
    if entries
        .iter()
        .any(|entry| entry.map_selection_bits.is_none())
    {
        return true;
    }

    let first = entries[0].map_selection_bits.as_ref().unwrap();
    (0..first.len()).any(|word| {
        entries
            .iter()
            .map(|entry| entry.map_selection_bits.as_ref().unwrap()[word])
            .fold(u64::MAX, |intersection, selections| {
                intersection & selections
            })
            != 0
    })
}

fn prepare_map_selection_bits(
    entries: &[&QueueEntry],
    mode: MatchmakingType,
) -> Vec<Option<Vec<u64>>> {
    let mut map_indices = HashMap::new();
    for selections in entries
        .iter()
        .filter_map(|entry| entry.player.map_selections.get(&mode))
    {
        for map in selections {
            let next_index = map_indices.len();
            map_indices.entry(map.as_str()).or_insert(next_index);
        }
    }
    let word_count = map_indices.len().div_ceil(u64::BITS as usize);

    entries
        .iter()
        .map(|entry| {
            entry.player.map_selections.get(&mode).map(|selections| {
                let mut bits = vec![0; word_count];
                for map in selections {
                    let index = map_indices[map.as_str()];
                    bits[index / u64::BITS as usize] |= 1 << (index % u64::BITS as usize);
                }
                bits
            })
        })
        .collect()
}

const MAX_TEAM_SIZE: usize = 3;

#[derive(Debug, Clone, Copy)]
struct TeamIds {
    ids: [usize; MAX_TEAM_SIZE],
    len: usize,
}

impl TeamIds {
    fn from_indices(entries: &[&PreparedPlayer<'_>], indices: &[usize]) -> Self {
        debug_assert!(indices.len() <= MAX_TEAM_SIZE);
        let mut ids = [0; MAX_TEAM_SIZE];
        for (target, &index) in ids.iter_mut().zip(indices) {
            *target = entries[index].entry.player.id;
        }
        Self {
            ids,
            len: indices.len(),
        }
    }

    fn iter(&self) -> impl Iterator<Item = usize> + '_ {
        self.ids[..self.len].iter().copied()
    }

    fn clone_entries(&self, entries: &HashMap<usize, &QueueEntry>) -> Vec<QueueEntry> {
        self.iter()
            .map(|id| (*entries.get(&id).expect("candidate player must be queued")).clone())
            .collect()
    }

    fn take_entries(&self, entries: &mut HashMap<usize, QueueEntry>) -> Vec<QueueEntry> {
        self.iter()
            .map(|id| {
                entries
                    .remove(&id)
                    .expect("claimed candidate player must have been drained")
            })
            .collect()
    }
}

fn team_rating_for_indices(entries: &[&PreparedPlayer<'_>], indices: &[usize]) -> f32 {
    if indices.len() == 1 {
        entries[indices[0]].effective_rating
    } else {
        let sum = indices
            .iter()
            .map(|&index| {
                let rating = entries[index].effective_rating;
                rating * rating
            })
            .sum::<f32>();
        // TODO(tec27): Determine what the proper exponent is for this from win/loss data
        (sum / indices.len() as f32).sqrt()
    }
}

fn best_team_partition(entries: &[&PreparedPlayer<'_>]) -> (TeamIds, TeamIds, f32, f32) {
    let team_size = entries.len() / 2;
    if team_size == 1 {
        return (
            TeamIds::from_indices(entries, &[0]),
            TeamIds::from_indices(entries, &[1]),
            entries[0].effective_rating,
            entries[1].effective_rating,
        );
    }

    let mut best = None;
    let mut consider = |team_a_indices: &[usize]| {
        let mut team_b_indices = [0; MAX_TEAM_SIZE];
        let mut team_b_len = 0;
        for index in 0..entries.len() {
            if !team_a_indices.contains(&index) {
                team_b_indices[team_b_len] = index;
                team_b_len += 1;
            }
        }
        let team_b_indices = &team_b_indices[..team_b_len];
        let rating_a = team_rating_for_indices(entries, team_a_indices);
        let rating_b = team_rating_for_indices(entries, team_b_indices);
        let difference = (rating_a - rating_b).abs();
        let should_replace = best
            .as_ref()
            .map(
                |(best_difference, ..): &(f32, TeamIds, TeamIds, f32, f32)| {
                    difference.total_cmp(best_difference).is_lt()
                },
            )
            .unwrap_or(true);
        if should_replace {
            best = Some((
                difference,
                TeamIds::from_indices(entries, team_a_indices),
                TeamIds::from_indices(entries, team_b_indices),
                rating_a,
                rating_b,
            ));
        }
    };

    match team_size {
        2 => {
            for second in 1..entries.len() {
                consider(&[0, second]);
            }
        }
        3 => {
            for second in 1..entries.len() {
                for third in second + 1..entries.len() {
                    consider(&[0, second, third]);
                }
            }
        }
        _ => unreachable!("supported matchmaking modes have team sizes from one to three"),
    }

    best.map(|(_, team_a, team_b, rating_a, rating_b)| (team_a, team_b, rating_a, rating_b))
        .unwrap()
}

fn unique_team_partition_count(team_size: usize) -> u64 {
    match team_size {
        1 => 1,
        2 => 3,
        3 => 10,
        _ => unreachable!("supported matchmaking modes have team sizes from one to three"),
    }
}

#[derive(Debug)]
struct MatchCandidate {
    mode: MatchmakingType,
    team_a: TeamIds,
    team_b: TeamIds,
    quality: f32,
    skill_variance: f32,
    win_probability: f32,
    team_a_rating: f32,
    team_b_rating: f32,
    max_latency: f32,
}

struct CandidateSearchResult {
    candidates: Vec<MatchCandidate>,
    stats: Vec<ModeSearchStats>,
}

impl MatchCandidate {
    fn player_ids(&self) -> impl Iterator<Item = usize> + '_ {
        self.team_a.iter().chain(self.team_b.iter())
    }

    fn clone_match(&self, entries: &HashMap<usize, &QueueEntry>) -> Match {
        Match {
            mode: self.mode,
            team_a: self.team_a.clone_entries(entries),
            team_b: self.team_b.clone_entries(entries),
            quality: self.quality,
            skill_variance: self.skill_variance,
            win_probability: self.win_probability,
            team_a_rating: self.team_a_rating,
            team_b_rating: self.team_b_rating,
            max_latency: self.max_latency,
        }
    }

    fn into_match(self, entries: &mut HashMap<usize, QueueEntry>) -> Match {
        Match {
            mode: self.mode,
            team_a: self.team_a.take_entries(entries),
            team_b: self.team_b.take_entries(entries),
            quality: self.quality,
            skill_variance: self.skill_variance,
            win_probability: self.win_probability,
            team_a_rating: self.team_a_rating,
            team_b_rating: self.team_b_rating,
            max_latency: self.max_latency,
        }
    }
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
#[derive(Debug, Clone, Copy)]
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
    pub fn new(
        config: Arc<MatchmakerConfig>,
        backbone: BackboneRttTable,
    ) -> Matchmaker<RandomQueueSelector> {
        let mut matchmaker = Matchmaker::with_queue_selector(config, RandomQueueSelector);
        matchmaker.backbone = Arc::new(backbone);
        matchmaker
    }
}

/// Returns the win probability for player A vs player B (or effective team rating A vs effective
/// team rating B). This is only an approximation as we don't have the uncertainty values for either
/// side.
fn get_win_probability(rating_a: f32, rating_b: f32) -> f32 {
    1.0 / (1.0 + 10.0f32.powf((rating_b - rating_a) / 400.0))
}

impl<T: QueueSelector> Matchmaker<T> {
    fn with_queue_selector(config: Arc<MatchmakerConfig>, queue_selector: T) -> Matchmaker<T> {
        let start = Instant::now();
        Self {
            start,
            config,
            backbone: Arc::new(BackboneRttTable::default()),
            queue: Vec::new(),
            queued_player_ids: HashSet::new(),
            queue_sizes: HashMap::new(),
            population_estimate: HashMap::new(),
            population_peak: HashMap::new(),
            population_window_start: start,
            queue_selector,
        }
    }

    /// Replaces the active configuration (e.g. after an admin edits the matchmaker knobs). Takes
    /// effect on the next search tick; the queue and population history are untouched.
    pub fn set_config(&mut self, config: Arc<MatchmakerConfig>) {
        self.config = config;
    }

    /// Replaces the active backbone RTT table (e.g. after the coordinator fetch loop refreshes the
    /// served pairs). Takes effect on the next search tick; the queue and population history are
    /// untouched.
    pub fn set_backbone(&mut self, backbone: BackboneRttTable) {
        self.backbone = Arc::new(backbone);
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
        if self.queued_player_ids.contains(&player.id) {
            return Err(MatchmakerError::AlreadyInQueue(player.id));
        }

        let entry = QueueEntry {
            queue_time,
            player,
            modes,
        };
        self.queued_player_ids.insert(entry.player.id);

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
            self.queued_player_ids.remove(&entry.player.id);
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
    /// average (factor [`ewma_alpha`], derived from each mode's configured `population_half_life`) and
    /// the peak is reset to the live queue size for the next window.
    ///
    /// Sampling the *window peak* rather than the instantaneous queue size is the whole point: the
    /// matchmaker removes every match it forms each tick, so the instantaneous size sits near the
    /// unmatched residual almost always and would read as low population even at peak hours. The peak
    /// captures the players who passed through the window, and the EWMA decays toward 0 across idle
    /// windows so the threshold still relaxes during a genuine dead hour.
    pub fn update_population_estimates(&mut self, now: Instant) {
        while now.duration_since(self.population_window_start) >= POPULATION_WINDOW {
            for mode in MatchmakingType::iter() {
                let alpha = ewma_alpha(
                    self.config.for_mode(mode).population_half_life,
                    POPULATION_WINDOW,
                );
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

    /// The minimum quality a match in `mode` must reach to form right now. Equal to the mode's
    /// configured `min_quality` when its smoothed population is comfortable, and relaxed by
    /// `adaptive_decay_per_missing` seconds per player below the comfortable population so matches
    /// still form when few are around.
    pub fn effective_min_quality(&self, mode: MatchmakingType) -> f32 {
        let cfg = self.config.for_mode(mode);
        let comfortable = (mode.total_players() * cfg.adaptive_comfortable_multiplier) as f32;
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
            cfg.min_quality - cfg.adaptive_decay_per_missing * (comfortable - population)
        } else {
            cfg.min_quality
        }
    }

    /// Runs one complete matchmaking state transition. Population sampling, proposal ordering,
    /// cross-mode conflict resolution, and queue removal all happen before this method returns, so
    /// callers cannot accidentally observe or mutate the queue between planning and claiming.
    pub fn run_tick(
        &mut self,
        now: Instant,
        config: Arc<MatchmakerConfig>,
        backbone: Arc<BackboneRttTable>,
    ) -> TickResult {
        let mut modes = MatchmakingType::iter().collect::<Vec<_>>();
        modes.shuffle(&mut rand::rng());
        self.run_tick_for_modes(&modes, now, config, backbone)
    }

    fn run_tick_for_modes(
        &mut self,
        modes: &[MatchmakingType],
        now: Instant,
        config: Arc<MatchmakerConfig>,
        backbone: Arc<BackboneRttTable>,
    ) -> TickResult {
        self.config = config;
        self.backbone = backbone;
        self.update_population_estimates(now);

        let queue_before_matching = MatchmakingType::iter()
            .map(|mode| ModeQueueState {
                mode,
                queue_size: self.queue_size(mode),
                population_estimate: self.population_estimate(mode),
                effective_min_quality: self.effective_min_quality(mode),
            })
            .collect();

        let CandidateSearchResult {
            candidates: proposed,
            mut stats,
        } = self.find_match_candidates_for_modes(modes, now);
        let stats_by_mode = stats
            .iter()
            .enumerate()
            .map(|(index, stats)| (stats.mode, index))
            .collect::<HashMap<_, _>>();
        let mut claimed = HashSet::new();
        let selected = proposed
            .into_iter()
            .filter_map(|candidate| {
                let mode_stats = &mut stats[stats_by_mode[&candidate.mode]];
                if candidate.player_ids().any(|id| claimed.contains(&id)) {
                    mode_stats.conflict_rejections += 1;
                    return None;
                }
                claimed.extend(candidate.player_ids());
                mode_stats.matches_formed += 1;
                Some(candidate)
            })
            .collect::<Vec<_>>();

        let queue_sizes = &mut self.queue_sizes;
        let mut matched_entries = HashMap::with_capacity(claimed.len());
        let mut remaining = Vec::with_capacity(self.queue.len() - claimed.len());
        for entry in self.queue.drain(..) {
            if claimed.contains(&entry.player.id) {
                self.queued_player_ids.remove(&entry.player.id);
                for mode in entry.modes {
                    queue_sizes.entry(mode).and_modify(|size| *size -= 1);
                }
                matched_entries.insert(entry.player.id, entry);
            } else {
                remaining.push(entry);
            }
        }
        self.queue = remaining;

        let matches = selected
            .into_iter()
            .map(|candidate| candidate.into_match(&mut matched_entries))
            .collect();
        debug_assert!(matched_entries.is_empty());

        TickResult {
            queue_before_matching,
            matches,
            search_stats: stats,
        }
    }

    /// Finds matches for all modes, returning a Vec the proposed matches. Matches will be returned
    /// ordered by [MatchmakingType] and then the value of that match (so "better" matches will
    /// appear first). Only matches reaching each mode's adaptive minimum quality are returned.
    pub fn find_matches(&self, now: Instant) -> Vec<Match> {
        let mut modes = MatchmakingType::iter().collect::<Vec<_>>();
        modes.shuffle(&mut rand::rng());
        self.find_matches_for_modes(&modes, now)
    }

    /// Finds matches for the given [MatchmakingType]s, returning a Vec of the proposed matches.
    /// Matches will be returned ordered by [MatchmakingType] (in the order given) and then the
    /// value of that match (so "better" matches will appear first). Only matches reaching each mode's
    /// adaptive minimum quality (see [`Self::effective_min_quality`]) are returned.
    pub fn find_matches_for_modes(&self, modes: &[MatchmakingType], now: Instant) -> Vec<Match> {
        let queued_entries = self
            .queue
            .iter()
            .map(|entry| (entry.player.id, entry))
            .collect::<HashMap<_, _>>();
        self.find_match_candidates_for_modes(modes, now)
            .candidates
            .iter()
            .map(|candidate| candidate.clone_match(&queued_entries))
            .collect()
    }

    fn find_match_candidates_for_modes(
        &self,
        modes: &[MatchmakingType],
        now: Instant,
    ) -> CandidateSearchResult {
        let mut matches = Vec::new();
        let mut stats = Vec::with_capacity(modes.len());

        for mode in modes {
            let mut mode_stats = ModeSearchStats::new(*mode);
            if self.queue_size(*mode) < mode.total_players() {
                // Avoid iterating the whole queue if this mode couldn't generate a valid match
                stats.push(mode_stats);
                continue;
            }

            let mode_cfg = self.config.for_mode(*mode);
            let effective_min = self.effective_min_quality(*mode);

            // Only look at players queued for this mode
            let mode_queue = self.queue.iter().filter(|e| e.modes.contains(*mode));
            // Select a small number of possible players to look at to limit the total possible
            // matches we need to examine
            let selected_entries = self
                .queue_selector
                .select(mode_queue, self.config.max_players_examined);
            mode_stats.players_examined = selected_entries.len();
            let pair_latencies = PairLatencies::new(&selected_entries, &self.backbone);
            let map_selection_bits = prepare_map_selection_bits(&selected_entries, *mode);
            let selected = selected_entries
                .iter()
                .zip(map_selection_bits)
                .enumerate()
                .map(
                    |(selected_index, (entry, map_selection_bits))| PreparedPlayer {
                        selected_index,
                        entry,
                        effective_rating: effective_rating(
                            &entry.player,
                            *mode,
                            mode_cfg.uncertainty_k,
                        ),
                        map_selection_bits,
                    },
                )
                .collect::<Vec<_>>();

            let mode_matches = selected
                .iter()
                // Get all the potential combinations of these players (we will decide teams later)
                .combinations(mode.total_players())
                // Calculate match quality
                .filter_map(|queue_entries| {
                    mode_stats.rosters_evaluated += 1;
                    // For positive-selection ("pick") modes, every player carries their map
                    // selections; reject any combination whose players share no map, since the
                    // match map couldn't be chosen and the match would fail. Veto/fixed modes store
                    // no selections, so this check is a no-op for them.
                    if !prepared_selections_share_a_map(&queue_entries) {
                        mode_stats.map_rejections += 1;
                        return None;
                    }

                    // Estimated one-way latency of this candidate's worst pairwise link, from each
                    // player's region and measured rtt. Computed here so the value can be reused for
                    // the quality score below.
                    let max_latency = prepared_match_latency(&queue_entries, &pair_latencies);

                    let mut oldest_queue_time = queue_entries[0].entry.queue_time;
                    let mut count = 0;
                    let mut mean = 0.0;
                    let mut m2 = 0.0;

                    for q in &queue_entries {
                        if q.entry.queue_time < oldest_queue_time {
                            oldest_queue_time = q.entry.queue_time;
                        }
                        // Calculate variance with Welford's algorithm over effective ratings
                        count += 1;
                        let r = q.effective_rating;
                        let delta = r - mean;
                        mean += delta / count as f32;
                        m2 += delta * (r - mean);
                    }
                    let variance = m2 / (count as f32 - 1.0);
                    let wait_time = now - oldest_queue_time;
                    let wait_seconds = wait_time.as_secs_f32();
                    let variance_penalty = mode_cfg.weight_rating_variance * variance;
                    let latency_penalty = mode_cfg.weight_latency * latency_value(max_latency);

                    // Win-probability imbalance is always nonnegative. If the candidate already
                    // misses the threshold before that penalty, no team partition can make it
                    // eligible.
                    if mode_cfg.weight_win_prob >= 0.0
                        && wait_seconds - (variance_penalty + latency_penalty) < effective_min
                    {
                        mode_stats.upper_bound_rejections += 1;
                        return None;
                    }

                    // A partition and its A/B complement have identical balance. The partition
                    // search fixes the first player on team A, preserving the exhaustive
                    // first-minimum orientation while evaluating each split once.
                    mode_stats.team_partitions_evaluated +=
                        unique_team_partition_count(mode.team_size());
                    let (team_a, team_b, rating_a, rating_b) = best_team_partition(&queue_entries);

                    // Calculate the win probability for team_a vs team_b
                    let win_prob = get_win_probability(rating_a, rating_b);
                    let win_prob_diff = (0.5 - win_prob).abs();

                    let quality = wait_seconds
                        - (variance_penalty
                            + mode_cfg.weight_win_prob * win_prob_diff
                            + latency_penalty);

                    // Filter any matches that are too low quality
                    if quality >= effective_min {
                        mode_stats.qualifying_candidates += 1;
                        Some(MatchCandidate {
                            mode: *mode,
                            team_a,
                            team_b,
                            quality,
                            skill_variance: variance,
                            win_probability: win_prob,
                            team_a_rating: rating_a,
                            team_b_rating: rating_b,
                            max_latency,
                        })
                    } else {
                        mode_stats.quality_rejections += 1;
                        None
                    }
                })
                // Sort by match quality (descending)
                .sorted_by(|a, b| b.quality.total_cmp(&a.quality));

            matches.extend(mode_matches);
            stats.push(mode_stats);
        }

        CandidateSearchResult {
            candidates: matches,
            stats,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::matchmaking::backbone::BackboneRttTable;
    use crate::matchmaking::config::ModeConfig;
    use std::collections::HashMap;
    use std::time::Duration;

    /// Built-in defaults (min_quality −30, today's weights). Used by tests that exercise the adaptive
    /// threshold itself.
    fn default_config() -> Arc<MatchmakerConfig> {
        Arc::new(MatchmakerConfig::default())
    }

    /// A config whose `min_quality` is so low it never blocks a match, so tests can exercise the
    /// matching/teaming/latency logic without the quality threshold getting in the way (the old
    /// behaviour of passing `f32::NEG_INFINITY` as the threshold).
    fn permissive_config() -> Arc<MatchmakerConfig> {
        Arc::new(MatchmakerConfig::from_global(ModeConfig {
            min_quality: f32::NEG_INFINITY,
            ..Default::default()
        }))
    }

    /// A config with a specific global `min_quality` and defaults otherwise.
    fn config_with_min_quality(min_quality: f32) -> Arc<MatchmakerConfig> {
        Arc::new(MatchmakerConfig::from_global(ModeConfig {
            min_quality,
            ..Default::default()
        }))
    }

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
            region: None,
            rtt_ms: None,
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
            region: None,
            rtt_ms: None,
        }
    }

    fn reference_team_rating(
        team: &[&QueueEntry],
        mode: MatchmakingType,
        uncertainty_k: f32,
    ) -> f32 {
        let sum = team
            .iter()
            .map(|entry| {
                let rating = effective_rating(&entry.player, mode, uncertainty_k);
                rating * rating
            })
            .sum::<f32>();
        (sum / team.len() as f32).sqrt()
    }

    fn reference_best_team_ids(
        entries: &[QueueEntry],
        mode: MatchmakingType,
        uncertainty_k: f32,
    ) -> (Vec<usize>, Vec<usize>) {
        entries
            .iter()
            .combinations(mode.team_size())
            .map(|team_a| {
                let team_b = entries
                    .iter()
                    .filter(|entry| {
                        !team_a
                            .iter()
                            .any(|selected| selected.player.id == entry.player.id)
                    })
                    .collect::<Vec<_>>();
                let difference = (reference_team_rating(&team_a, mode, uncertainty_k)
                    - reference_team_rating(&team_b, mode, uncertainty_k))
                .abs();
                (difference, team_a, team_b)
            })
            .min_by(|a, b| a.0.total_cmp(&b.0))
            .map(|(_, team_a, team_b)| {
                (
                    team_a.iter().map(|entry| entry.player.id).collect(),
                    team_b.iter().map(|entry| entry.player.id).collect(),
                )
            })
            .unwrap()
    }

    fn reference_selections_share_a_map(entries: &[&QueueEntry], mode: MatchmakingType) -> bool {
        let selections = entries
            .iter()
            .filter_map(|entry| entry.player.map_selections.get(&mode))
            .collect::<Vec<_>>();
        if selections.len() != entries.len() {
            return true;
        }

        let Some((first, rest)) = selections.split_first() else {
            return true;
        };
        first
            .iter()
            .any(|map| rest.iter().all(|other| other.contains(map)))
    }

    fn reference_match_latency(entries: &[&QueueEntry], backbone: &BackboneRttTable) -> f32 {
        let mut worst = 0.0_f32;
        for (i, a) in entries.iter().enumerate() {
            for b in &entries[i + 1..] {
                if let (Some(region_a), Some(rtt_a), Some(region_b), Some(rtt_b)) = (
                    a.player.region.as_deref(),
                    a.player.rtt_ms,
                    b.player.region.as_deref(),
                    b.player.rtt_ms,
                ) {
                    worst = worst
                        .max(rtt_a / 2.0 + backbone.rtt(region_a, region_b) / 2.0 + rtt_b / 2.0);
                }
            }
        }
        worst
    }

    fn match_snapshot(
        matchmaking_match: &Match,
    ) -> (MatchmakingType, Vec<usize>, Vec<usize>, [u32; 6]) {
        (
            matchmaking_match.mode,
            matchmaking_match
                .team_a
                .iter()
                .map(|entry| entry.player.id)
                .collect(),
            matchmaking_match
                .team_b
                .iter()
                .map(|entry| entry.player.id)
                .collect(),
            [
                matchmaking_match.quality.to_bits(),
                matchmaking_match.skill_variance.to_bits(),
                matchmaking_match.win_probability.to_bits(),
                matchmaking_match.team_a_rating.to_bits(),
                matchmaking_match.team_b_rating.to_bits(),
                matchmaking_match.max_latency.to_bits(),
            ],
        )
    }

    #[test]
    fn not_enough_players() {
        let mut matchmaker =
            Matchmaker::with_queue_selector(permissive_config(), TestQueueSelector);
        matchmaker
            .insert_player(make_player(0, 1000.0, MatchmakingType::Match1v1))
            .unwrap();

        let result =
            matchmaker.find_matches_for_modes(&[MatchmakingType::Match1v1], Instant::now());
        assert!(result.is_empty());
    }

    #[test]
    fn exact_number_of_players() {
        let mut matchmaker =
            Matchmaker::with_queue_selector(permissive_config(), TestQueueSelector);
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

        let result =
            matchmaker.find_matches_for_modes(&[MatchmakingType::Match1v1], Instant::now());
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
    fn unique_team_partitions_match_exhaustive_first_minimum() {
        let cases: &[(MatchmakingType, &[f32])] = &[
            (MatchmakingType::Match2v2, &[1000.0, 1000.0, 1000.0, 1000.0]),
            (MatchmakingType::Match2v2, &[500.0, 1000.0, 1500.0, 2000.0]),
            (MatchmakingType::Match2v2, &[1000.0, 1100.0, 1200.0, 3000.0]),
            (
                MatchmakingType::Match3v3Bgh,
                &[1000.0, 1000.0, 1000.0, 1000.0, 1000.0, 1000.0],
            ),
            (
                MatchmakingType::Match3v3Bgh,
                &[500.0, 800.0, 1100.0, 1400.0, 1700.0, 2000.0],
            ),
            (
                MatchmakingType::Match3v3Bgh,
                &[700.0, 1000.0, 1200.0, 1300.0, 1500.0, 2600.0],
            ),
        ];

        for &(mode, ratings) in cases {
            let mut matchmaker =
                Matchmaker::with_queue_selector(permissive_config(), TestQueueSelector);
            for (id, rating) in ratings.iter().copied().enumerate() {
                matchmaker
                    .insert_player(make_player(id, rating, mode))
                    .unwrap();
            }
            let expected = reference_best_team_ids(&matchmaker.queue, mode, 1.0);

            let matches = matchmaker.find_matches_for_modes(&[mode], Instant::now());
            let actual = (
                matches[0]
                    .team_a
                    .iter()
                    .map(|entry| entry.player.id)
                    .collect::<Vec<_>>(),
                matches[0]
                    .team_b
                    .iter()
                    .map(|entry| entry.player.id)
                    .collect::<Vec<_>>(),
            );

            assert_eq!(actual, expected, "team orientation changed for {mode:?}");
        }
    }

    #[test]
    fn prepared_map_and_latency_data_match_direct_roster_calculation() {
        let mode = MatchmakingType::Match3v3Fastest;
        let now = Instant::now();
        let region_data = [
            (Some("us-east"), Some(20.0)),
            (Some("eu-west"), Some(40.0)),
            (Some("ap-south"), Some(60.0)),
            (Some("us-east"), Some(80.0)),
            (Some("eu-west"), Some(100.0)),
            (Some("ap-south"), Some(120.0)),
            (Some("unconfigured"), Some(140.0)),
            (None, None),
        ];
        let entries = region_data
            .into_iter()
            .enumerate()
            .map(|(id, (region, rtt_ms))| {
                let map_selections = if id == 7 {
                    HashMap::new()
                } else {
                    let mut maps = (0..10)
                        .map(|map| format!("unique-{id}-{map}"))
                        .collect::<Vec<_>>();
                    if id < 6 {
                        maps.push("shared-first-six".to_string());
                    }
                    HashMap::from([(mode, maps)])
                };
                QueueEntry {
                    queue_time: now,
                    player: Player {
                        id,
                        ratings: HashMap::from([(
                            mode,
                            PlayerModeRating {
                                rating: 1000.0 + id as f32 * 75.0,
                                uncertainty: None,
                            },
                        )]),
                        map_selections,
                        region: region.map(str::to_string),
                        rtt_ms,
                    },
                    modes: mode.into(),
                }
            })
            .collect::<Vec<_>>();
        let selected_entries = entries.iter().collect::<Vec<_>>();
        let backbone = BackboneRttTable::new([
            ("eu-west|us-east".to_string(), 90.0),
            ("ap-south|us-east".to_string(), 160.0),
            ("ap-south|eu-west".to_string(), 110.0),
        ]);
        let pair_latencies = PairLatencies::new(&selected_entries, &backbone);
        let map_selection_bits = prepare_map_selection_bits(&selected_entries, mode);
        let prepared = selected_entries
            .iter()
            .zip(map_selection_bits)
            .enumerate()
            .map(
                |(selected_index, (entry, map_selection_bits))| PreparedPlayer {
                    selected_index,
                    entry,
                    effective_rating: effective_rating(&entry.player, mode, 1.0),
                    map_selection_bits,
                },
            )
            .collect::<Vec<_>>();

        assert!(
            prepared
                .iter()
                .filter_map(|entry| entry.map_selection_bits.as_ref())
                .any(|bits| bits.len() > 1),
            "the fixture must span multiple bitset words"
        );

        let mut shared_map_rosters = 0;
        let mut disjoint_map_rosters = 0;
        for roster in prepared.iter().combinations(mode.total_players()) {
            let direct_entries = roster.iter().map(|entry| entry.entry).collect::<Vec<_>>();
            let prepared_share_map = prepared_selections_share_a_map(&roster);
            assert_eq!(
                prepared_share_map,
                reference_selections_share_a_map(&direct_entries, mode)
            );
            assert_eq!(
                prepared_match_latency(&roster, &pair_latencies),
                reference_match_latency(&direct_entries, &backbone)
            );

            if prepared_share_map {
                shared_map_rosters += 1;
            } else {
                disjoint_map_rosters += 1;
            }
        }
        assert!(shared_map_rosters > 0);
        assert!(disjoint_map_rosters > 0);
    }

    #[test]
    fn finds_all_modes_in_order() {
        let mut matchmaker =
            Matchmaker::with_queue_selector(permissive_config(), TestQueueSelector);
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
    fn tick_claims_matches_and_removes_players_atomically() {
        let config = permissive_config();
        let mut matchmaker = Matchmaker::with_queue_selector(config.clone(), TestQueueSelector);
        let modes = MatchmakingType::Match1v1Fastest | MatchmakingType::Match1v1;
        for id in 0..3 {
            matchmaker
                .insert_player(make_multi_player(id, 1000.0, modes))
                .unwrap();
        }

        let result = matchmaker.run_tick_for_modes(
            &[MatchmakingType::Match1v1Fastest, MatchmakingType::Match1v1],
            Instant::now(),
            config,
            Arc::new(BackboneRttTable::default()),
        );

        assert_eq!(result.matches.len(), 1);
        assert_eq!(result.matches[0].mode, MatchmakingType::Match1v1Fastest);
        let matched_ids = result.matches[0]
            .team_a
            .iter()
            .chain(result.matches[0].team_b.iter())
            .map(|entry| entry.player.id)
            .collect::<Vec<_>>();
        assert_eq!(matched_ids, vec![0, 1]);
        assert_eq!(
            result
                .queue_before_matching
                .iter()
                .find(|state| state.mode == MatchmakingType::Match1v1)
                .unwrap()
                .queue_size,
            3
        );
        let fastest_stats = &result.search_stats[0];
        assert_eq!(fastest_stats.mode, MatchmakingType::Match1v1Fastest);
        assert_eq!(fastest_stats.rosters_evaluated, 3);
        assert_eq!(fastest_stats.team_partitions_evaluated, 3);
        assert_eq!(fastest_stats.qualifying_candidates, 3);
        assert_eq!(fastest_stats.conflict_rejections, 2);
        assert_eq!(fastest_stats.matches_formed, 1);
        assert_eq!(
            matchmaker
                .queue
                .iter()
                .map(|entry| entry.player.id)
                .collect::<Vec<_>>(),
            vec![2]
        );
        assert_eq!(matchmaker.queue_size(MatchmakingType::Match1v1), 1);
        assert_eq!(matchmaker.queue_size(MatchmakingType::Match1v1Fastest), 1);
    }

    #[test]
    fn tick_claiming_matches_reference_greedy_deduplication() {
        let config = permissive_config();
        let mut matchmaker = Matchmaker::with_queue_selector(config.clone(), TestQueueSelector);
        let queued_modes = MatchmakingType::Match1v1Fastest | MatchmakingType::Match1v1;
        for (id, rating) in [1000.0, 1010.0, 1500.0, 1510.0].into_iter().enumerate() {
            matchmaker
                .insert_player(make_multi_player(id, rating, queued_modes))
                .unwrap();
        }

        let modes = [MatchmakingType::Match1v1Fastest, MatchmakingType::Match1v1];
        let now = Instant::now();
        let proposals = matchmaker.find_matches_for_modes(&modes, now);
        let mut reference_claimed = HashSet::new();
        let expected = proposals
            .iter()
            .filter_map(|matchmaking_match| {
                let player_ids = matchmaking_match
                    .team_a
                    .iter()
                    .chain(&matchmaking_match.team_b)
                    .map(|entry| entry.player.id)
                    .collect::<Vec<_>>();
                if player_ids.iter().any(|id| reference_claimed.contains(id)) {
                    None
                } else {
                    reference_claimed.extend(player_ids);
                    Some(match_snapshot(matchmaking_match))
                }
            })
            .collect::<Vec<_>>();

        let result = matchmaker.run_tick_for_modes(
            &modes,
            now,
            config,
            Arc::new(BackboneRttTable::default()),
        );
        let actual = result
            .matches
            .iter()
            .map(match_snapshot)
            .collect::<Vec<_>>();

        assert_eq!(
            expected
                .iter()
                .map(|(mode, team_a, team_b, _)| (*mode, team_a.clone(), team_b.clone()))
                .collect::<Vec<_>>(),
            vec![
                (MatchmakingType::Match1v1Fastest, vec![0], vec![1]),
                (MatchmakingType::Match1v1Fastest, vec![2], vec![3]),
            ]
        );
        assert_eq!(actual, expected);
        assert!(matchmaker.queue.is_empty());
        assert_eq!(matchmaker.queue_size(MatchmakingType::Match1v1), 0);
        assert_eq!(matchmaker.queue_size(MatchmakingType::Match1v1Fastest), 0);
    }

    #[test]
    fn requeue() {
        let start = Instant::now();
        let mut matchmaker =
            Matchmaker::with_queue_selector(permissive_config(), TestQueueSelector);
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

        let result =
            matchmaker.find_matches_for_modes(&[MatchmakingType::Match1v1], Instant::now());
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
        let mut matchmaker =
            Matchmaker::with_queue_selector(permissive_config(), TestQueueSelector);
        let result = matchmaker.insert_player(make_player(0, 1000.0, MatchmakingType::Match1v1));
        assert!(result.is_ok());
        assert_eq!(
            matchmaker.queue_sizes.get(&MatchmakingType::Match1v1),
            Some(&1)
        );
    }

    #[test]
    fn insert_player_duplicate_fails() {
        let mut matchmaker =
            Matchmaker::with_queue_selector(permissive_config(), TestQueueSelector);
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
        let mut matchmaker =
            Matchmaker::with_queue_selector(permissive_config(), TestQueueSelector);
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
        let matchmaker = Matchmaker::with_queue_selector(permissive_config(), TestQueueSelector);
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

    /// Builds a player rated for `mode` who chose `region` and measured `rtt_ms` round-trip to it.
    fn make_player_with_region(
        id: usize,
        mode: MatchmakingType,
        region: &str,
        rtt_ms: f32,
    ) -> Player {
        Player {
            region: Some(region.to_string()),
            rtt_ms: Some(rtt_ms),
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
    fn latency_same_region_is_rtt_halves_only() {
        let mut matchmaker =
            Matchmaker::with_queue_selector(permissive_config(), TestQueueSelector);
        // Both players home in the same region, so backbone(region, region) == 0 and the one-way
        // estimate is rtt_a/2 + 0 + rtt_b/2 = 15 + 25 = 40ms.
        matchmaker
            .insert_player(make_player_with_region(
                0,
                MatchmakingType::Match1v1,
                "us-east",
                30.0,
            ))
            .unwrap();
        matchmaker
            .insert_player(make_player_with_region(
                1,
                MatchmakingType::Match1v1,
                "us-east",
                50.0,
            ))
            .unwrap();

        let result =
            matchmaker.find_matches_for_modes(&[MatchmakingType::Match1v1], Instant::now());
        assert_eq!(result.len(), 1);
        assert_eq!(result[0].max_latency, 40.0);
    }

    #[test]
    fn latency_cross_region_uses_backbone_table_entry() {
        let mut matchmaker =
            Matchmaker::with_queue_selector(permissive_config(), TestQueueSelector);
        matchmaker.set_backbone(BackboneRttTable::new([(
            "us-east|eu-west".to_string(),
            90.0,
        )]));
        // Cross-region estimate: rtt_a/2 + backbone/2 + rtt_b/2 = 10 + 45 + 20 = 75ms.
        matchmaker
            .insert_player(make_player_with_region(
                0,
                MatchmakingType::Match1v1,
                "us-east",
                20.0,
            ))
            .unwrap();
        matchmaker
            .insert_player(make_player_with_region(
                1,
                MatchmakingType::Match1v1,
                "eu-west",
                40.0,
            ))
            .unwrap();

        let result =
            matchmaker.find_matches_for_modes(&[MatchmakingType::Match1v1], Instant::now());
        assert_eq!(result.len(), 1);
        assert_eq!(result[0].max_latency, 75.0);
    }

    #[test]
    fn latency_cross_region_missing_pair_uses_default_backbone() {
        let mut matchmaker =
            Matchmaker::with_queue_selector(permissive_config(), TestQueueSelector);
        // No backbone entry for this pair, so the conservative default (150ms RTT) is used:
        // rtt_a/2 + 150/2 + rtt_b/2 = 10 + 75 + 20 = 105ms.
        matchmaker
            .insert_player(make_player_with_region(
                0,
                MatchmakingType::Match1v1,
                "us-east",
                20.0,
            ))
            .unwrap();
        matchmaker
            .insert_player(make_player_with_region(
                1,
                MatchmakingType::Match1v1,
                "ap-south",
                40.0,
            ))
            .unwrap();

        let result =
            matchmaker.find_matches_for_modes(&[MatchmakingType::Match1v1], Instant::now());
        assert_eq!(result.len(), 1);
        assert_eq!(result[0].max_latency, 105.0);
    }

    #[test]
    fn latency_regionless_players_carry_no_penalty() {
        let mut matchmaker =
            Matchmaker::with_queue_selector(permissive_config(), TestQueueSelector);
        // Both players are region-less (dev loopback / no coordinator-configured regions). Latency is
        // unknown, so no penalty is applied and the estimate is 0 — matching the region-blind
        // fallback.
        matchmaker
            .insert_player(make_player(0, 1000.0, MatchmakingType::Match1v1))
            .unwrap();
        matchmaker
            .insert_player(make_player(1, 1000.0, MatchmakingType::Match1v1))
            .unwrap();

        let result =
            matchmaker.find_matches_for_modes(&[MatchmakingType::Match1v1], Instant::now());
        assert_eq!(result.len(), 1);
        assert_eq!(result[0].max_latency, 0.0);
    }

    #[test]
    fn latency_one_regionless_player_skips_the_pair() {
        let mut matchmaker =
            Matchmaker::with_queue_selector(permissive_config(), TestQueueSelector);
        matchmaker.set_backbone(BackboneRttTable::new([(
            "us-east|eu-west".to_string(),
            90.0,
        )]));
        // Player 0 has a region and rtt, player 1 has neither. The pair has no shared latency signal,
        // so it's skipped and contributes nothing (estimate 0), rather than assuming a distance.
        matchmaker
            .insert_player(make_player_with_region(
                0,
                MatchmakingType::Match1v1,
                "us-east",
                20.0,
            ))
            .unwrap();
        matchmaker
            .insert_player(make_player(1, 1000.0, MatchmakingType::Match1v1))
            .unwrap();

        let result =
            matchmaker.find_matches_for_modes(&[MatchmakingType::Match1v1], Instant::now());
        assert_eq!(result.len(), 1);
        assert_eq!(result[0].max_latency, 0.0);
    }

    #[test]
    fn find_matches_with_latency_penalty() {
        let mut matchmaker =
            Matchmaker::with_queue_selector(config_with_min_quality(-85.0), TestQueueSelector);
        matchmaker.set_backbone(BackboneRttTable::new([(
            "eu-west|us-east".to_string(),
            200.0,
        )]));
        // Cross-region pair: rtt_a/2 + backbone/2 + rtt_b/2 = 50 + 100 + 50 = 200ms one-way.
        matchmaker
            .insert_player(make_player_with_region(
                0,
                MatchmakingType::Match1v1,
                "us-east",
                100.0,
            ))
            .unwrap();
        matchmaker
            .insert_player(make_player_with_region(
                1,
                MatchmakingType::Match1v1,
                "eu-west",
                100.0,
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
            matchmaker.find_matches_for_modes(&[MatchmakingType::Match1v1], Instant::now());
        assert!(
            result_strict.is_empty(),
            "expected no match when min_quality (-85.0) exceeds quality (-90.0) at 200ms latency"
        );

        // min_quality = -95.0 → quality (-90.0) >= effective_min (-95.0) → match forms.
        matchmaker.set_config(config_with_min_quality(-95.0));
        let result_lenient =
            matchmaker.find_matches_for_modes(&[MatchmakingType::Match1v1], Instant::now());
        assert_eq!(result_lenient.len(), 1);
        assert_eq!(result_lenient[0].max_latency, 200.0);
    }

    #[test]
    fn latency_team_mode_uses_worst_pair_across_all_pairs() {
        let mut matchmaker =
            Matchmaker::with_queue_selector(permissive_config(), TestQueueSelector);
        // A 2v2 has six pairwise links. Three players home in "us-east" at 20ms; player 2 homes in
        // "us-east" too but at 200ms. Same region, so every pair's backbone term is 0. The worst link
        // is any pair involving player 2: 20/2 + 0 + 200/2 = 110ms. Latency is independent of how the
        // matcher splits the teams — it's the worst pair overall.
        matchmaker
            .insert_player(make_player_with_region(
                0,
                MatchmakingType::Match2v2,
                "us-east",
                20.0,
            ))
            .unwrap();
        matchmaker
            .insert_player(make_player_with_region(
                1,
                MatchmakingType::Match2v2,
                "us-east",
                20.0,
            ))
            .unwrap();
        matchmaker
            .insert_player(make_player_with_region(
                2,
                MatchmakingType::Match2v2,
                "us-east",
                200.0,
            ))
            .unwrap();
        matchmaker
            .insert_player(make_player_with_region(
                3,
                MatchmakingType::Match2v2,
                "us-east",
                20.0,
            ))
            .unwrap();

        let result =
            matchmaker.find_matches_for_modes(&[MatchmakingType::Match2v2], Instant::now());
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
            region: None,
            rtt_ms: None,
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
            region: None,
            rtt_ms: None,
        };

        let mut mm = Matchmaker::with_queue_selector(permissive_config(), TestQueueSelector);
        mm.insert_player(uncertain).unwrap();
        mm.insert_player(certain).unwrap();

        let result = mm.find_matches_for_modes(&[MatchmakingType::Match1v1], Instant::now());
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
        let mut matchmaker =
            Matchmaker::with_queue_selector(permissive_config(), TestQueueSelector);
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
            region: None,
            rtt_ms: None,
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
            region: None,
            rtt_ms: None,
        };
        matchmaker.insert_player(player_a).unwrap();
        matchmaker.insert_player(player_b).unwrap();

        // Both modes match. With equal ratings in each mode, quality penalty is near zero.
        let result = matchmaker.find_matches_for_modes(
            &[MatchmakingType::Match1v1, MatchmakingType::Match1v1Fastest],
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
            region: None,
            rtt_ms: None,
        }
    }

    #[test]
    fn pick_mode_does_not_match_disjoint_map_selections() {
        let mut matchmaker =
            Matchmaker::with_queue_selector(permissive_config(), TestQueueSelector);
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
        let result =
            matchmaker.find_matches_for_modes(&[MatchmakingType::Match1v1], Instant::now());
        assert!(result.is_empty());
    }

    #[test]
    fn pick_mode_matches_when_selections_share_a_map() {
        let mut matchmaker =
            Matchmaker::with_queue_selector(permissive_config(), TestQueueSelector);
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

        let result =
            matchmaker.find_matches_for_modes(&[MatchmakingType::Match1v1], Instant::now());
        assert_eq!(result.len(), 1);
    }

    #[test]
    fn effective_min_relaxes_only_when_smoothed_population_low() {
        let mut mm = Matchmaker::with_queue_selector(default_config(), TestQueueSelector);
        let mode = MatchmakingType::Match1v1; // total_players 2 → comfortable 4

        // No population history yet: treated as 0 → maximally relaxed.
        assert_eq!(mm.effective_min_quality(mode), -30.0 - 15.0 * 4.0);

        // Comfortably populated → no relaxation.
        mm.population_estimate.insert(mode, 10.0);
        assert_eq!(mm.effective_min_quality(mode), -30.0);

        // Exactly at the comfortable line → no relaxation.
        mm.population_estimate.insert(mode, 4.0);
        assert_eq!(mm.effective_min_quality(mode), -30.0);

        // Persistently low population → partial relaxation (1 player short of comfortable).
        mm.population_estimate.insert(mode, 3.0);
        assert_eq!(mm.effective_min_quality(mode), -30.0 - 15.0 * 1.0);
    }

    #[test]
    fn population_falls_back_to_window_peak_before_first_fold() {
        let mut mm = Matchmaker::with_queue_selector(default_config(), TestQueueSelector);
        let mode = MatchmakingType::Match1v1; // comfortable 4

        // A healthy queue forms right after a (re)start, before any window has folded — the smoothed
        // estimate is still absent. The threshold must not relax: a full queue is not low population.
        for i in 0..6 {
            mm.insert_player(make_player(i, 1500.0, mode)).unwrap();
        }
        assert!(!mm.population_estimate.contains_key(&mode));
        assert_eq!(mm.effective_min_quality(mode), -30.0);

        // Draining the queue during the warmup window must not relax it either — the peak holds.
        for i in 0..4 {
            mm.remove_player(i);
        }
        assert_eq!(mm.queue_sizes.get(&mode), Some(&2));
        assert_eq!(mm.effective_min_quality(mode), -30.0);
    }

    #[test]
    fn population_estimate_uses_window_peak_not_instantaneous() {
        let mut mm = Matchmaker::with_queue_selector(default_config(), TestQueueSelector);
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
        assert_eq!(mm.effective_min_quality(mode), -30.0);
    }

    #[test]
    fn population_estimate_decays_across_idle_windows() {
        let mut mm = Matchmaker::with_queue_selector(permissive_config(), TestQueueSelector);
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
        // factor (1 - alpha) each, where alpha is derived from the mode's population half-life.
        let retention = 1.0
            - ewma_alpha(
                ModeConfig::default().population_half_life,
                POPULATION_WINDOW,
            );
        mm.update_population_estimates(start + 3 * POPULATION_WINDOW);
        assert!((mm.population_estimate[&mode] - 4.0 * retention).abs() < 1e-4);
        mm.update_population_estimates(start + 4 * POPULATION_WINDOW);
        assert!((mm.population_estimate[&mode] - 4.0 * retention * retention).abs() < 1e-4);
    }

    #[test]
    fn population_half_life_matches_decay() {
        // One half-life of idle windows should decay the estimate to half. Guards against the
        // half-life and POPULATION_WINDOW drifting out of the alpha derivation.
        let mut mm = Matchmaker::with_queue_selector(permissive_config(), TestQueueSelector);
        let mode = MatchmakingType::Match1v1;
        let half_life = ModeConfig::default().population_half_life;
        let start = mm.start();

        mm.population_estimate.insert(mode, 8.0);
        // Park the window start so exactly the windows we fold below have elapsed.
        let windows = (half_life.as_secs() / POPULATION_WINDOW.as_secs()) as u32;
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
