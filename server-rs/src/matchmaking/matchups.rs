//! Race-matchup records for a user in a matchmaking mode, for the profile's Matchups page.
//!
//! The whole problem here is "which side was the viewer on". `games.assigned_matchup` can't say:
//! [`computeMatchupString`] sorts the races within each team and then sorts the teams, so `p-z`
//! and `z-p` are the same string, and in `pt-pz` a player who went Protoss could be on either
//! side. It records which two compositions met, not who was where.
//!
//! `games_users.team` answers it, so both sides are rebuilt from a game's rows grouped by that
//! column and `assigned_matchup` is never read. That's the whole answer rather than a shortcut
//! around combining the two columns: the team index is deliberately *not* a side of the matchup
//! string (`computeMatchupString` sorts the teams before joining them, so team 0 isn't reliably
//! the left half), so pairing them up would mean undoing that sort — while the rows already carry
//! every participant's team and race, which is strictly more than the string holds.
//!
//! Reading it this way costs one row per participant instead of one per game, so a 3v3 history
//! fetches six times the rows a 1v1 one does. That's the shape of the question: the opponents'
//! races are the answer, and they live on their own rows.
//!
//! The set of games comes from `matchmaking_rating_changes` rather than from `games.config`.
//! Its primary key is `(user_id, matchmaking_type, game_id)`, so "this user's games in this mode"
//! is an index prefix scan; identifying matchmaking games through the config jsonb instead would
//! mean fetching a wide row for every game the user has ever played.

use std::collections::HashMap;

use async_graphql::dataloader::DataLoader;
use async_graphql::{ComplexObject, Context, Object, Result, SimpleObject};
use chrono::{DateTime, Utc};
use color_eyre::eyre::Context as _;
use deadpool_redis::redis::AsyncCommands;
use serde::{Deserialize, Serialize};
use sqlx::PgPool;
use uuid::Uuid;

use crate::games::AssignedRace;
use crate::maps::{MapFile, MapsLoader, SbMapId};
use crate::matchmaking::MatchmakingType;
use crate::matchmaking::history::{MatchmakingSeason, fetch_seasons, season_for};
use crate::redis::RedisPool;
use crate::users::SbUserId;

#[derive(Default)]
pub struct MatchmakingMatchupsQuery;

#[Object]
impl MatchmakingMatchupsQuery {
    /// A user's record split by race matchup, for one matchmaking mode.
    ///
    /// Returned as flat buckets keyed by season, map and the two sides rather than as a
    /// pre-aggregated matrix: the page filters by season and by map, and every such filter is a
    /// sum over a subset of these buckets. Sending them once lets the filters resolve locally
    /// instead of re-querying, and the bucket count is bounded by seasons x maps x cells rather
    /// than by games played, so it doesn't grow with the length of an account's history.
    async fn user_matchup_stats(
        &self,
        ctx: &Context<'_>,
        user_id: SbUserId,
        matchmaking_type: MatchmakingType,
    ) -> Result<MatchupStats> {
        let db = ctx.data::<PgPool>()?;
        let seasons = fetch_seasons(db)
            .await
            .wrap_err("Failed to fetch matchmaking seasons")?;

        // One row per participant, not per game: the join to `games_users` is on the game alone,
        // so a game brings back its whole roster and the opposing side's races come back with it.
        //
        // `team`, `assigned_race` and the participant's rating are all nullable and are fetched as
        // they are rather than filtered here, because a usable game needs *every* one of its rows
        // to be readable. A SQL filter would silently shrink a side instead of dropping the game,
        // so the checks all live in `viewer_sides` where they can be tested together.
        //
        // `pmrc.rating` is the rating a player came *out* of the game with, so the rating they
        // went in on -- which is what the game's bracket should be measured by -- is that minus
        // the change. The join is a direct hit on `matchmaking_rating_changes`' primary key.
        let rows = sqlx::query!(
            r#"
                SELECT
                    mrc.game_id AS "game_id!",
                    g.map_id AS "map_id!: SbMapId",
                    m.name AS "map_name!",
                    mrc.change_date AT TIME ZONE 'UTC' AS "change_date!: DateTime<Utc>",
                    mrc.outcome::text AS "outcome!",
                    gu.user_id AS "player_id!: SbUserId",
                    gu.team,
                    gu.assigned_race::text AS assigned_race,
                    (pmrc.rating - pmrc.rating_change) AS pre_game_rating
                FROM matchmaking_rating_changes mrc
                JOIN games g ON g.id = mrc.game_id
                JOIN games_users gu ON gu.game_id = mrc.game_id
                JOIN uploaded_maps m ON m.id = g.map_id
                LEFT JOIN matchmaking_rating_changes pmrc
                    ON pmrc.user_id = gu.user_id
                    AND pmrc.matchmaking_type = mrc.matchmaking_type
                    AND pmrc.game_id = gu.game_id
                WHERE mrc.user_id = $1
                    AND mrc.matchmaking_type = $2
            "#,
            user_id.0,
            matchmaking_type as MatchmakingType,
        )
        .fetch_all(db)
        .await
        .wrap_err("Failed to fetch matchup stats")?;

        let rows = rows
            .into_iter()
            .map(|row| MatchupRow {
                game_id: row.game_id,
                map_id: row.map_id,
                map_name: row.map_name,
                change_date: row.change_date,
                outcome: row.outcome,
                player_id: row.player_id,
                team: row.team,
                assigned_race: row.assigned_race,
                pre_game_rating: row.pre_game_rating,
            })
            .collect();

        Ok(aggregate(rows, user_id, &seasons, matchmaking_type))
    }

    /// The same matrix computed across every player in a mode, for comparing a record against the
    /// ladder at large.
    ///
    /// The payload has the same shape as [`Self::user_matchup_stats`] — same buckets, same maps,
    /// same band grid — so the page filters it with exactly the same code. One thing differs:
    /// **every game is counted once per participant**, from that participant's side. A PvZ game
    /// adds one to PvZ and one to ZvP, which is what makes the matrix readable from either end and
    /// makes each cell's win rate the win rate of playing that side.
    ///
    /// Unlike the per-user query this reads every rated game in the mode, so it's aggregated in
    /// SQL rather than in memory and the result is cached — see [`GLOBAL_CACHE_TTL_SECONDS`].
    ///
    /// Bucket count is seasons x maps x cells x bands, which for the widest mode has a large
    /// theoretical ceiling. In practice it stays far under it: compositions cluster, and most
    /// (map, band, season) combinations never see most cells. If a mode ever does approach the
    /// ceiling, the fix is to take the season and map as arguments and filter in SQL rather than
    /// to drop a dimension — the client would refetch on those two filters instead of resolving
    /// them locally.
    async fn global_matchup_stats(
        &self,
        ctx: &Context<'_>,
        matchmaking_type: MatchmakingType,
    ) -> Result<MatchupStats> {
        let redis = ctx.data::<RedisPool>()?;
        let key = global_cache_key(matchmaking_type);

        // A cache read that fails for any reason falls through to computing it, since a slow
        // answer beats an error.
        if let Ok(mut conn) = redis.get().await
            && let Ok(Some(cached)) = conn.get::<_, Option<String>>(&key).await
            && let Ok(stats) = serde_json::from_str::<MatchupStats>(&cached)
        {
            return Ok(stats);
        }

        let db = ctx.data::<PgPool>()?;
        let stats = compute_global(db, matchmaking_type).await?;

        if let Ok(mut conn) = redis.get().await
            && let Ok(payload) = serde_json::to_string(&stats)
        {
            let _: std::result::Result<(), _> = conn
                .set_ex::<_, _, ()>(&key, payload, GLOBAL_CACHE_TTL_SECONDS)
                .await
                .inspect_err(|e| tracing::warn!("Failed to cache global matchup stats: {e:?}"));
        }

        Ok(stats)
    }
}

/// How long a computed global matrix is served from Redis before it's recomputed.
///
/// The aggregation reads every rated game in the mode, so this is what keeps it from being a full
/// scan per page view. Ten minutes is chosen against what the number is *for*: a ladder-wide race
/// win rate moves imperceptibly over that window, so serving a slightly stale one costs nothing a
/// reader would notice.
///
/// This is the tactical answer, not the durable one. If the ladder grows to where a scan every ten
/// minutes is itself too much, the shape that scales is counters maintained at game reconciliation
/// — the same approach the ladder ranks already take with Redis sorted sets — which turns this
/// into a read instead of an aggregation.
const GLOBAL_CACHE_TTL_SECONDS: u64 = 600;

fn global_cache_key(matchmaking_type: MatchmakingType) -> String {
    format!("matchups:global:{}", matchmaking_type.as_str())
}

/// Aggregates the global matrix in SQL, returning one row per (season, cell, band).
///
/// Grouped in the database rather than in memory because the input is every rated game in the
/// mode: the output is bounded by the matrix's own size, while the input is not.
async fn compute_global(db: &PgPool, matchmaking_type: MatchmakingType) -> Result<MatchupStats> {
    let team_size = matchmaking_type.team_size() as i64;

    let rows = sqlx::query!(
        r#"
            WITH mode_games AS (
                SELECT DISTINCT game_id
                FROM matchmaking_rating_changes
                WHERE matchmaking_type = $1
            ),
            -- The full roster, read from `games_users` and only *joined* to the rating rows.
            -- Building it out of `matchmaking_rating_changes` instead would make a participant
            -- with no rating row invisible, which doesn't merely lose their rating -- it shrinks
            -- the side they were on and silently changes what matchup the game was.
            roster AS (
                SELECT
                    gu.game_id,
                    gu.user_id,
                    gu.team,
                    gu.assigned_race::text AS race,
                    (mrc.rating - mrc.rating_change) AS pre_rating
                FROM games_users gu
                JOIN mode_games mg ON mg.game_id = gu.game_id
                LEFT JOIN matchmaking_rating_changes mrc
                    ON mrc.game_id = gu.game_id
                    AND mrc.user_id = gu.user_id
                    AND mrc.matchmaking_type = $1
                WHERE gu.team IS NOT NULL
                    AND gu.assigned_race IS NOT NULL
            ),
            -- `avg` skips nulls, which is the same "average whoever we can read" rule
            -- `game_rating_band` applies on the per-user path.
            game_info AS (
                SELECT game_id, avg(pre_rating) AS mean_rating, count(*) AS roster_n
                FROM roster
                GROUP BY game_id
            ),
            seasons AS (
                SELECT
                    id,
                    start_date,
                    lead(start_date) OVER (ORDER BY start_date) AS end_date
                FROM matchmaking_seasons
            ),
            -- One perspective per rated participant: they supply the outcome and the team that
            -- decides which half of the roster is "own".
            viewers AS (
                SELECT mrc.game_id, mrc.user_id, mrc.outcome, mrc.change_date, r.team
                FROM matchmaking_rating_changes mrc
                JOIN roster r ON r.game_id = mrc.game_id AND r.user_id = mrc.user_id
                WHERE mrc.matchmaking_type = $1
            ),
            sides AS (
                SELECT
                    v.game_id,
                    v.user_id,
                    v.outcome,
                    v.change_date,
                    array_agg(o.race ORDER BY
                        CASE o.race WHEN 't' THEN 0 WHEN 'p' THEN 1 ELSE 2 END)
                        FILTER (WHERE o.team = v.team) AS own,
                    array_agg(o.race ORDER BY
                        CASE o.race WHEN 't' THEN 0 WHEN 'p' THEN 1 ELSE 2 END)
                        FILTER (WHERE o.team <> v.team) AS opp,
                    count(*) FILTER (WHERE o.team = v.team) AS own_n,
                    count(*) FILTER (WHERE o.team <> v.team) AS opp_n,
                    count(DISTINCT o.team) AS teams
                FROM viewers v
                JOIN roster o ON o.game_id = v.game_id
                GROUP BY v.game_id, v.user_id, v.outcome, v.change_date, v.team
            )
            SELECT
                se.id AS "season_id!",
                g.map_id AS "map_id!: SbMapId",
                m.name AS "map_name!",
                s.own AS "own!: Vec<String>",
                s.opp AS "opp!: Vec<String>",
                GREATEST($3, LEAST($4, floor(gi.mean_rating / $5) * $5))::int AS "rating_band!",
                count(*) AS "games!",
                count(*) FILTER (WHERE s.outcome = 'win') AS "wins!"
            FROM sides s
            JOIN game_info gi ON gi.game_id = s.game_id
            JOIN games g ON g.id = s.game_id
            JOIN uploaded_maps m ON m.id = g.map_id
            JOIN seasons se
                ON s.change_date >= se.start_date
                AND (se.end_date IS NULL OR s.change_date < se.end_date)
            WHERE s.own_n = $2
                AND s.opp_n = $2
                AND s.teams = 2
                AND gi.roster_n = $2 * 2
                -- Nobody in the game had a readable rating, so there's no band to place it in.
                AND gi.mean_rating IS NOT NULL
            GROUP BY 1, 2, 3, 4, 5, 6
        "#,
        matchmaking_type as MatchmakingType,
        team_size,
        RATING_BAND_MIN as f64,
        RATING_BAND_MAX as f64,
        RATING_BAND_SIZE as f64,
    )
    .fetch_all(db)
    .await
    .wrap_err("Failed to aggregate global matchup stats")?;

    let mut buckets = Vec::with_capacity(rows.len());
    let mut map_names: HashMap<SbMapId, String> = HashMap::new();
    let mut total_games = 0i32;
    for row in rows {
        // A side the aggregation can't read shouldn't happen -- the query filters nulls out of
        // `roster` before they can reach here -- but it's dropped rather than guessed at,
        // matching the per-user path.
        let (Some(races), Some(opponent_races)) = (parse_side(&row.own), parse_side(&row.opp))
        else {
            continue;
        };
        let games = row.games as i32;
        total_games += games;
        map_names.entry(row.map_id).or_insert(row.map_name);
        buckets.push(MatchupBucket {
            season_id: row.season_id,
            map_id: row.map_id,
            races,
            opponent_races,
            rating_band: row.rating_band,
            games,
            wins: row.wins as i32,
        });
    }

    buckets.sort_unstable_by_key(|b| {
        (
            b.season_id,
            b.map_id.0,
            side_order(&b.races),
            side_order(&b.opponent_races),
            b.rating_band,
        )
    });

    let mut maps: Vec<MatchupMap> = map_names
        .into_iter()
        .map(|(id, name)| MatchupMap { id, name })
        .collect();
    maps.sort_unstable_by(|a, b| a.name.cmp(&b.name).then(a.id.0.cmp(&b.id.0)));

    Ok(MatchupStats::new(
        matchmaking_type,
        total_games,
        buckets,
        maps,
    ))
}

/// One side as the global aggregation spells it: race letters already in TPZ order.
fn parse_side(races: &[String]) -> Option<Vec<AssignedRace>> {
    if races.is_empty() {
        return None;
    }
    races.iter().map(|r| parse_race(r)).collect()
}

/// One participant in one of the viewer's games, as the aggregation reads it.
///
/// The game-level columns (`map_id`, `change_date`, `outcome`) come from the viewer's own rating
/// change and so repeat identically across a game's rows; only `player_id`, `team` and
/// `assigned_race` vary. Values stay as the database spelled them, nulls included, so that
/// parsing — and the decisions about what to drop — all happen in one tested place.
#[derive(Debug, Clone)]
struct MatchupRow {
    game_id: Uuid,
    map_id: SbMapId,
    map_name: String,
    change_date: DateTime<Utc>,
    /// The *viewer's* result, which is what a bucket's wins count.
    outcome: String,
    player_id: SbUserId,
    team: Option<i16>,
    assigned_race: Option<String>,
    /// This participant's rating going *into* the game. Averaged across the roster to place the
    /// game in a rating band.
    pre_game_rating: Option<f32>,
}

/// Folds participant rows into per-(season, map, matchup) buckets.
///
/// A game whose sides can't be reconstructed is dropped rather than counted, including from
/// `total_games`: it can't be placed in any cell, so counting it would make the buckets fail to
/// sum to the total the page displays.
fn aggregate(
    rows: Vec<MatchupRow>,
    viewer: SbUserId,
    seasons: &[MatchmakingSeason],
    matchmaking_type: MatchmakingType,
) -> MatchupStats {
    // Regrouped by game because a side is a property of the whole roster: no single row knows
    // who the viewer's allies were.
    let mut games: HashMap<Uuid, Vec<MatchupRow>> = HashMap::new();
    for row in rows {
        games.entry(row.game_id).or_default().push(row);
    }

    let mut counts: HashMap<BucketKey, MutableBucket> = HashMap::new();
    let mut map_names: HashMap<SbMapId, String> = HashMap::new();
    let mut total_games = 0i32;

    for players in games.into_values() {
        let Some((races, opponent_races)) =
            viewer_sides(&players, viewer, matchmaking_type.team_size())
        else {
            continue;
        };
        let Some(band) = game_rating_band(&players) else {
            continue;
        };
        // Every row of a game carries the same game-level values, so the first one will do.
        let game = &players[0];

        total_games += 1;
        map_names
            .entry(game.map_id)
            .or_insert_with(|| game.map_name.clone());

        let bucket = counts
            .entry(BucketKey {
                season_id: season_for(seasons, game.change_date),
                map_id: game.map_id,
                races,
                opponent_races,
                rating_band: band,
            })
            .or_default();
        bucket.games += 1;
        if game.outcome == "win" {
            bucket.wins += 1;
        }
    }

    let mut buckets: Vec<MatchupBucket> = counts
        .into_iter()
        .map(|(key, value)| MatchupBucket {
            season_id: key.season_id,
            map_id: key.map_id,
            races: key.races,
            opponent_races: key.opponent_races,
            rating_band: key.rating_band,
            games: value.games,
            wins: value.wins,
        })
        .collect();
    // A stable order so the payload doesn't churn between requests for the same data, which
    // would defeat client-side caching and make responses pointlessly hard to diff. HashMap
    // iteration order is arbitrary and varies run to run, so this isn't cosmetic.
    buckets.sort_unstable_by_key(|b| {
        (
            b.season_id,
            b.map_id.0,
            side_order(&b.races),
            side_order(&b.opponent_races),
            b.rating_band,
        )
    });

    // By name, since that's how the map filter lists them.
    let mut maps: Vec<MatchupMap> = map_names
        .into_iter()
        .map(|(id, name)| MatchupMap { id, name })
        .collect();
    maps.sort_unstable_by(|a, b| a.name.cmp(&b.name).then(a.id.0.cmp(&b.id.0)));

    MatchupStats::new(matchmaking_type, total_games, buckets, maps)
}

/// Width of a rating band, and the range they're clamped into.
///
/// 100 points is fine enough to separate skill levels a player would actually distinguish, at the
/// cost of a smaller sample per band — the matrix already dims a thin cell, so a sparse band shows
/// as sparse rather than misleading. The clamp keeps the band count fixed at fifteen regardless of
/// how far the tails stretch: everything at or below [`RATING_BAND_MIN`] shares the bottom band and
/// everything at or above [`RATING_BAND_MAX`] shares the top one, so an outlier can't add a band
/// nobody else is in.
pub const RATING_BAND_SIZE: i32 = 100;
pub const RATING_BAND_MIN: i32 = 1000;
pub const RATING_BAND_MAX: i32 = 2400;

/// The band a game belongs to, from the mean rating its participants brought into it.
///
/// The mean rather than the viewer's own or their opponent's: it's the one measure that means the
/// same thing in a solo game, a team game, and the global matrix, where there is no viewer to take
/// a side from. Matchmaking pairs close ratings, so in practice it tracks the opponent's rating
/// closely anyway.
fn rating_band(mean_rating: f64) -> i32 {
    let floored = (mean_rating / RATING_BAND_SIZE as f64).floor() as i32 * RATING_BAND_SIZE;
    floored.clamp(RATING_BAND_MIN, RATING_BAND_MAX)
}

#[derive(Debug, Clone, PartialEq, Eq, Hash)]
struct BucketKey {
    season_id: i32,
    map_id: SbMapId,
    races: Vec<AssignedRace>,
    opponent_races: Vec<AssignedRace>,
    rating_band: i32,
}

#[derive(Debug, Default, Clone, Copy)]
struct MutableBucket {
    games: i32,
    wins: i32,
}

#[derive(SimpleObject, Serialize, Deserialize, Debug, Clone)]
pub struct MatchupBucket {
    /// The season the games fell in, derived from each game's `change_date` the same way the
    /// rating history derives it.
    pub season_id: i32,
    pub map_id: SbMapId,
    /// The races on the viewed player's side, after random is resolved, in TPZ order within the
    /// side.
    ///
    /// A list rather than a single race because a side is a team composition: 2v2 cells are `tp`
    /// against `pz` and so on, which is how the client's matrix keys its axes. For a solo mode it
    /// holds exactly one race. Who played which race isn't recorded, deliberately — that's what
    /// keeps a 3v3 matrix at 10x10 instead of 27x27.
    pub races: Vec<AssignedRace>,
    /// The opposing side's composition, same encoding as `races`.
    pub opponent_races: Vec<AssignedRace>,
    /// Lower edge of the rating band these games fell in, `RATING_BAND_SIZE` wide and clamped
    /// into `[RATING_BAND_MIN, RATING_BAND_MAX]`. The bottom band is "this and below" and the top
    /// is "this and above", so the range filter never has to reason about open ends.
    pub rating_band: i32,
    pub games: i32,
    /// Wins out of `games`. Matchmaking records only wins and losses, so `games - wins` is the
    /// loss count exactly.
    pub wins: i32,
}

#[derive(SimpleObject, Serialize, Deserialize, Debug, Clone)]
#[graphql(complex)]
pub struct MatchupMap {
    pub id: SbMapId,
    pub name: String,
}

#[ComplexObject]
impl MatchupMap {
    /// The map's file, which is where its preview images live.
    ///
    /// Resolved through the shared map loaders rather than fetched alongside the buckets: the
    /// image URLs are built in exactly one place (`MapFile`), it batches with every other map on
    /// the page, and the buckets stay a pure aggregation with nothing to serialize into the
    /// global cache.
    ///
    /// Never fails the query. This field exists to draw a thumbnail next to a record; a map whose
    /// file is missing — or whose row won't decode — should cost the picture, not the numbers the
    /// page is actually for. Failures are logged rather than swallowed silently, since a map file
    /// that can't be read is worth knowing about even though it isn't worth an error here.
    async fn map_file(&self, ctx: &Context<'_>) -> Result<Option<MapFile>> {
        let loader = ctx.data_unchecked::<DataLoader<MapsLoader>>();
        let uploaded = match loader.load_one(self.id).await {
            Ok(Some(uploaded)) => uploaded,
            Ok(None) => return Ok(None),
            Err(e) => {
                tracing::warn!("Failed to load map {:?} for matchup stats: {e:?}", self.id);
                return Ok(None);
            }
        };
        match loader.load_one(uploaded.map_hash).await {
            Ok(file) => Ok(file.map(|f| f.into())),
            Err(e) => {
                tracing::warn!(
                    "Failed to load map file for {:?} in matchup stats: {e:?}",
                    self.id
                );
                Ok(None)
            }
        }
    }
}

#[derive(SimpleObject, Serialize, Deserialize, Debug, Clone)]
pub struct MatchupStats {
    pub matchmaking_type: MatchmakingType,
    /// Games attributed to a matchup, which is the sum of every bucket's `games`. Lower than the
    /// mode's total game count where a game predates the `games_users.team` backfill or was never
    /// reconciled, since neither can be placed in a cell.
    pub total_games: i32,
    pub buckets: Vec<MatchupBucket>,
    /// Every map appearing in `buckets`, so the page's map filter can label itself without a
    /// second request and without the name being repeated on each bucket.
    ///
    pub maps: Vec<MatchupMap>,
    /// The band grid the buckets are placed on, so the rating filter can lay out its scale from
    /// the payload instead of hard-coding numbers that would then have two homes.
    pub rating_band_size: i32,
    pub min_rating_band: i32,
    pub max_rating_band: i32,
}

impl MatchupStats {
    fn new(
        matchmaking_type: MatchmakingType,
        total_games: i32,
        buckets: Vec<MatchupBucket>,
        maps: Vec<MatchupMap>,
    ) -> Self {
        Self {
            matchmaking_type,
            total_games,
            buckets,
            maps,
            rating_band_size: RATING_BAND_SIZE,
            min_rating_band: RATING_BAND_MIN,
            max_rating_band: RATING_BAND_MAX,
        }
    }
}

/// The rating band for one game, from the mean rating its participants brought in.
///
/// Averages over whoever *has* a rating rather than requiring the whole roster, and only gives up
/// when nobody does. That's the opposite of how an unreadable team is treated, deliberately: a
/// missing team makes the game unplaceable in any cell, while a missing rating only makes its band
/// less precise. Dropping the game would trade the matrix's primary number — the win rate of a
/// matchup — to protect a filter dimension, which is backwards.
///
/// The degradation is also the right shape. Matchmaking pairs close ratings, so a mean taken over
/// the participants that are readable sits near the mean over all of them.
fn game_rating_band(players: &[MatchupRow]) -> Option<i32> {
    let mut sum = 0f64;
    let mut rated = 0usize;
    for player in players {
        if let Some(rating) = player.pre_game_rating {
            sum += rating as f64;
            rated += 1;
        }
    }
    if rated == 0 {
        return None;
    }
    Some(rating_band(sum / rated as f64))
}

fn parse_race(race: &str) -> Option<AssignedRace> {
    match race {
        "z" => Some(AssignedRace::Zerg),
        "t" => Some(AssignedRace::Terran),
        "p" => Some(AssignedRace::Protoss),
        // 'r' is never stored here -- `assigned_race` is written at reconciliation and is the
        // race actually played -- so this is unreachable rather than a case with a meaning.
        _ => None,
    }
}

/// Display and sort order for the matrix axes: Terran, Protoss, Zerg, the conventional listing
/// for Brood War rather than alphabetical.
fn race_order(race: AssignedRace) -> u8 {
    match race {
        AssignedRace::Terran => 0,
        AssignedRace::Protoss => 1,
        AssignedRace::Zerg => 2,
    }
}

/// The viewer's side and their opponents', as `(own, opponent)`, from one game's participant rows.
///
/// Works the same in every mode: the viewer's `team` names their side, every other row falls on
/// one side or the other by comparing against it, and a solo game is just the case where each
/// side holds one player.
///
/// Returns `None` for a game that can't be read as two even sides, which covers every way the
/// data can be incomplete rather than merely surprising:
///
/// - a row with no `team` (predates the column's backfill, or was written for a game with no
///   determinable teams) — never treated as team zero, per the column's contract;
/// - a row with no `assigned_race`, meaning the game was never reconciled;
/// - more than two teams, which isn't an "us and them" at all;
/// - sides that don't both hold `team_size` players, so a game missing a row can't be counted as
///   a lopsided matchup that never happened.
///
/// Dropping is the right answer for all of them: the alternative is inventing a record from an
/// incomplete roster.
fn viewer_sides(
    players: &[MatchupRow],
    viewer: SbUserId,
    team_size: usize,
) -> Option<(Vec<AssignedRace>, Vec<AssignedRace>)> {
    let viewer_team = players.iter().find(|p| p.player_id == viewer)?.team?;

    let mut own = Vec::with_capacity(team_size);
    let mut opponent = Vec::with_capacity(team_size);
    let mut opponent_team: Option<i16> = None;

    for player in players {
        let race = parse_race(player.assigned_race.as_deref()?)?;
        let team = player.team?;
        if team == viewer_team {
            own.push(race);
        } else {
            if *opponent_team.get_or_insert(team) != team {
                return None;
            }
            opponent.push(race);
        }
    }

    if own.len() != team_size || opponent.len() != team_size {
        return None;
    }

    // A side is identified by its composition, so the same team in a different seating order has
    // to produce the same bucket. TPZ rather than alphabetical, matching the order the matrix
    // draws its axes in, which makes `side_order` a straight read of the stored order.
    own.sort_unstable_by_key(|r| race_order(*r));
    opponent.sort_unstable_by_key(|r| race_order(*r));
    Some((own, opponent))
}

/// Sort key for a side: its races in TPZ order. Compositions of different sizes never share a
/// matrix, so comparing them by sequence is only ever exercised within one mode.
fn side_order(side: &[AssignedRace]) -> Vec<u8> {
    side.iter().copied().map(race_order).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    const MAP_A: Uuid = Uuid::from_u128(0x1111_1111);
    const MAP_B: Uuid = Uuid::from_u128(0x2222_2222);

    const VIEWER: SbUserId = SbUserId(1);

    const T: AssignedRace = AssignedRace::Terran;
    const P: AssignedRace = AssignedRace::Protoss;
    const Z: AssignedRace = AssignedRace::Zerg;

    fn seasons() -> Vec<MatchmakingSeason> {
        vec![
            MatchmakingSeason {
                id: 1,
                name: "Season 1".into(),
                start_date: DateTime::from_timestamp(0, 0).unwrap(),
                reset_mmr: true,
            },
            MatchmakingSeason {
                id: 2,
                name: "Season 2".into(),
                start_date: DateTime::from_timestamp(10_000, 0).unwrap(),
                reset_mmr: false,
            },
        ]
    }

    /// One game as the query returns it: a row per participant, each `(user_id, team,
    /// assigned_race)`. Both of the latter are `Option` so a test can spell a row the database
    /// left null, which is the shape most of the drop rules are about.
    /// The rating every fixture player brings in unless a test says otherwise. Lands in the 1500
    /// band, well inside the clamped range, so a test that isn't about banding never has to think
    /// about one.
    const DEFAULT_RATING: f32 = 1500.0;

    fn game(
        id: u128,
        secs: i64,
        map: Uuid,
        outcome: &str,
        players: &[(i32, Option<i16>, Option<&str>)],
    ) -> Vec<MatchupRow> {
        rated_game(id, secs, map, outcome, players, &[])
    }

    /// As [`game`], but with each player's pre-game rating given in order. A shorter `ratings`
    /// slice falls back to [`DEFAULT_RATING`], so a test only spells out the ones it cares about.
    fn rated_game(
        id: u128,
        secs: i64,
        map: Uuid,
        outcome: &str,
        players: &[(i32, Option<i16>, Option<&str>)],
        ratings: &[Option<f32>],
    ) -> Vec<MatchupRow> {
        players
            .iter()
            .enumerate()
            .map(|(i, &(user_id, team, race))| MatchupRow {
                game_id: Uuid::from_u128(id),
                map_id: SbMapId(map),
                map_name: if map == MAP_A { "Zzz A" } else { "Aaa B" }.into(),
                change_date: DateTime::from_timestamp(secs, 0).unwrap(),
                outcome: outcome.into(),
                player_id: SbUserId(user_id),
                team,
                assigned_race: race.map(Into::into),
                pre_game_rating: ratings.get(i).copied().unwrap_or(Some(DEFAULT_RATING)),
            })
            .collect()
    }

    /// A well-formed 1v1 the viewer played, which most of the aggregation tests are built from.
    fn solo(
        id: u128,
        secs: i64,
        map: Uuid,
        mine: &str,
        theirs: &str,
        outcome: &str,
    ) -> Vec<MatchupRow> {
        game(
            id,
            secs,
            map,
            outcome,
            &[(VIEWER.0, Some(0), Some(mine)), (2, Some(1), Some(theirs))],
        )
    }

    #[test]
    fn aggregate_groups_by_season_map_and_matchup() {
        // The same PvZ cell twice on one map, the reverse cell from the other side, a mirror, and
        // a game in a later season on a different map.
        let stats = aggregate(
            [
                solo(1, 100, MAP_A, "p", "z", "win"),
                solo(2, 200, MAP_A, "z", "p", "loss"),
                solo(3, 300, MAP_A, "p", "z", "loss"),
                solo(4, 400, MAP_A, "p", "p", "win"),
                solo(5, 20_000, MAP_B, "t", "z", "win"),
            ]
            .concat(),
            VIEWER,
            &seasons(),
            MatchmakingType::Match1v1,
        );

        assert_eq!(stats.total_games, 5);
        assert_eq!(stats.buckets.len(), 4);

        let find = |season: i32, race, opponent| {
            stats
                .buckets
                .iter()
                .find(|b| {
                    b.season_id == season
                        && b.races == vec![race]
                        && b.opponent_races == vec![opponent]
                })
                .unwrap_or_else(|| panic!("no bucket for season {season} {race:?}v{opponent:?}"))
        };

        // The two PvZ games collapse into one cell; the ZvP game is a different cell, not the
        // same one counted from the other side.
        let pvz = find(1, P, Z);
        assert_eq!((pvz.games, pvz.wins), (2, 1));
        let zvp = find(1, Z, P);
        assert_eq!((zvp.games, zvp.wins), (1, 0));
        let mirror = find(1, P, P);
        assert_eq!((mirror.games, mirror.wins), (1, 1));

        // Later season, and its own map.
        let tvz = find(2, T, Z);
        assert_eq!((tvz.games, tvz.wins), (1, 1));
        assert_eq!(tvz.map_id, SbMapId(MAP_B));
    }

    #[test]
    fn aggregate_reads_team_games_from_the_roster() {
        // The case `assigned_matchup` alone could never answer: the viewer went Protoss in a
        // `pt-pz`, and only their team says which of the two Protosses they were.
        let stats = aggregate(
            [
                game(
                    1,
                    100,
                    MAP_A,
                    "win",
                    &[
                        (VIEWER.0, Some(0), Some("p")),
                        (2, Some(0), Some("t")),
                        (3, Some(1), Some("p")),
                        (4, Some(1), Some("z")),
                    ],
                ),
                // The same four compositions with the viewer on the other side, which has to land
                // in the opposite cell rather than the same one.
                game(
                    2,
                    200,
                    MAP_A,
                    "loss",
                    &[
                        (VIEWER.0, Some(1), Some("p")),
                        (5, Some(1), Some("z")),
                        (6, Some(0), Some("p")),
                        (7, Some(0), Some("t")),
                    ],
                ),
            ]
            .concat(),
            VIEWER,
            &seasons(),
            MatchmakingType::Match2v2,
        );

        assert_eq!(stats.total_games, 2);
        assert_eq!(stats.buckets.len(), 2);

        let tp_vs_pz = stats
            .buckets
            .iter()
            .find(|b| b.races == vec![T, P] && b.opponent_races == vec![P, Z])
            .expect("no TP vs PZ bucket");
        assert_eq!((tp_vs_pz.games, tp_vs_pz.wins), (1, 1));

        let pz_vs_tp = stats
            .buckets
            .iter()
            .find(|b| b.races == vec![P, Z] && b.opponent_races == vec![T, P])
            .expect("no PZ vs TP bucket");
        assert_eq!((pz_vs_tp.games, pz_vs_tp.wins), (1, 0));
    }

    #[test]
    fn aggregate_drops_games_it_cannot_place_including_from_the_total() {
        // The page shows `totalGames` above a matrix built from the buckets. If a game that no
        // cell can hold still counted toward the total, the matrix would silently fail to sum
        // to the number printed above it.
        let stats = aggregate(
            [
                solo(1, 100, MAP_A, "p", "z", "win"),
                // Predates the `team` backfill.
                game(
                    2,
                    200,
                    MAP_A,
                    "win",
                    &[(VIEWER.0, None, Some("p")), (2, None, Some("z"))],
                ),
                // Never reconciled, so nobody has a race.
                game(
                    3,
                    300,
                    MAP_A,
                    "win",
                    &[(VIEWER.0, Some(0), None), (2, Some(1), None)],
                ),
                // Only the opponent's row is missing its race, which is still a game whose
                // matchup nobody can name.
                game(
                    4,
                    400,
                    MAP_A,
                    "win",
                    &[(VIEWER.0, Some(0), Some("p")), (2, Some(1), None)],
                ),
                // 'r' is never stored as an assigned race.
                solo(5, 500, MAP_A, "r", "z", "win"),
            ]
            .concat(),
            VIEWER,
            &seasons(),
            MatchmakingType::Match1v1,
        );

        assert_eq!(stats.total_games, 1);
        assert_eq!(stats.buckets.len(), 1);
        assert_eq!(stats.buckets[0].games, 1);
    }

    #[test]
    fn aggregate_orders_buckets_and_maps_deterministically() {
        // HashMap iteration order varies between runs, so without the sorts the payload would
        // differ for identical data.
        let rows = [
            solo(1, 20_000, MAP_B, "z", "p", "win"),
            solo(2, 100, MAP_A, "z", "z", "win"),
            solo(3, 100, MAP_A, "t", "z", "win"),
            solo(4, 100, MAP_A, "p", "z", "loss"),
        ]
        .concat();
        let first = aggregate(rows.clone(), VIEWER, &seasons(), MatchmakingType::Match1v1);
        let second = aggregate(rows, VIEWER, &seasons(), MatchmakingType::Match1v1);

        let key = |s: &MatchupStats| {
            s.buckets
                .iter()
                .map(|b| (b.season_id, b.map_id.0, side_order(&b.races)))
                .collect::<Vec<_>>()
        };
        assert_eq!(key(&first), key(&second));

        // Seasons ascending, then TPZ within a season rather than alphabetical.
        assert_eq!(
            key(&first),
            vec![
                (1, MAP_A, vec![race_order(T)]),
                (1, MAP_A, vec![race_order(P)]),
                (1, MAP_A, vec![race_order(Z)]),
                (2, MAP_B, vec![race_order(Z)]),
            ]
        );

        // Maps are listed by name, which is not their insertion or id order here.
        assert_eq!(
            first
                .maps
                .iter()
                .map(|m| m.name.as_str())
                .collect::<Vec<_>>(),
            vec!["Aaa B", "Zzz A"]
        );
    }

    #[test]
    fn aggregate_handles_an_empty_history() {
        let stats = aggregate(Vec::new(), VIEWER, &seasons(), MatchmakingType::Match1v1);
        assert_eq!(stats.total_games, 0);
        assert!(stats.buckets.is_empty());
        assert!(stats.maps.is_empty());
        // The band grid ships even when nothing else does -- the filter has to draw a scale
        // before it has anything to filter.
        assert_eq!(stats.rating_band_size, RATING_BAND_SIZE);
        assert_eq!(stats.min_rating_band, RATING_BAND_MIN);
        assert_eq!(stats.max_rating_band, RATING_BAND_MAX);
    }

    // ---- Rating bands --------------------------------------------------------------------

    #[test]
    fn rating_band_floors_to_the_band_below() {
        assert_eq!(rating_band(1600.0), 1600);
        assert_eq!(rating_band(1699.9), 1600);
        assert_eq!(rating_band(1700.0), 1700);
    }

    #[test]
    fn rating_band_clamps_both_tails_into_the_grid() {
        // The extremes share the end bands rather than adding bands of their own, which is what
        // keeps the filter's scale a fixed width no matter how far the ladder stretches.
        assert_eq!(rating_band(120.0), RATING_BAND_MIN);
        assert_eq!(rating_band(999.0), RATING_BAND_MIN);
        assert_eq!(rating_band(RATING_BAND_MIN as f64), RATING_BAND_MIN);
        assert_eq!(rating_band(4200.0), RATING_BAND_MAX);
        assert_eq!(rating_band(RATING_BAND_MAX as f64), RATING_BAND_MAX);
    }

    #[test]
    fn aggregate_bands_a_game_by_the_mean_of_its_roster() {
        // 1500 and 1900 average to 1700 -- not either player's own band. Taking the viewer's
        // rating alone would put this in 1500 and the opponent's in 1900.
        let stats = aggregate(
            rated_game(
                1,
                100,
                MAP_A,
                "win",
                &[(VIEWER.0, Some(0), Some("p")), (2, Some(1), Some("z"))],
                &[Some(1500.0), Some(1900.0)],
            ),
            VIEWER,
            &seasons(),
            MatchmakingType::Match1v1,
        );

        assert_eq!(stats.buckets.len(), 1);
        assert_eq!(stats.buckets[0].rating_band, 1700);
    }

    #[test]
    fn aggregate_splits_the_same_cell_across_bands() {
        // Two PvZ games at different skill levels are the same cell but different buckets, which
        // is the whole point: the range filter sums a subset of them.
        let stats = aggregate(
            [
                rated_game(
                    1,
                    100,
                    MAP_A,
                    "win",
                    &[(VIEWER.0, Some(0), Some("p")), (2, Some(1), Some("z"))],
                    &[Some(1250.0), Some(1250.0)],
                ),
                rated_game(
                    2,
                    200,
                    MAP_A,
                    "loss",
                    &[(VIEWER.0, Some(0), Some("p")), (3, Some(1), Some("z"))],
                    &[Some(2050.0), Some(2050.0)],
                ),
            ]
            .concat(),
            VIEWER,
            &seasons(),
            MatchmakingType::Match1v1,
        );

        assert_eq!(stats.total_games, 2);
        let bands: Vec<_> = stats.buckets.iter().map(|b| b.rating_band).collect();
        assert_eq!(bands, vec![1200, 2000]);
        // Same cell in both, so a filter spanning both bands sums to the pair.
        assert!(
            stats
                .buckets
                .iter()
                .all(|b| b.races == vec![P] && b.opponent_races == vec![Z])
        );
    }

    #[test]
    fn aggregate_bands_from_the_ratings_it_has() {
        // Only the viewer's rating is readable. The game still counts -- its cell is the number
        // the matrix exists to show, and a less precise band is a far smaller loss than a missing
        // game. 1900 alone bands as 1900.
        let stats = aggregate(
            rated_game(
                1,
                100,
                MAP_A,
                "win",
                &[(VIEWER.0, Some(0), Some("p")), (2, Some(1), Some("z"))],
                &[Some(1900.0), None],
            ),
            VIEWER,
            &seasons(),
            MatchmakingType::Match1v1,
        );

        assert_eq!(stats.total_games, 1);
        assert_eq!(stats.buckets.len(), 1);
        assert_eq!(stats.buckets[0].rating_band, 1900);
    }

    #[test]
    fn aggregate_drops_a_game_with_no_ratings_at_all() {
        // Nothing to average, so there's no band to put it in.
        let stats = aggregate(
            [
                solo(1, 100, MAP_A, "p", "z", "win"),
                rated_game(
                    2,
                    200,
                    MAP_A,
                    "win",
                    &[(VIEWER.0, Some(0), Some("p")), (2, Some(1), Some("z"))],
                    &[None, None],
                ),
            ]
            .concat(),
            VIEWER,
            &seasons(),
            MatchmakingType::Match1v1,
        );

        assert_eq!(stats.total_games, 1);
        assert_eq!(stats.buckets.len(), 1);
    }

    /// Runs one game's rows through `viewer_sides` for a mode of the given team size.
    fn sides(
        players: &[(i32, Option<i16>, Option<&str>)],
        team_size: usize,
    ) -> Option<(Vec<AssignedRace>, Vec<AssignedRace>)> {
        viewer_sides(&game(1, 100, MAP_A, "win", players), VIEWER, team_size)
    }

    #[test]
    fn viewer_sides_reads_the_other_side() {
        assert_eq!(
            sides(
                &[(VIEWER.0, Some(0), Some("p")), (2, Some(1), Some("z"))],
                1
            ),
            Some((vec![P], vec![Z]))
        );
        assert_eq!(
            sides(
                &[(VIEWER.0, Some(0), Some("z")), (2, Some(1), Some("p"))],
                1
            ),
            Some((vec![Z], vec![P]))
        );
    }

    #[test]
    fn viewer_sides_handles_mirrors() {
        assert_eq!(
            sides(
                &[(VIEWER.0, Some(0), Some("p")), (2, Some(1), Some("p"))],
                1
            ),
            Some((vec![P], vec![P]))
        );
        assert_eq!(
            sides(
                &[
                    (VIEWER.0, Some(0), Some("t")),
                    (2, Some(0), Some("z")),
                    (3, Some(1), Some("z")),
                    (4, Some(1), Some("t")),
                ],
                2,
            ),
            Some((vec![T, Z], vec![T, Z]))
        );
    }

    #[test]
    fn viewer_sides_ignores_the_team_index_itself() {
        // The team index is *not* a side of the matchup string -- `computeMatchupString` sorts the
        // teams before joining them -- so nothing here may depend on the viewer being team 0, or
        // on the rows arriving in team order.
        let as_team_one = sides(
            &[
                (3, Some(0), Some("p")),
                (VIEWER.0, Some(1), Some("t")),
                (4, Some(0), Some("z")),
                (2, Some(1), Some("t")),
            ],
            2,
        );
        assert_eq!(as_team_one, Some((vec![T, T], vec![P, Z])));

        // Non-contiguous indices too: a team's index is whatever position it held in the config.
        assert_eq!(
            sides(
                &[(VIEWER.0, Some(5), Some("p")), (2, Some(2), Some("z"))],
                1
            ),
            Some((vec![P], vec![Z]))
        );
    }

    #[test]
    fn viewer_sides_normalizes_a_composition_to_display_order() {
        // Seating order isn't part of a team's identity, so both of these are the same TZ side
        // and have to key the same bucket.
        let first = sides(
            &[
                (VIEWER.0, Some(0), Some("z")),
                (2, Some(0), Some("t")),
                (3, Some(1), Some("p")),
                (4, Some(1), Some("p")),
            ],
            2,
        );
        let second = sides(
            &[
                (VIEWER.0, Some(0), Some("t")),
                (2, Some(0), Some("z")),
                (3, Some(1), Some("p")),
                (4, Some(1), Some("p")),
            ],
            2,
        );
        assert_eq!(first, Some((vec![T, Z], vec![P, P])));
        assert_eq!(first, second);
    }

    #[test]
    fn viewer_sides_rejects_rows_the_database_left_null() {
        // NULL `team` means "unknown", never team zero -- so a game with one is dropped even
        // though the other rows would be enough to guess from.
        assert_eq!(
            sides(&[(VIEWER.0, None, Some("p")), (2, Some(1), Some("z"))], 1),
            None
        );
        assert_eq!(
            sides(&[(VIEWER.0, Some(0), Some("p")), (2, None, Some("z"))], 1),
            None
        );
        assert_eq!(
            sides(&[(VIEWER.0, Some(0), None), (2, Some(1), Some("z"))], 1),
            None
        );
        // Random is never stored as an assigned race.
        assert_eq!(
            sides(
                &[(VIEWER.0, Some(0), Some("r")), (2, Some(1), Some("z"))],
                1
            ),
            None
        );
    }

    #[test]
    fn viewer_sides_rejects_more_than_two_teams() {
        // Free-for-all shapes have no "us and them" to split into a matchup.
        assert_eq!(
            sides(
                &[
                    (VIEWER.0, Some(0), Some("p")),
                    (2, Some(1), Some("z")),
                    (3, Some(2), Some("t")),
                ],
                1,
            ),
            None
        );
    }

    #[test]
    fn viewer_sides_rejects_sides_that_arent_the_modes_size() {
        // A game missing a participant's row would otherwise be counted as a 1v2 that never
        // happened.
        assert_eq!(
            sides(
                &[
                    (VIEWER.0, Some(0), Some("p")),
                    (2, Some(1), Some("z")),
                    (3, Some(1), Some("t")),
                ],
                2,
            ),
            None
        );
        // Everyone on one team, which is how some legacy 1v1s were stored before the backfill
        // split them.
        assert_eq!(
            sides(
                &[(VIEWER.0, Some(0), Some("p")), (2, Some(0), Some("z"))],
                1
            ),
            None
        );
        // A 2v2's rows read under 1v1's team size.
        assert_eq!(
            sides(
                &[
                    (VIEWER.0, Some(0), Some("p")),
                    (2, Some(0), Some("t")),
                    (3, Some(1), Some("p")),
                    (4, Some(1), Some("z")),
                ],
                1,
            ),
            None
        );
    }

    #[test]
    fn viewer_sides_rejects_a_game_the_viewer_isnt_in() {
        // Can't happen through the query, which reaches a game via the viewer's own rating
        // change -- but "no side" is the only honest answer if it ever did.
        assert_eq!(
            sides(&[(2, Some(0), Some("p")), (3, Some(1), Some("z"))], 1),
            None
        );
    }

    #[test]
    fn every_race_pairing_resolves() {
        // Each of the nine cells the 1v1 matrix draws has to be reachable, mirrors included.
        let letter = |r: AssignedRace| match r {
            T => "t",
            P => "p",
            Z => "z",
        };

        for mine in [T, P, Z] {
            for theirs in [T, P, Z] {
                assert_eq!(
                    sides(
                        &[
                            (VIEWER.0, Some(0), Some(letter(mine))),
                            (2, Some(1), Some(letter(theirs))),
                        ],
                        1,
                    ),
                    Some((vec![mine], vec![theirs])),
                    "{mine:?} should face {theirs:?}",
                );
            }
        }
    }

    #[test]
    fn every_team_composition_resolves() {
        // The 2v2 matrix is 6x6, and each of its 36 cells has to be reachable from a real roster.
        let letter = |r: AssignedRace| match r {
            T => "t",
            P => "p",
            Z => "z",
        };
        let compositions = [[T, T], [T, P], [T, Z], [P, P], [P, Z], [Z, Z]];

        for mine in compositions {
            for theirs in compositions {
                assert_eq!(
                    sides(
                        &[
                            (VIEWER.0, Some(0), Some(letter(mine[0]))),
                            (2, Some(0), Some(letter(mine[1]))),
                            (3, Some(1), Some(letter(theirs[0]))),
                            (4, Some(1), Some(letter(theirs[1]))),
                        ],
                        2,
                    ),
                    Some((mine.to_vec(), theirs.to_vec())),
                    "{mine:?} should face {theirs:?}",
                );
            }
        }
    }
}
