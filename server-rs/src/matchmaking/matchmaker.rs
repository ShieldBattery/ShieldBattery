use std::{collections::HashMap, time::Instant};

use enumset::{EnumSet, EnumSetType};
use itertools::Itertools;
use rand::{seq::SliceRandom, Rng};
use strum::IntoEnumIterator;
use strum_macros::EnumIter;

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
const WEIGHT_RATING_VARIANCE: f32 = 0.05;
const WEIGHT_WIN_PROB: f32 = 0.05;

// FIXME: Move elsewhere + export TS types
#[derive(Debug, Hash, EnumIter, EnumSetType)]
pub enum MatchmakingMode {
    Mode1v1,
    Mode1v1Fastest,
    Mode2v2,
    Mode2v2Bgh,
    Mode2v2Fastest,
    Mode2v2Hunters,
    Mode3v3Bgh,
    Mode3v3Fastest,
    Mode3v3Hunters,
}

impl MatchmakingMode {
    pub fn team_size(&self) -> usize {
        match self {
            MatchmakingMode::Mode1v1 => 1,
            MatchmakingMode::Mode1v1Fastest => 1,
            MatchmakingMode::Mode2v2 => 2,
            MatchmakingMode::Mode2v2Bgh => 2,
            MatchmakingMode::Mode2v2Fastest => 2,
            MatchmakingMode::Mode2v2Hunters => 2,
            MatchmakingMode::Mode3v3Bgh => 3,
            MatchmakingMode::Mode3v3Fastest => 3,
            MatchmakingMode::Mode3v3Hunters => 3,
        }
    }

    pub fn total_players(&self) -> usize {
        self.team_size() * 2
    }
}

#[derive(Debug, Copy, Clone, PartialEq)]
pub struct Player {
    pub id: usize,
    pub rating: f32,
}

#[derive(Debug, Copy, Clone, PartialEq)]
pub struct QueueEntry {
    queue_time: Instant,
    player: Player,
    modes: EnumSet<MatchmakingMode>,
}

#[derive(Debug, Clone)]
pub struct Matchmaker<T: QueueSelector> {
    max_players_examined: usize,
    queue: Vec<QueueEntry>,
    queue_sizes: HashMap<MatchmakingMode, usize>,
    queue_selector: T,
}

#[derive(Debug, Clone)]
pub struct Match {
    pub mode: MatchmakingMode,
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
                let j = rng.random_range(0..i);
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
        team[0].player.rating
    } else {
        let sum: f32 = team.iter().map(|q| q.player.rating * q.player.rating).sum();
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
            max_players_examined,
            queue: Vec::new(),
            queue_sizes: HashMap::new(),
            queue_selector,
        }
    }

    pub fn insert_player(&mut self, player: Player, modes: EnumSet<MatchmakingMode>) -> &mut Self {
        let entry = self.create_entry_and_update_modes(player, modes, Instant::now());
        self.queue.push(entry);
        self
    }

    /// Re-inserts a player in the queue who had been queued previously, keeping their queue_time
    /// as before. This is meant to be used when players need to return to the queue after the match
    /// they were placed in failed to start.
    pub fn requeue_player(
        &mut self,
        player: Player,
        modes: EnumSet<MatchmakingMode>,
        queue_time: Instant,
    ) -> &mut Self {
        let entry = self.create_entry_and_update_modes(player, modes, queue_time);

        match self
            .queue
            .binary_search_by_key(&entry.queue_time, |e| e.queue_time)
        {
            Ok(pos) | Err(pos) => self.queue.insert(pos, entry),
        };

        self
    }

    // FIXME: use a result instead of panicking
    fn create_entry_and_update_modes(
        &mut self,
        player: Player,
        modes: EnumSet<MatchmakingMode>,
        queue_time: Instant,
    ) -> QueueEntry {
        assert!(!modes.is_empty(), "must queue for at least one mode");
        assert!(
            self.queue.iter().all(|x| x.player.id != player.id),
            "player already in queue"
        );

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

        entry
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
    /// ordered by [MatchmakingMode] and then the value of that match (so "better" matches will
    /// appear first). Only matches of at least `min_quality` quality will be returned.
    pub fn find_matches(&self, min_quality: f32, now: Instant) -> Vec<Match> {
        let mut modes = MatchmakingMode::iter().collect::<Vec<_>>();
        modes.shuffle(&mut rand::rng());
        self.find_matches_for_modes(&modes, min_quality, now)
    }

    /// Finds matches for the given [MatchmakingMode]s, returning a Vec of the proposed matches.
    /// Matches will be returned ordered by [MatchmakingMode] (in the order given) and then the
    /// value of that match (so "better" matches will appear first). Only matches of at least
    /// `min_quality` quality will be returned.
    pub fn find_matches_for_modes(
        &self,
        modes: &[MatchmakingMode],
        min_quality: f32,
        now: Instant,
    ) -> Vec<Match> {
        let mut matches = Vec::new();

        for mode in modes {
            if let Some(&size) = self.queue_sizes.get(mode) {
                if size < mode.total_players() {
                    // Avoid iterating the whole queue if this mode couldn't generate a valid match
                    continue;
                }
            }

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
                        // Calculate variance with Welford's algorithm
                        count += 1;
                        let r = q.player.rating;
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

                    // TODO(tec27): implement latency calculation
                    let quality = wait_time.as_secs_f32()
                        - (WEIGHT_RATING_VARIANCE * variance + WEIGHT_WIN_PROB * win_prob_diff);

                    // Filter any matches that are too low quality
                    if quality >= min_quality {
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
        };
        matchmaker.insert_player(player, MatchmakingMode::Mode1v1.into());

        let result = matchmaker.find_matches_for_modes(
            &[MatchmakingMode::Mode1v1],
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
        };
        matchmaker.insert_player(player, MatchmakingMode::Mode1v1.into());
        let player = Player {
            id: 1,
            rating: 1200.0,
        };
        matchmaker.insert_player(player, MatchmakingMode::Mode1v1.into());

        assert_eq!(
            matchmaker.queue_sizes.get(&MatchmakingMode::Mode1v1),
            Some(&2)
        );

        let result = matchmaker.find_matches_for_modes(
            &[MatchmakingMode::Mode1v1],
            f32::NEG_INFINITY,
            Instant::now(),
        );
        assert_eq!(result.len(), 1);
        assert_eq!(result[0].mode, MatchmakingMode::Mode1v1);
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
        };
        matchmaker.insert_player(
            player,
            MatchmakingMode::Mode1v1 | MatchmakingMode::Mode1v1Fastest,
        );
        let player = Player {
            id: 1,
            rating: 1200.0,
        };
        matchmaker.insert_player(
            player,
            MatchmakingMode::Mode1v1Fastest | MatchmakingMode::Mode1v1,
        );

        let result = matchmaker.find_matches_for_modes(
            &[MatchmakingMode::Mode1v1Fastest, MatchmakingMode::Mode1v1],
            f32::NEG_INFINITY,
            Instant::now(),
        );
        assert_eq!(result.len(), 2);

        assert_eq!(result[0].mode, MatchmakingMode::Mode1v1Fastest);
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

        assert_eq!(result[1].mode, MatchmakingMode::Mode1v1);
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
        };
        matchmaker.insert_player(player, MatchmakingMode::Mode1v1.into());
        let player = Player {
            id: 1,
            rating: 1200.0,
        };
        matchmaker.requeue_player(player, MatchmakingMode::Mode1v1.into(), start);

        assert_eq!(
            matchmaker.queue_sizes.get(&MatchmakingMode::Mode1v1),
            Some(&2)
        );

        let result = matchmaker.find_matches_for_modes(
            &[MatchmakingMode::Mode1v1],
            f32::NEG_INFINITY,
            Instant::now(),
        );
        assert_eq!(result.len(), 1);
        assert_eq!(result[0].mode, MatchmakingMode::Mode1v1);
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
}
