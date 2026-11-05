//! The record of every change a person makes to families, suggestions and family reports, so staff
//! can check a reviewer's decisions and undo the wrong ones.
//!
//! Every entry one transaction records is one batch (e.g. one save of the family editor), and
//! batches are undone as a whole. Entries recorded before batches existed are each a batch of
//! their own.

use std::collections::{BTreeMap, BTreeSet};

use async_graphql::{Context, Enum, Object, Result};
use chrono::{DateTime, Utc};
use color_eyre::eyre::{self, WrapErr};
use serde::{Deserialize, Serialize};
use sqlx::types::Json;
use sqlx::{PgPool, Postgres, Transaction};
use uuid::Uuid;

use crate::maps::SbMapId;
use crate::maps::catalog::SbMap;
use crate::maps::families::edit::MapFamilyReportStatus;
use crate::maps::families::graphql::{MapLinkSuggestionStatus, load_sb_map, load_user};
use crate::maps::families::{MapFamilyRelation, MapLinkSource};
use crate::users::{SbUser, SbUserId};

/// What kind of change a history entry records.
#[derive(Enum, Copy, Clone, Debug, Eq, PartialEq)]
pub enum MapFamilyHistoryKind {
    /// A map was placed under another map.
    Link,
    /// A map was taken out of its family.
    Remove,
    /// A member's version label or pinned current version changed.
    UpdateMember,
    /// A family's staff label changed.
    SetLabel,
    /// A suggestion was rejected, marked terrain only, or reopened.
    DecideSuggestion,
    /// A family report was resolved, dismissed or reopened.
    ReportStatus,
    /// A batch of changes was reverted. Its member, suggestion and label changes are the
    /// reversal, so an undo can itself be undone.
    Undo,
}

impl MapFamilyHistoryKind {
    fn as_str(self) -> &'static str {
        match self {
            Self::Link => "link",
            Self::Remove => "remove",
            Self::UpdateMember => "update_member",
            Self::SetLabel => "set_label",
            Self::DecideSuggestion => "decide_suggestion",
            Self::ReportStatus => "report_status",
            Self::Undo => "undo",
        }
    }

    pub(crate) fn from_db(kind: &str) -> Self {
        match kind {
            "remove" => Self::Remove,
            "update_member" => Self::UpdateMember,
            "set_label" => Self::SetLabel,
            "decide_suggestion" => Self::DecideSuggestion,
            "report_status" => Self::ReportStatus,
            "undo" => Self::Undo,
            _ => Self::Link,
        }
    }
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct MapFamilyMemberState {
    pub family_id: Uuid,
    pub parent_id: Option<SbMapId>,
    pub relation: MapFamilyRelation,
    pub version_label: Option<String>,
    pub pinned_current: bool,
    pub source: MapLinkSource,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct MapFamilyMemberChange {
    pub map_id: SbMapId,
    pub before: Option<MapFamilyMemberState>,
    pub after: Option<MapFamilyMemberState>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct MapFamilySuggestionChange {
    pub map_a: SbMapId,
    pub map_b: SbMapId,
    pub before: MapLinkSuggestionStatus,
    pub after: MapLinkSuggestionStatus,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub struct Change<T> {
    pub before: T,
    pub after: T,
}

#[derive(Serialize, Deserialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub struct HistoryDetails {
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub members: Vec<MapFamilyMemberChange>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub suggestions: Vec<MapFamilySuggestionChange>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub label: Option<Change<Option<String>>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub report_id: Option<Uuid>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub report_status: Option<Change<MapFamilyReportStatus>>,
    /// For an undo, the entry whose batch it reverted.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub undone_entry_id: Option<Uuid>,
}

/// One change to record.
pub struct HistoryEntry {
    pub kind: MapFamilyHistoryKind,
    pub actor: SbUserId,
    pub source: MapLinkSource,
    pub map_id: Option<SbMapId>,
    pub other_map_id: Option<SbMapId>,
    pub family_id: Option<Uuid>,
    pub details: HistoryDetails,
}

pub async fn record(tx: &mut Transaction<'_, Postgres>, entry: HistoryEntry) -> eyre::Result<()> {
    sqlx::query!(
        r#"
            INSERT INTO map_family_history (kind, actor, source, map_id, other_map_id, family_id,
                details)
            VALUES ($1, $2, $3, $4, $5, $6, $7)
        "#,
        entry.kind.as_str(),
        entry.actor as _,
        entry.source as _,
        entry.map_id as _,
        entry.other_map_id as _,
        entry.family_id,
        Json(&entry.details) as _,
    )
    .execute(&mut **tx)
    .await
    .wrap_err("Failed to record family history")?;
    Ok(())
}

/// The first entry the current transaction recorded, which identifies its batch.
pub async fn first_entry_of_transaction(
    tx: &mut Transaction<'_, Postgres>,
) -> eyre::Result<Option<Uuid>> {
    sqlx::query_scalar!(
        r#"
            SELECT id
            FROM map_family_history
            WHERE batch_id = map_family_history_batch()
            ORDER BY created_at, id
            LIMIT 1
        "#
    )
    .fetch_optional(&mut **tx)
    .await
    .wrap_err("Failed to load the transaction's first history entry")
}

/// An entry of a batch, as undoing it reads it.
pub struct BatchEntry {
    pub kind: MapFamilyHistoryKind,
    pub actor: SbUserId,
    pub map_id: Option<SbMapId>,
    pub other_map_id: Option<SbMapId>,
    pub family_id: Option<Uuid>,
    pub details: HistoryDetails,
}

/// Every entry of the batch holding `entry_id`, in the order they were recorded. Empty when there
/// is no such entry.
pub async fn load_batch(
    tx: &mut Transaction<'_, Postgres>,
    entry_id: Uuid,
) -> eyre::Result<Vec<BatchEntry>> {
    let rows = sqlx::query!(
        r#"
            SELECT kind, actor as "actor: SbUserId", map_id as "map_id: SbMapId",
                other_map_id as "other_map_id: SbMapId", family_id,
                details as "details: Json<HistoryDetails>"
            FROM map_family_history
            WHERE id = $1
                OR batch_id = (SELECT batch_id FROM map_family_history WHERE id = $1)
            ORDER BY created_at, id
        "#,
        entry_id,
    )
    .fetch_all(&mut **tx)
    .await
    .wrap_err("Failed to load the history batch")?;
    Ok(rows
        .into_iter()
        .map(|row| BatchEntry {
            kind: MapFamilyHistoryKind::from_db(&row.kind),
            actor: row.actor,
            map_id: row.map_id,
            other_map_id: row.other_map_id,
            family_id: row.family_id,
            details: row.details.0,
        })
        .collect())
}

/// The places of every member of `family_ids`, plus `map_ids` wherever they are.
pub type Snapshot = BTreeMap<Uuid, MapFamilyMemberState>;

pub async fn snapshot(
    tx: &mut Transaction<'_, Postgres>,
    family_ids: &[Uuid],
    map_ids: &[SbMapId],
) -> eyre::Result<Snapshot> {
    let map_ids: Vec<Uuid> = map_ids.iter().map(|id| id.0).collect();
    let rows = sqlx::query!(
        r#"
            SELECT map_id, family_id, parent_map_id as "parent_id: SbMapId",
                relation as "relation: MapFamilyRelation", version_label, pinned_current,
                source as "source: MapLinkSource"
            FROM map_family_members
            WHERE family_id = ANY($1) OR map_id = ANY($2)
        "#,
        family_ids,
        &map_ids,
    )
    .fetch_all(&mut **tx)
    .await
    .wrap_err("Failed to snapshot family members")?;
    Ok(rows
        .into_iter()
        .map(|row| {
            (
                row.map_id,
                MapFamilyMemberState {
                    family_id: row.family_id,
                    parent_id: row.parent_id,
                    relation: row.relation,
                    version_label: row.version_label,
                    pinned_current: row.pinned_current,
                    source: row.source,
                },
            )
        })
        .collect())
}

/// The members whose place differs between the snapshots.
pub fn diff(before: &Snapshot, after: &Snapshot) -> Vec<MapFamilyMemberChange> {
    let ids: BTreeSet<&Uuid> = before.keys().chain(after.keys()).collect();
    ids.into_iter()
        .filter_map(|id| {
            let (b, a) = (before.get(id), after.get(id));
            (b != a).then(|| MapFamilyMemberChange {
                map_id: SbMapId(*id),
                before: b.cloned(),
                after: a.cloned(),
            })
        })
        .collect()
}

pub struct MemberStateView<'a> {
    id: String,
    state: &'a MapFamilyMemberState,
}

/// A file's place in its family at one point in time.
#[Object(name = "MapFamilyMemberState")]
impl MemberStateView<'_> {
    async fn id(&self) -> &str {
        &self.id
    }

    async fn family_id(&self) -> Uuid {
        self.state.family_id
    }

    async fn parent_id(&self) -> Option<SbMapId> {
        self.state.parent_id
    }

    async fn parent(&self, ctx: &Context<'_>) -> Result<Option<SbMap>> {
        match self.state.parent_id {
            Some(id) => load_sb_map(ctx, id).await.map(Some),
            None => Ok(None),
        }
    }

    async fn relation(&self) -> MapFamilyRelation {
        self.state.relation
    }

    async fn version_label(&self) -> Option<&str> {
        self.state.version_label.as_deref()
    }

    async fn pinned_current(&self) -> bool {
        self.state.pinned_current
    }

    async fn source(&self) -> MapLinkSource {
        self.state.source
    }
}

pub struct MemberChangeView<'a> {
    entry_id: Uuid,
    change: &'a MapFamilyMemberChange,
}

impl<'a> MemberChangeView<'a> {
    fn state(
        &self,
        side: &str,
        state: &'a Option<MapFamilyMemberState>,
    ) -> Option<MemberStateView<'a>> {
        state.as_ref().map(|state| MemberStateView {
            id: format!(
                "map-family-history:{}:member:{}:{side}",
                self.entry_id, self.change.map_id
            ),
            state,
        })
    }
}

/// How one file's place changed.
#[Object(name = "MapFamilyMemberChange")]
impl<'a> MemberChangeView<'a> {
    async fn id(&self) -> String {
        format!(
            "map-family-history:{}:member:{}",
            self.entry_id, self.change.map_id
        )
    }

    async fn map_id(&self) -> SbMapId {
        self.change.map_id
    }

    async fn map(&self, ctx: &Context<'_>) -> Result<SbMap> {
        load_sb_map(ctx, self.change.map_id).await
    }

    /// Null when the file wasn't in a family.
    async fn before(&self) -> Option<MemberStateView<'a>> {
        self.state("before", &self.change.before)
    }

    /// Null when the file left its family.
    async fn after(&self) -> Option<MemberStateView<'a>> {
        self.state("after", &self.change.after)
    }
}

pub struct SuggestionChangeView<'a> {
    entry_id: Uuid,
    change: &'a MapFamilySuggestionChange,
}

/// How one suggestion's status changed.
#[Object(name = "MapFamilySuggestionChange")]
impl SuggestionChangeView<'_> {
    async fn id(&self) -> String {
        format!(
            "map-family-history:{}:suggestion:{}:{}",
            self.entry_id, self.change.map_a, self.change.map_b
        )
    }

    async fn map_a(&self) -> SbMapId {
        self.change.map_a
    }

    async fn map_b(&self) -> SbMapId {
        self.change.map_b
    }

    async fn before(&self) -> MapLinkSuggestionStatus {
        self.change.before
    }

    async fn after(&self) -> MapLinkSuggestionStatus {
        self.change.after
    }
}

pub struct MapFamilyHistory {
    id: Uuid,
    kind: String,
    actor: SbUserId,
    source: MapLinkSource,
    map_id: Option<SbMapId>,
    other_map_id: Option<SbMapId>,
    family_id: Option<Uuid>,
    details: Json<HistoryDetails>,
    created_at: DateTime<Utc>,
}

/// A change a person made to families, suggestions or family reports.
#[async_graphql::Object]
impl MapFamilyHistory {
    async fn id(&self) -> String {
        format!("map-family-history:{}", self.id)
    }

    /// The entry's own id, which `mapFamilyUndo` takes.
    async fn entry_id(&self) -> Uuid {
        self.id
    }

    async fn kind(&self) -> MapFamilyHistoryKind {
        MapFamilyHistoryKind::from_db(&self.kind)
    }

    async fn actor(&self, ctx: &Context<'_>) -> Result<Option<SbUser>> {
        load_user(ctx, Some(self.actor)).await
    }

    /// The role the actor acted in.
    async fn source(&self) -> MapLinkSource {
        self.source
    }

    /// The map the change was about. Null for a label change.
    async fn map(&self, ctx: &Context<'_>) -> Result<Option<SbMap>> {
        match self.map_id {
            Some(id) => load_sb_map(ctx, id).await.map(Some),
            None => Ok(None),
        }
    }

    /// The parent of a link, or the other map of a suggestion or report.
    async fn other_map(&self, ctx: &Context<'_>) -> Result<Option<SbMap>> {
        match self.other_map_id {
            Some(id) => load_sb_map(ctx, id).await.map(Some),
            None => Ok(None),
        }
    }

    /// The family of a label change.
    async fn family_id(&self) -> Option<Uuid> {
        self.family_id
    }

    /// Every file whose place changed, including files that moved along with the map.
    async fn member_changes(&self) -> Vec<MemberChangeView<'_>> {
        self.details
            .0
            .members
            .iter()
            .map(|change| MemberChangeView {
                entry_id: self.id,
                change,
            })
            .collect()
    }

    /// Every suggestion whose status changed, including ones a link accepted or a removal
    /// rejected.
    async fn suggestion_changes(&self) -> Vec<SuggestionChangeView<'_>> {
        self.details
            .0
            .suggestions
            .iter()
            .map(|change| SuggestionChangeView {
                entry_id: self.id,
                change,
            })
            .collect()
    }

    async fn label_before(&self) -> Option<&str> {
        self.details.0.label.as_ref()?.before.as_deref()
    }

    async fn label_after(&self) -> Option<&str> {
        self.details.0.label.as_ref()?.after.as_deref()
    }

    async fn report_id(&self) -> Option<Uuid> {
        self.details.0.report_id
    }

    async fn report_status_before(&self) -> Option<MapFamilyReportStatus> {
        self.details.0.report_status.as_ref().map(|c| c.before)
    }

    async fn report_status_after(&self) -> Option<MapFamilyReportStatus> {
        self.details.0.report_status.as_ref().map(|c| c.after)
    }

    /// For an undo, the entry whose batch it reverted.
    async fn undone_entry_id(&self) -> Option<Uuid> {
        self.details.0.undone_entry_id
    }

    async fn created_at(&self) -> DateTime<Utc> {
        self.created_at
    }
}

/// Loads history entries, newest first. Entries match when they're about one of `map_ids` (as
/// either map) or `family_ids`, and were made by `actor`; filters left out match everything.
pub async fn load_history(
    db: &PgPool,
    map_ids: Option<&[SbMapId]>,
    family_ids: Option<&[Uuid]>,
    actor: Option<SbUserId>,
    limit: i64,
    offset: i64,
) -> eyre::Result<Vec<MapFamilyHistory>> {
    let map_ids: Option<Vec<Uuid>> = map_ids.map(|ids| ids.iter().map(|id| id.0).collect());
    let about_filter = map_ids.is_some() || family_ids.is_some();
    sqlx::query_as!(
        MapFamilyHistory,
        r#"
            SELECT id, kind, actor as "actor: SbUserId", source as "source: MapLinkSource",
                map_id as "map_id: SbMapId", other_map_id as "other_map_id: SbMapId", family_id,
                details as "details: Json<HistoryDetails>", created_at
            FROM map_family_history
            WHERE (NOT $1 OR map_id = ANY($2) OR other_map_id = ANY($2) OR family_id = ANY($3))
                AND ($4::integer IS NULL OR actor = $4)
            ORDER BY created_at DESC, id
            LIMIT $5 OFFSET $6
        "#,
        about_filter,
        &map_ids.unwrap_or_default(),
        family_ids.unwrap_or_default(),
        actor as _,
        limit,
        offset,
    )
    .fetch_all(db)
    .await
    .wrap_err("Failed to load family history")
}

#[cfg(test)]
mod tests {
    use super::*;

    fn state(family: u8, parent: Option<u8>) -> MapFamilyMemberState {
        MapFamilyMemberState {
            family_id: Uuid::from_bytes([family; 16]),
            parent_id: parent.map(|p| SbMapId(Uuid::from_bytes([p; 16]))),
            relation: MapFamilyRelation::Version,
            version_label: None,
            pinned_current: false,
            source: MapLinkSource::Reviewer,
        }
    }

    #[test]
    fn diff_holds_only_changed_members() {
        let id = |n: u8| Uuid::from_bytes([n; 16]);
        let before = Snapshot::from([(id(1), state(9, None)), (id(2), state(9, Some(1)))]);
        let after = Snapshot::from([
            (id(1), state(9, None)),
            (id(2), state(9, Some(3))),
            (id(3), state(9, Some(1))),
        ]);
        let changes = diff(&before, &after);
        assert_eq!(changes.len(), 2);
        assert_eq!(changes[0].map_id.0, id(2));
        assert_eq!(changes[1].map_id.0, id(3));
        assert!(changes[1].before.is_none());
    }

    #[test]
    fn details_round_trip() {
        let details = HistoryDetails {
            members: vec![MapFamilyMemberChange {
                map_id: SbMapId(Uuid::nil()),
                before: None,
                after: Some(state(1, None)),
            }],
            report_status: Some(Change {
                before: MapFamilyReportStatus::Open,
                after: MapFamilyReportStatus::Dismissed,
            }),
            ..Default::default()
        };
        let json = serde_json::to_value(&details).unwrap();
        assert_eq!(json["reportStatus"]["after"], "dismissed");
        assert!(json.get("suggestions").is_none());
        let back: HistoryDetails = serde_json::from_value(json).unwrap();
        assert_eq!(back.members[0].after, Some(state(1, None)));
    }
}
