//! The GraphQL API of map collections: reading collections and their maps, players' and staff's
//! edits, saves, and reports with staff moderation.

use std::collections::HashMap;

use async_graphql::connection::{Connection, CursorType, Edge, EmptyFields, OpaqueCursor};
use async_graphql::dataloader::{DataLoader, Loader};
use async_graphql::{Context, Enum, Object, Result, SimpleObject};
use chrono::{DateTime, Utc};
use color_eyre::eyre::WrapErr;
use sqlx::{FromRow, PgPool, Postgres, QueryBuilder};
use uuid::Uuid;

use crate::graphql::errors::graphql_error;
use crate::maps::SbMapId;
use crate::maps::catalog::{
    CollectionMapConnection, SbMap, SbMapLoader, is_staff, load_collection_maps, load_user,
    require_current_user, resolve_existing_map_id,
};
use crate::maps::collections::{
    self, COLLECTION_COLUMNS, CollectionError, CollectionKind, CollectionRow, Viewer,
};
use crate::maps::search::{MAX_SEARCH_LENGTH, MapFilter, MapScope, MapSearchRepo, MapSort};
use crate::users::names::NameChecker;
use crate::users::permissions::RequiredPermission;
use crate::users::{CurrentUser, SbUser, SbUserId};

/// Collections and reports per page unless `first` says otherwise.
const DEFAULT_PAGE_SIZE: i32 = 40;
/// The most collections or reports one page may hold.
const MAX_PAGE_SIZE: i32 = 100;
/// How many maps a collection's cover shows.
const COVER_SIZE: usize = 4;
/// How many collections `MapFamily.collections` lists unless told otherwise, and at most.
pub const DEFAULT_FAMILY_COLLECTIONS: i32 = 6;
const MAX_FAMILY_COLLECTIONS: i32 = 20;

fn collection_error(error: CollectionError) -> async_graphql::Error {
    match error.code() {
        Some(code) => graphql_error(code, error.to_string()),
        None => async_graphql::Error::new(format!("{error:?}")),
    }
}

/// Who the request is from.
pub(crate) async fn current_viewer(ctx: &Context<'_>) -> Result<Viewer> {
    let id = ctx.data::<Option<CurrentUser>>()?.as_ref().map(|u| u.id);
    Ok(Viewer {
        id,
        staff: is_staff(ctx).await,
    })
}

/// A collection as one viewer sees it.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub struct CollectionView {
    pub id: Uuid,
    /// Whether only the entries whose map is listed are shown.
    pub listed_only: bool,
}

/// What a viewer sees in a collection: how many maps, and the first few.
#[derive(Debug, Clone, Default)]
pub struct CollectionContent {
    pub map_count: i32,
    pub cover: Vec<SbMapId>,
}

/// Loads how many maps collections hold and their first maps, as particular viewers see them.
pub struct CollectionContentLoader {
    db: PgPool,
}

impl CollectionContentLoader {
    pub fn new(db: PgPool) -> Self {
        Self { db }
    }
}

impl Loader<CollectionView> for CollectionContentLoader {
    type Value = CollectionContent;
    type Error = async_graphql::Error;

    async fn load(
        &self,
        keys: &[CollectionView],
    ) -> Result<HashMap<CollectionView, CollectionContent>> {
        let ids: Vec<Uuid> = keys.iter().map(|k| k.id).collect();
        let listed_only: Vec<bool> = keys.iter().map(|k| k.listed_only).collect();
        let rows = sqlx::query!(
            r#"
                SELECT k.id as "id!", k.listed_only as "listed_only!",
                    s.map_count as "map_count!", s.cover as "cover!"
                FROM unnest($1::uuid[], $2::boolean[]) AS k(id, listed_only)
                CROSS JOIN LATERAL (
                    SELECT count(*) as map_count,
                        COALESCE(
                            (array_agg(
                                e.map_id ORDER BY e.position, e.added_at DESC NULLS LAST, e.map_id
                            ))[1:$3],
                            '{}'
                        ) as cover
                    FROM (
                        SELECT m.id as map_id, cm.position, cm.added_at
                        FROM collection_maps cm
                        INNER JOIN maps m ON m.id = COALESCE(cm.map_id, (
                            SELECT efam.current_map_id FROM map_families efam
                            WHERE efam.id = cm.family_id
                        ))
                        INNER JOIN map_families fam ON fam.id = m.family_id
                        WHERE cm.collection_id = k.id AND (NOT k.listed_only OR fam.listed)
                    ) e
                ) s
            "#,
            &ids,
            &listed_only,
            COVER_SIZE as i32,
        )
        .fetch_all(&self.db)
        .await
        .wrap_err("Failed to load collection contents")?;
        Ok(rows
            .into_iter()
            .map(|row| {
                (
                    CollectionView {
                        id: row.id,
                        listed_only: row.listed_only,
                    },
                    CollectionContent {
                        map_count: i32::try_from(row.map_count).unwrap_or(i32::MAX),
                        cover: row.cover.into_iter().map(SbMapId).collect(),
                    },
                )
            })
            .collect())
    }
}

/// Loads how many players saved each collection.
pub struct CollectionSaveCountLoader {
    db: PgPool,
}

impl CollectionSaveCountLoader {
    pub fn new(db: PgPool) -> Self {
        Self { db }
    }
}

impl Loader<Uuid> for CollectionSaveCountLoader {
    type Value = i32;
    type Error = async_graphql::Error;

    async fn load(&self, keys: &[Uuid]) -> Result<HashMap<Uuid, i32>> {
        let rows = sqlx::query!(
            r#"
                SELECT k.id as "id!",
                    (SELECT count(*) FROM collection_saves s WHERE s.collection_id = k.id)
                        as "count!"
                FROM unnest($1::uuid[]) AS k(id)
            "#,
            keys,
        )
        .fetch_all(&self.db)
        .await
        .wrap_err("Failed to count collection saves")?;
        Ok(rows
            .into_iter()
            .map(|row| (row.id, i32::try_from(row.count).unwrap_or(i32::MAX)))
            .collect())
    }
}

/// Loads whether each (user, collection) pair is in that user's saved collections.
pub struct ViewerCollectionSavedLoader {
    db: PgPool,
}

impl ViewerCollectionSavedLoader {
    pub fn new(db: PgPool) -> Self {
        Self { db }
    }
}

impl Loader<(SbUserId, Uuid)> for ViewerCollectionSavedLoader {
    type Value = bool;
    type Error = async_graphql::Error;

    async fn load(&self, keys: &[(SbUserId, Uuid)]) -> Result<HashMap<(SbUserId, Uuid), bool>> {
        let user_ids: Vec<i32> = keys.iter().map(|(u, _)| u.0).collect();
        let ids: Vec<Uuid> = keys.iter().map(|(_, c)| *c).collect();
        let rows = sqlx::query!(
            r#"
                SELECT k.user_id as "user_id!: SbUserId", k.id as "id!",
                    EXISTS (
                        SELECT 1 FROM collection_saves s
                        WHERE s.user_id = k.user_id AND s.collection_id = k.id
                    ) as "saved!"
                FROM unnest($1::int[], $2::uuid[]) AS k(user_id, id)
            "#,
            &user_ids,
            &ids,
        )
        .fetch_all(&self.db)
        .await
        .wrap_err("Failed to load saved collections")?;
        Ok(rows
            .into_iter()
            .map(|row| ((row.user_id, row.id), row.saved))
            .collect())
    }
}

/// That staff hid a collection, and why.
#[derive(SimpleObject, Clone, Debug)]
pub struct MapCollectionHidden {
    pub id: String,
    /// What staff told the owner.
    pub note: String,
    pub hidden_at: DateTime<Utc>,
}

/// A collection, as the viewer who loaded it sees it.
pub struct MapCollection {
    row: CollectionRow,
    viewer: Viewer,
}

impl MapCollection {
    fn view(&self) -> CollectionView {
        CollectionView {
            id: self.row.id,
            listed_only: !self.row.sees_all_entries(self.viewer),
        }
    }

    async fn content(&self, ctx: &Context<'_>) -> Result<CollectionContent> {
        Ok(ctx
            .data::<DataLoader<CollectionContentLoader>>()?
            .load_one(self.view())
            .await?
            .unwrap_or_default())
    }
}

/// A named, ordered list of maps: a player's own collection, a player's Starred maps, or a
/// collection made by staff. Everyone other than its owner (and, for a staff collection, users who
/// can manage maps) sees only its listed maps, and its `mapCount` and `cover` count only those.
#[Object]
impl MapCollection {
    async fn id(&self) -> Uuid {
        self.row.id
    }

    async fn kind(&self) -> CollectionKind {
        self.row.kind
    }

    /// The title its owner or staff gave it. Null for `STARRED` and `LADDER_POOL`, which the
    /// client names.
    async fn title(&self) -> Option<&str> {
        self.row.title.as_deref()
    }

    /// Plain text, possibly empty.
    async fn description(&self) -> &str {
        &self.row.description
    }

    /// The player whose collection it is. Null for `STAFF` and `LADDER_POOL`.
    async fn owner(&self, ctx: &Context<'_>) -> Result<Option<SbUser>> {
        load_user(ctx, self.row.owner_id).await
    }

    /// Whether everyone can see the collection: always for `STAFF`, and for `USER` while its owner
    /// has made it public and staff haven't hidden it.
    async fn public(&self) -> bool {
        self.row.is_public()
    }

    /// That staff hid the collection, keeping it from everyone but its owner and staff. Only shown
    /// to its owner and to users who can manage maps; null otherwise, and while it isn't hidden.
    async fn hidden(&self) -> Option<MapCollectionHidden> {
        if !self.row.sees_hidden(self.viewer) {
            return None;
        }
        match (self.row.hidden_at, &self.row.hidden_note) {
            (Some(hidden_at), Some(note)) => Some(MapCollectionHidden {
                id: format!("map-collection-hidden:{}", self.row.id),
                note: note.clone(),
                hidden_at,
            }),
            _ => None,
        }
    }

    /// How many maps the viewer sees in the collection.
    async fn map_count(&self, ctx: &Context<'_>) -> Result<i32> {
        Ok(self.content(ctx).await?.map_count)
    }

    /// The first 4 maps the viewer sees, in the collection's order.
    async fn cover(&self, ctx: &Context<'_>) -> Result<Vec<SbMap>> {
        let cover = self.content(ctx).await?.cover;
        let mut maps = ctx
            .data::<DataLoader<SbMapLoader>>()?
            .load_many(cover.iter().copied())
            .await?;
        Ok(cover.iter().filter_map(|id| maps.remove(id)).collect())
    }

    /// How many players saved the collection.
    async fn save_count(&self, ctx: &Context<'_>) -> Result<i32> {
        Ok(ctx
            .data::<DataLoader<CollectionSaveCountLoader>>()?
            .load_one(self.row.id)
            .await?
            .unwrap_or(0))
    }

    /// Whether the viewer saved the collection. False when logged out.
    async fn is_saved(&self, ctx: &Context<'_>) -> Result<bool> {
        let Some(user) = self.viewer.id else {
            return Ok(false);
        };
        Ok(ctx
            .data::<DataLoader<ViewerCollectionSavedLoader>>()?
            .load_one((user, self.row.id))
            .await?
            .unwrap_or(false))
    }

    /// Whether the viewer can add, remove and move the collection's maps: its owner, or for
    /// `STAFF`, users who can manage maps. `STARRED` can't be renamed, reordered or deleted, and
    /// its maps are ordered newest first.
    async fn can_edit(&self) -> bool {
        self.row.can_edit(self.viewer)
    }

    async fn created_at(&self) -> DateTime<Utc> {
        self.row.created_at
    }

    /// When its owner (or staff) last changed it or its maps.
    async fn updated_at(&self) -> DateTime<Utc> {
        self.row.updated_at
    }

    /// The maps the viewer sees in the collection, each as its current file (or, for an entry
    /// naming an exact file, that file). Takes the same arguments as `maps`; sorts by
    /// `COLLECTION_ORDER` unless told otherwise, and `NEWEST` sorts by when each map was added.
    async fn maps(
        &self,
        ctx: &Context<'_>,
        filter: Option<MapFilter>,
        sort: Option<MapSort>,
        after: Option<String>,
        first: Option<i32>,
    ) -> Result<CollectionMapConnection> {
        let view = self.view();
        let scope = MapScope::Collection {
            id: view.id,
            listed_only: view.listed_only,
        };
        load_collection_maps(ctx, scope, filter, sort, after, first).await
    }
}

/// Loads a collection as the viewer sees it, or `None` if they can't see it.
async fn load_for_viewer(
    ctx: &Context<'_>,
    id: Uuid,
    viewer: Viewer,
) -> Result<Option<MapCollection>> {
    let db = ctx.data::<MapSearchRepo>()?.db();
    Ok(collections::load(db, id)
        .await?
        .filter(|row| row.can_read(viewer))
        .map(|row| MapCollection { row, viewer }))
}

/// Loads a collection the viewer just changed.
async fn require_for_viewer(ctx: &Context<'_>, id: Uuid, viewer: Viewer) -> Result<MapCollection> {
    load_for_viewer(ctx, id, viewer)
        .await?
        .ok_or_else(|| collection_error(CollectionError::NotFound))
}

/// The collections the current user sees in their own list: their Starred collection (made now if
/// they have none), then their own collections, most recently changed first, then the collections
/// they saved and can still see, most recently saved first.
pub async fn viewer_collections(ctx: &Context<'_>, user: SbUserId) -> Result<Vec<MapCollection>> {
    let viewer = current_viewer(ctx).await?;
    let db = ctx.data::<MapSearchRepo>()?.db();
    {
        let mut conn = db.acquire().await?;
        collections::starred_id(&mut conn, user).await?;
    }
    let mut query = QueryBuilder::<Postgres>::new("SELECT ");
    query.push(COLLECTION_COLUMNS).push(
        " FROM (
            SELECT c.*, 0 AS list_group, c.updated_at AS list_at FROM collections c
            WHERE c.kind = 'starred' AND c.owner_id = ",
    );
    query.push_bind(user.0).push(
        " UNION ALL
            SELECT c.*, 1, c.updated_at FROM collections c
            WHERE c.kind = 'user' AND c.owner_id = ",
    );
    query.push_bind(user.0).push(
        " UNION ALL
            SELECT c.*, 2, s.saved_at FROM collection_saves s
            INNER JOIN collections c ON c.id = s.collection_id
            WHERE s.user_id = ",
    );
    query
        .push_bind(user.0)
        .push(") c ORDER BY c.list_group, c.list_at DESC, c.id");
    let rows = query
        .build_query_as::<CollectionRow>()
        .fetch_all(db)
        .await
        .wrap_err("Failed to load the user's collections")?;
    Ok(rows
        .into_iter()
        .filter(|row| row.can_read(viewer))
        .map(|row| MapCollection { row, viewer })
        .collect())
}

/// The staff collections, then the public collections, holding the map (family) `family_id`,
/// either as the map or as one of its files; the most saved first within each. An unlisted map
/// is only shown in collections whose every entry the viewer sees.
pub(crate) async fn family_collections(
    ctx: &Context<'_>,
    family_id: Uuid,
    first: i32,
) -> Result<Vec<MapCollection>> {
    let viewer = current_viewer(ctx).await?;
    let db = ctx.data::<MapSearchRepo>()?.db();
    let mut query = QueryBuilder::<Postgres>::new("SELECT ");
    query.push(COLLECTION_COLUMNS).push(
        " FROM collections c
        WHERE (c.kind = 'staff' OR (c.kind = 'user' AND c.published_at IS NOT NULL
                AND c.hidden_at IS NULL))
            AND EXISTS (
                SELECT 1 FROM collection_maps cm
                WHERE cm.collection_id = c.id AND (cm.family_id = ",
    );
    query
        .push_bind(family_id)
        .push(" OR cm.map_id IN (SELECT fm.id FROM maps fm WHERE fm.family_id = ");
    query.push_bind(family_id).push(
        ")))
            AND (EXISTS (SELECT 1 FROM map_families lf WHERE lf.listed AND lf.id = ",
    );
    query
        .push_bind(family_id)
        .push(") OR (c.kind = 'staff' AND ");
    query.push_bind(viewer.staff).push(") OR c.owner_id = ");
    query.push_bind(viewer.id.map(|id| id.0)).push(
        ")
        ORDER BY c.kind = 'staff' DESC,
            (SELECT count(*) FROM collection_saves s WHERE s.collection_id = c.id) DESC,
            c.created_at, c.id
        LIMIT ",
    );
    query.push_bind(i64::from(first.clamp(1, MAX_FAMILY_COLLECTIONS)));
    let rows = query
        .build_query_as::<CollectionRow>()
        .fetch_all(db)
        .await
        .wrap_err("Failed to load the map's collections")?;
    Ok(rows
        .into_iter()
        .filter(|row| row.can_read(viewer))
        .map(|row| MapCollection { row, viewer })
        .collect())
}

/// The ids of the viewer's own collections holding the map (family) `family_id`, and of the staff
/// collections holding it when the viewer can manage maps. Empty when logged out.
pub(crate) async fn viewer_collection_ids(ctx: &Context<'_>, family_id: Uuid) -> Result<Vec<Uuid>> {
    let viewer = current_viewer(ctx).await?;
    let Some(user) = viewer.id else {
        return Ok(Vec::new());
    };
    let db = ctx.data::<MapSearchRepo>()?.db();
    Ok(sqlx::query_scalar!(
        r#"
            SELECT c.id
            FROM collections c
            WHERE ((c.kind = 'user' AND c.owner_id = $2) OR (c.kind = 'staff' AND $3))
                AND EXISTS (
                    SELECT 1 FROM collection_maps cm
                    WHERE cm.collection_id = c.id AND (cm.family_id = $1
                        OR cm.map_id IN (SELECT fm.id FROM maps fm WHERE fm.family_id = $1))
                )
            ORDER BY c.created_at, c.id
        "#,
        family_id,
        user as _,
        viewer.staff,
    )
    .fetch_all(db)
    .await
    .wrap_err("Failed to load the viewer's collections holding the map")?)
}

/// Which collections `mapCollections` lists.
#[derive(Enum, Copy, Clone, Debug, Eq, PartialEq)]
pub enum MapCollectionSection {
    /// Every staff collection, oldest first.
    Staff,
    /// Players' public collections that aren't hidden and hold at least one listed map, the most
    /// saved first, then the most recently made public.
    Players,
}

/// An offset into a list of collections or reports, as carried in a cursor: the index of the last
/// item returned.
type OffsetCursor = OpaqueCursor<usize>;

fn page_bounds(after: Option<&str>, first: Option<i32>) -> Result<(usize, usize)> {
    let offset = match after {
        Some(after) => {
            OffsetCursor::decode_cursor(after)
                .map_err(|_| graphql_error("BAD_REQUEST", "invalid cursor"))?
                .0
                + 1
        }
        None => 0,
    };
    let count = first.unwrap_or(DEFAULT_PAGE_SIZE).clamp(1, MAX_PAGE_SIZE);
    Ok((offset, count as usize))
}

/// The search of a collection listing, if it has anything searchable.
fn collection_search(search: Option<String>) -> Result<Option<String>> {
    match search {
        Some(s) if s.chars().count() > MAX_SEARCH_LENGTH => Err(graphql_error(
            "BAD_REQUEST",
            format!("search must be at most {MAX_SEARCH_LENGTH} characters"),
        )),
        Some(s) if crate::maps::search::SearchQuery::new(&s).is_some() => Ok(Some(s)),
        _ => Ok(None),
    }
}

/// The players' collections listed: public, not hidden, and holding at least one map others see
/// (one whose map is listed). One that holds none still opens by its link; it just isn't listed.
const PLAYERS_ROWS: &str = "c.kind = 'user' AND c.published_at IS NOT NULL \
    AND c.hidden_at IS NULL AND EXISTS ( \
        SELECT 1 FROM collection_maps cm \
        INNER JOIN maps m ON m.id = COALESCE(cm.map_id, \
            (SELECT efam.current_map_id FROM map_families efam WHERE efam.id = cm.family_id)) \
        INNER JOIN map_families fam ON fam.id = m.family_id \
        WHERE cm.collection_id = c.id AND fam.listed)";

/// Emits the `FROM` and `WHERE` of a collection listing.
fn push_section_rows(
    query: &mut QueryBuilder<Postgres>,
    section: MapCollectionSection,
    search: Option<&str>,
) {
    query.push(" FROM collections c WHERE ");
    query.push(match section {
        MapCollectionSection::Staff => "c.kind = 'staff'",
        MapCollectionSection::Players => PLAYERS_ROWS,
    });
    if let Some(search) = search {
        query.push(" AND strpos(map_search_normalize(c.title), map_search_normalize(");
        query.push_bind(search.to_string());
        query.push(")) > 0");
    }
}

/// Facts about a whole collection listing, rather than one page of it.
pub struct MapCollectionListInfo {
    section: MapCollectionSection,
    search: Option<String>,
}

#[Object]
impl MapCollectionListInfo {
    /// How many collections the listing holds across every page.
    async fn total_count(&self, ctx: &Context<'_>) -> Result<i32> {
        let db = ctx.data::<MapSearchRepo>()?.db();
        let mut query = QueryBuilder::<Postgres>::new("SELECT count(*)");
        push_section_rows(&mut query, self.section, self.search.as_deref());
        let count = query
            .build_query_scalar::<i64>()
            .fetch_one(db)
            .await
            .wrap_err("Failed to count collections")?;
        Ok(i32::try_from(count).unwrap_or(i32::MAX))
    }
}

pub type MapCollectionConnection =
    Connection<OffsetCursor, MapCollection, MapCollectionListInfo, EmptyFields>;

/// How staff resolved a collection report.
#[derive(Enum, Copy, Clone, Debug, Eq, PartialEq)]
pub enum MapCollectionReportResolution {
    /// Staff found nothing to do.
    Dismissed,
    /// Staff hid the collection.
    Hidden,
}

/// A collection report as stored.
#[derive(Debug, Clone, FromRow)]
pub struct MapCollectionReport {
    id: Uuid,
    collection_id: Uuid,
    reporter_id: SbUserId,
    note: String,
    created_at: DateTime<Utc>,
    resolved_at: Option<DateTime<Utc>>,
    resolved_by: Option<SbUserId>,
    resolution: Option<String>,
}

const REPORT_COLUMNS: &str = "r.id, r.collection_id, r.reporter_id, r.note, r.created_at, \
    r.resolved_at, r.resolved_by, r.resolution";

/// A player's report about a public collection. Only available to users who can manage maps.
#[Object]
impl MapCollectionReport {
    async fn id(&self) -> Uuid {
        self.id
    }

    /// The reported collection. Null if staff can no longer see it (its owner made it private).
    async fn collection(&self, ctx: &Context<'_>) -> Result<Option<MapCollection>> {
        let viewer = current_viewer(ctx).await?;
        load_for_viewer(ctx, self.collection_id, viewer).await
    }

    async fn reporter(&self, ctx: &Context<'_>) -> Result<Option<SbUser>> {
        load_user(ctx, Some(self.reporter_id)).await
    }

    async fn note(&self) -> &str {
        &self.note
    }

    async fn created_at(&self) -> DateTime<Utc> {
        self.created_at
    }

    async fn resolved_at(&self) -> Option<DateTime<Utc>> {
        self.resolved_at
    }

    async fn resolved_by(&self, ctx: &Context<'_>) -> Result<Option<SbUser>> {
        load_user(ctx, self.resolved_by).await
    }

    async fn resolution(&self) -> Option<MapCollectionReportResolution> {
        match self.resolution.as_deref() {
            Some("dismissed") => Some(MapCollectionReportResolution::Dismissed),
            Some("hidden") => Some(MapCollectionReportResolution::Hidden),
            _ => None,
        }
    }
}

async fn load_report(db: &PgPool, id: Uuid) -> Result<MapCollectionReport> {
    let mut query = QueryBuilder::<Postgres>::new("SELECT ");
    query
        .push(REPORT_COLUMNS)
        .push(" FROM collection_reports r WHERE r.id = ")
        .push_bind(id);
    query
        .build_query_as::<MapCollectionReport>()
        .fetch_optional(db)
        .await
        .wrap_err("Failed to load collection report")?
        .ok_or_else(|| collection_error(CollectionError::ReportNotFound))
}

/// Emits the `WHERE` of a report listing.
fn push_report_filter(query: &mut QueryBuilder<Postgres>, open: Option<bool>) {
    query.push(match open {
        Some(true) => " WHERE r.resolved_at IS NULL",
        Some(false) => " WHERE r.resolved_at IS NOT NULL",
        None => "",
    });
}

/// Facts about a whole report listing, rather than one page of it.
pub struct MapCollectionReportListInfo {
    open: Option<bool>,
}

#[Object]
impl MapCollectionReportListInfo {
    /// How many reports the listing holds across every page.
    async fn total_count(&self, ctx: &Context<'_>) -> Result<i32> {
        let db = ctx.data::<MapSearchRepo>()?.db();
        let mut query = QueryBuilder::<Postgres>::new("SELECT count(*) FROM collection_reports r");
        push_report_filter(&mut query, self.open);
        let count = query
            .build_query_scalar::<i64>()
            .fetch_one(db)
            .await
            .wrap_err("Failed to count collection reports")?;
        Ok(i32::try_from(count).unwrap_or(i32::MAX))
    }
}

pub type MapCollectionReportConnection =
    Connection<OffsetCursor, MapCollectionReport, MapCollectionReportListInfo, EmptyFields>;

#[derive(Default)]
pub struct MapCollectionsQuery;

#[Object]
impl MapCollectionsQuery {
    /// Looks up a collection by id. Null when there's no such collection or the viewer can't see
    /// it.
    async fn map_collection(&self, ctx: &Context<'_>, id: Uuid) -> Result<Option<MapCollection>> {
        let viewer = current_viewer(ctx).await?;
        load_for_viewer(ctx, id, viewer).await
    }

    /// Pages through a section of the collections everyone can see. `search` keeps the collections
    /// whose title contains it, ignoring case, punctuation and spacing. Pages are 40 collections
    /// unless `first` says otherwise (at most 100).
    async fn map_collections(
        &self,
        ctx: &Context<'_>,
        section: MapCollectionSection,
        search: Option<String>,
        after: Option<String>,
        first: Option<i32>,
    ) -> Result<MapCollectionConnection> {
        let viewer = current_viewer(ctx).await?;
        let search = collection_search(search)?;
        let (offset, count) = page_bounds(after.as_deref(), first)?;
        let db = ctx.data::<MapSearchRepo>()?.db();

        let mut query = QueryBuilder::<Postgres>::new("SELECT ");
        query.push(COLLECTION_COLUMNS);
        push_section_rows(&mut query, section, search.as_deref());
        query.push(match section {
            MapCollectionSection::Staff => " ORDER BY c.created_at, c.id",
            MapCollectionSection::Players => {
                " ORDER BY (SELECT count(*) FROM collection_saves s WHERE s.collection_id = c.id) \
                 DESC, c.published_at DESC, c.id"
            }
        });
        query.push(" LIMIT ").push_bind((count + 1) as i64);
        query.push(" OFFSET ").push_bind(offset as i64);
        let rows = query
            .build_query_as::<CollectionRow>()
            .fetch_all(db)
            .await
            .wrap_err("Failed to load collections")?;

        let mut connection = Connection::with_additional_fields(
            offset > 0,
            rows.len() > count,
            MapCollectionListInfo { section, search },
        );
        connection.edges.extend(
            rows.into_iter()
                .take(count)
                .enumerate()
                .map(|(i, row)| Edge::new(OpaqueCursor(offset + i), MapCollection { row, viewer })),
        );
        Ok(connection)
    }

    /// Collection reports: the open ones oldest first with `open: true`, otherwise the newest
    /// first (only the resolved ones with `open: false`). Pages are 40 reports unless `first` says
    /// otherwise (at most 100). Only available to users who can manage maps.
    #[graphql(guard = RequiredPermission::ManageMaps)]
    async fn map_collection_reports(
        &self,
        ctx: &Context<'_>,
        open: Option<bool>,
        after: Option<String>,
        first: Option<i32>,
    ) -> Result<MapCollectionReportConnection> {
        let (offset, count) = page_bounds(after.as_deref(), first)?;
        let db = ctx.data::<MapSearchRepo>()?.db();
        let mut query = QueryBuilder::<Postgres>::new("SELECT ");
        query
            .push(REPORT_COLUMNS)
            .push(" FROM collection_reports r");
        push_report_filter(&mut query, open);
        query.push(if open == Some(true) {
            " ORDER BY r.created_at, r.id"
        } else {
            " ORDER BY r.created_at DESC, r.id DESC"
        });
        query.push(" LIMIT ").push_bind((count + 1) as i64);
        query.push(" OFFSET ").push_bind(offset as i64);
        let rows = query
            .build_query_as::<MapCollectionReport>()
            .fetch_all(db)
            .await
            .wrap_err("Failed to load collection reports")?;

        let mut connection = Connection::with_additional_fields(
            offset > 0,
            rows.len() > count,
            MapCollectionReportListInfo { open },
        );
        connection.edges.extend(
            rows.into_iter()
                .take(count)
                .enumerate()
                .map(|(i, report)| Edge::new(OpaqueCursor(offset + i), report)),
        );
        Ok(connection)
    }

    /// How many collection reports are open. Only available to users who can manage maps.
    #[graphql(guard = RequiredPermission::ManageMaps)]
    async fn map_collection_report_count(&self, ctx: &Context<'_>) -> Result<i32> {
        let db = ctx.data::<MapSearchRepo>()?.db();
        let count = sqlx::query_scalar!(
            r#"SELECT count(*) as "count!" FROM collection_reports WHERE resolved_at IS NULL"#,
        )
        .fetch_one(db)
        .await
        .wrap_err("Failed to count collection reports")?;
        Ok(i32::try_from(count).unwrap_or(i32::MAX))
    }
}

#[derive(Default)]
pub struct MapCollectionsMutation;

#[Object]
impl MapCollectionsMutation {
    /// Creates a private collection of the current user's (at most 100), or with `staff`, a staff
    /// collection (only for users who can manage maps). The title must be 3 to 50 characters
    /// after trimming and differ from the user's other collections' titles, ignoring case; the
    /// description may be up to 500 characters. With `addMapId`, the map that file is in is the
    /// collection's first map.
    async fn map_collection_create(
        &self,
        ctx: &Context<'_>,
        title: String,
        description: Option<String>,
        #[graphql(default)] staff: bool,
        add_map_id: Option<SbMapId>,
    ) -> Result<MapCollection> {
        let user = require_current_user(ctx)?;
        let viewer = current_viewer(ctx).await?;
        let db = ctx.data::<MapSearchRepo>()?.db();
        let add_map = match add_map_id {
            Some(id) => Some(resolve_existing_map_id(db, id).await?),
            None => None,
        };
        let id = collections::create(
            db,
            user.id,
            viewer.staff,
            &title,
            description.as_deref(),
            staff,
            add_map,
        )
        .await
        .map_err(collection_error)?;
        require_for_viewer(ctx, id, viewer).await
    }

    /// Changes a collection's title and description, and makes a player's collection public or
    /// private. Only what's given changes. Making a collection public needs a verified email, no
    /// restriction on publishing maps, and a title and description without words that aren't
    /// allowed; while it's public, its title and description are checked the same way. A hidden
    /// collection can't be made public or private. Available to the collection's owner and, for a
    /// staff collection, users who can manage maps.
    async fn map_collection_update(
        &self,
        ctx: &Context<'_>,
        id: Uuid,
        title: Option<String>,
        description: Option<String>,
        public: Option<bool>,
    ) -> Result<MapCollection> {
        require_current_user(ctx)?;
        let viewer = current_viewer(ctx).await?;
        let db = ctx.data::<MapSearchRepo>()?.db();
        collections::update(
            db,
            ctx.data::<NameChecker>()?,
            id,
            viewer,
            title.as_deref(),
            description.as_deref(),
            public,
        )
        .await
        .map_err(collection_error)?;
        require_for_viewer(ctx, id, viewer).await
    }

    /// Deletes a collection, along with its saves and reports. Starred can't be deleted. Returns
    /// the deleted collection's id.
    async fn map_collection_delete(&self, ctx: &Context<'_>, id: Uuid) -> Result<Uuid> {
        require_current_user(ctx)?;
        let viewer = current_viewer(ctx).await?;
        let db = ctx.data::<MapSearchRepo>()?.db();
        collections::delete(db, id, viewer)
            .await
            .map_err(collection_error)?;
        Ok(id)
    }

    /// Adds the map a file is in to the end of a collection (at most 200 maps; Starred has no
    /// limit). Adding a map that's already in does nothing.
    async fn map_collection_add_map(
        &self,
        ctx: &Context<'_>,
        collection_id: Uuid,
        map_id: SbMapId,
    ) -> Result<MapCollection> {
        require_current_user(ctx)?;
        let viewer = current_viewer(ctx).await?;
        let db = ctx.data::<MapSearchRepo>()?.db();
        let map_id = resolve_existing_map_id(db, map_id).await?;
        collections::add_map(db, collection_id, viewer, map_id)
            .await
            .map_err(collection_error)?;
        require_for_viewer(ctx, collection_id, viewer).await
    }

    /// Removes the map a file is in from a collection. Removing a map that isn't in does nothing.
    async fn map_collection_remove_map(
        &self,
        ctx: &Context<'_>,
        collection_id: Uuid,
        map_id: SbMapId,
    ) -> Result<MapCollection> {
        require_current_user(ctx)?;
        let viewer = current_viewer(ctx).await?;
        let db = ctx.data::<MapSearchRepo>()?.db();
        let map_id = resolve_existing_map_id(db, map_id).await?;
        collections::remove_map(db, collection_id, viewer, map_id)
            .await
            .map_err(collection_error)?;
        require_for_viewer(ctx, collection_id, viewer).await
    }

    /// Moves the map a file is in to `toIndex` (from 0) in a collection's order, shifting the maps
    /// between. An index past the end moves it to the end. Starred can't be reordered.
    async fn map_collection_move_map(
        &self,
        ctx: &Context<'_>,
        collection_id: Uuid,
        map_id: SbMapId,
        to_index: i32,
    ) -> Result<MapCollection> {
        require_current_user(ctx)?;
        let viewer = current_viewer(ctx).await?;
        let db = ctx.data::<MapSearchRepo>()?.db();
        let map_id = resolve_existing_map_id(db, map_id).await?;
        collections::move_map(db, collection_id, viewer, map_id, to_index)
            .await
            .map_err(collection_error)?;
        require_for_viewer(ctx, collection_id, viewer).await
    }

    /// Saves someone else's collection to the current user's list (at most 500). Saving a saved
    /// collection does nothing.
    async fn map_collection_save(&self, ctx: &Context<'_>, id: Uuid) -> Result<MapCollection> {
        require_current_user(ctx)?;
        let viewer = current_viewer(ctx).await?;
        let db = ctx.data::<MapSearchRepo>()?.db();
        collections::save(db, id, viewer)
            .await
            .map_err(collection_error)?;
        require_for_viewer(ctx, id, viewer).await
    }

    /// Takes a collection out of the current user's saved list. Unsaving a collection that isn't
    /// saved does nothing. Returns the collection, or null when the user can no longer see it (it
    /// was made private, hidden or deleted), which is still unsaved.
    async fn map_collection_unsave(
        &self,
        ctx: &Context<'_>,
        id: Uuid,
    ) -> Result<Option<MapCollection>> {
        let user = require_current_user(ctx)?;
        let viewer = current_viewer(ctx).await?;
        let db = ctx.data::<MapSearchRepo>()?.db();
        collections::unsave(db, id, user.id).await?;
        load_for_viewer(ctx, id, viewer).await
    }

    /// Tells staff something is wrong with a public player's collection. The note is required
    /// (at most 500 characters). Reporting it again while the report is open replaces the note.
    /// A user can file at most 10 collection reports an hour; replacing a note doesn't count.
    async fn map_collection_report(
        &self,
        ctx: &Context<'_>,
        id: Uuid,
        note: String,
    ) -> Result<MapCollection> {
        require_current_user(ctx)?;
        let viewer = current_viewer(ctx).await?;
        let db = ctx.data::<MapSearchRepo>()?.db();
        collections::report(db, id, viewer, &note)
            .await
            .map_err(collection_error)?;
        require_for_viewer(ctx, id, viewer).await
    }

    /// Hides a player's collection from everyone but its owner and staff, telling its owner why
    /// (`note`, required, at most 500 characters), and resolves its open reports. Its owner can
    /// still edit and delete it, but can't make it public or private until staff unhide it.
    /// Hiding a hidden collection replaces the note. Only available to users who can manage maps.
    #[graphql(guard = RequiredPermission::ManageMaps)]
    async fn map_collection_hide(
        &self,
        ctx: &Context<'_>,
        id: Uuid,
        note: String,
    ) -> Result<MapCollection> {
        let user = require_current_user(ctx)?;
        let viewer = current_viewer(ctx).await?;
        let db = ctx.data::<MapSearchRepo>()?.db();
        collections::hide(db, id, user.id, &note)
            .await
            .map_err(collection_error)?;
        require_for_viewer(ctx, id, viewer).await
    }

    /// Shows a hidden collection again. Only available to users who can manage maps.
    #[graphql(guard = RequiredPermission::ManageMaps)]
    async fn map_collection_unhide(&self, ctx: &Context<'_>, id: Uuid) -> Result<MapCollection> {
        let user = require_current_user(ctx)?;
        let viewer = current_viewer(ctx).await?;
        let db = ctx.data::<MapSearchRepo>()?.db();
        collections::unhide(db, id, user.id)
            .await
            .map_err(collection_error)?;
        require_for_viewer(ctx, id, viewer).await
    }

    /// Dismisses an open collection report, leaving the collection as it is. Returns the report.
    /// Only available to users who can manage maps.
    #[graphql(guard = RequiredPermission::ManageMaps)]
    async fn map_collection_report_dismiss(
        &self,
        ctx: &Context<'_>,
        report_id: Uuid,
    ) -> Result<MapCollectionReport> {
        let user = require_current_user(ctx)?;
        let db = ctx.data::<MapSearchRepo>()?.db();
        collections::dismiss_report(db, report_id, user.id)
            .await
            .map_err(collection_error)?;
        load_report(db, report_id).await
    }
}
