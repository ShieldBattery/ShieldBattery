//! Listing map files. Any player can publish a file they hold (list it in the catalog) and take it
//! out again; staff can delist any file, which keeps players from listing it again, and relist it.
//! A file's publisher can also link it to a map the server suggests it's a version of (or to a map
//! they own), or unlink it into a map of its own; a map's owner can unlink any file from it.
//!
//! Like the edits in [`edit`], every change takes the families lock before touching anything,
//! recomputes the current file of the families it touched before its transaction commits, and
//! records one history entry per step.

use std::collections::HashSet;

use color_eyre::eyre::{self, WrapErr};
use sqlx::{PgConnection, PgPool, Postgres, Transaction};
use uuid::Uuid;

use crate::maps::SbMapId;
use crate::maps::families::edit::{
    self, FamilyEditError, FileMove, MAX_REPORT_NOTE_LENGTH, MapFamilyReportKind,
    MapFamilyReportStatus, MapPublishReviewAnswer, MoveBy, ReportRequest,
};
use crate::maps::families::history::{self, HistoryDetails, HistoryEntry, MapFamilyHistoryKind};
use crate::maps::families::owners;
use crate::maps::families::{lock_families, refresh_families, resolve_family_id};
use crate::maps::parse::filter_color_codes;
use crate::maps::similarity::{PublishSuggestion, publish_suggestions};
use crate::users::SbUserId;
use crate::users::names::{NameChecker, RestrictedNameReason};

/// The most files a user can publish in a rolling 24 hours, counting the ones held for review.
pub const MAX_PUBLISHES_PER_DAY: i64 = 10;
/// The longest note staff can leave when delisting a file, in characters.
pub const MAX_DELIST_NOTE_LENGTH: usize = MAX_REPORT_NOTE_LENGTH;
/// The most strings of a file's name and description checked against the restricted names list.
/// Map descriptions can be long, and the words past this are rarely what a file is known by.
const MAX_NAME_CHECK_TERMS: usize = 200;

/// Why a user can't publish a file.
#[derive(async_graphql::Enum, Copy, Clone, Debug, Eq, PartialEq)]
#[graphql(name = "MapPublishBlockedReason")]
pub enum PublishBlock {
    /// The file is already listed.
    AlreadyListed,
    /// The user is restricted from publishing maps.
    Restricted,
    /// The user hasn't verified their email address.
    EmailUnverified,
    /// The user published too many files recently.
    RateLimited,
    /// The file isn't in the user's library.
    NotInLibrary,
    /// The file's name is empty once color codes are stripped.
    EmptyName,
    /// Staff took the file out of the listings, so only staff can list it again.
    StaffDelisted,
}

impl PublishBlock {
    pub fn code(self) -> &'static str {
        match self {
            Self::AlreadyListed => "ALREADY_LISTED",
            Self::Restricted => "RESTRICTED",
            Self::EmailUnverified => "EMAIL_UNVERIFIED",
            Self::RateLimited => "RATE_LIMITED",
            Self::NotInLibrary => "NOT_IN_LIBRARY",
            Self::EmptyName => "EMPTY_NAME",
            Self::StaffDelisted => "STAFF_DELISTED",
        }
    }

    fn message(self) -> &'static str {
        match self {
            Self::AlreadyListed => "the file is already listed",
            Self::Restricted => "you are currently restricted from publishing maps",
            Self::EmailUnverified => "you need to verify your email address to publish maps",
            Self::RateLimited => "you've published too many files recently, please try again later",
            Self::NotInLibrary => "only files in your maps can be published",
            Self::EmptyName => "the file has no name",
            Self::StaffDelisted => "staff took this file out of the listings",
        }
    }
}

#[derive(Debug, thiserror::Error)]
pub enum PublishError {
    #[error("map file not found")]
    MapNotFound,
    #[error("map not found")]
    FamilyNotFound,
    #[error("report not found")]
    ReportNotFound,
    #[error("{}", .0.message())]
    Blocked(PublishBlock),
    #[error("this answer needs the map the file is a version of")]
    MissingFamily,
    #[error("the file is the same as a file of its map, so it's listed with that map")]
    HasExistingMap,
    #[error("that map isn't one of the maps suggested for this file")]
    NotSuggested,
    #[error("the file isn't listed")]
    NotListed,
    #[error("the file isn't delisted")]
    NotDelisted,
    #[error("staff already took this file out of the listings")]
    AlreadyStaffDelisted,
    #[error("official files can only be changed by staff")]
    Official,
    #[error("only the file's publisher can do that")]
    NotPublisher,
    #[error("only the file's publisher or its map's owner can do that")]
    NotPublisherOrOwner,
    #[error(
        "this file's map has an owner or a credit, so the file can't be moved into another map; \
         ask staff"
    )]
    ProtectedMap,
    #[error("the file already shares its map with other files")]
    NotAlone,
    #[error("the file is already the only file of its map")]
    AlreadyAlone,
    #[error("the note must be at most {MAX_DELIST_NOTE_LENGTH} characters")]
    NoteTooLong,
    #[error("only an open publish review can be approved")]
    NotOpenReview,
    #[error(transparent)]
    Edit(FamilyEditError),
    #[error(transparent)]
    Other(#[from] eyre::Report),
}

impl From<sqlx::Error> for PublishError {
    fn from(error: sqlx::Error) -> Self {
        Self::Other(error.into())
    }
}

impl From<FamilyEditError> for PublishError {
    fn from(error: FamilyEditError) -> Self {
        match error {
            FamilyEditError::MapNotFound => Self::MapNotFound,
            FamilyEditError::FamilyNotFound => Self::FamilyNotFound,
            FamilyEditError::ReportNotFound => Self::ReportNotFound,
            FamilyEditError::AlreadyAlone => Self::AlreadyAlone,
            FamilyEditError::Other(e) => Self::Other(e),
            e => Self::Edit(e),
        }
    }
}

/// A file as publishing reads it.
#[derive(Debug, Clone)]
struct PublishFile {
    family_id: Uuid,
    listed: bool,
    official: bool,
    name: String,
    description: String,
    published_by: Option<SbUserId>,
    /// Who delisted the file (`publisher` or `staff`), while it's delisted.
    delisted_kind: Option<String>,
    /// How many files the file's family holds, including the file itself.
    family_size: i64,
    /// Whether any file of the file's family is listed.
    family_listed: bool,
    /// The owner of the file's family, if it has one.
    family_owner_id: Option<SbUserId>,
    /// Whether staff credited the file's family to a maker.
    family_has_credit: bool,
}

impl PublishFile {
    /// Whether `user` moving the file into another map would merge its own map away (it's the
    /// map's only file) while that map has a credit or an owner other than `user`. Only staff may
    /// drop those; an owner may give up their own map this way.
    fn move_erases_protected_map(&self, user: SbUserId) -> bool {
        self.family_size == 1
            && (self.family_has_credit || self.family_owner_id.is_some_and(|owner| owner != user))
    }

    /// Whether a `Join` or `Unsure` answer about `target` is refused because the file shares its
    /// family with other files, so it's listed with that family. A `Join` into another map the
    /// publisher owns (`owns_target`) may still take the file out of a family none of whose files
    /// is listed: that family isn't a map players see, and its other files stay in it.
    fn has_existing_map(&self, target: Uuid, owns_target: bool) -> bool {
        self.family_size > 1 && !(owns_target && target != self.family_id && !self.family_listed)
    }
}

async fn load_file(conn: &mut PgConnection, file_id: SbMapId) -> Result<PublishFile, PublishError> {
    sqlx::query_as!(
        PublishFile,
        r#"
            SELECT m.family_id, m.listed as "listed!", m.official, m.name as "name!",
                COALESCE(m.public_description, m.description) as "description!",
                m.published_by as "published_by: SbUserId", m.delisted_kind,
                (SELECT count(*) FROM maps o WHERE o.family_id = m.family_id) as "family_size!",
                EXISTS (
                    SELECT 1 FROM maps o WHERE o.family_id = m.family_id AND o.listed
                ) as "family_listed!",
                f.owner_id as "family_owner_id: SbUserId",
                f.credit IS NOT NULL as "family_has_credit!"
            FROM maps m
            INNER JOIN map_families f ON f.id = m.family_id
            WHERE m.id = $1
        "#,
        file_id as _,
    )
    .fetch_optional(&mut *conn)
    .await
    .wrap_err("Failed to load map file")?
    .ok_or(PublishError::MapNotFound)
}

/// What decides whether a user who isn't staff may publish a file.
#[derive(Debug, Clone, Copy)]
struct PublisherState {
    email_verified: bool,
    restricted: bool,
    in_library: bool,
    /// Files the user published in the last 24 hours, plus their open publish reviews from then.
    recent_publishes: i64,
}

async fn load_publisher(
    conn: &mut PgConnection,
    user: SbUserId,
    file_id: SbMapId,
) -> eyre::Result<PublisherState> {
    sqlx::query_as!(
        PublisherState,
        r#"
            SELECT
                COALESCE((SELECT email_verified FROM users WHERE id = $1), false)
                    as "email_verified!",
                EXISTS (
                    SELECT 1 FROM user_restrictions
                    WHERE user_id = $1 AND kind = 'map_publishing'::restriction_kind
                        AND start_time <= now() AND end_time > now()
                ) as "restricted!",
                EXISTS (
                    SELECT 1 FROM map_library WHERE user_id = $1 AND map_id = $2
                ) as "in_library!",
                (
                    SELECT count(*) FROM maps
                    WHERE published_by = $1 AND published_at > now() - interval '24 hours'
                ) + (
                    SELECT count(*) FROM map_family_reports
                    WHERE reported_by = $1 AND kind = 'publish_review' AND status = 'open'
                        AND reported_at > now() - interval '24 hours'
                ) as "recent_publishes!"
        "#,
        user as _,
        file_id as _,
    )
    .fetch_one(&mut *conn)
    .await
    .wrap_err("Failed to load the publisher")
}

async fn is_publishing_restricted(conn: &mut PgConnection, user: SbUserId) -> eyre::Result<bool> {
    sqlx::query_scalar!(
        r#"
            SELECT EXISTS (
                SELECT 1 FROM user_restrictions
                WHERE user_id = $1 AND kind = 'map_publishing'::restriction_kind
                    AND start_time <= now() AND end_time > now()
            ) as "restricted!"
        "#,
        user as _,
    )
    .fetch_one(&mut *conn)
    .await
    .wrap_err("Failed to check the publishing restriction")
}

/// Why a file can't be published, if it can't. `publisher` is `None` for staff, who can publish any
/// file that isn't listed yet.
fn block_reason(file: &PublishFile, publisher: Option<&PublisherState>) -> Option<PublishBlock> {
    if file.listed {
        return Some(PublishBlock::AlreadyListed);
    }
    let publisher = publisher?;
    if publisher.restricted {
        Some(PublishBlock::Restricted)
    } else if !publisher.email_verified {
        Some(PublishBlock::EmailUnverified)
    } else if !publisher.in_library {
        Some(PublishBlock::NotInLibrary)
    } else if file.delisted_kind.as_deref() == Some("staff") {
        Some(PublishBlock::StaffDelisted)
    } else if filter_color_codes(&file.name).trim().is_empty() {
        Some(PublishBlock::EmptyName)
    } else if publisher.recent_publishes >= MAX_PUBLISHES_PER_DAY {
        Some(PublishBlock::RateLimited)
    } else {
        None
    }
}

/// The strings of a file's name and description checked against the restricted names list: the
/// whole name, then every word of the name and the description, each also without the punctuation
/// around it. Duplicates are left out, and at most [`MAX_NAME_CHECK_TERMS`] are returned.
fn name_check_terms(name: &str, description: &str) -> Vec<String> {
    let name = filter_color_codes(name);
    let description = filter_color_codes(description);
    let mut seen = HashSet::new();
    let mut terms = Vec::new();
    let whole = name.trim();
    let words = name
        .split_whitespace()
        .chain(description.split_whitespace());
    for word in std::iter::once(whole)
        .chain(words.flat_map(|word| [word, word.trim_matches(|c: char| !c.is_alphanumeric())]))
    {
        if terms.len() >= MAX_NAME_CHECK_TERMS {
            break;
        }
        if !word.is_empty() && seen.insert(word) {
            terms.push(word.to_string());
        }
    }
    terms
}

/// Whether a file's name or description hits a profanity restriction. Reserved names (kept from
/// impersonation) don't count: a map may well mention one.
async fn hits_restricted_names(names: &NameChecker, file: &PublishFile) -> eyre::Result<bool> {
    text_hits_restricted_names(names, &file.name, &file.description).await
}

/// Whether a name or the description that goes with it hits a profanity restriction, checking the
/// same strings publishing a file checks. Reserved names don't count.
pub(crate) async fn text_hits_restricted_names(
    names: &NameChecker,
    name: &str,
    description: &str,
) -> eyre::Result<bool> {
    let terms = name_check_terms(name, description);
    let terms: Vec<&str> = terms.iter().map(String::as_str).collect();
    Ok(names
        .check_names(&terms, Some(RestrictedNameReason::Profanity))
        .await?
        .is_some())
}

/// What publishing a file would do.
#[derive(Debug, Clone)]
pub struct PublishPreview {
    /// Why the user can't publish the file, if they can't.
    pub blocked: Option<PublishBlock>,
    /// The file's family, when it already holds other files: the file is listed with it, unless
    /// none of its files is listed and the user joins the file to a map they own (see [`publish`]).
    pub existing_family: Option<Uuid>,
    /// The maps the file may be a version of. Empty when `existing_family` is set, and when the
    /// file's own map has a credit or an owner other than the user, which joining another map
    /// would merge away.
    pub suggestions: Vec<PublishSuggestion>,
    /// Whether publishing will hold the file for staff instead of listing it.
    pub needs_review: bool,
}

/// Previews publishing `file_id` as `user`, who is staff if `staff`. Changes nothing.
pub async fn preview(
    db: &PgPool,
    names: &NameChecker,
    file_id: SbMapId,
    user: SbUserId,
    staff: bool,
) -> Result<PublishPreview, PublishError> {
    let mut conn = db.acquire().await.wrap_err("Failed to get a connection")?;
    let file = load_file(&mut conn, file_id).await?;
    if file.listed {
        return Ok(PublishPreview {
            blocked: Some(PublishBlock::AlreadyListed),
            existing_family: None,
            suggestions: Vec::new(),
            needs_review: false,
        });
    }
    let publisher = match staff {
        true => None,
        false => Some(load_publisher(&mut conn, user, file_id).await?),
    };
    let existing_family = (file.family_size > 1).then_some(file.family_id);
    let suggestions = if existing_family.is_some() || file.move_erases_protected_map(user) {
        Vec::new()
    } else {
        publish_suggestions(&mut conn, file_id).await?
    };
    drop(conn);
    let needs_review = !staff && hits_restricted_names(names, &file).await?;
    Ok(PublishPreview {
        blocked: block_reason(&file, publisher.as_ref()),
        existing_family,
        suggestions,
        needs_review,
    })
}

/// The publisher's answer to "is this file a version of one of these maps?".
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PublishAnswer {
    /// List the file where it is: in a map of its own, or with the file it's the same as.
    Keep,
    /// The file is a version of this suggested map: list it there.
    Join(Uuid),
    /// The file might be a version of this suggested map: list it in a map of its own, and ask
    /// staff.
    Unsure(Uuid),
}

impl PublishAnswer {
    /// The answer as a publish review keeps it while the file is held, if there's anything to keep.
    fn held(self) -> Option<(MapPublishReviewAnswer, Uuid)> {
        match self {
            Self::Keep => None,
            Self::Join(family_id) => Some((MapPublishReviewAnswer::Join, family_id)),
            Self::Unsure(family_id) => Some((MapPublishReviewAnswer::Unsure, family_id)),
        }
    }
}

/// What publishing a file did.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PublishOutcome {
    /// The family the file is in now.
    pub family_id: Uuid,
    /// Whether the file was held for staff instead of listed.
    pub held_for_review: bool,
    /// The report filed for staff, if publishing filed one.
    pub report_id: Option<Uuid>,
    /// The move into the map the publisher joined the file to, if they did.
    pub moved: Option<FileMove>,
}

/// Publishes `file_id` as `user`, who is staff if `staff`. A file that's already listed is left as
/// it is. Otherwise the file is listed and `answer` applied, unless its name or description hits
/// the restricted names list (checked for everyone but staff): then it's held for staff, who list
/// it or dismiss it. The publish review keeps `answer`, which is applied if staff list the file
/// (see [`approve_review`]). A `Join` answer may name a suggested map or one `user` owns; an
/// `Unsure` answer only a suggested map. Neither is taken for a file that shares its family with
/// other files, except a `Join` into another map `user` owns while none of that family's files is
/// listed: the file then leaves the family, whose other files stay in it. A joined file is moved
/// before it's listed, so it's only ever listed in the map it joins.
pub async fn publish(
    db: &PgPool,
    names: &NameChecker,
    file_id: SbMapId,
    answer: PublishAnswer,
    user: SbUserId,
    staff: bool,
) -> Result<PublishOutcome, PublishError> {
    // Checked before the lock is taken, since it can take a while. An unlisted file's name and
    // description are its file's own, which never change.
    let needs_review = if staff {
        false
    } else {
        let mut conn = db.acquire().await.wrap_err("Failed to get a connection")?;
        let file = load_file(&mut conn, file_id).await?;
        drop(conn);
        !file.listed && hits_restricted_names(names, &file).await?
    };

    let mut tx = db.begin().await.wrap_err("Failed to start transaction")?;
    lock_families(&mut tx).await?;
    let file = load_file(&mut tx, file_id).await?;
    if file.listed {
        return Ok(PublishOutcome {
            family_id: file.family_id,
            held_for_review: false,
            report_id: None,
            moved: None,
        });
    }
    if !staff {
        let publisher = load_publisher(&mut tx, user, file_id).await?;
        if let Some(block) = block_reason(&file, Some(&publisher)) {
            return Err(PublishError::Blocked(block));
        }
    }
    if let PublishAnswer::Join(family_id) | PublishAnswer::Unsure(family_id) = answer {
        let owned = matches!(answer, PublishAnswer::Join(_))
            && owners::owns(&mut tx, family_id, user).await?;
        if file.has_existing_map(family_id, owned) {
            return Err(PublishError::HasExistingMap);
        }
        if matches!(answer, PublishAnswer::Join(_)) && file.move_erases_protected_map(user) {
            return Err(PublishError::ProtectedMap);
        }
        if !owned {
            let suggestions = publish_suggestions(&mut tx, file_id).await?;
            if !suggestions.iter().any(|s| s.family_id == family_id) {
                return Err(PublishError::NotSuggested);
            }
        }
    }

    if needs_review {
        let report_id = edit::insert_report(
            &mut tx,
            &ReportRequest::PublishReview {
                file_id,
                answer: answer.held(),
            },
            None,
            user,
        )
        .await?;
        tx.commit()
            .await
            .wrap_err("Failed to commit publish review")?;
        return Ok(PublishOutcome {
            family_id: file.family_id,
            held_for_review: true,
            report_id: Some(report_id),
            moved: None,
        });
    }

    let outcome = match answer {
        PublishAnswer::Keep => {
            list_file(&mut tx, file_id, file.family_id, user, user).await?;
            PublishOutcome {
                family_id: file.family_id,
                held_for_review: false,
                report_id: None,
                moved: None,
            }
        }
        PublishAnswer::Join(family_id) => {
            let moved =
                edit::move_file(&mut tx, file_id, family_id, user, MoveBy::Publisher).await?;
            list_file(&mut tx, file_id, family_id, user, user).await?;
            PublishOutcome {
                family_id,
                held_for_review: false,
                report_id: None,
                moved: Some(moved),
            }
        }
        PublishAnswer::Unsure(family_id) => {
            list_file(&mut tx, file_id, file.family_id, user, user).await?;
            let report_id = edit::insert_report(
                &mut tx,
                &ReportRequest::SameMap {
                    family_id: file.family_id,
                    other_family_id: family_id,
                    from_publish: true,
                },
                None,
                user,
            )
            .await?;
            PublishOutcome {
                family_id: file.family_id,
                held_for_review: false,
                report_id: Some(report_id),
                moved: None,
            }
        }
    };
    tx.commit().await.wrap_err("Failed to commit publish")?;
    Ok(outcome)
}

/// Lists a file as published by `published_by`, recorded as done by `actor`.
async fn list_file(
    tx: &mut Transaction<'_, Postgres>,
    file_id: SbMapId,
    family_id: Uuid,
    published_by: SbUserId,
    actor: SbUserId,
) -> eyre::Result<()> {
    sqlx::query!(
        r#"
            UPDATE maps
            SET published_by = $2, published_at = now(), delisted_by = NULL, delisted_at = NULL,
                delisted_kind = NULL, delisted_note = NULL
            WHERE id = $1
        "#,
        file_id as _,
        published_by as _,
    )
    .execute(&mut **tx)
    .await
    .wrap_err("Failed to list the file")?;
    refresh_families(tx, &[family_id], true).await?;
    history::record(
        tx,
        HistoryEntry {
            kind: MapFamilyHistoryKind::Publish,
            actor,
            family_id,
            other_family_id: None,
            map_id: Some(file_id),
            details: HistoryDetails::default(),
        },
    )
    .await?;
    Ok(())
}

/// The family a publisher's held answer still applies to when staff list their file: the family
/// they answered about (`target`, through any merges, `None` if it no longer exists), unless the
/// file has since ended up in that family, or shares its own family with other files. A file
/// sharing its family still leaves it for a `Join` into a map the publisher owns (`owns_target`)
/// while none of that family's files is listed (see [`PublishFile::has_existing_map`]). When the
/// answer doesn't apply, the file is left listed where it is.
fn held_answer_target(target: Option<Uuid>, file: &PublishFile, owns_target: bool) -> Option<Uuid> {
    target.filter(|&target| target != file.family_id && !file.has_existing_map(target, owns_target))
}

/// Lists the file of an open publish review, as published by the user it was held for, and
/// resolves the review. If this lists the file and the publisher answered that it is (or might
/// be) a version of another map, the answer is applied as publishing would have, on the
/// publisher's behalf: the file is moved into that map before it's listed, or a `same_map` report
/// is filed about it. The answer is skipped when that map no longer exists, when the file is
/// already in it, or when the file shares its own map with other files, unless the answer is a
/// `Join` into a map the publisher owns and none of those files is listed. A `Join` answer is also
/// skipped when the file's own map has a credit or an owner other than the publisher, which moving
/// the file would merge away.
pub async fn approve_review(
    db: &PgPool,
    report_id: Uuid,
    actor: SbUserId,
) -> Result<ApprovedReview, PublishError> {
    let mut tx = db.begin().await.wrap_err("Failed to start transaction")?;
    lock_families(&mut tx).await?;
    let report = sqlx::query!(
        r#"
            SELECT kind, status, map_id as "map_id: SbMapId",
                reported_by as "reported_by: SbUserId", other_family_id, publish_answer
            FROM map_family_reports
            WHERE id = $1
            FOR UPDATE
        "#,
        report_id,
    )
    .fetch_optional(&mut *tx)
    .await
    .wrap_err("Failed to load the report")?
    .ok_or(PublishError::ReportNotFound)?;
    let (MapFamilyReportKind::PublishReview, MapFamilyReportStatus::Open, Some(file_id)) = (
        MapFamilyReportKind::from_db(&report.kind),
        MapFamilyReportStatus::from_db(&report.status),
        report.map_id,
    ) else {
        return Err(PublishError::NotOpenReview);
    };

    let file = load_file(&mut tx, file_id).await?;
    let listed_now = !file.listed;
    let mut family_id = file.family_id;
    let mut same_map_report_id = None;
    let mut moved = None;
    if listed_now {
        let publisher = report.reported_by;
        let mut unsure_target = None;
        if let (Some(answer), Some(other_family_id)) =
            (report.publish_answer.as_deref(), report.other_family_id)
        {
            let answer = MapPublishReviewAnswer::from_db(answer);
            let target = resolve_family_id(&mut *tx, other_family_id).await?;
            let owns_target = match (answer, target) {
                (MapPublishReviewAnswer::Join, Some(target)) => {
                    owners::owns(&mut tx, target, publisher).await?
                }
                _ => false,
            };
            if let Some(target) = held_answer_target(target, &file, owns_target) {
                match answer {
                    MapPublishReviewAnswer::Join if file.move_erases_protected_map(publisher) => {}
                    MapPublishReviewAnswer::Join => {
                        moved = Some(
                            edit::move_file(&mut tx, file_id, target, publisher, MoveBy::Publisher)
                                .await?,
                        );
                        family_id = target;
                    }
                    MapPublishReviewAnswer::Unsure => unsure_target = Some(target),
                }
            }
        }
        list_file(&mut tx, file_id, family_id, publisher, actor).await?;
        if let Some(target) = unsure_target {
            let id = edit::insert_report(
                &mut tx,
                &ReportRequest::SameMap {
                    family_id: file.family_id,
                    other_family_id: target,
                    from_publish: true,
                },
                None,
                publisher,
            )
            .await?;
            same_map_report_id = Some(id);
        }
    }
    edit::set_report_status(&mut tx, report_id, MapFamilyReportStatus::Resolved, actor).await?;
    tx.commit()
        .await
        .wrap_err("Failed to commit publish review")?;
    Ok(ApprovedReview {
        file_id,
        family_id,
        name: file.name,
        publisher: report.reported_by,
        listed_now,
        same_map_report_id,
        moved,
    })
}

/// What approving a publish review did.
#[derive(Debug, Clone)]
pub struct ApprovedReview {
    pub file_id: SbMapId,
    /// The family the file is in once the review is approved.
    pub family_id: Uuid,
    /// The file's name.
    pub name: String,
    /// The user who published the file, and whom it was listed for.
    pub publisher: SbUserId,
    /// Whether this approval listed the file. False when the file was already listed.
    pub listed_now: bool,
    /// The `same_map` report filed on the publisher's behalf, if approving filed one.
    pub same_map_report_id: Option<Uuid>,
    /// The move into the map the publisher answered their file is a version of, if approving
    /// applied that answer.
    pub moved: Option<FileMove>,
}

/// A file as it was when it was delisted.
#[derive(Debug, Clone)]
pub struct DelistedFile {
    pub family_id: Uuid,
    /// The file's name.
    pub name: String,
    /// Who published the file, if anyone did.
    pub published_by: Option<SbUserId>,
    /// Whether the file was listed just before it was delisted.
    pub was_listed: bool,
    /// The trimmed note stored with a staff delisting, if there was one.
    pub note: Option<String>,
}

/// Delisting a file: by its publisher, or by staff with an optional note. See [`unpublish`] and
/// [`delist`].
enum Delisting<'a> {
    Publisher,
    Staff { note: Option<&'a str> },
}

async fn delist_file(
    db: &PgPool,
    file_id: SbMapId,
    actor: SbUserId,
    delisting: Delisting<'_>,
) -> Result<DelistedFile, PublishError> {
    let mut tx = db.begin().await.wrap_err("Failed to start transaction")?;
    lock_families(&mut tx).await?;
    let file = load_file(&mut tx, file_id).await?;
    let (kind, delisted_kind, note) = match delisting {
        Delisting::Publisher => {
            if !file.listed {
                return Err(PublishError::NotListed);
            }
            if file.official {
                return Err(PublishError::Official);
            }
            if file.published_by != Some(actor) {
                return Err(PublishError::NotPublisher);
            }
            (MapFamilyHistoryKind::Unpublish, "publisher", None)
        }
        Delisting::Staff { note } => {
            if file.delisted_kind.as_deref() == Some("staff") {
                return Err(PublishError::AlreadyStaffDelisted);
            }
            (MapFamilyHistoryKind::Delist, "staff", note)
        }
    };

    sqlx::query!(
        r#"
            UPDATE maps
            SET delisted_by = $2, delisted_at = now(), delisted_kind = $3, delisted_note = $4
            WHERE id = $1
        "#,
        file_id as _,
        actor as _,
        delisted_kind,
        note,
    )
    .execute(&mut *tx)
    .await
    .wrap_err("Failed to delist the file")?;
    // Only changes anything for a file that was listed, but costs little either way.
    refresh_families(&mut tx, &[file.family_id], true).await?;
    history::record(
        &mut tx,
        HistoryEntry {
            kind,
            actor,
            family_id: file.family_id,
            other_family_id: None,
            map_id: Some(file_id),
            details: HistoryDetails {
                note: note.map(str::to_string),
                ..Default::default()
            },
        },
    )
    .await?;
    tx.commit().await.wrap_err("Failed to commit delisting")?;
    Ok(DelistedFile {
        family_id: file.family_id,
        name: file.name,
        published_by: file.published_by,
        was_listed: file.listed,
        note: note.map(str::to_string),
    })
}

/// Takes a listed file out of the listings at its publisher's request. Anyone may publish it again.
/// Official files can only be delisted by staff.
pub async fn unpublish(db: &PgPool, file_id: SbMapId, user: SbUserId) -> Result<(), PublishError> {
    delist_file(db, file_id, user, Delisting::Publisher)
        .await
        .map(|_| ())
}

/// Blocks a file as staff, with an optional note saying why: only staff can list it from then on
/// (see [`relist`]). Works on any file staff haven't blocked already: a listed file is taken out
/// of the listings, a file its publisher unpublished stays unlisted, and a file that was never
/// published stays unpublished. Whether the file is official is kept, so relisting a listed
/// official file restores it.
pub async fn delist(
    db: &PgPool,
    file_id: SbMapId,
    note: Option<&str>,
    actor: SbUserId,
) -> Result<DelistedFile, PublishError> {
    let note = note.map(str::trim).filter(|n| !n.is_empty());
    if note.is_some_and(|n| n.chars().count() > MAX_DELIST_NOTE_LENGTH) {
        return Err(PublishError::NoteTooLong);
    }
    delist_file(db, file_id, actor, Delisting::Staff { note }).await
}

/// Undoes a delisting by staff or by the file's publisher. A file that was published is listed
/// again, as published by whoever published it last; a file that never was is left unpublished,
/// for anyone holding it to publish.
pub async fn relist(db: &PgPool, file_id: SbMapId, actor: SbUserId) -> Result<(), PublishError> {
    let mut tx = db.begin().await.wrap_err("Failed to start transaction")?;
    lock_families(&mut tx).await?;
    let file = load_file(&mut tx, file_id).await?;
    if file.listed || file.delisted_kind.is_none() {
        return Err(PublishError::NotDelisted);
    }
    sqlx::query!(
        r#"
            UPDATE maps
            SET delisted_by = NULL, delisted_at = NULL, delisted_kind = NULL, delisted_note = NULL
            WHERE id = $1
        "#,
        file_id as _,
    )
    .execute(&mut *tx)
    .await
    .wrap_err("Failed to relist the file")?;
    refresh_families(&mut tx, &[file.family_id], true).await?;
    history::record(
        &mut tx,
        HistoryEntry {
            kind: MapFamilyHistoryKind::Relist,
            actor,
            family_id: file.family_id,
            other_family_id: None,
            map_id: Some(file_id),
            details: HistoryDetails::default(),
        },
    )
    .await?;
    tx.commit().await.wrap_err("Failed to commit relisting")?;
    Ok(())
}

/// The maps `file_id` may be a version of, for its publisher (or staff) to link it to. None while
/// linking it would merge away a map of its own that has a credit or an owner other than its
/// publisher.
pub async fn link_suggestions(
    db: &PgPool,
    file_id: SbMapId,
    user: SbUserId,
    staff: bool,
) -> Result<Vec<PublishSuggestion>, PublishError> {
    let mut conn = db.acquire().await.wrap_err("Failed to get a connection")?;
    let file = load_file(&mut conn, file_id).await?;
    if !staff && file.published_by != Some(user) {
        return Err(PublishError::NotPublisher);
    }
    // Only the publisher can link the file, so whether it's protected is up to them
    if file.move_erases_protected_map(file.published_by.unwrap_or(user)) {
        return Ok(Vec::new());
    }
    Ok(publish_suggestions(&mut conn, file_id).await?)
}

/// Checks that `user` may link or unlink `file`: they aren't restricted from publishing, it isn't
/// official, and they published it or (with `owner_may`) own its family.
async fn check_publisher_move(
    tx: &mut Transaction<'_, Postgres>,
    file: &PublishFile,
    user: SbUserId,
    owner_may: bool,
) -> Result<(), PublishError> {
    if is_publishing_restricted(tx, user).await? {
        return Err(PublishError::Blocked(PublishBlock::Restricted));
    }
    if file.official {
        return Err(PublishError::Official);
    }
    if file.published_by == Some(user) {
        return Ok(());
    }
    if !owner_may {
        return Err(PublishError::NotPublisher);
    }
    if file.family_owner_id == Some(user) {
        Ok(())
    } else {
        Err(PublishError::NotPublisherOrOwner)
    }
}

/// Moves a listed file, alone in its family, into one of the maps suggested for it or a map its
/// publisher owns, at its publisher's request. Refused when the file's own map, which the move
/// would merge away, has a credit or an owner other than the publisher.
pub async fn link(
    db: &PgPool,
    file_id: SbMapId,
    family_id: Uuid,
    user: SbUserId,
) -> Result<FileMove, PublishError> {
    let mut tx = db.begin().await.wrap_err("Failed to start transaction")?;
    lock_families(&mut tx).await?;
    let file = load_file(&mut tx, file_id).await?;
    check_publisher_move(&mut tx, &file, user, false).await?;
    if !file.listed {
        return Err(PublishError::NotListed);
    }
    if file.family_size > 1 {
        return Err(PublishError::NotAlone);
    }
    if file.move_erases_protected_map(user) {
        return Err(PublishError::ProtectedMap);
    }
    if !owners::owns(&mut tx, family_id, user).await? {
        let suggestions = publish_suggestions(&mut tx, file_id).await?;
        if !suggestions.iter().any(|s| s.family_id == family_id) {
            return Err(PublishError::NotSuggested);
        }
    }
    let moved = edit::move_file(&mut tx, file_id, family_id, user, MoveBy::Publisher).await?;
    tx.commit().await.wrap_err("Failed to commit link")?;
    Ok(moved)
}

/// Moves a file out of a family holding other files into a new family of its own, at the request
/// of its publisher or its family's owner.
pub async fn unlink(
    db: &PgPool,
    file_id: SbMapId,
    user: SbUserId,
) -> Result<FileMove, PublishError> {
    let mut tx = db.begin().await.wrap_err("Failed to start transaction")?;
    lock_families(&mut tx).await?;
    let file = load_file(&mut tx, file_id).await?;
    check_publisher_move(&mut tx, &file, user, true).await?;
    if file.family_size == 1 {
        return Err(PublishError::AlreadyAlone);
    }
    let moved = edit::split_file(&mut tx, file_id, user, MoveBy::Publisher).await?;
    tx.commit().await.wrap_err("Failed to commit unlink")?;
    Ok(moved)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn file(name: &str) -> PublishFile {
        PublishFile {
            family_id: Uuid::nil(),
            listed: false,
            official: false,
            name: name.to_string(),
            description: String::new(),
            published_by: None,
            delisted_kind: None,
            family_size: 1,
            family_listed: false,
            family_owner_id: None,
            family_has_credit: false,
        }
    }

    const ALLOWED: PublisherState = PublisherState {
        email_verified: true,
        restricted: false,
        in_library: true,
        recent_publishes: MAX_PUBLISHES_PER_DAY - 1,
    };

    #[test]
    fn an_allowed_publisher_is_not_blocked() {
        assert_eq!(block_reason(&file("Map"), Some(&ALLOWED)), None);
    }

    #[test]
    fn each_check_blocks_publishing() {
        let cases = [
            (
                PublisherState {
                    restricted: true,
                    ..ALLOWED
                },
                PublishBlock::Restricted,
            ),
            (
                PublisherState {
                    email_verified: false,
                    ..ALLOWED
                },
                PublishBlock::EmailUnverified,
            ),
            (
                PublisherState {
                    in_library: false,
                    ..ALLOWED
                },
                PublishBlock::NotInLibrary,
            ),
            (
                PublisherState {
                    recent_publishes: MAX_PUBLISHES_PER_DAY,
                    ..ALLOWED
                },
                PublishBlock::RateLimited,
            ),
        ];
        for (publisher, block) in cases {
            assert_eq!(block_reason(&file("Map"), Some(&publisher)), Some(block));
        }
        assert_eq!(
            block_reason(&file("\u{3}\u{4} \r\n"), Some(&ALLOWED)),
            Some(PublishBlock::EmptyName)
        );
        let staff_delisted = PublishFile {
            delisted_kind: Some("staff".into()),
            ..file("Map")
        };
        assert_eq!(
            block_reason(&staff_delisted, Some(&ALLOWED)),
            Some(PublishBlock::StaffDelisted)
        );
        let publisher_delisted = PublishFile {
            delisted_kind: Some("publisher".into()),
            ..file("Map")
        };
        assert_eq!(block_reason(&publisher_delisted, Some(&ALLOWED)), None);
    }

    #[test]
    fn staff_are_only_blocked_by_a_listed_file() {
        let staff_delisted = PublishFile {
            delisted_kind: Some("staff".into()),
            ..file("")
        };
        assert_eq!(block_reason(&staff_delisted, None), None);
        let listed = PublishFile {
            listed: true,
            ..file("Map")
        };
        assert_eq!(
            block_reason(&listed, None),
            Some(PublishBlock::AlreadyListed)
        );
        assert_eq!(
            block_reason(&listed, Some(&ALLOWED)),
            Some(PublishBlock::AlreadyListed)
        );
    }

    #[test]
    fn name_check_terms_cover_the_name_and_every_word() {
        assert_eq!(
            name_check_terms("\u{3}Fighting \u{4}Spirit", "By (someone), v1.3!"),
            vec![
                "Fighting Spirit",
                "Fighting",
                "Spirit",
                "By",
                "(someone),",
                "someone",
                "v1.3!",
                "v1.3",
            ]
        );
        assert_eq!(
            name_check_terms("Map", "Map map ..."),
            vec!["Map", "map", "..."]
        );
        assert!(name_check_terms("", "").is_empty());
    }

    #[tokio::test]
    async fn only_profanity_holds_a_file_for_review() {
        use crate::users::names::RestrictedNameKind::Exact;
        use crate::users::names::RestrictedNameReason::{Profanity, Reserved};
        let names = NameChecker::with_restrictions(&[
            (1, "staffname", Exact, Reserved),
            (2, "badword", Exact, Profanity),
        ]);
        let with = |name: &str, description: &str| PublishFile {
            description: description.to_string(),
            ..file(name)
        };

        let reserved = with("Staffname's map", "by staffname");
        assert!(!hits_restricted_names(&names, &reserved).await.unwrap());
        let profane = with("Fine", "a badword here");
        assert!(hits_restricted_names(&names, &profane).await.unwrap());
        let both = with("staffname", "badword");
        assert!(hits_restricted_names(&names, &both).await.unwrap());
    }

    #[test]
    fn only_a_lone_file_of_a_map_with_someone_elses_owner_or_a_credit_is_protected() {
        let me = SbUserId(1);
        let alone = file("Map");
        assert!(!alone.move_erases_protected_map(me));
        let owned_by_me = PublishFile {
            family_owner_id: Some(me),
            ..file("Map")
        };
        assert!(!owned_by_me.move_erases_protected_map(me));
        let owned_by_other = PublishFile {
            family_owner_id: Some(SbUserId(2)),
            ..file("Map")
        };
        assert!(owned_by_other.move_erases_protected_map(me));
        let credited = PublishFile {
            family_has_credit: true,
            ..owned_by_me.clone()
        };
        assert!(credited.move_erases_protected_map(me));
        let shared = PublishFile {
            family_size: 2,
            ..credited.clone()
        };
        assert!(!shared.move_erases_protected_map(me));
        let shared = PublishFile {
            family_size: 2,
            ..owned_by_other
        };
        assert!(!shared.move_erases_protected_map(me));
    }

    #[test]
    fn held_answers_apply_to_a_lone_file_and_another_existing_map() {
        let own = Uuid::from_u128(1);
        let other = Uuid::from_u128(2);
        let alone = PublishFile {
            family_id: own,
            ..file("Map")
        };
        assert_eq!(held_answer_target(Some(other), &alone, false), Some(other));
        assert_eq!(held_answer_target(Some(other), &alone, true), Some(other));
        assert_eq!(held_answer_target(None, &alone, false), None);
        assert_eq!(held_answer_target(Some(own), &alone, false), None);
        assert_eq!(held_answer_target(Some(own), &alone, true), None);
    }

    #[test]
    fn held_answers_take_a_file_out_of_its_family_only_into_an_owned_map_while_none_is_listed() {
        let own = Uuid::from_u128(1);
        let other = Uuid::from_u128(2);
        let grouped = PublishFile {
            family_id: own,
            family_size: 2,
            ..file("Map")
        };
        assert_eq!(held_answer_target(Some(other), &grouped, true), Some(other));
        assert_eq!(held_answer_target(Some(other), &grouped, false), None);
        assert_eq!(held_answer_target(Some(own), &grouped, true), None);
        assert_eq!(held_answer_target(None, &grouped, true), None);
        let listed_group = PublishFile {
            family_listed: true,
            ..grouped
        };
        assert_eq!(held_answer_target(Some(other), &listed_group, true), None);
        assert_eq!(held_answer_target(Some(other), &listed_group, false), None);
    }

    #[test]
    fn a_shared_family_refuses_answers_except_an_owned_join_while_none_of_its_files_is_listed() {
        let own = Uuid::from_u128(1);
        let other = Uuid::from_u128(2);
        let alone = PublishFile {
            family_id: own,
            family_listed: true,
            ..file("Map")
        };
        assert!(!alone.has_existing_map(other, false));
        assert!(!alone.has_existing_map(other, true));
        let grouped = PublishFile {
            family_size: 3,
            family_listed: false,
            ..alone.clone()
        };
        assert!(grouped.has_existing_map(other, false));
        assert!(!grouped.has_existing_map(other, true));
        assert!(
            grouped.has_existing_map(own, true),
            "a join into its own family"
        );
        let listed_group = PublishFile {
            family_listed: true,
            ..grouped
        };
        assert!(listed_group.has_existing_map(other, true));
        assert!(listed_group.has_existing_map(other, false));
    }

    #[test]
    fn only_join_and_unsure_answers_are_held() {
        let family = Uuid::from_u128(1);
        assert_eq!(PublishAnswer::Keep.held(), None);
        assert_eq!(
            PublishAnswer::Join(family).held(),
            Some((MapPublishReviewAnswer::Join, family))
        );
        assert_eq!(
            PublishAnswer::Unsure(family).held(),
            Some((MapPublishReviewAnswer::Unsure, family))
        );
    }

    #[test]
    fn publish_review_answers_round_trip_through_the_db_value() {
        for answer in [MapPublishReviewAnswer::Join, MapPublishReviewAnswer::Unsure] {
            assert_eq!(MapPublishReviewAnswer::from_db(answer.as_str()), answer);
        }
    }

    #[test]
    fn name_check_terms_are_capped() {
        let description = (0..1000)
            .map(|n| format!("w{n}"))
            .collect::<Vec<_>>()
            .join(" ");
        let terms = name_check_terms("Name", &description);
        assert_eq!(terms.len(), MAX_NAME_CHECK_TERMS);
        assert_eq!(terms[0], "Name");
    }
}
