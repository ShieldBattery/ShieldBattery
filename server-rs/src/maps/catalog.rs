use std::collections::HashMap;

use async_graphql::connection::{
    Connection, ConnectionNameType, Edge, EdgeNameType, EmptyFields, OpaqueCursor,
};
use async_graphql::dataloader::{DataLoader, Loader};
use async_graphql::{
    ComplexObject, Context, Enum, Object, ObjectType, OutputType, Result, SimpleObject,
};
use chrono::{DateTime, Utc};
use color_eyre::eyre::{self, WrapErr};
use data_encoding::HEXLOWER_PERMISSIVE;
use sqlx::PgPool;

use crate::graphql::errors::graphql_error;
use crate::maps::families::graphql::{
    self as families, MapFamily, MapFamilyMember, MapLinkSuggestion, MapVersionStatus,
};
use crate::maps::search::{
    DbSbMap, MapCursor, MapFilter, MapListingError, MapListingPage, MapListingRequest, MapScope,
    MapSearchRepo, MapSort,
};
use crate::maps::stats::{
    self, DEFAULT_ACTIVITY_WEEKS, MapMatchupSeason, MapMatchupStats, MapWeeklyActivity,
};
use crate::maps::{MapFile, MapHash, MapsLoader, SbMapId};
use crate::matchmaking::MatchmakingType;
use crate::users::permissions::RequiredPermission;
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
    #[graphql(skip)]
    pub moderation_record: MapModeration,
    /// Play statistics, or null if the map has never been played.
    pub stats: Option<MapStats>,
    /// How many users have favorited this map.
    pub favorite_count: i32,
    /// When the server first saw the map's file.
    pub first_seen_at: DateTime<Utc>,
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
        load_user(ctx, self.published_by).await
    }

    /// Who listed and delisted this map and when, whether or not it is listed now. Only available
    /// to users who can manage maps.
    #[graphql(guard = RequiredPermission::ManageMaps)]
    async fn moderation(&self) -> Option<MapModeration> {
        Some(self.moderation_record.clone())
    }

    /// Matchmaking results on this map for each matchup in a matchmaking type, most played first.
    /// Covers one season, or every season summed when `seasonId` is null. Counts are raw: no
    /// minimum number of games is applied.
    async fn matchups(
        &self,
        ctx: &Context<'_>,
        matchmaking_type: MatchmakingType,
        season_id: Option<i32>,
    ) -> Result<Vec<MapMatchupStats>> {
        // Only the map page selects this, one map at a time, so it isn't batched
        let db = ctx.data::<MapSearchRepo>()?.db();
        Ok(stats::load_matchups(db, self.id, matchmaking_type, season_id).await?)
    }

    /// The matchmaking seasons and types this map has matchup results in, newest season first.
    async fn matchup_seasons(&self, ctx: &Context<'_>) -> Result<Vec<MapMatchupSeason>> {
        // Only the map page selects this, one map at a time, so it isn't batched
        let db = ctx.data::<MapSearchRepo>()?.db();
        Ok(stats::load_matchup_seasons(db, self.id).await?)
    }

    /// The games played on this map in each of the last `weeks` weeks (at most 104), oldest
    /// first. Weeks start on Monday (UTC) and end with the current week, which is still in
    /// progress. Weeks without games are included.
    async fn weekly_activity(
        &self,
        ctx: &Context<'_>,
        #[graphql(default_with = "DEFAULT_ACTIVITY_WEEKS")] weeks: i32,
    ) -> Result<Vec<MapWeeklyActivity>> {
        // Only the map page selects this, one map at a time, so it isn't batched
        let db = ctx.data::<MapSearchRepo>()?.db();
        let weeks = stats::clamp_activity_weeks(weeks);
        let today = Utc::now().date_naive();
        Ok(stats::load_weekly_activity(db, self.id, weeks, today).await?)
    }

    /// Whether the current user has favorited this map. False when logged out.
    async fn is_favorited(&self, ctx: &Context<'_>) -> Result<bool> {
        Ok(viewer_flags(ctx, self.id).await?.favorited)
    }

    /// Whether this map is in the current user's library. False when logged out.
    async fn in_library(&self, ctx: &Context<'_>) -> Result<bool> {
        Ok(viewer_flags(ctx, self.id).await?.in_library)
    }

    /// The family of versions, variants, translations and forks this map is in. Null when it's in
    /// none.
    async fn family(&self, ctx: &Context<'_>) -> Result<Option<MapFamily>> {
        families::map_family(ctx, self.id).await
    }

    /// This map's place in its family, even when it isn't listed. Null when it's in no family.
    async fn family_member(&self, ctx: &Context<'_>) -> Result<Option<MapFamilyMember>> {
        families::map_family_member(ctx, self.id).await
    }

    /// Where this map stands among the versions of its family line.
    async fn version_status(&self, ctx: &Context<'_>) -> Result<MapVersionStatus> {
        families::version_status(ctx, self.id).await
    }

    /// The current version of this map's line when it's newer than this map. Always a listed map.
    async fn newer_version(&self, ctx: &Context<'_>) -> Result<Option<SbMap>> {
        families::newer_version(ctx, self.id).await
    }

    /// How many listed maps this map's family line holds (its versions, variants and
    /// translations), at least 1.
    async fn version_count(&self, ctx: &Context<'_>) -> Result<i32> {
        families::version_count(ctx, self.id).await
    }

    /// Play statistics summed over every file in this map's family line. Null when the viewer can
    /// see fewer than two of the line's files (listed ones, or all of them for users who can manage
    /// maps), or the line's stats haven't been computed yet.
    async fn line_stats(&self, ctx: &Context<'_>) -> Result<Option<MapStats>> {
        families::line_stats(ctx, self.id).await
    }

    /// Maps detection found to be possibly related to this one that nobody has sorted yet: listed
    /// maps, or every one for users who can manage maps. Most similar terrain first.
    async fn similar_maps(&self, ctx: &Context<'_>) -> Result<Vec<SbMap>> {
        families::similar_maps(ctx, self.id).await
    }

    /// Every detected pair this map is in, with the rules' proposals, open ones first. Only
    /// available to users who can manage maps.
    #[graphql(guard = RequiredPermission::ManageMaps)]
    async fn link_suggestions(&self, ctx: &Context<'_>) -> Result<Vec<MapLinkSuggestion>> {
        // Only the map page's staff tools select this, one map at a time, so it isn't batched
        let db = ctx.data::<MapSearchRepo>()?.db();
        Ok(families::load_suggestions_of(db, self.id).await?)
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

/// Who listed and delisted a map and when.
#[derive(SimpleObject, Clone, Debug)]
#[graphql(complex)]
pub struct MapModeration {
    #[graphql(skip)]
    pub map_id: SbMapId,
    /// When the map was most recently listed. Kept after it is delisted.
    pub published_at: Option<DateTime<Utc>>,
    #[graphql(skip)]
    pub published_by_id: Option<SbUserId>,
    /// When the map was taken out of the listings. Null while it is listed.
    pub delisted_at: Option<DateTime<Utc>>,
    #[graphql(skip)]
    pub delisted_by_id: Option<SbUserId>,
}

#[ComplexObject]
impl MapModeration {
    async fn id(&self) -> String {
        format!("map-moderation:{}", self.map_id)
    }

    /// The user who most recently listed the map. Kept after it is delisted.
    async fn published_by(&self, ctx: &Context<'_>) -> Result<Option<SbUser>> {
        load_user(ctx, self.published_by_id).await
    }

    /// The user who took the map out of the listings, if known. Null while it is listed.
    async fn delisted_by(&self, ctx: &Context<'_>) -> Result<Option<SbUser>> {
        load_user(ctx, self.delisted_by_id).await
    }
}

async fn load_user(ctx: &Context<'_>, id: Option<SbUserId>) -> Result<Option<SbUser>> {
    let Some(id) = id else {
        return Ok(None);
    };
    ctx.data::<DataLoader<UsersLoader>>()?.load_one(id).await
}

/// How much a map has been played, across every kind of game.
#[derive(SimpleObject, Clone, Debug)]
#[graphql(complex)]
pub struct MapStats {
    /// The map the stats are for, or for a family line's stats, the line's first file.
    #[graphql(skip)]
    pub map_id: SbMapId,
    /// Whether these are a family line's stats rather than one map's.
    #[graphql(skip)]
    pub line: bool,
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
    /// How far lobby play in the last 7 days exceeds what the 3 weeks before it predict, in
    /// hundredths of a standard deviation. 0 for maps that aren't rising or that fewer than 5
    /// people played in lobbies this week. Updated hourly.
    pub trending_score: i32,
}

#[ComplexObject]
impl MapStats {
    async fn id(&self) -> String {
        if self.line {
            format!("map-line-stats:{}", self.map_id)
        } else {
            format!("map-stats:{}", self.map_id)
        }
    }
}

impl From<DbSbMap> for SbMap {
    fn from(row: DbSbMap) -> Self {
        let stats = match (row.has_stats, row.last_played_at) {
            (true, Some(last_played_at)) => Some(MapStats {
                map_id: row.id,
                line: false,
                games_7d: row.games_7d,
                games_28d: row.games_28d,
                games_90d: row.games_90d,
                games_total: row.games_total,
                players_90d: row.players_90d,
                median_length_90d: row.median_length_90d,
                last_played_at,
                trending_score: row.trending_score,
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
            // Who listed a map is only public while it's listed
            published_at: row.published_at.filter(|_| row.listed),
            published_by: row.published_by.filter(|_| row.listed),
            moderation_record: MapModeration {
                map_id: row.id,
                published_at: row.published_at,
                published_by_id: row.published_by,
                delisted_at: row.delisted_at,
                delisted_by_id: row.delisted_by,
            },
            stats,
            favorite_count: row.favorites,
            first_seen_at: row.first_seen_at,
        }
    }
}

/// Loads maps by their canonical id. Old ids are not resolved here: see [`resolve_map_id`].
pub struct SbMapLoader {
    repo: MapSearchRepo,
}

impl SbMapLoader {
    pub fn new(repo: MapSearchRepo) -> Self {
        Self { repo }
    }
}

impl Loader<SbMapId> for SbMapLoader {
    type Value = SbMap;
    type Error = async_graphql::Error;

    async fn load(&self, keys: &[SbMapId]) -> Result<HashMap<SbMapId, SbMap>, Self::Error> {
        let rows = self.repo.load_maps(keys).await?;
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
pub(crate) async fn resolve_map_id(db: &PgPool, id: SbMapId) -> eyre::Result<Option<SbMapId>> {
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

/// Facts about a whole map listing, rather than one page of it.
pub struct MapListingInfo {
    request: MapListingRequest,
}

#[Object]
impl MapListingInfo {
    /// How many maps the listing holds across every page.
    async fn total_count(&self, ctx: &Context<'_>) -> Result<i32> {
        let count = ctx.data::<MapSearchRepo>()?.count(&self.request).await?;
        Ok(i32::try_from(count).unwrap_or(i32::MAX))
    }
}

pub type SbMapConnection = Connection<OpaqueCursor<MapCursor>, SbMap, MapListingInfo, EmptyFields>;
pub type MapLibraryConnection = Connection<
    OpaqueCursor<MapCursor>,
    SbMap,
    MapListingInfo,
    MapLibraryEntry,
    MapLibraryConnectionName,
    MapLibraryEdgeName,
>;
pub type FavoriteMapConnection = Connection<
    OpaqueCursor<MapCursor>,
    SbMap,
    MapListingInfo,
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
) -> Result<(MapListingRequest, MapListingPage)> {
    let request = MapListingRequest::new(scope, filter, sort, after.as_deref(), first)
        .map_err(listing_error)?;
    let page = ctx.data::<MapSearchRepo>()?.load_page(&request).await?;
    Ok((request, page))
}

/// Starts a connection for a page of `request`'s listing.
fn new_listing_connection<EdgeFields, Name, EdgeName>(
    request: MapListingRequest,
    page: &MapListingPage,
) -> Connection<OpaqueCursor<MapCursor>, SbMap, MapListingInfo, EdgeFields, Name, EdgeName>
where
    EdgeFields: ObjectType,
    Name: ConnectionNameType,
    EdgeName: EdgeNameType,
{
    Connection::with_additional_fields(
        request.has_cursor(),
        page.has_next_page,
        MapListingInfo { request },
    )
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
    let (request, page) = load_listing(ctx, scope, filter, sort, after, first).await?;
    let mut connection = new_listing_connection(request, &page);
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
    let (request, page) = load_listing(ctx, scope, filter, sort, after, first).await?;
    let mut connection = new_listing_connection(request, &page);
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

/// The most hashes one `mapsByHash` lookup may carry.
const MAX_HASH_LOOKUPS: usize = 500;

/// Decodes hex-encoded map file hashes, or returns `None` if any of them isn't one.
fn decode_map_hashes(hashes: &[String]) -> Option<Vec<Vec<u8>>> {
    hashes
        .iter()
        .map(|hash| {
            HEXLOWER_PERMISSIVE
                .decode(hash.as_bytes())
                .ok()
                .filter(|bytes| bytes.len() == 32)
        })
        .collect()
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

    /// Looks up maps by the hashes of their files, listed or not. A file's hash is the
    /// hex-encoded SHA-256 of its lowercase extension followed by its contents (`MapFile.id` is
    /// the same hash, base64-encoded), so the app can tell which of a user's local map files are
    /// already known without uploading them. Hashes that match no map are left out, and the maps come back in
    /// no particular order. Takes at most 500 hashes.
    async fn maps_by_hash(&self, ctx: &Context<'_>, hashes: Vec<String>) -> Result<Vec<SbMap>> {
        require_current_user(ctx)?;
        if hashes.len() > MAX_HASH_LOOKUPS {
            return Err(graphql_error(
                "BAD_REQUEST",
                format!("at most {MAX_HASH_LOOKUPS} hashes can be looked up at once"),
            ));
        }
        let hashes = decode_map_hashes(&hashes)
            .ok_or_else(|| graphql_error("BAD_REQUEST", "invalid map hash"))?;

        let repo = ctx.data::<MapSearchRepo>()?;
        let ids = sqlx::query_scalar!(
            r#"SELECT id as "id: SbMapId" FROM maps WHERE hash = ANY($1::bytea[])"#,
            &hashes,
        )
        .fetch_all(repo.db())
        .await
        .wrap_err("Failed to look up maps by hash")?;
        let maps = ctx
            .data::<DataLoader<SbMapLoader>>()?
            .load_many(ids)
            .await?;
        Ok(maps.into_values().collect())
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
        let (request, page) =
            load_listing(ctx, MapScope::Listed, filter, sort, after, first).await?;
        let mut connection = new_listing_connection(request, &page);
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

    /// Adds a map to the current user's library, for maps they hold a copy of without having
    /// uploaded it. Adding a map that's already in the library moves it to the front of `NEWEST`.
    async fn map_add_to_library(&self, ctx: &Context<'_>, id: SbMapId) -> Result<SbMap> {
        let user = require_current_user(ctx)?;
        let repo = ctx.data::<MapSearchRepo>()?;
        let id = resolve_existing_map_id(repo.db(), id).await?;

        sqlx::query!(
            r#"
                INSERT INTO map_library (user_id, map_id, added_at)
                VALUES ($1, $2, now())
                ON CONFLICT (user_id, map_id) DO UPDATE SET added_at = now()
            "#,
            user.id as _,
            id as _,
        )
        .execute(repo.db())
        .await
        .wrap_err("Failed to add map to library")?;

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

pub(crate) fn require_current_user<'a>(ctx: &'a Context<'_>) -> Result<&'a CurrentUser> {
    ctx.data::<Option<CurrentUser>>()?
        .as_ref()
        .ok_or_else(|| graphql_error("UNAUTHORIZED", "Unauthorized"))
}

pub(crate) async fn resolve_existing_map_id(db: &PgPool, id: SbMapId) -> Result<SbMapId> {
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

#[cfg(test)]
mod tests {
    use async_graphql::{EmptyMutation, EmptySubscription, Schema, Value};
    use chrono::TimeZone;
    use uuid::Uuid;

    use super::*;
    use crate::users::permissions::SbPermissions;

    struct TestQuery;

    #[Object]
    impl TestQuery {
        async fn map(&self) -> SbMap {
            let published_at = Utc.with_ymd_and_hms(2026, 1, 2, 3, 4, 5).unwrap();
            let delisted_at = Utc.with_ymd_and_hms(2026, 2, 3, 4, 5, 6).unwrap();
            SbMap::from(DbSbMap {
                id: SbMapId(Uuid::nil()),
                hash: MapHash([0; 32]),
                name: "Map".into(),
                description: String::new(),
                kind: "melee".into(),
                player_count: 2,
                listed: false,
                official: false,
                published_by: None,
                published_at: Some(published_at),
                delisted_by: None,
                delisted_at: Some(delisted_at),
                has_stats: false,
                games_7d: 0,
                games_28d: 0,
                games_90d: 0,
                games_total: 0,
                players_90d: 0,
                median_length_90d: None,
                last_played_at: None,
                trending_score: 0,
                favorites: 0,
                first_seen_at: published_at,
            })
        }
    }

    fn user(manage_maps: bool) -> CurrentUser {
        let id = SbUserId(1);
        CurrentUser {
            id,
            name: "user".into(),
            login_name: "user".into(),
            email: "user@example.com".into(),
            email_verified: true,
            accepted_privacy_version: 0,
            accepted_terms_version: 0,
            accepted_use_policy_version: 0,
            locale: None,
            last_login_name_change: None,
            last_name_change: None,
            name_change_tokens: 0,
            avatar_url: None,
            permissions: SbPermissions {
                id,
                edit_permissions: false,
                debug: false,
                ban_users: false,
                manage_leagues: false,
                manage_maps,
                manage_map_pools: false,
                manage_matchmaking: false,
                manage_matchmaking_seasons: false,
                manage_matchmaking_times: false,
                mass_delete_maps: false,
                moderate_chat_channels: false,
                manage_news: false,
                manage_bug_reports: false,
                manage_game_reports: false,
                manage_restricted_names: false,
                manage_signup_codes: false,
                manage_live_streams: false,
                use_development_client: false,
            },
        }
    }

    async fn query_map(user: Option<CurrentUser>) -> async_graphql::Response {
        let schema = Schema::build(TestQuery, EmptyMutation, EmptySubscription)
            .data(user)
            .finish();
        schema
            .execute("{ map { publishedAt moderation { id publishedAt delistedAt } } }")
            .await
    }

    #[tokio::test]
    async fn moderation_is_forbidden_without_manage_maps() {
        for user in [None, Some(user(false))] {
            let response = query_map(user).await;
            assert_eq!(response.errors.len(), 1);
            assert_eq!(response.errors[0].message, "Forbidden");
            // The rest of the map still resolves; only `moderation` is left out
            let data = response.data.into_json().unwrap();
            assert_eq!(data["map"]["publishedAt"], serde_json::Value::Null);
            assert_eq!(data["map"]["moderation"], serde_json::Value::Null);
        }
    }

    #[tokio::test]
    async fn moderation_is_unmasked_with_manage_maps() {
        let response = query_map(Some(user(true))).await;
        assert!(response.errors.is_empty(), "{:?}", response.errors);
        assert_ne!(response.data, Value::Null);
        assert_eq!(
            response.data.into_json().unwrap(),
            serde_json::json!({
                "map": {
                    "publishedAt": null,
                    "moderation": {
                        "id": "map-moderation:00000000-0000-0000-0000-000000000000",
                        "publishedAt": "2026-01-02T03:04:05+00:00",
                        "delistedAt": "2026-02-03T04:05:06+00:00",
                    },
                },
            })
        );
    }

    #[test]
    fn map_hashes_decode_from_64_hex_characters() {
        let hex = "ab".repeat(32);
        assert_eq!(
            decode_map_hashes(&[hex.clone(), hex.to_uppercase()]),
            Some(vec![vec![0xab; 32], vec![0xab; 32]])
        );
        assert_eq!(decode_map_hashes(&["ab".repeat(31)]), None);
        assert_eq!(decode_map_hashes(&["zz".repeat(32)]), None);
        assert_eq!(decode_map_hashes(&[hex, "".to_string()]), None);
        assert_eq!(decode_map_hashes(&[]), Some(vec![]));
    }
}
