//! Rating/points history for a user in a matchmaking mode, for the profile stats page.
//!
//! `matchmaking_rating_changes` stores one row per game, which is already the shape a chart
//! wants, but two things have to happen before it's usable:
//!
//! - The table has no `season_id`. Seasons are derived by bucketing `change_date` against
//!   `matchmaking_seasons.start_date`, which the client needs because points restart every
//!   season and MMR restarts whenever a season sets `reset_mmr`.
//! - A long-lived account has thousands of games. Sending all of them to draw a chart a few
//!   hundred pixels wide is waste, so anything past [`MAX_POINTS`] is downsampled.

use async_graphql::{Context, Object, Result, SimpleObject};
use chrono::{DateTime, Utc};
use color_eyre::eyre::Context as _;
use sqlx::PgPool;

use crate::matchmaking::MatchmakingType;
use crate::users::SbUserId;

/// Point count above which a history is downsampled. Chosen so the common case (most players)
/// is returned untouched, and the payload stays small enough that pagination is unnecessary.
const MAX_POINTS: usize = 400;

/// Games a player must have completed since their last MMR reset before their rating is
/// public. Mirrors `NUM_PLACEMENT_MATCHES` in `common/matchmaking.ts`. Ratings earned during
/// placements are provisional and every other endpoint that serves ratings hides them (the
/// ladder and profile APIs zero them out), so nothing here may send one either — not as a
/// point on the chart, not folded into a delta.
const NUM_PLACEMENT_MATCHES: i32 = 5;

#[derive(Default)]
pub struct MatchmakingHistoryQuery;

#[Object]
impl MatchmakingHistoryQuery {
    /// Every mode a user has ever played ranked, with all-time totals and their standing
    /// against the last rating they held before this season.
    ///
    /// All-time rather than current-season because it drives a page about all-time history:
    /// sourcing the mode list from the current season's ratings hides a player's whole
    /// history the moment they skip a season.
    ///
    /// The delta is deliberately measured across the season boundary rather than within the
    /// current season: when a season resets MMR, everyone restarts from the same place, and
    /// the interesting number is how their standing now compares to what they last held —
    /// not how far they've climbed back from the reset. It's `None` for a mode first played
    /// this season, which has nothing to compare against.
    ///
    /// Separate from [`user_rating_history`] because the profile shows this on every mode's
    /// header, including collapsed ones whose history hasn't been fetched.
    async fn user_ranked_modes(
        &self,
        ctx: &Context<'_>,
        user_id: SbUserId,
    ) -> Result<Vec<UserRankedMode>> {
        let db = ctx.data::<PgPool>()?;
        let seasons = fetch_seasons(db)
            .await
            .wrap_err("Failed to fetch matchmaking seasons")?;
        let Some(current) = seasons.iter().rev().find(|s| s.start_date <= Utc::now()) else {
            return Ok(Vec::new());
        };

        // "Last known rating" rather than "the previous season's", so a mode the player sat
        // out for a season still compares against the last rating they actually held.
        // `lifetime_games` rides along with each rating so placement status can be judged for
        // the same row the rating came from.
        let rows = sqlx::query!(
            r#"
                SELECT
                    matchmaking_type AS "matchmaking_type!: MatchmakingType",
                    count(*) AS "total_games!",
                    count(*) FILTER (WHERE outcome = 'win') AS "wins!",
                    count(*) FILTER (WHERE outcome = 'loss') AS "losses!",
                    (array_agg(rating ORDER BY change_date DESC))[1] AS "rating!: f32",
                    (array_agg(lifetime_games ORDER BY change_date DESC))[1]
                        AS "lifetime_games!",
                    (array_agg(rating ORDER BY change_date DESC)
                        FILTER (WHERE change_date >= $2))[1] AS "current?: f32",
                    (array_agg(rating ORDER BY change_date DESC)
                        FILTER (WHERE change_date < $2))[1] AS "previous?: f32",
                    (array_agg(lifetime_games ORDER BY change_date DESC)
                        FILTER (WHERE change_date < $2))[1] AS "previous_lifetime_games?"
                FROM matchmaking_rating_changes
                WHERE user_id = $1
                GROUP BY matchmaking_type
            "#,
            user_id.0,
            current.start_date.naive_utc(),
        )
        .fetch_all(db)
        .await
        .wrap_err("Failed to fetch ranked modes")?;

        Ok(rows
            .into_iter()
            .map(|row| {
                // When `current` exists, the newest row overall is in the current season, so
                // `placed` is also the placement status of the delta's current endpoint.
                let placed = row.lifetime_games >= NUM_PLACEMENT_MATCHES;
                let previous_placed = row
                    .previous_lifetime_games
                    .is_some_and(|games| games >= NUM_PLACEMENT_MATCHES);
                UserRankedMode {
                    matchmaking_type: row.matchmaking_type,
                    total_games: row.total_games as i32,
                    wins: row.wins as i32,
                    losses: row.losses as i32,
                    rating: placed.then_some(row.rating),
                    delta: match (row.current, row.previous) {
                        (Some(current), Some(previous)) if placed && previous_placed => {
                            Some(current - previous)
                        }
                        _ => None,
                    },
                }
            })
            .collect())
    }

    /// A user's rating and points over time in a single mode, oldest first.
    async fn user_rating_history(
        &self,
        ctx: &Context<'_>,
        user_id: SbUserId,
        matchmaking_type: MatchmakingType,
    ) -> Result<RatingHistory> {
        let db = ctx.data::<PgPool>()?;
        let seasons = fetch_seasons(db)
            .await
            .wrap_err("Failed to fetch matchmaking seasons")?;

        // The primary key is (user_id, matchmaking_type, game_id), so this is an index prefix
        // scan; the sort is over one user's rows for one mode.
        let rows = sqlx::query!(
            r#"
                SELECT
                    change_date AT TIME ZONE 'UTC' AS "change_date!: DateTime<Utc>",
                    rating AS "rating!: f32",
                    points AS "points?: f32",
                    lifetime_games AS "lifetime_games!"
                FROM matchmaking_rating_changes
                WHERE user_id = $1 AND matchmaking_type = $2
                ORDER BY change_date ASC
            "#,
            user_id.0,
            matchmaking_type as MatchmakingType,
        )
        .fetch_all(db)
        .await
        .wrap_err("Failed to fetch rating history")?;

        let total_games = rows.len();
        let points: Vec<RatingHistoryPoint> = rows
            .into_iter()
            .map(|row| RatingHistoryPoint {
                change_date: row.change_date,
                rating: (row.lifetime_games >= NUM_PLACEMENT_MATCHES).then_some(row.rating),
                points: row.points.unwrap_or(0.0),
                season_id: season_for(&seasons, row.change_date),
            })
            .collect();

        Ok(RatingHistory {
            matchmaking_type,
            total_games: total_games as i32,
            downsampled: points.len() > MAX_POINTS,
            points: downsample_by_season(points, MAX_POINTS),
        })
    }
}

/// Internal only: the season list is served by `GET /matchmaking/seasons` and already lives in
/// the client's `matchmakingSeasons` store, so this isn't exposed over GraphQL. It's used here
/// to bucket each game into a season, which `matchmaking_rating_changes` doesn't record.
#[derive(Debug, Clone)]
pub struct MatchmakingSeason {
    pub id: i32,
    pub name: String,
    pub start_date: DateTime<Utc>,
    /// Whether MMR was reset at the start of this season. Rating must not be drawn as a
    /// continuous line across a season where this is true.
    pub reset_mmr: bool,
}

#[derive(SimpleObject, Debug, Clone)]
pub struct UserRankedMode {
    pub matchmaking_type: MatchmakingType,
    /// Games played in this mode across every season.
    pub total_games: i32,
    pub wins: i32,
    pub losses: i32,
    /// The most recent rating in this mode, whenever it was last played. `None` while the
    /// player hasn't finished placement matches since their last MMR reset — a provisional
    /// rating is never sent.
    pub rating: Option<f32>,
    /// Current rating minus the last rating held before this season started. Spans an MMR
    /// reset, so a reset season typically shows a drop until the player climbs back. `None`
    /// for a mode first played this season, which has nothing to compare against, and `None`
    /// whenever either endpoint sits inside placement matches — a delta against a hidden
    /// rating would reveal it.
    pub delta: Option<f32>,
}

#[derive(SimpleObject, Debug, Clone)]
pub struct RatingHistoryPoint {
    pub change_date: DateTime<Utc>,
    /// `None` for games played during placement matches, whose ratings are provisional and
    /// never sent. Points are public throughout, so a placement game still carries those.
    pub rating: Option<f32>,
    pub points: f32,
    /// The season this game fell in, derived from `change_date`.
    pub season_id: i32,
}

#[derive(SimpleObject, Debug, Clone)]
pub struct RatingHistory {
    pub matchmaking_type: MatchmakingType,
    /// Games actually played, before any downsampling.
    pub total_games: i32,
    /// Whether `points` is a reduced view of the full history.
    pub downsampled: bool,
    pub points: Vec<RatingHistoryPoint>,
}

async fn fetch_seasons(db: &PgPool) -> sqlx::Result<Vec<MatchmakingSeason>> {
    sqlx::query_as!(
        MatchmakingSeason,
        r#"
            SELECT
                id,
                name,
                start_date AT TIME ZONE 'UTC' AS "start_date!: DateTime<Utc>",
                reset_mmr
            FROM matchmaking_seasons
            ORDER BY start_date ASC
        "#,
    )
    .fetch_all(db)
    .await
}

/// The season a game falls in: the last one that started at or before it. Seasons must be
/// sorted by `start_date` ascending.
fn season_for(seasons: &[MatchmakingSeason], at: DateTime<Utc>) -> i32 {
    seasons
        .iter()
        .rev()
        .find(|s| s.start_date <= at)
        .or_else(|| seasons.first())
        .map(|s| s.id)
        .unwrap_or(0)
}

/// Downsamples each season independently and concatenates the result.
///
/// Per-season rather than across the whole history because a bucket spanning a season boundary
/// would average away the discontinuity the chart exists to show — points restart at zero every
/// season, and MMR restarts on a reset.
fn downsample_by_season(
    points: Vec<RatingHistoryPoint>,
    max_points: usize,
) -> Vec<RatingHistoryPoint> {
    if points.len() <= max_points {
        return points;
    }

    let mut runs: Vec<Vec<RatingHistoryPoint>> = Vec::new();
    for point in points {
        match runs.last_mut() {
            Some(run) if run[0].season_id == point.season_id => run.push(point),
            _ => runs.push(vec![point]),
        }
    }

    let total: usize = runs.iter().map(|r| r.len()).sum();

    // Every season is guaranteed its endpoints, and that floor is reserved before the rest is
    // shared out. Handing each season a share of the whole budget independently overshoots:
    // a heavy season takes a share computed against the entire history, and the floors the
    // remaining seasons still claim come out of nothing. An account with one long season and a
    // tail of brief ones is the shape that exposes it.
    const FLOOR: usize = 2;
    let discretionary = max_points.saturating_sub(FLOOR * runs.len());

    let mut out = Vec::with_capacity(max_points);
    for run in runs {
        let extra = (run.len() * discretionary).checked_div(total).unwrap_or(0);
        out.extend(lttb(run, FLOOR + extra));
    }
    out
}

/// Largest-Triangle-Three-Buckets.
///
/// Picked over sampling every Nth point or averaging into time buckets because it preserves the
/// visual shape: peaks and troughs survive, which is exactly what a rating curve is read for.
/// Averaging would smooth away the peak a player cares most about.
/// Keeps the points LTTB selects for *both* metrics.
///
/// The client charts rating and points from this one series, and the two curves are unrelated:
/// points restart at zero every season while rating carries across, so a spike in one can sit
/// where the other is flat. Selecting for rating alone would hand the points view a series
/// sampled to preserve a different shape, smoothing away exactly the peaks LTTB was chosen to
/// keep -- and only on histories past the threshold, which are the ones that most need it.
///
/// Each metric gets half the budget and the union is kept, so the result never exceeds
/// `threshold` and neither curve is sampled for the shape of the other.
///
/// Rating is absent during placement matches, so its pass runs over just the rated games and
/// the picks are mapped back to full-series indices. The points pass runs over every game,
/// which is also what guarantees the series' endpoints survive.
fn lttb(points: Vec<RatingHistoryPoint>, threshold: usize) -> Vec<RatingHistoryPoint> {
    if threshold >= points.len() {
        return points;
    }
    if threshold <= 2 {
        // Endpoints only. A season squeezed to its floor still has to appear on the chart, and
        // the endpoints are what the headline numbers are read against.
        return vec![points[0].clone(), points[points.len() - 1].clone()];
    }

    let x = |p: &RatingHistoryPoint| p.change_date.timestamp() as f64;
    let rated: Vec<usize> = (0..points.len())
        .filter(|&i| points[i].rating.is_some())
        .collect();
    let rating_samples: Vec<(f64, f64)> = rated
        .iter()
        .map(|&i| (x(&points[i]), points[i].rating.unwrap() as f64))
        .collect();
    let point_samples: Vec<(f64, f64)> = points.iter().map(|p| (x(p), p.points as f64)).collect();

    let half = threshold / 2;
    if half < 3 {
        // Too small a budget to split between the metrics. Points is the one defined for
        // every game, so sampling by it keeps the endpoints and stays within budget even
        // when the run is entirely placement games.
        let keep = lttb_indices(&point_samples, threshold);
        return keep.into_iter().map(|i| points[i].clone()).collect();
    }

    let mut keep: Vec<usize> = lttb_indices(&rating_samples, half)
        .into_iter()
        .map(|i| rated[i])
        .collect();
    keep.extend(lttb_indices(&point_samples, half));
    keep.sort_unstable();
    keep.dedup();
    keep.into_iter().map(|i| points[i].clone()).collect()
}

/// The indices LTTB would keep from `samples`, each an `(x, y)` pair in x order.
fn lttb_indices(samples: &[(f64, f64)], threshold: usize) -> Vec<usize> {
    if threshold >= samples.len() || threshold < 3 {
        return (0..samples.len()).collect();
    }

    let mut out = Vec::with_capacity(threshold);
    // First and last are always kept, so the endpoints match the headline numbers.
    out.push(0);

    // Buckets over the interior points.
    let every = (samples.len() - 2) as f64 / (threshold - 2) as f64;
    let mut a = 0usize;

    for i in 0..(threshold - 2) {
        let avg_start = ((i + 1) as f64 * every) as usize + 1;
        let avg_end = (((i + 2) as f64 * every) as usize + 1).min(samples.len());
        let avg_len = (avg_end - avg_start).max(1);

        let (avg_x, avg_y) = samples[avg_start..avg_end.max(avg_start + 1).min(samples.len())]
            .iter()
            .fold((0.0f64, 0.0f64), |(acc_x, acc_y), &(sx, sy)| {
                (acc_x + sx, acc_y + sy)
            });
        let avg_x = avg_x / avg_len as f64;
        let avg_y = avg_y / avg_len as f64;

        let range_start = (i as f64 * every) as usize + 1;
        let range_end = (((i + 1) as f64 * every) as usize + 1).min(samples.len());

        let (point_a_x, point_a_y) = samples[a];

        let mut best_area = -1.0f64;
        let mut best_index = range_start;
        for (offset, &(sx, sy)) in samples[range_start..range_end].iter().enumerate() {
            let area = ((point_a_x - avg_x) * (sy - point_a_y)
                - (point_a_x - sx) * (avg_y - point_a_y))
                .abs()
                * 0.5;
            if area > best_area {
                best_area = area;
                best_index = range_start + offset;
            }
        }

        out.push(best_index);
        a = best_index;
    }

    out.push(samples.len() - 1);
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn point(secs: i64, rating: f32, season_id: i32) -> RatingHistoryPoint {
        RatingHistoryPoint {
            change_date: DateTime::from_timestamp(secs, 0).unwrap(),
            rating: Some(rating),
            points: rating * 4.0,
            season_id,
        }
    }

    fn season(id: i32, secs: i64, reset_mmr: bool) -> MatchmakingSeason {
        MatchmakingSeason {
            id,
            name: format!("Season {id}"),
            start_date: DateTime::from_timestamp(secs, 0).unwrap(),
            reset_mmr,
        }
    }

    #[test]
    fn season_for_picks_the_last_season_started_before_the_game() {
        let seasons = vec![
            season(1, 0, true),
            season(2, 1_000, false),
            season(3, 2_000, true),
        ];
        assert_eq!(
            season_for(&seasons, DateTime::from_timestamp(500, 0).unwrap()),
            1
        );
        assert_eq!(
            season_for(&seasons, DateTime::from_timestamp(1_000, 0).unwrap()),
            2
        );
        assert_eq!(
            season_for(&seasons, DateTime::from_timestamp(5_000, 0).unwrap()),
            3
        );
    }

    #[test]
    fn season_for_falls_back_to_the_first_season_for_games_before_any_season() {
        let seasons = vec![season(1, 1_000, true)];
        assert_eq!(
            season_for(&seasons, DateTime::from_timestamp(0, 0).unwrap()),
            1
        );
    }

    #[test]
    fn short_histories_are_returned_untouched() {
        let points: Vec<_> = (0..50)
            .map(|i| point(i as i64 * 60, 1500.0 + i as f32, 1))
            .collect();
        let out = downsample_by_season(points.clone(), 400);
        assert_eq!(out.len(), points.len());
    }

    #[test]
    fn downsampling_keeps_the_endpoints() {
        let points: Vec<_> = (0..2_000)
            .map(|i| point(i as i64 * 60, 1500.0 + i as f32, 1))
            .collect();
        let first = points[0].rating;
        let last = points[points.len() - 1].rating;
        let out = downsample_by_season(points, 400);

        assert!(
            out.len() <= 400,
            "expected at most 400 points, got {}",
            out.len()
        );
        assert_eq!(out[0].rating, first);
        assert_eq!(out[out.len() - 1].rating, last);
    }

    #[test]
    fn downsampling_never_merges_across_a_season() {
        // Two seasons whose ratings don't overlap: a bucket spanning the boundary would emit a
        // point somewhere in between, which never happened.
        let mut points: Vec<_> = (0..1_000)
            .map(|i| point(i as i64 * 60, 1500.0 + i as f32 * 0.1, 1))
            .collect();
        points
            .extend((0..1_000).map(|i| point(100_000 + i as i64 * 60, 900.0 + i as f32 * 0.1, 2)));

        let out = downsample_by_season(points, 400);

        assert!(out.iter().any(|p| p.season_id == 1));
        assert!(out.iter().any(|p| p.season_id == 2));
        // Seasons stay in order and no point lands between the two rating bands.
        let boundary = out.iter().position(|p| p.season_id == 2).unwrap();
        assert!(out[..boundary].iter().all(|p| p.season_id == 1));
        assert!(out[boundary..].iter().all(|p| p.season_id == 2));
        assert!(
            !out.iter()
                .any(|p| p.rating.is_some_and(|r| r > 1000.0 && r < 1490.0))
        );
    }

    #[test]
    fn lttb_preserves_a_spike() {
        // A flat line with one tall spike: sampling every Nth point would likely miss it.
        let mut points: Vec<_> = (0..1_000)
            .map(|i| point(i as i64 * 60, 1500.0, 1))
            .collect();
        points[500] = point(500 * 60, 2400.0, 1);

        let out = lttb(points, 100);
        assert!(
            out.iter().any(|p| p.rating.is_some_and(|r| r > 2300.0)),
            "the spike was smoothed away",
        );
    }

    #[test]
    fn lttb_preserves_a_spike_in_either_metric() {
        // Rating and points are charted from this one series but are unrelated curves, so a
        // spike in one can sit where the other is flat. Both have to survive.
        let mut points: Vec<_> = (0..1_000)
            .map(|i| RatingHistoryPoint {
                change_date: DateTime::from_timestamp(i as i64 * 60, 0).unwrap(),
                rating: Some(1500.0),
                points: 6000.0,
                season_id: 1,
            })
            .collect();
        points[250].rating = Some(2400.0);
        points[750].points = 9600.0;

        let out = lttb(points, 100);
        assert!(
            out.iter().any(|p| p.rating.is_some_and(|r| r > 2300.0)),
            "the rating spike was smoothed away",
        );
        assert!(
            out.iter().any(|p| p.points > 9500.0),
            "the points spike was smoothed away",
        );
    }

    #[test]
    fn many_tiny_seasons_do_not_blow_the_budget() {
        // A veteran with one heavy season and a long tail of two-game ones: the per-season
        // floor is what pushes the total over if each season's budget is computed on its own.
        // Rating and points deliberately uncorrelated: the helper's `points = rating * 4`
        // makes both LTTB passes pick the same indices, which halves the big season's output
        // and hides the overshoot this test exists to catch.
        let mut points: Vec<_> = (0..5_000)
            .map(|i| RatingHistoryPoint {
                change_date: DateTime::from_timestamp(i as i64 * 60, 0).unwrap(),
                rating: Some(1500.0 + (i % 83) as f32),
                points: 6000.0 + ((i * 37) % 61) as f32,
                season_id: 1,
            })
            .collect();
        for season in 2..60 {
            let base = 1_000_000 + season as i64 * 1_000;
            points.push(point(base, 1600.0, season));
            points.push(point(base + 60, 1610.0, season));
        }

        let out = downsample_by_season(points, 400);
        assert!(
            out.len() <= 400,
            "produced {} points for a 400 budget",
            out.len()
        );
        // Every season still has to appear, or the chart silently loses one.
        let seasons: std::collections::HashSet<_> = out.iter().map(|p| p.season_id).collect();
        assert_eq!(seasons.len(), 59);
    }

    #[test]
    fn placement_games_survive_downsampling_without_a_rating() {
        // The head of a reset season is placement games: no rating, but their points are
        // public and still have to reach the chart. Only the rating pass skips them.
        let mut points: Vec<_> = (0..1_000)
            .map(|i| point(i as i64 * 60, 1500.0 + (i % 83) as f32, 1))
            .collect();
        for p in points.iter_mut().take(300) {
            p.rating = None;
        }

        let out = lttb(points, 100);
        assert!(out.len() <= 100);
        assert!(
            out.iter().any(|p| p.rating.is_none()),
            "every placement game was dropped",
        );
        assert!(out.iter().any(|p| p.rating.is_some()));
        // The series' endpoints still anchor the chart, rated or not.
        assert_eq!(out[0].change_date, DateTime::from_timestamp(0, 0).unwrap());
        assert_eq!(
            out[out.len() - 1].change_date,
            DateTime::from_timestamp(999 * 60, 0).unwrap()
        );
    }

    #[test]
    fn a_fully_unrated_history_still_downsamples() {
        // A player who never left placements: the rating pass has nothing to sample, and the
        // points pass alone has to carry the budget and the endpoints.
        let points: Vec<_> = (0..1_000)
            .map(|i| {
                let mut p = point(i as i64 * 60, 1500.0 + (i % 83) as f32, 1);
                p.rating = None;
                p
            })
            .collect();

        let out = downsample_by_season(points, 100);
        assert!(!out.is_empty());
        assert!(out.len() <= 100);
        assert!(out.iter().all(|p| p.rating.is_none()));
    }

    #[test]
    fn lttb_respects_the_budget() {
        let points: Vec<_> = (0..1_000)
            .map(|i| point(i as i64 * 60, 1500.0 + (i % 97) as f32, 1))
            .collect();
        assert!(lttb(points, 100).len() <= 100);
    }
}
