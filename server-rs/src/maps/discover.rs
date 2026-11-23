//! What the Discover page shows beyond the catalog's own listings: the maps a user played recently,
//! one recommendation from the tags of a map they played, and the most played mapmakers.

use async_graphql::dataloader::DataLoader;
use async_graphql::{Context, Object, Result};
use chrono::{DateTime, Utc};
use color_eyre::eyre::WrapErr;
use sqlx::{FromRow, Postgres, QueryBuilder};
use uuid::Uuid;

use crate::graphql::errors::graphql_error;
use crate::maps::SbMapId;
use crate::maps::catalog::{SbMap, SbMapLoader, load_sb_map, load_user};
use crate::maps::families::tags_graphql::{MapTag, family_tags};
use crate::maps::search::{FAMILY_STATS_JOINS, MapLens, MapSearchRepo, family_stat};
use crate::users::{SbUser, SbUserId};

/// How many recently played maps `recentMaps` returns unless told otherwise.
pub const DEFAULT_RECENT_MAPS: i32 = 6;
const MAX_RECENT_MAPS: i32 = 12;
/// How many of a user's most recent games `recentMaps` looks through.
const RECENT_GAMES: i64 = 200;
/// How many of the maps a user played most in lobbies are tried as the seed of a recommendation.
const RECOMMENDATION_SEEDS: i64 = 5;
/// The fewest maps a seed must give for its recommendation to be shown.
const MIN_RECOMMENDED_MAPS: usize = 4;
/// The most maps one recommendation holds.
const MAX_RECOMMENDED_MAPS: i64 = 12;
/// How many mapmakers `mapMakers` returns unless told otherwise.
pub const DEFAULT_MAP_MAKERS: i32 = 8;
const MAX_MAP_MAKERS: i32 = 24;
/// The least a mapmaker's listed maps' `players_90d` must add up to for them to be listed.
pub const MIN_MAKER_PLAYERS: i64 = 10;

/// Loads the current files of `ids`, in the order given. Missing ids are left out.
async fn load_sb_maps(ctx: &Context<'_>, ids: &[SbMapId]) -> Result<Vec<SbMap>> {
    let mut maps = ctx
        .data::<DataLoader<SbMapLoader>>()?
        .load_many(ids.iter().copied())
        .await?;
    Ok(ids.iter().filter_map(|id| maps.remove(id)).collect())
}

/// A map the current user played recently.
pub struct RecentMap {
    user_id: SbUserId,
    family_id: Uuid,
    map_id: SbMapId,
    last_played_at: DateTime<Utc>,
}

/// A map the current user played recently.
#[Object]
impl RecentMap {
    async fn id(&self) -> String {
        format!("recent-map:{}:{}", self.user_id, self.family_id)
    }

    /// The map's current file, which may not be the file that was played.
    async fn map(&self, ctx: &Context<'_>) -> Result<SbMap> {
        load_sb_map(ctx, self.map_id).await
    }

    /// When the user's most recent game on any of the map's files started.
    async fn last_played_at(&self) -> DateTime<Utc> {
        self.last_played_at
    }
}

/// The different maps `user_id` played in their most recent games that weren't canceled, the most
/// recently played first; `first` of them (at most 12). Every kind of game counts. A map that
/// isn't listed is left out when every file of it played in those games was delisted by staff.
/// Under a `lens` that keeps one kind of map, only the maps whose current file is of that kind are
/// kept, out of those games.
pub async fn load_recent_maps(
    ctx: &Context<'_>,
    user_id: SbUserId,
    first: i32,
    lens: MapLens,
) -> Result<Vec<RecentMap>> {
    let db = ctx.data::<MapSearchRepo>()?.db();
    let rows = sqlx::query!(
        r#"
            WITH recent AS (
                SELECT gu.game_id
                FROM games_users gu
                WHERE gu.user_id = $1
                ORDER BY gu.start_time DESC
                LIMIT $2
            )
            SELECT fam.id as "family_id!", fam.current_map_id as "map_id!: SbMapId",
                max(g.start_time) as "last_played_at!"
            FROM recent r
            INNER JOIN games g ON g.id = r.game_id
            INNER JOIN maps pm ON pm.id = g.map_id
            INNER JOIN map_families fam ON fam.id = pm.family_id
            INNER JOIN maps cur ON cur.id = fam.current_map_id
            WHERE g.canceled_at IS NULL
                AND (fam.listed OR pm.delisted_kind IS DISTINCT FROM 'staff')
                AND ($4::text IS NULL OR cur.kind = $4)
            GROUP BY fam.id, fam.current_map_id
            ORDER BY max(g.start_time) DESC, fam.id
            LIMIT $3
        "#,
        user_id as _,
        RECENT_GAMES,
        i64::from(first.clamp(1, MAX_RECENT_MAPS)),
        lens.kind(),
    )
    .fetch_all(db)
    .await
    .wrap_err("Failed to load recently played maps")?;
    Ok(rows
        .into_iter()
        .map(|row| RecentMap {
            user_id,
            family_id: row.family_id,
            map_id: row.map_id,
            last_played_at: row.last_played_at,
        })
        .collect())
}

/// Maps sharing tags with a map the current user played.
pub struct MapRecommendation {
    seed_family_id: Uuid,
    seed_map_id: SbMapId,
    map_ids: Vec<SbMapId>,
}

/// Maps sharing tags with a map the current user played in lobbies lately (the seed), which they
/// haven't played lately themselves.
#[Object]
impl MapRecommendation {
    /// The seed map's id.
    async fn id(&self) -> Uuid {
        self.seed_family_id
    }

    /// The seed map's current file.
    async fn seed(&self, ctx: &Context<'_>) -> Result<SbMap> {
        load_sb_map(ctx, self.seed_map_id).await
    }

    /// The seed map's tags, in list order. The recommended maps each share at least one of them.
    async fn tags(&self, ctx: &Context<'_>) -> Result<Vec<MapTag>> {
        family_tags(ctx, self.seed_family_id).await
    }

    /// The recommended maps' current files: the most tags shared with the seed first, then the
    /// most played in the last 28 days.
    async fn maps(&self, ctx: &Context<'_>) -> Result<Vec<SbMap>> {
        load_sb_maps(ctx, &self.map_ids).await
    }
}

/// One recommended map of one seed, as the recommendation query returns it.
#[derive(Debug, FromRow)]
struct RecommendationRow {
    seed_rank: i64,
    seed_family_id: Uuid,
    seed_map_id: Uuid,
    map_id: Uuid,
}

/// Recommends maps to `user_id` from the tags of a map they played in lobbies.
///
/// The seeds are the listed maps fitting `lens` with a tag that applies, that the user played in
/// lobby games in the last 28 days, the most games first, then the most recently played; the first
/// five are tried in turn. A seed's results are listed maps of its kind sharing an applying tag with
/// it (for a melee seed, also with as many players), other than the seed and the maps the user
/// played in any game in the last 90 days: the most shared tags first, then the most games in the
/// last 28 days, at most 12. The first seed with at least 4 results is recommended; `None` when no
/// seed has that many. One query.
pub async fn load_map_recommendation(
    ctx: &Context<'_>,
    user_id: SbUserId,
    lens: MapLens,
) -> Result<Option<MapRecommendation>> {
    let db = ctx.data::<MapSearchRepo>()?.db();
    let mut query = QueryBuilder::<Postgres>::new(
        "WITH played AS ( \
            SELECT pm.family_id, g.start_time, g.config->>'gameSource' = 'LOBBY' AS lobby \
            FROM games_users gu \
            INNER JOIN games g ON g.id = gu.game_id \
            INNER JOIN maps pm ON pm.id = g.map_id \
            WHERE gu.user_id = ",
    );
    // `games_users.start_time` is a UTC time without a time zone; it narrows the index scan, and
    // `games.start_time` decides
    query.push_bind(user_id.0).push(
        " AND gu.start_time >= (now() AT TIME ZONE 'UTC') - interval '90 days' \
            AND g.start_time >= now() - interval '90 days' \
            AND g.canceled_at IS NULL \
        ), seeds AS ( \
            SELECT fam.id AS family_id, fam.current_map_id, cur.kind, cur.player_count, \
                row_number() OVER ( \
                    ORDER BY count(*) DESC, max(p.start_time) DESC, fam.id \
                ) AS seed_rank \
            FROM played p \
            INNER JOIN map_families fam ON fam.id = p.family_id AND fam.listed \
            INNER JOIN maps cur ON cur.id = fam.current_map_id \
            WHERE p.lobby AND p.start_time >= now() - interval '28 days' \
                AND EXISTS ( \
                    SELECT 1 FROM map_family_tags st \
                    INNER JOIN map_tags stt ON stt.id = st.tag_id AND stt.kind = cur.kind \
                    WHERE st.family_id = fam.id \
                )",
    );
    if let Some(kind) = lens.kind() {
        query.push(" AND cur.kind = ").push_bind(kind);
    }
    query
        .push(
            " GROUP BY fam.id, fam.current_map_id, cur.kind, cur.player_count \
            ORDER BY seed_rank \
            LIMIT ",
        )
        .push_bind(RECOMMENDATION_SEEDS)
        .push(
            ") \
        SELECT sd.seed_rank, sd.family_id AS seed_family_id, \
            sd.current_map_id AS seed_map_id, r.map_id \
        FROM seeds sd \
        CROSS JOIN LATERAL ( \
            SELECT m.id AS map_id, \
                row_number() OVER (ORDER BY count(*) DESC, ",
        )
        .push(family_stat!("games_28d"))
        .push(
            " DESC, fam.id) AS ord \
            FROM map_family_tags st \
            INNER JOIN map_tags stt ON stt.id = st.tag_id AND stt.kind = sd.kind \
            INNER JOIN map_family_tags rt ON rt.tag_id = st.tag_id \
            INNER JOIN maps m ON m.family_id = rt.family_id",
        )
        .push(FAMILY_STATS_JOINS)
        .push(
            " WHERE st.family_id = sd.family_id AND rt.family_id <> sd.family_id \
                AND fam.listed AND m.kind = sd.kind \
                AND (sd.kind <> 'melee' OR m.player_count = sd.player_count) \
                AND NOT EXISTS (SELECT 1 FROM played p WHERE p.family_id = fam.id) \
            GROUP BY fam.id, m.id, fs.games_28d, s.games_28d \
            ORDER BY ord \
            LIMIT ",
        )
        .push_bind(MAX_RECOMMENDED_MAPS)
        .push(") r ORDER BY sd.seed_rank, r.ord");
    let rows = query
        .build_query_as::<RecommendationRow>()
        .fetch_all(db)
        .await
        .wrap_err("Failed to load the map recommendation")?;

    let mut seeds: Vec<MapRecommendation> = Vec::new();
    let mut seed_rank = None;
    for row in rows {
        if seed_rank != Some(row.seed_rank) {
            seed_rank = Some(row.seed_rank);
            seeds.push(MapRecommendation {
                seed_family_id: row.seed_family_id,
                seed_map_id: SbMapId(row.seed_map_id),
                map_ids: Vec::new(),
            });
        }
        if let Some(seed) = seeds.last_mut() {
            seed.map_ids.push(SbMapId(row.map_id));
        }
    }
    Ok(seeds
        .into_iter()
        .find(|seed| seed.map_ids.len() >= MIN_RECOMMENDED_MAPS))
}

/// A user who made listed maps, with how much those maps are played.
pub struct MapMaker {
    lens: MapLens,
    user_id: SbUserId,
    verified: bool,
    map_count: i32,
    games_28d: i32,
}

/// A user who is the maker of listed maps, counting only the maps that fit the lens asked for.
#[Object]
impl MapMaker {
    async fn id(&self) -> String {
        let lens = match self.lens {
            MapLens::All => "all",
            MapLens::Melee => "melee",
            MapLens::Ums => "ums",
        };
        format!("map-maker:{lens}:{}", self.user_id)
    }

    async fn user(&self, ctx: &Context<'_>) -> Result<SbUser> {
        load_user(ctx, Some(self.user_id))
            .await?
            .ok_or_else(|| graphql_error("NOT_FOUND", "User not found"))
    }

    /// Whether staff set them as the maker of at least one of their maps.
    async fn verified(&self) -> bool {
        self.verified
    }

    /// How many of their maps are listed.
    async fn map_count(&self) -> i32 {
        self.map_count
    }

    /// The games played on their listed maps in the last 28 days.
    #[graphql(name = "games28d")]
    async fn games_28d(&self) -> i32 {
        self.games_28d
    }
}

#[derive(Debug, FromRow)]
struct MapMakerRow {
    owner_id: i32,
    verified: bool,
    map_count: i64,
    games_28d: i64,
}

#[derive(Default)]
pub struct MapDiscoverQuery;

#[Object]
impl MapDiscoverQuery {
    /// The users who are the maker (owner) of listed maps fitting `lens`, counting only those
    /// maps: the most games on them in the last 28 days first, then the most maps. A maker is only
    /// listed once their maps' `players90d` add up to at least 10. `first` of them (at most 24).
    async fn map_makers(
        &self,
        ctx: &Context<'_>,
        #[graphql(default)] lens: MapLens,
        #[graphql(default_with = "DEFAULT_MAP_MAKERS")] first: i32,
    ) -> Result<Vec<MapMaker>> {
        let db = ctx.data::<MapSearchRepo>()?.db();
        let mut query = QueryBuilder::<Postgres>::new(concat!(
            "SELECT fam.owner_id, COALESCE(bool_or(fam.owner_kind = 'staff'), false) AS verified, \
             count(*) AS map_count, sum(",
            family_stat!("games_28d"),
            ")::bigint AS games_28d FROM maps m"
        ));
        query
            .push(FAMILY_STATS_JOINS)
            .push(" WHERE fam.listed AND m.listed AND fam.owner_id IS NOT NULL");
        if let Some(kind) = lens.kind() {
            query.push(" AND m.kind = ").push_bind(kind);
        }
        query
            .push(concat!(
                " GROUP BY fam.owner_id HAVING sum(",
                family_stat!("players_90d"),
                ") >= "
            ))
            .push_bind(MIN_MAKER_PLAYERS)
            .push(" ORDER BY games_28d DESC, map_count DESC, fam.owner_id LIMIT ")
            .push_bind(i64::from(first.clamp(1, MAX_MAP_MAKERS)));
        let rows = query
            .build_query_as::<MapMakerRow>()
            .fetch_all(db)
            .await
            .wrap_err("Failed to load mapmakers")?;
        Ok(rows
            .into_iter()
            .map(|row| MapMaker {
                lens,
                user_id: SbUserId(row.owner_id),
                verified: row.verified,
                map_count: i32::try_from(row.map_count).unwrap_or(i32::MAX),
                games_28d: i32::try_from(row.games_28d).unwrap_or(i32::MAX),
            })
            .collect())
    }
}
