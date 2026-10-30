//! Active player ratings used to scale team-mode variance penalties.

use std::collections::HashMap;
use std::time::{Duration, Instant};

use color_eyre::eyre::{Result, WrapErr};
use sqlx::PgPool;

use crate::matchmaking::MatchmakingType;

const QUERY_TIMEOUT: Duration = Duration::from_secs(10);
const MAX_SNAPSHOT_AGE: Duration = Duration::from_secs(30 * 60);
const MIN_SAMPLE_SIZE: usize = 20;
const RAMP_START: f32 = 0.75;
const RAMP_END: f32 = 0.95;
const MAX_EXTRA_MULTIPLIER: f32 = 0.5;

/// A per-mode distribution of raw ratings from players active in the current season.
#[derive(Debug, Default)]
pub(crate) struct RatingDistribution {
    observed_at: Option<Instant>,
    ratings: HashMap<MatchmakingType, Vec<f32>>,
}

impl RatingDistribution {
    /// Fetches one rating per player and mode from the current season. A player's last played date
    /// is updated when a game result is tabulated, so queue-only activity is not included. The table
    /// primary key guarantees one rating per player and mode. At a new season, players enter the
    /// sample only after playing a rated game in that season.
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
                  AND r.matchmaking_type IN ('2v2', '2v2bgh', '2v2hunters', '2v2fastest')
                  AND r.num_games_played > 0
                  AND r.last_played_date >= timezone('utc', now()) - interval '7 days'
                  AND r.last_played_date <= timezone('utc', now())
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
            Instant::now(),
        ))
    }

    /// Builds a snapshot from raw mode ratings, discarding non-finite values.
    pub(crate) fn from_ratings(
        ratings: impl IntoIterator<Item = (MatchmakingType, f32)>,
        observed_at: Instant,
    ) -> Self {
        let mut by_mode: HashMap<MatchmakingType, Vec<f32>> = HashMap::new();
        for (mode, rating) in ratings {
            if mode.team_size() == 2 && rating.is_finite() {
                by_mode.entry(mode).or_default().push(rating);
            }
        }
        for ratings in by_mode.values_mut() {
            ratings.sort_by(f32::total_cmp);
        }
        Self {
            observed_at: Some(observed_at),
            ratings: by_mode,
        }
    }

    /// Applies a ramp based on the midrank empirical percentile of a raw rating. Ties receive the
    /// midpoint of their equal-rating group; unseen ratings below or above the sample map to 0 or 1.
    pub(crate) fn variance_multiplier(
        &self,
        mode: MatchmakingType,
        rating: f32,
        now: Instant,
    ) -> f32 {
        if !rating.is_finite() || !self.is_ready(mode, now) {
            return 1.0;
        }
        let ratings = &self.ratings[&mode];
        let below = ratings.partition_point(|&r| r < rating);
        let through = ratings.partition_point(|&r| r <= rating);
        let percentile = (below as f32 + (through - below) as f32 * 0.5) / ratings.len() as f32;
        let ramp = ((percentile - RAMP_START) / (RAMP_END - RAMP_START)).clamp(0.0, 1.0);
        1.0 + MAX_EXTRA_MULTIPLIER * ramp
    }

    /// Whether a 2v2 mode has enough ratings in a fresh snapshot for percentile scaling.
    pub(crate) fn is_ready(&self, mode: MatchmakingType, now: Instant) -> bool {
        mode.team_size() == 2
            && self.age(now).is_some_and(|age| age <= MAX_SNAPSHOT_AGE)
            && self
                .ratings
                .get(&mode)
                .is_some_and(|ratings| ratings.len() >= MIN_SAMPLE_SIZE)
    }

    /// Time since the snapshot was fetched; None before the first fetch or for a future snapshot.
    pub(crate) fn age(&self, now: Instant) -> Option<Duration> {
        now.checked_duration_since(self.observed_at?)
    }

    /// Sample size and nearest-rank raw-rating quantiles for monitoring.
    pub(crate) fn mode_stats(&self, mode: MatchmakingType) -> (usize, Option<f32>, Option<f32>) {
        let Some(ratings) = self.ratings.get(&mode) else {
            return (0, None, None);
        };
        let quantile = |p: f32| {
            ratings[((p * ratings.len() as f32).ceil() as usize - 1).min(ratings.len() - 1)]
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

    fn make(mode: MatchmakingType, count: usize, now: Instant) -> RatingDistribution {
        RatingDistribution::from_ratings((0..count).map(|n| (mode, n as f32)), now)
    }

    #[test]
    fn ranks_ramp_and_clamp() {
        let now = Instant::now();
        let d = make(MatchmakingType::Match2v2, 20, now);
        let m = |rating| d.variance_multiplier(MatchmakingType::Match2v2, rating, now);
        assert_eq!(m(-1.0), 1.0);
        assert_eq!(m(14.5), 1.0); // 15 below = P75
        assert!((m(16.0) - 1.1875).abs() < 0.00001); // P82.5
        assert_eq!(m(18.5), 1.5); // 19 below = P95
        assert_eq!(m(100.0), 1.5);
    }

    #[test]
    fn ties_use_midrank() {
        let now = Instant::now();
        let d = RatingDistribution::from_ratings(
            (0..16)
                .map(|n| (MatchmakingType::Match2v2, n as f32))
                .chain((0..4).map(|_| (MatchmakingType::Match2v2, 16.0))),
            now,
        );
        assert!(
            (d.variance_multiplier(MatchmakingType::Match2v2, 16.0, now) - 1.375).abs() < 0.00001
        );
    }

    #[test]
    fn cold_small_stale_and_invalid_use_baseline() {
        let now = Instant::now();
        assert_eq!(
            RatingDistribution::default().variance_multiplier(
                MatchmakingType::Match2v2,
                100.0,
                now
            ),
            1.0
        );
        let small = make(MatchmakingType::Match2v2, 19, now);
        assert_eq!(
            small.variance_multiplier(MatchmakingType::Match2v2, 100.0, now),
            1.0
        );
        let d = make(MatchmakingType::Match2v2, 20, now);
        assert_eq!(
            d.variance_multiplier(MatchmakingType::Match2v2, f32::NAN, now),
            1.0
        );
        assert_eq!(
            d.variance_multiplier(MatchmakingType::Match2v2, 100.0, now + MAX_SNAPSHOT_AGE),
            1.5
        );
        assert_eq!(
            d.variance_multiplier(
                MatchmakingType::Match2v2,
                100.0,
                now + MAX_SNAPSHOT_AGE + Duration::from_secs(1)
            ),
            1.0
        );
        assert_eq!(
            d.variance_multiplier(MatchmakingType::Match1v1, 100.0, now),
            1.0
        );
        assert_eq!(
            d.variance_multiplier(MatchmakingType::Match2v2Bgh, 100.0, now),
            1.0
        );
    }

    #[test]
    fn modes_are_independent_and_rank_is_shift_invariant() {
        let now = Instant::now();
        let d = RatingDistribution::from_ratings(
            (0..20)
                .flat_map(|n| {
                    [
                        (MatchmakingType::Match2v2, n as f32),
                        (MatchmakingType::Match2v2Bgh, n as f32 + 1000.0),
                    ]
                })
                .chain([(MatchmakingType::Match2v2, f32::NAN)]),
            now,
        );
        assert_eq!(d.mode_stats(MatchmakingType::Match2v2).0, 20);
        assert_eq!(
            d.variance_multiplier(MatchmakingType::Match2v2, 16.0, now),
            d.variance_multiplier(MatchmakingType::Match2v2Bgh, 1016.0, now)
        );
    }
    #[test]
    fn identical_and_invalid_ratings_and_future_snapshot() {
        let now = Instant::now();
        let mode = MatchmakingType::Match2v2;
        let ratings = (0..20).map(|_| (mode, 1500.0)).chain([
            (mode, f32::NAN),
            (mode, f32::INFINITY),
            (mode, f32::NEG_INFINITY),
        ]);
        let d = RatingDistribution::from_ratings(ratings, now);
        assert_eq!(d.mode_stats(mode), (20, Some(1500.0), Some(1500.0)));
        assert!(d.is_ready(mode, now));
        assert_eq!(d.variance_multiplier(mode, 1500.0, now), 1.0);
        assert!(!d.is_ready(mode, now - Duration::from_secs(1)));
        assert_eq!(
            d.variance_multiplier(mode, 2000.0, now - Duration::from_secs(1)),
            1.0
        );
        assert!(!d.is_ready(MatchmakingType::Match1v1, now));
        assert!(!RatingDistribution::default().is_ready(mode, now));
    }

    #[tokio::test]
    #[ignore = "requires a local PostgreSQL DATABASE_URL"]
    async fn loads_current_season_active_players_from_database() {
        use sqlx::postgres::PgPoolOptions;

        let pool = PgPoolOptions::new()
            .max_connections(1)
            .connect(&std::env::var("DATABASE_URL").expect("DATABASE_URL must be set"))
            .await
            .unwrap();
        // Temporary tables shadow the application tables on this single connection.
        for statement in [
            "CREATE TEMP TABLE matchmaking_seasons (LIKE public.matchmaking_seasons INCLUDING DEFAULTS)",
            "CREATE TEMP TABLE matchmaking_ratings (LIKE public.matchmaking_ratings INCLUDING DEFAULTS)",
            r#"INSERT INTO matchmaking_seasons (id, name, start_date) VALUES
                (1, 'previous', timezone('utc', now()) - interval '30 days'),
                (2, 'current', timezone('utc', now()) - interval '10 days'),
                (3, 'future', timezone('utc', now()) + interval '1 day')"#,
            r#"INSERT INTO matchmaking_ratings
                (user_id, matchmaking_type, season_id, rating, uncertainty, num_games_played, last_played_date)
                SELECT n, mode::matchmaking_type, 2, base + n, 100, 1, timezone('utc', now()) - interval '1 day'
                FROM generate_series(1, 20) n
                CROSS JOIN (VALUES ('2v2', 1000), ('2v2bgh', 2000)) modes(mode, base)"#,
            r#"INSERT INTO matchmaking_ratings
                (user_id, matchmaking_type, season_id, rating, uncertainty, num_games_played, last_played_date)
                VALUES
                (21, '2v2', 2, 9000, 100, 1, timezone('utc', now()) - interval '8 days'),
                (22, '2v2', 2, 9000, 100, 1, timezone('utc', now()) + interval '1 day'),
                (23, '2v2', 2, 9000, 100, 0, timezone('utc', now()) - interval '1 day'),
                (24, '2v2', 1, 9000, 100, 1, timezone('utc', now()) - interval '1 day'),
                (25, '2v2', 3, 9000, 100, 1, timezone('utc', now()) - interval '1 day'),
                (26, '1v1', 2, 9000, 100, 1, timezone('utc', now()) - interval '1 day')"#,
        ] {
            sqlx::query(statement).execute(&pool).await.unwrap();
        }

        let snapshot = RatingDistribution::load(&pool).await.unwrap();
        let now = Instant::now();
        assert_eq!(
            snapshot.mode_stats(MatchmakingType::Match2v2),
            (20, Some(1015.0), Some(1019.0))
        );
        assert_eq!(
            snapshot.mode_stats(MatchmakingType::Match2v2Bgh),
            (20, Some(2015.0), Some(2019.0))
        );
        assert_eq!(snapshot.mode_stats(MatchmakingType::Match1v1).0, 0);
        assert_eq!(
            snapshot.variance_multiplier(MatchmakingType::Match2v2, 1020.0, now),
            1.5
        );
        assert_eq!(
            snapshot.variance_multiplier(MatchmakingType::Match2v2Bgh, 1020.0, now),
            1.0
        );
    }
}
