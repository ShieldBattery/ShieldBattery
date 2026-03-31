use std::{
    collections::HashMap,
    time::Instant,
};

use enumset::EnumSet;
use itertools::Itertools;
use rand::{seq::SliceRandom, Rng};
use strum::IntoEnumIterator;

use crate::matchmaking::MatchmakingType;

/*
The match quality score values are all normalized into the wait time scale (for a wait time of 1 second),
then added together. i.e.: Value = WaitTime + W1 * SkillVariance + W2 * Latency
    - W1 = "How many seconds I would wait for an improvement of 1 in skill variance"
    - W2 = "How many seconds I would wait for an improvement of 1 in latency"

- Need to find some way to calculate a "minimum match quality" value, this likely changes based on
  the player population at the time (ideally using historical data of some kind)
    - The Menke utility function seems to be negative? (but less negative = better)

- Talk about some of this stuff: https://www.youtube.com/watch?v=Q8BX0nXfPjY
- In their system, the match score minimum is *per player* because it depends on their skill rating
  + region
*/

const WEIGHT_RATING_VARIANCE: f32 = 0.005;
const WEIGHT_WIN_PROB: f32 = 50.0;
const WEIGHT_LATENCY: f32 = 5.0;

/// How many σ below their mean rating a player's effective rating is.
/// Controls how strongly uncertainty drags down effective rating.
/// k=1.0 → 68% confidence lower bound. k=2.0 → 95% lower bound.
const UNCERTAINTY_K: f32 = 1.0;

/// Queue size at or above which the full MIN_QUALITY threshold applies.
/// Below this, the threshold decays by ADAPTIVE_DECAY_PER_MISSING per missing player.
/// This multiplier is applied to mode.total_players() so it scales with mode size.
const ADAPTIVE_COMFORTABLE_MULTIPLIER: usize = 2;

/// Seconds the quality threshold drops per player below the comfortable queue size.
const ADAPTIVE_DECAY_PER_MISSING: f32 = 15.0;

#[derive(Debug, Copy, Clone, PartialEq)]
pub struct Player {
    pub id: usize,
    pub rating: f32,
    /// Glicko-2 σ (uncertainty). None treated as 0 (fully certain).
    pub uncertainty: Option<f32>,
    /// Latency tier (0 = great, 1 = fine, 2 = noticeable, 3 = bad). None treated as 0.
    pub latency_bucket: Option<u8>,
}

/// Returns the conservative skill estimate: the player's rating minus k standard deviations.
/// A player with high uncertainty will have a lower effective rating, meaning they can match
/// against a wider range of opponents without the quality formula penalizing the match.
fn effective_rating(player: &Player) -> f32 {
    player.rating - UNCERTAINTY_K * player.uncertainty.unwrap_or(0.0)
}

#[derive(Debug, Copy, Clone, PartialEq)]
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
}

pub trait QueueSelector {
    /// Selects `amount` players from `queue``.
    fn select<'a>(
        &self,
        queue: impl IntoIterator<Item = &'a QueueEntry>,
        amount: usize,
    ) -> Vec<&'a QueueEntry>;
}

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
                // Generate a value in the range 0..current index
                // If it fits in the selected queue, replace that player with this one.
                // This biases towards the front of the queue (players just after `amount` in the
                // queue have a higher chance of being selected than those well after it)
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
fn get_team_rating(team: &[&QueueEntry]) -> f32 {
    if team.len() == 1 {
        effective_rating(&team[0].player)
    } else {
        let sum: f32 = team.iter().map(|q| { let r = effective_rating(&q.player); r * r }).sum();
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

impl<T: QueueSelector> Matchmaker<T> {
    fn with_queue_selector(max_players_examined: usize, queue_selector: T) -> Matchmaker<T> {
        Self {
            start: Instant::now(),
            max_players_examined,
            queue: Vec::new(),
            queue_sizes: HashMap::new(),
            queue_selector,
        }
    }

    /// Returns the instant at which this matchmaker was created. Queue times in serialized tickets
    /// are stored as milliseconds relative to this instant so that `Instant` values (which are
    /// monotonic but not serializable) can survive a round-trip through the ticket format.
    pub fn start(&self) -> Instant {
        self.start
    }

    pub fn insert_player(
        &mut self,
        player: Player,
        modes: EnumSet<MatchmakingType>,
    ) -> Result<&mut Self, MatchmakerError> {
        let entry = self.create_entry_and_update_modes(player, modes, Instant::now())?;
        self.queue.push(entry);
        Ok(self)
    }

    /// Re-inserts a player in the queue who had been queued previously, keeping their queue_time
    /// as before. This is meant to be used when players need to return to the queue after the match
    /// they were placed in failed to start.
    pub fn requeue_player(
        &mut self,
        player: Player,
        modes: EnumSet<MatchmakingType>,
        queue_time: Instant,
    ) -> Result<&mut Self, MatchmakerError> {
        let entry = self.create_entry_and_update_modes(player, modes, queue_time)?;

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
        modes: EnumSet<MatchmakingType>,
        queue_time: Instant,
    ) -> Result<QueueEntry, MatchmakerError> {
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
            self.queue_sizes
                .entry(mode)
                .and_modify(|n| *n += 1)
                .or_insert(1);
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

            let comfortable_size = mode.total_players() * ADAPTIVE_COMFORTABLE_MULTIPLIER;
            let queue_size = self.queue_sizes.get(mode).copied().unwrap_or(0);
            let effective_min = if queue_size < comfortable_size {
                min_quality
                    - ADAPTIVE_DECAY_PER_MISSING * (comfortable_size - queue_size) as f32
            } else {
                min_quality
            };

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
                        let r = effective_rating(&q.player);
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

                                let rating_a = get_team_rating(&team_a);
                                let rating_b = get_team_rating(&team_b);

                                ((rating_a - rating_b).abs(), team_a, team_b)
                            })
                            .min_by(|a, b| a.0.partial_cmp(&b.0).unwrap())
                            .map(|(_, a, b)| (a, b))
                            .unwrap()
                    };

                    // Calculate the win probability for team_a vs team_b
                    let rating_a = get_team_rating(&team_a);
                    let rating_b = get_team_rating(&team_b);
                    let win_prob = get_win_probability(rating_a, rating_b);
                    let win_prob_diff = (0.5 - win_prob).abs();

                    let max_latency = queue_entries
                        .iter()
                        .map(|q| q.player.latency_bucket.unwrap_or(0) as f32)
                        .fold(0.0f32, f32::max);
                    let quality = wait_time.as_secs_f32()
                        - (WEIGHT_RATING_VARIANCE * variance
                            + WEIGHT_WIN_PROB * win_prob_diff
                            + WEIGHT_LATENCY * max_latency);

                    // Filter any matches that are too low quality
                    if quality >= effective_min {
                        Some(Match {
                            mode: *mode,
                            team_a: team_a.into_iter().copied().collect(),
                            team_b: team_b.into_iter().copied().collect(),
                            quality,
                        })
                    } else {
                        None
                    }
                })
                // Sort by match quality (descending)
                .sorted_by(|a, b| b.quality.partial_cmp(&a.quality).unwrap());

            matches.extend(mode_matches);
        }

        matches
    }
}

#[cfg(test)]
mod tests {
    use super::*;
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

    #[test]
    fn not_enough_players() {
        let mut matchmaker = Matchmaker::with_queue_selector(16, TestQueueSelector);
        let player = Player {
            id: 0,
            rating: 1000.0,
            uncertainty: None,
            latency_bucket: None,
        };
        matchmaker.insert_player(player, MatchmakingType::Match1v1.into()).unwrap();

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
        let player = Player {
            id: 0,
            rating: 1000.0,
            uncertainty: None,
            latency_bucket: None,
        };
        matchmaker.insert_player(player, MatchmakingType::Match1v1.into()).unwrap();
        let player = Player {
            id: 1,
            rating: 1200.0,
            uncertainty: None,
            latency_bucket: None,
        };
        matchmaker.insert_player(player, MatchmakingType::Match1v1.into()).unwrap();

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
        let player = Player {
            id: 0,
            rating: 1000.0,
            uncertainty: None,
            latency_bucket: None,
        };
        matchmaker
            .insert_player(
                player,
                MatchmakingType::Match1v1 | MatchmakingType::Match1v1Fastest,
            )
            .unwrap();
        let player = Player {
            id: 1,
            rating: 1200.0,
            uncertainty: None,
            latency_bucket: None,
        };
        matchmaker
            .insert_player(
                player,
                MatchmakingType::Match1v1Fastest | MatchmakingType::Match1v1,
            )
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
        let player = Player {
            id: 0,
            rating: 1000.0,
            uncertainty: None,
            latency_bucket: None,
        };
        matchmaker.insert_player(player, MatchmakingType::Match1v1.into()).unwrap();
        let player = Player {
            id: 1,
            rating: 1200.0,
            uncertainty: None,
            latency_bucket: None,
        };
        matchmaker
            .requeue_player(player, MatchmakingType::Match1v1.into(), start)
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
        let result = matchmaker.insert_player(
            Player { id: 0, rating: 1000.0, uncertainty: None, latency_bucket: None },
            MatchmakingType::Match1v1.into(),
        );
        assert!(result.is_ok());
        assert_eq!(matchmaker.queue_sizes.get(&MatchmakingType::Match1v1), Some(&1));
    }

    #[test]
    fn insert_player_duplicate_fails() {
        let mut matchmaker = Matchmaker::with_queue_selector(16, TestQueueSelector);
        matchmaker
            .insert_player(
                Player { id: 0, rating: 1000.0, uncertainty: None, latency_bucket: None },
                MatchmakingType::Match1v1.into(),
            )
            .unwrap();
        let result = matchmaker.insert_player(
            Player { id: 0, rating: 1000.0, uncertainty: None, latency_bucket: None },
            MatchmakingType::Match1v1.into(),
        );
        assert!(matches!(result, Err(MatchmakerError::AlreadyInQueue(0))));
        // Queue size must not have been double-incremented
        assert_eq!(matchmaker.queue_sizes.get(&MatchmakingType::Match1v1), Some(&1));
    }

    #[test]
    fn requeue_duplicate_fails() {
        let mut matchmaker = Matchmaker::with_queue_selector(16, TestQueueSelector);
        matchmaker
            .insert_player(
                Player { id: 0, rating: 1000.0, uncertainty: None, latency_bucket: None },
                MatchmakingType::Match1v1.into(),
            )
            .unwrap();
        let result = matchmaker.requeue_player(
            Player { id: 0, rating: 1000.0, uncertainty: None, latency_bucket: None },
            MatchmakingType::Match1v1.into(),
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
                player: Player { id: i, rating: 1000.0, uncertainty: None, latency_bucket: None },
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

    #[test]
    fn find_matches_with_latency_penalty() {
        let mut matchmaker = Matchmaker::with_queue_selector(16, TestQueueSelector);
        matchmaker
            .insert_player(
                Player { id: 0, rating: 1000.0, uncertainty: None, latency_bucket: Some(2) },
                MatchmakingType::Match1v1.into(),
            )
            .unwrap();
        matchmaker
            .insert_player(
                Player { id: 1, rating: 1000.0, uncertainty: None, latency_bucket: Some(2) },
                MatchmakingType::Match1v1.into(),
            )
            .unwrap();

        // At t=0 with no wait time: quality = 0 - (variance_penalty + win_prob_penalty + latency_penalty)
        // With equal ratings: variance ≈ 0, win_prob_diff ≈ 0.
        // max_latency_bucket = 2. WEIGHT_LATENCY = 5.0. Latency penalty = 5.0 * 2 = 10.0.
        // Quality ≈ 0 - 10.0 = -10.0.
        //
        // The adaptive threshold: with 2 players in queue and comfortable_size=4 (2 * 2),
        // effective_min = min_quality - ADAPTIVE_DECAY_PER_MISSING * 2
        //               = min_quality - 15.0 * 2 = min_quality - 30.0.
        //
        // To ensure effective_min > -10.0, we need min_quality > 20.0. Use 25.0:
        // effective_min = 25.0 - 30.0 = -5.0 > -10.0 → match rejected.
        let result_strict = matchmaker.find_matches_for_modes(
            &[MatchmakingType::Match1v1],
            25.0,
            Instant::now(),
        );
        assert!(
            result_strict.is_empty(),
            "expected no match when effective_min (-5.0) exceeds quality (-10.0) with latency bucket 2"
        );

        // With min_quality = -15.0: effective_min = -15.0 - 30.0 = -45.0 < -10.0 → match forms.
        let result_lenient = matchmaker.find_matches_for_modes(
            &[MatchmakingType::Match1v1],
            -15.0,
            Instant::now(),
        );
        assert_eq!(result_lenient.len(), 1);
    }

    #[test]
    fn find_matches_no_latency_bucket_treated_as_zero() {
        let mut matchmaker = Matchmaker::with_queue_selector(16, TestQueueSelector);
        matchmaker
            .insert_player(
                Player { id: 0, rating: 1000.0, uncertainty: None, latency_bucket: None },
                MatchmakingType::Match1v1.into(),
            )
            .unwrap();
        matchmaker
            .insert_player(
                Player { id: 1, rating: 1000.0, uncertainty: None, latency_bucket: None },
                MatchmakingType::Match1v1.into(),
            )
            .unwrap();

        // Both players have no latency data — treated as bucket 0, penalty = 0.
        // With equal ratings: variance ≈ 0, win_prob_diff ≈ 0.
        // Quality ≈ 0. Should appear at min_quality = f32::NEG_INFINITY.
        let result = matchmaker.find_matches_for_modes(
            &[MatchmakingType::Match1v1],
            f32::NEG_INFINITY,
            Instant::now(),
        );
        assert_eq!(result.len(), 1);
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
            rating: 1500.0,
            uncertainty: Some(350.0),
            latency_bucket: None,
        };
        let certain = Player {
            id: 1,
            rating: 1500.0,
            uncertainty: None,
            latency_bucket: None,
        };

        let mut mm = Matchmaker::with_queue_selector(16, TestQueueSelector);
        mm.insert_player(uncertain, MatchmakingType::Match1v1.into()).unwrap();
        mm.insert_player(certain, MatchmakingType::Match1v1.into()).unwrap();

        let result =
            mm.find_matches_for_modes(&[MatchmakingType::Match1v1], f32::NEG_INFINITY, Instant::now());
        assert_eq!(result.len(), 1);
        // Quality is significantly negative at t=0 due to variance penalty from σ=350
        assert!(
            result[0].quality < 0.0,
            "uncertain player should cause negative quality at t=0: got {}",
            result[0].quality
        );
    }
}
