//! The record of every change staff make to families and family reports, one entry per action.

use async_graphql::{Context, Enum, Object, Result};
use chrono::{DateTime, Utc};
use color_eyre::eyre::{self, WrapErr};
use serde::{Deserialize, Serialize};
use sqlx::types::Json;
use sqlx::{PgPool, Postgres, Transaction};
use uuid::Uuid;

use crate::maps::SbMapId;
use crate::maps::catalog::{SbMap, load_sb_map, load_user};
use crate::maps::families::edit::MapFamilyReportStatus;
use crate::users::{SbUser, SbUserId};

/// What kind of change a history entry records.
#[derive(Enum, Copy, Clone, Debug, Eq, PartialEq)]
pub enum MapFamilyHistoryKind {
    /// A file was moved to another family.
    MoveFile,
    /// A family was merged into another one.
    Merge,
    /// A file was split out into a family of its own.
    Split,
    /// Staff picked a family's default file.
    SetDefault,
    /// Staff cleared their pick of a family's default file.
    ClearDefault,
    /// A family report was resolved, dismissed or reopened.
    ReportStatus,
}

impl MapFamilyHistoryKind {
    fn as_str(self) -> &'static str {
        match self {
            Self::MoveFile => "move_file",
            Self::Merge => "merge",
            Self::Split => "split",
            Self::SetDefault => "set_default",
            Self::ClearDefault => "clear_default",
            Self::ReportStatus => "report_status",
        }
    }

    fn from_db(kind: &str) -> Self {
        match kind {
            "merge" => Self::Merge,
            "split" => Self::Split,
            "set_default" => Self::SetDefault,
            "clear_default" => Self::ClearDefault,
            "report_status" => Self::ReportStatus,
            _ => Self::MoveFile,
        }
    }
}

/// The family a file was in before and after a change.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct FileChange {
    pub map_id: SbMapId,
    pub before: Uuid,
    pub after: Uuid,
}

/// A family's default pick before and after a change.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct DefaultChange {
    pub family_id: Uuid,
    pub before: Option<SbMapId>,
    pub after: Option<SbMapId>,
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
    pub files: Vec<FileChange>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub defaults: Vec<DefaultChange>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub report_id: Option<Uuid>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub report_status: Option<Change<MapFamilyReportStatus>>,
}

/// One change to record.
pub struct HistoryEntry {
    pub kind: MapFamilyHistoryKind,
    pub actor: SbUserId,
    pub family_id: Uuid,
    pub other_family_id: Option<Uuid>,
    pub map_id: Option<SbMapId>,
    pub details: HistoryDetails,
}

/// Records a change, returning the entry's id.
pub async fn record(tx: &mut Transaction<'_, Postgres>, entry: HistoryEntry) -> eyre::Result<Uuid> {
    sqlx::query_scalar!(
        r#"
            INSERT INTO map_family_history (kind, actor, family_id, other_family_id, map_id,
                details)
            VALUES ($1, $2, $3, $4, $5, $6)
            RETURNING id
        "#,
        entry.kind.as_str(),
        entry.actor as _,
        entry.family_id,
        entry.other_family_id,
        entry.map_id as _,
        Json(&entry.details) as _,
    )
    .fetch_one(&mut **tx)
    .await
    .wrap_err("Failed to record family history")
}

pub struct FileChangeView<'a> {
    entry_id: Uuid,
    change: &'a FileChange,
}

/// The family a file was in before and after a change.
#[Object(name = "MapFamilyFileChange")]
impl FileChangeView<'_> {
    async fn id(&self) -> String {
        format!(
            "map-family-history:{}:file:{}",
            self.entry_id, self.change.map_id
        )
    }

    async fn map_id(&self) -> SbMapId {
        self.change.map_id
    }

    async fn map(&self, ctx: &Context<'_>) -> Result<SbMap> {
        load_sb_map(ctx, self.change.map_id).await
    }

    /// The family's id when the change was made. It may since have been merged into another one.
    async fn before(&self) -> Uuid {
        self.change.before
    }

    /// The family's id when the change was made. It may since have been merged into another one.
    async fn after(&self) -> Uuid {
        self.change.after
    }
}

pub struct DefaultChangeView<'a> {
    entry_id: Uuid,
    change: &'a DefaultChange,
}

/// A family's default pick before and after a change.
#[Object(name = "MapFamilyDefaultChange")]
impl DefaultChangeView<'_> {
    async fn id(&self) -> String {
        format!(
            "map-family-history:{}:default:{}",
            self.entry_id, self.change.family_id
        )
    }

    /// The family's id when the change was made. It may since have been merged into another one.
    async fn family_id(&self) -> Uuid {
        self.change.family_id
    }

    /// Null when the default was derived.
    async fn before(&self, ctx: &Context<'_>) -> Result<Option<SbMap>> {
        match self.change.before {
            Some(id) => load_sb_map(ctx, id).await.map(Some),
            None => Ok(None),
        }
    }

    /// Null when the default is derived.
    async fn after(&self, ctx: &Context<'_>) -> Result<Option<SbMap>> {
        match self.change.after {
            Some(id) => load_sb_map(ctx, id).await.map(Some),
            None => Ok(None),
        }
    }
}

pub struct MapFamilyHistory {
    id: Uuid,
    kind: String,
    actor: SbUserId,
    family_id: Uuid,
    other_family_id: Option<Uuid>,
    map_id: Option<SbMapId>,
    details: Json<HistoryDetails>,
    created_at: DateTime<Utc>,
}

/// A change staff made to families or family reports.
#[Object]
impl MapFamilyHistory {
    async fn id(&self) -> String {
        format!("map-family-history:{}", self.id)
    }

    async fn kind(&self) -> MapFamilyHistoryKind {
        MapFamilyHistoryKind::from_db(&self.kind)
    }

    async fn actor(&self, ctx: &Context<'_>) -> Result<Option<SbUser>> {
        load_user(ctx, Some(self.actor)).await
    }

    /// The family acted on, as its id was when the change was made: where a file moved or a family
    /// was merged to, the new family of a split, the family whose default changed, or the family a
    /// report is about.
    async fn family_id(&self) -> Uuid {
        self.family_id
    }

    /// The family a file left, the family merged away, or the other family of a `SAME_MAP`
    /// report, as its id was when the change was made.
    async fn other_family_id(&self) -> Option<Uuid> {
        self.other_family_id
    }

    /// The file that moved, was split out or was made the default, or the file of a `WRONG_MAP`
    /// report.
    async fn map(&self, ctx: &Context<'_>) -> Result<Option<SbMap>> {
        match self.map_id {
            Some(id) => load_sb_map(ctx, id).await.map(Some),
            None => Ok(None),
        }
    }

    /// Every file that changed families, including every file of a merged family.
    async fn file_changes(&self) -> Vec<FileChangeView<'_>> {
        self.details
            .0
            .files
            .iter()
            .map(|change| FileChangeView {
                entry_id: self.id,
                change,
            })
            .collect()
    }

    /// Every default pick that changed, including the pick of a merged family and a pick cleared
    /// because its file left the family.
    async fn default_changes(&self) -> Vec<DefaultChangeView<'_>> {
        self.details
            .0
            .defaults
            .iter()
            .map(|change| DefaultChangeView {
                entry_id: self.id,
                change,
            })
            .collect()
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

    async fn created_at(&self) -> DateTime<Utc> {
        self.created_at
    }
}

/// Loads history entries, newest first. Entries match when they're about one of `family_ids` (as
/// either family, including ids that are now aliases of them) or `map_ids`, and were made by
/// `actor`; filters left out match everything.
pub async fn load_history(
    db: &PgPool,
    family_ids: Option<&[Uuid]>,
    map_ids: Option<&[SbMapId]>,
    actor: Option<SbUserId>,
    limit: i64,
    offset: i64,
) -> eyre::Result<Vec<MapFamilyHistory>> {
    let map_ids: Option<Vec<Uuid>> = map_ids.map(|ids| ids.iter().map(|id| id.0).collect());
    let about_filter = map_ids.is_some() || family_ids.is_some();
    sqlx::query_as!(
        MapFamilyHistory,
        r#"
            WITH families AS (
                SELECT unnest($3::uuid[]) AS id
                UNION
                SELECT old_id FROM map_family_aliases WHERE family_id = ANY($3)
            )
            SELECT id, kind, actor as "actor: SbUserId", family_id, other_family_id,
                map_id as "map_id: SbMapId", details as "details: Json<HistoryDetails>",
                created_at
            FROM map_family_history
            WHERE (NOT $1
                    OR map_id = ANY($2)
                    OR family_id IN (SELECT id FROM families)
                    OR other_family_id IN (SELECT id FROM families))
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

    #[test]
    fn details_round_trip() {
        let family = Uuid::from_bytes([1; 16]);
        let other = Uuid::from_bytes([2; 16]);
        let details = HistoryDetails {
            files: vec![FileChange {
                map_id: SbMapId(Uuid::nil()),
                before: other,
                after: family,
            }],
            defaults: vec![DefaultChange {
                family_id: other,
                before: Some(SbMapId(Uuid::nil())),
                after: None,
            }],
            report_status: Some(Change {
                before: MapFamilyReportStatus::Open,
                after: MapFamilyReportStatus::Dismissed,
            }),
            ..Default::default()
        };
        let json = serde_json::to_value(&details).unwrap();
        assert_eq!(json["reportStatus"]["after"], "dismissed");
        assert_eq!(json["files"][0]["after"], family.to_string());
        assert_eq!(json["defaults"][0]["after"], serde_json::Value::Null);
        assert!(json.get("reportId").is_none());
        let back: HistoryDetails = serde_json::from_value(json).unwrap();
        assert_eq!(back.files, details.files);
        assert_eq!(back.defaults, details.defaults);
    }
}
