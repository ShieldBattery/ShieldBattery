//! Active player ratings, used to scale 2v2 variance penalties and to soften the rematch penalty for
//! players in sparse rating ranges.

use std::collections::HashMap;
use std::time::Duration;

use color_eyre::eyre::{Result, WrapErr};
use sqlx::PgPool;

use crate::matchmaking::MatchmakingType;

const QUERY_TIMEOUT: Duration = Duration::from_secs(10);
const MIN_SAMPLE_SIZE: usize = 20;
const RAMP_START: f32 = 0.75;
const RAMP_END: f32 = 0.95;
const MAX_EXTRA_MULTIPLIER: f32 = 0.5;

/// A per-mode distribution of raw ratings from players active in the current season. The
/// distribution of a week's active players drifts slowly, so a snapshot stays usable until the next
/// successful load replaces it, however old it is.
#[derive(Debug, Default)]
pub(crate) struct RatingDistribution {
    /// Sorted ascending, finite values only.
    ratings: HashMap<MatchmakingType, Vec<f32>>,
}

impl RatingDistribution {
    /// Fetches one rating per player and mode from the current season, for players who finished a
    /// rated game in that mode in the past seven days. A player's last played date is updated when a
    /// game result is tabulated, so queue-only activity is not included. Served by the
    /// `matchmaking_ratings_points` index on (season_id, matchmaking_type), so the scan is bounded by
    /// the current season's rows.
    pub(crate) async fn load(pool: &PgPool) -> Result<Self> {
        let rows = tokio::time::timeout(
            QUERY_TIMEOUT,
            sqlx::query!(
                r#"
                SELECT r.matchmaking_type AS "matchmaking_type!: MatchmakingType",
                       r.rating
                FROM matchmaking_ratings r
                WHERE r.season_id = (
                    SELECT id FROM matchmaking_seasons
                    WHERE start_date <= timezone('utc', now())
                    ORDER BY start_date DESC
                    LIMIT 1
                )
                  AND r.num_games_played > 0
                  AND r.last_played_date >= timezone('utc', now()) - interval '7 days'
                "#
            )
            .fetch_all(pool),
        )
        .await
        .wrap_err("active rating distribution query timed out")?
        .wrap_err("failed to fetch active rating distribution")?;

        Ok(Self::from_ratings(
            rows.into_iter()
                .map(|row| (row.matchmaking_type, row.rating)),
        ))
    }

    /// Builds a snapshot from raw mode ratings, discarding non-finite values.
    pub(crate) fn from_ratings(ratings: impl IntoIterator<Item = (MatchmakingType, f32)>) -> Self {
        let mut by_mode: HashMap<MatchmakingType, Vec<f32>> = HashMap::new();
        for (mode, rating) in ratings {
            if rating.is_finite() {
                by_mode.entry(mode).or_default().push(rating);
            }
        }
        for ratings in by_mode.values_mut() {
            ratings.sort_by(f32::total_cmp);
        }
        Self { ratings: by_mode }
    }

    /// The multiplier for a mode's variance weight given a roster's raw rating: 1 up to the P75 of
    /// the mode's active players, ramping linearly to `1 + MAX_EXTRA_MULTIPLIER` at P95 and above.
    /// Percentiles are midrank (ties receive the midpoint of their equal-rating group), so ratings
    /// below or above the whole sample map to 0 or 1. Modes other than 2v2, and modes without enough
    /// samples, always get 1.
    pub(crate) fn variance_multiplier(&self, mode: MatchmakingType, rating: f32) -> f32 {
        if mode.team_size() != 2 {
            return 1.0;
        }
        let Some(ratings) = self.ready_ratings(mode) else {
            return 1.0;
        };
        if !rating.is_finite() {
            return 1.0;
        }
        let below = ratings.partition_point(|&r| r < rating);
        let through = ratings.partition_point(|&r| r <= rating);
        let percentile = (below as f32 + (through - below) as f32 * 0.5) / ratings.len() as f32;
        let ramp = ((percentile - RAMP_START) / (RAMP_END - RAMP_START)).clamp(0.0, 1.0);
        1.0 + MAX_EXTRA_MULTIPLIER * ramp
    }

    /// How many active players in `mode` have a rating within `radius` of `rating`, or `None` when
    /// the mode has too few samples to judge.
    pub(crate) fn nearby_count(
        &self,
        mode: MatchmakingType,
        rating: f32,
        radius: f32,
    ) -> Option<usize> {
        let ratings = self.ready_ratings(mode)?;
        if !rating.is_finite() {
            return None;
        }
        let start = ratings.partition_point(|&r| r < rating - radius);
        let end = ratings.partition_point(|&r| r <= rating + radius);
        Some(end - start)
    }

    /// The [`Self::nearby_count`] of the median active player in `mode` (each player counting
    /// themselves), or `None` when the mode has too few samples to judge.
    pub(crate) fn median_nearby_count(&self, mode: MatchmakingType, radius: f32) -> Option<usize> {
        let ratings = self.ready_ratings(mode)?;
        let mut counts = Vec::with_capacity(ratings.len());
        let (mut start, mut end) = (0, 0);
        for &rating in ratings {
            while ratings[start] < rating - radius {
                start += 1;
            }
            while end < ratings.len() && ratings[end] <= rating + radius {
                end += 1;
            }
            counts.push(end - start);
        }
        let middle = counts.len() / 2;
        Some(*counts.select_nth_unstable(middle).1)
    }

    fn ready_ratings(&self, mode: MatchmakingType) -> Option<&[f32]> {
        self.ratings
            .get(&mode)
            .filter(|ratings| ratings.len() >= MIN_SAMPLE_SIZE)
            .map(Vec::as_slice)
    }

    /// Sample size and the raw ratings at the ramp's start and end percentiles, for monitoring.
    pub(crate) fn mode_stats(&self, mode: MatchmakingType) -> (usize, Option<f32>, Option<f32>) {
        let Some(ratings) = self.ratings.get(&mode) else {
            return (0, None, None);
        };
        // Nearest-rank: the smallest sample with at least `p` of the sample at or below it.
        let quantile = |p: f32| {
            ratings[((p * ratings.len() as f32).ceil() as usize).clamp(1, ratings.len()) - 1]
        };
        (
            ratings.len(),
            Some(quantile(RAMP_START)),
            Some(quantile(RAMP_END)),
        )
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn make(mode: MatchmakingType, count: usize) -> RatingDistribution {
        RatingDistribution::from_ratings((0..count).map(|n| (mode, n as f32)))
    }

    #[test]
    fn ranks_ramp_and_clamp() {
        let d = make(MatchmakingType::Match2v2, 20);
        let m = |rating| d.variance_multiplier(MatchmakingType::Match2v2, rating);
        assert_eq!(m(-1.0), 1.0);
        assert_eq!(m(14.5), 1.0); // 15 below = P75
        assert!((m(16.0) - 1.1875).abs() < 0.00001); // P82.5
        assert_eq!(m(18.5), 1.5); // 19 below = P95
        assert_eq!(m(100.0), 1.5);
    }

    #[test]
    fn ties_use_midrank() {
        let d = RatingDistribution::from_ratings(
            (0..16)
                .map(|n| (MatchmakingType::Match2v2, n as f32))
                .chain((0..4).map(|_| (MatchmakingType::Match2v2, 16.0))),
        );
        assert!((d.variance_multiplier(MatchmakingType::Match2v2, 16.0) - 1.375).abs() < 0.00001);
    }

    #[test]
    fn empty_small_invalid_and_other_modes_use_baseline() {
        let mode = MatchmakingType::Match2v2;
        assert_eq!(
            RatingDistribution::default().variance_multiplier(mode, 100.0),
            1.0
        );
        assert_eq!(make(mode, 19).variance_multiplier(mode, 100.0), 1.0);
        let d = make(mode, 20);
        assert_eq!(d.variance_multiplier(mode, f32::NAN), 1.0);
        assert_eq!(d.variance_multiplier(MatchmakingType::Match1v1, 100.0), 1.0);
        assert_eq!(
            d.variance_multiplier(MatchmakingType::Match2v2Bgh, 100.0),
            1.0
        );
        let one_v_one = make(MatchmakingType::Match1v1, 20);
        assert_eq!(one_v_one.mode_stats(MatchmakingType::Match1v1).0, 20);
        assert_eq!(
            one_v_one.variance_multiplier(MatchmakingType::Match1v1, 100.0),
            1.0
        );
    }

    #[test]
    fn nearby_counts_include_both_edges() {
        let mode = MatchmakingType::Match1v1;
        // Ratings 0, 10, ..., 190.
        let d = RatingDistribution::from_ratings((0..20).map(|n| (mode, n as f32 * 10.0)));
        assert_eq!(d.nearby_count(mode, 100.0, 20.0), Some(5));
        assert_eq!(d.nearby_count(mode, 0.0, 20.0), Some(3));
        assert_eq!(d.nearby_count(mode, 1000.0, 20.0), Some(0));
        assert_eq!(d.nearby_count(mode, f32::NAN, 20.0), None);
        // Interior players see 5, the two at each end see 3 and 4: the median is 5.
        assert_eq!(d.median_nearby_count(mode, 20.0), Some(5));
    }

    #[test]
    fn nearby_counts_need_enough_samples() {
        let mode = MatchmakingType::Match1v1;
        let d = make(mode, 19);
        assert_eq!(d.nearby_count(mode, 5.0, 100.0), None);
        assert_eq!(d.median_nearby_count(mode, 100.0), None);
    }

    #[test]
    fn modes_are_independent_and_rank_is_shift_invariant() {
        let d = RatingDistribution::from_ratings(
            (0..20)
                .flat_map(|n| {
                    [
                        (MatchmakingType::Match2v2, n as f32),
                        (MatchmakingType::Match2v2Bgh, n as f32 + 1000.0),
                    ]
                })
                .chain([(MatchmakingType::Match2v2, f32::NAN)]),
        );
        assert_eq!(d.mode_stats(MatchmakingType::Match2v2).0, 20);
        assert_eq!(
            d.variance_multiplier(MatchmakingType::Match2v2, 16.0),
            d.variance_multiplier(MatchmakingType::Match2v2Bgh, 1016.0)
        );
    }

    #[test]
    fn identical_ratings_sit_at_the_median() {
        let mode = MatchmakingType::Match2v2;
        let ratings = (0..20).map(|_| (mode, 1500.0)).chain([
            (mode, f32::NAN),
            (mode, f32::INFINITY),
            (mode, f32::NEG_INFINITY),
        ]);
        let d = RatingDistribution::from_ratings(ratings);
        assert_eq!(d.mode_stats(mode), (20, Some(1500.0), Some(1500.0)));
        assert_eq!(d.variance_multiplier(mode, 1500.0), 1.0);
        assert_eq!(d.variance_multiplier(mode, 2000.0), 1.5);
    }
}
