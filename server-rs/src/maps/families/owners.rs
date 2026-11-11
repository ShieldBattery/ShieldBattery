//! Map owners: a map's original maker, at most one per family. A user who published every listed
//! file of a map nobody owns can claim it at once; any other claim waits for staff, who grant or
//! reject it. Staff can also set or remove an owner directly, and type a maker's name (a credit)
//! for a maker who has no account.
//!
//! An owner who isn't restricted from publishing may pick their map's default file, remove any file
//! from it, and add files they published to it (see [`edit`](super::edit) and
//! [`publish`](super::publish)). Nothing else.
//!
//! Like every other family change, each owner change takes the families lock before touching
//! anything and records one history entry.

use color_eyre::eyre::{self, WrapErr};
use serde::{Deserialize, Serialize};
use sqlx::{PgConnection, PgPool, Postgres, Transaction};
use uuid::Uuid;

use crate::maps::families::history::{
    self, Change, HistoryDetails, HistoryEntry, MapFamilyHistoryKind,
};
use crate::maps::families::{lock_families, resolve_family_id};
use crate::users::SbUserId;

/// The most claims a user can make in a rolling 24 hours, counting the ones granted at once.
pub const MAX_CLAIMS_PER_DAY: i64 = 10;
/// The longest note a claim can carry, in characters.
pub const MAX_CLAIM_NOTE_LENGTH: usize = 500;
/// The longest maker's name staff can credit a map to, in characters.
pub const MAX_CREDIT_LENGTH: usize = 100;

/// How a map's owner became its owner.
#[derive(async_graphql::Enum, Copy, Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum MapOwnerKind {
    /// They claimed the map themselves, having published every listed file of it.
    Claim,
    /// Staff granted their claim or set them as the owner.
    Staff,
}

impl MapOwnerKind {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Claim => "claim",
            Self::Staff => "staff",
        }
    }

    pub fn from_db(kind: &str) -> Self {
        match kind {
            "staff" => Self::Staff,
            _ => Self::Claim,
        }
    }
}

/// Where a claim to own a map stands.
#[derive(async_graphql::Enum, Copy, Clone, Debug, Eq, PartialEq)]
pub enum MapOwnerClaimStatus {
    /// Waiting for staff.
    Open,
    /// The claimant was made the owner, by staff or at once.
    Granted,
    /// Staff turned it down.
    Rejected,
}

impl MapOwnerClaimStatus {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Open => "open",
            Self::Granted => "granted",
            Self::Rejected => "rejected",
        }
    }

    pub fn from_db(status: &str) -> Self {
        match status {
            "granted" => Self::Granted,
            "rejected" => Self::Rejected,
            _ => Self::Open,
        }
    }
}

/// Why a user can't claim a map.
#[derive(async_graphql::Enum, Copy, Clone, Debug, Eq, PartialEq)]
#[graphql(name = "MapOwnerClaimBlockedReason")]
pub enum ClaimBlock {
    /// The user is restricted from publishing maps.
    Restricted,
    /// The user hasn't verified their email address.
    EmailUnverified,
    /// The user already owns the map.
    AlreadyOwner,
    /// The map has no listed file.
    NotListed,
    /// The user made too many claims recently.
    RateLimited,
}

impl ClaimBlock {
    pub fn code(self) -> &'static str {
        match self {
            Self::Restricted => "RESTRICTED",
            Self::EmailUnverified => "EMAIL_UNVERIFIED",
            Self::AlreadyOwner => "ALREADY_OWNER",
            Self::NotListed => "NOT_LISTED",
            Self::RateLimited => "RATE_LIMITED",
        }
    }

    fn message(self) -> &'static str {
        match self {
            Self::Restricted => "you are currently restricted from publishing maps",
            Self::EmailUnverified => "you need to verify your email address to claim maps",
            Self::AlreadyOwner => "you already own this map",
            Self::NotListed => "only a map with a listed file can be claimed",
            Self::RateLimited => "you've claimed too many maps recently, please try again later",
        }
    }
}

#[derive(Debug, thiserror::Error)]
pub enum OwnerError {
    #[error("map not found")]
    FamilyNotFound,
    #[error("user not found")]
    UserNotFound,
    #[error("claim not found")]
    ClaimNotFound,
    #[error("{}", .0.message())]
    Blocked(ClaimBlock),
    #[error("tell staff why this map is yours")]
    NoteRequired,
    #[error("the note must be at most {MAX_CLAIM_NOTE_LENGTH} characters")]
    NoteTooLong,
    #[error("the credit must be at most {MAX_CREDIT_LENGTH} characters")]
    CreditTooLong,
    #[error("only the map's owner can do that")]
    NotOwner,
    #[error("only an open claim can be granted or rejected")]
    NotOpenClaim,
    #[error(transparent)]
    Other(#[from] eyre::Report),
}

impl From<sqlx::Error> for OwnerError {
    fn from(error: sqlx::Error) -> Self {
        Self::Other(error.into())
    }
}

/// A family's owner, with the family's name (its current file's name) when it was read.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct FamilyOwner {
    pub family_id: Uuid,
    pub owner_id: SbUserId,
    pub name: String,
}

/// The owner and credit of a family that was merged into another one, which are lost with it.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct RetiredOwner {
    /// The family's id when it was merged away.
    pub family_id: Uuid,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub owner_id: Option<SbUserId>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub owner_kind: Option<MapOwnerKind>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub credit: Option<String>,
}

/// A family merged away while it had an owner or a credit, as [`retire_families`] reports it.
///
/// [`retire_families`]: super::retire_families
#[derive(Debug, Clone)]
pub struct RetiredOwnership {
    pub record: RetiredOwner,
    /// The family's name when it was merged away.
    pub name: String,
}

impl RetiredOwnership {
    /// The owner who lost the map, if it had one.
    pub fn dropped_owner(&self) -> Option<FamilyOwner> {
        self.record.owner_id.map(|owner_id| FamilyOwner {
            family_id: self.record.family_id,
            owner_id,
            name: self.name.clone(),
        })
    }
}

/// Reads the owners and credits of `family_ids` that have either, before they're merged away.
pub(crate) async fn load_retiring(
    tx: &mut Transaction<'_, Postgres>,
    family_ids: &[Uuid],
) -> eyre::Result<Vec<RetiredOwnership>> {
    let rows = sqlx::query!(
        r#"
            SELECT f.id, f.owner_id as "owner_id: SbUserId", f.owner_kind, f.credit,
                m.name as "name!"
            FROM map_families f
            INNER JOIN maps m ON m.id = f.current_map_id
            WHERE f.id = ANY($1) AND (f.owner_id IS NOT NULL OR f.credit IS NOT NULL)
        "#,
        family_ids,
    )
    .fetch_all(&mut **tx)
    .await
    .wrap_err("Failed to load the owners of retiring families")?;
    Ok(rows
        .into_iter()
        .map(|row| RetiredOwnership {
            record: RetiredOwner {
                family_id: row.id,
                owner_id: row.owner_id,
                owner_kind: row.owner_kind.as_deref().map(MapOwnerKind::from_db),
                credit: row.credit,
            },
            name: row.name,
        })
        .collect())
}

/// Moves the open claims on families being merged away (`from`) to the family at the same index in
/// `into`. A claim is dropped instead when its claimant already owns that family or has an open
/// claim on it (including another one being moved there).
pub(crate) async fn move_open_claims(
    tx: &mut Transaction<'_, Postgres>,
    from: &[Uuid],
    into: &[Uuid],
) -> eyre::Result<()> {
    sqlx::query!(
        r#"
            WITH moving AS (
                SELECT c.id, c.claimant, v.into_id,
                    row_number() OVER (
                        PARTITION BY v.into_id, c.claimant ORDER BY c.created_at, c.id
                    ) AS n
                FROM map_owner_claims c
                INNER JOIN unnest($1::uuid[], $2::uuid[]) AS v(from_id, into_id)
                    ON v.from_id = c.family_id
                WHERE c.status = 'open'
            )
            DELETE FROM map_owner_claims c
            USING moving mv
            WHERE c.id = mv.id AND (
                mv.n > 1
                OR EXISTS (
                    SELECT 1 FROM map_owner_claims o
                    WHERE o.family_id = mv.into_id AND o.claimant = mv.claimant
                        AND o.status = 'open'
                )
                OR EXISTS (
                    SELECT 1 FROM map_families t
                    WHERE t.id = mv.into_id AND t.owner_id = mv.claimant
                )
            )
        "#,
        from,
        into,
    )
    .execute(&mut **tx)
    .await
    .wrap_err("Failed to drop duplicate claims")?;
    sqlx::query!(
        r#"
            UPDATE map_owner_claims c
            SET family_id = v.into_id
            FROM unnest($1::uuid[], $2::uuid[]) AS v(from_id, into_id)
            WHERE c.family_id = v.from_id AND c.status = 'open'
        "#,
        from,
        into,
    )
    .execute(&mut **tx)
    .await
    .wrap_err("Failed to move open claims")?;
    Ok(())
}

/// The owners of those of `family_ids` that have one.
pub(crate) async fn family_owners(
    conn: &mut PgConnection,
    family_ids: &[Uuid],
) -> eyre::Result<Vec<FamilyOwner>> {
    let rows = sqlx::query!(
        r#"
            SELECT f.id, f.owner_id as "owner_id!: SbUserId", m.name as "name!"
            FROM map_families f
            INNER JOIN maps m ON m.id = f.current_map_id
            WHERE f.id = ANY($1) AND f.owner_id IS NOT NULL
        "#,
        family_ids,
    )
    .fetch_all(&mut *conn)
    .await
    .wrap_err("Failed to load family owners")?;
    Ok(rows
        .into_iter()
        .map(|row| FamilyOwner {
            family_id: row.id,
            owner_id: row.owner_id,
            name: row.name,
        })
        .collect())
}

/// What a user who isn't staff may do with a family as its owner.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum OwnerPower {
    /// They own it and may use their owner powers.
    Owner,
    /// They don't own it (or it doesn't exist).
    NotOwner,
    /// They own it, but they're restricted from publishing, which suspends their owner powers.
    Restricted,
}

pub(crate) async fn owner_power(
    conn: &mut PgConnection,
    family_id: Uuid,
    user: SbUserId,
) -> eyre::Result<OwnerPower> {
    let row = sqlx::query!(
        r#"
            SELECT
                EXISTS (
                    SELECT 1 FROM map_families WHERE id = $1 AND owner_id = $2
                ) as "owner!",
                EXISTS (
                    SELECT 1 FROM user_restrictions
                    WHERE user_id = $2 AND kind = 'map_publishing'::restriction_kind
                        AND start_time <= now() AND end_time > now()
                ) as "restricted!"
        "#,
        family_id,
        user as _,
    )
    .fetch_one(&mut *conn)
    .await
    .wrap_err("Failed to check the family's owner")?;
    Ok(match (row.owner, row.restricted) {
        (false, _) => OwnerPower::NotOwner,
        (true, true) => OwnerPower::Restricted,
        (true, false) => OwnerPower::Owner,
    })
}

/// Whether `user` owns `family_id`, whatever their restrictions.
pub(crate) async fn owns(
    conn: &mut PgConnection,
    family_id: Uuid,
    user: SbUserId,
) -> eyre::Result<bool> {
    sqlx::query_scalar!(
        r#"
            SELECT EXISTS (
                SELECT 1 FROM map_families WHERE id = $1 AND owner_id = $2
            ) as "owns!"
        "#,
        family_id,
        user as _,
    )
    .fetch_one(&mut *conn)
    .await
    .wrap_err("Failed to check the family's owner")
}

/// A family's owner and credit as stored.
struct OwnerRow {
    owner_id: Option<SbUserId>,
    owner_kind: Option<String>,
    credit: Option<String>,
    /// The family's name: its current file's name.
    name: String,
}

impl OwnerRow {
    fn kind(&self) -> Option<MapOwnerKind> {
        self.owner_kind.as_deref().map(MapOwnerKind::from_db)
    }
}

async fn load_owner(conn: &mut PgConnection, family_id: Uuid) -> Result<OwnerRow, OwnerError> {
    sqlx::query_as!(
        OwnerRow,
        r#"
            SELECT f.owner_id as "owner_id: SbUserId", f.owner_kind, f.credit,
                m.name as "name!"
            FROM map_families f
            INNER JOIN maps m ON m.id = f.current_map_id
            WHERE f.id = $1
        "#,
        family_id,
    )
    .fetch_optional(&mut *conn)
    .await
    .wrap_err("Failed to load the family's owner")?
    .ok_or(OwnerError::FamilyNotFound)
}

/// Stores `owner` as the family's owner (or none), set by `actor`.
async fn write_owner(
    tx: &mut Transaction<'_, Postgres>,
    family_id: Uuid,
    owner: Option<(SbUserId, MapOwnerKind)>,
    actor: SbUserId,
) -> eyre::Result<()> {
    let set = owner.is_some();
    sqlx::query!(
        r#"
            UPDATE map_families
            SET owner_id = $2, owner_kind = $3,
                owner_set_by = CASE WHEN $4 THEN $5::integer END,
                owner_set_at = CASE WHEN $4 THEN now() END,
                updated_at = now()
            WHERE id = $1
        "#,
        family_id,
        owner.map(|(id, _)| id) as _,
        owner.map(|(_, kind)| kind.as_str()),
        set,
        actor as _,
    )
    .execute(&mut **tx)
    .await
    .wrap_err("Failed to store the family's owner")?;
    Ok(())
}

/// Records a change of a family's owner.
async fn record_owner_change(
    tx: &mut Transaction<'_, Postgres>,
    family_id: Uuid,
    actor: SbUserId,
    before: Option<SbUserId>,
    after: Option<(SbUserId, MapOwnerKind)>,
    claim_id: Option<Uuid>,
) -> eyre::Result<Uuid> {
    history::record(
        tx,
        HistoryEntry {
            kind: if after.is_some() {
                MapFamilyHistoryKind::SetOwner
            } else {
                MapFamilyHistoryKind::RemoveOwner
            },
            actor,
            family_id,
            other_family_id: None,
            map_id: None,
            details: HistoryDetails {
                owner: Some(Change {
                    before,
                    after: after.map(|(id, _)| id),
                }),
                owner_kind: after.map(|(_, kind)| kind),
                claim_id,
                ..Default::default()
            },
        },
    )
    .await
}

/// What decides whether a user may claim a family, and whether the claim is granted at once.
#[derive(Debug, Clone, Copy)]
struct ClaimState {
    owner_id: Option<SbUserId>,
    has_credit: bool,
    /// How many of the family's files are listed.
    listed_files: i64,
    /// How many of the family's listed files someone other than the claimant published.
    others_listed: i64,
    email_verified: bool,
    restricted: bool,
    /// Claims the user made in the last 24 hours, whatever became of them.
    recent_claims: i64,
    /// The user's open claim on the family, if they have one.
    open_claim: Option<Uuid>,
}

async fn load_claim_state(
    conn: &mut PgConnection,
    family_id: Uuid,
    user: SbUserId,
) -> eyre::Result<Option<ClaimState>> {
    sqlx::query_as!(
        ClaimState,
        r#"
            SELECT f.owner_id as "owner_id: SbUserId", f.credit IS NOT NULL as "has_credit!",
                (
                    SELECT count(*) FROM maps m WHERE m.family_id = f.id AND m.listed
                ) as "listed_files!",
                (
                    SELECT count(*) FROM maps m
                    WHERE m.family_id = f.id AND m.listed AND m.published_by IS DISTINCT FROM $2
                ) as "others_listed!",
                COALESCE((SELECT email_verified FROM users WHERE id = $2), false)
                    as "email_verified!",
                EXISTS (
                    SELECT 1 FROM user_restrictions
                    WHERE user_id = $2 AND kind = 'map_publishing'::restriction_kind
                        AND start_time <= now() AND end_time > now()
                ) as "restricted!",
                (
                    SELECT count(*) FROM map_owner_claims
                    WHERE claimant = $2 AND created_at > now() - interval '24 hours'
                ) as "recent_claims!",
                (
                    SELECT c.id FROM map_owner_claims c
                    WHERE c.family_id = f.id AND c.claimant = $2 AND c.status = 'open'
                ) as "open_claim"
            FROM map_families f
            WHERE f.id = $1
        "#,
        family_id,
        user as _,
    )
    .fetch_optional(&mut *conn)
    .await
    .wrap_err("Failed to load the claim's map")
}

/// Whether claiming the family is granted at once: nobody owns it or is credited with it, and the
/// claimant published every one of its listed files (of which it has at least one).
fn is_instant(state: &ClaimState) -> bool {
    state.owner_id.is_none()
        && !state.has_credit
        && state.listed_files > 0
        && state.others_listed == 0
}

/// Why `user` can't claim the family, if they can't. Staff are only blocked by the state of the
/// map, not by restrictions, email verification or the claim limit. Updating an open claim, or
/// having it granted, makes no new claim, so the limit doesn't apply to it.
fn claim_block(state: &ClaimState, user: SbUserId, staff: bool) -> Option<ClaimBlock> {
    if !staff && state.restricted {
        Some(ClaimBlock::Restricted)
    } else if !staff && !state.email_verified {
        Some(ClaimBlock::EmailUnverified)
    } else if state.owner_id == Some(user) {
        Some(ClaimBlock::AlreadyOwner)
    } else if state.listed_files == 0 {
        Some(ClaimBlock::NotListed)
    } else if !staff && state.open_claim.is_none() && state.recent_claims >= MAX_CLAIMS_PER_DAY {
        Some(ClaimBlock::RateLimited)
    } else {
        None
    }
}

/// What claiming a family would do.
#[derive(Debug, Clone, Copy)]
pub struct ClaimPreview {
    /// Why the user can't claim the family, if they can't.
    pub blocked: Option<ClaimBlock>,
    /// Whether a claim would make them the owner at once, without staff.
    pub instant: bool,
    /// The user's open claim on the family, if they have one.
    pub open_claim: Option<Uuid>,
}

/// Previews claiming `family_id` as `user`, who is staff if `staff`. Changes nothing.
pub async fn claim_preview(
    db: &PgPool,
    family_id: Uuid,
    user: SbUserId,
    staff: bool,
) -> Result<ClaimPreview, OwnerError> {
    let mut conn = db.acquire().await.wrap_err("Failed to get a connection")?;
    let state = load_claim_state(&mut conn, family_id, user)
        .await?
        .ok_or(OwnerError::FamilyNotFound)?;
    Ok(ClaimPreview {
        blocked: claim_block(&state, user, staff),
        instant: is_instant(&state),
        open_claim: state.open_claim,
    })
}

/// What claiming a family did.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ClaimOutcome {
    pub claim_id: Uuid,
    pub family_id: Uuid,
    /// Whether the claimant was made the owner at once. Otherwise the claim waits for staff.
    pub granted: bool,
}

fn trimmed_note(note: Option<&str>) -> Result<Option<&str>, OwnerError> {
    let note = note.map(str::trim).filter(|n| !n.is_empty());
    if note.is_some_and(|n| n.chars().count() > MAX_CLAIM_NOTE_LENGTH) {
        return Err(OwnerError::NoteTooLong);
    }
    Ok(note)
}

/// Claims `family_id` for `user`, who is staff if `staff`. A user who published every listed file
/// of a family that has no owner and no credit becomes its owner at once (granting their open claim
/// on it, if they have one). Any other claim needs a note for staff: it's stored as an open claim,
/// or updates the note of the user's open claim on the family. A family with an owner can be
/// claimed this way too, for staff to settle.
pub async fn claim(
    db: &PgPool,
    family_id: Uuid,
    note: Option<&str>,
    user: SbUserId,
    staff: bool,
) -> Result<ClaimOutcome, OwnerError> {
    let note = trimmed_note(note)?;
    let mut tx = db.begin().await.wrap_err("Failed to start transaction")?;
    lock_families(&mut tx).await?;
    let state = load_claim_state(&mut tx, family_id, user)
        .await?
        .ok_or(OwnerError::FamilyNotFound)?;
    if let Some(block) = claim_block(&state, user, staff) {
        return Err(OwnerError::Blocked(block));
    }

    if is_instant(&state) {
        let claim_id = match state.open_claim {
            Some(id) => {
                sqlx::query!(
                    r#"
                        UPDATE map_owner_claims
                        SET status = 'granted', resolved_by = claimant, resolved_at = now(),
                            note = COALESCE($2, note)
                        WHERE id = $1
                    "#,
                    id,
                    note,
                )
                .execute(&mut *tx)
                .await
                .wrap_err("Failed to grant the open claim")?;
                id
            }
            None => sqlx::query_scalar!(
                r#"
                    INSERT INTO map_owner_claims (family_id, claimant, note, status, resolved_by,
                        resolved_at)
                    VALUES ($1, $2, $3, 'granted', $2, now())
                    RETURNING id
                "#,
                family_id,
                user as _,
                note,
            )
            .fetch_one(&mut *tx)
            .await
            .wrap_err("Failed to store the claim")?,
        };
        let owner = Some((user, MapOwnerKind::Claim));
        write_owner(&mut tx, family_id, owner, user).await?;
        record_owner_change(&mut tx, family_id, user, None, owner, Some(claim_id)).await?;
        tx.commit().await.wrap_err("Failed to commit claim")?;
        return Ok(ClaimOutcome {
            claim_id,
            family_id,
            granted: true,
        });
    }

    let note = note.ok_or(OwnerError::NoteRequired)?;
    let claim_id = sqlx::query_scalar!(
        r#"
            INSERT INTO map_owner_claims (family_id, claimant, note)
            VALUES ($1, $2, $3)
            ON CONFLICT (family_id, claimant) WHERE status = 'open'
            DO UPDATE SET note = EXCLUDED.note
            RETURNING id
        "#,
        family_id,
        user as _,
        note,
    )
    .fetch_one(&mut *tx)
    .await
    .wrap_err("Failed to store the claim")?;
    tx.commit().await.wrap_err("Failed to commit claim")?;
    Ok(ClaimOutcome {
        claim_id,
        family_id,
        granted: false,
    })
}

/// Gives up `user`'s ownership of `family_id`. Allowed even while they're restricted.
pub async fn relinquish(db: &PgPool, family_id: Uuid, user: SbUserId) -> Result<(), OwnerError> {
    let mut tx = db.begin().await.wrap_err("Failed to start transaction")?;
    lock_families(&mut tx).await?;
    let current = load_owner(&mut tx, family_id).await?;
    if current.owner_id != Some(user) {
        return Err(OwnerError::NotOwner);
    }
    write_owner(&mut tx, family_id, None, user).await?;
    record_owner_change(&mut tx, family_id, user, Some(user), None, None).await?;
    tx.commit()
        .await
        .wrap_err("Failed to commit relinquishing")?;
    Ok(())
}

/// What an owner change by staff did.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct OwnerChange {
    /// The owner before the change.
    pub previous: Option<SbUserId>,
    /// Whether anything changed.
    pub changed: bool,
    /// The family's name.
    pub name: String,
}

/// Makes `owner` the owner of `family_id` as granted by staff, replacing any owner it has. Setting
/// a self-claimed owner again verifies them. The new owner's open claim on the family, if they have
/// one, is granted along with it.
pub async fn set_owner(
    db: &PgPool,
    family_id: Uuid,
    owner: SbUserId,
    actor: SbUserId,
) -> Result<OwnerChange, OwnerError> {
    let mut tx = db.begin().await.wrap_err("Failed to start transaction")?;
    lock_families(&mut tx).await?;
    let exists = sqlx::query_scalar!(
        r#"SELECT EXISTS (SELECT 1 FROM users WHERE id = $1) as "exists!""#,
        owner as _,
    )
    .fetch_one(&mut *tx)
    .await
    .wrap_err("Failed to look up the user")?;
    if !exists {
        return Err(OwnerError::UserNotFound);
    }
    let current = load_owner(&mut tx, family_id).await?;
    if current.owner_id == Some(owner) && current.kind() == Some(MapOwnerKind::Staff) {
        return Ok(OwnerChange {
            previous: current.owner_id,
            changed: false,
            name: current.name,
        });
    }
    let after = Some((owner, MapOwnerKind::Staff));
    write_owner(&mut tx, family_id, after, actor).await?;
    let claim_id = sqlx::query_scalar!(
        r#"
            UPDATE map_owner_claims
            SET status = 'granted', resolved_by = $3, resolved_at = now()
            WHERE family_id = $1 AND claimant = $2 AND status = 'open'
            RETURNING id
        "#,
        family_id,
        owner as _,
        actor as _,
    )
    .fetch_optional(&mut *tx)
    .await
    .wrap_err("Failed to grant the new owner's claim")?;
    record_owner_change(&mut tx, family_id, actor, current.owner_id, after, claim_id).await?;
    tx.commit()
        .await
        .wrap_err("Failed to commit owner change")?;
    Ok(OwnerChange {
        previous: current.owner_id,
        changed: true,
        name: current.name,
    })
}

/// Removes the owner of `family_id`, if it has one.
pub async fn remove_owner(
    db: &PgPool,
    family_id: Uuid,
    actor: SbUserId,
) -> Result<OwnerChange, OwnerError> {
    let mut tx = db.begin().await.wrap_err("Failed to start transaction")?;
    lock_families(&mut tx).await?;
    let current = load_owner(&mut tx, family_id).await?;
    if current.owner_id.is_none() {
        return Ok(OwnerChange {
            previous: None,
            changed: false,
            name: current.name,
        });
    }
    write_owner(&mut tx, family_id, None, actor).await?;
    record_owner_change(&mut tx, family_id, actor, current.owner_id, None, None).await?;
    tx.commit()
        .await
        .wrap_err("Failed to commit owner removal")?;
    Ok(OwnerChange {
        previous: current.owner_id,
        changed: true,
        name: current.name,
    })
}

/// The credit to store for what staff typed: trimmed, and none when that leaves nothing.
fn normalize_credit(credit: Option<&str>) -> Result<Option<&str>, OwnerError> {
    let credit = credit.map(str::trim).filter(|c| !c.is_empty());
    if credit.is_some_and(|c| c.chars().count() > MAX_CREDIT_LENGTH) {
        return Err(OwnerError::CreditTooLong);
    }
    Ok(credit)
}

/// Sets (or with `None` or blank text, clears) the maker's name `family_id` is credited to.
pub async fn set_credit(
    db: &PgPool,
    family_id: Uuid,
    credit: Option<&str>,
    actor: SbUserId,
) -> Result<(), OwnerError> {
    let credit = normalize_credit(credit)?;
    let mut tx = db.begin().await.wrap_err("Failed to start transaction")?;
    lock_families(&mut tx).await?;
    let current = load_owner(&mut tx, family_id).await?;
    if current.credit.as_deref() == credit {
        return Ok(());
    }
    sqlx::query!(
        "UPDATE map_families SET credit = $2, updated_at = now() WHERE id = $1",
        family_id,
        credit,
    )
    .execute(&mut *tx)
    .await
    .wrap_err("Failed to store the credit")?;
    history::record(
        &mut tx,
        HistoryEntry {
            kind: MapFamilyHistoryKind::SetCredit,
            actor,
            family_id,
            other_family_id: None,
            map_id: None,
            details: HistoryDetails {
                credit: Some(Change {
                    before: current.credit,
                    after: credit.map(str::to_string),
                }),
                ..Default::default()
            },
        },
    )
    .await?;
    tx.commit().await.wrap_err("Failed to commit credit")?;
    Ok(())
}

/// A claim staff granted or rejected.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ResolvedClaim {
    pub claim_id: Uuid,
    /// The claim's family, through any merges since the claim was made.
    pub family_id: Uuid,
    pub claimant: SbUserId,
    /// The owner the claimant replaced, if granting the claim replaced one.
    pub replaced_owner: Option<SbUserId>,
    /// The family's name.
    pub name: String,
}

struct ClaimRow {
    family_id: Uuid,
    claimant: SbUserId,
    status: String,
}

async fn load_open_claim_for_update(
    tx: &mut Transaction<'_, Postgres>,
    claim_id: Uuid,
) -> Result<(ClaimRow, Uuid), OwnerError> {
    let claim = sqlx::query_as!(
        ClaimRow,
        r#"
            SELECT family_id, claimant as "claimant: SbUserId", status
            FROM map_owner_claims
            WHERE id = $1
            FOR UPDATE
        "#,
        claim_id,
    )
    .fetch_optional(&mut **tx)
    .await
    .wrap_err("Failed to load the claim")?
    .ok_or(OwnerError::ClaimNotFound)?;
    if MapOwnerClaimStatus::from_db(&claim.status) != MapOwnerClaimStatus::Open {
        return Err(OwnerError::NotOpenClaim);
    }
    let family_id = resolve_family_id(&mut **tx, claim.family_id)
        .await?
        .ok_or(OwnerError::FamilyNotFound)?;
    Ok((claim, family_id))
}

async fn close_claim(
    tx: &mut Transaction<'_, Postgres>,
    claim_id: Uuid,
    status: MapOwnerClaimStatus,
    actor: SbUserId,
) -> eyre::Result<()> {
    sqlx::query!(
        r#"
            UPDATE map_owner_claims
            SET status = $2, resolved_by = $3, resolved_at = now()
            WHERE id = $1
        "#,
        claim_id,
        status.as_str(),
        actor as _,
    )
    .execute(&mut **tx)
    .await
    .wrap_err("Failed to close the claim")?;
    Ok(())
}

/// Grants an open claim: its claimant becomes the owner of the claim's family (through any merges),
/// as granted by staff, replacing any owner it has. Other open claims on the family stay open.
pub async fn grant_claim(
    db: &PgPool,
    claim_id: Uuid,
    actor: SbUserId,
) -> Result<ResolvedClaim, OwnerError> {
    let mut tx = db.begin().await.wrap_err("Failed to start transaction")?;
    lock_families(&mut tx).await?;
    let (claim, family_id) = load_open_claim_for_update(&mut tx, claim_id).await?;
    let current = load_owner(&mut tx, family_id).await?;
    let after = Some((claim.claimant, MapOwnerKind::Staff));
    write_owner(&mut tx, family_id, after, actor).await?;
    close_claim(&mut tx, claim_id, MapOwnerClaimStatus::Granted, actor).await?;
    record_owner_change(
        &mut tx,
        family_id,
        actor,
        current.owner_id,
        after,
        Some(claim_id),
    )
    .await?;
    tx.commit().await.wrap_err("Failed to commit claim grant")?;
    Ok(ResolvedClaim {
        claim_id,
        family_id,
        claimant: claim.claimant,
        replaced_owner: current.owner_id.filter(|&owner| owner != claim.claimant),
        name: current.name,
    })
}

/// Rejects an open claim. The family's owner doesn't change.
pub async fn reject_claim(
    db: &PgPool,
    claim_id: Uuid,
    actor: SbUserId,
) -> Result<ResolvedClaim, OwnerError> {
    let mut tx = db.begin().await.wrap_err("Failed to start transaction")?;
    let (claim, family_id) = load_open_claim_for_update(&mut tx, claim_id).await?;
    let current = load_owner(&mut tx, family_id).await?;
    close_claim(&mut tx, claim_id, MapOwnerClaimStatus::Rejected, actor).await?;
    tx.commit()
        .await
        .wrap_err("Failed to commit claim rejection")?;
    Ok(ResolvedClaim {
        claim_id,
        family_id,
        claimant: claim.claimant,
        replaced_owner: None,
        name: current.name,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    const ME: SbUserId = SbUserId(1);
    const SOMEONE: SbUserId = SbUserId(2);

    /// A map nobody owns, with one listed file the claimant published.
    const MINE: ClaimState = ClaimState {
        owner_id: None,
        has_credit: false,
        listed_files: 1,
        others_listed: 0,
        email_verified: true,
        restricted: false,
        recent_claims: MAX_CLAIMS_PER_DAY - 1,
        open_claim: None,
    };

    #[test]
    fn publishing_every_listed_file_of_an_unowned_map_claims_it_at_once() {
        assert!(is_instant(&MINE));
        assert_eq!(claim_block(&MINE, ME, false), None);
    }

    #[test]
    fn anything_else_needs_staff() {
        for state in [
            ClaimState {
                others_listed: 1,
                listed_files: 2,
                ..MINE
            },
            ClaimState {
                owner_id: Some(SOMEONE),
                ..MINE
            },
            ClaimState {
                has_credit: true,
                ..MINE
            },
            ClaimState {
                listed_files: 0,
                ..MINE
            },
        ] {
            assert!(!is_instant(&state), "{state:?}");
        }
        // Someone else's map can still be claimed, for staff to decide.
        let owned = ClaimState {
            owner_id: Some(SOMEONE),
            ..MINE
        };
        assert_eq!(claim_block(&owned, ME, false), None);
    }

    #[test]
    fn each_check_blocks_claiming() {
        let cases = [
            (
                ClaimState {
                    restricted: true,
                    ..MINE
                },
                ClaimBlock::Restricted,
            ),
            (
                ClaimState {
                    email_verified: false,
                    ..MINE
                },
                ClaimBlock::EmailUnverified,
            ),
            (
                ClaimState {
                    owner_id: Some(ME),
                    ..MINE
                },
                ClaimBlock::AlreadyOwner,
            ),
            (
                ClaimState {
                    listed_files: 0,
                    ..MINE
                },
                ClaimBlock::NotListed,
            ),
            (
                ClaimState {
                    recent_claims: MAX_CLAIMS_PER_DAY,
                    ..MINE
                },
                ClaimBlock::RateLimited,
            ),
        ];
        for (state, block) in cases {
            assert_eq!(claim_block(&state, ME, false), Some(block), "{state:?}");
        }
    }

    #[test]
    fn an_open_claim_can_be_updated_past_the_limit() {
        let state = ClaimState {
            recent_claims: MAX_CLAIMS_PER_DAY,
            open_claim: Some(Uuid::nil()),
            ..MINE
        };
        assert_eq!(claim_block(&state, ME, false), None);
    }

    #[test]
    fn staff_are_only_blocked_by_the_map() {
        let state = ClaimState {
            restricted: true,
            email_verified: false,
            recent_claims: MAX_CLAIMS_PER_DAY,
            ..MINE
        };
        assert_eq!(claim_block(&state, ME, true), None);
        let owned = ClaimState {
            owner_id: Some(ME),
            ..state
        };
        assert_eq!(
            claim_block(&owned, ME, true),
            Some(ClaimBlock::AlreadyOwner)
        );
        let unlisted = ClaimState {
            listed_files: 0,
            ..state
        };
        assert_eq!(
            claim_block(&unlisted, ME, true),
            Some(ClaimBlock::NotListed)
        );
    }

    #[test]
    fn notes_and_credits_are_trimmed_and_capped() {
        assert_eq!(trimmed_note(Some("  mine  ")).unwrap(), Some("mine"));
        assert_eq!(trimmed_note(Some("   ")).unwrap(), None);
        assert_eq!(trimmed_note(None).unwrap(), None);
        assert!(matches!(
            trimmed_note(Some(&"x".repeat(MAX_CLAIM_NOTE_LENGTH + 1))),
            Err(OwnerError::NoteTooLong)
        ));
        assert!(trimmed_note(Some(&"é".repeat(MAX_CLAIM_NOTE_LENGTH))).is_ok());

        assert_eq!(normalize_credit(Some(" Maker ")).unwrap(), Some("Maker"));
        assert_eq!(normalize_credit(Some("")).unwrap(), None);
        assert!(matches!(
            normalize_credit(Some(&"x".repeat(MAX_CREDIT_LENGTH + 1))),
            Err(OwnerError::CreditTooLong)
        ));
    }

    #[test]
    fn owner_kinds_round_trip_through_the_db_value() {
        for kind in [MapOwnerKind::Claim, MapOwnerKind::Staff] {
            assert_eq!(MapOwnerKind::from_db(kind.as_str()), kind);
        }
        for status in [
            MapOwnerClaimStatus::Open,
            MapOwnerClaimStatus::Granted,
            MapOwnerClaimStatus::Rejected,
        ] {
            assert_eq!(MapOwnerClaimStatus::from_db(status.as_str()), status);
        }
    }
}
