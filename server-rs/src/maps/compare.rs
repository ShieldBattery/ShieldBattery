//! Comparing two maps, e.g. two versions of one map: what changed in their size, slots, triggers,
//! start locations, bases and terrain. Computed from the stored analysis, without reading files.

use std::collections::BTreeSet;

use async_graphql::{ComplexObject, Context, Enum, Object, Result, SimpleObject};
use color_eyre::eyre::{self, WrapErr};
use data_encoding::BASE64;
use serde_json::Value;
use sqlx::PgPool;
use sqlx::types::Json;

use crate::maps::SbMapId;
use crate::maps::catalog::SbMap;
use crate::maps::families::graphql::load_sb_map;
use crate::maps::families::terrain_similarity;
use crate::maps::parse::{MapBase, MapStartLocation};

/// How far apart (in pixels) two bases' town hall positions may be to count as the same base.
const BASE_MATCH_DISTANCE: f64 = 2.0 * 32.0;

/// Something that differs between two maps.
#[derive(Enum, Copy, Clone, Debug, Eq, PartialEq, Ord, PartialOrd)]
pub enum MapChange {
    Name,
    Description,
    Dimensions,
    Tileset,
    PlayerCount,
    /// The forces (teams) and their slots' races and controllers.
    Forces,
    Eud,
    /// The trigger actions the maps use that melee games don't.
    UmsActions,
    TriggerCount,
    StartLocations,
    Bases,
    /// The walkable shape of the terrain (only compared between maps of the same dimensions).
    Terrain,
}

/// One map's side of a comparison.
struct Side {
    id: SbMapId,
    name: String,
    description: String,
    width: i32,
    height: i32,
    tileset: i32,
    player_count: i32,
    is_eud: bool,
    forces: Value,
    start_locations: Vec<MapStartLocation>,
    trigger_count: Option<i32>,
    ums_action_kinds: Option<Vec<String>>,
    bases: Option<Vec<MapBase>>,
    fingerprint: Option<(Vec<u8>, i16)>,
}

async fn load_side(db: &PgPool, id: SbMapId) -> eyre::Result<Side> {
    let map = sqlx::query!(
        r#"
            SELECT name as "name!", COALESCE(public_description, description) as "description!",
                width, height, tileset, player_count, is_eud,
                lobby_init_data->'forces' as "forces!: Json<Value>",
                start_locations as "start_locations: Json<Vec<MapStartLocation>>"
            FROM maps
            WHERE id = $1
        "#,
        id as _,
    )
    .fetch_one(db)
    .await
    .wrap_err("Failed to load map for comparison")?;
    let analysis = sqlx::query!(
        r#"
            SELECT trigger_count, ums_action_kinds, bases as "bases: Json<Vec<MapBase>>",
                terrain_fingerprint, fingerprint_version
            FROM map_analysis
            WHERE map_id = $1
        "#,
        id as _,
    )
    .fetch_optional(db)
    .await
    .wrap_err("Failed to load map analysis for comparison")?;
    Ok(Side {
        id,
        name: map.name,
        description: map.description,
        width: map.width,
        height: map.height,
        tileset: map.tileset,
        player_count: map.player_count,
        is_eud: map.is_eud,
        forces: map.forces.0,
        start_locations: map.start_locations.0,
        trigger_count: analysis.as_ref().map(|a| a.trigger_count),
        ums_action_kinds: analysis.as_ref().map(|a| a.ums_action_kinds.clone()),
        bases: analysis
            .as_ref()
            .and_then(|a| a.bases.as_ref().map(|b| b.0.clone())),
        fingerprint: analysis.and_then(|a| a.terrain_fingerprint.zip(a.fingerprint_version)),
    })
}

/// What happened to a start location between two maps.
#[derive(Enum, Copy, Clone, Debug, Eq, PartialEq)]
pub enum MapStartLocationChangeKind {
    Moved,
    Added,
    Removed,
}

/// A player slot whose start location differs between two maps. Positions are in map pixels.
#[derive(SimpleObject, Clone, Debug)]
#[graphql(complex)]
pub struct MapStartLocationChange {
    #[graphql(skip)]
    pub comparison_id: String,
    pub slot: i32,
    pub kind: MapStartLocationChangeKind,
    pub before_x: Option<i32>,
    pub before_y: Option<i32>,
    pub after_x: Option<i32>,
    pub after_y: Option<i32>,
}

#[ComplexObject]
impl MapStartLocationChange {
    async fn id(&self) -> String {
        format!("{}:start:{}", self.comparison_id, self.slot)
    }
}

fn compare_start_locations(
    comparison_id: &str,
    before: &[MapStartLocation],
    after: &[MapStartLocation],
) -> Vec<MapStartLocationChange> {
    let slots: BTreeSet<u8> = before.iter().chain(after).map(|s| s.slot).collect();
    slots
        .into_iter()
        .filter_map(|slot| {
            let b = before.iter().find(|s| s.slot == slot);
            let a = after.iter().find(|s| s.slot == slot);
            let kind = match (b, a) {
                (Some(b), Some(a)) if (b.x, b.y) == (a.x, a.y) => return None,
                (Some(_), Some(_)) => MapStartLocationChangeKind::Moved,
                (None, Some(_)) => MapStartLocationChangeKind::Added,
                (Some(_), None) => MapStartLocationChangeKind::Removed,
                (None, None) => return None,
            };
            Some(MapStartLocationChange {
                comparison_id: comparison_id.to_string(),
                slot: slot.into(),
                kind,
                before_x: b.map(|s| s.x.into()),
                before_y: b.map(|s| s.y.into()),
                after_x: a.map(|s| s.x.into()),
                after_y: a.map(|s| s.y.into()),
            })
        })
        .collect()
}

/// A base of either map, matched to the other map's base at (about) the same position.
#[derive(SimpleObject, Clone, Debug)]
#[graphql(complex)]
pub struct MapBaseChange {
    #[graphql(skip)]
    pub comparison_id: String,
    /// The base's index in the first map's `analysis.bases`. Null for a base only the second map
    /// has.
    pub before_index: Option<i32>,
    /// The base's index in the second map's `analysis.bases`. Null for a base only the first map
    /// has.
    pub after_index: Option<i32>,
    /// Whether the base's position or resources differ.
    pub changed: bool,
}

#[ComplexObject]
impl MapBaseChange {
    async fn id(&self) -> String {
        let index = |i: Option<i32>| i.map_or("-".to_string(), |i| i.to_string());
        format!(
            "{}:base:{}:{}",
            self.comparison_id,
            index(self.before_index),
            index(self.after_index)
        )
    }
}

/// Matches bases by town hall position, closest pairs first, within [`BASE_MATCH_DISTANCE`].
/// Unmatched bases come last: the first map's, then the second's.
fn compare_bases(comparison_id: &str, before: &[MapBase], after: &[MapBase]) -> Vec<MapBaseChange> {
    let mut pairs: Vec<(f64, usize, usize)> = Vec::new();
    for (i, b) in before.iter().enumerate() {
        for (j, a) in after.iter().enumerate() {
            let distance = (f64::from(b.x) - f64::from(a.x)).hypot(f64::from(b.y) - f64::from(a.y));
            if distance <= BASE_MATCH_DISTANCE {
                pairs.push((distance, i, j));
            }
        }
    }
    pairs.sort_by(|x, y| x.0.total_cmp(&y.0).then(x.1.cmp(&y.1)).then(x.2.cmp(&y.2)));
    let mut before_matched = vec![None; before.len()];
    let mut after_matched = vec![false; after.len()];
    for (_, i, j) in pairs {
        if before_matched[i].is_none() && !after_matched[j] {
            before_matched[i] = Some(j);
            after_matched[j] = true;
        }
    }

    let index = |i: usize| Some(i32::try_from(i).unwrap_or(i32::MAX));
    let mut changes: Vec<MapBaseChange> = before_matched
        .iter()
        .enumerate()
        .map(|(i, matched)| MapBaseChange {
            comparison_id: comparison_id.to_string(),
            before_index: index(i),
            after_index: matched.and_then(index),
            changed: matched.is_none_or(|j| before[i] != after[j]),
        })
        .collect();
    changes.extend(
        after_matched
            .iter()
            .enumerate()
            .filter(|(_, matched)| !**matched)
            .map(|(j, _)| MapBaseChange {
                comparison_id: comparison_id.to_string(),
                before_index: None,
                after_index: index(j),
                changed: true,
            }),
    );
    changes
}

/// Which build tiles differ in terrain class between two fingerprints of the same dimensions, as
/// a bitmask (1 bit per tile, row-major, low bit first in each byte).
fn terrain_change_mask(a: &[u8], b: &[u8], tiles: usize) -> Option<Vec<u8>> {
    if a.len() != b.len() || a.len() < tiles.div_ceil(4) {
        return None;
    }
    let mut mask = vec![0u8; tiles.div_ceil(8)];
    for i in 0..tiles {
        let shift = (i % 4) * 2;
        if (a[i / 4] >> shift) & 3 != (b[i / 4] >> shift) & 3 {
            mask[i / 8] |= 1 << (i % 8);
        }
    }
    Some(mask)
}

pub struct MapComparison {
    a: SbMapId,
    b: SbMapId,
    changes: Vec<MapChange>,
    start_locations: Vec<MapStartLocationChange>,
    bases: Vec<MapBaseChange>,
    terrain_similarity: Option<f32>,
    terrain_changes: Option<Vec<u8>>,
}

/// What differs between two maps. `a` is treated as the before side and `b` as the after side.
#[Object]
impl MapComparison {
    async fn id(&self) -> String {
        comparison_id(self.a, self.b)
    }

    async fn a(&self, ctx: &Context<'_>) -> Result<SbMap> {
        load_sb_map(ctx, self.a).await
    }

    async fn b(&self, ctx: &Context<'_>) -> Result<SbMap> {
        load_sb_map(ctx, self.b).await
    }

    /// Everything that differs, in a fixed order. Things that couldn't be compared (e.g. bases
    /// when either map's couldn't be found) are left out.
    async fn changes(&self) -> &[MapChange] {
        &self.changes
    }

    /// The player slots whose start location moved, appeared or disappeared.
    async fn start_locations(&self) -> &[MapStartLocationChange] {
        &self.start_locations
    }

    /// Every base of either map, paired with the other map's base at about the same position.
    /// Empty when either map's bases couldn't be found.
    async fn bases(&self) -> &[MapBaseChange] {
        &self.bases
    }

    /// The share of the walkable terrain the maps have in common, from 0 to 1. Null unless both
    /// maps have the same dimensions and analyzed terrain.
    async fn terrain_similarity(&self) -> Option<f64> {
        self.terrain_similarity.map(f64::from)
    }

    /// The build tiles (32x32 pixels) whose terrain shape (walkability and elevation, not tile
    /// art) differs, as a base64 bitmask: 1 bit per tile, row-major, low bit first in each byte.
    /// Null when `terrainSimilarity` is.
    async fn terrain_changes(&self) -> Option<String> {
        self.terrain_changes.as_ref().map(|m| BASE64.encode(m))
    }
}

fn comparison_id(a: SbMapId, b: SbMapId) -> String {
    format!("map-comparison:{a}:{b}")
}

fn compare_sides(before: &Side, after: &Side) -> MapComparison {
    let id = comparison_id(before.id, after.id);
    let mut changes = Vec::new();
    let mut check = |change, differs: bool| {
        if differs {
            changes.push(change);
        }
    };
    check(MapChange::Name, before.name != after.name);
    check(
        MapChange::Description,
        before.description != after.description,
    );
    check(
        MapChange::Dimensions,
        (before.width, before.height) != (after.width, after.height),
    );
    check(MapChange::Tileset, before.tileset != after.tileset);
    check(
        MapChange::PlayerCount,
        before.player_count != after.player_count,
    );
    check(MapChange::Forces, before.forces != after.forces);
    check(MapChange::Eud, before.is_eud != after.is_eud);
    if let (Some(b), Some(a)) = (&before.ums_action_kinds, &after.ums_action_kinds) {
        let b: BTreeSet<_> = b.iter().collect();
        let a: BTreeSet<_> = a.iter().collect();
        check(MapChange::UmsActions, b != a);
    }
    if let (Some(b), Some(a)) = (before.trigger_count, after.trigger_count) {
        check(MapChange::TriggerCount, b != a);
    }

    let start_locations =
        compare_start_locations(&id, &before.start_locations, &after.start_locations);
    check(MapChange::StartLocations, !start_locations.is_empty());

    let bases = match (&before.bases, &after.bases) {
        (Some(b), Some(a)) => compare_bases(&id, b, a),
        _ => Vec::new(),
    };
    check(MapChange::Bases, bases.iter().any(|b| b.changed));

    let tiles = usize::try_from(before.width * before.height).unwrap_or(0);
    let (terrain_similarity, terrain_changes) = match (&before.fingerprint, &after.fingerprint) {
        (Some((b, bv)), Some((a, av)))
            if bv == av && (before.width, before.height) == (after.width, after.height) =>
        {
            (
                terrain_similarity(b, a, tiles),
                terrain_change_mask(b, a, tiles),
            )
        }
        _ => (None, None),
    };
    check(
        MapChange::Terrain,
        terrain_changes
            .as_ref()
            .is_some_and(|mask| mask.iter().any(|&byte| byte != 0)),
    );

    MapComparison {
        a: before.id,
        b: after.id,
        changes,
        start_locations,
        bases,
        terrain_similarity: terrain_similarity.filter(|_| terrain_changes.is_some()),
        terrain_changes,
    }
}

pub async fn compare_maps(db: &PgPool, a: SbMapId, b: SbMapId) -> eyre::Result<MapComparison> {
    let before = load_side(db, a).await?;
    let after = load_side(db, b).await?;
    Ok(compare_sides(&before, &after))
}

#[cfg(test)]
mod tests {
    use uuid::Uuid;

    use super::*;

    fn base(x: u32, y: u32, minerals: u64) -> MapBase {
        MapBase {
            x,
            y,
            mineral_fields: 8,
            minerals,
            geysers: 1,
            start_slots: vec![],
        }
    }

    fn side(n: u8) -> Side {
        Side {
            id: SbMapId(Uuid::from_bytes([n; 16])),
            name: "Polypoid".into(),
            description: String::new(),
            width: 4,
            height: 1,
            tileset: 0,
            player_count: 2,
            is_eud: false,
            forces: Value::Null,
            start_locations: vec![],
            trigger_count: Some(3),
            ums_action_kinds: Some(vec![]),
            bases: Some(vec![base(100, 100, 1500)]),
            fingerprint: Some((vec![0b1111_0100], 1)),
        }
    }

    #[test]
    fn identical_maps_have_no_changes() {
        let comparison = compare_sides(&side(1), &side(2));
        assert!(comparison.changes.is_empty(), "{:?}", comparison.changes);
        assert_eq!(comparison.terrain_similarity, Some(1.0));
        assert_eq!(comparison.terrain_changes, Some(vec![0]));
        assert_eq!(comparison.bases.len(), 1);
        assert!(!comparison.bases[0].changed);
    }

    #[test]
    fn changes_are_listed_in_order() {
        let mut after = side(2);
        after.name = "Polypoid 1.75".into();
        after.trigger_count = Some(4);
        after.bases = Some(vec![base(110, 100, 1500), base(1000, 1000, 1500)]);
        after.fingerprint = Some((vec![0b1111_1000], 1));
        after.start_locations = vec![MapStartLocation {
            slot: 0,
            x: 1,
            y: 2,
        }];
        let comparison = compare_sides(&side(1), &after);
        assert_eq!(
            comparison.changes,
            [
                MapChange::Name,
                MapChange::TriggerCount,
                MapChange::StartLocations,
                MapChange::Bases,
                MapChange::Terrain,
            ]
        );
        // The second tile changed class.
        assert_eq!(comparison.terrain_changes, Some(vec![0b10]));
        assert_eq!(comparison.terrain_similarity, Some(0.5));
        assert_eq!(
            comparison.start_locations[0].kind,
            MapStartLocationChangeKind::Added
        );
    }

    #[test]
    fn terrain_isnt_compared_across_dimensions() {
        let mut after = side(2);
        after.width = 2;
        after.height = 2;
        let comparison = compare_sides(&side(1), &after);
        assert_eq!(comparison.changes, [MapChange::Dimensions]);
        assert_eq!(comparison.terrain_similarity, None);
        assert_eq!(comparison.terrain_changes, None);
    }

    #[test]
    fn bases_match_closest_first_within_two_tiles() {
        let before = [base(100, 100, 1500), base(200, 100, 1500)];
        let after = [
            base(190, 100, 1500),
            base(120, 100, 1000),
            base(900, 900, 1),
        ];
        let changes = compare_bases("c", &before, &after);
        let pairs: Vec<_> = changes
            .iter()
            .map(|c| (c.before_index, c.after_index, c.changed))
            .collect();
        assert_eq!(
            pairs,
            [
                (Some(0), Some(1), true),
                (Some(1), Some(0), true),
                (None, Some(2), true),
            ]
        );
    }

    #[test]
    fn start_location_changes() {
        let at = |slot, x| MapStartLocation { slot, x, y: 0 };
        let changes =
            compare_start_locations("c", &[at(0, 1), at(1, 5)], &[at(0, 1), at(1, 6), at(2, 3)]);
        let kinds: Vec<_> = changes.iter().map(|c| (c.slot, c.kind)).collect();
        assert_eq!(
            kinds,
            [
                (1, MapStartLocationChangeKind::Moved),
                (2, MapStartLocationChangeKind::Added),
            ]
        );
    }
}
