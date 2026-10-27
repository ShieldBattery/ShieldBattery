//! Turns an uploaded map file into the values stored for it: the fields lobbies and games use
//! (`maps`), and the analysis map pages, jobs and moderation use (`map_analysis`).

use std::collections::{BTreeMap, BTreeSet};
use std::path::Path;
use std::sync::LazyLock;

use broodmap::chk::placed_units::PlacedUnit;
use broodmap::chk::strings::LegacyCodePage;
use broodmap::chk::tileset::Tileset;
use broodmap::chk::triggers::{RawTriggerAction, SetDeathsAction};
use broodmap::{CHK_PATH, Chk, Mpq, ResourceLimits, StringEncoding};
use broodmap_analysis::{
    AnalysisAssets, BaseAnalysis, BaseDiscoveryOutcome, BaseSearchOptions, ResourceKind,
    TerrainGrid, analyze_bases,
};
use broodmap_formats::{Cv5, UnitsDat, Vf4, parse_cv5, parse_units_dat, parse_vf4};
use color_eyre::eyre::{self, WrapErr};
use regex::Regex;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

use crate::maps::credits::parse_credits;
use crate::maps::{LobbyInitData, MapForce, MapForcePlayer, MapForcePlayerRace};

/// The version of the parsing below. Every stored value derived from a map file's bytes was
/// written by one parser version, kept in `maps.parser_version`. Bump this whenever any stored
/// output would change (a broodmap upgrade that changes parse results, or a change to the
/// derivations here), and the reparse job rewrites every map's values.
pub const MAP_PARSER_VERSION: i32 = 5;

/// The version of [`terrain_fingerprint`]'s encoding, stored beside each fingerprint so
/// fingerprints are only compared with ones of the same version.
pub const FINGERPRINT_VERSION: i16 = 1;

/// The largest map file accepted for upload.
pub const MAX_MAP_FILE_BYTES: usize = 100 * 1024 * 1024;

const MIB: usize = 1024 * 1024;

const START_LOCATION_UNIT: u16 = 214;
const MINERAL_FIELD_UNITS: std::ops::RangeInclusive<u16> = 176..=178;
const VESPENE_GEYSER_UNIT: u16 = 188;

/// Player slots that can be occupied in a lobby. Slots 8-11 are never players.
const PLAYER_SLOTS: usize = 8;

/// More preplaced units than this owned by player slots makes a map UMS content: melee maps place
/// only observer-safe decoration for players, if anything.
const MAX_MELEE_PLAYER_UNITS: usize = 8;

/// broodmap's defaults, with room for the largest CHK seen in a real map (129 MB).
fn parse_limits() -> ResourceLimits {
    let mut limits = ResourceLimits::default();
    limits.max_map_bytes = MAX_MAP_FILE_BYTES;
    limits.max_mpq_file_bytes = 256 * MIB;
    limits.max_chk_bytes = 256 * MIB;
    limits.max_merged_chunk_bytes = 256 * MIB;
    limits
}

#[derive(Debug, Copy, Clone, Eq, PartialEq)]
pub enum MapExtension {
    Scm,
    Scx,
}

impl MapExtension {
    pub fn parse(value: &str) -> Option<Self> {
        match value.to_ascii_lowercase().as_str() {
            "scm" => Some(Self::Scm),
            "scx" => Some(Self::Scx),
            _ => None,
        }
    }

    pub fn as_str(self) -> &'static str {
        match self {
            Self::Scm => "scm",
            Self::Scx => "scx",
        }
    }
}

/// The hash a map file is identified by: SHA-256 over the lowercase extension followed by the
/// file's bytes. The app computes the same hash for local files.
pub fn map_file_hash(extension: MapExtension, bytes: &[u8]) -> [u8; 32] {
    let mut hasher = Sha256::new();
    hasher.update(extension.as_str().as_bytes());
    hasher.update(bytes);
    hasher.finalize().into()
}

/// Per-tileset terrain tables and `units.dat`, needed to analyze terrain and resource bases.
pub struct AnalysisTables {
    cv5: Vec<Cv5>,
    vf4: Vec<Vf4>,
    units: UnitsDat,
}

const TILESET_STEMS: [&str; 8] = [
    "badlands", "platform", "install", "ashworld", "jungle", "desert", "ice", "twilight",
];

impl AnalysisTables {
    /// Loads the tables from a StarCraft: Remastered asset directory (`TileSet/*.cv5`,
    /// `TileSet/*.vf4` and `arr/units.dat`).
    pub fn load(dir: &Path) -> eyre::Result<Self> {
        let mut cv5 = Vec::with_capacity(TILESET_STEMS.len());
        let mut vf4 = Vec::with_capacity(TILESET_STEMS.len());
        for stem in TILESET_STEMS {
            let path = dir.join("TileSet").join(format!("{stem}.cv5"));
            cv5.push(parse_cv5(
                &std::fs::read(&path).wrap_err_with(|| format!("reading {}", path.display()))?,
            ));
            let path = dir.join("TileSet").join(format!("{stem}.vf4"));
            vf4.push(parse_vf4(
                &std::fs::read(&path).wrap_err_with(|| format!("reading {}", path.display()))?,
            ));
        }
        let path = dir.join("arr").join("units.dat");
        let units = parse_units_dat(
            &std::fs::read(&path).wrap_err_with(|| format!("reading {}", path.display()))?,
        );
        Ok(Self { cv5, vf4, units })
    }

    fn assets(&self, tileset: Tileset) -> AnalysisAssets<'_> {
        let index = tileset as usize;
        AnalysisAssets {
            cv5: &self.cv5[index],
            vf4: &self.vf4[index],
            units: &self.units,
        }
    }
}

#[derive(Debug, thiserror::Error)]
pub enum MapParseError {
    #[error("invalid map file: {0}")]
    InvalidFile(String),
}

/// A start location placed for a player slot, in map pixels.
#[derive(Debug, Clone, Copy, Eq, PartialEq, Serialize, Deserialize)]
pub struct MapStartLocation {
    pub slot: u8,
    pub x: u16,
    pub y: u16,
}

/// A resource base found by base discovery. `x`/`y` is the center of the town hall position, in
/// map pixels.
#[derive(Debug, Clone, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MapBase {
    pub x: u32,
    pub y: u32,
    pub mineral_fields: u32,
    pub minerals: u64,
    pub geysers: u32,
    /// The player slots whose start location is at this base.
    pub start_slots: Vec<u8>,
}

#[derive(Debug, Clone)]
pub struct MapAnalysis {
    pub format_version: i32,
    pub string_encoding: &'static str,
    pub trigger_count: i32,
    pub briefing_count: i32,
    pub ums_action_kinds: Vec<String>,
    pub placed_units: i32,
    pub player_units: i32,
    pub mineral_fields: i32,
    pub mineral_total: i64,
    pub geysers: i32,
    pub bases: Option<Vec<MapBase>>,
    pub author_suggestions: Vec<String>,
    pub anomalies: Vec<String>,
    pub protection_detected: bool,
    pub terrain_fingerprint: Option<Vec<u8>>,
    /// SHA-256 of `scenario.chk`, shared by files that differ only in MPQ packing.
    pub chk_hash: Vec<u8>,
    /// Who the description says made the map, and who it credits as the original, normalized.
    pub makers: Vec<String>,
    pub credited: Vec<String>,
}

#[derive(Debug, Clone)]
pub struct ParsedMap {
    pub title: String,
    pub description: String,
    pub width: i32,
    pub height: i32,
    pub tileset: i32,
    pub players_melee: i32,
    pub players_ums: i32,
    pub lobby_init_data: LobbyInitData,
    pub is_eud: bool,
    pub start_locations: Vec<MapStartLocation>,
    pub ums_content: bool,
    pub analysis: MapAnalysis,
}

impl ParsedMap {
    /// Whether the map has any slot a player can take, in either melee or UMS games.
    pub fn has_player_slots(&self) -> bool {
        self.players_melee > 0 || self.players_ums > 0
    }
}

/// A parsed map along with its CHK, so images can be rendered without parsing again.
pub struct ParsedMapFile {
    pub parsed: ParsedMap,
    pub chk: Chk,
}

/// Parses a map file. `tables` enables terrain and base analysis; without them those parts of
/// the analysis are left empty.
pub fn parse_map(
    bytes: &[u8],
    tables: Option<&AnalysisTables>,
) -> Result<ParsedMapFile, MapParseError> {
    let limits = parse_limits();
    let mpq = Mpq::from_bytes_with_limits(bytes, &limits)
        .map_err(|e| MapParseError::InvalidFile(format!("mpq: {e}")))?;
    let chk_bytes = mpq
        .read_file(CHK_PATH, None)
        .map_err(|e| MapParseError::InvalidFile(format!("scenario.chk: {e}")))?;
    let chk_hash = Sha256::digest(&chk_bytes).to_vec();
    let chk = Chk::from_bytes_with_limits(chk_bytes, None, &limits)
        .map_err(|e| MapParseError::InvalidFile(format!("chk: {e}")))?;

    let props = chk
        .scenario_props()
        .map_err(|e| MapParseError::InvalidFile(format!("SPRP: {e}")))?;
    let title = props
        .name
        .as_deref()
        .map(filter_color_codes)
        .unwrap_or_default();
    let description = props
        .description
        .as_deref()
        .map(filter_color_codes)
        .unwrap_or_default();
    let slots = player_slots(&chk)?;

    let units: &[PlacedUnit] = chk.placed_units().map(|u| u.as_slice()).unwrap_or(&[]);
    let start_locations = start_locations(units);
    let unit_counts = UnitCounts::new(units);
    let is_eud = chk.uses_eud();

    let mut anomalies = file_anomalies(&mpq, &chk, bytes);
    let protection_detected = anomalies.iter().any(|a| is_protection_anomaly(a));

    let (trigger_count, ums_action_kinds) = match chk.raw_triggers() {
        Ok(triggers) => {
            let mut kinds = BTreeSet::new();
            for action in triggers.iter().flat_map(|t| &t.actions) {
                if !is_melee_compatible_action(&action.action) {
                    kinds.insert(action_kind_name(&action.action));
                }
            }
            (triggers.len(), kinds.into_iter().collect::<Vec<_>>())
        }
        Err(e) => {
            anomalies.push(format!("triggers_unreadable: {e}"));
            (0, Vec::new())
        }
    };
    let ums_content =
        is_eud || !ums_action_kinds.is_empty() || unit_counts.player_units > MAX_MELEE_PLAYER_UNITS;

    let (bases, terrain_fingerprint) = match tables {
        Some(tables) => analyze_terrain(&chk, tables, &mut anomalies),
        None => (None, None),
    };

    let credits = parse_credits(&description);
    let analysis = MapAnalysis {
        format_version: i32::from(chk.format_version() as u16),
        string_encoding: string_encoding_name(chk.strings().encoding),
        trigger_count: saturating_i32(trigger_count),
        briefing_count: saturating_i32(chk.raw_briefing().map(|b| b.len()).unwrap_or(0)),
        ums_action_kinds,
        placed_units: saturating_i32(unit_counts.placed_units),
        player_units: saturating_i32(unit_counts.player_units),
        mineral_fields: saturating_i32(unit_counts.mineral_fields),
        mineral_total: i64::try_from(unit_counts.mineral_total).unwrap_or(i64::MAX),
        geysers: saturating_i32(unit_counts.geysers),
        bases,
        author_suggestions: author_suggestions(&[&title, &description]),
        anomalies,
        protection_detected,
        terrain_fingerprint,
        chk_hash,
        makers: credits.makers,
        credited: credits.credited,
    };

    let parsed = ParsedMap {
        title,
        description,
        width: saturating_i32(chk.width()),
        height: saturating_i32(chk.height()),
        tileset: i32::from(chk.tileset() as u8),
        players_melee: slots.melee,
        players_ums: slots.ums,
        lobby_init_data: LobbyInitData {
            forces: slots.forces,
        },
        is_eud,
        start_locations,
        ums_content,
        analysis,
    };
    Ok(ParsedMapFile { parsed, chk })
}

fn saturating_i32(value: usize) -> i32 {
    i32::try_from(value).unwrap_or(i32::MAX)
}

/// Drops control characters (StarCraft's color codes) other than line breaks.
pub fn filter_color_codes(s: &str) -> String {
    s.chars()
        .filter(|&c| (c as u32) > 0x1f || c == '\n' || c == '\r')
        .collect()
}

struct PlayerSlots {
    melee: i32,
    ums: i32,
    forces: Vec<MapForce>,
}

/// Which slots are playable, and how they're grouped into forces for UMS games. Slots with a
/// controller of 1-7 are active (6 is a human slot, anything else a computer); a melee game seats
/// every active slot, while a UMS game seats the human slots assigned to one of the 4 forces.
fn player_slots(chk: &Chk) -> Result<PlayerSlots, MapParseError> {
    let types = chk
        .player_types()
        .map_err(|e| MapParseError::InvalidFile(format!("OWNR: {e}")))?;
    let races = chk
        .player_races()
        .map_err(|e| MapParseError::InvalidFile(format!("SIDE: {e}")))?;
    let force_settings = chk
        .force_settings()
        .map_err(|e| MapParseError::InvalidFile(format!("FORC: {e}")))?;

    let mut melee = 0;
    let mut ums = 0;
    let mut force_players: [Vec<MapForcePlayer>; 4] = Default::default();
    for slot in 0..PLAYER_SLOTS {
        let type_id = u8::from(types[slot]);
        if !(1..=7).contains(&type_id) {
            continue;
        }
        melee += 1;
        let is_computer = type_id != 6;
        let force = usize::from(force_settings.assigned_forces[slot]);
        if force < force_players.len() {
            if !is_computer {
                ums += 1;
            }
            force_players[force].push(MapForcePlayer {
                player_id: slot as i32,
                race: lobby_race(u8::from(races[slot])),
                type_id: i32::from(type_id),
                is_computer,
            });
        }
    }

    let forces = force_players
        .into_iter()
        .enumerate()
        .filter(|(_, players)| !players.is_empty())
        .map(|(i, players)| MapForce {
            name: force_settings.forces[i]
                .name
                .as_deref()
                .map(filter_color_codes)
                .unwrap_or_default(),
            team_id: i as i32 + 1,
            players,
        })
        .collect();

    Ok(PlayerSlots { melee, ums, forces })
}

/// The lobby race for a slot's `SIDE` value. Values that aren't a race a lobby can offer are
/// treated as Terran, the race BW falls back to.
fn lobby_race(race: u8) -> MapForcePlayerRace {
    match race {
        0 => MapForcePlayerRace::Zerg,
        2 => MapForcePlayerRace::Protoss,
        5 => MapForcePlayerRace::Any,
        _ => MapForcePlayerRace::Terran,
    }
}

/// Start locations placed for player slots, one per slot. When a slot has several, the last one
/// placed is the one the game uses.
fn start_locations(units: &[PlacedUnit]) -> Vec<MapStartLocation> {
    let mut by_slot = BTreeMap::new();
    for unit in units {
        if unit.unit_id != START_LOCATION_UNIT {
            continue;
        }
        if let Some(slot) = unit.owner.filter(|&o| usize::from(o) < PLAYER_SLOTS) {
            by_slot.insert(
                slot,
                MapStartLocation {
                    slot,
                    x: unit.x,
                    y: unit.y,
                },
            );
        }
    }
    by_slot.into_values().collect()
}

#[derive(Default)]
struct UnitCounts {
    placed_units: usize,
    player_units: usize,
    mineral_fields: usize,
    mineral_total: u64,
    geysers: usize,
}

impl UnitCounts {
    fn new(units: &[PlacedUnit]) -> Self {
        let mut counts = Self::default();
        for unit in units {
            if unit.unit_id == START_LOCATION_UNIT {
                continue;
            }
            counts.placed_units += 1;
            if unit.owner.is_some_and(|o| usize::from(o) < PLAYER_SLOTS) {
                counts.player_units += 1;
            }
            if MINERAL_FIELD_UNITS.contains(&unit.unit_id) {
                counts.mineral_fields += 1;
                counts.mineral_total += u64::from(unit.resource_amount.unwrap_or(0));
            } else if unit.unit_id == VESPENE_GEYSER_UNIT {
                counts.geysers += 1;
            }
        }
        counts
    }
}

/// Whether a trigger action fits a melee map. Besides the default melee triggers (resources,
/// victory and defeat), tournament melee maps commonly add observer-safe triggers: messages,
/// sounds, AI scripts for computer slots, alliances and objectives. Removing or killing units and
/// setting death counts are also allowed, so melee variants built on them (Hunters remakes, fastest
/// maps) and stock melee maps that kill units at a location (Blizzard's The Lost Temple) count as
/// melee; EUD death counts are caught separately.
fn is_melee_compatible_action(action: &RawTriggerAction) -> bool {
    matches!(
        action,
        RawTriggerAction::NoAction
            | RawTriggerAction::Victory
            | RawTriggerAction::Defeat
            | RawTriggerAction::PreserveTrigger
            | RawTriggerAction::Wait { .. }
            | RawTriggerAction::PlaySound { .. }
            | RawTriggerAction::DisplayTextMessage { .. }
            | RawTriggerAction::SetMissionObjectives { .. }
            | RawTriggerAction::RunAiScript { .. }
            | RawTriggerAction::SetAlliance { .. }
            | RawTriggerAction::ModifyResources { .. }
            | RawTriggerAction::Comment(_)
            | RawTriggerAction::RemoveUnit { .. }
            | RawTriggerAction::RemoveUnitAtLocation { .. }
            | RawTriggerAction::KillUnitAtLocation { .. }
            | RawTriggerAction::SetDeaths(SetDeathsAction::Normal { .. })
    )
}

/// The action's variant name (e.g. `CreateUnit`), from its `Debug` output, which starts with it.
fn action_kind_name(action: &RawTriggerAction) -> String {
    let debug = format!("{action:?}");
    debug
        .split(|c: char| !c.is_ascii_alphanumeric())
        .next()
        .unwrap_or_default()
        .to_string()
}

fn string_encoding_name(encoding: StringEncoding) -> &'static str {
    match encoding {
        StringEncoding::Utf8 => "utf8",
        StringEncoding::Utf8WithFallback(LegacyCodePage::Korean) => "utf8-cp949",
        StringEncoding::Utf8WithFallback(LegacyCodePage::Latin) => "utf8-cp1252",
        StringEncoding::Legacy(LegacyCodePage::Korean) => "cp949",
        StringEncoding::Legacy(LegacyCodePage::Latin) => "cp1252",
    }
}

fn analyze_terrain(
    chk: &Chk,
    tables: &AnalysisTables,
    anomalies: &mut Vec<String>,
) -> (Option<Vec<MapBase>>, Option<Vec<u8>>) {
    let analysis = match analyze_bases(
        chk,
        tables.assets(chk.tileset()),
        &BaseSearchOptions::default(),
    ) {
        Ok(analysis) => analysis,
        Err(e) => {
            anomalies.push(format!("analysis_failed: {e}"));
            return (None, None);
        }
    };
    let fingerprint = terrain_fingerprint(&analysis.terrain);
    let bases = match &analysis.discovery {
        BaseDiscoveryOutcome::Complete(_) => Some(map_bases(&analysis)),
        BaseDiscoveryOutcome::Skipped(reason) => {
            anomalies.push(format!("base_discovery_skipped: {reason}"));
            None
        }
    };
    (bases, Some(fingerprint))
}

fn map_bases(analysis: &BaseAnalysis) -> Vec<MapBase> {
    let Some(discovery) = analysis.discovery.discovery() else {
        return Vec::new();
    };
    let resources = &analysis.inputs.resources;
    let starts = &analysis.inputs.starts;
    discovery
        .bases
        .iter()
        .map(|base| {
            let mut mineral_fields = 0;
            let mut minerals = 0u64;
            let mut geysers = 0;
            for &i in &base.resource_indices {
                match resources[i].kind {
                    ResourceKind::Mineral => {
                        mineral_fields += 1;
                        minerals += u64::from(resources[i].amount.unwrap_or(0));
                    }
                    ResourceKind::Gas => geysers += 1,
                }
            }
            let mut start_slots: Vec<u8> = base
                .start_indices
                .iter()
                .filter_map(|&i| starts[i].owner)
                .filter(|&o| usize::from(o) < PLAYER_SLOTS)
                .collect();
            start_slots.sort_unstable();
            start_slots.dedup();
            // Town halls are 4x3 tiles; the position is the center of that footprint.
            MapBase {
                x: base.depot_tile.x * 32 + 64,
                y: base.depot_tile.y * 32 + 48,
                mineral_fields,
                minerals,
                geysers,
                start_slots,
            }
        })
        .collect()
}

/// The terrain's shape at 2 bits per build tile, row-major, 4 tiles per byte (first tile in the
/// low bits): 3 when most of the tile can't be walked on, otherwise the majority elevation of its
/// walkable parts (0-2). Doodads and units are left out, so versions of a map that only move
/// resources or decoration still match.
pub fn terrain_fingerprint(grid: &TerrainGrid) -> Vec<u8> {
    let walk_width = grid.width() as usize;
    let tiles_x = walk_width / 4;
    let tiles_y = grid.height() as usize / 4;
    let cells = grid.cells();
    let mut out = vec![0u8; (tiles_x * tiles_y).div_ceil(4)];
    for ty in 0..tiles_y {
        for tx in 0..tiles_x {
            let mut walkable = 0;
            let mut elevations = [0u32; 3];
            for y in ty * 4..ty * 4 + 4 {
                for x in tx * 4..tx * 4 + 4 {
                    let cell = cells[y * walk_width + x];
                    if cell.walkable {
                        walkable += 1;
                        elevations[usize::from(cell.elevation).min(2)] += 1;
                    }
                }
            }
            let class = if walkable < 8 {
                3
            } else {
                // Ties go to the lowest elevation.
                (0..3u8)
                    .rev()
                    .max_by_key(|&i| elevations[usize::from(i)])
                    .unwrap_or(0)
            };
            let index = ty * tiles_x + tx;
            out[index / 4] |= class << ((index % 4) * 2);
        }
    }
    out
}

static AUTHOR_PATTERNS: LazyLock<[Regex; 2]> = LazyLock::new(|| {
    [
        // "Made by X", "Map by: X", "Author - X", "제작자 : X". A bare label needs a separator, so
        // "author of the map" doesn't count.
        Regex::new(
            r"(?i)(?:\b(?:made|created|designed|edited|remade|map)\s+by\s*[:\-]?|\b(?:author|maker)\s*[:\-]|(?:제작자|제작|만든이)\s*[:\-])\s*([^\r\n,()\[\]|]{2,32})",
        )
        .expect("author pattern compiles"),
        // "X 제작"
        Regex::new(r"([^\s:]{2,24})\s*제작(?:\s|$)").expect("author suffix pattern compiles"),
    ]
});

/// Credits named in the map's own text ("Made by X", "제작자: X"), in order of appearance. These
/// are only hints: a bare "by X" is left out, since in map descriptions it usually names a
/// sponsor or tournament.
pub fn author_suggestions(texts: &[&str]) -> Vec<String> {
    let mut found = Vec::new();
    for text in texts {
        for pattern in AUTHOR_PATTERNS.iter() {
            for captures in pattern.captures_iter(text) {
                // Names end at a run of spaces, which separates columns of credits.
                let name = captures[1]
                    .split("  ")
                    .next()
                    .unwrap_or_default()
                    .trim()
                    .trim_end_matches(['.', '!', '~', '*', '-', ':'])
                    .trim();
                if name.chars().count() >= 2 && !found.iter().any(|f: &String| f == name) {
                    found.push(name.to_string());
                }
            }
        }
    }
    found
}

/// Whether `name` is `title` decoded with the wrong code page: Korean (CP949) or UTF-8 bytes read
/// as CP1252 or Latin-1. Older parsers stored names like this.
pub fn is_mojibake_of(name: &str, title: &str) -> bool {
    if name == title || name.is_ascii() || title.is_ascii() {
        return false;
    }
    let (korean, _, korean_unmappable) = encoding_rs::EUC_KR.encode(title);
    let encodings: [&[u8]; 2] = [
        if korean_unmappable { &[] } else { &korean },
        title.as_bytes(),
    ];
    encodings
        .into_iter()
        .filter(|bytes| !bytes.is_empty())
        .any(|bytes| {
            let (cp1252, _) = encoding_rs::WINDOWS_1252.decode_without_bom_handling(bytes);
            let latin1: String = bytes.iter().map(|&b| char::from(b)).collect();
            name == cp1252 || name == latin1
        })
}

/// Signs of a map protector or a damaged file. Most also show up in stock Blizzard maps, so
/// [`is_protection_anomaly`] picks out the ones that indicate protection.
fn file_anomalies(mpq: &Mpq<'_>, chk: &Chk, bytes: &[u8]) -> Vec<String> {
    let mut anomalies = Vec::new();
    let header = mpq.header();
    if header.offset != 0 {
        anomalies.push("mpq_header_offset".to_string());
    }
    let chk_entries = chk_hash_entries(mpq);
    if chk_entries > 1 {
        anomalies.push(format!("duplicate_chk_entries: {chk_entries}"));
    }
    let mut duplicated: Vec<String> = chk
        .chunks()
        .iter()
        .filter(|(tag, chunks)| chunks.len() > 1 && KNOWN_CHUNK_TAGS.contains(&&tag[..]))
        .map(|(tag, _)| String::from_utf8_lossy(&tag[..]).trim().to_string())
        .collect();
    duplicated.sort();
    for tag in duplicated {
        anomalies.push(format!("duplicate_chunk: {tag}"));
    }
    let unknown = chk
        .chunks()
        .keys()
        .filter(|tag| !KNOWN_CHUNK_TAGS.contains(&&tag[..]))
        .count();
    if unknown > 0 {
        anomalies.push(format!("unknown_chunks: {unknown}"));
    }
    if bytes.len() < header.offset as usize {
        anomalies.push("truncated_header".to_string());
    }
    anomalies
}

/// Anomalies that unprotected maps don't have: an MPQ header that isn't at the start of the file,
/// several `scenario.chk` entries (a decoy for editors to read), or duplicated chunks whose last
/// copy overrides the earlier ones (the earlier ones being decoys).
fn is_protection_anomaly(anomaly: &str) -> bool {
    anomaly == "mpq_header_offset"
        || anomaly.starts_with("duplicate_chk_entries")
        || anomaly
            .strip_prefix("duplicate_chunk: ")
            .is_some_and(|tag| {
                [
                    "OWNR", "SIDE", "FORC", "SPRP", "DIM", "ERA", "VER", "TYPE", "IVER", "IVE2",
                ]
                .contains(&tag)
            })
}

const KNOWN_CHUNK_TAGS: [&[u8]; 41] = [
    b"TYPE", b"VER ", b"IVER", b"IVE2", b"VCOD", b"IOWN", b"OWNR", b"ERA ", b"DIM ", b"SIDE",
    b"MTXM", b"PUNI", b"UPGR", b"PTEC", b"UNIT", b"ISOM", b"TILE", b"DD2 ", b"THG2", b"MASK",
    b"STR ", b"STRx", b"UPRP", b"UPUS", b"MRGN", b"TRIG", b"MBRF", b"SPRP", b"FORC", b"WAV ",
    b"UNIS", b"UPGS", b"TECS", b"SWNM", b"COLR", b"CRGB", b"PUPx", b"PTEx", b"UNIx", b"UPGx",
    b"TECx",
];

/// How many live hash table entries name `scenario.chk`, across all locales.
fn chk_hash_entries(mpq: &Mpq<'_>) -> usize {
    let hash_a = storm_hash(CHK_PATH, 1);
    let hash_b = storm_hash(CHK_PATH, 2);
    let blocks = mpq.block_table().len();
    mpq.hash_table()
        .iter()
        .filter(|e| e.hash_a == hash_a && e.hash_b == hash_b && (e.block_index as usize) < blocks)
        .count()
}

static STORM_CRYPT_TABLE: LazyLock<[u32; 0x500]> = LazyLock::new(|| {
    let mut table = [0u32; 0x500];
    let mut seed: u32 = 0x0010_0001;
    for index1 in 0..0x100usize {
        let mut index2 = index1;
        for _ in 0..5 {
            seed = (seed.wrapping_mul(125) + 3) % 0x2A_AAAB;
            let high = (seed & 0xFFFF) << 0x10;
            seed = (seed.wrapping_mul(125) + 3) % 0x2A_AAAB;
            let low = seed & 0xFFFF;
            table[index2] = high | low;
            index2 += 0x100;
        }
    }
    table
});

/// Storm's string hash, as used for MPQ hash table lookups (`kind` 1 and 2 are the two
/// verification hashes).
fn storm_hash(s: &str, kind: u32) -> u32 {
    let table = &*STORM_CRYPT_TABLE;
    let mut seed1: u32 = 0x7FED_7FED;
    let mut seed2: u32 = 0xEEEE_EEEE;
    for ch in s.bytes() {
        let ch = u32::from(ch.to_ascii_uppercase());
        seed1 = table[((kind << 8) + ch) as usize] ^ seed1.wrapping_add(seed2);
        seed2 = ch
            .wrapping_add(seed1)
            .wrapping_add(seed2)
            .wrapping_add(seed2 << 5)
            .wrapping_add(3);
    }
    seed1
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn filters_color_codes_but_keeps_line_breaks() {
        assert_eq!(
            filter_color_codes("\u{4}:: Players\r\nok\u{1f}"),
            ":: Players\r\nok"
        );
    }

    #[test]
    fn hashes_extension_then_bytes() {
        let hash = map_file_hash(MapExtension::Scx, b"abc");
        let mut hasher = Sha256::new();
        hasher.update(b"scxabc");
        assert_eq!(hash, <[u8; 32]>::from(hasher.finalize()));
    }

    #[test]
    fn parses_extensions_case_insensitively() {
        assert_eq!(MapExtension::parse("SCX"), Some(MapExtension::Scx));
        assert_eq!(MapExtension::parse("scm"), Some(MapExtension::Scm));
        assert_eq!(MapExtension::parse("rep"), None);
    }

    #[test]
    fn maps_slot_races_like_bw() {
        assert_eq!(lobby_race(0), MapForcePlayerRace::Zerg);
        assert_eq!(lobby_race(1), MapForcePlayerRace::Terran);
        assert_eq!(lobby_race(2), MapForcePlayerRace::Protoss);
        assert_eq!(lobby_race(5), MapForcePlayerRace::Any);
        assert_eq!(lobby_race(6), MapForcePlayerRace::Terran);
        assert_eq!(lobby_race(9), MapForcePlayerRace::Terran);
    }

    #[test]
    fn finds_strong_author_credits_only() {
        assert_eq!(
            author_suggestions(&[
                "Polypoid",
                "Usually harmless.\r\n Created by KM-\r\n Special Thanks to Testbug\r\n sponsored by AfreecaTV"
            ]),
            vec!["KM"]
        );
        assert_eq!(
            author_suggestions(&["", "Map by: LatiAs (v1.2)\r\nAuthor - Waldstein"]),
            vec!["LatiAs", "Waldstein"]
        );
        assert_eq!(
            author_suggestions(&["", "제작자 : 홍길동\n"]),
            vec!["홍길동"]
        );
        assert_eq!(author_suggestions(&["", "홍길동 제작\n"]), vec!["홍길동"]);
        assert!(author_suggestions(&["", "by KeSPA"]).is_empty());
        assert!(author_suggestions(&["", "Unauthorized modification is prohibited"]).is_empty());
        assert!(author_suggestions(&["", "I'm the author of the map"]).is_empty());
        assert_eq!(
            author_suggestions(&["", "Map by Rose.of.Dream      Presented by X"]),
            vec!["Rose.of.Dream"]
        );
    }

    #[test]
    fn detects_mojibake_names() {
        assert!(is_mojibake_of(
            "\u{b3}\u{bb}\u{b0}\u{a1} \u{c4}\u{c4}\u{c7}\u{bb}\u{c5}\u{cd}\u{c0}\u{c7} \u{c1}\u{fa}\u{b7}\u{b5} 2",
            "내가 컴퓨터의 질럿 2"
        ));
        assert!(!is_mojibake_of("Longinus 2.0", "LonginusⅡ"));
        assert!(!is_mojibake_of("투혼", "Fighting Spirit"));
        assert!(!is_mojibake_of(
            "내가 컴퓨터의 질럿 2",
            "내가 컴퓨터의 질럿 2"
        ));
    }

    #[test]
    fn storm_hash_matches_known_values() {
        // Values from the MPQ format documentation for `(listfile)`.
        assert_eq!(storm_hash("(listfile)", 0), 0x5F3D_E859);
        assert_eq!(storm_hash("(listfile)", 1), 0xFD65_7910);
        assert_eq!(storm_hash("(listfile)", 2), 0x4E9B_98A7);
    }

    /// Parses every map file in the directory named by `SB_MAP_PARSE_CORPUS` and writes one JSON
    /// line per file (keyed by its hash) to `SB_MAP_PARSE_OUT`, for diffing parser output across
    /// broodmap upgrades and parser changes. Analysis runs when `SB_MAP_ASSETS` is set.
    ///
    /// `SB_MAP_PARSE_CORPUS=<dir> SB_MAP_PARSE_OUT=<file> cargo test --release --lib -- --ignored parse_corpus`
    #[test]
    #[ignore]
    fn parse_corpus() {
        use std::io::Write;

        let corpus = std::env::var("SB_MAP_PARSE_CORPUS").expect("SB_MAP_PARSE_CORPUS is set");
        let out_path = std::env::var("SB_MAP_PARSE_OUT").expect("SB_MAP_PARSE_OUT is set");
        let tables = std::env::var("SB_MAP_ASSETS")
            .ok()
            .map(|dir| AnalysisTables::load(Path::new(&dir)).expect("analysis tables load"));
        let mut out = std::io::BufWriter::new(std::fs::File::create(out_path).unwrap());
        let mut entries: Vec<_> = std::fs::read_dir(corpus)
            .unwrap()
            .map(|e| e.unwrap().path())
            .collect();
        entries.sort();
        for path in entries {
            let Some(extension) = path
                .extension()
                .and_then(|e| e.to_str())
                .and_then(MapExtension::parse)
            else {
                continue;
            };
            let bytes = std::fs::read(&path).unwrap();
            let hash = data_encoding::HEXLOWER.encode(&map_file_hash(extension, &bytes));
            let line = match parse_map(&bytes, tables.as_ref()) {
                Ok(ParsedMapFile { parsed, .. }) => serde_json::json!({
                    "hash": hash,
                    "ok": true,
                    "title": parsed.title,
                    "description": parsed.description,
                    "width": parsed.width,
                    "height": parsed.height,
                    "tileset": parsed.tileset,
                    "melee_players": parsed.players_melee,
                    "ums_players": parsed.players_ums,
                    "forces": parsed.lobby_init_data.forces,
                    "is_eud": parsed.is_eud,
                    "start_locations": parsed.start_locations,
                    "ums_content": parsed.ums_content,
                    "ums_action_kinds": parsed.analysis.ums_action_kinds,
                    "player_units": parsed.analysis.player_units,
                    "bases": parsed.analysis.bases,
                    "author_suggestions": parsed.analysis.author_suggestions,
                    "anomalies": parsed.analysis.anomalies,
                    "protection_detected": parsed.analysis.protection_detected,
                    "string_encoding": parsed.analysis.string_encoding,
                    "fingerprint_bytes": parsed.analysis.terrain_fingerprint.map(|f| f.len()),
                    "chk_hash": data_encoding::HEXLOWER.encode(&parsed.analysis.chk_hash),
                    "makers": parsed.analysis.makers,
                    "credited": parsed.analysis.credited,
                }),
                Err(e) => serde_json::json!({ "hash": hash, "ok": false, "error": e.to_string() }),
            };
            writeln!(out, "{line}").unwrap();
        }
    }

    #[test]
    fn melee_allowlist_covers_default_triggers_and_variants() {
        use broodmap::chk::triggers::PlayerGroup;

        assert!(is_melee_compatible_action(&RawTriggerAction::Victory));
        assert!(is_melee_compatible_action(&RawTriggerAction::Defeat));
        assert!(!is_melee_compatible_action(&RawTriggerAction::PauseGame));
        assert!(is_melee_compatible_action(
            &RawTriggerAction::KillUnitAtLocation {
                player_group: PlayerGroup::Player1,
                unit_id: 0,
                location: 0,
            }
        ));
        assert_eq!(action_kind_name(&RawTriggerAction::PauseGame), "PauseGame");
        assert_eq!(
            action_kind_name(&RawTriggerAction::LeaderboardGreed(5)),
            "LeaderboardGreed"
        );
    }
}
