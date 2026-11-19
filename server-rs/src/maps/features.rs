//! The weekly feature slots: Discover shows one kind of maps at a time, so each week has a slot per
//! kind of map ([`MapKind`]), and staff pick one map or collection per slot to lead that kind's
//! Discover page. A week runs from Monday 00:00 UTC to the next Monday, so two picks of a slot can
//! never overlap.
//!
//! A map is picked for the slot of its current file's kind. A collection can go in either slot, or
//! both.
//!
//! A pick is only shown while everyone can see what it points at and it still belongs in its slot:
//! a listed map whose current file is of the slot's kind, or a collection everyone can read
//! ([`CollectionRow::is_public`]). A slot whose pick isn't shown counts as having none, and an
//! automatic pick stands in for it (see [`automatic_pick`]).

use std::collections::{HashMap, HashSet};

use chrono::{DateTime, Datelike, Days, NaiveDate, NaiveTime, Utc, Weekday};
use color_eyre::eyre::{self, WrapErr};
use sqlx::{FromRow, PgPool, Postgres, QueryBuilder, Transaction};
use uuid::Uuid;

use crate::maps::SbMapId;
use crate::maps::catalog::MapKind;
use crate::maps::collections::{COLLECTION_COLUMNS, CollectionRow, Viewer};
use crate::maps::families::lock_families;
use crate::maps::search::{FAMILY_STATS_JOINS, family_stat};
use crate::users::SbUserId;

/// The trending score from which a map counts as rising, and the least an automatic pick needs.
pub const RISING_TRENDING_SCORE: i32 = 200;
/// How many weeks after the current one a pick can be made for.
pub const MAX_WEEKS_AHEAD: u64 = 26;
/// How many weeks, the current one included, a staff pick keeps its map from being the automatic
/// pick.
pub const AUTOMATIC_COOLDOWN_WEEKS: u64 = 8;
/// The longest blurb a pick can carry, in characters, after trimming.
pub const MAX_BLURB_LENGTH: usize = 400;

/// The week (the Monday it starts) that `now` is in, in UTC.
pub fn week_of(now: DateTime<Utc>) -> NaiveDate {
    now.date_naive().week(Weekday::Mon).first_day()
}

/// The instant a week starts: its Monday at 00:00 UTC.
pub fn week_start(week: NaiveDate) -> DateTime<Utc> {
    week.and_time(NaiveTime::MIN).and_utc()
}

#[derive(Debug, thiserror::Error)]
pub enum FeatureError {
    #[error("a week is given as the instant it starts: a Monday at 00:00 UTC")]
    InvalidWeek,
    #[error("that week is already over")]
    WeekPassed,
    #[error("picks can be made at most {MAX_WEEKS_AHEAD} weeks ahead")]
    WeekTooFar,
    #[error("give exactly one of a map and a collection")]
    TargetRequired,
    #[error("a collection needs the kind of maps whose Discover page it leads")]
    KindRequired,
    #[error("a map can only be featured for the kind of its current file")]
    KindMismatch,
    #[error("the blurb must be one line of at most {MAX_BLURB_LENGTH} characters")]
    InvalidBlurb,
    #[error("map not found")]
    MapNotFound,
    #[error("collection not found")]
    CollectionNotFound,
    #[error("only a listed map can be featured")]
    NotListed,
    #[error("only a collection everyone can see can be featured")]
    NotPublic,
    #[error(transparent)]
    Other(#[from] eyre::Report),
}

impl From<sqlx::Error> for FeatureError {
    fn from(error: sqlx::Error) -> Self {
        Self::Other(error.into())
    }
}

impl FeatureError {
    /// The GraphQL error code for this error. `None` for unexpected failures.
    pub fn code(&self) -> Option<&'static str> {
        Some(match self {
            Self::InvalidWeek => "INVALID_WEEK",
            Self::WeekPassed => "WEEK_PASSED",
            Self::WeekTooFar => "WEEK_TOO_FAR",
            Self::TargetRequired | Self::KindRequired | Self::KindMismatch => "BAD_REQUEST",
            Self::InvalidBlurb => "INVALID_BLURB",
            Self::MapNotFound | Self::CollectionNotFound => "NOT_FOUND",
            Self::NotListed => "NOT_LISTED",
            Self::NotPublic => "NOT_PUBLIC",
            Self::Other(_) => return None,
        })
    }
}

/// The week starting at `start`, which must be a Monday at 00:00 UTC.
pub fn parse_week(start: DateTime<Utc>) -> Result<NaiveDate, FeatureError> {
    let week = start.date_naive();
    if start.time() != NaiveTime::MIN || week.weekday() != Weekday::Mon {
        return Err(FeatureError::InvalidWeek);
    }
    Ok(week)
}

/// Checks that a pick can be made for `week`: not before `this_week`, and at most
/// [`MAX_WEEKS_AHEAD`] weeks after it.
pub fn check_schedulable(week: NaiveDate, this_week: NaiveDate) -> Result<(), FeatureError> {
    if week < this_week {
        return Err(FeatureError::WeekPassed);
    }
    let last = this_week
        .checked_add_days(Days::new(7 * MAX_WEEKS_AHEAD))
        .unwrap_or(NaiveDate::MAX);
    if week > last {
        return Err(FeatureError::WeekTooFar);
    }
    Ok(())
}

/// Trims a blurb and checks it: plain text on one line, at most [`MAX_BLURB_LENGTH`] characters.
pub fn clean_blurb(blurb: Option<&str>) -> Result<String, FeatureError> {
    let blurb = blurb.unwrap_or_default().trim();
    if blurb.chars().count() > MAX_BLURB_LENGTH
        || blurb
            .chars()
            .any(|c| c.is_control() || c == '\u{2028}' || c == '\u{2029}')
    {
        return Err(FeatureError::InvalidBlurb);
    }
    Ok(blurb.to_string())
}

/// The slot a pick goes in. A map's slot is `map_kind`, the kind of its current file, and
/// `requested`, when given, must match it. A collection (`map_kind` `None`) goes in the slot staff
/// ask for, so `requested` is required.
pub fn pick_slot(
    map_kind: Option<MapKind>,
    requested: Option<MapKind>,
) -> Result<MapKind, FeatureError> {
    match (map_kind, requested) {
        (Some(kind), None) => Ok(kind),
        (Some(kind), Some(requested)) if kind == requested => Ok(kind),
        (Some(_), Some(_)) => Err(FeatureError::KindMismatch),
        (None, Some(requested)) => Ok(requested),
        (None, None) => Err(FeatureError::KindRequired),
    }
}

/// What a pick points at.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum FeatureTarget {
    /// The map a file is in.
    Map(SbMapId),
    Collection(Uuid),
}

/// A stored pick, with what decides whether it's shown.
#[derive(Debug, Clone, FromRow)]
pub struct FeatureRow {
    pub week: NaiveDate,
    /// The slot's kind, as a `maps.kind` value.
    pub kind: String,
    pub family_id: Option<Uuid>,
    pub collection_id: Option<Uuid>,
    pub blurb: String,
    pub created_by: SbUserId,
    /// The current file of the picked map.
    pub current_map_id: Option<SbMapId>,
    /// The kind of the picked map's current file.
    pub map_kind: Option<String>,
    /// Whether the picked map is listed.
    pub family_listed: Option<bool>,
}

const FEATURE_COLUMNS: &str = "mf.week, mf.kind, mf.family_id, mf.collection_id, mf.blurb, \
    mf.created_by, fam.current_map_id, cur.kind::text AS map_kind, fam.listed AS family_listed \
    FROM map_features mf \
    LEFT JOIN map_families fam ON fam.id = mf.family_id \
    LEFT JOIN maps cur ON cur.id = fam.current_map_id";

/// A stored pick and, for a collection, the collection.
#[derive(Debug, Clone)]
pub struct StoredFeature {
    pub row: FeatureRow,
    pub collection: Option<CollectionRow>,
}

impl StoredFeature {
    /// Whether the pick is shown: it points at a listed map whose current file is of the slot's
    /// kind, or at a collection everyone can see.
    pub fn shown(&self) -> bool {
        match (&self.collection, self.row.family_listed) {
            (Some(collection), _) => collection.is_public(),
            (None, Some(listed)) => listed && self.row.map_kind.as_deref() == Some(&self.row.kind),
            (None, None) => false,
        }
    }

    /// The kind of the slot the pick is in.
    pub fn kind(&self) -> MapKind {
        MapKind::from_db(&self.row.kind)
    }
}

/// Loads the collections `rows` point at, all with one query.
async fn with_collections(db: &PgPool, rows: Vec<FeatureRow>) -> eyre::Result<Vec<StoredFeature>> {
    let ids: Vec<Uuid> = rows
        .iter()
        .filter_map(|row| row.collection_id)
        .collect::<HashSet<_>>()
        .into_iter()
        .collect();
    let collections: HashMap<Uuid, CollectionRow> = if ids.is_empty() {
        HashMap::new()
    } else {
        let mut query = QueryBuilder::<Postgres>::new("SELECT ");
        query
            .push(COLLECTION_COLUMNS)
            .push(" FROM collections c WHERE c.id = ANY(")
            .push_bind(ids)
            .push(")");
        query
            .build_query_as::<CollectionRow>()
            .fetch_all(db)
            .await
            .wrap_err("Failed to load featured collections")?
            .into_iter()
            .map(|row| (row.id, row))
            .collect()
    };
    Ok(rows
        .into_iter()
        .map(|row| {
            let collection = row
                .collection_id
                .and_then(|id| collections.get(&id).cloned());
            StoredFeature { row, collection }
        })
        .collect())
}

/// The pick in the `kind` slot of `week`, whether or not it's shown.
pub async fn load_slot(
    db: &PgPool,
    week: NaiveDate,
    kind: MapKind,
) -> eyre::Result<Option<StoredFeature>> {
    let mut query = QueryBuilder::<Postgres>::new("SELECT ");
    query
        .push(FEATURE_COLUMNS)
        .push(" WHERE mf.week = ")
        .push_bind(week)
        .push(" AND mf.kind = ")
        .push_bind(kind.as_str());
    let row = query
        .build_query_as::<FeatureRow>()
        .fetch_optional(db)
        .await
        .wrap_err("Failed to load the slot's pick")?;
    Ok(with_collections(db, row.into_iter().collect()).await?.pop())
}

/// A page of every stored pick, the latest week first, and within a week the melee slot first.
pub async fn load_page(
    db: &PgPool,
    offset: usize,
    limit: usize,
) -> eyre::Result<Vec<StoredFeature>> {
    let mut query = QueryBuilder::<Postgres>::new("SELECT ");
    query
        .push(FEATURE_COLUMNS)
        // 'melee' sorts before 'ums'
        .push(" ORDER BY mf.week DESC, mf.kind LIMIT ")
        .push_bind(limit as i64)
        .push(" OFFSET ")
        .push_bind(offset as i64);
    let rows = query
        .build_query_as::<FeatureRow>()
        .fetch_all(db)
        .await
        .wrap_err("Failed to load picks")?;
    with_collections(db, rows).await
}

/// The automatic pick for the `kind` slot of `this_week`: the listed map whose current file is of
/// `kind` with the highest trending score, at least [`RISING_TRENDING_SCORE`], that wasn't a staff
/// pick in either slot of any of the last [`AUTOMATIC_COOLDOWN_WEEKS`] weeks (`this_week`
/// included). Ties go to the map with more games in the last 28 days, then the lower id. Returns
/// the map and its current file.
pub async fn automatic_pick(
    db: &PgPool,
    this_week: NaiveDate,
    kind: MapKind,
) -> eyre::Result<Option<(Uuid, SbMapId)>> {
    let cooldown_start = this_week
        .checked_sub_days(Days::new(7 * (AUTOMATIC_COOLDOWN_WEEKS - 1)))
        .unwrap_or(NaiveDate::MIN);
    let mut query = QueryBuilder::<Postgres>::new("SELECT fam.id, m.id FROM maps m");
    query
        .push(FAMILY_STATS_JOINS)
        .push(concat!(
            " WHERE fam.listed AND m.listed AND ",
            family_stat!("trending_score"),
            " >= "
        ))
        .push_bind(RISING_TRENDING_SCORE)
        .push(" AND m.kind = ")
        .push_bind(kind.as_str())
        .push(
            " AND NOT EXISTS (SELECT 1 FROM map_features mf WHERE mf.family_id = fam.id \
             AND mf.week >= ",
        )
        .push_bind(cooldown_start)
        .push(" AND mf.week <= ")
        .push_bind(this_week)
        .push(concat!(
            ") ORDER BY ",
            family_stat!("trending_score"),
            " DESC, ",
            family_stat!("games_28d"),
            " DESC, fam.id LIMIT 1"
        ));
    let row = query
        .build_query_as::<(Uuid, Uuid)>()
        .fetch_optional(db)
        .await
        .wrap_err("Failed to load the automatic pick")?;
    Ok(row.map(|(family, map)| (family, SbMapId(map))))
}

/// Loads a collection and keeps it from being deleted for the rest of the transaction.
async fn lock_collection(
    tx: &mut Transaction<'_, Postgres>,
    id: Uuid,
) -> eyre::Result<Option<CollectionRow>> {
    let mut query = QueryBuilder::<Postgres>::new("SELECT ");
    query
        .push(COLLECTION_COLUMNS)
        .push(" FROM collections c WHERE c.id = ")
        .push_bind(id)
        .push(" FOR KEY SHARE OF c");
    query
        .build_query_as::<CollectionRow>()
        .fetch_optional(&mut **tx)
        .await
        .wrap_err("Failed to load the collection")
}

/// Makes `target` the pick of a slot of `week`, replacing that slot's pick if it has one and
/// leaving the other slot alone. The slot is the one [`pick_slot`] gives for the target and
/// `requested`. The target must be shown right now: a listed map, or a collection everyone can see
/// (a collection `viewer` can't read is not found). Picking another target counts as a new pick,
/// made by `staff` now, whose maker hasn't been told yet; picking the same target again only
/// changes the blurb. `week` and `blurb` must already be checked.
pub async fn set(
    db: &PgPool,
    week: NaiveDate,
    requested: Option<MapKind>,
    target: FeatureTarget,
    blurb: &str,
    staff: SbUserId,
    viewer: Viewer,
) -> Result<StoredFeature, FeatureError> {
    let mut tx = db.begin().await.wrap_err("Failed to start transaction")?;
    // Keeps the picked map from being merged away, or its current file from changing, before the
    // row is written
    lock_families(&mut tx).await?;
    let (kind, family_id, collection_id) = match target {
        FeatureTarget::Map(file_id) => {
            let family = sqlx::query!(
                r#"
                    SELECT fam.id, fam.listed, cur.kind
                    FROM maps m
                    INNER JOIN map_families fam ON fam.id = m.family_id
                    INNER JOIN maps cur ON cur.id = fam.current_map_id
                    WHERE m.id = $1
                "#,
                file_id as _,
            )
            .fetch_optional(&mut *tx)
            .await
            .wrap_err("Failed to load the file's map")?
            .ok_or(FeatureError::MapNotFound)?;
            if !family.listed {
                return Err(FeatureError::NotListed);
            }
            let kind = pick_slot(Some(MapKind::from_db(&family.kind)), requested)?;
            (kind, Some(family.id), None)
        }
        FeatureTarget::Collection(id) => {
            let kind = pick_slot(None, requested)?;
            let collection = lock_collection(&mut tx, id)
                .await?
                .filter(|c| c.can_read(viewer))
                .ok_or(FeatureError::CollectionNotFound)?;
            if !collection.is_public() {
                return Err(FeatureError::NotPublic);
            }
            (kind, None, Some(id))
        }
    };
    sqlx::query!(
        r#"
            INSERT INTO map_features AS mf (week, kind, family_id, collection_id, blurb, created_by)
            VALUES ($1, $2, $3, $4, $5, $6)
            ON CONFLICT (week, kind) DO UPDATE SET
                family_id = EXCLUDED.family_id,
                collection_id = EXCLUDED.collection_id,
                blurb = EXCLUDED.blurb,
                updated_at = now(),
                created_by = CASE
                    WHEN mf.family_id IS NOT DISTINCT FROM EXCLUDED.family_id
                        AND mf.collection_id IS NOT DISTINCT FROM EXCLUDED.collection_id
                    THEN mf.created_by ELSE EXCLUDED.created_by END,
                created_at = CASE
                    WHEN mf.family_id IS NOT DISTINCT FROM EXCLUDED.family_id
                        AND mf.collection_id IS NOT DISTINCT FROM EXCLUDED.collection_id
                    THEN mf.created_at ELSE now() END,
                notified_at = CASE
                    WHEN mf.family_id IS NOT DISTINCT FROM EXCLUDED.family_id
                        AND mf.collection_id IS NOT DISTINCT FROM EXCLUDED.collection_id
                    THEN mf.notified_at END
        "#,
        week,
        kind.as_str(),
        family_id,
        collection_id,
        blurb,
        staff as _,
    )
    .execute(&mut *tx)
    .await
    .wrap_err("Failed to store the pick")?;
    tx.commit().await.wrap_err("Failed to commit the pick")?;
    Ok(load_slot(db, week, kind)
        .await?
        .ok_or_else(|| eyre::eyre!("the pick just stored is missing"))?)
}

/// Removes the pick in the `kind` slot of `week`. Returns whether there was one.
pub async fn remove(db: &PgPool, week: NaiveDate, kind: MapKind) -> eyre::Result<bool> {
    let result = sqlx::query!(
        "DELETE FROM map_features WHERE week = $1 AND kind = $2",
        week,
        kind.as_str(),
    )
    .execute(db)
    .await
    .wrap_err("Failed to remove the pick")?;
    Ok(result.rows_affected() > 0)
}

/// Moves the picks of the families in `from` to the family at the same index in `into`, for
/// families about to be merged away. The picks stay in their slots, so the map merged into can end
/// up picked for both slots of a week, of which only the one matching its current file is shown.
pub(crate) async fn retire_family_features(
    tx: &mut Transaction<'_, Postgres>,
    from: &[Uuid],
    into: &[Uuid],
) -> eyre::Result<()> {
    sqlx::query!(
        r#"
            UPDATE map_features mf
            SET family_id = v.into_id
            FROM unnest($1::uuid[], $2::uuid[]) AS v(from_id, into_id)
            WHERE mf.family_id = v.from_id
        "#,
        from,
        into,
    )
    .execute(&mut **tx)
    .await
    .wrap_err("Failed to move picks")?;
    Ok(())
}

/// The weeks up to and including `this_week` in which each of `family_ids` was the staff pick of
/// either slot, newest first, each week once. Families never picked are left out.
pub async fn featured_weeks(
    db: &PgPool,
    family_ids: &[Uuid],
    this_week: NaiveDate,
) -> eyre::Result<HashMap<Uuid, Vec<NaiveDate>>> {
    let rows = sqlx::query!(
        r#"
            SELECT DISTINCT family_id as "family_id!", week
            FROM map_features
            WHERE family_id = ANY($1) AND week <= $2
            ORDER BY week DESC
        "#,
        family_ids,
        this_week,
    )
    .fetch_all(db)
    .await
    .wrap_err("Failed to load featured weeks")?;
    let mut weeks: HashMap<Uuid, Vec<NaiveDate>> = HashMap::new();
    for row in rows {
        weeks.entry(row.family_id).or_default().push(row.week);
    }
    Ok(weeks)
}

#[cfg(test)]
mod tests {
    use chrono::TimeZone;

    use super::*;

    fn date(y: i32, m: u32, d: u32) -> NaiveDate {
        NaiveDate::from_ymd_opt(y, m, d).unwrap()
    }

    #[test]
    fn weeks_start_on_monday_in_utc() {
        let monday = date(2026, 11, 9);
        for now in [
            Utc.with_ymd_and_hms(2026, 11, 9, 0, 0, 0).unwrap(),
            Utc.with_ymd_and_hms(2026, 11, 12, 13, 0, 0).unwrap(),
            Utc.with_ymd_and_hms(2026, 11, 15, 23, 59, 59).unwrap(),
        ] {
            assert_eq!(week_of(now), monday, "{now}");
        }
        assert_eq!(
            week_of(Utc.with_ymd_and_hms(2026, 11, 16, 0, 0, 0).unwrap()),
            date(2026, 11, 16)
        );
        assert_eq!(
            week_start(monday),
            Utc.with_ymd_and_hms(2026, 11, 9, 0, 0, 0).unwrap()
        );
    }

    #[test]
    fn weeks_parse_only_from_their_start() {
        assert_eq!(
            parse_week(Utc.with_ymd_and_hms(2026, 11, 9, 0, 0, 0).unwrap()).unwrap(),
            date(2026, 11, 9)
        );
        for start in [
            Utc.with_ymd_and_hms(2026, 11, 10, 0, 0, 0).unwrap(),
            Utc.with_ymd_and_hms(2026, 11, 9, 0, 0, 1).unwrap(),
            Utc.with_ymd_and_hms(2026, 11, 8, 23, 0, 0).unwrap(),
        ] {
            assert!(
                matches!(parse_week(start), Err(FeatureError::InvalidWeek)),
                "{start}"
            );
        }
    }

    #[test]
    fn picks_can_be_made_from_this_week_to_26_weeks_ahead() {
        let this_week = date(2026, 11, 9);
        assert!(check_schedulable(this_week, this_week).is_ok());
        assert!(matches!(
            check_schedulable(date(2026, 11, 2), this_week),
            Err(FeatureError::WeekPassed)
        ));
        let last = this_week + Days::new(7 * 26);
        assert!(check_schedulable(last, this_week).is_ok());
        assert!(matches!(
            check_schedulable(last + Days::new(7), this_week),
            Err(FeatureError::WeekTooFar)
        ));
    }

    #[test]
    fn maps_go_in_the_slot_of_their_current_file() {
        assert_eq!(pick_slot(Some(MapKind::Ums), None).unwrap(), MapKind::Ums);
        assert_eq!(
            pick_slot(Some(MapKind::Melee), Some(MapKind::Melee)).unwrap(),
            MapKind::Melee
        );
        assert!(matches!(
            pick_slot(Some(MapKind::Melee), Some(MapKind::Ums)),
            Err(FeatureError::KindMismatch)
        ));
    }

    #[test]
    fn collections_go_in_the_slot_staff_ask_for() {
        assert_eq!(pick_slot(None, Some(MapKind::Ums)).unwrap(), MapKind::Ums);
        assert!(matches!(
            pick_slot(None, None),
            Err(FeatureError::KindRequired)
        ));
    }

    fn map_pick(slot: &str, listed: bool, current_kind: &str) -> StoredFeature {
        StoredFeature {
            row: FeatureRow {
                week: date(2026, 11, 9),
                kind: slot.to_string(),
                family_id: Some(Uuid::nil()),
                collection_id: None,
                blurb: String::new(),
                created_by: SbUserId(1),
                current_map_id: Some(SbMapId(Uuid::nil())),
                map_kind: Some(current_kind.to_string()),
                family_listed: Some(listed),
            },
            collection: None,
        }
    }

    #[test]
    fn map_picks_are_shown_while_listed_and_of_their_slots_kind() {
        assert!(map_pick("melee", true, "melee").shown());
        assert!(map_pick("ums", true, "ums").shown());
        assert!(!map_pick("melee", false, "melee").shown());
        assert!(!map_pick("melee", true, "ums").shown());
        assert!(!map_pick("ums", true, "melee").shown());
        assert_eq!(map_pick("ums", true, "melee").kind(), MapKind::Ums);
    }

    #[test]
    fn blurbs_are_trimmed_single_lines() {
        assert_eq!(clean_blurb(None).unwrap(), "");
        assert_eq!(clean_blurb(Some("  A classic.  ")).unwrap(), "A classic.");
        assert_eq!(
            clean_blurb(Some(&"a".repeat(MAX_BLURB_LENGTH)))
                .unwrap()
                .len(),
            MAX_BLURB_LENGTH
        );
        // Surrounding whitespace doesn't count toward the length
        assert!(clean_blurb(Some(&format!(" {} ", "a".repeat(MAX_BLURB_LENGTH)))).is_ok());
        for bad in [
            "a".repeat(MAX_BLURB_LENGTH + 1),
            "two\nlines".to_string(),
            "two\r\nlines".to_string(),
            "tab\there".to_string(),
            "line\u{2028}separator".to_string(),
        ] {
            assert!(
                matches!(clean_blurb(Some(&bad)), Err(FeatureError::InvalidBlurb)),
                "{bad:?}"
            );
        }
    }
}
