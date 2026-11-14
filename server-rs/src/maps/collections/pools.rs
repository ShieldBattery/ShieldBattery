//! Ladder map pools as collections. Every pool in `matchmaking_map_pools` has a `ladder_pool`
//! collection holding its exact files in pool order. The Node server makes it along with the pool
//! and picks each match's map from it; nothing edits it after that.
//!
//! The current pool of a matchmaking type is the one that started most recently; a pool that hasn't
//! started yet is scheduled. Everyone can see a pool that has started and holds at least
//! [`MIN_PUBLIC_POOL_FILES`] files. Scheduled pools and pools of a single file are only for users
//! who can manage map pools.
//!
//! A file that a current or scheduled pool holds is in use by the ladder, and can't be taken out of
//! the listings or out of its map (see [`ladder_use`]). Files in any pool can't be deleted at all,
//! which the database enforces.

use std::collections::HashMap;
use std::sync::Arc;

use async_graphql::dataloader::{DataLoader, Loader};
use async_graphql::{Context, Object, Result};
use chrono::{DateTime, Utc};
use color_eyre::eyre::{self, WrapErr};
use sqlx::{PgConnection, Postgres, QueryBuilder};
use strum::IntoEnumIterator;
use uuid::Uuid;

use crate::maps::SbMapId;
use crate::maps::catalog::{SbMap, load_sb_map};
use crate::maps::collections::graphql::{MapCollection, current_viewer, load_for_viewer};
use crate::maps::collections::{COLLECTION_COLUMNS, CollectionRow, Viewer};
use crate::maps::search::MapSearchRepo;
use crate::matchmaking::MatchmakingType;

/// The fewest files a started pool needs for everyone to see it. A list of one map isn't a
/// collection worth showing.
pub const MIN_PUBLIC_POOL_FILES: i64 = 2;
/// How many pools `MapFamily.ladderPools` lists unless told otherwise, and at most.
pub const DEFAULT_FAMILY_POOLS: i32 = 20;
const MAX_FAMILY_POOLS: i32 = 100;

/// The collection of the current pool of each matchmaking type: the latest one that has started.
/// Pool start dates are stored in UTC without a time zone.
pub(crate) const CURRENT_POOL_COLLECTIONS: &str = "SELECT DISTINCT ON (cp.matchmaking_type) \
    cp.collection_id FROM matchmaking_map_pools cp \
    WHERE cp.start_date AT TIME ZONE 'UTC' <= now() \
    ORDER BY cp.matchmaking_type, cp.start_date DESC, cp.id DESC";

/// Whether everyone can see a pool that starts at `starts_at` and holds `file_count` files.
pub fn is_open(starts_at: Option<DateTime<Utc>>, file_count: i64, now: DateTime<Utc>) -> bool {
    starts_at.is_some_and(|s| s <= now) && file_count >= MIN_PUBLIC_POOL_FILES
}

/// Where `matchmaking_type` comes in the order of the [`MatchmakingType`] enum, which is the order
/// pools are listed in.
pub fn type_order(matchmaking_type: MatchmakingType) -> usize {
    MatchmakingType::iter()
        .position(|t| t == matchmaking_type)
        .unwrap_or(usize::MAX)
}

/// The database names of the matchmaking types, in the order of the enum.
pub(crate) fn type_names() -> Vec<&'static str> {
    MatchmakingType::iter().map(|t| t.as_str()).collect()
}

/// The matchmaking type of a current or scheduled pool holding `file_id`, if one does (the first in
/// enum order when several do). Locks the file's row for the rest of the transaction, so a pool
/// being made with the file in it either commits before this reads the pools, or waits until the
/// caller is done with the file.
pub(crate) async fn ladder_use(
    conn: &mut PgConnection,
    file_id: SbMapId,
) -> eyre::Result<Option<MatchmakingType>> {
    sqlx::query!("SELECT id FROM maps WHERE id = $1 FOR UPDATE", file_id as _)
        .fetch_optional(&mut *conn)
        .await
        .wrap_err("Failed to lock the map file")?;
    let types = sqlx::query_scalar!(
        r#"
            SELECT p.matchmaking_type as "matchmaking_type: MatchmakingType"
            FROM matchmaking_map_pools p
            INNER JOIN collection_maps cm ON cm.collection_id = p.collection_id
            WHERE cm.map_id = $1
                AND p.start_date >= COALESCE((
                    SELECT max(cp.start_date) FROM matchmaking_map_pools cp
                    WHERE cp.matchmaking_type = p.matchmaking_type
                        AND cp.start_date AT TIME ZONE 'UTC' <= now()
                ), '-infinity')
        "#,
        file_id as _,
    )
    .fetch_all(&mut *conn)
    .await
    .wrap_err("Failed to look up the ladder map pools holding the file")?;
    Ok(types.into_iter().min_by_key(|&t| type_order(t)))
}

/// A ladder map pool as stored, with how many files its collection holds.
#[derive(Debug, Clone)]
pub struct PoolRow {
    pub id: i32,
    pub collection_id: Uuid,
    pub matchmaking_type: MatchmakingType,
    pub start_date: DateTime<Utc>,
    pub max_veto_count: i32,
    pub file_count: i64,
}

impl PoolRow {
    fn can_read(&self, viewer: Viewer, now: DateTime<Utc>) -> bool {
        viewer.manage_map_pools || is_open(Some(self.start_date), self.file_count, now)
    }
}

/// Loads the ladder map pool each `ladder_pool` collection is.
pub struct LadderPoolLoader {
    db: sqlx::PgPool,
}

impl LadderPoolLoader {
    pub fn new(db: sqlx::PgPool) -> Self {
        Self { db }
    }
}

impl Loader<Uuid> for LadderPoolLoader {
    type Value = PoolRow;
    type Error = async_graphql::Error;

    async fn load(&self, keys: &[Uuid]) -> Result<HashMap<Uuid, PoolRow>> {
        let rows = sqlx::query_as!(
            PoolRow,
            r#"
                SELECT p.id, p.collection_id,
                    p.matchmaking_type as "matchmaking_type: MatchmakingType",
                    p.start_date AT TIME ZONE 'UTC' as "start_date!", p.max_veto_count,
                    (SELECT count(*) FROM collection_maps cm
                        WHERE cm.collection_id = p.collection_id) as "file_count!"
                FROM matchmaking_map_pools p
                WHERE p.collection_id = ANY($1)
            "#,
            keys,
        )
        .fetch_all(&self.db)
        .await
        .wrap_err("Failed to load ladder map pools")?;
        Ok(rows.into_iter().map(|r| (r.collection_id, r)).collect())
    }
}

/// Loads every ladder map pool of each matchmaking type, in the order they start.
pub struct LadderPoolsOfTypeLoader {
    db: sqlx::PgPool,
}

impl LadderPoolsOfTypeLoader {
    pub fn new(db: sqlx::PgPool) -> Self {
        Self { db }
    }
}

impl Loader<MatchmakingType> for LadderPoolsOfTypeLoader {
    type Value = Arc<Vec<PoolRow>>;
    type Error = async_graphql::Error;

    async fn load(
        &self,
        keys: &[MatchmakingType],
    ) -> Result<HashMap<MatchmakingType, Arc<Vec<PoolRow>>>> {
        let names: Vec<&str> = keys.iter().map(|t| t.as_str()).collect();
        let rows = sqlx::query_as!(
            PoolRow,
            r#"
                SELECT p.id, p.collection_id,
                    p.matchmaking_type as "matchmaking_type: MatchmakingType",
                    p.start_date AT TIME ZONE 'UTC' as "start_date!", p.max_veto_count,
                    (SELECT count(*) FROM collection_maps cm
                        WHERE cm.collection_id = p.collection_id) as "file_count!"
                FROM matchmaking_map_pools p
                WHERE p.matchmaking_type::text = ANY($1::text[])
                ORDER BY p.start_date, p.id
            "#,
            &names as &[&str],
        )
        .fetch_all(&self.db)
        .await
        .wrap_err("Failed to load ladder map pools")?;
        let mut by_type: HashMap<MatchmakingType, Vec<PoolRow>> =
            keys.iter().map(|&t| (t, Vec::new())).collect();
        for row in rows {
            by_type.entry(row.matchmaking_type).or_default().push(row);
        }
        Ok(by_type
            .into_iter()
            .map(|(t, rows)| (t, Arc::new(rows)))
            .collect())
    }
}

/// Loads which current ladder map pools hold each file, in matchmaking type order.
pub struct MapLadderPoolsLoader {
    db: sqlx::PgPool,
}

impl MapLadderPoolsLoader {
    pub fn new(db: sqlx::PgPool) -> Self {
        Self { db }
    }
}

impl Loader<SbMapId> for MapLadderPoolsLoader {
    type Value = Vec<MatchmakingType>;
    type Error = async_graphql::Error;

    async fn load(&self, keys: &[SbMapId]) -> Result<HashMap<SbMapId, Vec<MatchmakingType>>> {
        let rows = sqlx::query!(
            r#"
                SELECT cm.map_id as "map_id!: SbMapId",
                    p.matchmaking_type as "matchmaking_type: MatchmakingType"
                FROM matchmaking_map_pools p
                INNER JOIN collection_maps cm ON cm.collection_id = p.collection_id
                WHERE cm.map_id = ANY($1)
                    AND p.collection_id IN (
                        SELECT DISTINCT ON (cp.matchmaking_type) cp.collection_id
                        FROM matchmaking_map_pools cp
                        WHERE cp.start_date AT TIME ZONE 'UTC' <= now()
                        ORDER BY cp.matchmaking_type, cp.start_date DESC, cp.id DESC
                    )
            "#,
            keys as _,
        )
        .fetch_all(&self.db)
        .await
        .wrap_err("Failed to load the ladder map pools of maps")?;
        let mut pools: HashMap<SbMapId, Vec<MatchmakingType>> = HashMap::new();
        for row in rows {
            pools
                .entry(row.map_id)
                .or_default()
                .push(row.matchmaking_type);
        }
        for types in pools.values_mut() {
            types.sort_by_key(|&t| type_order(t));
        }
        Ok(pools)
    }
}

/// A ladder map pool, as the collection that holds its files shows it.
pub struct MapCollectionPool {
    row: PoolRow,
    viewer: Viewer,
}

impl MapCollectionPool {
    pub(crate) fn new(row: PoolRow, viewer: Viewer) -> Self {
        Self { row, viewer }
    }

    /// Every pool of this pool's matchmaking type, in the order they start, and this pool's index
    /// among them.
    async fn siblings(&self, ctx: &Context<'_>) -> Result<(Arc<Vec<PoolRow>>, usize)> {
        let pools = ctx
            .data::<DataLoader<LadderPoolsOfTypeLoader>>()?
            .load_one(self.row.matchmaking_type)
            .await?
            .unwrap_or_default();
        let index = pools
            .iter()
            .position(|p| p.id == self.row.id)
            .unwrap_or(pools.len());
        Ok((pools, index))
    }

    async fn neighbor<'a>(
        &self,
        ctx: &Context<'_>,
        mut candidates: impl Iterator<Item = &'a PoolRow>,
    ) -> Result<Option<MapCollection>> {
        let now = Utc::now();
        let Some(pool) = candidates.find(|p| p.can_read(self.viewer, now)) else {
            return Ok(None);
        };
        load_for_viewer(ctx, pool.collection_id, self.viewer).await
    }
}

/// A ladder map pool: the maps a matchmaking type plays from its start until the next pool of that
/// type starts.
#[Object]
impl MapCollectionPool {
    /// The pool's id in the matchmaking map pool APIs.
    async fn id(&self) -> i32 {
        self.row.id
    }

    async fn matchmaking_type(&self) -> MatchmakingType {
        self.row.matchmaking_type
    }

    async fn start_date(&self) -> DateTime<Utc> {
        self.row.start_date
    }

    /// When the next pool of the same matchmaking type starts, ending this one. Null for the
    /// latest pool of its type.
    async fn end_date(&self, ctx: &Context<'_>) -> Result<Option<DateTime<Utc>>> {
        let (pools, index) = self.siblings(ctx).await?;
        Ok(pools.get(index + 1).map(|p| p.start_date))
    }

    /// How many of the pool's maps each player can veto, in matchmaking types that have vetoes.
    async fn max_veto_count(&self) -> i32 {
        self.row.max_veto_count
    }

    /// Whether this is the pool its matchmaking type plays now: the latest one that has started.
    async fn is_current(&self, ctx: &Context<'_>) -> Result<bool> {
        let now = Utc::now();
        let (pools, _) = self.siblings(ctx).await?;
        Ok(pools
            .iter()
            .rfind(|p| p.start_date <= now)
            .is_some_and(|p| p.id == self.row.id))
    }

    /// The pool of the same matchmaking type before this one that the viewer can see.
    async fn previous(&self, ctx: &Context<'_>) -> Result<Option<MapCollection>> {
        let (pools, index) = self.siblings(ctx).await?;
        self.neighbor(ctx, pools[..index.min(pools.len())].iter().rev())
            .await
    }

    /// The pool of the same matchmaking type after this one that the viewer can see.
    async fn next(&self, ctx: &Context<'_>) -> Result<Option<MapCollection>> {
        let (pools, index) = self.siblings(ctx).await?;
        self.neighbor(ctx, pools.iter().skip(index + 1)).await
    }
}

/// A file of a map that a current ladder map pool holds, as `MapFamily.ladderFiles` lists it.
pub struct MapLadderFile {
    pool_id: i32,
    matchmaking_type: MatchmakingType,
    map_id: SbMapId,
    collection_id: Uuid,
    viewer: Viewer,
}

/// A file of a map that a current ladder map pool holds.
#[Object]
impl MapLadderFile {
    async fn id(&self) -> String {
        format!("map-ladder-file:{}:{}", self.pool_id, self.map_id)
    }

    /// The matchmaking type whose current pool holds the file.
    async fn matchmaking_type(&self) -> MatchmakingType {
        self.matchmaking_type
    }

    /// The file the pool holds. The ladder plays this exact file, whichever file is its map's
    /// current one.
    async fn map(&self, ctx: &Context<'_>) -> Result<SbMap> {
        load_sb_map(ctx, self.map_id).await
    }

    /// The pool's collection. Null when the viewer can't see it (a pool of one map).
    async fn collection(&self, ctx: &Context<'_>) -> Result<Option<MapCollection>> {
        load_for_viewer(ctx, self.collection_id, self.viewer).await
    }
}

/// The files of the map (family) `family_id` that current ladder map pools hold, one entry per file
/// each such pool holds, in matchmaking type order and then pool order.
pub(crate) async fn family_ladder_files(
    ctx: &Context<'_>,
    family_id: Uuid,
) -> Result<Vec<MapLadderFile>> {
    let viewer = current_viewer(ctx).await?;
    let db = ctx.data::<MapSearchRepo>()?.db();
    let rows = sqlx::query!(
        r#"
            SELECT p.id, p.matchmaking_type as "matchmaking_type: MatchmakingType",
                cm.map_id as "map_id!: SbMapId", p.collection_id
            FROM matchmaking_map_pools p
            INNER JOIN collection_maps cm ON cm.collection_id = p.collection_id
            INNER JOIN maps m ON m.id = cm.map_id
            WHERE m.family_id = $1
                AND p.collection_id IN (
                    SELECT DISTINCT ON (cp.matchmaking_type) cp.collection_id
                    FROM matchmaking_map_pools cp
                    WHERE cp.start_date AT TIME ZONE 'UTC' <= now()
                    ORDER BY cp.matchmaking_type, cp.start_date DESC, cp.id DESC
                )
            ORDER BY cm.position, cm.id
        "#,
        family_id,
    )
    .fetch_all(db)
    .await
    .wrap_err("Failed to load the map's ladder files")?;
    let mut files: Vec<MapLadderFile> = rows
        .into_iter()
        .map(|row| MapLadderFile {
            pool_id: row.id,
            matchmaking_type: row.matchmaking_type,
            map_id: row.map_id,
            collection_id: row.collection_id,
            viewer,
        })
        .collect();
    files.sort_by_key(|f| type_order(f.matchmaking_type));
    Ok(files)
}

/// The collections of the ladder map pools that have started and hold a file of the map (family)
/// `family_id`, newest first; `first` of them (at most 100). Pools the viewer can't see are left
/// out.
pub(crate) async fn family_ladder_pools(
    ctx: &Context<'_>,
    family_id: Uuid,
    first: i32,
) -> Result<Vec<MapCollection>> {
    let viewer = current_viewer(ctx).await?;
    let db = ctx.data::<MapSearchRepo>()?.db();
    let mut query = QueryBuilder::<Postgres>::new("SELECT ");
    query.push(COLLECTION_COLUMNS).push(
        " FROM collections c
        INNER JOIN matchmaking_map_pools p ON p.collection_id = c.id
        WHERE p.start_date AT TIME ZONE 'UTC' <= now()
            AND EXISTS (
                SELECT 1 FROM collection_maps cm
                INNER JOIN maps fm ON fm.id = cm.map_id
                WHERE cm.collection_id = c.id AND fm.family_id = ",
    );
    query.push_bind(family_id).push(")");
    if !viewer.manage_map_pools {
        query
            .push(" AND (SELECT count(*) FROM collection_maps n WHERE n.collection_id = c.id) >= ")
            .push_bind(MIN_PUBLIC_POOL_FILES);
    }
    query.push(" ORDER BY p.start_date DESC, p.id DESC LIMIT ");
    query.push_bind(i64::from(first.clamp(1, MAX_FAMILY_POOLS)));
    let rows = query
        .build_query_as::<CollectionRow>()
        .fetch_all(db)
        .await
        .wrap_err("Failed to load the map's ladder map pools")?;
    Ok(rows
        .into_iter()
        .filter(|row| row.can_read(viewer))
        .map(|row| MapCollection::new(row, viewer))
        .collect())
}

#[cfg(test)]
mod tests {
    use chrono::Duration;

    use super::*;

    #[test]
    fn pools_open_once_started_with_two_files() {
        let now = Utc::now();
        let past = Some(now - Duration::days(1));
        let future = Some(now + Duration::days(1));
        assert!(is_open(past, 2, now));
        assert!(is_open(Some(now), 3, now));
        assert!(!is_open(past, 1, now));
        assert!(!is_open(past, 0, now));
        assert!(!is_open(future, 5, now));
        assert!(!is_open(None, 5, now));
    }

    #[test]
    fn types_are_ordered_as_the_enum() {
        assert_eq!(type_order(MatchmakingType::Match1v1), 0);
        assert_eq!(type_order(MatchmakingType::Match1v1Fastest), 1);
        assert_eq!(type_order(MatchmakingType::Match2v2), 2);
        assert_eq!(type_names()[1], "1v1fastest");
        assert_eq!(type_names().len(), MatchmakingType::iter().count());
    }
}
