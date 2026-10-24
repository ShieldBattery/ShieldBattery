//! Map families: finding files that are versions, variants, translations or forks of one map,
//! proposing how they relate, and keeping each family's derived lines up to date.
//!
//! Detection scans a map when it's stored and whenever it hasn't been scanned under the current
//! rules. Candidates come from terrain similarity (same dimensions) and from matching base names;
//! each new pair is stored in `map_link_suggestions` with the rules' proposal. Only identical
//! scenarios are linked without a person; proposals that don't link anything (a UMS map on
//! another map's terrain, unrelated UMS maps) are closed right away, and the rest wait for staff.

pub mod edit;
pub mod graphql;
pub mod proposals;
pub mod rules;

use std::collections::{BTreeSet, HashMap, HashSet};

use chrono::{DateTime, Utc};
use color_eyre::eyre::{self, WrapErr};
use sqlx::types::Json;
use sqlx::{PgPool, Postgres, Transaction};
use tracing::info;
use uuid::Uuid;

use crate::maps::SbMapId;
pub use crate::maps::families::rules::FAMILY_RULES_VERSION;
use crate::maps::families::rules::{
    Proposal, ProposedRelation, RuleMap, VersionKey, is_candidate_base_name, propose,
};
use crate::maps::parse::{FINGERPRINT_VERSION, MAP_PARSER_VERSION};

/// How a file in a family relates to its parent.
#[derive(async_graphql::Enum, Copy, Clone, Debug, Eq, PartialEq, Hash, sqlx::Type)]
#[sqlx(type_name = "map_family_relation", rename_all = "snake_case")]
pub enum MapFamilyRelation {
    /// The family's first file. It has no parent.
    Root,
    /// A newer version of its parent, which it supersedes.
    Version,
    /// The same version as its parent with small changes (a tournament tag, an observer version, a
    /// repack). It doesn't supersede its parent.
    Variant,
    /// Its parent in another language.
    Translation,
    /// Someone else's map based on its parent. It starts its own line, with its own current
    /// version.
    Fork,
}

impl MapFamilyRelation {
    /// Whether a file with this relation starts a line of its own.
    pub fn starts_line(self) -> bool {
        matches!(self, Self::Root | Self::Fork)
    }
}

/// Who set a file's place in its family. A place can only be changed by the same or a higher
/// source: moderators over publishers over the detection rules.
#[derive(
    async_graphql::Enum, Copy, Clone, Debug, Eq, PartialEq, Hash, PartialOrd, Ord, sqlx::Type,
)]
#[sqlx(type_name = "map_link_source", rename_all = "snake_case")]
pub enum MapLinkSource {
    /// The detection rules, e.g. for files with the same scenario.
    Rule,
    /// The user who published the map.
    Publisher,
    /// Staff.
    Moderator,
}

/// The least terrain similarity for a pair to be a candidate.
const MIN_TERRAIN_SIMILARITY: f32 = 0.90;
/// Below this, similarity doesn't order name candidates (unrelated maps of one size often reach
/// 0.6-0.8 through shared open ground).
const NAME_ORDER_MIN_SIMILARITY: f32 = 0.80;
/// The most candidates kept per source (terrain, and each of the map's base names).
const MAX_CANDIDATES_PER_SOURCE: usize = 5;
const SCAN_BATCH_SIZE: i64 = 50;
/// Transaction-level advisory lock taken before writing to any family, so concurrent writers
/// (an upload's scan and the maintenance sweep) can't build conflicting trees.
const FAMILY_WRITE_LOCK_KEY: i64 = 0x5342_4d41_5046_414d; // "SBMAPFAM"

/// Terrain similarity of two fingerprints of the same dimensions: of the build tiles walkable in
/// either map, the share with the same terrain class. Tiles unwalkable in both are left out, so
/// open ground decides, not the shared void around it.
pub fn terrain_similarity(a: &[u8], b: &[u8], tiles: usize) -> Option<f32> {
    if a.len() != b.len() || a.len() < tiles.div_ceil(4) {
        return None;
    }
    let mut counted = 0u32;
    let mut same = 0u32;
    for i in 0..tiles {
        let shift = (i % 4) * 2;
        let x = (a[i / 4] >> shift) & 3;
        let y = (b[i / 4] >> shift) & 3;
        if x == 3 && y == 3 {
            continue;
        }
        counted += 1;
        if x == y {
            same += 1;
        }
    }
    (counted > 0).then(|| same as f32 / counted as f32)
}

pub(crate) struct RuleRow {
    id: SbMapId,
    title: String,
    public_name: Option<String>,
    description: String,
    width: i32,
    height: i32,
    ums_content: bool,
    first_seen_at: DateTime<Utc>,
    chk_hash: Option<Vec<u8>>,
    makers: Vec<String>,
    credited: Vec<String>,
    terrain_fingerprint: Option<Vec<u8>>,
    fingerprint_version: Option<i16>,
}

impl RuleRow {
    pub(crate) fn rule_map(&self) -> RuleMap {
        RuleMap {
            title: self.title.clone(),
            display_name: self
                .public_name
                .clone()
                .unwrap_or_else(|| self.title.clone()),
            description: self.description.clone(),
            ums_content: self.ums_content,
            first_seen_at: self.first_seen_at,
            chk_hash: self.chk_hash.clone(),
            makers: self.makers.clone(),
            credited: self.credited.clone(),
        }
    }
}

pub(crate) async fn load_rule_rows(db: &PgPool, ids: &[Uuid]) -> eyre::Result<Vec<RuleRow>> {
    sqlx::query_as!(
        RuleRow,
        r#"
            SELECT m.id as "id: SbMapId", m.title, m.public_name, m.description, m.width,
                m.height, COALESCE(m.ums_content, m.kind = 'ums') as "ums_content!",
                m.first_seen_at, a.chk_hash, a.makers, a.credited, a.terrain_fingerprint,
                a.fingerprint_version
            FROM maps m
            INNER JOIN map_analysis a ON a.map_id = m.id
            WHERE m.id = ANY($1)
        "#,
        ids,
    )
    .fetch_all(db)
    .await
    .wrap_err("Failed to load maps for family detection")
}

/// Every analyzed map's base names, for finding name candidates.
struct NameIndex {
    by_base: HashMap<String, Vec<(SbMapId, DateTime<Utc>)>>,
}

impl NameIndex {
    async fn load(db: &PgPool) -> eyre::Result<Self> {
        let rows = sqlx::query!(
            r#"
                SELECT m.id as "id: SbMapId", m.title, m.public_name, m.first_seen_at
                FROM maps m
                INNER JOIN map_analysis a ON a.map_id = m.id
            "#
        )
        .fetch_all(db)
        .await
        .wrap_err("Failed to load map names")?;
        let mut by_base: HashMap<String, Vec<(SbMapId, DateTime<Utc>)>> = HashMap::new();
        for row in rows {
            let names: BTreeSet<_> = [Some(row.title.as_str()), row.public_name.as_deref()]
                .into_iter()
                .flatten()
                .map(rules::base_name)
                .filter(|b| is_candidate_base_name(b))
                .collect();
            for name in names {
                by_base
                    .entry(name)
                    .or_default()
                    .push((row.id, row.first_seen_at));
            }
        }
        Ok(Self { by_base })
    }
}

/// A candidate pair in suggestion order (`a` < `b`).
struct Candidate {
    a: SbMapId,
    b: SbMapId,
    similarity: Option<f32>,
    name_match: bool,
}

fn ordered(x: SbMapId, y: SbMapId) -> (SbMapId, SbMapId) {
    if x.0 < y.0 { (x, y) } else { (y, x) }
}

fn verdict_status(proposal: &Proposal) -> &'static str {
    match proposal.relation {
        ProposedRelation::TerrainOnly => "terrain_only",
        ProposedRelation::Unrelated => "rejected",
        _ => "open",
    }
}

pub struct FamilyDetector {
    db: PgPool,
}

impl FamilyDetector {
    pub fn new(db: PgPool) -> Self {
        Self { db }
    }

    /// Recomputes the lines of every family marked stale, e.g. because one of its files was listed
    /// or delisted.
    pub async fn recompute_stale(&self) -> eyre::Result<()> {
        recompute_stale_families(&self.db).await
    }

    /// Scans one map for related files, e.g. right after it's stored.
    pub async fn scan_map(&self, map_id: SbMapId) -> eyre::Result<()> {
        let names = NameIndex::load(&self.db).await?;
        self.scan(map_id, &names).await
    }

    /// Scans every map at the current parser version that hasn't been scanned under the current
    /// rules, the most played first.
    pub async fn scan_outdated(&self) -> eyre::Result<()> {
        let mut names: Option<NameIndex> = None;
        let mut attempted = HashSet::new();
        let mut scanned = 0;
        loop {
            let batch = sqlx::query_scalar!(
                r#"
                    SELECT m.id as "id: SbMapId"
                    FROM maps m
                    INNER JOIN map_analysis a ON a.map_id = m.id
                    WHERE m.parser_version = $1
                        AND a.family_scan_version IS DISTINCT FROM $2
                    ORDER BY
                        (SELECT s.games_90d FROM map_stats s WHERE s.map_id = m.id)
                            DESC NULLS LAST,
                        m.id
                    LIMIT $3
                "#,
                MAP_PARSER_VERSION,
                FAMILY_RULES_VERSION,
                SCAN_BATCH_SIZE,
            )
            .fetch_all(&self.db)
            .await
            .wrap_err("Failed to load maps to scan for families")?;
            // A scanned map is marked with the current version, so one coming back means its
            // scan couldn't be recorded.
            if batch.is_empty() || batch.iter().all(|id| attempted.contains(id)) {
                break;
            }
            if names.is_none() {
                names = Some(NameIndex::load(&self.db).await?);
            }
            let names = names.as_ref().expect("name index is loaded");
            for map_id in batch {
                attempted.insert(map_id);
                self.scan(map_id, names).await?;
                scanned += 1;
            }
        }
        if scanned > 0 {
            info!(
                scanned,
                rules_version = FAMILY_RULES_VERSION,
                "Scanned maps for families"
            );
        }
        Ok(())
    }

    async fn scan(&self, map_id: SbMapId, names: &NameIndex) -> eyre::Result<()> {
        let Some(target) = load_rule_rows(&self.db, &[map_id.0]).await?.pop() else {
            return Ok(());
        };
        let mut candidates = self.find_candidates(&target, names).await?;

        let existing = sqlx::query!(
            r#"
                SELECT map_a as "map_a: SbMapId", map_b as "map_b: SbMapId", status
                FROM map_link_suggestions
                WHERE map_a = $1 OR map_b = $1
            "#,
            map_id as _,
        )
        .fetch_all(&self.db)
        .await
        .wrap_err("Failed to load existing suggestions")?;
        let existing: HashMap<_, _> = existing
            .into_iter()
            .map(|s| ((s.map_a, s.map_b), s.status))
            .collect();
        // Open suggestions are proposed again, so they reflect the map's latest analysis.
        for (&(a, b), status) in &existing {
            if status == "open" && !candidates.contains_key(&(a, b)) {
                candidates.insert(
                    (a, b),
                    Candidate {
                        a,
                        b,
                        similarity: None,
                        name_match: false,
                    },
                );
            }
        }
        candidates.retain(|key, _| existing.get(key).is_none_or(|status| status == "open"));

        let other_ids: Vec<Uuid> = candidates
            .values()
            .map(|c| if c.a == map_id { c.b.0 } else { c.a.0 })
            .collect();
        let others: HashMap<SbMapId, RuleRow> = load_rule_rows(&self.db, &other_ids)
            .await?
            .into_iter()
            .map(|row| (row.id, row))
            .collect();

        let mut tx = self
            .db
            .begin()
            .await
            .wrap_err("Failed to start transaction")?;
        for candidate in candidates.values() {
            let other_id = if candidate.a == map_id {
                candidate.b
            } else {
                candidate.a
            };
            let Some(other) = others.get(&other_id) else {
                continue;
            };
            let (row_a, row_b) = if candidate.a == map_id {
                (&target, other)
            } else {
                (other, &target)
            };
            let proposal = propose(&row_a.rule_map(), &row_b.rule_map());
            let mut status = verdict_status(&proposal);
            if proposal.rule == "same_scenario" && link_variant(&mut tx, row_a, row_b).await? {
                status = "accepted";
            }
            let decided = status != "open";
            if existing.contains_key(&(candidate.a, candidate.b)) {
                sqlx::query!(
                    r#"
                        UPDATE map_link_suggestions
                        SET verdict = $3, verdict_rules_version = $4, status = $5,
                            decided_at = CASE WHEN $6 THEN now() ELSE NULL END
                        WHERE map_a = $1 AND map_b = $2 AND status = 'open'
                    "#,
                    candidate.a as _,
                    candidate.b as _,
                    Json(&proposal) as _,
                    FAMILY_RULES_VERSION,
                    status,
                    decided,
                )
                .execute(&mut *tx)
                .await
                .wrap_err("Failed to update suggestion")?;
            } else {
                sqlx::query!(
                    r#"
                        INSERT INTO map_link_suggestions (map_a, map_b, terrain_similarity,
                            fingerprint_version, name_match, verdict, verdict_rules_version,
                            status, decided_at, created_at)
                        VALUES ($1, $2, $3, $4, $5, $6, $7, $8,
                            CASE WHEN $9 THEN now() ELSE NULL END, now())
                        ON CONFLICT (map_a, map_b) DO NOTHING
                    "#,
                    candidate.a as _,
                    candidate.b as _,
                    candidate.similarity,
                    candidate.similarity.map(|_| FINGERPRINT_VERSION),
                    candidate.name_match,
                    Json(&proposal) as _,
                    FAMILY_RULES_VERSION,
                    status,
                    decided,
                )
                .execute(&mut *tx)
                .await
                .wrap_err("Failed to insert suggestion")?;
            }
        }
        sqlx::query!(
            "UPDATE map_analysis SET family_scan_version = $2 WHERE map_id = $1",
            map_id as _,
            FAMILY_RULES_VERSION,
        )
        .execute(&mut *tx)
        .await
        .wrap_err("Failed to record family scan")?;
        tx.commit().await.wrap_err("Failed to commit family scan")?;
        Ok(())
    }

    /// The map's candidates: the most similar terrains of the same size, and for each of its
    /// base names the files sharing it (the most similar terrain first, then the newest). Pairs
    /// already in one family are left out.
    async fn find_candidates(
        &self,
        target: &RuleRow,
        names: &NameIndex,
    ) -> eyre::Result<HashMap<(SbMapId, SbMapId), Candidate>> {
        let mut similarities: HashMap<SbMapId, f32> = HashMap::new();
        let mut same_kind: HashSet<SbMapId> = HashSet::new();
        if let (Some(fingerprint), Some(version)) =
            (&target.terrain_fingerprint, target.fingerprint_version)
        {
            let same_size = sqlx::query!(
                r#"
                    SELECT m.id as "id: SbMapId", a.terrain_fingerprint as "fingerprint!",
                        COALESCE(m.ums_content, m.kind = 'ums') as "ums_content!"
                    FROM maps m
                    INNER JOIN map_analysis a ON a.map_id = m.id
                    WHERE m.width = $1 AND m.height = $2 AND a.fingerprint_version = $3
                        AND a.terrain_fingerprint IS NOT NULL AND m.id <> $4
                "#,
                target.width,
                target.height,
                version,
                target.id as _,
            )
            .fetch_all(&self.db)
            .await
            .wrap_err("Failed to load same-size fingerprints")?;
            let tiles = target.width as usize * target.height as usize;
            for row in same_size {
                if let Some(similarity) = terrain_similarity(fingerprint, &row.fingerprint, tiles) {
                    similarities.insert(row.id, similarity);
                    if row.ums_content == target.ums_content {
                        same_kind.insert(row.id);
                    }
                }
            }
        }

        let mut candidates = HashMap::new();
        let mut add = |other: SbMapId, name_match: bool| {
            let (a, b) = ordered(target.id, other);
            let entry = candidates.entry((a, b)).or_insert(Candidate {
                a,
                b,
                similarity: similarities.get(&other).copied(),
                name_match: false,
            });
            entry.name_match |= name_match;
        };

        let mut by_terrain: Vec<_> = similarities
            .iter()
            .filter(|&(_, &s)| s >= MIN_TERRAIN_SIMILARITY)
            .collect();
        // Popular maps have dozens of files with identical terrain (copies, practice maps), so
        // ties prefer files of the same kind: a melee map's versions over UMS maps built on it.
        by_terrain.sort_by(|x, y| {
            y.1.total_cmp(x.1)
                .then(same_kind.contains(y.0).cmp(&same_kind.contains(x.0)))
                .then(x.0.0.cmp(&y.0.0))
        });
        for (&other, _) in by_terrain.into_iter().take(MAX_CANDIDATES_PER_SOURCE) {
            add(other, false);
        }

        let target_names: BTreeSet<_> = target
            .rule_map()
            .base_names()
            .into_iter()
            .filter(|b| is_candidate_base_name(b))
            .collect();
        for name in &target_names {
            let Some(files) = names.by_base.get(name) else {
                continue;
            };
            let mut files: Vec<_> = files.iter().filter(|(id, _)| *id != target.id).collect();
            let order_similarity = |id: &SbMapId| {
                similarities
                    .get(id)
                    .copied()
                    .filter(|&s| s >= NAME_ORDER_MIN_SIMILARITY)
                    .unwrap_or(0.0)
            };
            files.sort_by(|(x, x_seen), (y, y_seen)| {
                order_similarity(y)
                    .total_cmp(&order_similarity(x))
                    .then(y_seen.cmp(x_seen))
            });
            for (other, _) in files.into_iter().take(MAX_CANDIDATES_PER_SOURCE) {
                add(*other, true);
            }
        }

        if candidates.is_empty() {
            return Ok(candidates);
        }
        let ids: Vec<Uuid> = candidates
            .keys()
            .flat_map(|(a, b)| [a.0, b.0])
            .collect::<HashSet<_>>()
            .into_iter()
            .collect();
        let families: HashMap<SbMapId, Uuid> = sqlx::query!(
            r#"
                SELECT map_id as "map_id: SbMapId", family_id
                FROM map_family_members
                WHERE map_id = ANY($1)
            "#,
            &ids,
        )
        .fetch_all(&self.db)
        .await
        .wrap_err("Failed to load family memberships")?
        .into_iter()
        .map(|row| (row.map_id, row.family_id))
        .collect();
        candidates.retain(|(a, b), _| match (families.get(a), families.get(b)) {
            (Some(x), Some(y)) => x != y,
            _ => true,
        });
        Ok(candidates)
    }
}

/// Links two files with identical scenarios: the one seen first is the parent, the other its
/// variant. Returns whether they were linked; files already in two different families are left
/// for staff to merge.
async fn link_variant(
    tx: &mut Transaction<'_, Postgres>,
    a: &RuleRow,
    b: &RuleRow,
) -> eyre::Result<bool> {
    lock_families(tx).await?;
    let memberships: HashMap<SbMapId, Uuid> = sqlx::query!(
        r#"
            SELECT map_id as "map_id: SbMapId", family_id
            FROM map_family_members
            WHERE map_id = ANY($1)
        "#,
        &[a.id.0, b.id.0][..],
    )
    .fetch_all(&mut **tx)
    .await
    .wrap_err("Failed to load family memberships")?
    .into_iter()
    .map(|row| (row.map_id, row.family_id))
    .collect();

    let (parent, child) = if (a.first_seen_at, a.id.0) <= (b.first_seen_at, b.id.0) {
        (a, b)
    } else {
        (b, a)
    };
    let (family_id, parent, child) = match (memberships.get(&parent.id), memberships.get(&child.id))
    {
        (None, None) => {
            let family_id =
                sqlx::query_scalar!("INSERT INTO map_families DEFAULT VALUES RETURNING id")
                    .fetch_one(&mut **tx)
                    .await
                    .wrap_err("Failed to create family")?;
            insert_member(tx, family_id, parent, None, "root").await?;
            (family_id, parent, child)
        }
        (Some(&family_id), None) => (family_id, parent, child),
        (None, Some(&family_id)) => (family_id, child, parent),
        (Some(_), Some(_)) => return Ok(false),
    };
    insert_member(tx, family_id, child, Some(parent.id), "variant").await?;
    recompute_family(tx, family_id).await?;
    Ok(true)
}

/// Takes the lock every writer to families holds until its transaction ends.
pub(crate) async fn lock_families(tx: &mut Transaction<'_, Postgres>) -> eyre::Result<()> {
    sqlx::query!("SELECT pg_advisory_xact_lock($1)", FAMILY_WRITE_LOCK_KEY)
        .execute(&mut **tx)
        .await
        .wrap_err("Failed to lock families")?;
    Ok(())
}

async fn insert_member(
    tx: &mut Transaction<'_, Postgres>,
    family_id: Uuid,
    map: &RuleRow,
    parent: Option<SbMapId>,
    relation: &str,
) -> eyre::Result<()> {
    sqlx::query!(
        r#"
            INSERT INTO map_family_members (map_id, family_id, parent_map_id, relation,
                version_label, source, linked_at, line_root_id, line_current_id)
            VALUES ($1, $2, $3, $4::text::map_family_relation, $5, 'rule', now(), $1, $1)
        "#,
        map.id as _,
        family_id,
        parent as _,
        relation,
        map.rule_map().version(),
    )
    .execute(&mut **tx)
    .await
    .wrap_err("Failed to add family member")?;
    Ok(())
}

struct MemberRow {
    map_id: SbMapId,
    parent_map_id: Option<SbMapId>,
    relation: String,
    version_label: Option<String>,
    pinned_current: bool,
    listed: bool,
    first_seen_at: DateTime<Utc>,
}

/// A family member's place in its line, as derived from the tree.
#[derive(Debug, Clone, Copy, Eq, PartialEq)]
struct LinePlace {
    line_root: SbMapId,
    line_current: SbMapId,
}

/// Derives every member's line and each line's current version: a line starts at the root, a fork,
/// or a member whose parent is gone. Its current is the pinned member (unless it's unlisted while
/// another member is listed), else the deepest listed version (version label, then first seen,
/// breaking ties), else the deepest member. A variant or translation is only current when it's
/// listed and the version it belongs to isn't, standing in for it.
fn derive_lines(members: &[MemberRow]) -> HashMap<SbMapId, LinePlace> {
    let by_id: HashMap<SbMapId, &MemberRow> = members.iter().map(|m| (m.map_id, m)).collect();
    let starts_line = |m: &MemberRow| {
        m.relation == "root"
            || m.relation == "fork"
            || m.parent_map_id.is_none_or(|p| !by_id.contains_key(&p))
    };
    // (line root, depth in versions)
    let mut places: HashMap<SbMapId, (SbMapId, u32)> = HashMap::new();
    for member in members {
        let mut path = vec![member];
        let mut current = member;
        while !starts_line(current) && path.len() <= members.len() {
            current = by_id[&current
                .parent_map_id
                .expect("non-start members have a parent")];
            path.push(current);
        }
        let mut root = current.map_id;
        let mut depth = 0;
        for m in path.iter().rev() {
            if starts_line(m) {
                root = m.map_id;
                depth = 0;
            } else if m.relation == "version" {
                depth += 1;
            }
        }
        places.insert(member.map_id, (root, depth));
    }

    let mut current_by_line: HashMap<SbMapId, SbMapId> = HashMap::new();
    let mut lines: HashMap<SbMapId, Vec<&MemberRow>> = HashMap::new();
    for member in members {
        lines
            .entry(places[&member.map_id].0)
            .or_default()
            .push(member);
    }
    for (root, line) in lines {
        let any_listed = line.iter().any(|m| m.listed);
        let current = line
            .iter()
            .find(|m| m.pinned_current && (m.listed || !any_listed))
            .or_else(|| {
                line.iter()
                    .filter(|m| {
                        m.map_id == root
                            || m.relation == "version"
                            || (m.listed
                                && (m.relation == "variant" || m.relation == "translation"))
                    })
                    .max_by(|x, y| {
                        let key = |m: &MemberRow| {
                            (
                                m.listed,
                                places[&m.map_id].1,
                                m.map_id == root || m.relation == "version",
                                m.version_label.as_deref().and_then(VersionKey::parse),
                                m.first_seen_at,
                            )
                        };
                        let (kx, ky) = (key(x), key(y));
                        kx.0.cmp(&ky.0)
                            .then(kx.1.cmp(&ky.1))
                            .then(kx.2.cmp(&ky.2))
                            .then(kx.3.partial_cmp(&ky.3).unwrap_or(std::cmp::Ordering::Equal))
                            .then(kx.4.cmp(&ky.4))
                    })
            })
            .map_or(root, |m| m.map_id);
        current_by_line.insert(root, current);
    }
    members
        .iter()
        .map(|m| {
            let root = places[&m.map_id].0;
            (
                m.map_id,
                LinePlace {
                    line_root: root,
                    line_current: current_by_line[&root],
                },
            )
        })
        .collect()
}

/// Recomputes every family marked stale. Each family is recomputed in its own transaction.
pub(crate) async fn recompute_stale_families(db: &PgPool) -> eyre::Result<()> {
    let stale = sqlx::query_scalar!("SELECT id FROM map_families WHERE stale")
        .fetch_all(db)
        .await
        .wrap_err("Failed to load stale families")?;
    for family_id in stale {
        let mut tx = db.begin().await.wrap_err("Failed to start transaction")?;
        lock_families(&mut tx).await?;
        recompute_family(&mut tx, family_id).await?;
        tx.commit()
            .await
            .wrap_err("Failed to commit family recompute")?;
    }
    Ok(())
}

/// Rewrites a family's derived columns after its tree changed. A family left with fewer than two
/// members is deleted: one file on its own isn't a family.
pub(crate) async fn recompute_family(
    tx: &mut Transaction<'_, Postgres>,
    family_id: Uuid,
) -> eyre::Result<()> {
    let members = sqlx::query_as!(
        MemberRow,
        r#"
            SELECT f.map_id as "map_id: SbMapId", f.parent_map_id as "parent_map_id: SbMapId",
                f.relation::text as "relation!", f.version_label, f.pinned_current, m.listed as "listed!",
                m.first_seen_at
            FROM map_family_members f
            INNER JOIN maps m ON m.id = f.map_id
            WHERE f.family_id = $1
        "#,
        family_id,
    )
    .fetch_all(&mut **tx)
    .await
    .wrap_err("Failed to load family members")?;
    if members.len() < 2 {
        sqlx::query!("DELETE FROM map_families WHERE id = $1", family_id)
            .execute(&mut **tx)
            .await
            .wrap_err("Failed to delete family")?;
        return Ok(());
    }
    let places = derive_lines(&members);
    let family_root = members
        .iter()
        .filter(|m| m.relation == "root")
        .chain(members.iter())
        .map(|m| places[&m.map_id].line_root)
        .next();

    let mut ids = Vec::with_capacity(places.len());
    let mut roots = Vec::with_capacity(places.len());
    let mut currents = Vec::with_capacity(places.len());
    for (id, place) in &places {
        ids.push(id.0);
        roots.push(place.line_root.0);
        currents.push(place.line_current.0);
    }
    sqlx::query!(
        r#"
            UPDATE map_family_members AS f
            SET line_root_id = v.line_root, line_current_id = v.line_current
            FROM unnest($1::uuid[], $2::uuid[], $3::uuid[]) AS v(map_id, line_root, line_current)
            WHERE f.map_id = v.map_id
        "#,
        &ids,
        &roots,
        &currents,
    )
    .execute(&mut **tx)
    .await
    .wrap_err("Failed to update family lines")?;
    sqlx::query!(
        r#"
            UPDATE map_families
            SET current_map_id = $2, stale = false, updated_at = now()
            WHERE id = $1
        "#,
        family_id,
        family_root.map(|root| places[&root].line_current) as _,
    )
    .execute(&mut **tx)
    .await
    .wrap_err("Failed to update family")?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::maps::families::rules::Older;

    fn id(n: u8) -> SbMapId {
        SbMapId(Uuid::from_bytes([n; 16]))
    }

    fn member(n: u8, parent: Option<u8>, relation: &str, version: &str, listed: bool) -> MemberRow {
        MemberRow {
            map_id: id(n),
            parent_map_id: parent.map(id),
            relation: relation.into(),
            version_label: Some(version.into()),
            pinned_current: false,
            listed,
            first_seen_at: DateTime::UNIX_EPOCH,
        }
    }

    #[test]
    fn similarity_ignores_tiles_unwalkable_in_both() {
        // 4 tiles per byte, low bits first: [0, 1, 3, 3] and [0, 2, 3, 3].
        let a = [0b1111_0100];
        let b = [0b1111_1000];
        assert_eq!(terrain_similarity(&a, &b, 4), Some(0.5));
        assert_eq!(terrain_similarity(&a, &a, 4), Some(1.0));
        assert_eq!(terrain_similarity(&a, &[0, 0], 4), None);
    }

    #[test]
    fn current_is_the_deepest_listed_version_of_each_line() {
        let members = [
            member(1, None, "root", "1.22", true),
            member(2, Some(1), "version", "1.65", true),
            member(3, Some(2), "version", "1.75", true),
            member(4, Some(3), "variant", "1.75", true),
            member(5, Some(2), "fork", "1.0", true),
            member(6, Some(5), "version", "1.1", false),
        ];
        let places = derive_lines(&members);
        assert_eq!(places[&id(1)].line_current, id(3));
        assert_eq!(places[&id(4)].line_root, id(1));
        assert_eq!(places[&id(4)].line_current, id(3));
        // The fork's newer version is unlisted, so the fork itself stays current.
        assert_eq!(places[&id(6)].line_root, id(5));
        assert_eq!(places[&id(6)].line_current, id(5));
    }

    #[test]
    fn a_listed_variant_stands_in_for_its_unlisted_version() {
        let members = [
            member(1, None, "root", "1.0", true),
            member(2, Some(1), "version", "2.0", false),
            member(3, Some(2), "variant", "2.0", true),
            member(4, Some(1), "variant", "1.0", true),
        ];
        assert_eq!(derive_lines(&members)[&id(1)].line_current, id(3));

        let mut listed = members;
        listed[1].listed = true;
        assert_eq!(derive_lines(&listed)[&id(1)].line_current, id(2));
    }

    #[test]
    fn pinned_member_is_current() {
        let mut members = vec![
            member(1, None, "root", "1.0", true),
            member(2, Some(1), "version", "2.0", true),
        ];
        members[0].pinned_current = true;
        assert_eq!(derive_lines(&members)[&id(2)].line_current, id(1));
    }

    /// Checks the rules against hand-checked reference outputs: per-file credits, versions and
    /// base names, and every candidate pair's proposal. `SB_FAMILY_BENCH` is a directory holding:
    ///
    /// - `files.json`: `{ <file hash>: { title, sb_name, description, uploaded, chk } }`, where
    ///   `uploaded` is the first-seen time in Unix millis and `chk` the CHK hash (or null)
    /// - `reference.json`: `{ files: { <file hash>: { ums, makers, credited, version, base_title,
    ///   base_sb } }, pairs: [{ a, b, relation, older }] }`, where `a`/`b` are file hashes and
    ///   `older` is `"a"`, `"b"` or null
    ///
    /// `SB_FAMILY_BENCH=<dir> cargo test --lib -- --ignored family_bench_reference`
    #[test]
    #[ignore]
    fn family_bench_reference() {
        use crate::maps::credits::parse_credits;
        use serde_json::Value;

        let dir = std::path::PathBuf::from(std::env::var("SB_FAMILY_BENCH").unwrap());
        let read = |name: &str| -> Value {
            serde_json::from_slice(&std::fs::read(dir.join(name)).unwrap()).unwrap()
        };
        let files = read("files.json");
        let reference = read("reference.json");
        let mut maps = HashMap::new();
        let mut mismatches = Vec::new();
        for (hash, file) in files.as_object().unwrap() {
            let expected = &reference["files"][hash];
            let description = file["description"].as_str().unwrap();
            let credits = parse_credits(description);
            let map = RuleMap {
                title: file["title"].as_str().unwrap().into(),
                display_name: file["sb_name"].as_str().unwrap().into(),
                description: description.into(),
                ums_content: expected["ums"].as_bool().unwrap(),
                first_seen_at: DateTime::from_timestamp_millis(
                    file["uploaded"].as_i64().unwrap_or(0),
                )
                .unwrap(),
                chk_hash: file["chk"].as_str().map(|c| c.as_bytes().to_vec()),
                makers: credits.makers.clone(),
                credited: credits.credited.clone(),
            };
            let got = serde_json::json!({
                "makers": credits.makers,
                "credited": credits.credited,
                "version": map.version(),
                "base_title": rules::base_name(&map.title),
                "base_sb": rules::base_name(&map.display_name),
            });
            for key in ["makers", "credited", "version", "base_title", "base_sb"] {
                if got[key] != expected[key] {
                    mismatches.push(format!(
                        "{} {key}: got {} expected {}",
                        &hash[..8],
                        got[key],
                        expected[key]
                    ));
                }
            }
            maps.insert(hash.clone(), map);
        }
        let mut pairs = 0;
        for pair in reference["pairs"].as_array().unwrap() {
            let a = &maps[pair["a"].as_str().unwrap()];
            let b = &maps[pair["b"].as_str().unwrap()];
            let proposal = propose(a, b);
            let got = serde_json::json!({
                "relation": proposal.relation,
                "older": proposal.older.map(|o| match o { Older::A => "a", Older::B => "b" }),
            });
            if got["relation"] != pair["relation"] || got["older"] != pair["older"] {
                mismatches.push(format!(
                    "pair {}-{}: got {got} expected {}/{}",
                    &pair["a"].as_str().unwrap()[..8],
                    &pair["b"].as_str().unwrap()[..8],
                    pair["relation"],
                    pair["older"]
                ));
            }
            pairs += 1;
        }
        assert!(
            mismatches.is_empty(),
            "{} mismatches over {} files and {pairs} pairs:\n{}",
            mismatches.len(),
            maps.len(),
            mismatches.join("\n")
        );
    }
}
