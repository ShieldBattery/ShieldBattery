//! The GraphQL API of map families: each family's files and current file, staff edits, and reports
//! from users.

use std::collections::{HashMap, HashSet};
use std::sync::Arc;

use async_graphql::dataloader::{DataLoader, Loader};
use async_graphql::{Context, InputObject, Object, Result};
use chrono::{DateTime, Utc};
use color_eyre::eyre::WrapErr;
use serde::{Deserialize, Serialize};
use sqlx::PgPool;
use typeshare::typeshare;
use uuid::Uuid;

use crate::graphql::errors::graphql_error;
use crate::maps::SbMapId;
use crate::maps::catalog::{
    MapStats, MapStatsKey, SbMap, SbMapLoader, ViewerMapFlagsLoader, is_staff, load_sb_map,
    load_user, require_current_user, resolve_existing_map_id,
};
use crate::maps::families::edit::{
    self, FamilyEditError, FileMove, MapFamilyReportKind, MapFamilyReportStatus, ReportRequest,
};
use crate::maps::families::history::{self, MapFamilyHistory};
use crate::maps::families::{resolve_family_id, resolve_map_page_id};
use crate::maps::search::MapSearchRepo;
use crate::maps::similarity::{self, SimilarFile};
use crate::maps::stats::{self, DEFAULT_ACTIVITY_WEEKS, MapWeeklyActivity};
use crate::redis::RedisPool;
use crate::users::permissions::RequiredPermission;
use crate::users::{CurrentUser, SbUser, SbUserId};

/// The most reports or history entries one page may hold.
const MAX_PAGE: i32 = 100;

/// A family as stored.
#[derive(Debug, Clone)]
pub struct MapFamilyRow {
    pub id: Uuid,
    pub default_map_id: Option<SbMapId>,
    pub default_set_by: Option<SbUserId>,
    pub default_set_at: Option<DateTime<Utc>>,
    pub current_map_id: SbMapId,
    pub listed: bool,
}

/// Loads families by id. Aliases aren't resolved here: see [`resolve_family_id`].
pub struct MapFamilyLoader {
    db: PgPool,
}

impl MapFamilyLoader {
    pub fn new(db: PgPool) -> Self {
        Self { db }
    }
}

impl Loader<Uuid> for MapFamilyLoader {
    type Value = MapFamilyRow;
    type Error = async_graphql::Error;

    async fn load(&self, keys: &[Uuid]) -> Result<HashMap<Uuid, MapFamilyRow>> {
        let rows = sqlx::query_as!(
            MapFamilyRow,
            r#"
                SELECT id, default_map_id as "default_map_id: SbMapId",
                    default_set_by as "default_set_by: SbUserId", default_set_at,
                    current_map_id as "current_map_id: SbMapId", listed
                FROM map_families
                WHERE id = ANY($1)
            "#,
            keys,
        )
        .fetch_all(&self.db)
        .await
        .wrap_err("Failed to load families")?;
        Ok(rows.into_iter().map(|row| (row.id, row)).collect())
    }
}

/// One file of a family, as [`MapFamilyFilesLoader`] lists it.
#[derive(Debug, Clone, Copy)]
pub struct FamilyFile {
    pub id: SbMapId,
    pub listed: bool,
}

/// Loads every file of families, by family id: the most played first, then the newest.
pub struct MapFamilyFilesLoader {
    db: PgPool,
}

impl MapFamilyFilesLoader {
    pub fn new(db: PgPool) -> Self {
        Self { db }
    }
}

impl Loader<Uuid> for MapFamilyFilesLoader {
    type Value = Arc<Vec<FamilyFile>>;
    type Error = async_graphql::Error;

    async fn load(&self, keys: &[Uuid]) -> Result<HashMap<Uuid, Arc<Vec<FamilyFile>>>> {
        let rows = sqlx::query!(
            r#"
                SELECT m.family_id, m.id as "id: SbMapId", m.listed as "listed!"
                FROM maps m
                WHERE m.family_id = ANY($1)
                ORDER BY
                    (SELECT s.games_total FROM map_stats s WHERE s.map_id = m.id)
                        DESC NULLS LAST,
                    m.first_seen_at DESC,
                    m.id
            "#,
            keys,
        )
        .fetch_all(&self.db)
        .await
        .wrap_err("Failed to load family files")?;
        let mut files: HashMap<Uuid, Vec<FamilyFile>> = HashMap::new();
        for row in rows {
            files.entry(row.family_id).or_default().push(FamilyFile {
                id: row.id,
                listed: row.listed,
            });
        }
        Ok(files
            .into_iter()
            .map(|(id, files)| (id, Arc::new(files)))
            .collect())
    }
}

/// Loads families' play stats, summed over their files. Only families of more than one file that
/// have been played have them.
pub struct MapFamilyStatsLoader {
    db: PgPool,
}

impl MapFamilyStatsLoader {
    pub fn new(db: PgPool) -> Self {
        Self { db }
    }
}

impl Loader<Uuid> for MapFamilyStatsLoader {
    type Value = MapStats;
    type Error = async_graphql::Error;

    async fn load(&self, keys: &[Uuid]) -> Result<HashMap<Uuid, MapStats>> {
        let rows = sqlx::query!(
            r#"
                SELECT family_id, games_7d, games_28d, games_90d, games_total, players_90d,
                    median_length_90d, last_played_at, trending_score
                FROM map_family_stats
                WHERE family_id = ANY($1)
            "#,
            keys,
        )
        .fetch_all(&self.db)
        .await
        .wrap_err("Failed to load family stats")?;
        Ok(rows
            .into_iter()
            .map(|row| {
                (
                    row.family_id,
                    MapStats {
                        key: MapStatsKey::Family(row.family_id),
                        games_7d: row.games_7d,
                        games_28d: row.games_28d,
                        games_90d: row.games_90d,
                        games_total: row.games_total,
                        players_90d: row.players_90d,
                        median_length_90d: row.median_length_90d,
                        last_played_at: row.last_played_at,
                        trending_score: row.trending_score,
                    },
                )
            })
            .collect())
    }
}

pub(crate) async fn load_family(ctx: &Context<'_>, id: Uuid) -> Result<MapFamily> {
    ctx.data::<DataLoader<MapFamilyLoader>>()?
        .load_one(id)
        .await?
        .map(MapFamily)
        .ok_or_else(|| graphql_error("NOT_FOUND", "Map not found"))
}

async fn load_family_files(ctx: &Context<'_>, id: Uuid) -> Result<Arc<Vec<FamilyFile>>> {
    Ok(ctx
        .data::<DataLoader<MapFamilyFilesLoader>>()?
        .load_one(id)
        .await?
        .unwrap_or_default())
}

/// Which of `ids` (unlisted files) are in the viewer's library.
async fn in_viewer_library(
    ctx: &Context<'_>,
    viewer: &CurrentUser,
    ids: impl Iterator<Item = SbMapId>,
) -> Result<HashSet<SbMapId>> {
    let flags = ctx
        .data::<DataLoader<ViewerMapFlagsLoader>>()?
        .load_many(ids.map(|id| (viewer.id, id)))
        .await?;
    Ok(flags
        .into_iter()
        .filter(|(_, flags)| flags.in_library)
        .map(|((_, id), _)| id)
        .collect())
}

pub struct MapFamily(pub MapFamilyRow);

/// A map as players know it ("Fighting Spirit"), made of one or more map files. Every file is in
/// exactly one family. Any family can be viewed by anyone who has its id.
#[Object]
impl MapFamily {
    async fn id(&self) -> Uuid {
        self.0.id
    }

    /// The map's name: its current file's name.
    async fn name(&self, ctx: &Context<'_>) -> Result<String> {
        Ok(load_sb_map(ctx, self.0.current_map_id).await?.name)
    }

    /// Whether any of the map's files is listed.
    async fn listed(&self) -> bool {
        self.0.listed
    }

    /// The file players get when they pick this map: staff's pick while it's eligible, otherwise
    /// the most played (listed files before unlisted ones), then the newest. A listed map's
    /// current file is always listed.
    async fn current(&self, ctx: &Context<'_>) -> Result<SbMap> {
        load_sb_map(ctx, self.0.current_map_id).await
    }

    /// The file staff picked as the map's default, even while it isn't eligible (it's unlisted
    /// while another file is listed). Null when the default is derived, or when the viewer can't
    /// see the picked file (see `files`).
    async fn default_map(&self, ctx: &Context<'_>) -> Result<Option<SbMap>> {
        let Some(id) = self.0.default_map_id else {
            return Ok(None);
        };
        let map = load_sb_map(ctx, id).await?;
        if map.listed || id == self.0.current_map_id || is_staff(ctx).await {
            return Ok(Some(map));
        }
        let Some(viewer) = ctx.data::<Option<CurrentUser>>()? else {
            return Ok(None);
        };
        Ok(in_viewer_library(ctx, viewer, [id].into_iter())
            .await?
            .contains(&id)
            .then_some(map))
    }

    /// When staff picked the default. Null when the default is derived.
    async fn default_set_at(&self) -> Option<DateTime<Utc>> {
        self.0.default_set_at
    }

    /// The user who picked the default. Only available to users who can manage maps.
    #[graphql(guard = RequiredPermission::ManageMaps)]
    async fn default_set_by(&self, ctx: &Context<'_>) -> Result<Option<SbUser>> {
        load_user(ctx, self.0.default_set_by).await
    }

    /// The map's files that the viewer can see, the current file first, then the most played, then
    /// the newest. Users who can manage maps see every file; everyone else sees the listed files,
    /// the current file, and the unlisted files in their own library.
    async fn files(&self, ctx: &Context<'_>) -> Result<Vec<SbMap>> {
        let files = load_family_files(ctx, self.0.id).await?;
        let staff = is_staff(ctx).await;
        let own: HashSet<SbMapId> = match ctx.data::<Option<CurrentUser>>()? {
            Some(viewer) if !staff => {
                in_viewer_library(
                    ctx,
                    viewer,
                    files
                        .iter()
                        .filter(|f| !f.listed && f.id != self.0.current_map_id)
                        .map(|f| f.id),
                )
                .await?
            }
            _ => HashSet::new(),
        };
        let visible: Vec<SbMapId> = files
            .iter()
            .filter(|f| staff || f.listed || f.id == self.0.current_map_id || own.contains(&f.id))
            .map(|f| f.id)
            .collect();
        let current = self.0.current_map_id;
        let ordered: Vec<SbMapId> = std::iter::once(current)
            .chain(visible.into_iter().filter(|&id| id != current))
            .collect();
        let mut maps = ctx
            .data::<DataLoader<SbMapLoader>>()?
            .load_many(ordered.iter().copied())
            .await?;
        Ok(ordered.iter().filter_map(|id| maps.remove(id)).collect())
    }

    /// Play statistics summed over every file of the map, or null if none has been played.
    /// Recomputed hourly; until then a map's stats are its current file's.
    async fn stats(&self, ctx: &Context<'_>) -> Result<Option<MapStats>> {
        if let Some(stats) = ctx
            .data::<DataLoader<MapFamilyStatsLoader>>()?
            .load_one(self.0.id)
            .await?
        {
            return Ok(Some(stats));
        }
        Ok(load_sb_map(ctx, self.0.current_map_id).await?.stats)
    }

    /// The games played on any of the map's files in each of the last `weeks` weeks (at most 104),
    /// oldest first. Weeks start on Monday (UTC) and end with the current week, which is still in
    /// progress. Weeks without games are included.
    async fn weekly_activity(
        &self,
        ctx: &Context<'_>,
        #[graphql(default_with = "DEFAULT_ACTIVITY_WEEKS")] weeks: i32,
    ) -> Result<Vec<MapWeeklyActivity>> {
        // Only the map page selects this, one map at a time, so it isn't batched
        let db = ctx.data::<MapSearchRepo>()?.db();
        let files = load_family_files(ctx, self.0.id).await?;
        let ids: Vec<Uuid> = files.iter().map(|f| f.id.0).collect();
        let weeks = stats::clamp_activity_weeks(weeks);
        let today = Utc::now().date_naive();
        Ok(stats::load_weekly_activity(
            db,
            &format!("map-family:{}", self.0.id),
            &ids,
            weeks,
            today,
        )
        .await?)
    }
}

/// What a map page id named.
pub struct MapFamilyLookup {
    requested_id: Uuid,
    family: MapFamilyRow,
    file_id: Option<SbMapId>,
}

/// The map an id from a map page URL names, and the file it named, if it named one.
#[Object]
impl MapFamilyLookup {
    /// The id that was looked up.
    async fn id(&self) -> Uuid {
        self.requested_id
    }

    async fn family(&self) -> MapFamily {
        MapFamily(self.family.clone())
    }

    /// The file the id named, when it was a file's id (or an old id of one) rather than a map's.
    async fn file(&self, ctx: &Context<'_>) -> Result<Option<SbMap>> {
        match self.file_id {
            Some(id) => load_sb_map(ctx, id).await.map(Some),
            None => Ok(None),
        }
    }
}

/// A listed file whose terrain is similar to another file's.
pub struct MapSimilarFile {
    file_id: SbMapId,
    similar: SimilarFile,
}

#[Object]
impl MapSimilarFile {
    async fn id(&self) -> String {
        format!("map-similar-file:{}:{}", self.file_id, self.similar.id)
    }

    async fn map(&self, ctx: &Context<'_>) -> Result<SbMap> {
        load_sb_map(ctx, self.similar.id).await
    }

    /// The share of the walkable terrain the files have in common, from 0.9 to 1.
    async fn similarity(&self) -> f64 {
        f64::from(self.similar.similarity)
    }
}

/// The outcome of moving a file between maps.
pub struct MapFamilyFileMove {
    file_id: SbMapId,
    moved: FileMove,
}

#[Object]
impl MapFamilyFileMove {
    async fn id(&self) -> String {
        format!("map-family-file-move:{}", self.moved.history_id)
    }

    async fn file(&self, ctx: &Context<'_>) -> Result<SbMap> {
        load_sb_map(ctx, self.file_id).await
    }

    /// The map the file is in now.
    async fn family(&self, ctx: &Context<'_>) -> Result<MapFamily> {
        load_family(ctx, self.moved.family_id).await
    }

    /// The map the file left. Null when it had no other files, so it was merged into `family`.
    async fn previous_family(&self, ctx: &Context<'_>) -> Result<Option<MapFamily>> {
        match self.moved.previous_family_id {
            Some(id) => load_family(ctx, id).await.map(Some),
            None => Ok(None),
        }
    }
}

#[derive(Debug, Clone)]
pub struct MapFamilyReport {
    pub id: Uuid,
    pub kind: String,
    pub family_id: Uuid,
    pub map_id: Option<SbMapId>,
    pub other_family_id: Option<Uuid>,
    pub note: Option<String>,
    pub reported_by: SbUserId,
    pub reported_at: DateTime<Utc>,
    pub status: String,
    pub resolved_by: Option<SbUserId>,
    pub resolved_at: Option<DateTime<Utc>>,
}

/// Loads a family by an id that may since have been merged into another family.
async fn load_family_through_aliases(ctx: &Context<'_>, id: Uuid) -> Result<Option<MapFamily>> {
    let db = ctx.data::<MapSearchRepo>()?.db();
    match resolve_family_id(db, id).await? {
        Some(id) => load_family(ctx, id).await.map(Some),
        None => Ok(None),
    }
}

/// A user's report that a file isn't part of its map, or that a map is the same as another one.
#[Object]
impl MapFamilyReport {
    async fn id(&self) -> Uuid {
        self.id
    }

    async fn kind(&self) -> MapFamilyReportKind {
        MapFamilyReportKind::from_db(&self.kind)
    }

    /// The map the report is about: the map the file was in when it was reported, or the map said
    /// to be the same as `otherFamily`. If it has since been merged, the map it was merged into.
    async fn family(&self, ctx: &Context<'_>) -> Result<Option<MapFamily>> {
        load_family_through_aliases(ctx, self.family_id).await
    }

    /// The file said not to be part of `family`. Only for `WRONG_MAP`.
    async fn map(&self, ctx: &Context<'_>) -> Result<Option<SbMap>> {
        match self.map_id {
            Some(id) => load_sb_map(ctx, id).await.map(Some),
            None => Ok(None),
        }
    }

    /// The map said to be the same as `family`. Only for `SAME_MAP`. If it has since been merged,
    /// the map it was merged into.
    async fn other_family(&self, ctx: &Context<'_>) -> Result<Option<MapFamily>> {
        match self.other_family_id {
            Some(id) => load_family_through_aliases(ctx, id).await,
            None => Ok(None),
        }
    }

    async fn note(&self) -> Option<&str> {
        self.note.as_deref()
    }

    async fn reported_at(&self) -> DateTime<Utc> {
        self.reported_at
    }

    async fn status(&self) -> MapFamilyReportStatus {
        MapFamilyReportStatus::from_db(&self.status)
    }

    /// Only available to users who can manage maps.
    #[graphql(guard = RequiredPermission::ManageMaps)]
    async fn reported_by(&self, ctx: &Context<'_>) -> Result<Option<SbUser>> {
        load_user(ctx, Some(self.reported_by)).await
    }

    /// Only available to users who can manage maps.
    #[graphql(guard = RequiredPermission::ManageMaps)]
    async fn resolved_by(&self, ctx: &Context<'_>) -> Result<Option<SbUser>> {
        load_user(ctx, self.resolved_by).await
    }

    async fn resolved_at(&self) -> Option<DateTime<Utc>> {
        self.resolved_at
    }
}

async fn load_report(db: &PgPool, id: Uuid) -> color_eyre::Result<Option<MapFamilyReport>> {
    sqlx::query_as!(
        MapFamilyReport,
        r#"
            SELECT id, kind, family_id, map_id as "map_id: SbMapId", other_family_id, note,
                reported_by as "reported_by: SbUserId", reported_at, status,
                resolved_by as "resolved_by: SbUserId", resolved_at
            FROM map_family_reports
            WHERE id = $1
        "#,
        id,
    )
    .fetch_optional(db)
    .await
    .wrap_err("Failed to load family report")
}

fn edit_error(error: FamilyEditError) -> async_graphql::Error {
    let code = match &error {
        FamilyEditError::MapNotFound
        | FamilyEditError::FamilyNotFound
        | FamilyEditError::ReportNotFound => "NOT_FOUND",
        FamilyEditError::ReportingRestricted => "RESTRICTED",
        FamilyEditError::TooManyReports => "RATE_LIMITED",
        FamilyEditError::Other(e) => return async_graphql::Error::new(format!("{e:?}")),
        _ => "BAD_REQUEST",
    };
    graphql_error(code, error.to_string())
}

async fn resolve_existing_family_id(db: &PgPool, id: Uuid) -> Result<Uuid> {
    resolve_family_id(db, id)
        .await?
        .ok_or_else(|| graphql_error("NOT_FOUND", "Map not found"))
}

#[derive(Default)]
pub struct MapFamiliesQuery;

#[Object]
impl MapFamiliesQuery {
    /// Looks up the map an id from a map page URL names, trying it in order as a map's id, an old
    /// id of a map that was merged into another one, a file's id, and an old id of a file. A
    /// file's id gives the map the file is in, along with the file.
    async fn map_family(&self, ctx: &Context<'_>, id: Uuid) -> Result<Option<MapFamilyLookup>> {
        let db = ctx.data::<MapSearchRepo>()?.db();
        let Some(resolved) = resolve_map_page_id(db, id).await? else {
            return Ok(None);
        };
        let Some(family) = ctx
            .data::<DataLoader<MapFamilyLoader>>()?
            .load_one(resolved.family_id)
            .await?
        else {
            return Ok(None);
        };
        Ok(Some(MapFamilyLookup {
            requested_id: id,
            family,
            file_id: resolved.file_id,
        }))
    }

    /// The listed files of other maps whose terrain is at least 90% similar to a file's, the most
    /// similar first. Only files of the same dimensions can be compared. Only available to users
    /// who can manage maps.
    #[graphql(guard = RequiredPermission::ManageMaps)]
    async fn similar_files(
        &self,
        ctx: &Context<'_>,
        file_id: SbMapId,
    ) -> Result<Vec<MapSimilarFile>> {
        let db = ctx.data::<MapSearchRepo>()?.db();
        let file_id = resolve_existing_map_id(db, file_id).await?;
        Ok(similarity::similar_files(db, file_id)
            .await?
            .into_iter()
            .map(|similar| MapSimilarFile { file_id, similar })
            .collect())
    }

    /// Family reports with a status, oldest first. Only available to users who can manage maps.
    #[graphql(guard = RequiredPermission::ManageMaps)]
    async fn map_family_reports(
        &self,
        ctx: &Context<'_>,
        #[graphql(default_with = "MapFamilyReportStatus::Open")] status: MapFamilyReportStatus,
        #[graphql(default = 20)] limit: i32,
        #[graphql(default = 0)] offset: i32,
    ) -> Result<Vec<MapFamilyReport>> {
        let db = ctx.data::<MapSearchRepo>()?.db();
        Ok(sqlx::query_as!(
            MapFamilyReport,
            r#"
                SELECT id, kind, family_id, map_id as "map_id: SbMapId", other_family_id, note,
                    reported_by as "reported_by: SbUserId", reported_at, status,
                    resolved_by as "resolved_by: SbUserId", resolved_at
                FROM map_family_reports
                WHERE status = $1
                ORDER BY reported_at, id
                LIMIT $2 OFFSET $3
            "#,
            status.as_str(),
            i64::from(limit.clamp(1, MAX_PAGE)),
            i64::from(offset.max(0)),
        )
        .fetch_all(db)
        .await
        .wrap_err("Failed to load family reports")?)
    }

    /// A family report by its id, whatever its status. Only available to users who can manage
    /// maps.
    #[graphql(guard = RequiredPermission::ManageMaps)]
    async fn map_family_report_by_id(
        &self,
        ctx: &Context<'_>,
        id: Uuid,
    ) -> Result<Option<MapFamilyReport>> {
        let db = ctx.data::<MapSearchRepo>()?.db();
        Ok(load_report(db, id).await?)
    }

    /// How many family reports have a status. Only available to users who can manage maps.
    #[graphql(guard = RequiredPermission::ManageMaps)]
    async fn map_family_report_count(
        &self,
        ctx: &Context<'_>,
        #[graphql(default_with = "MapFamilyReportStatus::Open")] status: MapFamilyReportStatus,
    ) -> Result<i32> {
        let db = ctx.data::<MapSearchRepo>()?.db();
        let count = sqlx::query_scalar!(
            r#"SELECT count(*) as "count!" FROM map_family_reports WHERE status = $1"#,
            status.as_str(),
        )
        .fetch_one(db)
        .await
        .wrap_err("Failed to count family reports")?;
        Ok(i32::try_from(count).unwrap_or(i32::MAX))
    }

    /// Changes staff made to families and family reports, newest first. Filtered to changes about
    /// any of `familyIds` (including maps since merged into them) or `mapIds` when either is given,
    /// and to changes `actorId` made. Only available to users who can manage maps.
    #[graphql(guard = RequiredPermission::ManageMaps)]
    async fn map_family_history(
        &self,
        ctx: &Context<'_>,
        family_ids: Option<Vec<Uuid>>,
        map_ids: Option<Vec<SbMapId>>,
        actor_id: Option<SbUserId>,
        #[graphql(default = 50)] limit: i32,
        #[graphql(default = 0)] offset: i32,
    ) -> Result<Vec<MapFamilyHistory>> {
        let db = ctx.data::<MapSearchRepo>()?.db();
        Ok(history::load_history(
            db,
            family_ids.as_deref(),
            map_ids.as_deref(),
            actor_id,
            i64::from(limit.clamp(1, MAX_PAGE)),
            i64::from(offset.max(0)),
        )
        .await?)
    }
}

/// A user's report about a map.
#[derive(InputObject, Clone, Debug)]
pub struct MapFamilyReportInput {
    pub kind: MapFamilyReportKind,
    /// The file that isn't part of its map. Required for `WRONG_MAP`, ignored otherwise.
    pub map_id: Option<SbMapId>,
    /// The map that is the same as `otherFamilyId`. Required for `SAME_MAP`, ignored otherwise.
    pub family_id: Option<Uuid>,
    /// The map that is the same as `familyId`. Required for `SAME_MAP`, ignored otherwise.
    pub other_family_id: Option<Uuid>,
    pub note: Option<String>,
}

#[derive(Default)]
pub struct MapFamiliesMutation;

#[Object]
impl MapFamiliesMutation {
    /// Moves a file to another map. A map left without files is merged into the other map: its id
    /// keeps working as an alias, and its favorites move along. Only available to users who can
    /// manage maps.
    #[graphql(guard = RequiredPermission::ManageMaps)]
    async fn map_family_move_file(
        &self,
        ctx: &Context<'_>,
        file_id: SbMapId,
        family_id: Uuid,
    ) -> Result<MapFamilyFileMove> {
        let user = require_current_user(ctx)?;
        let db = ctx.data::<MapSearchRepo>()?.db();
        let file_id = resolve_existing_map_id(db, file_id).await?;
        let family_id = resolve_existing_family_id(db, family_id).await?;
        let mut tx = db.begin().await?;
        let moved = edit::move_file(&mut tx, file_id, family_id, user.id)
            .await
            .map_err(edit_error)?;
        tx.commit().await?;
        Ok(MapFamilyFileMove { file_id, moved })
    }

    /// Moves a file out of its map into a new map of its own. Only available to users who can
    /// manage maps.
    #[graphql(guard = RequiredPermission::ManageMaps)]
    async fn map_family_split_file(
        &self,
        ctx: &Context<'_>,
        file_id: SbMapId,
    ) -> Result<MapFamilyFileMove> {
        let user = require_current_user(ctx)?;
        let db = ctx.data::<MapSearchRepo>()?.db();
        let file_id = resolve_existing_map_id(db, file_id).await?;
        let mut tx = db.begin().await?;
        let moved = edit::split_file(&mut tx, file_id, user.id)
            .await
            .map_err(edit_error)?;
        tx.commit().await?;
        Ok(MapFamilyFileMove { file_id, moved })
    }

    /// Moves every file of `familyId` into `intoFamilyId`. `familyId`'s id keeps working as an
    /// alias of `intoFamilyId`, its favorites move along, and its default pick is dropped. Returns
    /// the map merged into. Only available to users who can manage maps.
    #[graphql(guard = RequiredPermission::ManageMaps)]
    async fn map_family_merge(
        &self,
        ctx: &Context<'_>,
        family_id: Uuid,
        into_family_id: Uuid,
    ) -> Result<MapFamily> {
        let user = require_current_user(ctx)?;
        let db = ctx.data::<MapSearchRepo>()?.db();
        let family_id = resolve_existing_family_id(db, family_id).await?;
        let into_family_id = resolve_existing_family_id(db, into_family_id).await?;
        let mut tx = db.begin().await?;
        edit::merge(&mut tx, family_id, into_family_id, user.id)
            .await
            .map_err(edit_error)?;
        tx.commit().await?;
        load_family(ctx, into_family_id).await
    }

    /// Makes a file its map's default, the file players get. Only a listed file can be the default
    /// of a map with listed files. Returns the file's map. Only available to users who can manage
    /// maps.
    #[graphql(guard = RequiredPermission::ManageMaps)]
    async fn map_family_set_default(
        &self,
        ctx: &Context<'_>,
        file_id: SbMapId,
    ) -> Result<MapFamily> {
        let user = require_current_user(ctx)?;
        let db = ctx.data::<MapSearchRepo>()?.db();
        let file_id = resolve_existing_map_id(db, file_id).await?;
        let mut tx = db.begin().await?;
        let family_id = edit::set_default(&mut tx, file_id, user.id)
            .await
            .map_err(edit_error)?;
        tx.commit().await?;
        load_family(ctx, family_id).await
    }

    /// Clears staff's pick of a map's default, so its default is derived again: the most played
    /// file, then the newest. Only available to users who can manage maps.
    #[graphql(guard = RequiredPermission::ManageMaps)]
    async fn map_family_clear_default(
        &self,
        ctx: &Context<'_>,
        family_id: Uuid,
    ) -> Result<MapFamily> {
        let user = require_current_user(ctx)?;
        let db = ctx.data::<MapSearchRepo>()?.db();
        let family_id = resolve_existing_family_id(db, family_id).await?;
        let mut tx = db.begin().await?;
        edit::clear_default(&mut tx, family_id, user.id)
            .await
            .map_err(edit_error)?;
        tx.commit().await?;
        load_family(ctx, family_id).await
    }

    /// Tells staff that a file isn't part of its map, or that a map is the same as another one.
    /// Changes nothing by itself. Reporting the same thing again while a report is open updates
    /// that report.
    async fn map_family_report(
        &self,
        ctx: &Context<'_>,
        input: MapFamilyReportInput,
    ) -> Result<MapFamilyReport> {
        let user = require_current_user(ctx)?;
        let db = ctx.data::<MapSearchRepo>()?.db();
        let request = match input.kind {
            MapFamilyReportKind::WrongMap => {
                let file_id = input
                    .map_id
                    .ok_or_else(|| edit_error(FamilyEditError::MissingMap))?;
                ReportRequest::WrongMap {
                    file_id: resolve_existing_map_id(db, file_id).await?,
                }
            }
            MapFamilyReportKind::SameMap => {
                let (Some(family_id), Some(other_family_id)) =
                    (input.family_id, input.other_family_id)
                else {
                    return Err(edit_error(FamilyEditError::MissingFamilies));
                };
                ReportRequest::SameMap {
                    family_id: resolve_existing_family_id(db, family_id).await?,
                    other_family_id: resolve_existing_family_id(db, other_family_id).await?,
                }
            }
        };
        let mut tx = db.begin().await?;
        edit::check_reporter(&mut tx, user.id)
            .await
            .map_err(edit_error)?;
        let id = edit::insert_report(&mut tx, &request, input.note.as_deref(), user.id)
            .await
            .map_err(edit_error)?;
        tx.commit().await?;
        publish_report_message(
            ctx,
            PublishedMapFamilyReportMessage::ReportCreated { report_id: id },
        )
        .await;
        load_report(db, id)
            .await?
            .ok_or_else(|| graphql_error("NOT_FOUND", "Report not found"))
    }

    /// Sets a family report's status. Only available to users who can manage maps.
    #[graphql(guard = RequiredPermission::ManageMaps)]
    async fn map_family_report_set_status(
        &self,
        ctx: &Context<'_>,
        id: Uuid,
        status: MapFamilyReportStatus,
    ) -> Result<MapFamilyReport> {
        let user = require_current_user(ctx)?;
        let db = ctx.data::<MapSearchRepo>()?.db();
        let mut tx = db.begin().await?;
        edit::set_report_status(&mut tx, id, status, user.id)
            .await
            .map_err(edit_error)?;
        tx.commit().await?;
        publish_report_message(
            ctx,
            PublishedMapFamilyReportMessage::ReportStatusChanged { report_id: id },
        )
        .await;
        load_report(db, id)
            .await?
            .ok_or_else(|| graphql_error("NOT_FOUND", "Report not found"))
    }
}

/// Messages published to Node (via Redis pub/sub) about family reports. Node uses them to refresh
/// the open-report counts it pushes to staff.
#[typeshare]
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", content = "data", rename_all = "camelCase")]
pub enum PublishedMapFamilyReportMessage {
    /// A report was filed, or an open report was updated by its reporter.
    #[serde(rename_all = "camelCase")]
    ReportCreated { report_id: Uuid },
    /// Staff resolved, dismissed or reopened a report.
    #[serde(rename_all = "camelCase")]
    ReportStatusChanged { report_id: Uuid },
}

/// Publishes a family report message. Best-effort: a failed publish only leaves staff's open-report
/// count stale until its next refresh, so it doesn't fail the request.
async fn publish_report_message(ctx: &Context<'_>, message: PublishedMapFamilyReportMessage) {
    let Some(redis) = ctx.data_opt::<RedisPool>() else {
        tracing::warn!("no RedisPool available to publish a family report message");
        return;
    };
    if let Err(err) = redis.publish(message).await {
        tracing::error!("failed to publish family report message: {err:?}");
    }
}
