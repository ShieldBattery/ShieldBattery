//! The staff families queue: open suggestions grouped into proposals (the files of connected open
//! suggestions, joined through the families they touch), each with a tree built from the rules'
//! proposals for staff to accept or edit.

use std::cmp::Ordering;
use std::collections::{BTreeSet, HashMap, HashSet};

use async_graphql::dataloader::DataLoader;
use async_graphql::{Context, Object, Result};
use chrono::{DateTime, Utc};
use color_eyre::eyre::{self, WrapErr};
use serde_json::Value;
use sqlx::PgPool;
use sqlx::types::Json;
use uuid::Uuid;

use crate::maps::SbMapId;
use crate::maps::catalog::{SbMap, SbMapLoader};
use crate::maps::families::MapFamilyRelation;
use crate::maps::families::graphql::{
    MapFamily, MapFamilyId, MapFamilyLoader, MapFamilyProposedLink, MapLinkSuggestion,
};
use crate::maps::families::rules::{ProposedRelation, VersionKey, file_version};
use crate::users::SbUserId;

pub struct MapFamilyProposal {
    map_ids: Vec<SbMapId>,
    family_ids: Vec<Uuid>,
    suggestions: Vec<MapLinkSuggestion>,
    links: Vec<MapFamilyProposedLink>,
    games: i64,
}

/// A group of possibly related files for staff to sort.
#[Object]
impl MapFamilyProposal {
    /// Identifies the group by its smallest map id. Changes as the group changes.
    async fn id(&self) -> String {
        let first = self.map_ids.iter().min_by_key(|id| id.0);
        format!(
            "map-family-proposal:{}",
            first.map_or(Uuid::nil(), |id| id.0)
        )
    }

    /// The files with open suggestions, the most played first.
    async fn maps(&self, ctx: &Context<'_>) -> Result<Vec<SbMap>> {
        let mut maps = ctx
            .data::<DataLoader<SbMapLoader>>()?
            .load_many(self.map_ids.iter().copied())
            .await?;
        Ok(self
            .map_ids
            .iter()
            .filter_map(|id| maps.remove(id))
            .collect())
    }

    /// The families those files are already in.
    async fn families(&self, ctx: &Context<'_>) -> Result<Vec<MapFamily>> {
        let mut families = ctx
            .data::<DataLoader<MapFamilyLoader>>()?
            .load_many(self.family_ids.iter().map(|&id| MapFamilyId(id)))
            .await?;
        Ok(self
            .family_ids
            .iter()
            .filter_map(|&id| families.remove(&MapFamilyId(id)))
            .map(MapFamily::new)
            .collect())
    }

    /// The open suggestions between the files.
    async fn suggestions(&self) -> &[MapLinkSuggestion] {
        &self.suggestions
    }

    /// A place for each file that isn't in a family yet, from the rules' proposals. Files the
    /// proposals don't place are roots of their own trees.
    async fn proposed_links(&self) -> &[MapFamilyProposedLink] {
        &self.links
    }

    /// All-time games across the files.
    async fn games(&self) -> i32 {
        i32::try_from(self.games).unwrap_or(i32::MAX)
    }
}

impl MapFamilyProposal {
    pub fn is_empty(&self) -> bool {
        self.map_ids.is_empty()
    }
}

struct UnionFind {
    parent: HashMap<SbMapId, SbMapId>,
}

impl UnionFind {
    fn new() -> Self {
        Self {
            parent: HashMap::new(),
        }
    }

    fn find(&mut self, x: SbMapId) -> SbMapId {
        let parent = *self.parent.entry(x).or_insert(x);
        if parent == x {
            return x;
        }
        let root = self.find(parent);
        self.parent.insert(x, root);
        root
    }

    fn union(&mut self, x: SbMapId, y: SbMapId) {
        let (x, y) = (self.find(x), self.find(y));
        if x != y {
            self.parent.insert(x, y);
        }
    }
}

/// What the tree building knows about a file.
#[derive(Debug, Clone)]
struct TreeFile {
    first_seen_at: DateTime<Utc>,
    family: Option<Uuid>,
    version: Option<String>,
}

/// An edge of a proposed tree: `child` goes under `parent`.
#[derive(Debug, Clone)]
struct TreeEdge {
    parent: SbMapId,
    child: SbMapId,
    relation: MapFamilyRelation,
    similarity: f32,
}

fn tree_edge(
    suggestion: &MapLinkSuggestion,
    files: &HashMap<SbMapId, TreeFile>,
) -> Option<TreeEdge> {
    let relation = match suggestion.proposed_relation()? {
        ProposedRelation::Version => MapFamilyRelation::Version,
        ProposedRelation::Variant => MapFamilyRelation::Variant,
        ProposedRelation::Translation => MapFamilyRelation::Translation,
        ProposedRelation::Fork => MapFamilyRelation::Fork,
        ProposedRelation::TerrainOnly | ProposedRelation::Unrelated => return None,
    };
    let (a, b) = (suggestion.map_a, suggestion.map_b);
    let older = suggestion.older().unwrap_or_else(|| {
        let seen = |id| files.get(&id).map(|f| f.first_seen_at);
        if (seen(a), a.0) <= (seen(b), b.0) {
            a
        } else {
            b
        }
    });
    let newer = if older == a { b } else { a };
    Some(TreeEdge {
        parent: older,
        child: newer,
        relation,
        similarity: suggestion.terrain_similarity.unwrap_or(0.0),
    })
}

/// Builds a proposed tree over one group: each file not yet in a family goes under the older side
/// of its best edge (versions, variants and translations before forks, then the newest version
/// older than it, so a chain of versions links each to the one before, then the most similar
/// terrain), skipping edges that would close a cycle. Files in families keep their place.
fn propose_tree(
    map_ids: &[SbMapId],
    suggestions: &[&MapLinkSuggestion],
    files: &HashMap<SbMapId, TreeFile>,
) -> Vec<MapFamilyProposedLink> {
    let mut edges: Vec<TreeEdge> = suggestions
        .iter()
        .filter_map(|s| tree_edge(s, files))
        .collect();
    let version = |id: &SbMapId| {
        files
            .get(id)
            .and_then(|f| f.version.as_deref())
            .and_then(VersionKey::parse)
    };
    edges.sort_by(|x, y| {
        (x.relation == MapFamilyRelation::Fork)
            .cmp(&(y.relation == MapFamilyRelation::Fork))
            .then(
                version(&y.parent)
                    .partial_cmp(&version(&x.parent))
                    .unwrap_or(Ordering::Equal),
            )
            .then(
                y.similarity
                    .partial_cmp(&x.similarity)
                    .unwrap_or(Ordering::Equal),
            )
            .then(x.child.0.cmp(&y.child.0))
            .then(x.parent.0.cmp(&y.parent.0))
    });

    let in_family = |id: &SbMapId| files.get(id).is_some_and(|f| f.family.is_some());
    let mut trees = UnionFind::new();
    // Files in one family are already connected.
    let mut family_members: HashMap<Uuid, SbMapId> = HashMap::new();
    for id in map_ids {
        if let Some(family) = files.get(id).and_then(|f| f.family) {
            match family_members.get(&family) {
                Some(&other) => trees.union(other, *id),
                None => {
                    family_members.insert(family, *id);
                }
            }
        }
    }

    let mut placed: HashMap<SbMapId, (SbMapId, MapFamilyRelation)> = HashMap::new();
    for edge in edges {
        if in_family(&edge.child) || placed.contains_key(&edge.child) {
            continue;
        }
        if trees.find(edge.parent) == trees.find(edge.child) {
            continue;
        }
        trees.union(edge.parent, edge.child);
        placed.insert(edge.child, (edge.parent, edge.relation));
    }

    let mut links: Vec<MapFamilyProposedLink> = map_ids
        .iter()
        .filter(|id| !in_family(id))
        .map(|&map_id| {
            let (parent_id, relation) = match placed.get(&map_id) {
                Some(&(parent, relation)) => (Some(parent), relation),
                None => (None, MapFamilyRelation::Root),
            };
            MapFamilyProposedLink {
                map_id,
                parent_id,
                relation,
                version_label: files.get(&map_id).and_then(|f| f.version.clone()),
            }
        })
        .collect();
    // Parents before their children, so the links can be applied in order.
    let depth = |mut id: SbMapId| {
        let mut depth = 0;
        while let Some(&(parent, _)) = placed.get(&id) {
            id = parent;
            depth += 1;
            if depth > map_ids.len() {
                break;
            }
        }
        depth
    };
    links.sort_by_key(|l| (depth(l.map_id), l.map_id.0));
    links
}

struct FileRow {
    id: SbMapId,
    title: String,
    description: String,
    public_name: Option<String>,
    first_seen_at: DateTime<Utc>,
    family_id: Option<Uuid>,
    games_total: Option<i32>,
}

/// Loads every proposal, the most played first.
pub async fn load_proposals(db: &PgPool) -> eyre::Result<Vec<MapFamilyProposal>> {
    // Pairs already in one family were settled by linking, so they aren't waiting for anyone.
    let suggestions = sqlx::query_as!(
        MapLinkSuggestion,
        r#"
            SELECT s.map_a as "map_a: SbMapId", s.map_b as "map_b: SbMapId",
                s.terrain_similarity, s.name_match, s.verdict as "verdict: Json<Value>", s.status,
                s.decided_by as "decided_by: SbUserId", s.decided_at, s.created_at
            FROM map_link_suggestions s
            WHERE s.status = 'open'
                AND NOT EXISTS (
                    SELECT 1
                    FROM map_family_members fa
                    INNER JOIN map_family_members fb ON fb.family_id = fa.family_id
                    WHERE fa.map_id = s.map_a AND fb.map_id = s.map_b
                )
        "#
    )
    .fetch_all(db)
    .await
    .wrap_err("Failed to load open suggestions")?;
    if suggestions.is_empty() {
        return Ok(Vec::new());
    }

    let ids: Vec<Uuid> = suggestions
        .iter()
        .flat_map(|s| [s.map_a.0, s.map_b.0])
        .collect::<HashSet<_>>()
        .into_iter()
        .collect();
    // Scalar subqueries rather than outer joins: sqlx infers outer-join nullability differently
    // across Postgres versions.
    let rows = sqlx::query_as!(
        FileRow,
        r#"
            SELECT m.id as "id: SbMapId", m.title, m.description, m.public_name, m.first_seen_at,
                (SELECT f.family_id FROM map_family_members f WHERE f.map_id = m.id)
                    as "family_id?",
                (SELECT s.games_total FROM map_stats s WHERE s.map_id = m.id) as "games_total?"
            FROM maps m
            WHERE m.id = ANY($1)
        "#,
        &ids,
    )
    .fetch_all(db)
    .await
    .wrap_err("Failed to load proposal files")?;

    let mut groups = UnionFind::new();
    let mut family_members: HashMap<Uuid, SbMapId> = HashMap::new();
    let mut files = HashMap::new();
    let mut games = HashMap::new();
    for row in rows {
        if let Some(family_id) = row.family_id {
            match family_members.get(&family_id) {
                Some(&other) => groups.union(other, row.id),
                None => {
                    family_members.insert(family_id, row.id);
                }
            }
        }
        let display_name = row.public_name.as_deref().unwrap_or(&row.title);
        files.insert(
            row.id,
            TreeFile {
                first_seen_at: row.first_seen_at,
                family: row.family_id,
                version: file_version(&row.title, &row.description, display_name),
            },
        );
        games.insert(
            row.id,
            (i64::from(row.games_total.unwrap_or(0)), row.family_id),
        );
    }
    for s in &suggestions {
        groups.union(s.map_a, s.map_b);
    }

    let mut by_group: HashMap<SbMapId, (BTreeSet<Uuid>, Vec<&MapLinkSuggestion>)> = HashMap::new();
    for s in &suggestions {
        let entry = by_group.entry(groups.find(s.map_a)).or_default();
        entry.0.insert(s.map_a.0);
        entry.0.insert(s.map_b.0);
        entry.1.push(s);
    }

    let mut proposals: Vec<MapFamilyProposal> = by_group
        .into_values()
        .map(|(ids, group_suggestions)| {
            let mut map_ids: Vec<SbMapId> = ids.into_iter().map(SbMapId).collect();
            let game_count = |id: &SbMapId| games.get(id).map_or(0, |g| g.0);
            map_ids.sort_by(|x, y| game_count(y).cmp(&game_count(x)).then(x.0.cmp(&y.0)));
            let family_ids: Vec<Uuid> = map_ids
                .iter()
                .filter_map(|id| games.get(id).and_then(|g| g.1))
                .collect::<BTreeSet<_>>()
                .into_iter()
                .collect();
            let links = propose_tree(&map_ids, &group_suggestions, &files);
            MapFamilyProposal {
                games: map_ids.iter().map(game_count).sum(),
                suggestions: group_suggestions.into_iter().cloned().collect(),
                map_ids,
                family_ids,
                links,
            }
        })
        .collect();
    proposals.sort_by(|x, y| {
        y.games
            .cmp(&x.games)
            .then(x.map_ids[0].0.cmp(&y.map_ids[0].0))
    });
    Ok(proposals)
}

/// Loads the groups `map_ids` are in, merged into one: the proposals holding the maps or their
/// families, plus the maps no proposal holds (with their families, if they're in one). Old ids
/// resolve to their maps, and ids that match no map are left out.
pub async fn load_group(db: &PgPool, map_ids: &[SbMapId]) -> eyre::Result<MapFamilyProposal> {
    let ids: Vec<Uuid> = map_ids.iter().map(|id| id.0).collect();
    let rows = sqlx::query!(
        r#"
            SELECT m.id as "id: SbMapId",
                (SELECT f.family_id FROM map_family_members f WHERE f.map_id = m.id)
                    as "family_id?",
                (SELECT s.games_total FROM map_stats s WHERE s.map_id = m.id) as "games_total?"
            FROM maps m
            WHERE m.id IN (
                SELECT COALESCE((SELECT a.map_id FROM map_id_aliases a WHERE a.old_id = x), x)
                FROM unnest($1::uuid[]) x
            )
        "#,
        &ids,
    )
    .fetch_all(db)
    .await
    .wrap_err("Failed to load the maps' families")?;

    let mut group = MapFamilyProposal {
        map_ids: Vec::new(),
        family_ids: Vec::new(),
        suggestions: Vec::new(),
        links: Vec::new(),
        games: 0,
    };
    let mut proposals = load_proposals(db).await?;
    let mut held: HashSet<SbMapId> = HashSet::new();
    for row in &rows {
        if held.contains(&row.id) {
            continue;
        }
        let found = proposals.iter().position(|p| {
            p.map_ids.contains(&row.id) || row.family_id.is_some_and(|f| p.family_ids.contains(&f))
        });
        if let Some(index) = found {
            let p = proposals.swap_remove(index);
            held.extend(p.map_ids.iter().copied());
            group.map_ids.extend(p.map_ids);
            group.family_ids.extend(p.family_ids);
            group.suggestions.extend(p.suggestions);
            group.links.extend(p.links);
            group.games += p.games;
        }
    }
    for row in rows {
        if !held.insert(row.id) {
            continue;
        }
        group.map_ids.push(row.id);
        group.family_ids.extend(row.family_id);
        group.games += i64::from(row.games_total.unwrap_or(0));
    }
    let mut seen_families = HashSet::new();
    group.family_ids.retain(|id| seen_families.insert(*id));
    Ok(group)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn id(n: u8) -> SbMapId {
        SbMapId(Uuid::from_bytes([n; 16]))
    }

    fn file(seen: i64, in_family: bool) -> TreeFile {
        TreeFile {
            first_seen_at: DateTime::from_timestamp(seen, 0).unwrap(),
            family: in_family.then(Uuid::nil),
            version: None,
        }
    }

    fn versioned(seen: i64, version: &str) -> TreeFile {
        TreeFile {
            version: Some(version.into()),
            ..file(seen, false)
        }
    }

    fn suggestion(
        a: u8,
        b: u8,
        relation: &str,
        older: Option<&str>,
        sim: f32,
    ) -> MapLinkSuggestion {
        MapLinkSuggestion {
            map_a: id(a),
            map_b: id(b),
            terrain_similarity: Some(sim),
            name_match: true,
            verdict: Json(serde_json::json!({ "relation": relation, "older": older, "rule": "r" })),
            status: "open".into(),
            decided_by: None,
            decided_at: None,
            created_at: DateTime::UNIX_EPOCH,
        }
    }

    fn placed(links: &[MapFamilyProposedLink]) -> Vec<(u8, Option<u8>, MapFamilyRelation)> {
        links
            .iter()
            .map(|l| {
                (
                    l.map_id.0.as_bytes()[0],
                    l.parent_id.map(|p| p.0.as_bytes()[0]),
                    l.relation,
                )
            })
            .collect()
    }

    #[test]
    fn tree_follows_the_rules_versions() {
        use MapFamilyRelation::*;
        let files = HashMap::from([
            (id(1), file(1, false)),
            (id(2), file(2, false)),
            (id(3), file(3, false)),
        ]);
        let suggestions = [
            suggestion(1, 2, "version", Some("a"), 0.95),
            suggestion(2, 3, "version", Some("a"), 0.97),
            suggestion(1, 3, "version", Some("a"), 0.93),
        ];
        let refs: Vec<_> = suggestions.iter().collect();
        let links = propose_tree(&[id(1), id(2), id(3)], &refs, &files);
        // 3 goes under 2 (its most similar edge), and 1 is the root.
        assert_eq!(
            placed(&links),
            [
                (1, None, Root),
                (2, Some(1), Version),
                (3, Some(2), Version)
            ]
        );
    }

    #[test]
    fn versions_go_under_the_closest_older_version() {
        use MapFamilyRelation::*;
        let files = HashMap::from([
            (id(1), versioned(1, "1.22")),
            (id(2), versioned(2, "1.60")),
            (id(3), versioned(3, "1.65")),
            (id(4), versioned(4, "1.72")),
        ]);
        // Every pair is a version pair with identical terrain, so similarity can't order them.
        let suggestions: Vec<_> = [(1, 2), (1, 3), (1, 4), (2, 3), (2, 4), (3, 4)]
            .into_iter()
            .map(|(a, b)| suggestion(a, b, "version", Some("a"), 1.0))
            .collect();
        let refs: Vec<_> = suggestions.iter().collect();
        let links = propose_tree(&[id(1), id(2), id(3), id(4)], &refs, &files);
        assert_eq!(
            placed(&links),
            [
                (1, None, Root),
                (2, Some(1), Version),
                (3, Some(2), Version),
                (4, Some(3), Version),
            ]
        );
    }

    #[test]
    fn forks_lose_to_versions_and_family_members_stay_put() {
        use MapFamilyRelation::*;
        let files = HashMap::from([
            (id(1), file(1, true)),
            (id(2), file(2, false)),
            (id(3), file(3, false)),
        ]);
        let suggestions = [
            suggestion(1, 3, "fork", Some("a"), 0.99),
            suggestion(2, 3, "version", Some("a"), 0.91),
            suggestion(1, 2, "version", Some("b"), 0.95),
        ];
        let refs: Vec<_> = suggestions.iter().collect();
        let links = propose_tree(&[id(1), id(2), id(3)], &refs, &files);
        // 1 is in a family, so it's never placed even though the rules call 2 older than it.
        assert_eq!(placed(&links), [(2, None, Root), (3, Some(2), Version)]);
    }

    #[test]
    fn unknown_age_falls_back_to_first_seen() {
        let files = HashMap::from([(id(1), file(5, false)), (id(2), file(1, false))]);
        let s = suggestion(1, 2, "variant", None, 1.0);
        let edge = tree_edge(&s, &files).unwrap();
        assert_eq!((edge.parent, edge.child), (id(2), id(1)));
        assert!(tree_edge(&suggestion(1, 2, "terrain_only", None, 1.0), &files).is_none());
    }
}
