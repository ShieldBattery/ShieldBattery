//! The list of map tags (`map_tags`), which staff manage: creating, renaming, translating, ordering
//! and deleting tags. What a map's tags are, and who may set them, is [`super::tags`].
//!
//! A tag's id is made from its English name when it's created and never changes, so links and
//! history keep working after a rename; its kind never changes either. Names are unique, and tags
//! ordered, within each kind. Deleting a tag takes it off every map without recording it in their
//! history.

use std::collections::{BTreeMap, HashSet};

use color_eyre::eyre::{self, WrapErr};
use sqlx::types::Json;
use sqlx::{PgExecutor, PgPool, Postgres, Transaction};

/// The most characters a tag name can have, in any language.
pub const MAX_TAG_NAME_CHARS: usize = 24;
/// The most characters a tag id can have.
pub const MAX_TAG_ID_CHARS: usize = 32;
/// The most names in other languages a tag can be given.
pub const MAX_TAG_NAMES: usize = 20;

#[derive(Debug, thiserror::Error)]
pub enum TagListError {
    #[error("map tag not found")]
    NotFound,
    #[error("a tag name must be 1 to {MAX_TAG_NAME_CHARS} characters, without control characters")]
    BadName,
    #[error("a tag's English name must have a letter from a to z or a digit")]
    NoIdInName,
    #[error("another tag of this kind is already called \"{0}\"")]
    NameTaken(String),
    #[error("\"{0}\" isn't a locale code")]
    BadLocale(String),
    #[error("a tag's English name is its `name`")]
    EnglishLocale,
    #[error("the locale \"{0}\" is given more than once")]
    RepeatedLocale(String),
    #[error("a tag can have at most {MAX_TAG_NAMES} names in other languages")]
    TooManyNames,
    #[error("the order must list every tag of the kind exactly once")]
    BadOrder,
    #[error(transparent)]
    Other(#[from] eyre::Report),
}

impl From<sqlx::Error> for TagListError {
    fn from(error: sqlx::Error) -> Self {
        Self::Other(error.into())
    }
}

impl TagListError {
    /// The GraphQL error code for this error. `None` for unexpected failures.
    pub fn code(&self) -> Option<&'static str> {
        Some(match self {
            Self::NotFound => "NOT_FOUND",
            Self::BadName
            | Self::NoIdInName
            | Self::BadLocale(_)
            | Self::EnglishLocale
            | Self::RepeatedLocale(_)
            | Self::TooManyNames
            | Self::BadOrder => "BAD_REQUEST",
            Self::NameTaken(_) => "NAME_TAKEN",
            Self::Other(_) => return None,
        })
    }
}

/// A tag of the list.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TagRecord {
    pub id: String,
    /// `melee` or `ums`, as `maps.kind`.
    pub kind: String,
    /// The English name.
    pub name: String,
    /// The names in other languages, by locale code.
    pub names: BTreeMap<String, String>,
}

/// A `map_tags` row as the queries here return it.
struct TagRow {
    id: String,
    kind: String,
    name: String,
    names: Json<BTreeMap<String, String>>,
}

impl From<TagRow> for TagRecord {
    fn from(row: TagRow) -> Self {
        Self {
            id: row.id,
            kind: row.kind,
            name: row.name,
            names: row.names.0,
        }
    }
}

/// Every tag, in list order: melee tags first, then UMS tags, each in their kind's order.
pub async fn load_tag_list<'e>(db: impl PgExecutor<'e>) -> eyre::Result<Vec<TagRecord>> {
    let rows = sqlx::query_as!(
        TagRow,
        r#"
            SELECT id, kind, name, names as "names: Json<BTreeMap<String, String>>"
            FROM map_tags
            ORDER BY CASE kind WHEN 'melee' THEN 0 ELSE 1 END, position
        "#,
    )
    .fetch_all(db)
    .await
    .wrap_err("Failed to load map tags")?;
    Ok(rows.into_iter().map(TagRecord::from).collect())
}

/// Which of `ids` name a tag.
pub async fn existing_tag_ids(db: &PgPool, ids: &[String]) -> eyre::Result<HashSet<String>> {
    if ids.is_empty() {
        return Ok(HashSet::new());
    }
    Ok(
        sqlx::query_scalar!("SELECT id FROM map_tags WHERE id = ANY($1)", ids)
            .fetch_all(db)
            .await
            .wrap_err("Failed to look up map tags")?
            .into_iter()
            .collect(),
    )
}

/// A tag name trimmed, after checking it's 1 to [`MAX_TAG_NAME_CHARS`] characters without control
/// characters.
fn clean_name(name: &str) -> Result<String, TagListError> {
    let name = name.trim();
    let chars = name.chars().count();
    if chars == 0 || chars > MAX_TAG_NAME_CHARS || name.chars().any(char::is_control) {
        return Err(TagListError::BadName);
    }
    Ok(name.to_string())
}

/// Whether `locale` looks like a language tag: a 2 or 3 letter language, then any number of
/// `-`-separated parts of 2 to 8 letters and digits (e.g. `ko`, `zh-Hans`).
fn is_locale_code(locale: &str) -> bool {
    let mut parts = locale.split('-');
    let Some(language) = parts.next() else {
        return false;
    };
    (2..=3).contains(&language.len())
        && language.chars().all(|c| c.is_ascii_alphabetic())
        && parts.all(|part| {
            (2..=8).contains(&part.len()) && part.chars().all(|c| c.is_ascii_alphanumeric())
        })
}

/// Names in other languages, as given as (locale code, name) pairs, checked and cleaned: the names
/// trimmed, and the ones left empty dropped. Locale codes compare ignoring case, and English (`en`)
/// can't be given, since it's the tag's own name.
fn clean_names(
    names: impl IntoIterator<Item = (String, String)>,
) -> Result<BTreeMap<String, String>, TagListError> {
    let names: Vec<(String, String)> = names.into_iter().collect();
    if names.len() > MAX_TAG_NAMES {
        return Err(TagListError::TooManyNames);
    }
    let mut seen = HashSet::new();
    let mut cleaned = BTreeMap::new();
    for (locale, name) in names {
        if !is_locale_code(&locale) {
            return Err(TagListError::BadLocale(locale));
        }
        if locale.eq_ignore_ascii_case("en") {
            return Err(TagListError::EnglishLocale);
        }
        if !seen.insert(locale.to_ascii_lowercase()) {
            return Err(TagListError::RepeatedLocale(locale));
        }
        if name.trim().is_empty() {
            continue;
        }
        cleaned.insert(locale, clean_name(&name)?);
    }
    Ok(cleaned)
}

/// The id a tag named `name` would get if no tag had it: lowercase, every run of characters other
/// than `a`-`z` and `0`-`9` turned into one `-`, without `-` at either end, and at most
/// [`MAX_TAG_ID_CHARS`] characters. Empty when the name has none of those characters.
fn slug(name: &str) -> String {
    let mut slug = String::with_capacity(name.len());
    let mut pending_dash = false;
    for c in name.chars().map(|c| c.to_ascii_lowercase()) {
        if c.is_ascii_lowercase() || c.is_ascii_digit() {
            if pending_dash && !slug.is_empty() {
                slug.push('-');
            }
            pending_dash = false;
            slug.push(c);
        } else {
            pending_dash = true;
        }
    }
    cut_id(&slug, MAX_TAG_ID_CHARS).to_string()
}

/// `id` cut to at most `max` characters, without a `-` left at its end. `id` must be ASCII.
fn cut_id(id: &str, max: usize) -> &str {
    id[..id.len().min(max)].trim_end_matches('-')
}

/// The id for a tag whose name slugs to `base` (not empty): `base` itself when no tag in `taken`
/// has it, otherwise the first of `base-2`, `base-3`, ... that's free, with `base` cut short where
/// the suffix wouldn't fit.
fn pick_id(base: &str, taken: &HashSet<String>) -> String {
    if !taken.contains(base) {
        return base.to_string();
    }
    (2..)
        .map(|n| {
            let suffix = format!("-{n}");
            format!("{}{suffix}", cut_id(base, MAX_TAG_ID_CHARS - suffix.len()))
        })
        .find(|id| !taken.contains(id))
        .expect("there's always a free suffix")
}

/// Checks that `order` lists each of `ids` exactly once.
fn check_order(ids: &[String], order: &[String]) -> Result<(), TagListError> {
    let given: HashSet<&String> = order.iter().collect();
    if order.len() != ids.len()
        || given.len() != order.len()
        || !ids.iter().all(|id| given.contains(id))
    {
        return Err(TagListError::BadOrder);
    }
    Ok(())
}

/// Takes the lock every change to the tag list holds until it commits, so they happen one at a
/// time: a new tag's id and position, and the check that a name is free, rely on it. Reading tags
/// and setting maps' tags don't wait for it.
async fn lock_tag_list(tx: &mut Transaction<'_, Postgres>) -> eyre::Result<()> {
    sqlx::query("LOCK TABLE map_tags IN SHARE ROW EXCLUSIVE MODE")
        .execute(&mut **tx)
        .await
        .wrap_err("Failed to lock the map tag list")?;
    Ok(())
}

/// Fails with [`TagListError::NameTaken`] if a tag of `kind` other than `except` is called `name`,
/// ignoring case.
async fn check_name_free(
    tx: &mut Transaction<'_, Postgres>,
    name: &str,
    kind: &str,
    except: Option<&str>,
) -> Result<(), TagListError> {
    let taken = sqlx::query_scalar!(
        r#"
            SELECT EXISTS (
                SELECT 1 FROM map_tags
                WHERE kind = $2 AND lower(name) = lower($1) AND id IS DISTINCT FROM $3
            ) as "taken!"
        "#,
        name,
        kind,
        except,
    )
    .fetch_one(&mut **tx)
    .await
    .wrap_err("Failed to check the tag name")?;
    if taken {
        Err(TagListError::NameTaken(name.to_string()))
    } else {
        Ok(())
    }
}

/// Adds a tag of `kind` (`melee` or `ums`) at the end of its kind's tags, with the English name
/// `name` and the names in other languages `names` (locale code, name).
pub async fn create(
    db: &PgPool,
    name: &str,
    kind: &str,
    names: impl IntoIterator<Item = (String, String)>,
) -> Result<TagRecord, TagListError> {
    let name = clean_name(name)?;
    let names = clean_names(names)?;
    let base = slug(&name);
    if base.is_empty() {
        return Err(TagListError::NoIdInName);
    }
    let mut tx = db.begin().await.wrap_err("Failed to start transaction")?;
    lock_tag_list(&mut tx).await?;
    check_name_free(&mut tx, &name, kind, None).await?;
    let taken: HashSet<String> = sqlx::query_scalar!("SELECT id FROM map_tags")
        .fetch_all(&mut *tx)
        .await
        .wrap_err("Failed to load the tag ids")?
        .into_iter()
        .collect();
    let id = pick_id(&base, &taken);
    let tag = sqlx::query_as!(
        TagRow,
        r#"
            INSERT INTO map_tags (id, kind, position, name, names)
            SELECT $1, $2, COALESCE(max(position) + 1, 0), $3, $4
            FROM map_tags
            WHERE kind = $2
            RETURNING id, kind, name, names as "names: Json<BTreeMap<String, String>>"
        "#,
        id,
        kind,
        name,
        Json(&names) as _,
    )
    .fetch_one(&mut *tx)
    .await
    .wrap_err("Failed to create the tag")?;
    tx.commit().await.wrap_err("Failed to commit the new tag")?;
    Ok(tag.into())
}

/// Changes the tag `id`: `name`, when given, becomes its English name, and `names`, when given,
/// replaces all its names in other languages (locale code, name).
pub async fn update(
    db: &PgPool,
    id: &str,
    name: Option<&str>,
    names: Option<Vec<(String, String)>>,
) -> Result<TagRecord, TagListError> {
    let name = name.map(clean_name).transpose()?;
    let names = names.map(clean_names).transpose()?;
    let mut tx = db.begin().await.wrap_err("Failed to start transaction")?;
    lock_tag_list(&mut tx).await?;
    let kind = sqlx::query_scalar!("SELECT kind FROM map_tags WHERE id = $1", id)
        .fetch_optional(&mut *tx)
        .await
        .wrap_err("Failed to look up the tag")?
        .ok_or(TagListError::NotFound)?;
    if let Some(name) = &name {
        check_name_free(&mut tx, name, &kind, Some(id)).await?;
    }
    let tag = sqlx::query_as!(
        TagRow,
        r#"
            UPDATE map_tags
            SET name = COALESCE($2, name), names = COALESCE($3, names), updated_at = now()
            WHERE id = $1
            RETURNING id, kind, name, names as "names: Json<BTreeMap<String, String>>"
        "#,
        id,
        name,
        names.as_ref().map(Json) as _,
    )
    .fetch_one(&mut *tx)
    .await
    .wrap_err("Failed to update the tag")?;
    tx.commit()
        .await
        .wrap_err("Failed to commit the tag update")?;
    Ok(tag.into())
}

/// Puts the tags of `kind` in the order of `order`, which must list every tag of that kind exactly
/// once. The other kind's order is kept. Returns the whole list in its new order.
pub async fn set_order(
    db: &PgPool,
    kind: &str,
    order: &[String],
) -> Result<Vec<TagRecord>, TagListError> {
    let mut tx = db.begin().await.wrap_err("Failed to start transaction")?;
    lock_tag_list(&mut tx).await?;
    let ids = sqlx::query_scalar!("SELECT id FROM map_tags WHERE kind = $1", kind)
        .fetch_all(&mut *tx)
        .await
        .wrap_err("Failed to load the tag ids")?;
    check_order(&ids, order)?;
    sqlx::query!(
        r#"
            UPDATE map_tags t
            SET position = v.position, updated_at = now()
            FROM (
                SELECT id, (ord - 1)::integer AS position
                FROM unnest($1::text[]) WITH ORDINALITY AS o(id, ord)
            ) v
            WHERE t.id = v.id AND t.position <> v.position
        "#,
        order,
    )
    .execute(&mut *tx)
    .await
    .wrap_err("Failed to reorder the tags")?;
    let list = load_tag_list(&mut *tx).await?;
    tx.commit()
        .await
        .wrap_err("Failed to commit the tag order")?;
    Ok(list)
}

/// Deletes the tag `id`, taking it off every map.
pub async fn delete(db: &PgPool, id: &str) -> Result<(), TagListError> {
    let mut tx = db.begin().await.wrap_err("Failed to start transaction")?;
    lock_tag_list(&mut tx).await?;
    let deleted = sqlx::query!("DELETE FROM map_tags WHERE id = $1", id)
        .execute(&mut *tx)
        .await
        .wrap_err("Failed to delete the tag")?
        .rows_affected();
    if deleted == 0 {
        return Err(TagListError::NotFound);
    }
    tx.commit()
        .await
        .wrap_err("Failed to commit the tag deletion")?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn pairs(names: &[(&str, &str)]) -> Vec<(String, String)> {
        names
            .iter()
            .map(|(l, n)| (l.to_string(), n.to_string()))
            .collect()
    }

    #[test]
    fn slugs() {
        assert_eq!(slug("Defense"), "defense");
        assert_eq!(slug("Cat and Mouse"), "cat-and-mouse");
        assert_eq!(slug("  Co-op!  "), "co-op");
        assert_eq!(slug("--Tug   of__War--"), "tug-of-war");
        assert_eq!(slug("RPG 2"), "rpg-2");
        assert_eq!(slug("Défense"), "d-fense");
        assert_eq!(slug("방어"), "");
        assert_eq!(slug("!!!"), "");
        assert_eq!(slug(&"a".repeat(40)), "a".repeat(32));
        // A cut landing after a dash doesn't leave it at the end
        assert_eq!(
            slug(&format!("{} b", "a".repeat(31))),
            "a".repeat(31),
            "cut after the dash"
        );
    }

    #[test]
    fn taken_ids_get_a_suffix() {
        let taken = |ids: &[&str]| ids.iter().map(|s| s.to_string()).collect::<HashSet<_>>();
        assert_eq!(pick_id("team", &taken(&["money"])), "team");
        assert_eq!(pick_id("team", &taken(&["team"])), "team-2");
        assert_eq!(pick_id("team", &taken(&["team", "team-2"])), "team-3");
        assert_eq!(pick_id("team", &taken(&["team", "team-3"])), "team-2");
        let long = "a".repeat(32);
        let id = pick_id(&long, &taken(&[&long]));
        assert_eq!(id, format!("{}-2", "a".repeat(30)));
        assert_eq!(id.len(), MAX_TAG_ID_CHARS);
        // Cutting for the suffix doesn't leave a dash before it
        let dashed = format!("{}-bb", "a".repeat(29));
        assert_eq!(
            pick_id(&dashed, &taken(&[&dashed])),
            format!("{}-2", "a".repeat(29))
        );
    }

    #[test]
    fn names_are_trimmed_and_checked() {
        assert_eq!(clean_name("  Tower Defense ").unwrap(), "Tower Defense");
        assert_eq!(clean_name(&"x".repeat(24)).unwrap(), "x".repeat(24));
        assert_eq!(clean_name(&"방".repeat(24)).unwrap(), "방".repeat(24));
        for bad in ["", "   ", "a\nb", "tab\there", "\u{7f}x"] {
            assert!(
                matches!(clean_name(bad), Err(TagListError::BadName)),
                "{bad:?}"
            );
        }
        assert!(matches!(
            clean_name(&"x".repeat(25)),
            Err(TagListError::BadName)
        ));
    }

    #[test]
    fn locale_codes() {
        for good in [
            "es",
            "ko",
            "zh-Hans",
            "pt-BR",
            "fil",
            "sr-Latn-RS",
            "de-1996",
        ] {
            assert!(is_locale_code(good), "{good}");
        }
        for bad in [
            "",
            "e",
            "espa",
            "zh-",
            "-zh",
            "zh_Hans",
            "zh-H",
            "zh-abcdefghi",
            "e1",
            "es ",
            "日本",
        ] {
            assert!(!is_locale_code(bad), "{bad:?}");
        }
    }

    #[test]
    fn other_language_names() {
        let names = clean_names(pairs(&[
            ("zh-Hans", " 标准 "),
            ("es", "Estándar"),
            ("ru", "   "),
        ]))
        .unwrap();
        assert_eq!(
            names.into_iter().collect::<Vec<_>>(),
            pairs(&[("es", "Estándar"), ("zh-Hans", "标准")]),
            "trimmed, empty ones dropped, in locale order"
        );
        assert!(clean_names(Vec::new()).unwrap().is_empty());

        assert!(matches!(
            clean_names(pairs(&[("en", "Standard")])),
            Err(TagListError::EnglishLocale)
        ));
        assert!(matches!(
            clean_names(pairs(&[("EN", "Standard")])),
            Err(TagListError::EnglishLocale)
        ));
        assert!(matches!(
            clean_names(pairs(&[("es_ES", "Estándar")])),
            Err(TagListError::BadLocale(l)) if l == "es_ES"
        ));
        assert!(matches!(
            clean_names(pairs(&[("es", "Uno"), ("ES", "")])),
            Err(TagListError::RepeatedLocale(l)) if l == "ES"
        ));
        assert!(matches!(
            clean_names(pairs(&[("es", &"x".repeat(25))])),
            Err(TagListError::BadName)
        ));
        let many: Vec<(String, String)> = (0..=MAX_TAG_NAMES)
            .map(|i| (format!("x{}", (b'a' + i as u8) as char), "Name".to_string()))
            .collect();
        assert!(matches!(
            clean_names(many[..MAX_TAG_NAMES].to_vec()),
            Ok(n) if n.len() == MAX_TAG_NAMES
        ));
        assert!(matches!(clean_names(many), Err(TagListError::TooManyNames)));
    }

    #[test]
    fn an_order_lists_every_tag_once() {
        let ids = pairs(&[("a", ""), ("b", ""), ("c", "")])
            .into_iter()
            .map(|(id, _)| id)
            .collect::<Vec<_>>();
        let order = |o: &[&str]| o.iter().map(|s| s.to_string()).collect::<Vec<_>>();
        assert!(check_order(&ids, &order(&["c", "a", "b"])).is_ok());
        for bad in [
            &["a", "b"][..],
            &["a", "b", "c", "d"],
            &["a", "b", "b"],
            &["a", "b", "d"],
            &[],
        ] {
            assert!(
                matches!(check_order(&ids, &order(bad)), Err(TagListError::BadOrder)),
                "{bad:?}"
            );
        }
    }
}
