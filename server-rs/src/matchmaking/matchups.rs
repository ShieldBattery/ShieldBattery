//! Race-matchup records for the profile's Matchups page, read from `matchup_sides`.
//!
//! That table holds one row per side of each rated matchmaking game, written when the game's
//! results are applied: which races the side played, which it played against, the game's mean
//! pre-game rating and whether the side won. Working out the sides (and which games can't be read
//! as two complete ones) happens there, once, so both resolvers here are a single `GROUP BY`.

use async_graphql::dataloader::DataLoader;
use async_graphql::{ComplexObject, Context, Object, Result, SimpleObject};
use color_eyre::eyre::Context as _;
use deadpool_redis::redis::AsyncCommands;
use serde::{Deserialize, Serialize};
use sqlx::PgPool;

use crate::games::AssignedRace;
use crate::maps::{MapFile, MapsLoader, SbMapId};
use crate::matchmaking::MatchmakingType;
use crate::redis::RedisPool;
use crate::users::SbUserId;

#[derive(Default)]
pub struct MatchmakingMatchupsQuery;

#[Object]
impl MatchmakingMatchupsQuery {
    /// A user's record split by race matchup, for one matchmaking mode.
    ///
    /// Returned as flat buckets keyed by season, map, rating band and the two sides rather than as
    /// a matrix: every filter the page offers is a sum over a subset of the buckets, so they
    /// resolve locally instead of re-querying. The bucket count is bounded by the size of that
    /// key space, not by the number of games played.
    async fn user_matchup_stats(
        &self,
        ctx: &Context<'_>,
        user_id: SbUserId,
        matchmaking_type: MatchmakingType,
    ) -> Result<MatchupStats> {
        let db = ctx.data::<PgPool>()?;

        // Driven from the user's rating changes, whose primary key makes "this user's games in this
        // mode" an index prefix scan; their `games_users` row then says which side was theirs.
        let rows = sqlx::query_as!(
            BucketRow,
            r#"
                WITH buckets AS (
                    SELECT
                        s.season_id,
                        s.map_id,
                        s.races,
                        s.opponent_races,
                        GREATEST($3, LEAST($4, floor(s.mean_rating / $5) * $5))::int AS rating_band,
                        count(*) AS games,
                        count(*) FILTER (WHERE s.won) AS wins
                    FROM matchmaking_rating_changes mrc
                    JOIN games_users gu
                        ON gu.user_id = mrc.user_id AND gu.game_id = mrc.game_id
                    JOIN matchup_sides s ON s.game_id = mrc.game_id AND s.team = gu.team
                    WHERE mrc.user_id = $1 AND mrc.matchmaking_type = $2
                    GROUP BY 1, 2, 3, 4, 5
                )
                SELECT
                    b.season_id AS "season_id!",
                    b.map_id AS "map_id!: SbMapId",
                    m.name AS "map_name!",
                    b.races AS "races!",
                    b.opponent_races AS "opponent_races!",
                    b.rating_band AS "rating_band!",
                    b.games AS "games!",
                    b.wins AS "wins!"
                FROM buckets b
                JOIN uploaded_maps m ON m.id = b.map_id
                ORDER BY 1, 2, 4, 5, 6
            "#,
            user_id.0,
            matchmaking_type as MatchmakingType,
            RATING_BAND_MIN as f64,
            RATING_BAND_MAX as f64,
            RATING_BAND_SIZE as f64,
        )
        .fetch_all(db)
        .await
        .wrap_err("Failed to fetch matchup stats")?;

        Ok(MatchupStats::from_rows(matchmaking_type, rows))
    }

    /// The same matrix across every player in a mode, for comparing a record against the ladder.
    ///
    /// Same payload shape as [`Self::user_matchup_stats`], so the page filters it with the same
    /// code. Every game is counted once per side: a PvZ game adds one to PvZ and one to ZvP, which
    /// makes each cell's win rate the win rate of playing that side. That doubles every count
    /// (and puts both halves of a mirror game in the same cell), which the client accounts for.
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
        let rows = sqlx::query_as!(
            BucketRow,
            r#"
                WITH buckets AS (
                    SELECT
                        season_id,
                        map_id,
                        races,
                        opponent_races,
                        GREATEST($2, LEAST($3, floor(mean_rating / $4) * $4))::int AS rating_band,
                        count(*) AS games,
                        count(*) FILTER (WHERE won) AS wins
                    FROM matchup_sides
                    WHERE matchmaking_type = $1
                    GROUP BY 1, 2, 3, 4, 5
                )
                SELECT
                    b.season_id AS "season_id!",
                    b.map_id AS "map_id!: SbMapId",
                    m.name AS "map_name!",
                    b.races AS "races!",
                    b.opponent_races AS "opponent_races!",
                    b.rating_band AS "rating_band!",
                    b.games AS "games!",
                    b.wins AS "wins!"
                FROM buckets b
                JOIN uploaded_maps m ON m.id = b.map_id
                ORDER BY 1, 2, 4, 5, 6
            "#,
            matchmaking_type as MatchmakingType,
            RATING_BAND_MIN as f64,
            RATING_BAND_MAX as f64,
            RATING_BAND_SIZE as f64,
        )
        .fetch_all(db)
        .await
        .wrap_err("Failed to aggregate global matchup stats")?;
        let stats = MatchupStats::from_rows(matchmaking_type, rows);

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

/// How long a computed global matrix is served from Redis before it's recomputed. The query reads
/// every side in the mode, and a ladder-wide race win rate doesn't move noticeably in ten minutes.
const GLOBAL_CACHE_TTL_SECONDS: u64 = 600;

fn global_cache_key(matchmaking_type: MatchmakingType) -> String {
    format!("matchups:global:{}", matchmaking_type.as_str())
}

/// Width of a rating band, and the range they're clamped into. Everything at or below
/// [`RATING_BAND_MIN`] shares the bottom band and everything at or above [`RATING_BAND_MAX`] shares
/// the top one, so the band count stays fixed at fifteen however far the tails stretch.
pub const RATING_BAND_SIZE: i32 = 100;
pub const RATING_BAND_MIN: i32 = 1000;
pub const RATING_BAND_MAX: i32 = 2400;

/// One bucket as both queries return it, with the map's name alongside for the map list.
struct BucketRow {
    season_id: i32,
    map_id: SbMapId,
    map_name: String,
    races: String,
    opponent_races: String,
    rating_band: i32,
    games: i64,
    wins: i64,
}

#[derive(SimpleObject, Serialize, Deserialize, Debug, Clone)]
pub struct MatchupBucket {
    /// The season the games' rating changes were applied in.
    pub season_id: i32,
    pub map_id: SbMapId,
    /// The races on the viewed player's side, after random is resolved, in TPZ order. A list
    /// because a side is a team composition (`tp` against `pz` in 2v2); it holds one race in a solo
    /// mode. Who played which race isn't recorded, which keeps a 3v3 matrix at 10x10.
    pub races: Vec<AssignedRace>,
    /// The opposing side's composition, same encoding as `races`.
    pub opponent_races: Vec<AssignedRace>,
    /// Lower edge of the rating band the games' mean pre-game rating fell in, `RATING_BAND_SIZE`
    /// wide and clamped into `[RATING_BAND_MIN, RATING_BAND_MAX]`. The bottom band is "this and
    /// below" and the top is "this and above".
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
    /// Never fails the query: a map whose file is missing or won't decode should cost the
    /// thumbnail, not the records the page is for. Failures are logged instead.
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
    pub buckets: Vec<MatchupBucket>,
    /// Every map appearing in `buckets`, sorted by name, so the page's map filter can label itself
    /// without the name being repeated on each bucket.
    pub maps: Vec<MatchupMap>,
    /// The band grid the buckets are placed on, so the rating filter can lay out its scale from
    /// the payload instead of hard-coding the same numbers.
    pub rating_band_size: i32,
    pub min_rating_band: i32,
    pub max_rating_band: i32,
}

impl MatchupStats {
    fn from_rows(matchmaking_type: MatchmakingType, rows: Vec<BucketRow>) -> Self {
        let mut buckets = Vec::with_capacity(rows.len());
        let mut maps: Vec<MatchupMap> = Vec::new();
        for row in rows {
            // `matchup_sides` only ever holds assigned races, so this can't fail for a row that
            // table wrote; one that somehow does is dropped rather than guessed at.
            let (Some(races), Some(opponent_races)) =
                (parse_side(&row.races), parse_side(&row.opponent_races))
            else {
                continue;
            };
            if !maps.iter().any(|m| m.id == row.map_id) {
                maps.push(MatchupMap {
                    id: row.map_id,
                    name: row.map_name,
                });
            }
            buckets.push(MatchupBucket {
                season_id: row.season_id,
                map_id: row.map_id,
                races,
                opponent_races,
                rating_band: row.rating_band,
                games: row.games as i32,
                wins: row.wins as i32,
            });
        }
        maps.sort_unstable_by(|a, b| a.name.cmp(&b.name).then(a.id.0.cmp(&b.id.0)));

        Self {
            matchmaking_type,
            buckets,
            maps,
            rating_band_size: RATING_BAND_SIZE,
            min_rating_band: RATING_BAND_MIN,
            max_rating_band: RATING_BAND_MAX,
        }
    }
}

/// A side as `matchup_sides` spells it: one race letter per player, e.g. `tp`.
fn parse_side(races: &str) -> Option<Vec<AssignedRace>> {
    if races.is_empty() {
        return None;
    }
    races
        .chars()
        .map(|race| match race {
            't' => Some(AssignedRace::Terran),
            'p' => Some(AssignedRace::Protoss),
            'z' => Some(AssignedRace::Zerg),
            _ => None,
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    const T: AssignedRace = AssignedRace::Terran;
    const P: AssignedRace = AssignedRace::Protoss;
    const Z: AssignedRace = AssignedRace::Zerg;

    #[test]
    fn parse_side_reads_each_letter_in_order() {
        assert_eq!(parse_side("t"), Some(vec![T]));
        assert_eq!(parse_side("tpz"), Some(vec![T, P, Z]));
    }

    #[test]
    fn parse_side_rejects_what_matchup_sides_never_holds() {
        assert_eq!(parse_side(""), None);
        assert_eq!(parse_side("r"), None);
        assert_eq!(parse_side("tr"), None);
    }

    fn row(map: u128, name: &str, races: &str) -> BucketRow {
        BucketRow {
            season_id: 1,
            map_id: SbMapId(uuid::Uuid::from_u128(map)),
            map_name: name.into(),
            races: races.into(),
            opponent_races: "z".into(),
            rating_band: 1500,
            games: 3,
            wins: 2,
        }
    }

    #[test]
    fn from_rows_lists_each_map_once_by_name() {
        let stats = MatchupStats::from_rows(
            MatchmakingType::Match1v1,
            vec![row(1, "Zzz", "t"), row(2, "Aaa", "t"), row(1, "Zzz", "p")],
        );
        assert_eq!(stats.buckets.len(), 3);
        let names: Vec<_> = stats.maps.iter().map(|m| m.name.as_str()).collect();
        assert_eq!(names, ["Aaa", "Zzz"]);
    }

    #[test]
    fn from_rows_drops_a_bucket_it_cannot_parse() {
        let stats = MatchupStats::from_rows(
            MatchmakingType::Match1v1,
            vec![row(1, "Only", "r"), row(2, "Kept", "t")],
        );
        assert_eq!(stats.buckets.len(), 1);
        let names: Vec<_> = stats.maps.iter().map(|m| m.name.as_str()).collect();
        assert_eq!(names, ["Kept"]);
    }
}
