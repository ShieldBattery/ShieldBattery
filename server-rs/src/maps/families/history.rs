//! The record of every change made to families, family reports, file listings and map owners, one
//! entry per action.

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
use crate::maps::families::owners::{MapOwnerKind, RetiredOwner};
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
    /// Staff or the family's owner picked its default file.
    SetDefault,
    /// Staff or the family's owner cleared the pick of its default file.
    ClearDefault,
    /// A family report was resolved, dismissed or reopened.
    ReportStatus,
    /// A file was listed.
    Publish,
    /// A file's publisher took it out of the listings.
    Unpublish,
    /// Staff took a file out of the listings.
    Delist,
    /// Staff listed a delisted file again.
    Relist,
    /// A file's publisher moved it into a suggested map or one they own, while publishing it or
    /// later.
    Link,
    /// A file's publisher, or its map's owner, moved it out of the map into a new map of its own.
    Unlink,
    /// A map's owner was set: by a claim, or by staff.
    SetOwner,
    /// A map's owner was removed, or gave the map up.
    RemoveOwner,
    /// Staff set or cleared the maker's name a map is credited to.
    SetCredit,
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
            Self::Publish => "publish",
            Self::Unpublish => "unpublish",
            Self::Delist => "delist",
            Self::Relist => "relist",
            Self::Link => "link",
            Self::Unlink => "unlink",
            Self::SetOwner => "set_owner",
            Self::RemoveOwner => "remove_owner",
            Self::SetCredit => "set_credit",
        }
    }

    fn from_db(kind: &str) -> Self {
        match kind {
            "merge" => Self::Merge,
            "split" => Self::Split,
            "set_default" => Self::SetDefault,
            "clear_default" => Self::ClearDefault,
            "report_status" => Self::ReportStatus,
            "publish" => Self::Publish,
            "unpublish" => Self::Unpublish,
            "delist" => Self::Delist,
            "relist" => Self::Relist,
            "link" => Self::Link,
            "unlink" => Self::Unlink,
            "set_owner" => Self::SetOwner,
            "remove_owner" => Self::RemoveOwner,
            "set_credit" => Self::SetCredit,
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
    /// The note staff left when delisting a file.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub note: Option<String>,
    /// The family's owner before and after the change.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub owner: Option<Change<Option<SbUserId>>>,
    /// How the owner after the change became the owner.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub owner_kind: Option<MapOwnerKind>,
    /// The maker's name the family was credited to before and after the change.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub credit: Option<Change<Option<String>>>,
    /// The claim that made the owner the owner.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub claim_id: Option<Uuid>,
    /// The owner and credit of the family the change merged away, lost with it.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub retired_owner: Option<RetiredOwner>,
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

/// A change made to families, family reports or file listings.
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

    /// The file that moved, was split out, was made the default or was listed or delisted, or the
    /// file of a `WRONG_MAP` or `PUBLISH_REVIEW` report.
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

    /// The note staff left when delisting the file. Only for `DELIST`.
    async fn note(&self) -> Option<&str> {
        self.details.0.note.as_deref()
    }

    /// The map's owner before the change. Only for `SET_OWNER` and `REMOVE_OWNER`.
    async fn owner_before(&self, ctx: &Context<'_>) -> Result<Option<SbUser>> {
        let before = self.details.0.owner.as_ref().and_then(|c| c.before);
        load_user(ctx, before).await
    }

    /// The map's owner after the change. Only for `SET_OWNER`.
    async fn owner_after(&self, ctx: &Context<'_>) -> Result<Option<SbUser>> {
        let after = self.details.0.owner.as_ref().and_then(|c| c.after);
        load_user(ctx, after).await
    }

    /// How the owner after the change became the owner. Only for `SET_OWNER`.
    async fn owner_kind_after(&self) -> Option<MapOwnerKind> {
        self.details.0.owner_kind
    }

    /// The claim that made the owner the owner, when a claim did. Only for `SET_OWNER`.
    async fn claim_id(&self) -> Option<Uuid> {
        self.details.0.claim_id
    }

    /// The maker's name the map was credited to before the change. Only for `SET_CREDIT`.
    async fn credit_before(&self) -> Option<&str> {
        self.details
            .0
            .credit
            .as_ref()
            .and_then(|c| c.before.as_deref())
    }

    /// The maker's name the map is credited to after the change. Only for `SET_CREDIT`.
    async fn credit_after(&self) -> Option<&str> {
        self.details
            .0
            .credit
            .as_ref()
            .and_then(|c| c.after.as_deref())
    }

    /// The owner of the map that a `MERGE`, `MOVE_FILE` or `LINK` merged away (`otherFamilyId`),
    /// who lost it with the map.
    async fn retired_owner(&self, ctx: &Context<'_>) -> Result<Option<SbUser>> {
        let owner = self
            .details
            .0
            .retired_owner
            .as_ref()
            .and_then(|r| r.owner_id);
        load_user(ctx, owner).await
    }

    /// The maker's name the map that a `MERGE`, `MOVE_FILE` or `LINK` merged away
    /// (`otherFamilyId`) was credited to, lost with it.
    async fn retired_credit(&self) -> Option<&str> {
        self.details
            .0
            .retired_owner
            .as_ref()
            .and_then(|r| r.credit.as_deref())
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

    #[test]
    fn owner_details_round_trip_and_older_entries_still_parse() {
        let details = HistoryDetails {
            owner: Some(Change {
                before: None,
                after: Some(SbUserId(7)),
            }),
            owner_kind: Some(MapOwnerKind::Staff),
            credit: Some(Change {
                before: Some("Maker".into()),
                after: None,
            }),
            claim_id: Some(Uuid::nil()),
            retired_owner: Some(RetiredOwner {
                family_id: Uuid::nil(),
                owner_id: Some(SbUserId(8)),
                owner_kind: Some(MapOwnerKind::Claim),
                credit: None,
            }),
            ..Default::default()
        };
        let json = serde_json::to_value(&details).unwrap();
        assert_eq!(
            json["owner"],
            serde_json::json!({ "before": null, "after": 7 })
        );
        assert_eq!(json["ownerKind"], "staff");
        assert_eq!(json["credit"]["before"], "Maker");
        assert_eq!(json["retiredOwner"]["ownerKind"], "claim");
        assert!(json["retiredOwner"].get("credit").is_none());
        let back: HistoryDetails = serde_json::from_value(json).unwrap();
        assert_eq!(back.owner, details.owner);
        assert_eq!(back.retired_owner, details.retired_owner);

        let older: HistoryDetails =
            serde_json::from_value(serde_json::json!({ "note": "spam" })).unwrap();
        assert_eq!(older.owner, None);
        assert_eq!(older.retired_owner, None);
        assert!(serde_json::to_value(&older).unwrap().get("owner").is_none());
    }
}
