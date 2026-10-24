//! The GraphQL API of map families: each map's family, place and version status, the staff
//! families queue, family edits, and reports from users.

use std::collections::{HashMap, HashSet};
use std::sync::Arc;

use async_graphql::dataloader::{DataLoader, Loader};
use async_graphql::{
    Context, Enum, Guard, InputObject, MaybeUndefined, Object, Result, SimpleObject,
};
use chrono::{DateTime, Utc};
use color_eyre::eyre::WrapErr;
use serde_json::Value;
use sqlx::PgPool;
use sqlx::types::Json;
use uuid::Uuid;

use crate::graphql::errors::graphql_error;
use crate::maps::catalog::{
    MapStats, SbMap, SbMapLoader, require_current_user, resolve_existing_map_id,
};
use crate::maps::families::edit::{
    self, FamilyEditError, LinkRequest, MapFamilyReportKind, MapFamilyReportStatus,
    MapLinkSuggestionDecision, ReportRequest,
};
use crate::maps::families::proposals::{self, MapFamilyProposal};
use crate::maps::families::rules::{Older, ProposedRelation};
use crate::maps::families::{MapFamilyRelation, MapLinkSource};
use crate::maps::search::MapSearchRepo;
use crate::maps::{SbMapId, compare};
use crate::users::permissions::RequiredPermission;
use crate::users::{SbUser, SbUserId, UsersLoader};

/// The most links one `mapFamilyLink` call may carry.
const MAX_LINKS_PER_CALL: usize = 100;
/// The most proposals or reports one page of the staff queue may hold.
const MAX_QUEUE_PAGE: i32 = 100;

pub(crate) async fn is_staff(ctx: &Context<'_>) -> bool {
    RequiredPermission::ManageMaps.check(ctx).await.is_ok()
}

async fn load_user(ctx: &Context<'_>, id: Option<SbUserId>) -> Result<Option<SbUser>> {
    let Some(id) = id else {
        return Ok(None);
    };
    ctx.data::<DataLoader<UsersLoader>>()?.load_one(id).await
}

pub(crate) async fn load_sb_map(ctx: &Context<'_>, id: SbMapId) -> Result<SbMap> {
    ctx.data::<DataLoader<SbMapLoader>>()?
        .load_one(id)
        .await?
        .ok_or_else(|| graphql_error("NOT_FOUND", "Map not found"))
}

/// A family's id.
#[derive(Debug, Copy, Clone, Eq, PartialEq, Hash)]
pub struct MapFamilyId(pub Uuid);

/// One member of a family, as stored.
#[derive(Debug, Clone)]
pub struct FamilyMemberData {
    pub map_id: SbMapId,
    pub parent: Option<SbMapId>,
    pub relation: MapFamilyRelation,
    pub version_label: Option<String>,
    pub pinned_current: bool,
    pub source: MapLinkSource,
    pub linked_by: Option<SbUserId>,
    pub linked_at: DateTime<Utc>,
    pub line_root: SbMapId,
    pub line_current: SbMapId,
    pub listed: bool,
}

/// A whole family, as stored.
#[derive(Debug, Clone)]
pub struct FamilyData {
    pub id: Uuid,
    pub label: Option<String>,
    pub current_map_id: Option<SbMapId>,
    pub members: Vec<FamilyMemberData>,
}

/// Where a file stands among the versions of its family line.
#[derive(Enum, Copy, Clone, Debug, Eq, PartialEq)]
pub enum MapVersionStatus {
    /// The current version of its line. A variant or translation is current when it stands in for
    /// a version that isn't listed.
    Current,
    /// An older version of its line: the line's current version descends from it.
    Superseded,
    /// A variant of another file in its line.
    Variant,
    /// A translation of another file in its line.
    Translation,
    /// Not in a family, or a version its line's current doesn't descend from (e.g. a newer file
    /// that isn't listed while an older one is current).
    None,
}

impl FamilyData {
    pub fn member(&self, map_id: SbMapId) -> Option<&FamilyMemberData> {
        self.members.iter().find(|m| m.map_id == map_id)
    }

    /// Whether `ancestor` is above `map_id` in the tree.
    fn is_strict_ancestor(&self, ancestor: SbMapId, map_id: SbMapId) -> bool {
        let mut current = self.member(map_id).and_then(|m| m.parent);
        let mut steps = 0;
        while let Some(id) = current {
            if id == ancestor {
                return true;
            }
            steps += 1;
            if steps > self.members.len() {
                break;
            }
            current = self.member(id).and_then(|m| m.parent);
        }
        false
    }

    /// The version `map_id` belongs to: itself, or for a variant or translation, the nearest
    /// ancestor that isn't one.
    fn version_of(&self, map_id: SbMapId) -> Option<SbMapId> {
        let mut member = self.member(map_id)?;
        let mut steps = 0;
        while matches!(
            member.relation,
            MapFamilyRelation::Variant | MapFamilyRelation::Translation
        ) && steps <= self.members.len()
        {
            member = self.member(member.parent?)?;
            steps += 1;
        }
        Some(member.map_id)
    }

    pub fn version_status(&self, map_id: SbMapId) -> MapVersionStatus {
        let Some(member) = self.member(map_id) else {
            return MapVersionStatus::None;
        };
        if member.line_current == map_id {
            return MapVersionStatus::Current;
        }
        match member.relation {
            MapFamilyRelation::Variant => MapVersionStatus::Variant,
            MapFamilyRelation::Translation => MapVersionStatus::Translation,
            _ => match self.version_of(member.line_current) {
                Some(current) if self.is_strict_ancestor(map_id, current) => {
                    MapVersionStatus::Superseded
                }
                _ => MapVersionStatus::None,
            },
        }
    }

    /// The listed current version of `map_id`'s line, when it's a newer version than the one
    /// `map_id` belongs to.
    pub fn newer_version(&self, map_id: SbMapId) -> Option<SbMapId> {
        let member = self.member(map_id)?;
        let current = self.member(member.line_current)?;
        if !current.listed || current.map_id == map_id {
            return None;
        }
        let version = self.version_of(map_id)?;
        let current_version = self.version_of(current.map_id)?;
        self.is_strict_ancestor(version, current_version)
            .then_some(current.map_id)
    }

    fn line_members(&self, line_root: SbMapId) -> impl Iterator<Item = &FamilyMemberData> {
        self.members
            .iter()
            .filter(move |m| m.line_root == line_root)
    }

    /// Whether the viewer sees `member` in the family: listed members for everyone, all of them
    /// for staff.
    fn is_visible(member: &FamilyMemberData, staff: bool) -> bool {
        staff || member.listed
    }

    /// `member` as the viewer sees it: its parent is its nearest visible ancestor, and a member
    /// whose nearest visible ancestor is in another line shows as a fork of it.
    fn view(&self, member: &FamilyMemberData, staff: bool) -> MapFamilyMember {
        let mut parent = member.parent;
        let mut steps = 0;
        while let Some(id) = parent {
            match self.member(id) {
                Some(p) if Self::is_visible(p, staff) => break,
                Some(p) if steps <= self.members.len() => {
                    parent = p.parent;
                    steps += 1;
                }
                _ => {
                    parent = None;
                    break;
                }
            }
        }
        let parent_line = parent.and_then(|p| self.member(p)).map(|p| p.line_root);
        let relation = match parent_line {
            Some(line) if line != member.line_root && !member.relation.starts_line() => {
                MapFamilyRelation::Fork
            }
            _ => member.relation,
        };
        MapFamilyMember {
            data: member.clone(),
            parent_id: parent,
            relation,
            line_current_listed: self
                .member(member.line_current)
                .is_some_and(|current| current.listed),
        }
    }
}

struct FamilyRow {
    family_id: Uuid,
    label: Option<String>,
    current_map_id: Option<SbMapId>,
    map_id: SbMapId,
    parent_map_id: Option<SbMapId>,
    relation: MapFamilyRelation,
    version_label: Option<String>,
    pinned_current: bool,
    source: MapLinkSource,
    linked_by: Option<SbUserId>,
    linked_at: DateTime<Utc>,
    line_root_id: SbMapId,
    line_current_id: SbMapId,
    listed: bool,
}

fn group_families(rows: Vec<FamilyRow>) -> HashMap<Uuid, Arc<FamilyData>> {
    let mut families: HashMap<Uuid, FamilyData> = HashMap::new();
    for row in rows {
        families
            .entry(row.family_id)
            .or_insert_with(|| FamilyData {
                id: row.family_id,
                label: row.label.clone(),
                current_map_id: row.current_map_id,
                members: Vec::new(),
            })
            .members
            .push(FamilyMemberData {
                map_id: row.map_id,
                parent: row.parent_map_id,
                relation: row.relation,
                version_label: row.version_label,
                pinned_current: row.pinned_current,
                source: row.source,
                linked_by: row.linked_by,
                linked_at: row.linked_at,
                line_root: row.line_root_id,
                line_current: row.line_current_id,
                listed: row.listed,
            });
    }
    families
        .into_iter()
        .map(|(id, family)| (id, Arc::new(family)))
        .collect()
}

/// Loads whole families, by the id of a member (a map outside any family is left out) or by the
/// family's id.
pub struct MapFamilyLoader {
    db: PgPool,
}

impl MapFamilyLoader {
    pub fn new(db: PgPool) -> Self {
        Self { db }
    }

    async fn load_families(&self, family_ids: &[Uuid]) -> Result<HashMap<Uuid, Arc<FamilyData>>> {
        let rows = sqlx::query_as!(
            FamilyRow,
            r#"
                SELECT f.family_id, fam.label, fam.current_map_id as "current_map_id: SbMapId",
                    f.map_id as "map_id: SbMapId", f.parent_map_id as "parent_map_id: SbMapId",
                    f.relation as "relation: MapFamilyRelation", f.version_label,
                    f.pinned_current, f.source as "source: MapLinkSource",
                    f.linked_by as "linked_by: SbUserId", f.linked_at,
                    f.line_root_id as "line_root_id: SbMapId",
                    f.line_current_id as "line_current_id: SbMapId", m.listed as "listed!"
                FROM map_family_members f
                INNER JOIN map_families fam ON fam.id = f.family_id
                INNER JOIN maps m ON m.id = f.map_id
                WHERE f.family_id = ANY($1)
            "#,
            family_ids,
        )
        .fetch_all(&self.db)
        .await
        .wrap_err("Failed to load families")?;
        Ok(group_families(rows))
    }
}

impl Loader<SbMapId> for MapFamilyLoader {
    type Value = Arc<FamilyData>;
    type Error = async_graphql::Error;

    async fn load(&self, keys: &[SbMapId]) -> Result<HashMap<SbMapId, Arc<FamilyData>>> {
        let memberships = sqlx::query!(
            r#"
                SELECT map_id as "map_id: SbMapId", family_id
                FROM map_family_members
                WHERE map_id = ANY($1)
            "#,
            keys as _,
        )
        .fetch_all(&self.db)
        .await
        .wrap_err("Failed to load family memberships")?;
        if memberships.is_empty() {
            return Ok(HashMap::new());
        }
        let family_ids: Vec<Uuid> = memberships
            .iter()
            .map(|m| m.family_id)
            .collect::<HashSet<_>>()
            .into_iter()
            .collect();
        let families = self.load_families(&family_ids).await?;
        Ok(memberships
            .into_iter()
            .filter_map(|m| {
                families
                    .get(&m.family_id)
                    .map(|family| (m.map_id, family.clone()))
            })
            .collect())
    }
}

impl Loader<MapFamilyId> for MapFamilyLoader {
    type Value = Arc<FamilyData>;
    type Error = async_graphql::Error;

    async fn load(&self, keys: &[MapFamilyId]) -> Result<HashMap<MapFamilyId, Arc<FamilyData>>> {
        let ids: Vec<Uuid> = keys.iter().map(|k| k.0).collect();
        Ok(self
            .load_families(&ids)
            .await?
            .into_iter()
            .map(|(id, family)| (MapFamilyId(id), family))
            .collect())
    }
}

pub(crate) async fn load_family_of(
    ctx: &Context<'_>,
    map_id: SbMapId,
) -> Result<Option<Arc<FamilyData>>> {
    ctx.data::<DataLoader<MapFamilyLoader>>()?
        .load_one(map_id)
        .await
}

/// Loads the play stats of family lines, by the line's first file.
pub struct MapLineStatsLoader {
    db: PgPool,
}

impl MapLineStatsLoader {
    pub fn new(db: PgPool) -> Self {
        Self { db }
    }
}

impl Loader<SbMapId> for MapLineStatsLoader {
    type Value = MapStats;
    type Error = async_graphql::Error;

    async fn load(&self, keys: &[SbMapId]) -> Result<HashMap<SbMapId, MapStats>> {
        let rows = sqlx::query!(
            r#"
                SELECT line_root_id as "line_root_id: SbMapId", games_7d, games_28d, games_90d,
                    games_total, players_90d, median_length_90d, last_played_at, trending_score
                FROM map_line_stats
                WHERE line_root_id = ANY($1)
            "#,
            keys as _,
        )
        .fetch_all(&self.db)
        .await
        .wrap_err("Failed to load line stats")?;
        Ok(rows
            .into_iter()
            .map(|row| {
                (
                    row.line_root_id,
                    MapStats {
                        map_id: row.line_root_id,
                        line: true,
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

pub struct MapFamily {
    data: Arc<FamilyData>,
}

impl MapFamily {
    pub fn new(data: Arc<FamilyData>) -> Self {
        Self { data }
    }
}

/// A map's family: the versions, variants, translations and forks of one map.
#[Object]
impl MapFamily {
    async fn id(&self) -> String {
        format!("map-family:{}", self.data.id)
    }

    /// The family's id, for staff edits.
    async fn family_id(&self) -> Uuid {
        self.data.id
    }

    /// The family's files: the listed ones, or every one for users who can manage maps. Each
    /// member's parent is its nearest ancestor in this list.
    async fn members(&self, ctx: &Context<'_>) -> Vec<MapFamilyMember> {
        let staff = is_staff(ctx).await;
        self.data
            .members
            .iter()
            .filter(|m| FamilyData::is_visible(m, staff))
            .map(|m| self.data.view(m, staff))
            .collect()
    }

    /// A staff-only working label for the families queue. Only available to users who can manage
    /// maps.
    #[graphql(guard = RequiredPermission::ManageMaps)]
    async fn label(&self) -> Option<String> {
        self.data.label.clone()
    }
}

pub struct MapFamilyMember {
    data: FamilyMemberData,
    parent_id: Option<SbMapId>,
    relation: MapFamilyRelation,
    line_current_listed: bool,
}

/// A file's place in its family.
#[Object]
impl MapFamilyMember {
    async fn id(&self) -> String {
        format!("map-family-member:{}", self.data.map_id)
    }

    async fn map_id(&self) -> SbMapId {
        self.data.map_id
    }

    async fn map(&self, ctx: &Context<'_>) -> Result<SbMap> {
        load_sb_map(ctx, self.data.map_id).await
    }

    /// The member's parent among the members the viewer can see. Null for the top of the tree.
    async fn parent_id(&self) -> Option<SbMapId> {
        self.parent_id
    }

    /// How the member relates to its parent. A member shown under a parent in another line (because
    /// the files between them aren't listed) is a fork of it.
    async fn relation(&self) -> MapFamilyRelation {
        self.relation
    }

    /// The member's version, e.g. "1.75". Parsed from the file unless staff set it.
    async fn version_label(&self) -> Option<&str> {
        self.data.version_label.as_deref()
    }

    /// The current version of the member's line, a listed map. Null when the line has no listed
    /// member and the viewer can't manage maps. Members of one line share it.
    async fn line_current_id(&self, ctx: &Context<'_>) -> Option<SbMapId> {
        (self.line_current_listed || is_staff(ctx).await).then_some(self.data.line_current)
    }

    /// Whether the member is the current version of its line.
    async fn is_current(&self) -> bool {
        self.data.line_current == self.data.map_id
    }

    /// Whether staff pinned the member as its line's current version.
    async fn pinned_current(&self) -> bool {
        self.data.pinned_current
    }

    /// Who placed the member. A place can only be changed by the same or a higher source.
    async fn source(&self) -> MapLinkSource {
        self.data.source
    }

    async fn linked_at(&self) -> DateTime<Utc> {
        self.data.linked_at
    }

    /// The user who placed the member, if a person did. Only available to users who can manage
    /// maps.
    #[graphql(guard = RequiredPermission::ManageMaps)]
    async fn linked_by(&self, ctx: &Context<'_>) -> Result<Option<SbUser>> {
        load_user(ctx, self.data.linked_by).await
    }
}

// SbMap's family fields. `catalog.rs` exposes these on `SbMap`.

pub(crate) async fn map_family(ctx: &Context<'_>, map_id: SbMapId) -> Result<Option<MapFamily>> {
    Ok(load_family_of(ctx, map_id)
        .await?
        .map(|data| MapFamily { data }))
}

pub(crate) async fn map_family_member(
    ctx: &Context<'_>,
    map_id: SbMapId,
) -> Result<Option<MapFamilyMember>> {
    let Some(family) = load_family_of(ctx, map_id).await? else {
        return Ok(None);
    };
    let staff = is_staff(ctx).await;
    Ok(family.member(map_id).map(|m| family.view(m, staff)))
}

pub(crate) async fn version_status(ctx: &Context<'_>, map_id: SbMapId) -> Result<MapVersionStatus> {
    Ok(load_family_of(ctx, map_id)
        .await?
        .map_or(MapVersionStatus::None, |f| f.version_status(map_id)))
}

pub(crate) async fn newer_version(ctx: &Context<'_>, map_id: SbMapId) -> Result<Option<SbMap>> {
    let Some(newer) = load_family_of(ctx, map_id)
        .await?
        .and_then(|f| f.newer_version(map_id))
    else {
        return Ok(None);
    };
    ctx.data::<DataLoader<SbMapLoader>>()?.load_one(newer).await
}

pub(crate) async fn version_count(ctx: &Context<'_>, map_id: SbMapId) -> Result<i32> {
    let Some(family) = load_family_of(ctx, map_id).await? else {
        return Ok(1);
    };
    let Some(member) = family.member(map_id) else {
        return Ok(1);
    };
    let listed = family
        .line_members(member.line_root)
        .filter(|m| m.listed)
        .count();
    Ok(i32::try_from(listed.max(1)).unwrap_or(i32::MAX))
}

pub(crate) async fn line_stats(ctx: &Context<'_>, map_id: SbMapId) -> Result<Option<MapStats>> {
    let Some(family) = load_family_of(ctx, map_id).await? else {
        return Ok(None);
    };
    let Some(member) = family.member(map_id) else {
        return Ok(None);
    };
    let staff = is_staff(ctx).await;
    let visible = family
        .line_members(member.line_root)
        .filter(|m| FamilyData::is_visible(m, staff))
        .count();
    if visible < 2 {
        return Ok(None);
    }
    ctx.data::<DataLoader<MapLineStatsLoader>>()?
        .load_one(member.line_root)
        .await
}

pub(crate) async fn similar_maps(ctx: &Context<'_>, map_id: SbMapId) -> Result<Vec<SbMap>> {
    // Only the map page selects this, one map at a time, so it isn't batched
    let db = ctx.data::<MapSearchRepo>()?.db();
    let ids = sqlx::query_scalar!(
        r#"
            SELECT CASE WHEN s.map_a = $1 THEN s.map_b ELSE s.map_a END as "id!: SbMapId"
            FROM map_link_suggestions s
            WHERE (s.map_a = $1 OR s.map_b = $1) AND s.status = 'open'
                AND NOT EXISTS (
                    SELECT 1
                    FROM map_family_members fa
                    INNER JOIN map_family_members fb ON fb.family_id = fa.family_id
                    WHERE fa.map_id = s.map_a AND fb.map_id = s.map_b
                )
            ORDER BY s.terrain_similarity DESC NULLS LAST, s.created_at
        "#,
        map_id as _,
    )
    .fetch_all(db)
    .await
    .wrap_err("Failed to load similar maps")?;
    let staff = is_staff(ctx).await;
    let mut maps = ctx
        .data::<DataLoader<SbMapLoader>>()?
        .load_many(ids.iter().copied())
        .await?;
    Ok(ids
        .iter()
        .filter_map(|id| maps.remove(id))
        .filter(|m| staff || m.listed)
        .collect())
}

/// The status of a detected pair of possibly related files.
#[derive(Enum, Copy, Clone, Debug, Eq, PartialEq)]
pub enum MapLinkSuggestionStatus {
    /// Waiting for staff.
    Open,
    /// The files were linked.
    Accepted,
    /// The files aren't related.
    Rejected,
    /// A UMS map built on the other map's terrain: related, but never in its family.
    TerrainOnly,
}

impl MapLinkSuggestionStatus {
    fn from_db(status: &str) -> Self {
        match status {
            "accepted" => Self::Accepted,
            "rejected" => Self::Rejected,
            "terrain_only" => Self::TerrainOnly,
            _ => Self::Open,
        }
    }
}

#[derive(Debug, Clone)]
pub struct MapLinkSuggestion {
    pub map_a: SbMapId,
    pub map_b: SbMapId,
    pub terrain_similarity: Option<f32>,
    pub name_match: bool,
    pub verdict: Json<Value>,
    pub status: String,
    pub decided_by: Option<SbUserId>,
    pub decided_at: Option<DateTime<Utc>>,
    pub created_at: DateTime<Utc>,
}

impl MapLinkSuggestion {
    pub fn proposed_relation(&self) -> Option<ProposedRelation> {
        serde_json::from_value(self.verdict.0.get("relation")?.clone()).ok()
    }

    /// The older file of the pair, when the rules know it.
    pub fn older(&self) -> Option<SbMapId> {
        let older: Older = serde_json::from_value(self.verdict.0.get("older")?.clone()).ok()?;
        Some(match older {
            Older::A => self.map_a,
            Older::B => self.map_b,
        })
    }

    pub fn is_open(&self) -> bool {
        self.status == "open"
    }
}

/// A pair of files detection found to be possibly related, with the rules' proposal and what
/// became of it.
#[Object]
impl MapLinkSuggestion {
    async fn id(&self) -> String {
        format!("map-link-suggestion:{}:{}", self.map_a, self.map_b)
    }

    async fn map_a(&self, ctx: &Context<'_>) -> Result<SbMap> {
        load_sb_map(ctx, self.map_a).await
    }

    async fn map_b(&self, ctx: &Context<'_>) -> Result<SbMap> {
        load_sb_map(ctx, self.map_b).await
    }

    /// The share of the walkable terrain the files have in common, from 0 to 1. Null when they
    /// were found by name and their dimensions differ.
    async fn terrain_similarity(&self) -> Option<f64> {
        self.terrain_similarity.map(f64::from)
    }

    /// Whether the files share a base name.
    async fn name_match(&self) -> bool {
        self.name_match
    }

    /// How the detection rules propose the files relate. Null when they had no proposal.
    #[graphql(name = "proposedRelation")]
    async fn graphql_proposed_relation(&self) -> Option<ProposedRelation> {
        self.proposed_relation()
    }

    /// The older file of the pair, by the rules. For a version, it's the parent.
    #[graphql(name = "olderMapId")]
    async fn graphql_older(&self) -> Option<SbMapId> {
        self.older()
    }

    /// The rule that made the proposal.
    async fn rule(&self) -> Option<String> {
        self.verdict
            .0
            .get("rule")
            .and_then(Value::as_str)
            .map(str::to_string)
    }

    async fn status(&self) -> MapLinkSuggestionStatus {
        MapLinkSuggestionStatus::from_db(&self.status)
    }

    /// The user who decided, null when the detection rules did or nobody has yet.
    async fn decided_by(&self, ctx: &Context<'_>) -> Result<Option<SbUser>> {
        load_user(ctx, self.decided_by).await
    }

    async fn decided_at(&self) -> Option<DateTime<Utc>> {
        self.decided_at
    }

    async fn created_at(&self) -> DateTime<Utc> {
        self.created_at
    }
}

pub(crate) async fn load_suggestions_of(
    db: &PgPool,
    map_id: SbMapId,
) -> color_eyre::Result<Vec<MapLinkSuggestion>> {
    sqlx::query_as!(
        MapLinkSuggestion,
        r#"
            SELECT map_a as "map_a: SbMapId", map_b as "map_b: SbMapId", terrain_similarity,
                name_match, verdict as "verdict: Json<Value>", status,
                decided_by as "decided_by: SbUserId", decided_at, created_at
            FROM map_link_suggestions
            WHERE map_a = $1 OR map_b = $1
            ORDER BY status <> 'open', terrain_similarity DESC NULLS LAST, created_at
        "#,
        map_id as _,
    )
    .fetch_all(db)
    .await
    .wrap_err("Failed to load link suggestions")
}

async fn load_suggestion(
    db: &PgPool,
    a: SbMapId,
    b: SbMapId,
) -> color_eyre::Result<Option<MapLinkSuggestion>> {
    let (a, b) = if a.0 < b.0 { (a, b) } else { (b, a) };
    sqlx::query_as!(
        MapLinkSuggestion,
        r#"
            SELECT map_a as "map_a: SbMapId", map_b as "map_b: SbMapId", terrain_similarity,
                name_match, verdict as "verdict: Json<Value>", status,
                decided_by as "decided_by: SbUserId", decided_at, created_at
            FROM map_link_suggestions
            WHERE map_a = $1 AND map_b = $2
        "#,
        a as _,
        b as _,
    )
    .fetch_optional(db)
    .await
    .wrap_err("Failed to load link suggestion")
}

#[derive(Debug, Clone)]
pub struct MapFamilyReport {
    pub id: Uuid,
    pub map_id: SbMapId,
    pub other_map_id: Option<SbMapId>,
    pub kind: String,
    pub suggested_relation: Option<MapFamilyRelation>,
    pub note: Option<String>,
    pub reported_by: SbUserId,
    pub reported_at: DateTime<Utc>,
    pub status: String,
    pub resolved_by: Option<SbUserId>,
    pub resolved_at: Option<DateTime<Utc>>,
}

/// A user's report that a map is in the wrong family, or is related to another map.
#[Object]
impl MapFamilyReport {
    async fn id(&self) -> Uuid {
        self.id
    }

    async fn map(&self, ctx: &Context<'_>) -> Result<SbMap> {
        load_sb_map(ctx, self.map_id).await
    }

    /// The map the reporter says this one is related to. Only for `RELATED`.
    async fn other_map(&self, ctx: &Context<'_>) -> Result<Option<SbMap>> {
        match self.other_map_id {
            Some(id) => load_sb_map(ctx, id).await.map(Some),
            None => Ok(None),
        }
    }

    async fn kind(&self) -> MapFamilyReportKind {
        MapFamilyReportKind::from_db(&self.kind)
    }

    /// How the reporter says the map relates to the other map.
    async fn suggested_relation(&self) -> Option<MapFamilyRelation> {
        self.suggested_relation
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
            SELECT id, map_id as "map_id: SbMapId", other_map_id as "other_map_id: SbMapId", kind,
                suggested_relation as "suggested_relation: MapFamilyRelation", note,
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
        | FamilyEditError::NotInFamily
        | FamilyEditError::SuggestionNotFound
        | FamilyEditError::ReportNotFound => "NOT_FOUND",
        FamilyEditError::Locked | FamilyEditError::NotPublisher => "FORBIDDEN",
        FamilyEditError::ReportingRestricted => "RESTRICTED",
        FamilyEditError::TooManyReports => "RATE_LIMITED",
        FamilyEditError::Other(e) => return async_graphql::Error::new(format!("{e:?}")),
        _ => "BAD_REQUEST",
    };
    graphql_error(code, error.to_string())
}

#[derive(Default)]
pub struct MapFamiliesQuery;

#[Object]
impl MapFamiliesQuery {
    /// What changed between two maps, e.g. two versions of one map. Any two maps can be compared.
    async fn map_comparison(
        &self,
        ctx: &Context<'_>,
        a: SbMapId,
        b: SbMapId,
    ) -> Result<compare::MapComparison> {
        let db = ctx.data::<MapSearchRepo>()?.db();
        let a = resolve_existing_map_id(db, a).await?;
        let b = resolve_existing_map_id(db, b).await?;
        Ok(compare::compare_maps(db, a, b).await?)
    }

    /// Groups of possibly related files waiting for staff, the most played first. Each holds the
    /// files of connected open suggestions, the families they touch, and a proposed tree. Only
    /// available to users who can manage maps.
    #[graphql(guard = RequiredPermission::ManageMaps)]
    async fn map_family_proposals(
        &self,
        ctx: &Context<'_>,
        #[graphql(default = 20)] limit: i32,
        #[graphql(default = 0)] offset: i32,
    ) -> Result<Vec<MapFamilyProposal>> {
        let db = ctx.data::<MapSearchRepo>()?.db();
        let proposals = proposals::load_proposals(db).await?;
        Ok(proposals
            .into_iter()
            .skip(offset.max(0) as usize)
            .take(limit.clamp(1, MAX_QUEUE_PAGE) as usize)
            .collect())
    }

    /// How many groups `mapFamilyProposals` holds. Only available to users who can manage maps.
    #[graphql(guard = RequiredPermission::ManageMaps)]
    async fn map_family_proposal_count(&self, ctx: &Context<'_>) -> Result<i32> {
        let db = ctx.data::<MapSearchRepo>()?.db();
        let count = proposals::load_proposals(db).await?.len();
        Ok(i32::try_from(count).unwrap_or(i32::MAX))
    }

    /// The groups of possibly related files the maps are in, merged into one, as
    /// `mapFamilyProposals` would list them. A map with nothing to sort adds itself and its
    /// family. Only available to users who can manage maps.
    #[graphql(guard = RequiredPermission::ManageMaps)]
    async fn map_family_group(
        &self,
        ctx: &Context<'_>,
        map_ids: Vec<SbMapId>,
    ) -> Result<MapFamilyProposal> {
        if map_ids.is_empty() || map_ids.len() > MAX_QUEUE_PAGE as usize {
            return Err(graphql_error(
                "BAD_REQUEST",
                format!("Between 1 and {MAX_QUEUE_PAGE} maps can be loaded"),
            ));
        }
        let db = ctx.data::<MapSearchRepo>()?.db();
        let group = proposals::load_group(db, &map_ids).await?;
        if group.is_empty() {
            return Err(graphql_error("NOT_FOUND", "Map not found"));
        }
        Ok(group)
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
                SELECT id, map_id as "map_id: SbMapId", other_map_id as "other_map_id: SbMapId",
                    kind, suggested_relation as "suggested_relation: MapFamilyRelation", note,
                    reported_by as "reported_by: SbUserId", reported_at, status,
                    resolved_by as "resolved_by: SbUserId", resolved_at
                FROM map_family_reports
                WHERE status = $1
                ORDER BY reported_at, id
                LIMIT $2 OFFSET $3
            "#,
            status.as_str(),
            i64::from(limit.clamp(1, MAX_QUEUE_PAGE)),
            i64::from(offset.max(0)),
        )
        .fetch_all(db)
        .await
        .wrap_err("Failed to load family reports")?)
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
}

/// Places a map under another map in a family.
#[derive(InputObject, Clone, Debug)]
pub struct MapFamilyLinkInput {
    pub map_id: SbMapId,
    pub parent_id: SbMapId,
    /// Any relation but `ROOT`.
    pub relation: MapFamilyRelation,
    /// The member's version label. Left out, it keeps the member's label (or, for a map that
    /// wasn't in a family, the version parsed from its file); null clears it.
    pub version_label: MaybeUndefined<String>,
}

fn maybe_label(label: MaybeUndefined<String>) -> Option<Option<String>> {
    match label {
        MaybeUndefined::Undefined => None,
        MaybeUndefined::Null => Some(None),
        MaybeUndefined::Value(label) => {
            let label = label.trim();
            Some((!label.is_empty()).then(|| label.to_string()))
        }
    }
}

/// A user's report about a map's family.
#[derive(InputObject, Clone, Debug)]
pub struct MapFamilyReportInput {
    pub map_id: SbMapId,
    pub kind: MapFamilyReportKind,
    /// The map this one is related to. Required for `RELATED`, ignored otherwise.
    pub other_map_id: Option<SbMapId>,
    /// How the map relates to the other map, e.g. `VERSION` when it's a newer version of it.
    pub suggested_relation: Option<MapFamilyRelation>,
    pub note: Option<String>,
}

#[derive(Default)]
pub struct MapFamiliesMutation;

#[Object]
impl MapFamiliesMutation {
    /// Places maps in families, in order, each under its parent with its whole subtree. A parent
    /// outside any family starts a new one; a map in another family moves out of it. Open
    /// suggestions between maps that end up in one family are accepted. Only available to users who
    /// can manage maps. Returns the linked maps.
    #[graphql(guard = RequiredPermission::ManageMaps)]
    async fn map_family_link(
        &self,
        ctx: &Context<'_>,
        links: Vec<MapFamilyLinkInput>,
    ) -> Result<Vec<SbMap>> {
        let user = require_current_user(ctx)?;
        if links.len() > MAX_LINKS_PER_CALL {
            return Err(graphql_error(
                "BAD_REQUEST",
                format!("at most {MAX_LINKS_PER_CALL} maps can be linked at once"),
            ));
        }
        let db = ctx.data::<MapSearchRepo>()?.db();
        let mut requests = Vec::with_capacity(links.len());
        for link in links {
            requests.push(LinkRequest {
                map_id: resolve_existing_map_id(db, link.map_id).await?,
                parent_id: resolve_existing_map_id(db, link.parent_id).await?,
                relation: link.relation,
                version_label: maybe_label(link.version_label),
            });
        }
        let mut tx = db.begin().await?;
        for request in &requests {
            edit::link(&mut tx, request, MapLinkSource::Moderator, user.id)
                .await
                .map_err(edit_error)?;
        }
        tx.commit().await?;
        let mut maps = ctx
            .data::<DataLoader<SbMapLoader>>()?
            .load_many(requests.iter().map(|r| r.map_id))
            .await?;
        Ok(requests
            .iter()
            .filter_map(|r| maps.remove(&r.map_id))
            .collect())
    }

    /// Takes a map out of its family. When it starts a line, its oldest version takes its place.
    /// Only available to users who can manage maps.
    #[graphql(guard = RequiredPermission::ManageMaps)]
    async fn map_family_remove(&self, ctx: &Context<'_>, map_id: SbMapId) -> Result<SbMap> {
        let user = require_current_user(ctx)?;
        let db = ctx.data::<MapSearchRepo>()?.db();
        let map_id = resolve_existing_map_id(db, map_id).await?;
        let mut tx = db.begin().await?;
        edit::remove(&mut tx, map_id, MapLinkSource::Moderator, user.id)
            .await
            .map_err(edit_error)?;
        tx.commit().await?;
        load_sb_map(ctx, map_id).await
    }

    /// Changes a member's version label (null clears it) and whether it's pinned as its line's
    /// current version. Only listed maps can be pinned; pinning one unpins the rest of its line.
    /// Only available to users who can manage maps.
    #[graphql(guard = RequiredPermission::ManageMaps)]
    async fn map_family_update_member(
        &self,
        ctx: &Context<'_>,
        map_id: SbMapId,
        version_label: MaybeUndefined<String>,
        pinned_current: Option<bool>,
    ) -> Result<SbMap> {
        let db = ctx.data::<MapSearchRepo>()?.db();
        let map_id = resolve_existing_map_id(db, map_id).await?;
        let mut tx = db.begin().await?;
        edit::update_member(&mut tx, map_id, maybe_label(version_label), pinned_current)
            .await
            .map_err(edit_error)?;
        tx.commit().await?;
        load_sb_map(ctx, map_id).await
    }

    /// Sets a family's staff-only working label. Only available to users who can manage maps.
    #[graphql(guard = RequiredPermission::ManageMaps)]
    async fn map_family_set_label(
        &self,
        ctx: &Context<'_>,
        family_id: Uuid,
        label: Option<String>,
    ) -> Result<MapFamily> {
        let db = ctx.data::<MapSearchRepo>()?.db();
        let label = label
            .as_deref()
            .map(str::trim)
            .filter(|l| !l.is_empty())
            .map(str::to_string);
        let updated = sqlx::query!(
            "UPDATE map_families SET label = $2, updated_at = now() WHERE id = $1",
            family_id,
            label,
        )
        .execute(db)
        .await
        .wrap_err("Failed to set family label")?;
        if updated.rows_affected() == 0 {
            return Err(graphql_error("NOT_FOUND", "Family not found"));
        }
        let data = ctx
            .data::<DataLoader<MapFamilyLoader>>()?
            .load_one(MapFamilyId(family_id))
            .await?
            .ok_or_else(|| graphql_error("NOT_FOUND", "Family not found"))?;
        Ok(MapFamily { data })
    }

    /// Rejects a suggestion, marks it as a UMS map on the other's terrain, or reopens it. Accepting
    /// one is linking its maps with `mapFamilyLink`. Only available to users who can manage maps.
    #[graphql(guard = RequiredPermission::ManageMaps)]
    async fn map_link_suggestion_decide(
        &self,
        ctx: &Context<'_>,
        map_a: SbMapId,
        map_b: SbMapId,
        decision: MapLinkSuggestionDecision,
    ) -> Result<MapLinkSuggestion> {
        let user = require_current_user(ctx)?;
        let db = ctx.data::<MapSearchRepo>()?.db();
        let mut tx = db.begin().await?;
        edit::decide_suggestion(&mut tx, map_a, map_b, decision, user.id)
            .await
            .map_err(edit_error)?;
        tx.commit().await?;
        load_suggestion(db, map_a, map_b)
            .await?
            .ok_or_else(|| graphql_error("NOT_FOUND", "Suggestion not found"))
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
        load_report(db, id)
            .await?
            .ok_or_else(|| graphql_error("NOT_FOUND", "Report not found"))
    }

    /// Links a listed map the current user published under another listed map. A `VERSION` of a
    /// line whose first file someone else published is linked as a `FORK`, and staff are asked to
    /// make it a version; the returned map's family member shows which relation was stored.
    async fn map_family_publisher_link(
        &self,
        ctx: &Context<'_>,
        map_id: SbMapId,
        parent_id: SbMapId,
        relation: MapFamilyRelation,
    ) -> Result<SbMap> {
        let user = require_current_user(ctx)?;
        let db = ctx.data::<MapSearchRepo>()?.db();
        let map_id = resolve_existing_map_id(db, map_id).await?;
        let parent_id = resolve_existing_map_id(db, parent_id).await?;
        let mut tx = db.begin().await?;
        edit::publisher_link(&mut tx, user.id, map_id, parent_id, relation)
            .await
            .map_err(edit_error)?;
        tx.commit().await?;
        load_sb_map(ctx, map_id).await
    }

    /// Takes a map the current user published out of its family, unless staff placed it.
    async fn map_family_publisher_unlink(
        &self,
        ctx: &Context<'_>,
        map_id: SbMapId,
    ) -> Result<SbMap> {
        let user = require_current_user(ctx)?;
        let db = ctx.data::<MapSearchRepo>()?.db();
        let map_id = resolve_existing_map_id(db, map_id).await?;
        let mut tx = db.begin().await?;
        edit::publisher_unlink(&mut tx, user.id, map_id)
            .await
            .map_err(edit_error)?;
        tx.commit().await?;
        load_sb_map(ctx, map_id).await
    }

    /// Tells staff a map is in the wrong family, or is related to another map. Changes nothing by
    /// itself. Reporting the same maps again while a report is open updates that report.
    async fn map_family_report(
        &self,
        ctx: &Context<'_>,
        input: MapFamilyReportInput,
    ) -> Result<MapFamilyReport> {
        let user = require_current_user(ctx)?;
        let db = ctx.data::<MapSearchRepo>()?.db();
        let map_id = resolve_existing_map_id(db, input.map_id).await?;
        let other_map_id = match input.other_map_id {
            Some(id) => Some(resolve_existing_map_id(db, id).await?),
            None => None,
        };
        let mut tx = db.begin().await?;
        edit::check_reporter(&mut tx, user.id)
            .await
            .map_err(edit_error)?;
        let id = edit::insert_report(
            &mut tx,
            &ReportRequest {
                map_id,
                kind: input.kind,
                other_map_id,
                suggested_relation: input.suggested_relation,
                note: input.note,
            },
            user.id,
        )
        .await
        .map_err(edit_error)?;
        tx.commit().await?;
        load_report(db, id)
            .await?
            .ok_or_else(|| graphql_error("NOT_FOUND", "Report not found"))
    }
}

/// A proposed place for a file in the families queue.
#[derive(SimpleObject, Clone, Debug)]
#[graphql(complex)]
pub struct MapFamilyProposedLink {
    pub map_id: SbMapId,
    /// Null for a file proposed as the root of its tree.
    pub parent_id: Option<SbMapId>,
    pub relation: MapFamilyRelation,
    pub version_label: Option<String>,
}

#[async_graphql::ComplexObject]
impl MapFamilyProposedLink {
    async fn id(&self) -> String {
        format!("map-family-proposed-link:{}", self.map_id)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn id(n: u8) -> SbMapId {
        SbMapId(Uuid::from_bytes([n; 16]))
    }

    fn member(
        n: u8,
        parent: Option<u8>,
        relation: MapFamilyRelation,
        line: u8,
        current: u8,
        listed: bool,
    ) -> FamilyMemberData {
        FamilyMemberData {
            map_id: id(n),
            parent: parent.map(id),
            relation,
            version_label: None,
            pinned_current: false,
            source: MapLinkSource::Rule,
            linked_by: None,
            linked_at: DateTime::UNIX_EPOCH,
            line_root: id(line),
            line_current: id(current),
            listed,
        }
    }

    /// 1 (root) → 2 → 3 (current), 4 variant of 2, 5 fork of 2 (unlisted) → 6 version of 5 (listed,
    /// current of the fork's line).
    fn family() -> FamilyData {
        use MapFamilyRelation::*;
        FamilyData {
            id: Uuid::nil(),
            label: None,
            current_map_id: Some(id(3)),
            members: vec![
                member(1, None, Root, 1, 3, true),
                member(2, Some(1), Version, 1, 3, true),
                member(3, Some(2), Version, 1, 3, true),
                member(4, Some(2), Variant, 1, 3, true),
                member(5, Some(2), Fork, 5, 6, false),
                member(6, Some(5), Version, 5, 6, true),
            ],
        }
    }

    #[test]
    fn version_statuses() {
        let family = family();
        assert_eq!(family.version_status(id(1)), MapVersionStatus::Superseded);
        assert_eq!(family.version_status(id(3)), MapVersionStatus::Current);
        assert_eq!(family.version_status(id(4)), MapVersionStatus::Variant);
        assert_eq!(family.version_status(id(5)), MapVersionStatus::Superseded);
        assert_eq!(family.version_status(id(9)), MapVersionStatus::None);
    }

    #[test]
    fn newer_versions_point_at_the_listed_current() {
        let family = family();
        assert_eq!(family.newer_version(id(1)), Some(id(3)));
        assert_eq!(family.newer_version(id(3)), None);
        // A variant of a superseded version points at the line's current
        assert_eq!(family.newer_version(id(4)), Some(id(3)));
        assert_eq!(family.newer_version(id(5)), Some(id(6)));

        let mut unlisted_current = family.clone();
        unlisted_current.members[2].listed = false;
        assert_eq!(unlisted_current.newer_version(id(1)), None);
    }

    #[test]
    fn a_variant_standing_in_for_its_version_isnt_newer_than_it() {
        let mut family = family();
        // 3 isn't listed, so its variant 7 is the line's current.
        family.members[2].listed = false;
        family
            .members
            .push(member(7, Some(3), MapFamilyRelation::Variant, 1, 7, true));
        for m in &mut family.members {
            if m.line_root == id(1) {
                m.line_current = id(7);
            }
        }
        assert_eq!(family.version_status(id(7)), MapVersionStatus::Current);
        assert_eq!(family.version_status(id(3)), MapVersionStatus::None);
        assert_eq!(family.newer_version(id(3)), None);
        assert_eq!(family.version_status(id(2)), MapVersionStatus::Superseded);
        assert_eq!(family.newer_version(id(2)), Some(id(7)));
    }

    #[test]
    fn newer_version_skips_a_variant_of_the_current() {
        let mut family = family();
        family.members[3].parent = Some(id(3));
        assert_eq!(family.newer_version(id(4)), None);
    }

    #[test]
    fn hidden_members_are_skipped_for_non_staff() {
        let family = family();
        let fork_child = family.member(id(6)).unwrap();
        let viewed = family.view(fork_child, false);
        // The unlisted fork is skipped, so its version shows as a fork of the fork's parent
        assert_eq!(viewed.parent_id, Some(id(2)));
        assert_eq!(viewed.relation, MapFamilyRelation::Fork);

        let viewed = family.view(fork_child, true);
        assert_eq!(viewed.parent_id, Some(id(5)));
        assert_eq!(viewed.relation, MapFamilyRelation::Version);
    }

    #[test]
    fn a_hidden_root_leaves_its_children_at_the_top() {
        let mut family = family();
        family.members[0].listed = false;
        let viewed = family.view(family.member(id(2)).unwrap(), false);
        assert_eq!(viewed.parent_id, None);
        assert_eq!(viewed.relation, MapFamilyRelation::Version);
    }
}
