use std::collections::HashMap;

use async_graphql::connection::{
    Connection, ConnectionNameType, Edge, EdgeNameType, EmptyFields, OpaqueCursor,
};
use async_graphql::dataloader::{DataLoader, Loader};
use async_graphql::{ComplexObject, Context, Enum, Object, OutputType, Result, SimpleObject};
use chrono::{DateTime, Utc};
use color_eyre::eyre::{self, WrapErr};
use sqlx::PgPool;

use crate::graphql::errors::graphql_error;
use crate::maps::search::{
    DbSbMap, MapCursor, MapFilter, MapListingError, MapListingPage, MapListingRequest, MapScope,
    MapSearchRepo, MapSort,
};
use crate::maps::{MapFile, MapHash, MapsLoader, SbMapId};
use crate::users::{CurrentUser, SbUser, SbUserId, UsersLoader};

/// Whether a map is played as a regular melee map or with its own Use Map Settings rules.
#[derive(Enum, Copy, Clone, Debug, Eq, PartialEq)]
pub enum MapKind {
    Melee,
    Ums,
}

/// A map: one map file, with its curated name and description and its place in the listings. Any
/// map can be viewed, downloaded and played by anyone who has its id, listed or not.
#[derive(SimpleObject, Clone, Debug)]
#[graphql(complex)]
pub struct SbMap {
    pub id: SbMapId,
    #[graphql(skip)]
    pub hash: MapHash,
    /// The curated name if the map has one, otherwise the file's own title.
    pub name: String,
    /// The curated description if the map has one, otherwise the file's own description.
    pub description: String,
    pub kind: MapKind,
    /// The number of player slots the map is played with, given its kind.
    pub player_count: i32,
    /// Whether the map appears in the public map listings.
    pub listed: bool,
    /// Whether the map was listed by staff as an official map.
    pub official: bool,
    /// When the map was listed. Null unless it is listed.
    pub published_at: Option<DateTime<Utc>>,
    #[graphql(skip)]
    pub published_by: Option<SbUserId>,
    /// Play statistics, or null if the map has never been played.
    pub stats: Option<MapStats>,
    /// How many users have favorited this map.
    pub favorite_count: i32,
}

#[ComplexObject]
impl SbMap {
    async fn file(&self, ctx: &Context<'_>) -> Result<MapFile> {
        ctx.data::<DataLoader<MapsLoader>>()?
            .load_one(self.hash)
            .await?
            .map(MapFile::from)
            .ok_or_else(|| graphql_error("NOT_FOUND", "Map file not found"))
    }

    /// The user who listed this map. Null unless it is listed.
    async fn publisher(&self, ctx: &Context<'_>) -> Result<Option<SbUser>> {
        let Some(published_by) = self.published_by else {
            return Ok(None);
        };
        ctx.data::<DataLoader<UsersLoader>>()?
            .load_one(published_by)
            .await
    }

    /// Whether the current user has favorited this map. False when logged out.
    async fn is_favorited(&self, ctx: &Context<'_>) -> Result<bool> {
        Ok(viewer_flags(ctx, self.id).await?.favorited)
    }

    /// Whether this map is in the current user's library. False when logged out.
    async fn in_library(&self, ctx: &Context<'_>) -> Result<bool> {
        Ok(viewer_flags(ctx, self.id).await?.in_library)
    }
}

async fn viewer_flags(ctx: &Context<'_>, map_id: SbMapId) -> Result<ViewerMapFlags> {
    let Some(user) = ctx.data::<Option<CurrentUser>>()? else {
        return Ok(ViewerMapFlags::default());
    };
    Ok(ctx
        .data::<DataLoader<ViewerMapFlagsLoader>>()?
        .load_one((user.id, map_id))
        .await?
        .unwrap_or_default())
}

/// How much a map has been played, across every kind of game.
#[derive(SimpleObject, Clone, Debug)]
#[graphql(complex)]
pub struct MapStats {
    #[graphql(skip)]
    pub map_id: SbMapId,
    #[graphql(name = "games7d")]
    pub games_7d: i32,
    #[graphql(name = "games28d")]
    pub games_28d: i32,
    #[graphql(name = "games90d")]
    pub games_90d: i32,
    pub games_total: i32,
    /// Distinct users who played the map in the last 90 days.
    #[graphql(name = "players90d")]
    pub players_90d: i32,
    /// The median game length over the last 90 days, in milliseconds.
    #[graphql(name = "medianLength90d")]
    pub median_length_90d: Option<i32>,
    pub last_played_at: DateTime<Utc>,
}

#[ComplexObject]
impl MapStats {
    async fn id(&self) -> String {
        format!("map-stats:{}", self.map_id)
    }
}

impl From<DbSbMap> for SbMap {
    fn from(row: DbSbMap) -> Self {
        let stats = match (row.has_stats, row.last_played_at) {
            (true, Some(last_played_at)) => Some(MapStats {
                map_id: row.id,
                games_7d: row.games_7d,
                games_28d: row.games_28d,
                games_90d: row.games_90d,
                games_total: row.games_total,
                players_90d: row.players_90d,
                median_length_90d: row.median_length_90d,
                last_played_at,
            }),
            _ => None,
        };
        Self {
            id: row.id,
            hash: row.hash,
            name: row.name,
            description: row.description,
            kind: if row.kind == "melee" {
                MapKind::Melee
            } else {
                MapKind::Ums
            },
            player_count: row.player_count,
            listed: row.listed,
            official: row.official,
            published_at: row.published_at,
            published_by: row.published_by,
            stats,
            favorite_count: row.favorites,
        }
    }
}

/// Loads maps by their canonical id. Old ids are not resolved here: see [`resolve_map_id`].
pub struct SbMapLoader {
    db: PgPool,
}

impl SbMapLoader {
    pub fn new(db: PgPool) -> Self {
        Self { db }
    }
}

impl Loader<SbMapId> for SbMapLoader {
    type Value = SbMap;
    type Error = async_graphql::Error;

    async fn load(&self, keys: &[SbMapId]) -> Result<HashMap<SbMapId, SbMap>, Self::Error> {
        let rows = sqlx::query_as!(
            DbSbMap,
            r#"
                SELECT m.id as "id: SbMapId", m.hash as "hash: MapHash", m.name as "name!",
                    COALESCE(m.public_description, m.description) as "description!",
                    m.kind::text as "kind!", m.player_count as "player_count!",
                    m.listed as "listed!", m.official,
                    CASE WHEN m.listed THEN m.published_by END as "published_by: SbUserId",
                    CASE WHEN m.listed THEN m.published_at END as published_at,
                    s.map_id IS NOT NULL as "has_stats!",
                    COALESCE(s.games_7d, 0) as "games_7d!",
                    COALESCE(s.games_28d, 0) as "games_28d!",
                    COALESCE(s.games_90d, 0) as "games_90d!",
                    COALESCE(s.games_total, 0) as "games_total!",
                    COALESCE(s.players_90d, 0) as "players_90d!",
                    s.median_length_90d as "median_length_90d?",
                    s.last_played_at as "last_played_at?",
                    COALESCE(f.favorites, 0) as "favorites!"
                FROM maps m
                LEFT JOIN map_stats s ON s.map_id = m.id
                LEFT JOIN map_favorite_counts f ON f.map_id = m.id
                WHERE m.id = ANY($1)
            "#,
            keys as _,
        )
        .fetch_all(&self.db)
        .await?;

        Ok(rows.into_iter().map(|row| (row.id, row.into())).collect())
    }
}

#[derive(Debug, Clone, Copy, Default)]
pub struct ViewerMapFlags {
    pub favorited: bool,
    pub in_library: bool,
}

/// Loads whether each (user, map) pair is in that user's favorites and library.
pub struct ViewerMapFlagsLoader {
    db: PgPool,
}

impl ViewerMapFlagsLoader {
    pub fn new(db: PgPool) -> Self {
        Self { db }
    }
}

impl Loader<(SbUserId, SbMapId)> for ViewerMapFlagsLoader {
    type Value = ViewerMapFlags;
    type Error = async_graphql::Error;

    async fn load(
        &self,
        keys: &[(SbUserId, SbMapId)],
    ) -> Result<HashMap<(SbUserId, SbMapId), ViewerMapFlags>, Self::Error> {
        let user_ids = keys.iter().map(|(u, _)| u.0).collect::<Vec<_>>();
        let map_ids = keys.iter().map(|(_, m)| m.0).collect::<Vec<_>>();
        let rows = sqlx::query!(
            r#"
                SELECT k.user_id as "user_id!: SbUserId", k.map_id as "map_id!: SbMapId",
                    EXISTS (
                        SELECT 1 FROM favorited_maps f
                        WHERE f.favorited_by = k.user_id AND f.map_id = k.map_id
                    ) as "favorited!",
                    EXISTS (
                        SELECT 1 FROM map_library l
                        WHERE l.user_id = k.user_id AND l.map_id = k.map_id
                    ) as "in_library!"
                FROM unnest($1::int[], $2::uuid[]) AS k(user_id, map_id)
            "#,
            &user_ids,
            &map_ids,
        )
        .fetch_all(&self.db)
        .await?;

        Ok(rows
            .into_iter()
            .map(|row| {
                (
                    (row.user_id, row.map_id),
                    ViewerMapFlags {
                        favorited: row.favorited,
                        in_library: row.in_library,
                    },
                )
            })
            .collect())
    }
}

/// Resolves a map id that may be an old (alias) id to the canonical id of an existing map.
async fn resolve_map_id(db: &PgPool, id: SbMapId) -> eyre::Result<Option<SbMapId>> {
    sqlx::query_scalar!(
        r#"
            SELECT m.id as "id: SbMapId"
            FROM maps m
            WHERE m.id = COALESCE((SELECT a.map_id FROM map_id_aliases a WHERE a.old_id = $1), $1)
        "#,
        id as _,
    )
    .fetch_optional(db)
    .await
    .wrap_err("Failed to resolve map id")
}

/// Edge fields for a user's map collections.
#[derive(SimpleObject, Clone, Debug)]
pub struct MapLibraryEntry {
    /// When the map was added to the library.
    pub added_at: DateTime<Utc>,
}

#[derive(SimpleObject, Clone, Debug)]
pub struct FavoriteMapEntry {
    /// When the map was favorited. Null for favorites from before this was recorded.
    pub added_at: Option<DateTime<Utc>>,
}

pub struct MapLibraryConnectionName;

impl ConnectionNameType for MapLibraryConnectionName {
    fn type_name<T: OutputType>() -> String {
        "MapLibraryConnection".to_string()
    }
}

pub struct MapLibraryEdgeName;

impl EdgeNameType for MapLibraryEdgeName {
    fn type_name<T: OutputType>() -> String {
        "MapLibraryEdge".to_string()
    }
}

pub struct FavoriteMapConnectionName;

impl ConnectionNameType for FavoriteMapConnectionName {
    fn type_name<T: OutputType>() -> String {
        "FavoriteMapConnection".to_string()
    }
}

pub struct FavoriteMapEdgeName;

impl EdgeNameType for FavoriteMapEdgeName {
    fn type_name<T: OutputType>() -> String {
        "FavoriteMapEdge".to_string()
    }
}

pub type SbMapConnection = Connection<OpaqueCursor<MapCursor>, SbMap>;
pub type MapLibraryConnection = Connection<
    OpaqueCursor<MapCursor>,
    SbMap,
    EmptyFields,
    MapLibraryEntry,
    MapLibraryConnectionName,
    MapLibraryEdgeName,
>;
pub type FavoriteMapConnection = Connection<
    OpaqueCursor<MapCursor>,
    SbMap,
    EmptyFields,
    FavoriteMapEntry,
    FavoriteMapConnectionName,
    FavoriteMapEdgeName,
>;

fn listing_error(error: MapListingError) -> async_graphql::Error {
    graphql_error("BAD_REQUEST", error.to_string())
}

async fn load_listing(
    ctx: &Context<'_>,
    scope: MapScope,
    filter: Option<MapFilter>,
    sort: Option<MapSort>,
    after: Option<String>,
    first: Option<i32>,
) -> Result<(bool, MapListingPage)> {
    let request = MapListingRequest::new(scope, filter, sort, after.as_deref(), first)
        .map_err(listing_error)?;
    let page = ctx.data::<MapSearchRepo>()?.load_page(&request).await?;
    Ok((request.has_cursor(), page))
}

/// Pages through the maps in `user_id`'s library.
pub async fn load_map_library(
    ctx: &Context<'_>,
    user_id: SbUserId,
    filter: Option<MapFilter>,
    sort: Option<MapSort>,
    after: Option<String>,
    first: Option<i32>,
) -> Result<MapLibraryConnection> {
    let scope = MapScope::Library(user_id);
    let (has_previous_page, page) = load_listing(ctx, scope, filter, sort, after, first).await?;
    let mut connection = Connection::new(has_previous_page, page.has_next_page);
    for row in page.rows {
        // Library rows always have an `added_at` (the column is NOT NULL); the fallback only
        // guards against a non-finite stored value.
        let added_at = row.added_at.unwrap_or(DateTime::<Utc>::UNIX_EPOCH);
        connection.edges.push(Edge::with_additional_fields(
            OpaqueCursor(row.cursor),
            row.map.into(),
            MapLibraryEntry { added_at },
        ));
    }
    Ok(connection)
}

/// Pages through the maps `user_id` has favorited.
pub async fn load_favorite_maps(
    ctx: &Context<'_>,
    user_id: SbUserId,
    filter: Option<MapFilter>,
    sort: Option<MapSort>,
    after: Option<String>,
    first: Option<i32>,
) -> Result<FavoriteMapConnection> {
    let scope = MapScope::Favorites(user_id);
    let (has_previous_page, page) = load_listing(ctx, scope, filter, sort, after, first).await?;
    let mut connection = Connection::new(has_previous_page, page.has_next_page);
    for row in page.rows {
        connection.edges.push(Edge::with_additional_fields(
            OpaqueCursor(row.cursor),
            row.map.into(),
            FavoriteMapEntry {
                added_at: row.added_at,
            },
        ));
    }
    Ok(connection)
}

#[derive(Default)]
pub struct MapsQuery;

#[Object]
impl MapsQuery {
    /// Looks up a map by id, listed or not. Old ids of a map resolve to it, so the returned map's
    /// id can differ from the one requested.
    async fn map(&self, ctx: &Context<'_>, id: SbMapId) -> Result<Option<SbMap>> {
        let repo = ctx.data::<MapSearchRepo>()?;
        let Some(id) = resolve_map_id(repo.db(), id).await? else {
            return Ok(None);
        };
        ctx.data::<DataLoader<SbMapLoader>>()?.load_one(id).await
    }

    /// Searches and pages through the listed maps. With a search, sorts by `RELEVANCE` unless
    /// told otherwise; without one, by `POPULAR_28D`. Pages are 40 maps unless `first` says
    /// otherwise (at most 100). A cursor only continues the listing it came from: using it with a
    /// different filter or sort is an error.
    async fn maps(
        &self,
        ctx: &Context<'_>,
        filter: Option<MapFilter>,
        sort: Option<MapSort>,
        after: Option<String>,
        first: Option<i32>,
    ) -> Result<SbMapConnection> {
        // TODO(tec27): This is readable without a session, so it likely wants rate limiting once
        // server-rs has a way to do that.
        let (has_previous_page, page) =
            load_listing(ctx, MapScope::Listed, filter, sort, after, first).await?;
        let mut connection = Connection::new(has_previous_page, page.has_next_page);
        connection.edges.extend(
            page.rows
                .into_iter()
                .map(|row| Edge::new(OpaqueCursor(row.cursor), row.map.into())),
        );
        Ok(connection)
    }
}

#[derive(Default)]
pub struct MapsMutation;

#[Object]
impl MapsMutation {
    /// Adds a map to the current user's favorites. Favoriting a map that is already a favorite
    /// does nothing.
    async fn map_add_favorite(&self, ctx: &Context<'_>, id: SbMapId) -> Result<SbMap> {
        let user = require_current_user(ctx)?;
        let repo = ctx.data::<MapSearchRepo>()?;
        let id = resolve_existing_map_id(repo.db(), id).await?;

        sqlx::query!(
            r#"
                INSERT INTO favorited_maps (map_id, favorited_by, favorited_date)
                VALUES ($1, $2, now())
                ON CONFLICT (map_id, favorited_by) DO NOTHING
            "#,
            id as _,
            user.id as _,
        )
        .execute(repo.db())
        .await
        .wrap_err("Failed to add favorite map")?;

        load_map(ctx, id).await
    }

    /// Removes a map from the current user's favorites. Removing a map that isn't a favorite does
    /// nothing.
    async fn map_remove_favorite(&self, ctx: &Context<'_>, id: SbMapId) -> Result<SbMap> {
        let user = require_current_user(ctx)?;
        let repo = ctx.data::<MapSearchRepo>()?;
        let id = resolve_existing_map_id(repo.db(), id).await?;

        sqlx::query!(
            "DELETE FROM favorited_maps WHERE map_id = $1 AND favorited_by = $2",
            id as _,
            user.id as _,
        )
        .execute(repo.db())
        .await
        .wrap_err("Failed to remove favorite map")?;

        load_map(ctx, id).await
    }
}

fn require_current_user<'a>(ctx: &'a Context<'_>) -> Result<&'a CurrentUser> {
    ctx.data::<Option<CurrentUser>>()?
        .as_ref()
        .ok_or_else(|| graphql_error("UNAUTHORIZED", "Unauthorized"))
}

async fn resolve_existing_map_id(db: &PgPool, id: SbMapId) -> Result<SbMapId> {
    resolve_map_id(db, id)
        .await?
        .ok_or_else(|| graphql_error("NOT_FOUND", "Map not found"))
}

async fn load_map(ctx: &Context<'_>, id: SbMapId) -> Result<SbMap> {
    ctx.data::<DataLoader<SbMapLoader>>()?
        .load_one(id)
        .await?
        .ok_or_else(|| graphql_error("NOT_FOUND", "Map not found"))
}
