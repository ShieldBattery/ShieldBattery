//! Map tags: words from a list staff manage (see [`super::tag_list`]) saying what kind of map a map
//! (family) is, at most [`MAX_MAP_TAGS`] per map. Every tag has a kind, melee or UMS, and applies to
//! a map only while the map's current file is of that kind. Tags of the other kind are ignored
//! everywhere, and the map's next tag edit removes them.
//!
//! Who set a tag decides who may take it off again: staff outrank the map's maker (its owner), who
//! outranks players, who outrank tags derived from the map's files (by the database function
//! `refresh_map_family_derived_tags`, which keeps them up to date until someone edits the map's
//! tags). Players may edit the tags of a listed map that has no maker, if they could publish maps,
//! and only so often. A file's publisher may also set its map's tags while publishing it, when the
//! file is the map's only file.
//!
//! Like every other family change, a tag edit takes the families lock before touching anything and
//! records one history entry.

use std::collections::HashSet;

use color_eyre::eyre::{self, WrapErr};
use serde::{Deserialize, Serialize};
use sqlx::{PgConnection, PgPool, Postgres, Transaction};
use uuid::Uuid;

use crate::maps::SbMapId;
use crate::maps::families::history::{
    self, Change, HistoryDetails, HistoryEntry, MapFamilyHistoryKind,
};
use crate::maps::families::lock_families;
use crate::users::SbUserId;

/// The most tags a map can have.
pub const MAX_MAP_TAGS: usize = 3;
/// The most tag edits a user can make as a player (on maps they aren't the maker of) in a rolling
/// hour. Edits made by publishing a file don't count.
pub const MAX_PLAYER_TAG_EDITS_PER_HOUR: i64 = 30;

/// Who set a tag on a map, which decides who may take it off: a tag can only be removed by someone
/// whose own source ranks at least as high.
#[derive(Copy, Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TagSource {
    /// Derived from the map's files.
    Derived,
    /// A player, while the map had no maker.
    Player,
    /// The map's maker (its owner).
    Maker,
    /// Staff.
    Staff,
}

impl TagSource {
    fn rank(self) -> u8 {
        match self {
            Self::Derived => 0,
            Self::Player => 1,
            Self::Maker => 2,
            Self::Staff => 3,
        }
    }

    /// Whether someone editing as `self` may remove a tag set by `other`.
    pub fn outranks_or_equals(self, other: TagSource) -> bool {
        self.rank() >= other.rank()
    }

    pub fn as_str(self) -> &'static str {
        match self {
            Self::Derived => "derived",
            Self::Player => "player",
            Self::Maker => "maker",
            Self::Staff => "staff",
        }
    }

    pub fn from_db(source: &str) -> Self {
        match source {
            "player" => Self::Player,
            "maker" => Self::Maker,
            "staff" => Self::Staff,
            _ => Self::Derived,
        }
    }
}

#[derive(Debug, thiserror::Error)]
pub enum TagError {
    #[error("map not found")]
    FamilyNotFound,
    #[error("there's no tag \"{0}\"")]
    UnknownTag(String),
    #[error("the tag \"{0}\" is for maps of the other kind")]
    WrongKind(String),
    #[error("the tag \"{0}\" is given more than once")]
    Repeated(String),
    #[error("a map can have at most {MAX_MAP_TAGS} tags")]
    TooMany,
    #[error("this map's maker sets its tags")]
    HasMaker,
    #[error("only a listed map's tags can be edited")]
    NotListed,
    #[error("you need to verify your email address to edit map tags")]
    EmailUnverified,
    #[error("you are currently restricted from publishing maps")]
    Restricted,
    #[error("the tag \"{0}\" was set by someone you can't overrule")]
    Locked(String),
    #[error("you've edited the tags of too many maps recently, please try again later")]
    RateLimited,
    #[error(transparent)]
    Other(#[from] eyre::Report),
}

impl From<sqlx::Error> for TagError {
    fn from(error: sqlx::Error) -> Self {
        Self::Other(error.into())
    }
}

impl TagError {
    /// The GraphQL error code for this error. `None` for unexpected failures.
    pub fn code(&self) -> Option<&'static str> {
        Some(match self {
            Self::FamilyNotFound => "NOT_FOUND",
            Self::UnknownTag(_) | Self::WrongKind(_) | Self::Repeated(_) | Self::TooMany => {
                "BAD_REQUEST"
            }
            Self::HasMaker => "FORBIDDEN",
            Self::NotListed => "NOT_LISTED",
            Self::EmailUnverified => "EMAIL_UNVERIFIED",
            Self::Restricted => "RESTRICTED",
            Self::Locked(_) => "TAG_LOCKED",
            Self::RateLimited => "RATE_LIMITED",
            Self::Other(_) => return None,
        })
    }
}

/// A tag of the list, as setting a map's tags reads it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TagDef {
    pub id: String,
    /// `melee` or `ums`, as `maps.kind`.
    pub kind: String,
    pub position: i32,
}

/// Checks what can be checked of a requested tag set without the database: no repeats, and at most
/// [`MAX_MAP_TAGS`] tags.
fn check_shape(tags: &[String]) -> Result<(), TagError> {
    let mut seen = HashSet::new();
    if let Some(repeated) = tags.iter().find(|tag| !seen.insert(tag.as_str())) {
        return Err(TagError::Repeated(repeated.clone()));
    }
    if tags.len() > MAX_MAP_TAGS {
        return Err(TagError::TooMany);
    }
    Ok(())
}

/// The tags `tags` names, in list order, after checking that each exists and is of `kind`. Locks
/// them against deletion until the transaction ends: a tag deleted meanwhile is either gone already
/// (and refused as unknown here) or deleted after this transaction, along with the rows it adds.
async fn resolve_requested(
    conn: &mut PgConnection,
    tags: &[String],
    kind: &str,
) -> Result<Vec<TagDef>, TagError> {
    check_shape(tags)?;
    let defs = sqlx::query_as!(
        TagDef,
        r#"
            SELECT id, kind, position FROM map_tags WHERE id = ANY($1) ORDER BY position
            FOR KEY SHARE
        "#,
        tags,
    )
    .fetch_all(&mut *conn)
    .await
    .wrap_err("Failed to look up map tags")?;
    if let Some(unknown) = tags.iter().find(|tag| !defs.iter().any(|d| &d.id == *tag)) {
        return Err(TagError::UnknownTag(unknown.clone()));
    }
    if let Some(other) = tags
        .iter()
        .find(|tag| defs.iter().any(|d| &d.id == *tag && d.kind != kind))
    {
        return Err(TagError::WrongKind(other.clone()));
    }
    Ok(defs)
}

/// The tags `tags` names, in list order, after checking that they're a tag set the map of
/// `file_id` could have once `file_id` is its current file.
pub(crate) async fn check_list_for_file(
    conn: &mut PgConnection,
    file_id: SbMapId,
    tags: &[String],
) -> Result<Vec<TagDef>, TagError> {
    let kind = sqlx::query_scalar!("SELECT kind FROM maps WHERE id = $1", file_id as _)
        .fetch_optional(&mut *conn)
        .await
        .wrap_err("Failed to load the file's kind")?
        .ok_or(TagError::FamilyNotFound)?;
    resolve_requested(conn, tags, &kind).await
}

/// What decides whether a user who isn't staff may edit tags as a player.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct EditorState {
    pub email_verified: bool,
    /// Whether they're restricted from publishing maps.
    pub restricted: bool,
}

/// Staff need none of [`EditorState`]; this stands in for it.
pub const STAFF_EDITOR: EditorState = EditorState {
    email_verified: true,
    restricted: false,
};

pub(crate) async fn load_editors(
    db: &PgPool,
    users: &[SbUserId],
) -> eyre::Result<Vec<(SbUserId, EditorState)>> {
    let ids: Vec<i32> = users.iter().map(|u| u.0).collect();
    let rows = sqlx::query!(
        r#"
            SELECT u.id as "id!: SbUserId", u.email_verified,
                EXISTS (
                    SELECT 1 FROM user_restrictions r
                    WHERE r.user_id = u.id AND r.kind = 'map_publishing'::restriction_kind
                        AND r.start_time <= now() AND r.end_time > now()
                ) as "restricted!"
            FROM users u
            WHERE u.id = ANY($1)
        "#,
        &ids,
    )
    .fetch_all(db)
    .await
    .wrap_err("Failed to load tag editors")?;
    Ok(rows
        .into_iter()
        .map(|row| {
            (
                row.id,
                EditorState {
                    email_verified: row.email_verified,
                    restricted: row.restricted,
                },
            )
        })
        .collect())
}

async fn load_editor(conn: &mut PgConnection, user: SbUserId) -> eyre::Result<EditorState> {
    sqlx::query_as!(
        EditorState,
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
    .wrap_err("Failed to load the tag editor")
}

/// Which source `user` edits a map's tags as, or why they can't: staff as `Staff`, the map's maker
/// as `Maker` (unless restricted from publishing, which suspends their maker powers), and anyone
/// else as `Player` while the map has no maker and they could publish maps. A player's edit also
/// needs the map to be listed, except when they set its tags by publishing its file (`at_publish`).
pub fn editor_source(
    staff: bool,
    owner_id: Option<SbUserId>,
    listed: bool,
    user: SbUserId,
    editor: &EditorState,
    at_publish: bool,
) -> Result<TagSource, TagError> {
    if staff {
        return Ok(TagSource::Staff);
    }
    if owner_id == Some(user) {
        return if editor.restricted {
            Err(TagError::Restricted)
        } else {
            Ok(TagSource::Maker)
        };
    }
    if owner_id.is_some() {
        Err(TagError::HasMaker)
    } else if editor.restricted {
        Err(TagError::Restricted)
    } else if !editor.email_verified {
        Err(TagError::EmailUnverified)
    } else if !listed && !at_publish {
        Err(TagError::NotListed)
    } else {
        Ok(TagSource::Player)
    }
}

/// The ids of `tags` (a map's tags that apply) that someone editing as `source` can't remove.
pub fn locked_tag_ids<'a>(
    tags: impl IntoIterator<Item = (&'a str, TagSource)>,
    source: TagSource,
) -> Vec<String> {
    tags.into_iter()
        .filter(|(_, set_by)| !source.outranks_or_equals(*set_by))
        .map(|(id, _)| id.to_string())
        .collect()
}

/// One of a map's tag rows.
#[derive(Debug, Clone, PartialEq, Eq)]
struct TagRow {
    tag_id: String,
    source: TagSource,
    /// Whether the tag is of the kind of the map's current file.
    applies: bool,
}

/// Every tag row of `family_id`, in list order.
async fn load_rows(conn: &mut PgConnection, family_id: Uuid) -> eyre::Result<Vec<TagRow>> {
    let rows = sqlx::query!(
        r#"
            SELECT t.tag_id, t.source, mt.kind = cur.kind as "applies!"
            FROM map_family_tags t
            INNER JOIN map_tags mt ON mt.id = t.tag_id
            INNER JOIN map_families f ON f.id = t.family_id
            INNER JOIN maps cur ON cur.id = f.current_map_id
            WHERE t.family_id = $1
            ORDER BY mt.position
        "#,
        family_id,
    )
    .fetch_all(&mut *conn)
    .await
    .wrap_err("Failed to load the map's tags")?;
    Ok(rows
        .into_iter()
        .map(|row| TagRow {
            tag_id: row.tag_id,
            source: TagSource::from_db(&row.source),
            applies: row.applies,
        })
        .collect())
}

/// What a tag edit changes.
#[derive(Debug, Clone, PartialEq, Eq)]
struct TagPlan {
    /// The map's tags before the edit, in list order.
    before: Vec<String>,
    /// The map's tags after the edit, in list order.
    after: Vec<String>,
    /// The rows to delete: tags taken off, and tags of the other kind.
    remove: Vec<String>,
    /// The tags to add.
    add: Vec<String>,
}

/// Plans making `requested` (in list order) the tags of a map with tag rows `rows`, edited as
/// `source`. `None` when the tags that apply are already `requested`. Refuses the whole edit when it
/// removes a tag set by a higher source. Tags that stay keep their rows as they are.
fn plan(
    rows: &[TagRow],
    requested: &[TagDef],
    source: TagSource,
) -> Result<Option<TagPlan>, TagError> {
    let before: Vec<String> = rows
        .iter()
        .filter(|r| r.applies)
        .map(|r| r.tag_id.clone())
        .collect();
    let after: Vec<String> = requested.iter().map(|d| d.id.clone()).collect();
    if before == after {
        return Ok(None);
    }
    let mut remove = Vec::new();
    for row in rows {
        if row.applies && after.contains(&row.tag_id) {
            continue;
        }
        if row.applies && !source.outranks_or_equals(row.source) {
            return Err(TagError::Locked(row.tag_id.clone()));
        }
        remove.push(row.tag_id.clone());
    }
    let add = after
        .iter()
        .filter(|id| !before.contains(id))
        .cloned()
        .collect();
    Ok(Some(TagPlan {
        before,
        after,
        remove,
        add,
    }))
}

/// Applies `plan` to `family_id` as `actor`, editing as `source`, and records it.
async fn write(
    tx: &mut Transaction<'_, Postgres>,
    family_id: Uuid,
    plan: TagPlan,
    source: TagSource,
    actor: SbUserId,
    from_publish: bool,
) -> eyre::Result<()> {
    sqlx::query!(
        "DELETE FROM map_family_tags WHERE family_id = $1 AND tag_id = ANY($2)",
        family_id,
        &plan.remove,
    )
    .execute(&mut **tx)
    .await
    .wrap_err("Failed to remove the map's tags")?;
    sqlx::query!(
        r#"
            INSERT INTO map_family_tags (family_id, tag_id, source, set_by)
            SELECT $1, tag_id, $3, $4 FROM unnest($2::text[]) AS t(tag_id)
        "#,
        family_id,
        &plan.add,
        source.as_str(),
        actor as _,
    )
    .execute(&mut **tx)
    .await
    .wrap_err("Failed to add the map's tags")?;
    sqlx::query!(
        "UPDATE map_families SET tags_edited_at = now(), updated_at = now() WHERE id = $1",
        family_id,
    )
    .execute(&mut **tx)
    .await
    .wrap_err("Failed to mark the map's tags edited")?;
    history::record(
        tx,
        HistoryEntry {
            kind: MapFamilyHistoryKind::SetTags,
            actor,
            family_id,
            other_family_id: None,
            map_id: None,
            details: HistoryDetails {
                tags: Some(Change {
                    before: plan.before,
                    after: plan.after,
                }),
                tag_source: Some(source),
                from_publish,
                ..Default::default()
            },
        },
    )
    .await?;
    Ok(())
}

/// A map as a tag edit reads it.
struct FamilyTagState {
    family_id: Uuid,
    owner_id: Option<SbUserId>,
    listed: bool,
    /// The kind of the map's current file.
    kind: String,
}

/// The map `file_id` is in, as a tag edit reads it.
async fn load_family_of_file(
    conn: &mut PgConnection,
    file_id: SbMapId,
) -> Result<FamilyTagState, TagError> {
    sqlx::query_as!(
        FamilyTagState,
        r#"
            SELECT f.id as family_id, f.owner_id as "owner_id: SbUserId", f.listed,
                cur.kind
            FROM maps m
            INNER JOIN map_families f ON f.id = m.family_id
            INNER JOIN maps cur ON cur.id = f.current_map_id
            WHERE m.id = $1
        "#,
        file_id as _,
    )
    .fetch_optional(&mut *conn)
    .await
    .wrap_err("Failed to load the map")?
    .ok_or(TagError::FamilyNotFound)
}

/// How many tag edits `user` made as a player in the last hour, not counting ones made by
/// publishing a file.
async fn recent_player_edits(conn: &mut PgConnection, user: SbUserId) -> eyre::Result<i64> {
    sqlx::query_scalar!(
        r#"
            SELECT count(*) as "count!"
            FROM map_family_history
            WHERE actor = $1 AND kind = 'set_tags' AND created_at > now() - interval '1 hour'
                AND details->>'tagSource' = 'player'
                AND NOT COALESCE((details->>'fromPublish')::boolean, false)
        "#,
        user as _,
    )
    .fetch_one(&mut *conn)
    .await
    .wrap_err("Failed to count recent tag edits")
}

/// Makes `tags` the tags of the map `file_id` is in, as `actor`, who is staff if `staff`. Returns
/// the map's id. A set equal to the map's current tags changes nothing.
pub async fn set_tags(
    db: &PgPool,
    file_id: SbMapId,
    tags: &[String],
    actor: SbUserId,
    staff: bool,
) -> Result<Uuid, TagError> {
    check_shape(tags)?;
    let mut tx = db.begin().await.wrap_err("Failed to start transaction")?;
    lock_families(&mut tx).await?;
    let family = load_family_of_file(&mut tx, file_id).await?;
    let editor = if staff {
        STAFF_EDITOR
    } else {
        load_editor(&mut tx, actor).await?
    };
    let source = editor_source(staff, family.owner_id, family.listed, actor, &editor, false)?;
    let requested = resolve_requested(&mut tx, tags, &family.kind).await?;
    let rows = load_rows(&mut tx, family.family_id).await?;
    let Some(plan) = plan(&rows, &requested, source)? else {
        return Ok(family.family_id);
    };
    if source == TagSource::Player
        && recent_player_edits(&mut tx, actor).await? >= MAX_PLAYER_TAG_EDITS_PER_HOUR
    {
        return Err(TagError::RateLimited);
    }
    write(&mut tx, family.family_id, plan, source, actor, false).await?;
    tx.commit().await.wrap_err("Failed to commit tag edit")?;
    Ok(family.family_id)
}

/// Checks that `actor`, who is staff if `staff`, may make `requested` the tags of `family_id` by
/// publishing its only file, and returns the source they'd set them as. Must be called under the
/// families lock, before publishing changes anything.
pub(crate) async fn check_at_publish(
    tx: &mut Transaction<'_, Postgres>,
    family_id: Uuid,
    requested: &[TagDef],
    actor: SbUserId,
    staff: bool,
) -> Result<TagSource, TagError> {
    let owner_id = sqlx::query_scalar!(
        r#"SELECT owner_id as "owner_id: SbUserId" FROM map_families WHERE id = $1"#,
        family_id,
    )
    .fetch_optional(&mut **tx)
    .await
    .wrap_err("Failed to load the map's maker")?
    .ok_or(TagError::FamilyNotFound)?;
    let editor = if staff {
        STAFF_EDITOR
    } else {
        load_editor(tx, actor).await?
    };
    let source = editor_source(staff, owner_id, false, actor, &editor, true)?;
    // Derived rows never lock anything, so refreshing them before applying can't change this
    plan(&load_rows(tx, family_id).await?, requested, source)?;
    Ok(source)
}

/// Makes `requested` the tags of `family_id` on behalf of `actor` publishing its only file, editing
/// as `source` (from [`check_at_publish`]). Its derived tags are brought up to date first, so a set
/// matching them changes nothing.
pub(crate) async fn apply_at_publish(
    tx: &mut Transaction<'_, Postgres>,
    family_id: Uuid,
    requested: &[TagDef],
    source: TagSource,
    actor: SbUserId,
) -> Result<(), TagError> {
    sqlx::query!(
        "SELECT refresh_map_family_derived_tags(ARRAY[$1]::uuid[])",
        family_id,
    )
    .execute(&mut **tx)
    .await
    .wrap_err("Failed to refresh the map's derived tags")?;
    let rows = load_rows(tx, family_id).await?;
    if let Some(plan) = plan(&rows, requested, source)? {
        write(tx, family_id, plan, source, actor, true).await?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    const ME: SbUserId = SbUserId(1);
    const SOMEONE: SbUserId = SbUserId(2);
    const ABLE: EditorState = EditorState {
        email_verified: true,
        restricted: false,
    };

    fn def(id: &str, position: i32) -> TagDef {
        TagDef {
            id: id.into(),
            kind: "ums".into(),
            position,
        }
    }

    fn row(id: &str, source: TagSource) -> TagRow {
        TagRow {
            tag_id: id.into(),
            source,
            applies: true,
        }
    }

    #[test]
    fn sources_round_trip_and_rank() {
        for source in [
            TagSource::Derived,
            TagSource::Player,
            TagSource::Maker,
            TagSource::Staff,
        ] {
            assert_eq!(TagSource::from_db(source.as_str()), source);
            assert!(source.outranks_or_equals(source));
            assert!(source.outranks_or_equals(TagSource::Derived));
            assert!(TagSource::Staff.outranks_or_equals(source));
        }
        assert!(!TagSource::Player.outranks_or_equals(TagSource::Maker));
        assert!(!TagSource::Maker.outranks_or_equals(TagSource::Staff));
    }

    #[test]
    fn who_edits_as_what() {
        let source = |staff, owner, listed, editor: EditorState, at_publish| {
            editor_source(staff, owner, listed, ME, &editor, at_publish)
        };
        assert!(matches!(
            source(true, Some(SOMEONE), false, ABLE, false),
            Ok(TagSource::Staff)
        ));
        assert!(matches!(
            source(false, Some(ME), false, ABLE, false),
            Ok(TagSource::Maker)
        ));
        assert!(matches!(
            source(false, None, true, ABLE, false),
            Ok(TagSource::Player)
        ));
        assert!(matches!(
            source(false, None, false, ABLE, true),
            Ok(TagSource::Player)
        ));

        let restricted = EditorState {
            restricted: true,
            ..ABLE
        };
        let unverified = EditorState {
            email_verified: false,
            ..ABLE
        };
        assert!(matches!(
            source(false, Some(ME), true, restricted, false),
            Err(TagError::Restricted)
        ));
        // A maker needn't have verified their email, as for their other maker powers
        assert!(matches!(
            source(false, Some(ME), true, unverified, false),
            Ok(TagSource::Maker)
        ));
        assert!(matches!(
            source(false, Some(SOMEONE), true, ABLE, false),
            Err(TagError::HasMaker)
        ));
        assert!(matches!(
            source(false, None, true, restricted, false),
            Err(TagError::Restricted)
        ));
        assert!(matches!(
            source(false, None, true, unverified, false),
            Err(TagError::EmailUnverified)
        ));
        assert!(matches!(
            source(false, None, false, ABLE, false),
            Err(TagError::NotListed)
        ));
    }

    #[test]
    fn repeats_and_too_many_are_refused() {
        let tags = |ids: &[&str]| ids.iter().map(|s| s.to_string()).collect::<Vec<_>>();
        assert!(check_shape(&tags(&[])).is_ok());
        assert!(check_shape(&tags(&["a", "b", "c"])).is_ok());
        assert!(
            matches!(check_shape(&tags(&["a", "b", "a"])), Err(TagError::Repeated(t)) if t == "a")
        );
        assert!(matches!(
            check_shape(&tags(&["a", "b", "c", "d"])),
            Err(TagError::TooMany)
        ));
    }

    #[test]
    fn the_same_set_changes_nothing() {
        let rows = [
            row("defense", TagSource::Staff),
            row("co-op", TagSource::Derived),
        ];
        let requested = [def("defense", 4), def("co-op", 8)];
        assert_eq!(plan(&rows, &requested, TagSource::Player).unwrap(), None);
        // Tags of the other kind don't count, and aren't removed by a no-op
        let mut with_other = rows.to_vec();
        with_other.push(TagRow {
            applies: false,
            ..row("money", TagSource::Staff)
        });
        assert_eq!(
            plan(&with_other, &requested, TagSource::Player).unwrap(),
            None
        );
    }

    #[test]
    fn removing_a_tag_needs_an_equal_or_higher_source() {
        let cases = [
            (TagSource::Player, TagSource::Maker, false),
            (TagSource::Player, TagSource::Staff, false),
            (TagSource::Maker, TagSource::Staff, false),
            (TagSource::Player, TagSource::Player, true),
            (TagSource::Player, TagSource::Derived, true),
            (TagSource::Maker, TagSource::Derived, true),
            (TagSource::Maker, TagSource::Player, true),
            (TagSource::Staff, TagSource::Staff, true),
            (TagSource::Staff, TagSource::Maker, true),
        ];
        for (editor, set_by, allowed) in cases {
            let rows = [row("bound", set_by), row("micro", TagSource::Staff)];
            // `micro` stays, so its rank never matters
            let result = plan(&rows, &[def("micro", 10)], editor);
            if allowed {
                let plan = result.unwrap().unwrap();
                assert_eq!(
                    plan.remove,
                    vec!["bound".to_string()],
                    "{editor:?} {set_by:?}"
                );
                assert!(plan.add.is_empty());
            } else {
                assert!(
                    matches!(result, Err(TagError::Locked(ref t)) if t == "bound"),
                    "{editor:?} {set_by:?}"
                );
            }
        }
    }

    #[test]
    fn an_edit_adds_new_tags_and_drops_tags_of_the_other_kind() {
        let rows = [
            row("defense", TagSource::Maker),
            TagRow {
                applies: false,
                ..row("money", TagSource::Staff)
            },
        ];
        let plan = plan(
            &rows,
            &[def("defense", 4), def("rpg", 6)],
            TagSource::Player,
        )
        .unwrap()
        .unwrap();
        assert_eq!(plan.before, vec!["defense".to_string()]);
        assert_eq!(plan.after, vec!["defense".to_string(), "rpg".to_string()]);
        assert_eq!(plan.add, vec!["rpg".to_string()]);
        assert_eq!(plan.remove, vec!["money".to_string()]);
    }

    #[test]
    fn locked_tags_are_the_ones_a_higher_source_set() {
        let tags = [
            ("rich-minerals", TagSource::Derived),
            ("team", TagSource::Player),
            ("island", TagSource::Maker),
            ("money", TagSource::Staff),
        ];
        assert_eq!(
            locked_tag_ids(tags, TagSource::Player),
            vec!["island", "money"]
        );
        assert_eq!(locked_tag_ids(tags, TagSource::Maker), vec!["money"]);
        assert!(locked_tag_ids(tags, TagSource::Staff).is_empty());
    }
}
