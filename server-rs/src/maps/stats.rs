use std::collections::{BTreeMap, HashMap};

use async_graphql::SimpleObject;
use chrono::{DateTime, Days, NaiveDate, Utc, Weekday};
use color_eyre::eyre::{self, WrapErr};
use sqlx::PgPool;

use crate::games::GameType;
use crate::maps::SbMapId;
use crate::matchmaking::MatchmakingType;

/// The number of weeks `weeklyActivity` returns when not told otherwise.
pub const DEFAULT_ACTIVITY_WEEKS: i32 = 26;
/// The most weeks `weeklyActivity` returns.
const MAX_ACTIVITY_WEEKS: i32 = 104;
/// The number of days, including today, that `gameTypes90d` counts.
const GAME_TYPE_DAYS: u64 = 90;

/// Matchmaking results for one matchup on a map.
#[derive(SimpleObject, Clone, Debug, PartialEq, Eq)]
pub struct MapMatchupStats {
    /// The map, season (or `all`), matchmaking type and matchup, unique across all matchups.
    pub id: String,
    /// The races on each side, as a canonical matchup string: each side's races sorted, the
    /// sides sorted, joined with `-` (e.g. `p-z`, `pt-tz`).
    pub matchup: String,
    /// The number of decided games played in this matchup.
    pub games: i32,
    /// Games won by the races on the left of `matchup`. Always 0 for mirror matchups.
    pub left_wins: i32,
    /// Games won by the races on the right of `matchup`. Always 0 for mirror matchups.
    pub right_wins: i32,
    /// The median game length in milliseconds for a single season. When summing seasons, the
    /// typical length (games-weighted mean of season medians), since medians can't be summed.
    pub median_length: Option<i32>,
}

/// A matchmaking season and type with matchup results on a map.
#[derive(SimpleObject, Clone, Debug)]
pub struct MapMatchupSeason {
    /// The map, season and matchmaking type, unique across all of these.
    pub id: String,
    pub season_id: i32,
    pub matchmaking_type: MatchmakingType,
    /// The number of decided games played in this season and type, across all matchups.
    pub games: i32,
}

/// The games played on a map in one week (starting Monday, UTC).
#[derive(SimpleObject, Clone, Debug, PartialEq, Eq)]
pub struct MapWeeklyActivity {
    /// The map and week, unique across all weeks of all maps.
    pub id: String,
    /// The start of the week: midnight UTC on its Monday.
    pub week_start: DateTime<Utc>,
    pub lobby_games: i32,
    pub matchmaking_games: i32,
}

/// The number of lobby games played on a map with one game type.
#[derive(SimpleObject, Clone, Debug)]
pub struct MapGameTypeCount {
    /// The map, period and game type, unique across all of these.
    pub id: String,
    pub game_type: GameType,
    pub games: i32,
}

/// One season's results for a matchup, as stored.
#[derive(Debug, Clone)]
struct SeasonMatchupRow {
    matchup: String,
    games: i32,
    left_wins: i32,
    right_wins: i32,
    median_length: i32,
}

/// A matchup's results summed over the rows given to [`combine_matchup_rows`].
#[derive(Debug, Clone, PartialEq, Eq)]
struct CombinedMatchup {
    matchup: String,
    games: i32,
    left_wins: i32,
    right_wins: i32,
    median_length: Option<i32>,
}

#[derive(Debug, Default)]
struct MatchupTotals {
    games: i64,
    left_wins: i64,
    right_wins: i64,
    weighted_length: i128,
    length_weight: i128,
}

fn saturate_i32(value: i64) -> i32 {
    i32::try_from(value).unwrap_or(if value < 0 { i32::MIN } else { i32::MAX })
}

/// Sums season rows per matchup. The combined length is the games-weighted mean of the season
/// medians, rounded to the nearest millisecond, and `None` if no row has games to weigh it by.
/// Sorted by games (descending), then matchup.
fn combine_matchup_rows(rows: impl IntoIterator<Item = SeasonMatchupRow>) -> Vec<CombinedMatchup> {
    let mut totals = BTreeMap::<String, MatchupTotals>::new();
    for row in rows {
        let t = totals.entry(row.matchup).or_default();
        t.games += i64::from(row.games);
        t.left_wins += i64::from(row.left_wins);
        t.right_wins += i64::from(row.right_wins);
        if row.games > 0 {
            t.weighted_length += i128::from(row.median_length) * i128::from(row.games);
            t.length_weight += i128::from(row.games);
        }
    }

    let mut combined = totals
        .into_iter()
        .map(|(matchup, t)| {
            let median_length = (t.length_weight > 0).then(|| {
                // Round half away from zero
                let doubled = t.weighted_length * 2;
                let rounded = if doubled >= 0 {
                    (doubled + t.length_weight) / (t.length_weight * 2)
                } else {
                    (doubled - t.length_weight) / (t.length_weight * 2)
                };
                i32::try_from(rounded).unwrap_or(i32::MAX)
            });
            CombinedMatchup {
                matchup,
                games: saturate_i32(t.games),
                left_wins: saturate_i32(t.left_wins),
                right_wins: saturate_i32(t.right_wins),
                median_length,
            }
        })
        .collect::<Vec<_>>();
    combined.sort_by(|a, b| {
        b.games
            .cmp(&a.games)
            .then_with(|| a.matchup.cmp(&b.matchup))
    });
    combined
}

/// Loads a map's matchup results for a matchmaking type, in one season or summed over all of
/// them (`season_id` of `None`).
pub async fn load_matchups(
    db: &PgPool,
    map_id: SbMapId,
    matchmaking_type: MatchmakingType,
    season_id: Option<i32>,
) -> eyre::Result<Vec<MapMatchupStats>> {
    let rows = sqlx::query_as!(
        SeasonMatchupRow,
        r#"
            SELECT matchup, games, left_wins, right_wins, median_length
            FROM map_matchup_stats
            WHERE map_id = $1 AND matchmaking_type = $2
                AND ($3::integer IS NULL OR season_id = $3)
        "#,
        map_id as _,
        matchmaking_type as _,
        season_id,
    )
    .fetch_all(db)
    .await
    .wrap_err("Failed to load map matchup stats")?;

    let season = season_id.map_or_else(|| "all".to_string(), |s| s.to_string());
    Ok(combine_matchup_rows(rows)
        .into_iter()
        .map(|c| MapMatchupStats {
            id: format!(
                "{map_id}:{season}:{}:{}",
                matchmaking_type.as_str(),
                c.matchup
            ),
            matchup: c.matchup,
            games: c.games,
            left_wins: c.left_wins,
            right_wins: c.right_wins,
            median_length: c.median_length,
        })
        .collect())
}

/// Loads the seasons and matchmaking types a map has matchup results in, newest season first.
pub async fn load_matchup_seasons(
    db: &PgPool,
    map_id: SbMapId,
) -> eyre::Result<Vec<MapMatchupSeason>> {
    let rows = sqlx::query!(
        r#"
            SELECT season_id, matchmaking_type as "matchmaking_type: MatchmakingType",
                sum(games)::bigint as "games!"
            FROM map_matchup_stats
            WHERE map_id = $1
            GROUP BY season_id, matchmaking_type
            ORDER BY season_id DESC, matchmaking_type
        "#,
        map_id as _,
    )
    .fetch_all(db)
    .await
    .wrap_err("Failed to load map matchup seasons")?;

    Ok(rows
        .into_iter()
        .map(|row| MapMatchupSeason {
            id: format!(
                "{map_id}:{}:{}",
                row.season_id,
                row.matchmaking_type.as_str()
            ),
            season_id: row.season_id,
            matchmaking_type: row.matchmaking_type,
            games: saturate_i32(row.games),
        })
        .collect())
}

/// Limits a requested number of activity weeks to what `weeklyActivity` returns.
pub fn clamp_activity_weeks(weeks: i32) -> i32 {
    weeks.clamp(1, MAX_ACTIVITY_WEEKS)
}

/// The Mondays starting the `weeks` weeks up to and including the one containing `today`, oldest
/// first. `weeks` must already be clamped.
fn week_starts(today: NaiveDate, weeks: i32) -> Vec<NaiveDate> {
    let this_week = today.week(Weekday::Mon).first_day();
    (0..weeks)
        .rev()
        .filter_map(|ago| this_week.checked_sub_days(Days::new(7 * ago as u64)))
        .collect()
}

/// One entry per week in `starts`, with weeks missing from `games` (lobby, matchmaking) as zero.
fn fill_weeks(
    map_id: SbMapId,
    starts: &[NaiveDate],
    games: &HashMap<NaiveDate, (i32, i32)>,
) -> Vec<MapWeeklyActivity> {
    starts
        .iter()
        .map(|&start| {
            let (lobby_games, matchmaking_games) = games.get(&start).copied().unwrap_or_default();
            MapWeeklyActivity {
                id: format!("{map_id}:{start}"),
                week_start: start.and_time(chrono::NaiveTime::MIN).and_utc(),
                lobby_games,
                matchmaking_games,
            }
        })
        .collect()
}

/// Loads the games played on a map in each of the last `weeks` weeks (already clamped), oldest
/// first, including weeks without any.
pub async fn load_weekly_activity(
    db: &PgPool,
    map_id: SbMapId,
    weeks: i32,
    today: NaiveDate,
) -> eyre::Result<Vec<MapWeeklyActivity>> {
    let starts = week_starts(today, weeks);
    let Some(&first_week) = starts.first() else {
        return Ok(Vec::new());
    };
    // `day` is a UTC date; truncating it as a `timestamp` (not `timestamptz`) keeps the session
    // time zone out of which week it lands in.
    let rows = sqlx::query!(
        r#"
            SELECT date_trunc('week', day::timestamp)::date as "week_start!",
                COALESCE(sum(games) FILTER (WHERE game_source = 'LOBBY'), 0)::bigint
                    as "lobby_games!",
                COALESCE(sum(games) FILTER (WHERE game_source = 'MATCHMAKING'), 0)::bigint
                    as "matchmaking_games!"
            FROM map_stats_daily
            WHERE map_id = $1 AND day >= $2
            GROUP BY 1
        "#,
        map_id as _,
        first_week,
    )
    .fetch_all(db)
    .await
    .wrap_err("Failed to load map weekly activity")?;

    let games = rows
        .into_iter()
        .map(|row| {
            (
                row.week_start,
                (
                    saturate_i32(row.lobby_games),
                    saturate_i32(row.matchmaking_games),
                ),
            )
        })
        .collect::<HashMap<_, _>>();
    Ok(fill_weeks(map_id, &starts, &games))
}

/// Loads the number of lobby games played on a map with each game type over the 90 days up to
/// and including `today`, most played first.
pub async fn load_game_types_90d(
    db: &PgPool,
    map_id: SbMapId,
    today: NaiveDate,
) -> eyre::Result<Vec<MapGameTypeCount>> {
    let since = today
        .checked_sub_days(Days::new(GAME_TYPE_DAYS - 1))
        .unwrap_or(NaiveDate::MIN);
    let rows = sqlx::query!(
        r#"
            SELECT game_type, sum(games)::bigint as "games!"
            FROM map_stats_daily
            WHERE map_id = $1 AND game_source = 'LOBBY' AND day >= $2
            GROUP BY game_type
            ORDER BY 2 DESC, game_type
        "#,
        map_id as _,
        since,
    )
    .fetch_all(db)
    .await
    .wrap_err("Failed to load map game types")?;

    Ok(rows
        .into_iter()
        .filter_map(|row| {
            let Ok(game_type) = serde_json::from_value::<GameType>(serde_json::Value::String(
                row.game_type.clone(),
            )) else {
                tracing::warn!("Unknown game type in map_stats_daily: {}", row.game_type);
                return None;
            };
            Some(MapGameTypeCount {
                id: format!("{map_id}:90d:{}", row.game_type),
                game_type,
                games: saturate_i32(row.games),
            })
        })
        .collect())
}

#[cfg(test)]
mod tests {
    use uuid::Uuid;

    use super::*;

    fn row(matchup: &str, games: i32, left: i32, right: i32, median: i32) -> SeasonMatchupRow {
        SeasonMatchupRow {
            matchup: matchup.into(),
            games,
            left_wins: left,
            right_wins: right,
            median_length: median,
        }
    }

    fn combine(rows: Vec<SeasonMatchupRow>) -> Vec<(String, i32, i32, i32, Option<i32>)> {
        combine_matchup_rows(rows)
            .into_iter()
            .map(|c| {
                (
                    c.matchup,
                    c.games,
                    c.left_wins,
                    c.right_wins,
                    c.median_length,
                )
            })
            .collect()
    }

    fn date(y: i32, m: u32, d: u32) -> NaiveDate {
        NaiveDate::from_ymd_opt(y, m, d).unwrap()
    }

    #[test]
    fn single_season_passes_through() {
        let combined = combine(vec![
            row("p-z", 30, 18, 12, 600_000),
            row("t-z", 50, 20, 30, 720_000),
            row("z-z", 10, 0, 0, 300_000),
        ]);
        assert_eq!(
            combined,
            [
                ("t-z".into(), 50, 20, 30, Some(720_000)),
                ("p-z".into(), 30, 18, 12, Some(600_000)),
                ("z-z".into(), 10, 0, 0, Some(300_000)),
            ]
        );
    }

    #[test]
    fn seasons_sum_with_games_weighted_length() {
        let combined = combine(vec![
            // Season 1
            row("p-z", 10, 6, 4, 600_000),
            row("t-z", 5, 2, 3, 700_000),
            // Season 2
            row("p-z", 30, 14, 16, 800_000),
            // Season 3
            row("p-z", 1, 1, 0, 1),
        ]);
        // (10 * 600000 + 30 * 800000 + 1 * 1) / 41 = 731707.34
        assert_eq!(
            combined,
            [
                ("p-z".into(), 41, 21, 20, Some(731_707)),
                ("t-z".into(), 5, 2, 3, Some(700_000)),
            ]
        );
    }

    #[test]
    fn weighted_length_rounds_half_up() {
        let combined = combine(vec![row("p-t", 1, 1, 0, 1), row("p-t", 1, 0, 1, 2)]);
        assert_eq!(combined[0].4, Some(2));
    }

    #[test]
    fn length_is_none_without_games() {
        let combined = combine(vec![row("p-t", 0, 0, 0, 500)]);
        assert_eq!(combined, [("p-t".into(), 0, 0, 0, None)]);
    }

    #[test]
    fn ties_sort_by_matchup() {
        let combined = combine(vec![row("t-z", 5, 0, 0, 1), row("p-t", 5, 0, 0, 1)]);
        assert_eq!(combined[0].0, "p-t");
        assert_eq!(combined[1].0, "t-z");
    }

    #[test]
    fn activity_weeks_are_clamped() {
        assert_eq!(clamp_activity_weeks(0), 1);
        assert_eq!(clamp_activity_weeks(-5), 1);
        assert_eq!(clamp_activity_weeks(26), 26);
        assert_eq!(clamp_activity_weeks(104), 104);
        assert_eq!(clamp_activity_weeks(105), 104);
        assert_eq!(clamp_activity_weeks(i32::MAX), 104);
    }

    #[test]
    fn week_starts_end_with_the_current_week() {
        // 2026-10-19 is a Monday, 2026-10-25 a Sunday
        for today in [date(2026, 10, 19), date(2026, 10, 22), date(2026, 10, 25)] {
            assert_eq!(
                week_starts(today, 3),
                [date(2026, 10, 5), date(2026, 10, 12), date(2026, 10, 19)],
                "{today}"
            );
        }
        assert_eq!(week_starts(date(2026, 10, 18), 1), [date(2026, 10, 12)]);
        // ISO weeks cross year boundaries: 2027-01-01 is a Friday
        assert_eq!(week_starts(date(2027, 1, 1), 1), [date(2026, 12, 28)]);
        assert_eq!(week_starts(date(2026, 10, 19), 104).len(), 104);
    }

    #[test]
    fn weeks_without_games_are_zero() {
        let map_id = SbMapId(Uuid::nil());
        let starts = week_starts(date(2026, 10, 21), 3);
        let games = HashMap::from([(date(2026, 10, 12), (4, 7))]);
        let filled = fill_weeks(map_id, &starts, &games);
        let summary = filled
            .iter()
            .map(|w| {
                (
                    w.id.as_str(),
                    w.week_start.to_rfc3339(),
                    w.lobby_games,
                    w.matchmaking_games,
                )
            })
            .collect::<Vec<_>>();
        assert_eq!(
            summary,
            [
                (
                    "00000000-0000-0000-0000-000000000000:2026-10-05",
                    "2026-10-05T00:00:00+00:00".to_string(),
                    0,
                    0
                ),
                (
                    "00000000-0000-0000-0000-000000000000:2026-10-12",
                    "2026-10-12T00:00:00+00:00".to_string(),
                    4,
                    7
                ),
                (
                    "00000000-0000-0000-0000-000000000000:2026-10-19",
                    "2026-10-19T00:00:00+00:00".to_string(),
                    0,
                    0
                ),
            ]
        );
    }
}
