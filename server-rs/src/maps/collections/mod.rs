//! Map collections: named, ordered lists of maps. Players make their own (`user`), each player has
//! one Starred collection holding the maps they starred (favorited), staff make collections
//! everyone sees (`staff`), and every ladder map pool is a collection of its files
//! (`ladder_pool`, see [`pools`]). One staff collection, Staff picks, gives its maps the "Staff
//! pick" badge.
//!
//! An entry is a map, stored as its family, so it plays the map's current file and follows the map
//! through merges (see [`retire_family_entries`]). Entries can also name an exact file, which
//! follows that file wherever it goes; ladder pools hold only those.
//!
//! A player's collection is private until they make it public, and staff can hide a public one.
//! Who can see what is decided by [`CollectionRow::can_read`] and
//! [`CollectionRow::sees_all_entries`].

pub mod graphql;
pub mod pools;

use chrono::{DateTime, Utc};
use color_eyre::eyre::{self, WrapErr};
use sqlx::{FromRow, PgConnection, PgPool, Postgres, Transaction};
use uuid::Uuid;

use crate::maps::SbMapId;
use crate::maps::families::edit::MAX_REPORTS_PER_HOUR;
use crate::maps::families::publish::text_hits_restricted_names;
use crate::users::SbUserId;
use crate::users::names::NameChecker;

/// The most `user` collections one player can have.
pub const MAX_COLLECTIONS_PER_OWNER: i64 = 100;
/// The most maps a `user` or `staff` collection can hold. Starred has no limit.
pub const MAX_COLLECTION_MAPS: i64 = 200;
/// The most collections one player can save.
pub const MAX_SAVES_PER_USER: i64 = 500;
/// The shortest title a collection can have, in characters, after trimming.
pub const MIN_TITLE_LENGTH: usize = 3;
/// The longest title a collection can have, in characters, after trimming.
pub const MAX_TITLE_LENGTH: usize = 50;
/// The longest description a collection can have, in characters, after trimming.
pub const MAX_DESCRIPTION_LENGTH: usize = 500;
/// The longest note a report or a hide can carry, in characters, after trimming.
pub const MAX_NOTE_LENGTH: usize = 500;

/// What kind of collection something is, which decides who edits it and who sees it.
#[derive(async_graphql::Enum, sqlx::Type, Copy, Clone, Debug, Eq, PartialEq)]
#[graphql(name = "MapCollectionKind")]
#[sqlx(type_name = "collection_kind", rename_all = "snake_case")]
pub enum CollectionKind {
    /// Made by a player, who titles and orders it. Private until they make it public.
    User,
    /// A player's starred maps, newest first. Every player has one; only they see it.
    Starred,
    /// Made by staff. Everyone sees it.
    Staff,
    /// A ladder map pool.
    LadderPool,
}

/// Who is looking at a collection.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Viewer {
    pub id: Option<SbUserId>,
    /// Whether the viewer can manage maps.
    pub staff: bool,
    /// Whether the viewer can manage ladder map pools.
    pub manage_map_pools: bool,
}

/// A collection as stored.
#[derive(Debug, Clone, FromRow)]
pub struct CollectionRow {
    pub id: Uuid,
    pub kind: CollectionKind,
    pub owner_id: Option<SbUserId>,
    pub title: Option<String>,
    pub description: String,
    pub published_at: Option<DateTime<Utc>>,
    pub hidden_at: Option<DateTime<Utc>>,
    pub hidden_by: Option<SbUserId>,
    pub hidden_note: Option<String>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
    /// Whether this is Staff picks, whose maps get the "Staff pick" badge.
    pub grants_staff_pick: bool,
    /// When the ladder map pool this collection is starts. Set exactly for `ladder_pool`.
    pub pool_starts_at: Option<DateTime<Utc>>,
    /// How many files the ladder map pool this collection is holds. 0 for other kinds.
    pub pool_file_count: i64,
}

/// The columns of [`CollectionRow`], read from `collections c`.
pub(crate) const COLLECTION_COLUMNS: &str = "c.id, c.kind, c.owner_id, c.title, c.description, \
    c.published_at, c.hidden_at, c.hidden_by, c.hidden_note, c.created_at, c.updated_at, \
    c.grants_staff_pick, \
    (SELECT p.start_date AT TIME ZONE 'UTC' FROM matchmaking_map_pools p \
        WHERE p.collection_id = c.id) AS pool_starts_at, \
    CASE WHEN c.kind = 'ladder_pool' THEN \
        (SELECT count(*) FROM collection_maps pcm WHERE pcm.collection_id = c.id) \
        ELSE 0 END AS pool_file_count";

impl CollectionRow {
    pub fn is_owner(&self, viewer: Viewer) -> bool {
        viewer.id.is_some() && self.owner_id == viewer.id
    }

    /// Whether everyone can see the collection: a staff collection, a player's collection that is
    /// public and not hidden, or a ladder map pool that has started and holds at least
    /// [`pools::MIN_PUBLIC_POOL_FILES`] files.
    pub fn is_public(&self) -> bool {
        match self.kind {
            CollectionKind::Staff => true,
            CollectionKind::User => self.published_at.is_some() && self.hidden_at.is_none(),
            CollectionKind::LadderPool => {
                pools::is_open(self.pool_starts_at, self.pool_file_count, Utc::now())
            }
            CollectionKind::Starred => false,
        }
    }

    /// Whether `viewer` can see the collection. Its owner always can; users who can manage maps can
    /// also see a player's collection that is public or hidden, and users who can manage map pools
    /// can see every ladder map pool. Starred collections and private collections that were never
    /// hidden are for their owner alone.
    pub fn can_read(&self, viewer: Viewer) -> bool {
        self.is_owner(viewer)
            || self.is_public()
            || (viewer.staff
                && self.kind == CollectionKind::User
                && (self.published_at.is_some() || self.hidden_at.is_some()))
            || (viewer.manage_map_pools && self.kind == CollectionKind::LadderPool)
    }

    /// Whether `viewer` sees every entry of the collection. Everyone else sees only the entries
    /// whose map is listed. Everyone who can see a ladder map pool sees all of it, since the ladder
    /// plays its files whether they're listed or not.
    pub fn sees_all_entries(&self, viewer: Viewer) -> bool {
        self.is_owner(viewer)
            || (self.kind == CollectionKind::Staff && viewer.staff)
            || self.kind == CollectionKind::LadderPool
    }

    /// Whether `viewer` can add, remove and move the collection's maps: the owner of a player's
    /// collection or Starred, and users who can manage maps for a staff collection. Of these, only
    /// a player's collection or a staff collection can be renamed, reordered or deleted.
    pub fn can_edit(&self, viewer: Viewer) -> bool {
        match self.kind {
            CollectionKind::User | CollectionKind::Starred => self.is_owner(viewer),
            CollectionKind::Staff => viewer.staff,
            CollectionKind::LadderPool => false,
        }
    }

    /// Whether `viewer` may see that staff hid the collection, and why.
    pub fn sees_hidden(&self, viewer: Viewer) -> bool {
        self.is_owner(viewer) || viewer.staff
    }

    /// Whether players can report the collection: a player's collection everyone can see.
    fn is_reportable(&self) -> bool {
        self.kind == CollectionKind::User && self.is_public()
    }
}

#[derive(Debug, thiserror::Error)]
pub enum CollectionError {
    #[error("collection not found")]
    NotFound,
    #[error("map not found")]
    MapNotFound,
    #[error("report not found")]
    ReportNotFound,
    #[error("you can't edit this collection")]
    NotEditor,
    #[error("only users who can manage maps can make staff collections")]
    NotStaff,
    #[error("Starred can't be changed that way")]
    Starred,
    #[error("Staff picks can't be deleted")]
    StaffPicks,
    #[error("the title must be {MIN_TITLE_LENGTH} to {MAX_TITLE_LENGTH} characters on one line")]
    InvalidTitle,
    #[error("the description must be at most {MAX_DESCRIPTION_LENGTH} characters")]
    DescriptionTooLong,
    #[error("you already have a collection with that title")]
    DuplicateTitle,
    #[error("you can have at most {MAX_COLLECTIONS_PER_OWNER} collections")]
    TooManyCollections,
    #[error("a collection can hold at most {MAX_COLLECTION_MAPS} maps")]
    CollectionFull,
    #[error("that map isn't in the collection")]
    NotInCollection,
    #[error("only a player's collection can be made public or private")]
    NotPublishable,
    #[error("you need to verify your email address to make a collection public")]
    EmailUnverified,
    #[error("you are currently restricted from publishing maps")]
    PublishingRestricted,
    #[error("you are currently restricted from reporting")]
    ReportingRestricted,
    #[error("the title or description contains a word that isn't allowed in public collections")]
    RestrictedName,
    #[error("staff hid this collection, so it can't be made public or private")]
    Hidden,
    #[error("only a player's collection can be hidden")]
    NotHideable,
    #[error("a note is required")]
    NoteRequired,
    #[error("the note must be at most {MAX_NOTE_LENGTH} characters")]
    NoteTooLong,
    #[error("you can't do that to your own collection")]
    OwnCollection,
    #[error("only a public player's collection can be reported")]
    NotReportable,
    #[error("you can save at most {MAX_SAVES_PER_USER} collections")]
    TooManySaves,
    #[error("you've filed too many reports recently, please try again later")]
    TooManyReports,
    #[error("the report was already resolved")]
    ReportResolved,
    #[error(transparent)]
    Other(#[from] eyre::Report),
}

impl From<sqlx::Error> for CollectionError {
    fn from(error: sqlx::Error) -> Self {
        Self::Other(error.into())
    }
}

impl CollectionError {
    /// The GraphQL error code for this error. `None` for unexpected failures.
    pub fn code(&self) -> Option<&'static str> {
        Some(match self {
            Self::NotFound | Self::MapNotFound | Self::ReportNotFound => "NOT_FOUND",
            Self::NotEditor | Self::NotStaff => "FORBIDDEN",
            Self::InvalidTitle => "INVALID_TITLE",
            Self::DescriptionTooLong => "INVALID_DESCRIPTION",
            Self::DuplicateTitle => "DUPLICATE_TITLE",
            Self::TooManyCollections => "TOO_MANY_COLLECTIONS",
            Self::CollectionFull => "COLLECTION_FULL",
            Self::EmailUnverified => "EMAIL_UNVERIFIED",
            Self::PublishingRestricted | Self::ReportingRestricted => "RESTRICTED",
            Self::RestrictedName => "RESTRICTED_NAME",
            Self::Hidden => "HIDDEN",
            Self::TooManySaves => "TOO_MANY_SAVES",
            Self::TooManyReports => "RATE_LIMITED",
            Self::Starred
            | Self::StaffPicks
            | Self::NotInCollection
            | Self::NotPublishable
            | Self::NotHideable
            | Self::NoteRequired
            | Self::NoteTooLong
            | Self::OwnCollection
            | Self::NotReportable
            | Self::ReportResolved => "BAD_REQUEST",
            Self::Other(_) => return None,
        })
    }
}

/// Maps a violation of the one-title-per-owner index to [`CollectionError::DuplicateTitle`], for
/// two writers racing past the check.
fn title_conflict(error: sqlx::Error) -> CollectionError {
    let duplicate = error
        .as_database_error()
        .and_then(|e| e.constraint())
        .is_some_and(|c| c == "collections_user_title_unique_index");
    if duplicate {
        CollectionError::DuplicateTitle
    } else {
        error.into()
    }
}

/// Trims a title and checks its length. Titles are one line of plain text.
pub fn clean_title(title: &str) -> Result<String, CollectionError> {
    let title = title.trim();
    let length = title.chars().count();
    if !(MIN_TITLE_LENGTH..=MAX_TITLE_LENGTH).contains(&length)
        || title.chars().any(char::is_control)
    {
        return Err(CollectionError::InvalidTitle);
    }
    Ok(title.to_string())
}

/// Trims a description and checks its length. Descriptions are plain text and may be empty.
pub fn clean_description(description: &str) -> Result<String, CollectionError> {
    let description = description.trim();
    if description.chars().count() > MAX_DESCRIPTION_LENGTH {
        return Err(CollectionError::DescriptionTooLong);
    }
    Ok(description.to_string())
}

/// Trims a report or hide note, which is required.
pub fn clean_note(note: &str) -> Result<String, CollectionError> {
    let note = note.trim();
    if note.is_empty() {
        Err(CollectionError::NoteRequired)
    } else if note.chars().count() > MAX_NOTE_LENGTH {
        Err(CollectionError::NoteTooLong)
    } else {
        Ok(note.to_string())
    }
}

pub async fn load(db: &PgPool, id: Uuid) -> eyre::Result<Option<CollectionRow>> {
    sqlx::query_as!(
        CollectionRow,
        r#"
            SELECT id, kind as "kind: CollectionKind", owner_id as "owner_id: SbUserId", title,
                description, published_at, hidden_at, hidden_by as "hidden_by: SbUserId",
                hidden_note, created_at, updated_at, grants_staff_pick,
                (SELECT p.start_date AT TIME ZONE 'UTC' FROM matchmaking_map_pools p
                    WHERE p.collection_id = collections.id) as pool_starts_at,
                CASE WHEN kind = 'ladder_pool' THEN
                    (SELECT count(*) FROM collection_maps pcm
                        WHERE pcm.collection_id = collections.id)
                    ELSE 0 END as "pool_file_count!"
            FROM collections
            WHERE id = $1
        "#,
        id,
    )
    .fetch_optional(db)
    .await
    .wrap_err("Failed to load collection")
}

/// Loads a collection and locks it for the rest of the transaction, so its entries and their
/// positions don't change under the caller. Fails with `NotFound` unless `viewer` can see it.
async fn lock(
    tx: &mut Transaction<'_, Postgres>,
    id: Uuid,
    viewer: Viewer,
) -> Result<CollectionRow, CollectionError> {
    sqlx::query_as!(
        CollectionRow,
        r#"
            SELECT id, kind as "kind: CollectionKind", owner_id as "owner_id: SbUserId", title,
                description, published_at, hidden_at, hidden_by as "hidden_by: SbUserId",
                hidden_note, created_at, updated_at, grants_staff_pick,
                (SELECT p.start_date AT TIME ZONE 'UTC' FROM matchmaking_map_pools p
                    WHERE p.collection_id = collections.id) as pool_starts_at,
                CASE WHEN kind = 'ladder_pool' THEN
                    (SELECT count(*) FROM collection_maps pcm
                        WHERE pcm.collection_id = collections.id)
                    ELSE 0 END as "pool_file_count!"
            FROM collections
            WHERE id = $1
            FOR UPDATE
        "#,
        id,
    )
    .fetch_optional(&mut **tx)
    .await
    .wrap_err("Failed to lock collection")?
    .filter(|row| row.can_read(viewer))
    .ok_or(CollectionError::NotFound)
}

/// Loads a collection `viewer` can see, failing with `NotFound` otherwise.
async fn load_readable(
    db: &PgPool,
    id: Uuid,
    viewer: Viewer,
) -> Result<CollectionRow, CollectionError> {
    load(db, id)
        .await?
        .filter(|row| row.can_read(viewer))
        .ok_or(CollectionError::NotFound)
}

/// Returns `user`'s Starred collection, creating it if they don't have one yet.
pub async fn starred_id(conn: &mut PgConnection, user: SbUserId) -> eyre::Result<Uuid> {
    sqlx::query!(
        r#"
            INSERT INTO collections (kind, owner_id)
            VALUES ('starred', $1)
            ON CONFLICT (owner_id) WHERE kind = 'starred' DO NOTHING
        "#,
        user as _,
    )
    .execute(&mut *conn)
    .await
    .wrap_err("Failed to create Starred collection")?;
    sqlx::query_scalar!(
        "SELECT id FROM collections WHERE owner_id = $1 AND kind = 'starred'",
        user as _,
    )
    .fetch_one(&mut *conn)
    .await
    .wrap_err("Failed to load Starred collection")
}

/// Stars the map (family) `file_id` is in for `user`. Starring a starred map does nothing.
pub async fn add_favorite(db: &PgPool, user: SbUserId, file_id: SbMapId) -> eyre::Result<()> {
    let mut tx = db.begin().await.wrap_err("Failed to start transaction")?;
    let starred = starred_id(&mut tx, user).await?;
    let added = sqlx::query!(
        r#"
            INSERT INTO collection_maps (collection_id, family_id, position, added_at)
            SELECT $1, family_id, 0, now() FROM maps WHERE id = $2
            ON CONFLICT (collection_id, family_id) WHERE family_id IS NOT NULL DO NOTHING
        "#,
        starred,
        file_id as _,
    )
    .execute(&mut *tx)
    .await
    .wrap_err("Failed to star map")?
    .rows_affected();
    if added > 0 {
        touch(&mut tx, starred).await?;
    }
    tx.commit().await.wrap_err("Failed to commit star")?;
    Ok(())
}

/// Unstars the map (family) `file_id` is in for `user`. Unstarring a map that isn't starred does
/// nothing.
pub async fn remove_favorite(db: &PgPool, user: SbUserId, file_id: SbMapId) -> eyre::Result<()> {
    sqlx::query!(
        r#"
            WITH removed AS (
                DELETE FROM collection_maps cm
                USING collections c, maps m
                WHERE c.id = cm.collection_id AND c.kind = 'starred' AND c.owner_id = $2
                    AND m.id = $1 AND cm.family_id = m.family_id
                RETURNING cm.collection_id
            )
            UPDATE collections SET updated_at = now()
            WHERE id IN (SELECT collection_id FROM removed)
        "#,
        file_id as _,
        user as _,
    )
    .execute(db)
    .await
    .wrap_err("Failed to unstar map")?;
    Ok(())
}

/// Marks a collection as edited now.
async fn touch(conn: &mut PgConnection, id: Uuid) -> eyre::Result<()> {
    sqlx::query!(
        "UPDATE collections SET updated_at = now() WHERE id = $1",
        id
    )
    .execute(&mut *conn)
    .await
    .wrap_err("Failed to update collection")?;
    Ok(())
}

/// Serializes changes to `user`'s collection count or saves for the rest of the transaction, so
/// their limits hold for concurrent requests.
async fn lock_user_collections(conn: &mut PgConnection, user: SbUserId) -> eyre::Result<()> {
    // The first key keeps these locks apart from other advisory locks on user ids
    sqlx::query!(
        "SELECT pg_advisory_xact_lock(hashtext('collections'), $1)",
        user as _
    )
    .execute(&mut *conn)
    .await
    .wrap_err("Failed to lock the user's collections")?;
    Ok(())
}

/// Whether `owner` has another `user` collection titled `title`, ignoring case.
async fn title_taken(
    conn: &mut PgConnection,
    owner: SbUserId,
    title: &str,
    except: Option<Uuid>,
) -> eyre::Result<bool> {
    sqlx::query_scalar!(
        r#"
            SELECT EXISTS (
                SELECT 1 FROM collections
                WHERE owner_id = $1 AND kind = 'user' AND lower(title) = lower($2)
                    AND id IS DISTINCT FROM $3
            ) as "taken!"
        "#,
        owner as _,
        title,
        except,
    )
    .fetch_one(&mut *conn)
    .await
    .wrap_err("Failed to check collection titles")
}

/// What decides whether a player may make a collection public.
struct PublisherState {
    email_verified: bool,
    restricted: bool,
}

async fn load_publisher(conn: &mut PgConnection, user: SbUserId) -> eyre::Result<PublisherState> {
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
                ) as "restricted!"
        "#,
        user as _,
    )
    .fetch_one(&mut *conn)
    .await
    .wrap_err("Failed to load the publisher")
}

/// Creates a collection: a staff collection with `staff` (only for users who can manage maps),
/// otherwise a private collection of `user`'s. With `add_map`, the map (family) that file is in
/// is its first entry. Returns the new collection's id.
pub async fn create(
    db: &PgPool,
    user: SbUserId,
    user_is_staff: bool,
    title: &str,
    description: Option<&str>,
    staff: bool,
    add_map: Option<SbMapId>,
) -> Result<Uuid, CollectionError> {
    if staff && !user_is_staff {
        return Err(CollectionError::NotStaff);
    }
    let title = clean_title(title)?;
    let description = clean_description(description.unwrap_or(""))?;

    let mut tx = db.begin().await?;
    if !staff {
        lock_user_collections(&mut tx, user).await?;
        let owned = sqlx::query_scalar!(
            r#"SELECT count(*) as "count!" FROM collections WHERE owner_id = $1 AND kind = 'user'"#,
            user as _,
        )
        .fetch_one(&mut *tx)
        .await
        .wrap_err("Failed to count collections")?;
        if owned >= MAX_COLLECTIONS_PER_OWNER {
            return Err(CollectionError::TooManyCollections);
        }
        if title_taken(&mut tx, user, &title, None).await? {
            return Err(CollectionError::DuplicateTitle);
        }
    }
    let (kind, owner) = if staff {
        (CollectionKind::Staff, None)
    } else {
        (CollectionKind::User, Some(user))
    };
    let id = sqlx::query_scalar!(
        r#"
            INSERT INTO collections (kind, owner_id, title, description)
            VALUES ($1, $2, $3, $4)
            RETURNING id
        "#,
        kind as _,
        owner as _,
        title,
        description,
    )
    .fetch_one(&mut *tx)
    .await
    .map_err(title_conflict)?;
    if let Some(file_id) = add_map {
        insert_entry(&mut tx, id, kind, file_id).await?;
    }
    tx.commit().await?;
    Ok(id)
}

/// Changes a collection's title, description, and (for a player's collection) whether it's
/// public. Only what's given changes.
pub async fn update(
    db: &PgPool,
    names: &NameChecker,
    id: Uuid,
    viewer: Viewer,
    title: Option<&str>,
    description: Option<&str>,
    public: Option<bool>,
) -> Result<(), CollectionError> {
    let title = title.map(clean_title).transpose()?;
    let description = description.map(clean_description).transpose()?;

    let mut tx = db.begin().await?;
    let row = lock(&mut tx, id, viewer).await?;
    if !row.can_edit(viewer) {
        return Err(CollectionError::NotEditor);
    }
    if row.kind == CollectionKind::Starred {
        return Err(CollectionError::Starred);
    }
    if public.is_some() && row.kind != CollectionKind::User {
        return Err(CollectionError::NotPublishable);
    }
    if let (Some(title), Some(owner)) = (&title, row.owner_id)
        && title_taken(&mut tx, owner, title, Some(id)).await?
    {
        return Err(CollectionError::DuplicateTitle);
    }

    let was_public = row.published_at.is_some();
    let will_be_public = public.unwrap_or(was_public);
    let publishing = will_be_public && !was_public;
    if public.is_some_and(|p| p != was_public) && row.hidden_at.is_some() {
        return Err(CollectionError::Hidden);
    }
    if publishing {
        let owner = row.owner_id.ok_or(CollectionError::NotPublishable)?;
        let publisher = load_publisher(&mut tx, owner).await?;
        if publisher.restricted {
            return Err(CollectionError::PublishingRestricted);
        }
        if !publisher.email_verified {
            return Err(CollectionError::EmailUnverified);
        }
    }
    let text_changed = title.is_some() || description.is_some();
    if row.kind == CollectionKind::User && will_be_public && (publishing || text_changed) {
        let final_title = title.as_deref().or(row.title.as_deref()).unwrap_or("");
        let final_description = description.as_deref().unwrap_or(&row.description);
        if text_hits_restricted_names(names, final_title, final_description).await? {
            return Err(CollectionError::RestrictedName);
        }
    }

    sqlx::query!(
        r#"
            UPDATE collections
            SET title = COALESCE($2, title),
                description = COALESCE($3, description),
                published_at = CASE
                    WHEN $4::boolean IS NULL THEN published_at
                    WHEN $4 THEN COALESCE(published_at, now())
                    ELSE NULL
                END,
                updated_at = now()
            WHERE id = $1
        "#,
        id,
        title,
        description,
        public,
    )
    .execute(&mut *tx)
    .await
    .map_err(title_conflict)?;
    tx.commit().await?;
    Ok(())
}

/// Deletes a player's or staff collection, with its entries, saves and reports. Staff picks can't
/// be deleted.
pub async fn delete(db: &PgPool, id: Uuid, viewer: Viewer) -> Result<(), CollectionError> {
    let mut tx = db.begin().await?;
    let row = lock(&mut tx, id, viewer).await?;
    if !row.can_edit(viewer) {
        return Err(CollectionError::NotEditor);
    }
    if row.kind == CollectionKind::Starred {
        return Err(CollectionError::Starred);
    }
    if row.grants_staff_pick {
        return Err(CollectionError::StaffPicks);
    }
    sqlx::query!("DELETE FROM collections WHERE id = $1", id)
        .execute(&mut *tx)
        .await
        .wrap_err("Failed to delete collection")?;
    tx.commit().await?;
    Ok(())
}

/// Adds the map (family) `file_id` is in to the end of a locked collection, or for Starred, as
/// its newest entry. Adding a map that's already in does nothing.
async fn insert_entry(
    tx: &mut Transaction<'_, Postgres>,
    id: Uuid,
    kind: CollectionKind,
    file_id: SbMapId,
) -> Result<(), CollectionError> {
    let family_id =
        sqlx::query_scalar!(r#"SELECT family_id FROM maps WHERE id = $1"#, file_id as _,)
            .fetch_optional(&mut **tx)
            .await
            .wrap_err("Failed to load map file")?
            .ok_or(CollectionError::MapNotFound)?;
    let row = sqlx::query!(
        r#"
            SELECT
                EXISTS (
                    SELECT 1 FROM collection_maps WHERE collection_id = $1 AND family_id = $2
                ) as "present!",
                (SELECT count(*) FROM collection_maps WHERE collection_id = $1) as "count!"
        "#,
        id,
        family_id,
    )
    .fetch_one(&mut **tx)
    .await
    .wrap_err("Failed to count collection maps")?;
    if row.present {
        return Ok(());
    }
    let starred = kind == CollectionKind::Starred;
    if !starred && row.count >= MAX_COLLECTION_MAPS {
        return Err(CollectionError::CollectionFull);
    }
    let position = if starred {
        0
    } else {
        i32::try_from(row.count).unwrap_or(i32::MAX)
    };
    sqlx::query!(
        r#"
            INSERT INTO collection_maps (collection_id, family_id, position, added_at)
            VALUES ($1, $2, $3, now())
            ON CONFLICT (collection_id, family_id) WHERE family_id IS NOT NULL DO NOTHING
        "#,
        id,
        family_id,
        position,
    )
    .execute(&mut **tx)
    .await
    .wrap_err("Failed to add map to collection")?;
    touch(tx, id).await?;
    Ok(())
}

/// Renumbers the positions of a collection's entries 0, 1, 2, ... in their current order. Starred
/// collections keep every entry at 0.
async fn renumber(conn: &mut PgConnection, ids: &[Uuid]) -> eyre::Result<()> {
    sqlx::query!(
        r#"
            UPDATE collection_maps cm
            SET position = r.position
            FROM (
                SELECT e.id,
                    (row_number() OVER (PARTITION BY e.collection_id ORDER BY e.position, e.id)
                        - 1)::integer as position
                FROM collection_maps e
                INNER JOIN collections c ON c.id = e.collection_id
                WHERE e.collection_id = ANY($1) AND c.kind <> 'starred'
            ) r
            WHERE cm.id = r.id AND cm.position <> r.position
        "#,
        ids,
    )
    .execute(&mut *conn)
    .await
    .wrap_err("Failed to renumber collection maps")?;
    Ok(())
}

/// Adds the map (family) `file_id` is in to the end of a collection. Adding a map that's already
/// in does nothing.
pub async fn add_map(
    db: &PgPool,
    id: Uuid,
    viewer: Viewer,
    file_id: SbMapId,
) -> Result<(), CollectionError> {
    let mut tx = db.begin().await?;
    let row = lock(&mut tx, id, viewer).await?;
    if !row.can_edit(viewer) {
        return Err(CollectionError::NotEditor);
    }
    insert_entry(&mut tx, id, row.kind, file_id).await?;
    tx.commit().await?;
    Ok(())
}

/// Removes the map (family) `file_id` is in from a collection, and an entry naming that exact file
/// if there is one. Removing a map that isn't in does nothing.
pub async fn remove_map(
    db: &PgPool,
    id: Uuid,
    viewer: Viewer,
    file_id: SbMapId,
) -> Result<(), CollectionError> {
    let mut tx = db.begin().await?;
    let row = lock(&mut tx, id, viewer).await?;
    if !row.can_edit(viewer) {
        return Err(CollectionError::NotEditor);
    }
    let removed = sqlx::query!(
        r#"
            DELETE FROM collection_maps
            WHERE collection_id = $1
                AND (family_id = (SELECT family_id FROM maps WHERE id = $2) OR map_id = $2)
        "#,
        id,
        file_id as _,
    )
    .execute(&mut *tx)
    .await
    .wrap_err("Failed to remove map from collection")?
    .rows_affected();
    if removed > 0 {
        renumber(&mut tx, &[id]).await?;
        touch(&mut tx, id).await?;
    }
    tx.commit().await?;
    Ok(())
}

/// Moves the map (family) `file_id` is in to `to_index` in a collection's order (clamped to the
/// collection's entries), shifting the entries between.
pub async fn move_map(
    db: &PgPool,
    id: Uuid,
    viewer: Viewer,
    file_id: SbMapId,
    to_index: i32,
) -> Result<(), CollectionError> {
    let mut tx = db.begin().await?;
    let row = lock(&mut tx, id, viewer).await?;
    if !row.can_edit(viewer) {
        return Err(CollectionError::NotEditor);
    }
    if row.kind == CollectionKind::Starred {
        return Err(CollectionError::Starred);
    }
    let entry = sqlx::query!(
        r#"
            SELECT id,
                (SELECT count(*) FROM collection_maps WHERE collection_id = $1) as "count!"
            FROM collection_maps
            WHERE collection_id = $1
                AND (family_id = (SELECT family_id FROM maps WHERE id = $2) OR map_id = $2)
            ORDER BY position, id
            LIMIT 1
        "#,
        id,
        file_id as _,
    )
    .fetch_optional(&mut *tx)
    .await
    .wrap_err("Failed to find the map in the collection")?
    .ok_or(CollectionError::NotInCollection)?;
    let last = i32::try_from(entry.count - 1).unwrap_or(i32::MAX);
    let to_index = to_index.clamp(0, last.max(0));
    sqlx::query!(
        r#"
            UPDATE collection_maps cm
            SET position = p.position
            FROM (
                SELECT o.id,
                    (CASE WHEN o.index >= $3::integer THEN o.index + 1 ELSE o.index END)::integer
                        as position
                FROM (
                    SELECT e.id, row_number() OVER (ORDER BY e.position, e.id) - 1 as index
                    FROM collection_maps e
                    WHERE e.collection_id = $1 AND e.id <> $2
                ) o
                UNION ALL
                SELECT $2::bigint, $3::integer
            ) p
            WHERE cm.id = p.id AND cm.position <> p.position
        "#,
        id,
        entry.id,
        to_index,
    )
    .execute(&mut *tx)
    .await
    .wrap_err("Failed to move map in collection")?;
    touch(&mut tx, id).await?;
    tx.commit().await?;
    Ok(())
}

/// Saves someone else's collection to `viewer`'s list. Saving a saved collection does nothing.
pub async fn save(db: &PgPool, id: Uuid, viewer: Viewer) -> Result<(), CollectionError> {
    let user = viewer.id.ok_or(CollectionError::NotFound)?;
    let row = load_readable(db, id, viewer).await?;
    if row.kind == CollectionKind::Starred {
        return Err(CollectionError::Starred);
    }
    if row.is_owner(viewer) {
        return Err(CollectionError::OwnCollection);
    }
    let mut tx = db.begin().await?;
    lock_user_collections(&mut tx, user).await?;
    let state = sqlx::query!(
        r#"
            SELECT
                EXISTS (
                    SELECT 1 FROM collection_saves WHERE user_id = $1 AND collection_id = $2
                ) as "saved!",
                (SELECT count(*) FROM collection_saves WHERE user_id = $1) as "count!"
        "#,
        user as _,
        id,
    )
    .fetch_one(&mut *tx)
    .await
    .wrap_err("Failed to count saves")?;
    if state.saved {
        return Ok(());
    }
    if state.count >= MAX_SAVES_PER_USER {
        return Err(CollectionError::TooManySaves);
    }
    sqlx::query!(
        r#"
            INSERT INTO collection_saves (user_id, collection_id)
            VALUES ($1, $2)
            ON CONFLICT DO NOTHING
        "#,
        user as _,
        id,
    )
    .execute(&mut *tx)
    .await
    .wrap_err("Failed to save collection")?;
    tx.commit().await?;
    Ok(())
}

/// Takes a collection out of `user`'s saved list. Unsaving a collection that isn't saved does
/// nothing.
pub async fn unsave(db: &PgPool, id: Uuid, user: SbUserId) -> eyre::Result<()> {
    sqlx::query!(
        "DELETE FROM collection_saves WHERE user_id = $1 AND collection_id = $2",
        user as _,
        id,
    )
    .execute(db)
    .await
    .wrap_err("Failed to unsave collection")?;
    Ok(())
}

/// Reports a public player's collection to staff. Reporting it again while the report is open
/// replaces the report's note. A reporter can file at most [`MAX_REPORTS_PER_HOUR`] collection
/// reports in a rolling hour; replacing an open report's note doesn't count. Returns the report's
/// id.
pub async fn report(
    db: &PgPool,
    id: Uuid,
    viewer: Viewer,
    note: &str,
) -> Result<Uuid, CollectionError> {
    let user = viewer.id.ok_or(CollectionError::NotFound)?;
    let row = load_readable(db, id, viewer).await?;
    let restricted = sqlx::query_scalar!(
        r#"
            SELECT EXISTS (
                SELECT 1 FROM user_restrictions
                WHERE user_id = $1 AND kind = 'reporting'::restriction_kind
                    AND start_time <= now() AND end_time > now()
            ) as "restricted!"
        "#,
        user as _,
    )
    .fetch_one(db)
    .await
    .wrap_err("Failed to check the reporting restriction")?;
    if restricted {
        return Err(CollectionError::ReportingRestricted);
    }
    if row.is_owner(viewer) {
        return Err(CollectionError::OwnCollection);
    }
    if !row.is_reportable() {
        return Err(CollectionError::NotReportable);
    }
    let note = clean_note(note)?;
    let filed = sqlx::query!(
        r#"
            SELECT
                EXISTS (
                    SELECT 1 FROM collection_reports
                    WHERE collection_id = $1 AND reporter_id = $2 AND resolved_at IS NULL
                ) as "open!",
                (
                    SELECT count(*) FROM collection_reports
                    WHERE reporter_id = $2 AND created_at > now() - interval '1 hour'
                ) as "recent!"
        "#,
        id,
        user as _,
    )
    .fetch_one(db)
    .await
    .wrap_err("Failed to count the reporter's reports")?;
    if !filed.open && filed.recent >= MAX_REPORTS_PER_HOUR {
        return Err(CollectionError::TooManyReports);
    }
    Ok(sqlx::query_scalar!(
        r#"
            INSERT INTO collection_reports (collection_id, reporter_id, note)
            VALUES ($1, $2, $3)
            ON CONFLICT (collection_id, reporter_id) WHERE resolved_at IS NULL
            DO UPDATE SET note = EXCLUDED.note
            RETURNING id
        "#,
        id,
        user as _,
        note,
    )
    .fetch_one(db)
    .await
    .wrap_err("Failed to report collection")?)
}

/// Hides a player's collection from everyone but its owner and staff, resolving its open reports.
/// Hiding a hidden collection replaces the note. `staff` must be able to manage maps.
pub async fn hide(
    db: &PgPool,
    id: Uuid,
    staff: SbUserId,
    note: &str,
) -> Result<(), CollectionError> {
    let viewer = Viewer {
        id: Some(staff),
        staff: true,
        manage_map_pools: false,
    };
    let note = clean_note(note)?;
    let mut tx = db.begin().await?;
    let row = lock(&mut tx, id, viewer).await?;
    if row.kind != CollectionKind::User {
        return Err(CollectionError::NotHideable);
    }
    sqlx::query!(
        r#"
            UPDATE collections
            SET hidden_at = COALESCE(hidden_at, now()), hidden_by = $2, hidden_note = $3
            WHERE id = $1
        "#,
        id,
        staff as _,
        note,
    )
    .execute(&mut *tx)
    .await
    .wrap_err("Failed to hide collection")?;
    sqlx::query!(
        r#"
            UPDATE collection_reports
            SET resolved_at = now(), resolved_by = $2, resolution = 'hidden'
            WHERE collection_id = $1 AND resolved_at IS NULL
        "#,
        id,
        staff as _,
    )
    .execute(&mut *tx)
    .await
    .wrap_err("Failed to resolve collection reports")?;
    tx.commit().await?;
    Ok(())
}

/// Shows a hidden collection again. Unhiding a collection that isn't hidden does nothing. `staff`
/// must be able to manage maps.
pub async fn unhide(db: &PgPool, id: Uuid, staff: SbUserId) -> Result<(), CollectionError> {
    let viewer = Viewer {
        id: Some(staff),
        staff: true,
        manage_map_pools: false,
    };
    let mut tx = db.begin().await?;
    let row = lock(&mut tx, id, viewer).await?;
    if row.kind != CollectionKind::User {
        return Err(CollectionError::NotHideable);
    }
    sqlx::query!(
        r#"
            UPDATE collections
            SET hidden_at = NULL, hidden_by = NULL, hidden_note = NULL
            WHERE id = $1
        "#,
        id,
    )
    .execute(&mut *tx)
    .await
    .wrap_err("Failed to unhide collection")?;
    tx.commit().await?;
    Ok(())
}

/// Dismisses an open report. `staff` must be able to manage maps.
pub async fn dismiss_report(
    db: &PgPool,
    report_id: Uuid,
    staff: SbUserId,
) -> Result<(), CollectionError> {
    let row = sqlx::query!(
        r#"
            WITH dismissed AS (
                UPDATE collection_reports
                SET resolved_at = now(), resolved_by = $2, resolution = 'dismissed'
                WHERE id = $1 AND resolved_at IS NULL
                RETURNING id
            )
            SELECT
                EXISTS (SELECT 1 FROM dismissed) as "dismissed!",
                EXISTS (SELECT 1 FROM collection_reports WHERE id = $1) as "exists!"
        "#,
        report_id,
        staff as _,
    )
    .fetch_one(db)
    .await
    .wrap_err("Failed to dismiss report")?;
    if row.dismissed {
        Ok(())
    } else if row.exists {
        Err(CollectionError::ReportResolved)
    } else {
        Err(CollectionError::ReportNotFound)
    }
}

/// Moves the map entries of the families in `from` to the family at the same index in `into`, in
/// every collection. Where a collection already holds the family it's moving to (or another
/// family moving to it), the entry first in the collection's order is kept and the others are
/// dropped; in Starred the kept entry takes the earliest star date. Positions of the collections
/// that lost an entry are renumbered.
pub(crate) async fn retire_family_entries(
    tx: &mut Transaction<'_, Postgres>,
    from: &[Uuid],
    into: &[Uuid],
) -> eyre::Result<()> {
    let dropped = sqlx::query_scalar!(
        r#"
            WITH v AS (
                SELECT * FROM unnest($1::uuid[], $2::uuid[]) AS v(from_id, into_id)
            ),
            entries AS (
                SELECT cm.id, cm.collection_id, t.into_id, cm.position, cm.added_at,
                    false as moving
                FROM collection_maps cm
                INNER JOIN (SELECT DISTINCT into_id FROM v) t ON t.into_id = cm.family_id
                UNION ALL
                SELECT cm.id, cm.collection_id, v.into_id, cm.position, cm.added_at, true
                FROM collection_maps cm
                INNER JOIN v ON v.from_id = cm.family_id
            ),
            ranked AS (
                SELECT e.id, e.collection_id, e.into_id, e.moving,
                    row_number() OVER (
                        PARTITION BY e.collection_id, e.into_id
                        ORDER BY e.moving, e.position, e.id
                    ) as rank,
                    min(e.added_at) OVER (PARTITION BY e.collection_id, e.into_id) as earliest,
                    bool_or(e.moving) OVER (PARTITION BY e.collection_id, e.into_id)
                        as any_moving
                FROM entries e
            ),
            dropped AS (
                DELETE FROM collection_maps cm
                USING ranked r
                WHERE cm.id = r.id AND r.moving AND r.rank > 1
                RETURNING cm.collection_id
            ),
            -- Never conflicts with a dropped entry: those still name a family being retired
            kept AS (
                UPDATE collection_maps cm
                SET family_id = r.into_id,
                    added_at = CASE WHEN c.kind = 'starred' THEN r.earliest ELSE cm.added_at END
                FROM ranked r, collections c
                WHERE cm.id = r.id AND r.rank = 1 AND r.any_moving AND c.id = cm.collection_id
            )
            SELECT DISTINCT collection_id as "collection_id!" FROM dropped
        "#,
        from,
        into,
    )
    .fetch_all(&mut **tx)
    .await
    .wrap_err("Failed to move collection entries")?;
    if !dropped.is_empty() {
        renumber(tx, &dropped).await?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn row(kind: CollectionKind, owner: Option<i32>) -> CollectionRow {
        let now = Utc::now();
        CollectionRow {
            id: Uuid::nil(),
            kind,
            owner_id: owner.map(SbUserId),
            title: None,
            description: String::new(),
            published_at: None,
            hidden_at: None,
            hidden_by: None,
            hidden_note: None,
            created_at: now,
            updated_at: now,
            grants_staff_pick: false,
            pool_starts_at: None,
            pool_file_count: 0,
        }
    }

    const OWNER: Viewer = Viewer {
        id: Some(SbUserId(1)),
        staff: false,
        manage_map_pools: false,
    };
    const OTHER: Viewer = Viewer {
        id: Some(SbUserId(2)),
        staff: false,
        manage_map_pools: false,
    };
    const STAFF: Viewer = Viewer {
        id: Some(SbUserId(3)),
        staff: true,
        manage_map_pools: false,
    };
    const LOGGED_OUT: Viewer = Viewer {
        id: None,
        staff: false,
        manage_map_pools: false,
    };

    #[test]
    fn who_reads_a_players_collection() {
        let private = row(CollectionKind::User, Some(1));
        assert!(private.can_read(OWNER));
        assert!(!private.can_read(OTHER));
        assert!(!private.can_read(STAFF));
        assert!(!private.can_read(LOGGED_OUT));

        let public = CollectionRow {
            published_at: Some(Utc::now()),
            ..private.clone()
        };
        for viewer in [OWNER, OTHER, STAFF, LOGGED_OUT] {
            assert!(public.can_read(viewer), "{viewer:?}");
        }
        assert!(public.sees_all_entries(OWNER));
        for viewer in [OTHER, STAFF, LOGGED_OUT] {
            assert!(!public.sees_all_entries(viewer), "{viewer:?}");
        }

        let hidden = CollectionRow {
            hidden_at: Some(Utc::now()),
            hidden_by: Some(SbUserId(3)),
            hidden_note: Some("no".into()),
            ..public.clone()
        };
        assert!(hidden.can_read(OWNER));
        assert!(hidden.can_read(STAFF));
        assert!(!hidden.can_read(OTHER));
        assert!(!hidden.can_read(LOGGED_OUT));
        assert!(!hidden.is_reportable());

        // Made private after staff hid it: still staff's to see
        let hidden_private = CollectionRow {
            published_at: None,
            ..hidden
        };
        assert!(hidden_private.can_read(STAFF));
        assert!(!hidden_private.can_read(OTHER));
    }

    #[test]
    fn starred_is_for_its_owner_alone() {
        let starred = row(CollectionKind::Starred, Some(1));
        assert!(starred.can_read(OWNER));
        for viewer in [OTHER, STAFF, LOGGED_OUT] {
            assert!(!starred.can_read(viewer), "{viewer:?}");
        }
        assert!(starred.can_edit(OWNER));
        assert!(!starred.can_edit(STAFF));
    }

    #[test]
    fn staff_collections_are_for_everyone_and_edited_by_staff() {
        let staff = row(CollectionKind::Staff, None);
        for viewer in [OWNER, OTHER, STAFF, LOGGED_OUT] {
            assert!(staff.can_read(viewer), "{viewer:?}");
            assert_eq!(staff.can_edit(viewer), viewer.staff, "{viewer:?}");
            assert_eq!(staff.sees_all_entries(viewer), viewer.staff, "{viewer:?}");
        }
        assert!(!staff.is_reportable());
        // No owner, so nobody is one, even logged out
        assert!(!staff.is_owner(LOGGED_OUT));
    }

    #[test]
    fn titles_are_trimmed_and_limited() {
        assert_eq!(clean_title("  Abc ").unwrap(), "Abc");
        assert!(matches!(
            clean_title("ab"),
            Err(CollectionError::InvalidTitle)
        ));
        assert!(matches!(
            clean_title("   ab   "),
            Err(CollectionError::InvalidTitle)
        ));
        assert_eq!(clean_title(&"한".repeat(50)).unwrap().chars().count(), 50);
        assert!(matches!(
            clean_title(&"a".repeat(51)),
            Err(CollectionError::InvalidTitle)
        ));
        assert!(matches!(
            clean_title("two\nlines"),
            Err(CollectionError::InvalidTitle)
        ));
    }

    #[test]
    fn descriptions_and_notes_are_trimmed_and_limited() {
        assert_eq!(clean_description("  ").unwrap(), "");
        assert_eq!(clean_description(&"a".repeat(500)).unwrap().len(), 500);
        assert!(matches!(
            clean_description(&"a".repeat(501)),
            Err(CollectionError::DescriptionTooLong)
        ));
        assert!(matches!(
            clean_note("  "),
            Err(CollectionError::NoteRequired)
        ));
        assert_eq!(clean_note(" why ").unwrap(), "why");
        assert!(matches!(
            clean_note(&"a".repeat(501)),
            Err(CollectionError::NoteTooLong)
        ));
    }
}
