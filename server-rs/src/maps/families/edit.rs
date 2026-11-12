//! Changing families by hand: moving a file to another family, splitting a file out into a family
//! of its own, merging two families, and picking a family's default file; plus reports from users.
//! Staff make every change, except that a family's owner can pick its default, and a file's
//! publisher (or its family's owner) can move it between families (see
//! [`crate::maps::families::publish`]). Every change takes the families lock before touching
//! anything, recomputes the current file of the families it touched before its transaction commits,
//! and records one history entry.

use color_eyre::eyre::{self, WrapErr};
use sqlx::{Postgres, Transaction};
use uuid::Uuid;

use crate::maps::SbMapId;
use crate::maps::families::history::{
    self, Change, DefaultChange, FileChange, HistoryDetails, HistoryEntry, MapFamilyHistoryKind,
};
use crate::maps::families::owners::{self, FamilyOwner, OwnerPower, RetiredOwnership};
use crate::maps::families::{lock_families, refresh_families, retire_families};
use crate::users::SbUserId;

/// The longest note a family report can carry, in characters.
pub const MAX_REPORT_NOTE_LENGTH: usize = 500;
/// The most family reports (or, separately, collection reports) a user can file in a rolling hour.
/// Only stops outright spam.
pub(crate) const MAX_REPORTS_PER_HOUR: i64 = 10;

#[derive(Debug, thiserror::Error)]
pub enum FamilyEditError {
    #[error("map file not found")]
    MapNotFound,
    #[error("map not found")]
    FamilyNotFound,
    #[error("report not found")]
    ReportNotFound,
    #[error("the file is already in that map")]
    AlreadyInFamily,
    #[error("the file is already the only file of its map")]
    AlreadyAlone,
    #[error("a map can't be merged into itself")]
    SameFamily,
    #[error("a map can't be reported as the same as itself")]
    SelfReport,
    #[error("only a listed file can be the default of a map with listed files")]
    DefaultUnlisted,
    #[error("this report needs the file")]
    MissingMap,
    #[error("this report needs the map")]
    MissingFamily,
    #[error("a report that two maps are the same needs both maps")]
    MissingFamilies,
    #[error("only the map's owner or staff can do that")]
    NotOwner,
    #[error("you are currently restricted from publishing maps")]
    PublishingRestricted,
    #[error("this map has no owner")]
    NoOwner,
    #[error("you can't report yourself as this map's owner")]
    OwnReport,
    #[error("this map's owner picks its default")]
    HasOwner,
    #[error("the file isn't part of that map")]
    FileNotInFamily,
    #[error("only a listed file can be the default")]
    NotListedFile,
    #[error("the file is already the map's default")]
    AlreadyCurrent,
    #[error("the note must be at most {MAX_REPORT_NOTE_LENGTH} characters")]
    NoteTooLong,
    #[error("you are currently restricted from reporting")]
    ReportingRestricted,
    #[error("you've filed too many reports recently, please try again later")]
    TooManyReports,
    #[error(transparent)]
    Other(#[from] eyre::Report),
}

impl From<sqlx::Error> for FamilyEditError {
    fn from(error: sqlx::Error) -> Self {
        Self::Other(error.into())
    }
}

struct FileRow {
    family_id: Uuid,
    listed: bool,
    /// How many files the file's family holds, including the file itself.
    family_size: i64,
}

async fn load_file(
    tx: &mut Transaction<'_, Postgres>,
    file_id: SbMapId,
) -> Result<FileRow, FamilyEditError> {
    sqlx::query_as!(
        FileRow,
        r#"
            SELECT m.family_id, m.listed as "listed!",
                (SELECT count(*) FROM maps o WHERE o.family_id = m.family_id) as "family_size!"
            FROM maps m
            WHERE m.id = $1
        "#,
        file_id as _,
    )
    .fetch_optional(&mut **tx)
    .await
    .wrap_err("Failed to load map file")?
    .ok_or(FamilyEditError::MapNotFound)
}

async fn load_default(
    tx: &mut Transaction<'_, Postgres>,
    family_id: Uuid,
) -> Result<Option<SbMapId>, FamilyEditError> {
    let row = sqlx::query!(
        r#"
            SELECT default_map_id as "default_map_id: SbMapId"
            FROM map_families
            WHERE id = $1
        "#,
        family_id,
    )
    .fetch_optional(&mut **tx)
    .await
    .wrap_err("Failed to load family")?
    .ok_or(FamilyEditError::FamilyNotFound)?;
    Ok(row.default_map_id)
}

/// Clears `family_id`'s default pick if it's `file_id`, which is leaving the family. Returns the
/// change, if there was one.
async fn clear_departing_default(
    tx: &mut Transaction<'_, Postgres>,
    family_id: Uuid,
    file_id: SbMapId,
) -> eyre::Result<Option<DefaultChange>> {
    let cleared = sqlx::query!(
        r#"
            UPDATE map_families
            SET default_map_id = NULL, default_set_by = NULL, default_set_at = NULL,
                updated_at = now()
            WHERE id = $1 AND default_map_id = $2
        "#,
        family_id,
        file_id as _,
    )
    .execute(&mut **tx)
    .await
    .wrap_err("Failed to clear the default of the file's family")?
    .rows_affected();
    Ok((cleared > 0).then_some(DefaultChange {
        family_id,
        before: Some(file_id),
        after: None,
    }))
}

/// Who moves a file between families, which decides how the move is recorded.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum MoveBy {
    /// Staff sorting files into families (`move_file` and `split`).
    Staff,
    /// The file's publisher linking it to a suggested map (or one they own) or unlinking it, or
    /// the owner of its map unlinking it (`link` and `unlink`).
    Publisher,
}

/// The outcome of moving one file between families.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct FileMove {
    /// The history entry recording the move.
    pub history_id: Uuid,
    /// The family the file is in now.
    pub family_id: Uuid,
    /// The family the file left, unless it was deleted for having no files left.
    pub previous_family_id: Option<Uuid>,
    /// The owner of the family the file is in now, if it has one.
    pub target_owner: Option<FamilyOwner>,
    /// The owner of the family the file left, if that family is still there and has one.
    pub source_owner: Option<FamilyOwner>,
    /// The owner of the family the file left, if that family was deleted for having no files left,
    /// so they lost it.
    pub dropped_owner: Option<FamilyOwner>,
}

/// The owners of `target` and (unless it's gone) `source` after a file moved between them.
async fn move_owners(
    tx: &mut Transaction<'_, Postgres>,
    target: Uuid,
    source: Option<Uuid>,
) -> eyre::Result<(Option<FamilyOwner>, Option<FamilyOwner>)> {
    let ids: Vec<Uuid> = std::iter::once(target).chain(source).collect();
    let mut found = owners::family_owners(tx, &ids).await?;
    let source_owner = source.and_then(|source| {
        let index = found.iter().position(|o| o.family_id == source)?;
        Some(found.swap_remove(index))
    });
    Ok((found.pop(), source_owner))
}

/// The one family of `retired`: a file move or a merge retires at most one.
fn single_retired(retired: Vec<RetiredOwnership>) -> Option<RetiredOwnership> {
    debug_assert!(retired.len() <= 1);
    retired.into_iter().next()
}

/// Moves a file to another family. A family left without files is deleted, and its id becomes an
/// alias of the family the file moved to.
pub async fn move_file(
    tx: &mut Transaction<'_, Postgres>,
    file_id: SbMapId,
    family_id: Uuid,
    actor: SbUserId,
    by: MoveBy,
) -> Result<FileMove, FamilyEditError> {
    lock_families(tx).await?;
    let file = load_file(tx, file_id).await?;
    load_default(tx, family_id).await?;
    if file.family_id == family_id {
        return Err(FamilyEditError::AlreadyInFamily);
    }

    sqlx::query!(
        "UPDATE maps SET family_id = $2 WHERE id = $1",
        file_id as _,
        family_id,
    )
    .execute(&mut **tx)
    .await
    .wrap_err("Failed to move the file")?;
    let defaults: Vec<DefaultChange> = clear_departing_default(tx, file.family_id, file_id)
        .await?
        .into_iter()
        .collect();
    let emptied = file.family_size == 1;
    let retired = if emptied {
        single_retired(retire_families(tx, &[file.family_id], &[family_id]).await?)
    } else {
        None
    };
    refresh_families(tx, &[family_id, file.family_id], true).await?;
    let (target_owner, source_owner) =
        move_owners(tx, family_id, (!emptied).then_some(file.family_id)).await?;

    let history_id = history::record(
        tx,
        HistoryEntry {
            kind: match by {
                MoveBy::Staff => MapFamilyHistoryKind::MoveFile,
                MoveBy::Publisher => MapFamilyHistoryKind::Link,
            },
            actor,
            family_id,
            other_family_id: Some(file.family_id),
            map_id: Some(file_id),
            details: HistoryDetails {
                files: vec![FileChange {
                    map_id: file_id,
                    before: file.family_id,
                    after: family_id,
                }],
                defaults,
                retired_owner: retired.as_ref().map(|r| r.record.clone()),
                ..Default::default()
            },
        },
    )
    .await?;
    Ok(FileMove {
        history_id,
        family_id,
        previous_family_id: (!emptied).then_some(file.family_id),
        target_owner,
        source_owner,
        dropped_owner: retired.and_then(|r| r.dropped_owner()),
    })
}

/// Moves a file out of its family into a new family of its own.
pub async fn split_file(
    tx: &mut Transaction<'_, Postgres>,
    file_id: SbMapId,
    actor: SbUserId,
    by: MoveBy,
) -> Result<FileMove, FamilyEditError> {
    lock_families(tx).await?;
    let file = load_file(tx, file_id).await?;
    if file.family_size == 1 {
        return Err(FamilyEditError::AlreadyAlone);
    }

    let family_id = sqlx::query_scalar!(
        r#"
            INSERT INTO map_families (current_map_id, listed)
            VALUES ($1, $2)
            RETURNING id
        "#,
        file_id as _,
        file.listed,
    )
    .fetch_one(&mut **tx)
    .await
    .wrap_err("Failed to create family")?;
    sqlx::query!(
        "UPDATE maps SET family_id = $2 WHERE id = $1",
        file_id as _,
        family_id,
    )
    .execute(&mut **tx)
    .await
    .wrap_err("Failed to move the file")?;
    let defaults: Vec<DefaultChange> = clear_departing_default(tx, file.family_id, file_id)
        .await?
        .into_iter()
        .collect();
    refresh_families(tx, &[family_id, file.family_id], true).await?;
    let (target_owner, source_owner) = move_owners(tx, family_id, Some(file.family_id)).await?;

    let history_id = history::record(
        tx,
        HistoryEntry {
            kind: match by {
                MoveBy::Staff => MapFamilyHistoryKind::Split,
                MoveBy::Publisher => MapFamilyHistoryKind::Unlink,
            },
            actor,
            family_id,
            other_family_id: Some(file.family_id),
            map_id: Some(file_id),
            details: HistoryDetails {
                files: vec![FileChange {
                    map_id: file_id,
                    before: file.family_id,
                    after: family_id,
                }],
                defaults,
                ..Default::default()
            },
        },
    )
    .await?;
    Ok(FileMove {
        history_id,
        family_id,
        previous_family_id: Some(file.family_id),
        target_owner,
        source_owner,
        dropped_owner: None,
    })
}

/// Moves every file of `family_id` into `into_id`, then deletes `family_id`, leaving its id as an
/// alias of `into_id`. Its default pick, owner and credit are dropped; `into_id`'s are kept.
/// Returns the owner who lost `family_id`, if it had one.
pub async fn merge(
    tx: &mut Transaction<'_, Postgres>,
    family_id: Uuid,
    into_id: Uuid,
    actor: SbUserId,
) -> Result<Option<FamilyOwner>, FamilyEditError> {
    if family_id == into_id {
        return Err(FamilyEditError::SameFamily);
    }
    lock_families(tx).await?;
    let dropped_default = load_default(tx, family_id).await?;
    load_default(tx, into_id).await?;

    let moved = sqlx::query_scalar!(
        r#"
            UPDATE maps SET family_id = $2 WHERE family_id = $1
            RETURNING id as "id: SbMapId"
        "#,
        family_id,
        into_id,
    )
    .fetch_all(&mut **tx)
    .await
    .wrap_err("Failed to move the family's files")?;
    let retired = single_retired(retire_families(tx, &[family_id], &[into_id]).await?);
    refresh_families(tx, &[into_id], true).await?;

    let mut files: Vec<FileChange> = moved
        .into_iter()
        .map(|map_id| FileChange {
            map_id,
            before: family_id,
            after: into_id,
        })
        .collect();
    files.sort_by_key(|f| f.map_id.0);
    history::record(
        tx,
        HistoryEntry {
            kind: MapFamilyHistoryKind::Merge,
            actor,
            family_id: into_id,
            other_family_id: Some(family_id),
            map_id: None,
            details: HistoryDetails {
                files,
                defaults: dropped_default
                    .map(|before| DefaultChange {
                        family_id,
                        before: Some(before),
                        after: None,
                    })
                    .into_iter()
                    .collect(),
                retired_owner: retired.as_ref().map(|r| r.record.clone()),
                ..Default::default()
            },
        },
    )
    .await?;
    Ok(retired.and_then(|r| r.dropped_owner()))
}

/// Checks that `actor`, who isn't staff, may change `family_id`'s default as its owner.
async fn check_owner(
    tx: &mut Transaction<'_, Postgres>,
    family_id: Uuid,
    actor: SbUserId,
) -> Result<(), FamilyEditError> {
    match owners::owner_power(tx, family_id, actor).await? {
        OwnerPower::Owner => Ok(()),
        OwnerPower::NotOwner => Err(FamilyEditError::NotOwner),
        OwnerPower::Restricted => Err(FamilyEditError::PublishingRestricted),
    }
}

/// Makes a file its family's default, as staff (`staff`) or as the family's owner. Only a listed
/// file can be the default of a family with any listed file. Returns the file's family.
pub async fn set_default(
    tx: &mut Transaction<'_, Postgres>,
    file_id: SbMapId,
    actor: SbUserId,
    staff: bool,
) -> Result<Uuid, FamilyEditError> {
    lock_families(tx).await?;
    let file = load_file(tx, file_id).await?;
    if !staff {
        check_owner(tx, file.family_id, actor).await?;
    }
    let family_listed = sqlx::query_scalar!(
        r#"SELECT bool_or(listed) as "listed!" FROM maps WHERE family_id = $1"#,
        file.family_id,
    )
    .fetch_one(&mut **tx)
    .await
    .wrap_err("Failed to load whether the family is listed")?;
    if family_listed && !file.listed {
        return Err(FamilyEditError::DefaultUnlisted);
    }
    let before = load_default(tx, file.family_id).await?;
    if before == Some(file_id) {
        return Ok(file.family_id);
    }

    sqlx::query!(
        r#"
            UPDATE map_families
            SET default_map_id = $2, default_set_by = $3, default_set_at = now(),
                updated_at = now()
            WHERE id = $1
        "#,
        file.family_id,
        file_id as _,
        actor as _,
    )
    .execute(&mut **tx)
    .await
    .wrap_err("Failed to set the family's default")?;
    refresh_families(tx, &[file.family_id], true).await?;

    history::record(
        tx,
        HistoryEntry {
            kind: MapFamilyHistoryKind::SetDefault,
            actor,
            family_id: file.family_id,
            other_family_id: None,
            map_id: Some(file_id),
            details: HistoryDetails {
                defaults: vec![DefaultChange {
                    family_id: file.family_id,
                    before,
                    after: Some(file_id),
                }],
                ..Default::default()
            },
        },
    )
    .await?;
    Ok(file.family_id)
}

/// Clears the pick of a family's default, as staff (`staff`) or as the family's owner, so its
/// current file is derived again (right away, without the margin that keeps a derived current file
/// in place).
pub async fn clear_default(
    tx: &mut Transaction<'_, Postgres>,
    family_id: Uuid,
    actor: SbUserId,
    staff: bool,
) -> Result<(), FamilyEditError> {
    lock_families(tx).await?;
    let before = load_default(tx, family_id).await?;
    if !staff {
        check_owner(tx, family_id, actor).await?;
    }
    let Some(before) = before else {
        return Ok(());
    };

    sqlx::query!(
        r#"
            UPDATE map_families
            SET default_map_id = NULL, default_set_by = NULL, default_set_at = NULL,
                updated_at = now()
            WHERE id = $1
        "#,
        family_id,
    )
    .execute(&mut **tx)
    .await
    .wrap_err("Failed to clear the family's default")?;
    refresh_families(tx, &[family_id], false).await?;

    history::record(
        tx,
        HistoryEntry {
            kind: MapFamilyHistoryKind::ClearDefault,
            actor,
            family_id,
            other_family_id: None,
            map_id: Some(before),
            details: HistoryDetails {
                defaults: vec![DefaultChange {
                    family_id,
                    before: Some(before),
                    after: None,
                }],
                ..Default::default()
            },
        },
    )
    .await?;
    Ok(())
}

/// What a user is telling staff about a map.
#[derive(async_graphql::Enum, Copy, Clone, Debug, Eq, PartialEq)]
pub enum MapFamilyReportKind {
    /// A file isn't part of the map it's in.
    WrongMap,
    /// A map is the same as another map.
    SameMap,
    /// A file's name or description hit the restricted names list when it was published, so it
    /// waits for staff to list it or dismiss the report. Only filed by the server.
    PublishReview,
    /// A map's owner didn't make it.
    WrongOwner,
    /// A map with no owner should have another file as its default.
    WrongDefault,
    /// A file's name, description or content is inappropriate.
    Inappropriate,
}

impl MapFamilyReportKind {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::WrongMap => "wrong_map",
            Self::SameMap => "same_map",
            Self::PublishReview => "publish_review",
            Self::WrongOwner => "wrong_owner",
            Self::WrongDefault => "wrong_default",
            Self::Inappropriate => "inappropriate",
        }
    }

    pub fn from_db(kind: &str) -> Self {
        match kind {
            "same_map" => Self::SameMap,
            "publish_review" => Self::PublishReview,
            "wrong_owner" => Self::WrongOwner,
            "wrong_default" => Self::WrongDefault,
            "inappropriate" => Self::Inappropriate,
            _ => Self::WrongMap,
        }
    }
}

/// What a publisher said about the map their file may be a version of, kept on a publish review
/// while the file is held and applied when staff approve it.
#[derive(async_graphql::Enum, Copy, Clone, Debug, Eq, PartialEq)]
pub enum MapPublishReviewAnswer {
    /// The file is a version of that map: approving the review moves the file into it.
    Join,
    /// The file might be a version of that map: approving the review files a `SAME_MAP` report.
    Unsure,
}

impl MapPublishReviewAnswer {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Join => "join",
            Self::Unsure => "unsure",
        }
    }

    pub fn from_db(answer: &str) -> Self {
        match answer {
            "unsure" => Self::Unsure,
            _ => Self::Join,
        }
    }
}

/// A report to store, with every id already resolved to an existing file or family.
#[derive(Debug, Clone)]
pub enum ReportRequest {
    /// `file_id` isn't part of the family it's in.
    WrongMap { file_id: SbMapId },
    /// `family_id` is the same map as `other_family_id`. `from_publish` when it's filed on a
    /// publisher's behalf, because they weren't sure their file is a version of `other_family_id`.
    SameMap {
        family_id: Uuid,
        other_family_id: Uuid,
        from_publish: bool,
    },
    /// `file_id` was held for staff when it was published. `answer` is what the publisher said
    /// about the map (the family id) their file may be a version of, if they said anything, to be
    /// applied when staff approve the review.
    PublishReview {
        file_id: SbMapId,
        answer: Option<(MapPublishReviewAnswer, Uuid)>,
    },
    /// `family_id`'s owner didn't make it.
    WrongOwner { family_id: Uuid },
    /// `file_id` should be the default of its family, which has no owner. `family_id`, when given,
    /// is the family the reporter saw the file in, which it must still be in.
    WrongDefault {
        file_id: SbMapId,
        family_id: Option<Uuid>,
    },
    /// `file_id` is inappropriate. `family_id`, when given, is the family the reporter saw the file
    /// in, which it must still be in.
    Inappropriate {
        file_id: SbMapId,
        family_id: Option<Uuid>,
    },
}

/// A family's owner and current file, as reports check them.
struct ReportedFamily {
    owner_id: Option<SbUserId>,
    current_map_id: SbMapId,
}

async fn load_reported_family(
    tx: &mut Transaction<'_, Postgres>,
    family_id: Uuid,
) -> Result<ReportedFamily, FamilyEditError> {
    sqlx::query_as!(
        ReportedFamily,
        r#"
            SELECT owner_id as "owner_id: SbUserId", current_map_id as "current_map_id: SbMapId"
            FROM map_families
            WHERE id = $1
        "#,
        family_id,
    )
    .fetch_optional(&mut **tx)
    .await
    .wrap_err("Failed to load family")?
    .ok_or(FamilyEditError::FamilyNotFound)
}

/// Loads a reported file, checking that it's in `family_id` when that's given.
async fn load_reported_file(
    tx: &mut Transaction<'_, Postgres>,
    file_id: SbMapId,
    family_id: Option<Uuid>,
) -> Result<FileRow, FamilyEditError> {
    let file = load_file(tx, file_id).await?;
    if family_id.is_some_and(|family_id| family_id != file.family_id) {
        return Err(FamilyEditError::FileNotInFamily);
    }
    Ok(file)
}

/// Checks that `user` may file a family report: they aren't restricted from reporting and haven't
/// filed too many recently.
pub async fn check_reporter(
    tx: &mut Transaction<'_, Postgres>,
    user: SbUserId,
) -> Result<(), FamilyEditError> {
    let row = sqlx::query!(
        r#"
            SELECT
                EXISTS (
                    SELECT 1 FROM user_restrictions
                    WHERE user_id = $1 AND kind = 'reporting'::restriction_kind
                        AND start_time <= now() AND end_time > now()
                ) as "restricted!",
                (
                    SELECT count(*) FROM map_family_reports
                    WHERE reported_by = $1 AND reported_at > now() - interval '1 hour'
                ) as "recent!"
        "#,
        user as _,
    )
    .fetch_one(&mut **tx)
    .await
    .wrap_err("Failed to check the reporter")?;
    if row.restricted {
        Err(FamilyEditError::ReportingRestricted)
    } else if row.recent >= MAX_REPORTS_PER_HOUR {
        Err(FamilyEditError::TooManyReports)
    } else {
        Ok(())
    }
}

/// Stores a family report, or updates the reporter's open report about the same thing. Updating a
/// publish review replaces the publisher's answer with the one in `request`. Returns the report's
/// id.
pub async fn insert_report(
    tx: &mut Transaction<'_, Postgres>,
    request: &ReportRequest,
    note: Option<&str>,
    reported_by: SbUserId,
) -> Result<Uuid, FamilyEditError> {
    let note = note.map(str::trim).filter(|n| !n.is_empty());
    if note.is_some_and(|n| n.chars().count() > MAX_REPORT_NOTE_LENGTH) {
        return Err(FamilyEditError::NoteTooLong);
    }
    let mut from_publish = false;
    let mut publish_answer = None;
    let (kind, family_id, map_id, other_family_id) = match *request {
        ReportRequest::WrongMap { file_id } => {
            let file = load_file(tx, file_id).await?;
            (
                MapFamilyReportKind::WrongMap,
                file.family_id,
                Some(file_id),
                None,
            )
        }
        ReportRequest::PublishReview { file_id, answer } => {
            let file = load_file(tx, file_id).await?;
            let other_family_id = answer.map(|(_, family_id)| family_id);
            if other_family_id == Some(file.family_id) {
                return Err(FamilyEditError::SelfReport);
            }
            publish_answer = answer.map(|(answer, _)| answer.as_str());
            (
                MapFamilyReportKind::PublishReview,
                file.family_id,
                Some(file_id),
                other_family_id,
            )
        }
        ReportRequest::SameMap {
            family_id,
            other_family_id,
            from_publish: publish,
        } => {
            if family_id == other_family_id {
                return Err(FamilyEditError::SelfReport);
            }
            from_publish = publish;
            (
                MapFamilyReportKind::SameMap,
                family_id,
                None,
                Some(other_family_id),
            )
        }
        ReportRequest::WrongOwner { family_id } => {
            let family = load_reported_family(tx, family_id).await?;
            match family.owner_id {
                None => return Err(FamilyEditError::NoOwner),
                Some(owner) if owner == reported_by => return Err(FamilyEditError::OwnReport),
                Some(_) => {}
            }
            (MapFamilyReportKind::WrongOwner, family_id, None, None)
        }
        ReportRequest::WrongDefault { file_id, family_id } => {
            let file = load_reported_file(tx, file_id, family_id).await?;
            let family = load_reported_family(tx, file.family_id).await?;
            if family.owner_id.is_some() {
                return Err(FamilyEditError::HasOwner);
            }
            if !file.listed {
                return Err(FamilyEditError::NotListedFile);
            }
            if family.current_map_id == file_id {
                return Err(FamilyEditError::AlreadyCurrent);
            }
            (
                MapFamilyReportKind::WrongDefault,
                file.family_id,
                Some(file_id),
                None,
            )
        }
        ReportRequest::Inappropriate { file_id, family_id } => {
            let file = load_reported_file(tx, file_id, family_id).await?;
            (
                MapFamilyReportKind::Inappropriate,
                file.family_id,
                Some(file_id),
                None,
            )
        }
    };

    let id = sqlx::query_scalar!(
        r#"
            INSERT INTO map_family_reports (kind, family_id, map_id, other_family_id, note,
                reported_by, from_publish, publish_answer)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
            ON CONFLICT (reported_by, kind, family_id, COALESCE(map_id, other_family_id, family_id))
                WHERE status = 'open'
            DO UPDATE SET note = COALESCE(EXCLUDED.note, map_family_reports.note),
                from_publish = map_family_reports.from_publish OR EXCLUDED.from_publish,
                other_family_id = EXCLUDED.other_family_id,
                publish_answer = EXCLUDED.publish_answer,
                reported_at = now()
            RETURNING id
        "#,
        kind.as_str(),
        family_id,
        map_id as _,
        other_family_id,
        note,
        reported_by as _,
        from_publish,
        publish_answer,
    )
    .fetch_one(&mut **tx)
    .await
    .wrap_err("Failed to store family report")?;
    Ok(id)
}

/// How staff closed a family report.
#[derive(
    async_graphql::Enum, Copy, Clone, Debug, Eq, PartialEq, serde::Serialize, serde::Deserialize,
)]
#[serde(rename_all = "snake_case")]
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
    let report = sqlx::query!(
        r#"
            SELECT family_id, other_family_id, map_id as "map_id: SbMapId", status
            FROM map_family_reports
            WHERE id = $1
            FOR UPDATE
        "#,
        id,
    )
    .fetch_optional(&mut **tx)
    .await
    .wrap_err("Failed to load family report")?
    .ok_or(FamilyEditError::ReportNotFound)?;
    let before = MapFamilyReportStatus::from_db(&report.status);
    if before == status {
        return Ok(());
    }
    let open = status == MapFamilyReportStatus::Open;
    sqlx::query!(
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
    history::record(
        tx,
        HistoryEntry {
            kind: MapFamilyHistoryKind::ReportStatus,
            actor,
            family_id: report.family_id,
            other_family_id: report.other_family_id,
            map_id: report.map_id,
            details: HistoryDetails {
                report_id: Some(id),
                report_status: Some(Change {
                    before,
                    after: status,
                }),
                ..Default::default()
            },
        },
    )
    .await?;
    Ok(())
}
