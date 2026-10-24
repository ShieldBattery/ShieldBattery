//! Changing families by hand: linking a file under another, taking a file out of its family,
//! editing a member, deciding suggestions, and reports from users. Every change to a family takes
//! the families lock and rewrites the derived lines of the families it touched before its
//! transaction commits.

use std::collections::{HashMap, HashSet};

use chrono::{DateTime, Utc};
use color_eyre::eyre::{self, WrapErr};
use sqlx::{Postgres, Transaction};
use uuid::Uuid;

use crate::maps::SbMapId;
use crate::maps::families::rules::file_version;
use crate::maps::families::{MapFamilyRelation, MapLinkSource, lock_families, recompute_family};
use crate::users::SbUserId;

/// The longest note a family report can carry, in characters.
pub const MAX_REPORT_NOTE_LENGTH: usize = 500;

#[derive(Debug, thiserror::Error)]
pub enum FamilyEditError {
    #[error("map not found")]
    MapNotFound,
    #[error("the map isn't in a family")]
    NotInFamily,
    #[error("a map can't be linked to itself")]
    SelfLink,
    #[error("only a family's first file is its root")]
    RootRelation,
    #[error("a map can't be linked under a map that descends from it")]
    Cycle,
    #[error("the map's place in its family was set by someone who outranks you")]
    Locked,
    #[error("only listed maps can be pinned as the current version")]
    PinUnlisted,
    #[error("only the user who published a map can link it")]
    NotPublisher,
    #[error("only listed maps can be linked")]
    Unlisted,
    #[error("suggestion not found")]
    SuggestionNotFound,
    #[error("report not found")]
    ReportNotFound,
    #[error("a report of related maps needs the other map")]
    MissingOtherMap,
    #[error("the note must be at most {MAX_REPORT_NOTE_LENGTH} characters")]
    NoteTooLong,
    #[error(transparent)]
    Other(#[from] eyre::Report),
}

impl From<sqlx::Error> for FamilyEditError {
    fn from(error: sqlx::Error) -> Self {
        Self::Other(error.into())
    }
}

/// A family member as edits read it.
#[derive(Debug, Clone)]
struct Member {
    map_id: SbMapId,
    family_id: Uuid,
    parent: Option<SbMapId>,
    relation: MapFamilyRelation,
    source: MapLinkSource,
    line_root: SbMapId,
    first_seen_at: DateTime<Utc>,
}

async fn load_membership(
    tx: &mut Transaction<'_, Postgres>,
    map_id: SbMapId,
) -> eyre::Result<Option<Member>> {
    sqlx::query_as!(
        Member,
        r#"
            SELECT f.map_id as "map_id: SbMapId", f.family_id,
                f.parent_map_id as "parent: SbMapId", f.relation as "relation: MapFamilyRelation",
                f.source as "source: MapLinkSource", f.line_root_id as "line_root: SbMapId",
                m.first_seen_at
            FROM map_family_members f
            INNER JOIN maps m ON m.id = f.map_id
            WHERE f.map_id = $1
        "#,
        map_id as _,
    )
    .fetch_optional(&mut **tx)
    .await
    .wrap_err("Failed to load family membership")
}

async fn load_family_members(
    tx: &mut Transaction<'_, Postgres>,
    family_id: Uuid,
) -> eyre::Result<Vec<Member>> {
    sqlx::query_as!(
        Member,
        r#"
            SELECT f.map_id as "map_id: SbMapId", f.family_id,
                f.parent_map_id as "parent: SbMapId", f.relation as "relation: MapFamilyRelation",
                f.source as "source: MapLinkSource", f.line_root_id as "line_root: SbMapId",
                m.first_seen_at
            FROM map_family_members f
            INNER JOIN maps m ON m.id = f.map_id
            WHERE f.family_id = $1
        "#,
        family_id,
    )
    .fetch_all(&mut **tx)
    .await
    .wrap_err("Failed to load family members")
}

/// `root` and every member below it.
fn subtree(members: &[Member], root: SbMapId) -> Vec<SbMapId> {
    let mut children: HashMap<SbMapId, Vec<SbMapId>> = HashMap::new();
    for member in members {
        if let Some(parent) = member.parent {
            children.entry(parent).or_default().push(member.map_id);
        }
    }
    let mut found = vec![root];
    let mut seen = HashSet::from([root]);
    let mut i = 0;
    while i < found.len() {
        for &child in children.get(&found[i]).into_iter().flatten() {
            if seen.insert(child) {
                found.push(child);
            }
        }
        i += 1;
    }
    found
}

/// The parsed version of a map's file, the label a new member starts with.
async fn parsed_version_label(
    tx: &mut Transaction<'_, Postgres>,
    map_id: SbMapId,
) -> eyre::Result<Option<String>> {
    let row = sqlx::query!(
        "SELECT title, description, public_name FROM maps WHERE id = $1",
        map_id as _,
    )
    .fetch_one(&mut **tx)
    .await
    .wrap_err("Failed to load map for its version")?;
    let display_name = row.public_name.as_deref().unwrap_or(&row.title);
    Ok(file_version(&row.title, &row.description, display_name))
}

struct MapRow {
    listed: bool,
    published_by: Option<SbUserId>,
}

async fn load_map_row(
    tx: &mut Transaction<'_, Postgres>,
    map_id: SbMapId,
) -> Result<MapRow, FamilyEditError> {
    sqlx::query_as!(
        MapRow,
        r#"
            SELECT listed as "listed!", published_by as "published_by: SbUserId"
            FROM maps
            WHERE id = $1
        "#,
        map_id as _,
    )
    .fetch_optional(&mut **tx)
    .await
    .wrap_err("Failed to load map")?
    .ok_or(FamilyEditError::MapNotFound)
}

/// A request to place a file in a family under another file.
#[derive(Debug, Clone)]
pub struct LinkRequest {
    pub map_id: SbMapId,
    pub parent_id: SbMapId,
    pub relation: MapFamilyRelation,
    /// The member's version label. `None` keeps the current one, or for a file that wasn't in a
    /// family, the version parsed from it.
    pub version_label: Option<Option<String>>,
}

/// Places `map_id` (with every member below it) under `parent_id`, moving it out of its family if
/// it was in another one. A parent outside any family becomes the root of a new one. Open
/// suggestions between files that end up in one family are accepted.
pub async fn link(
    tx: &mut Transaction<'_, Postgres>,
    request: &LinkRequest,
    source: MapLinkSource,
    actor: SbUserId,
) -> Result<(), FamilyEditError> {
    let LinkRequest {
        map_id,
        parent_id,
        relation,
        ref version_label,
    } = *request;
    if map_id == parent_id {
        return Err(FamilyEditError::SelfLink);
    }
    if relation == MapFamilyRelation::Root {
        return Err(FamilyEditError::RootRelation);
    }
    load_map_row(tx, map_id).await?;
    load_map_row(tx, parent_id).await?;

    lock_families(tx).await?;
    let member = load_membership(tx, map_id).await?;
    let parent = load_membership(tx, parent_id).await?;
    if member.as_ref().is_some_and(|m| m.source > source) {
        return Err(FamilyEditError::Locked);
    }
    if let (Some(m), Some(p)) = (&member, &parent)
        && m.family_id == p.family_id
    {
        let members = load_family_members(tx, m.family_id).await?;
        if subtree(&members, map_id).contains(&parent_id) {
            return Err(FamilyEditError::Cycle);
        }
    }

    let family_id = match &parent {
        Some(p) => p.family_id,
        None => {
            let family_id =
                sqlx::query_scalar!("INSERT INTO map_families DEFAULT VALUES RETURNING id")
                    .fetch_one(&mut **tx)
                    .await
                    .wrap_err("Failed to create family")?;
            let label = parsed_version_label(tx, parent_id).await?;
            insert_member(
                tx,
                family_id,
                parent_id,
                None,
                MapFamilyRelation::Root,
                label,
                source,
                actor,
            )
            .await?;
            family_id
        }
    };

    let mut old_family = None;
    match member {
        None => {
            let label = match version_label {
                Some(label) => label.clone(),
                None => parsed_version_label(tx, map_id).await?,
            };
            insert_member(
                tx,
                family_id,
                map_id,
                Some(parent_id),
                relation,
                label,
                source,
                actor,
            )
            .await?;
        }
        Some(m) => {
            if m.family_id != family_id {
                let members = load_family_members(tx, m.family_id).await?;
                let moved: Vec<Uuid> = subtree(&members, map_id).iter().map(|id| id.0).collect();
                sqlx::query!(
                    "UPDATE map_family_members SET family_id = $2 WHERE map_id = ANY($1)",
                    &moved,
                    family_id,
                )
                .execute(&mut **tx)
                .await
                .wrap_err("Failed to move family members")?;
                old_family = Some(m.family_id);
            }
            sqlx::query!(
                r#"
                    UPDATE map_family_members
                    SET parent_map_id = $2, relation = $3, source = $4, linked_by = $5,
                        linked_at = now(),
                        version_label = CASE WHEN $6 THEN $7 ELSE version_label END
                    WHERE map_id = $1
                "#,
                map_id as _,
                parent_id as _,
                relation as _,
                source as _,
                actor as _,
                version_label.is_some(),
                version_label.clone().flatten(),
            )
            .execute(&mut **tx)
            .await
            .wrap_err("Failed to update family member")?;
        }
    }

    let (a, b) = ordered(map_id, parent_id);
    sqlx::query!(
        r#"
            UPDATE map_link_suggestions
            SET status = 'accepted', decided_by = $3, decided_at = now()
            WHERE map_a = $1 AND map_b = $2
        "#,
        a as _,
        b as _,
        actor as _,
    )
    .execute(&mut **tx)
    .await
    .wrap_err("Failed to accept suggestion")?;
    sqlx::query!(
        r#"
            UPDATE map_link_suggestions s
            SET status = 'accepted', decided_by = $2, decided_at = now()
            FROM map_family_members fa, map_family_members fb
            WHERE s.status = 'open' AND fa.map_id = s.map_a AND fb.map_id = s.map_b
                AND fa.family_id = $1 AND fb.family_id = $1
        "#,
        family_id,
        actor as _,
    )
    .execute(&mut **tx)
    .await
    .wrap_err("Failed to accept suggestions within the family")?;

    recompute_family(tx, family_id).await?;
    if let Some(old_family) = old_family {
        recompute_family(tx, old_family).await?;
    }
    Ok(())
}

fn ordered(x: SbMapId, y: SbMapId) -> (SbMapId, SbMapId) {
    if x.0 < y.0 { (x, y) } else { (y, x) }
}

#[allow(clippy::too_many_arguments)]
async fn insert_member(
    tx: &mut Transaction<'_, Postgres>,
    family_id: Uuid,
    map_id: SbMapId,
    parent_id: Option<SbMapId>,
    relation: MapFamilyRelation,
    version_label: Option<String>,
    source: MapLinkSource,
    actor: SbUserId,
) -> eyre::Result<()> {
    sqlx::query!(
        r#"
            INSERT INTO map_family_members (map_id, family_id, parent_map_id, relation,
                version_label, source, linked_by, linked_at, line_root_id, line_current_id)
            VALUES ($1, $2, $3, $4, $5, $6, $7, now(), $1, $1)
        "#,
        map_id as _,
        family_id,
        parent_id as _,
        relation as _,
        version_label,
        source as _,
        actor as _,
    )
    .execute(&mut **tx)
    .await
    .wrap_err("Failed to add family member")?;
    Ok(())
}

/// The child that takes `map_id`'s place when it leaves a line it starts: its oldest version, else
/// its oldest child.
fn successor(members: &[Member], map_id: SbMapId) -> Option<SbMapId> {
    members
        .iter()
        .filter(|m| m.parent == Some(map_id))
        .min_by_key(|m| {
            (
                m.relation != MapFamilyRelation::Version,
                m.first_seen_at,
                m.map_id.0,
            )
        })
        .map(|m| m.map_id)
}

/// Takes a file out of its family. When it starts a line (the family's root or a fork), its oldest
/// version takes its place and the other children move under that; otherwise its children move up
/// to its parent. Suggestions pairing it with its former relatives are rejected, so detection
/// doesn't propose them again.
pub async fn remove(
    tx: &mut Transaction<'_, Postgres>,
    map_id: SbMapId,
    source: MapLinkSource,
    actor: SbUserId,
) -> Result<(), FamilyEditError> {
    lock_families(tx).await?;
    let member = load_membership(tx, map_id)
        .await?
        .ok_or(FamilyEditError::NotInFamily)?;
    if member.source > source {
        return Err(FamilyEditError::Locked);
    }
    let members = load_family_members(tx, member.family_id).await?;
    let starts_line = member.relation.starts_line() || member.parent.is_none();
    match successor(&members, map_id) {
        None => {}
        Some(_) if !starts_line => {
            sqlx::query!(
                "UPDATE map_family_members SET parent_map_id = $2 WHERE parent_map_id = $1",
                map_id as _,
                member.parent as _,
            )
            .execute(&mut **tx)
            .await
            .wrap_err("Failed to move children up")?;
        }
        Some(successor) => {
            sqlx::query!(
                r#"
                    UPDATE map_family_members
                    SET parent_map_id = CASE WHEN map_id = $2 THEN $3 ELSE $2 END,
                        relation = CASE WHEN map_id = $2 THEN $4 ELSE relation END
                    WHERE parent_map_id = $1
                "#,
                map_id as _,
                successor as _,
                member.parent as _,
                member.relation as _,
            )
            .execute(&mut **tx)
            .await
            .wrap_err("Failed to promote a child")?;
        }
    }

    let relatives: Vec<Uuid> = members
        .iter()
        .filter(|m| m.map_id != map_id)
        .map(|m| m.map_id.0)
        .collect();
    sqlx::query!(
        r#"
            UPDATE map_link_suggestions
            SET status = 'rejected', decided_by = $3, decided_at = now()
            WHERE (map_a = $1 AND map_b = ANY($2)) OR (map_b = $1 AND map_a = ANY($2))
        "#,
        map_id as _,
        &relatives,
        actor as _,
    )
    .execute(&mut **tx)
    .await
    .wrap_err("Failed to reject suggestions")?;
    sqlx::query!(
        "DELETE FROM map_family_members WHERE map_id = $1",
        map_id as _
    )
    .execute(&mut **tx)
    .await
    .wrap_err("Failed to remove family member")?;
    recompute_family(tx, member.family_id).await?;
    Ok(())
}

/// Changes a member's version label and whether it's pinned as its line's current version.
/// Pinning a member unpins any other member of its line.
pub async fn update_member(
    tx: &mut Transaction<'_, Postgres>,
    map_id: SbMapId,
    version_label: Option<Option<String>>,
    pinned_current: Option<bool>,
) -> Result<(), FamilyEditError> {
    lock_families(tx).await?;
    let member = load_membership(tx, map_id)
        .await?
        .ok_or(FamilyEditError::NotInFamily)?;
    if pinned_current == Some(true) {
        if !load_map_row(tx, map_id).await?.listed {
            return Err(FamilyEditError::PinUnlisted);
        }
        sqlx::query!(
            r#"
                UPDATE map_family_members
                SET pinned_current = false
                WHERE line_root_id = $1 AND map_id <> $2 AND pinned_current
            "#,
            member.line_root as _,
            map_id as _,
        )
        .execute(&mut **tx)
        .await
        .wrap_err("Failed to unpin the line's current")?;
    }
    sqlx::query!(
        r#"
            UPDATE map_family_members
            SET version_label = CASE WHEN $2 THEN $3 ELSE version_label END,
                pinned_current = COALESCE($4, pinned_current)
            WHERE map_id = $1
        "#,
        map_id as _,
        version_label.is_some(),
        version_label.flatten(),
        pinned_current,
    )
    .execute(&mut **tx)
    .await
    .wrap_err("Failed to update family member")?;
    recompute_family(tx, member.family_id).await?;
    Ok(())
}

/// What staff can set a suggestion's status to. Accepting a suggestion is linking its files.
#[derive(async_graphql::Enum, Copy, Clone, Debug, Eq, PartialEq)]
pub enum MapLinkSuggestionDecision {
    /// Back to waiting for a decision.
    Open,
    /// The files aren't related.
    Rejected,
    /// A UMS map built on the other map's terrain: related, but never in its family.
    TerrainOnly,
}

impl MapLinkSuggestionDecision {
    fn status(self) -> &'static str {
        match self {
            Self::Open => "open",
            Self::Rejected => "rejected",
            Self::TerrainOnly => "terrain_only",
        }
    }
}

pub async fn decide_suggestion(
    tx: &mut Transaction<'_, Postgres>,
    x: SbMapId,
    y: SbMapId,
    decision: MapLinkSuggestionDecision,
    actor: SbUserId,
) -> Result<(), FamilyEditError> {
    let (a, b) = ordered(x, y);
    let open = decision == MapLinkSuggestionDecision::Open;
    let updated = sqlx::query!(
        r#"
            UPDATE map_link_suggestions
            SET status = $3,
                decided_by = CASE WHEN $4 THEN NULL ELSE $5::integer END,
                decided_at = CASE WHEN $4 THEN NULL ELSE now() END
            WHERE map_a = $1 AND map_b = $2
        "#,
        a as _,
        b as _,
        decision.status(),
        open,
        actor as _,
    )
    .execute(&mut **tx)
    .await
    .wrap_err("Failed to decide suggestion")?;
    if updated.rows_affected() == 0 {
        return Err(FamilyEditError::SuggestionNotFound);
    }
    Ok(())
}

/// Whether `user` linking a version under `parent_id` may make it the current version of
/// `parent_id`'s line: they published the line's first file, or nobody is known to have and staff
/// haven't pinned a current version.
async fn may_supersede(
    tx: &mut Transaction<'_, Postgres>,
    user: SbUserId,
    parent_id: SbMapId,
) -> Result<bool, FamilyEditError> {
    let line_root = load_membership(tx, parent_id)
        .await?
        .map_or(parent_id, |m| m.line_root);
    let pinned = sqlx::query_scalar!(
        r#"
            SELECT EXISTS (
                SELECT 1 FROM map_family_members WHERE line_root_id = $1 AND pinned_current
            ) as "pinned!"
        "#,
        line_root as _,
    )
    .fetch_one(&mut **tx)
    .await
    .wrap_err("Failed to check for a pinned current")?;
    let root_publisher = load_map_row(tx, line_root).await?.published_by;
    Ok(match root_publisher {
        Some(publisher) => publisher == user,
        None => !pinned,
    })
}

/// Links a map its publisher listed under another listed map. A `version` link that would take
/// over a line whose first file someone else published is stored as a `fork`, with a report asking
/// staff to make it a version. Returns the relation that was stored.
pub async fn publisher_link(
    tx: &mut Transaction<'_, Postgres>,
    user: SbUserId,
    map_id: SbMapId,
    parent_id: SbMapId,
    relation: MapFamilyRelation,
) -> Result<MapFamilyRelation, FamilyEditError> {
    let map = load_map_row(tx, map_id).await?;
    if map.published_by != Some(user) {
        return Err(FamilyEditError::NotPublisher);
    }
    if !map.listed || !load_map_row(tx, parent_id).await?.listed {
        return Err(FamilyEditError::Unlisted);
    }
    lock_families(tx).await?;
    let stored =
        if relation == MapFamilyRelation::Version && !may_supersede(tx, user, parent_id).await? {
            MapFamilyRelation::Fork
        } else {
            relation
        };
    link(
        tx,
        &LinkRequest {
            map_id,
            parent_id,
            relation: stored,
            version_label: None,
        },
        MapLinkSource::Publisher,
        user,
    )
    .await?;
    if stored != relation {
        insert_report(
            tx,
            &ReportRequest {
                map_id,
                kind: MapFamilyReportKind::Related,
                other_map_id: Some(parent_id),
                suggested_relation: Some(relation),
                note: None,
            },
            user,
        )
        .await?;
    }
    Ok(stored)
}

/// Takes a map its publisher listed out of its family, unless staff placed it.
pub async fn publisher_unlink(
    tx: &mut Transaction<'_, Postgres>,
    user: SbUserId,
    map_id: SbMapId,
) -> Result<(), FamilyEditError> {
    if load_map_row(tx, map_id).await?.published_by != Some(user) {
        return Err(FamilyEditError::NotPublisher);
    }
    remove(tx, map_id, MapLinkSource::Publisher, user).await
}

/// What a user is telling staff about a map's family.
#[derive(async_graphql::Enum, Copy, Clone, Debug, Eq, PartialEq)]
pub enum MapFamilyReportKind {
    /// The map is in a family it doesn't belong to.
    WrongFamily,
    /// The map is related to another map it isn't linked with.
    Related,
}

impl MapFamilyReportKind {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::WrongFamily => "wrong_family",
            Self::Related => "related",
        }
    }

    pub fn from_db(kind: &str) -> Self {
        match kind {
            "related" => Self::Related,
            _ => Self::WrongFamily,
        }
    }
}

#[derive(Debug, Clone)]
pub struct ReportRequest {
    pub map_id: SbMapId,
    pub kind: MapFamilyReportKind,
    pub other_map_id: Option<SbMapId>,
    pub suggested_relation: Option<MapFamilyRelation>,
    pub note: Option<String>,
}

/// Stores a family report, or returns the reporter's open report about the same maps. Returns
/// the report's id.
pub async fn insert_report(
    tx: &mut Transaction<'_, Postgres>,
    request: &ReportRequest,
    reported_by: SbUserId,
) -> Result<Uuid, FamilyEditError> {
    let other_map_id = match request.kind {
        MapFamilyReportKind::Related => Some(
            request
                .other_map_id
                .ok_or(FamilyEditError::MissingOtherMap)?,
        ),
        MapFamilyReportKind::WrongFamily => None,
    };
    if other_map_id == Some(request.map_id) {
        return Err(FamilyEditError::SelfLink);
    }
    let suggested_relation = request
        .suggested_relation
        .filter(|_| other_map_id.is_some());
    if suggested_relation == Some(MapFamilyRelation::Root) {
        return Err(FamilyEditError::RootRelation);
    }
    let note = request
        .note
        .as_deref()
        .map(str::trim)
        .filter(|n| !n.is_empty());
    if note.is_some_and(|n| n.chars().count() > MAX_REPORT_NOTE_LENGTH) {
        return Err(FamilyEditError::NoteTooLong);
    }
    load_map_row(tx, request.map_id).await?;
    if let Some(other) = other_map_id {
        load_map_row(tx, other).await?;
    }

    let id = sqlx::query_scalar!(
        r#"
            INSERT INTO map_family_reports (map_id, other_map_id, kind, suggested_relation, note,
                reported_by)
            VALUES ($1, $2, $3, $4, $5, $6)
            ON CONFLICT (reported_by, map_id, COALESCE(other_map_id, map_id))
                WHERE status = 'open'
            DO UPDATE SET suggested_relation = EXCLUDED.suggested_relation,
                note = COALESCE(EXCLUDED.note, map_family_reports.note),
                reported_at = now()
            RETURNING id
        "#,
        request.map_id as _,
        other_map_id as _,
        request.kind.as_str(),
        suggested_relation as _,
        note,
        reported_by as _,
    )
    .fetch_one(&mut **tx)
    .await
    .wrap_err("Failed to store family report")?;
    Ok(id)
}

/// How staff closed a family report.
#[derive(async_graphql::Enum, Copy, Clone, Debug, Eq, PartialEq)]
pub enum MapFamilyReportStatus {
    /// Waiting for staff.
    Open,
    /// Staff acted on it.
    Resolved,
    /// Staff found nothing to change.
    Dismissed,
}

impl MapFamilyReportStatus {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Open => "open",
            Self::Resolved => "resolved",
            Self::Dismissed => "dismissed",
        }
    }

    pub fn from_db(status: &str) -> Self {
        match status {
            "resolved" => Self::Resolved,
            "dismissed" => Self::Dismissed,
            _ => Self::Open,
        }
    }
}

pub async fn set_report_status(
    tx: &mut Transaction<'_, Postgres>,
    id: Uuid,
    status: MapFamilyReportStatus,
    actor: SbUserId,
) -> Result<(), FamilyEditError> {
    let open = status == MapFamilyReportStatus::Open;
    let updated = sqlx::query!(
        r#"
            UPDATE map_family_reports
            SET status = $2,
                resolved_by = CASE WHEN $3 THEN NULL ELSE $4::integer END,
                resolved_at = CASE WHEN $3 THEN NULL ELSE now() END
            WHERE id = $1
        "#,
        id,
        status.as_str(),
        open,
        actor as _,
    )
    .execute(&mut **tx)
    .await
    .wrap_err("Failed to update family report")?;
    if updated.rows_affected() == 0 {
        return Err(FamilyEditError::ReportNotFound);
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn id(n: u8) -> SbMapId {
        SbMapId(Uuid::from_bytes([n; 16]))
    }

    fn member(n: u8, parent: Option<u8>) -> Member {
        Member {
            map_id: id(n),
            family_id: Uuid::nil(),
            parent: parent.map(id),
            relation: MapFamilyRelation::Version,
            source: MapLinkSource::Rule,
            line_root: id(1),
            first_seen_at: DateTime::UNIX_EPOCH,
        }
    }

    #[test]
    fn subtree_holds_every_descendant() {
        let members = [
            member(1, None),
            member(2, Some(1)),
            member(3, Some(2)),
            member(4, Some(1)),
            member(5, Some(3)),
        ];
        let mut found = subtree(&members, id(2));
        found.sort_by_key(|m| m.0);
        assert_eq!(found, [id(2), id(3), id(5)]);
        assert_eq!(subtree(&members, id(4)), [id(4)]);
    }

    #[test]
    fn successor_prefers_the_oldest_version() {
        let mut variant = member(2, Some(1));
        variant.relation = MapFamilyRelation::Variant;
        let mut newer = member(3, Some(1));
        newer.first_seen_at = DateTime::from_timestamp(10, 0).unwrap();
        let mut older = member(4, Some(1));
        older.first_seen_at = DateTime::from_timestamp(5, 0).unwrap();
        let members = [member(1, None), variant, newer, older];
        assert_eq!(successor(&members, id(1)), Some(id(4)));
        assert_eq!(successor(&members, id(4)), None);
        assert_eq!(successor(&members[..2], id(1)), Some(id(2)));
    }

    #[test]
    fn sources_rank_moderators_highest() {
        assert!(MapLinkSource::Moderator > MapLinkSource::Publisher);
        assert!(MapLinkSource::Publisher > MapLinkSource::Rule);
    }
}
