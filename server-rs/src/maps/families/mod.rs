//! Map families: the maps players know ("Fighting Spirit"), each made of one or more map files.
//! Every file is in exactly one family and a family always holds at least one file. Each family has
//! one current file, the one players get: staff's pick while it's eligible, otherwise derived by the
//! database function `refresh_map_families`.
//!
//! Files only change families when staff move them (see [`edit`]), with one exception: an unlisted
//! file alone in its family joins another family holding a file with the same scenario (see
//! [`join_identical_files`]).

pub mod edit;
pub mod graphql;
pub mod history;

use color_eyre::eyre::{self, WrapErr};
use sqlx::{PgPool, Postgres, Transaction};
use uuid::Uuid;

use crate::maps::SbMapId;

/// Takes the lock held by every transaction that changes which family a file is in, a family's
/// default, or whether a file is listed. Must be taken before changing anything, so two writers
/// can't wait on each other's row locks while holding it.
pub(crate) async fn lock_families(tx: &mut Transaction<'_, Postgres>) -> eyre::Result<()> {
    sqlx::query!("SELECT lock_map_families()")
        .execute(&mut **tx)
        .await
        .wrap_err("Failed to lock map families")?;
    Ok(())
}

/// Recomputes the current file and `listed` flag of `family_ids`. With `keep_current`, a derived
/// current file only gives way to one that's played clearly more.
pub(crate) async fn refresh_families(
    tx: &mut Transaction<'_, Postgres>,
    family_ids: &[Uuid],
    keep_current: bool,
) -> eyre::Result<()> {
    sqlx::query!(
        "SELECT refresh_map_families($1, $2)",
        family_ids,
        keep_current,
    )
    .execute(&mut **tx)
    .await
    .wrap_err("Failed to refresh map families")?;
    Ok(())
}

/// Deletes the families in `from`, which must hold no files anymore, leaving each one's id (and
/// the ids that were aliases of it) as an alias of the family at the same index in `into`. Their
/// favorites move along, one per user and family.
pub(crate) async fn retire_families(
    tx: &mut Transaction<'_, Postgres>,
    from: &[Uuid],
    into: &[Uuid],
) -> eyre::Result<()> {
    debug_assert_eq!(from.len(), into.len());
    if from.is_empty() {
        return Ok(());
    }
    sqlx::query!(
        r#"
            UPDATE map_family_aliases a
            SET family_id = v.into_id
            FROM unnest($1::uuid[], $2::uuid[]) AS v(from_id, into_id)
            WHERE a.family_id = v.from_id
        "#,
        from,
        into,
    )
    .execute(&mut **tx)
    .await
    .wrap_err("Failed to move family aliases")?;
    sqlx::query!(
        r#"
            INSERT INTO map_family_aliases (old_id, family_id)
            SELECT from_id, into_id FROM unnest($1::uuid[], $2::uuid[]) AS v(from_id, into_id)
            ON CONFLICT (old_id) DO UPDATE SET family_id = EXCLUDED.family_id
        "#,
        from,
        into,
    )
    .execute(&mut **tx)
    .await
    .wrap_err("Failed to add family aliases")?;
    sqlx::query!(
        r#"
            INSERT INTO favorited_maps (family_id, favorited_by, favorited_date)
            SELECT DISTINCT ON (v.into_id, f.favorited_by) v.into_id, f.favorited_by,
                f.favorited_date
            FROM favorited_maps f
            INNER JOIN unnest($1::uuid[], $2::uuid[]) AS v(from_id, into_id)
                ON v.from_id = f.family_id
            ORDER BY v.into_id, f.favorited_by, f.favorited_date NULLS LAST
            ON CONFLICT (family_id, favorited_by) DO UPDATE
            SET favorited_date = LEAST(favorited_maps.favorited_date, EXCLUDED.favorited_date)
        "#,
        from,
        into,
    )
    .execute(&mut **tx)
    .await
    .wrap_err("Failed to move favorites")?;
    sqlx::query!("DELETE FROM favorited_maps WHERE family_id = ANY($1)", from)
        .execute(&mut **tx)
        .await
        .wrap_err("Failed to delete moved favorites")?;
    sqlx::query!("DELETE FROM map_families WHERE id = ANY($1)", from)
        .execute(&mut **tx)
        .await
        .wrap_err("Failed to delete families")?;
    Ok(())
}

/// Moves unlisted files that are alone in their family into another family holding a file with the
/// same scenario (CHK). For each scenario, the files go to the family ranked first among those
/// holding it: one with a listed file first, then the most played, then the oldest. Listed files
/// and files that share their family with others never move. With `only`, just those files are
/// considered. Returns how many files moved.
pub(crate) async fn join_identical_files(
    tx: &mut Transaction<'_, Postgres>,
    only: Option<&[SbMapId]>,
) -> eyre::Result<usize> {
    lock_families(tx).await?;
    let only: Option<Vec<Uuid>> = only.map(|ids| ids.iter().map(|id| id.0).collect());
    let moved = sqlx::query!(
        r#"
            WITH files AS (
                SELECT a.chk_hash, m.id, m.family_id, m.listed
                FROM map_analysis a
                INNER JOIN maps m ON m.id = a.map_id
                WHERE a.chk_hash IS NOT NULL AND ($1::uuid[] IS NULL OR a.chk_hash IN (
                    SELECT chk_hash FROM map_analysis WHERE map_id = ANY($1)
                ))
            ),
            shared AS (
                SELECT chk_hash
                FROM files
                GROUP BY chk_hash
                HAVING count(DISTINCT family_id) > 1
            ),
            target AS (
                SELECT DISTINCT ON (c.chk_hash) c.chk_hash, c.family_id
                FROM (
                    SELECT DISTINCT f.chk_hash, f.family_id
                    FROM files f
                    INNER JOIN shared s ON s.chk_hash = f.chk_hash
                ) c
                INNER JOIN map_families fam ON fam.id = c.family_id
                CROSS JOIN LATERAL (
                    SELECT COALESCE(sum(st.games_total), 0) AS games
                    FROM maps mm
                    INNER JOIN map_stats st ON st.map_id = mm.id
                    WHERE mm.family_id = fam.id
                ) played
                ORDER BY c.chk_hash, fam.listed DESC, played.games DESC, fam.created_at, fam.id
            ),
            movable AS (
                SELECT f.id, f.family_id AS from_id, t.family_id AS into_id
                FROM files f
                INNER JOIN target t ON t.chk_hash = f.chk_hash
                WHERE NOT f.listed AND t.family_id <> f.family_id
                    AND ($1::uuid[] IS NULL OR f.id = ANY($1))
                    AND NOT EXISTS (
                        SELECT 1 FROM maps o WHERE o.family_id = f.family_id AND o.id <> f.id
                    )
            )
            UPDATE maps m
            SET family_id = mv.into_id
            FROM movable mv
            WHERE m.id = mv.id
            RETURNING mv.from_id as "from_id!", mv.into_id as "into_id!"
        "#,
        only.as_deref(),
    )
    .fetch_all(&mut **tx)
    .await
    .wrap_err("Failed to join identical files")?;
    if moved.is_empty() {
        return Ok(0);
    }

    let from: Vec<Uuid> = moved.iter().map(|m| m.from_id).collect();
    let into: Vec<Uuid> = moved.iter().map(|m| m.into_id).collect();
    retire_families(tx, &from, &into).await?;
    refresh_families(tx, &into, true).await?;
    Ok(moved.len())
}

/// Runs [`join_identical_files`] in a transaction of its own.
pub async fn join_identical_files_now(
    db: &PgPool,
    only: Option<&[SbMapId]>,
) -> eyre::Result<usize> {
    let mut tx = db.begin().await.wrap_err("Failed to start transaction")?;
    let moved = join_identical_files(&mut tx, only).await?;
    tx.commit()
        .await
        .wrap_err("Failed to commit identical file joins")?;
    Ok(moved)
}

/// What a map page id named: a family (by its id or an alias), or a file (by its id or an alias),
/// along with the family that file is in.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ResolvedFamilyId {
    pub family_id: Uuid,
    /// The file the id named, when it named a file rather than a family.
    pub file_id: Option<SbMapId>,
}

/// Resolves an id from a map page URL, trying in order: a family id, a family alias, a file id, and
/// a file alias.
pub async fn resolve_map_page_id(db: &PgPool, id: Uuid) -> eyre::Result<Option<ResolvedFamilyId>> {
    let row = sqlx::query!(
        r#"
            SELECT r.family_id as "family_id!", r.file_id as "file_id: SbMapId"
            FROM (
                SELECT f.id AS family_id, NULL::uuid AS file_id, 1 AS priority
                FROM map_families f
                WHERE f.id = $1
                UNION ALL
                SELECT a.family_id, NULL::uuid, 2
                FROM map_family_aliases a
                WHERE a.old_id = $1
                UNION ALL
                SELECT m.family_id, m.id, 3
                FROM maps m
                WHERE m.id = $1
                UNION ALL
                SELECT m.family_id, m.id, 4
                FROM map_id_aliases a
                INNER JOIN maps m ON m.id = a.map_id
                WHERE a.old_id = $1
            ) r
            ORDER BY r.priority
            LIMIT 1
        "#,
        id,
    )
    .fetch_optional(db)
    .await
    .wrap_err("Failed to resolve map page id")?;
    Ok(row.map(|row| ResolvedFamilyId {
        family_id: row.family_id,
        file_id: row.file_id,
    }))
}

/// Resolves a family id that may be an alias of a family that was merged into another one.
pub async fn resolve_family_id(db: &PgPool, id: Uuid) -> eyre::Result<Option<Uuid>> {
    sqlx::query_scalar!(
        r#"
            SELECT COALESCE(
                (SELECT f.id FROM map_families f WHERE f.id = $1),
                (SELECT a.family_id FROM map_family_aliases a WHERE a.old_id = $1)
            ) as "id?"
        "#,
        id,
    )
    .fetch_one(db)
    .await
    .wrap_err("Failed to resolve family id")
}
