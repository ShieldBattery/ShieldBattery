//! ABI declarations for BWAPI 4.4.0's external-client shared-memory mapping.
//!
//! These types deliberately use only fixed-width scalar fields. In particular, BWAPI's `bool`
//! is an MSVC one-byte value, so it is represented here as `u8`, never Rust `bool`: the mapping
//! is writable by an untrusted peer and arbitrary byte values are not valid Rust booleans.

use std::mem::{offset_of, size_of};

pub const CLIENT_VERSION: i32 = 10_003;

pub const MAX_GAME_INSTANCES: usize = 8;
pub const MAX_FORCES: usize = 5;
pub const MAX_PLAYERS: usize = 12;
pub const MAX_UNITS: usize = 10_000;
pub const UNIT_ARRAY_LEN: usize = 1_700;
pub const MAX_BULLETS: usize = 100;
pub const MAX_NUKE_DOTS: usize = 200;
pub const MAP_TILES: usize = 256;
pub const MAP_WALK_TILES: usize = 1_024;
pub const MAX_REGIONS: usize = 5_000;
pub const MAX_START_LOCATIONS: usize = 8;
pub const MAX_EVENTS: usize = 10_000;
pub const MAX_EVENT_STRINGS: usize = 1_000;
pub const MAX_STRINGS: usize = 20_000;
pub const MAX_SHAPES: usize = 20_000;
pub const MAX_COMMANDS: usize = 20_000;
pub const MAX_UNIT_COMMANDS: usize = 20_000;
pub const MAX_UNIT_TYPES: usize = 234;
pub const MAX_UPGRADE_TYPES: usize = 63;
pub const MAX_TECH_TYPES: usize = 47;
pub const MAX_MOUSE_BUTTONS: usize = 3;
pub const MAX_KEYS: usize = 255;
pub const MAX_FLAGS: usize = 2;

/// Returns a shared-memory count only when it is representable by the corresponding array.
/// Callers must use this before indexing any client-owned command, string, shape, or event array.
pub const fn checked_count(count: i32, capacity: usize) -> Option<usize> {
    if count < 0 || count as usize > capacity {
        None
    } else {
        Some(count as usize)
    }
}

#[repr(C)]
#[derive(Clone, Copy, Debug, Default)]
pub struct Position {
    pub x: i32,
    pub y: i32,
}

#[repr(C)]
#[derive(Clone, Copy, Debug, Default)]
pub struct GameInstance {
    pub server_process_id: u32,
    pub is_connected: u8,
    pub _padding: [u8; 3],
    pub last_keep_alive_time: u32,
}

#[repr(C)]
#[derive(Clone, Copy, Debug, Default)]
pub struct GameTable {
    pub game_instances: [GameInstance; MAX_GAME_INSTANCES],
}

#[repr(C)]
#[derive(Clone, Copy, Debug, Default)]
pub struct ForceData {
    pub name: [u8; 32],
}

#[repr(C)]
#[derive(Clone, Copy, Debug)]
pub struct PlayerData {
    pub name: [u8; 25],
    pub race: i32,
    pub kind: i32,
    pub force: i32,
    pub is_ally: [u8; MAX_PLAYERS],
    pub is_enemy: [u8; MAX_PLAYERS],
    pub is_neutral: u8,
    pub start_location_x: i32,
    pub start_location_y: i32,
    pub is_victorious: u8,
    pub is_defeated: u8,
    pub left_game: u8,
    pub is_participating: u8,
    pub minerals: i32,
    pub gas: i32,
    pub gathered_minerals: i32,
    pub gathered_gas: i32,
    pub repaired_minerals: i32,
    pub repaired_gas: i32,
    pub refunded_minerals: i32,
    pub refunded_gas: i32,
    pub supply_total: [i32; 3],
    pub supply_used: [i32; 3],
    pub all_unit_count: [i32; MAX_UNIT_TYPES],
    pub visible_unit_count: [i32; MAX_UNIT_TYPES],
    pub completed_unit_count: [i32; MAX_UNIT_TYPES],
    pub dead_unit_count: [i32; MAX_UNIT_TYPES],
    pub killed_unit_count: [i32; MAX_UNIT_TYPES],
    pub upgrade_level: [i32; MAX_UPGRADE_TYPES],
    pub has_researched: [u8; MAX_TECH_TYPES],
    pub is_researching: [u8; MAX_TECH_TYPES],
    pub is_upgrading: [u8; MAX_UPGRADE_TYPES],
    pub color: i32,
    pub total_unit_score: i32,
    pub total_kill_score: i32,
    pub total_building_score: i32,
    pub total_razing_score: i32,
    pub custom_score: i32,
    pub max_upgrade_level: [i32; MAX_UPGRADE_TYPES],
    pub is_research_available: [u8; MAX_TECH_TYPES],
    pub is_unit_available: [u8; MAX_UNIT_TYPES],
}

#[repr(C)]
#[derive(Clone, Copy, Debug, Default)]
pub struct UnitData {
    pub clearance_level: i32,
    pub id: i32,
    pub player: i32,
    pub kind: i32,
    pub position_x: i32,
    pub position_y: i32,
    pub angle: f64,
    pub velocity_x: f64,
    pub velocity_y: f64,
    pub hit_points: i32,
    pub last_hit_points: i32,
    pub shields: i32,
    pub energy: i32,
    pub resources: i32,
    pub resource_group: i32,
    pub kill_count: i32,
    pub acid_spore_count: i32,
    pub scarab_count: i32,
    pub interceptor_count: i32,
    pub spider_mine_count: i32,
    pub ground_weapon_cooldown: i32,
    pub air_weapon_cooldown: i32,
    pub spell_cooldown: i32,
    pub defense_matrix_points: i32,
    pub defense_matrix_timer: i32,
    pub ensnare_timer: i32,
    pub irradiate_timer: i32,
    pub lockdown_timer: i32,
    pub maelstrom_timer: i32,
    pub order_timer: i32,
    pub plague_timer: i32,
    pub remove_timer: i32,
    pub stasis_timer: i32,
    pub stim_timer: i32,
    pub build_kind: i32,
    pub training_queue_count: i32,
    pub training_queue: [i32; 5],
    pub tech: i32,
    pub upgrade: i32,
    pub remaining_build_time: i32,
    pub remaining_train_time: i32,
    pub remaining_research_time: i32,
    pub remaining_upgrade_time: i32,
    pub build_unit: i32,
    pub target: i32,
    pub target_position_x: i32,
    pub target_position_y: i32,
    pub order: i32,
    pub order_target: i32,
    pub order_target_position_x: i32,
    pub order_target_position_y: i32,
    pub secondary_order: i32,
    pub rally_position_x: i32,
    pub rally_position_y: i32,
    pub rally_unit: i32,
    pub addon: i32,
    pub nydus_exit: i32,
    pub power_up: i32,
    pub transport: i32,
    pub carrier: i32,
    pub hatchery: i32,
    pub exists: u8,
    pub has_nuke: u8,
    pub is_accelerating: u8,
    pub is_attacking: u8,
    pub is_attack_frame: u8,
    pub is_being_gathered: u8,
    pub is_blind: u8,
    pub is_braking: u8,
    pub is_burrowed: u8,
    pub carry_resource_kind: i32,
    pub is_cloaked: u8,
    pub is_completed: u8,
    pub is_constructing: u8,
    pub is_detected: u8,
    pub is_gathering: u8,
    pub is_hallucination: u8,
    pub is_idle: u8,
    pub is_interruptible: u8,
    pub is_invincible: u8,
    pub is_lifted: u8,
    pub is_morphing: u8,
    pub is_moving: u8,
    pub is_parasited: u8,
    pub is_selected: u8,
    pub is_starting_attack: u8,
    pub is_stuck: u8,
    pub is_training: u8,
    pub is_under_storm: u8,
    pub is_under_dark_swarm: u8,
    pub is_under_dweb: u8,
    pub is_powered: u8,
    pub is_visible: [u8; 9],
    pub buttonset: i32,
    pub last_attacker_player: i32,
    pub recently_attacked: u8,
    pub replay_id: i32,
}

#[repr(C)]
#[derive(Clone, Copy, Debug, Default)]
pub struct BulletData {
    pub id: i32,
    pub player: i32,
    pub kind: i32,
    pub source: i32,
    pub position_x: i32,
    pub position_y: i32,
    pub angle: f64,
    pub velocity_x: f64,
    pub velocity_y: f64,
    pub target: i32,
    pub target_position_x: i32,
    pub target_position_y: i32,
    pub remove_timer: i32,
    pub exists: u8,
    pub is_visible: [u8; 9],
}

#[repr(C)]
#[derive(Clone, Copy, Debug)]
pub struct RegionData {
    pub id: i32,
    pub island_id: i32,
    pub center_x: i32,
    pub center_y: i32,
    pub priority: i32,
    pub left_most: i32,
    pub right_most: i32,
    pub top_most: i32,
    pub bottom_most: i32,
    pub neighbor_count: i32,
    pub neighbors: [i32; 256],
    pub is_accessible: u8,
    pub is_higher_ground: u8,
}

#[repr(C)]
#[derive(Clone, Copy, Debug, Default)]
pub struct Event {
    pub kind: i32,
    pub value1: i32,
    pub value2: i32,
}

#[repr(C)]
#[derive(Clone, Copy, Debug, Default)]
pub struct Shape {
    pub kind: i32,
    pub coordinate_kind: i32,
    pub x1: i32,
    pub y1: i32,
    pub x2: i32,
    pub y2: i32,
    pub extra1: i32,
    pub extra2: i32,
    pub color: i32,
    pub is_solid: u8,
    pub _padding: [u8; 3],
}

#[repr(C)]
#[derive(Clone, Copy, Debug, Default)]
pub struct Command {
    pub kind: i32,
    pub value1: i32,
    pub value2: i32,
}

#[repr(C)]
#[derive(Clone, Copy, Debug, Default)]
pub struct UnitCommand {
    pub kind: i32,
    pub unit_index: i32,
    pub target_index: i32,
    pub x: i32,
    pub y: i32,
    pub extra: i32,
}

#[repr(C)]
#[derive(Clone, Copy, Debug, Default)]
pub struct UnitFinder {
    pub unit_index: i32,
    pub search_value: i32,
}

/// The complete fixed-size mapping created by BWAPI 4.4.0's injected server.
///
/// `GameData` is intentionally neither `Copy` nor `Default`: it is tens of MiB, and it is
/// supplied by a zero-initialized Windows section rather than constructed on the Rust stack.
#[repr(C)]
pub struct GameData {
    pub client_version: i32,
    pub revision: i32,
    pub is_debug: u8,
    pub instance_id: i32,
    pub bot_apm_noselects: i32,
    pub bot_apm_selects: i32,
    pub force_count: i32,
    pub forces: [ForceData; MAX_FORCES],
    pub player_count: i32,
    pub players: [PlayerData; MAX_PLAYERS],
    pub initial_unit_count: i32,
    pub units: [UnitData; MAX_UNITS],
    pub unit_array: [i32; UNIT_ARRAY_LEN],
    pub bullets: [BulletData; MAX_BULLETS],
    pub nuke_dot_count: i32,
    pub nuke_dots: [Position; MAX_NUKE_DOTS],
    pub game_kind: i32,
    pub latency: i32,
    pub latency_frames: i32,
    pub latency_time: i32,
    pub remaining_latency_frames: i32,
    pub remaining_latency_time: i32,
    pub has_lat_com: u8,
    pub has_gui: u8,
    pub replay_frame_count: i32,
    pub random_seed: u32,
    pub frame_count: i32,
    pub elapsed_time: i32,
    pub countdown_timer: i32,
    pub fps: i32,
    pub average_fps: f64,
    pub mouse_x: i32,
    pub mouse_y: i32,
    pub mouse_state: [u8; MAX_MOUSE_BUTTONS],
    pub key_state: [u8; MAX_KEYS],
    pub screen_x: i32,
    pub screen_y: i32,
    pub flags: [u8; MAX_FLAGS],
    pub map_width: i32,
    pub map_height: i32,
    pub map_file_name: [u8; 261],
    pub map_path_name: [u8; 261],
    pub map_name: [u8; 33],
    pub map_hash: [u8; 41],
    pub ground_height: [[i32; MAP_TILES]; MAP_TILES],
    pub is_walkable: [[u8; MAP_WALK_TILES]; MAP_WALK_TILES],
    pub is_buildable: [[u8; MAP_TILES]; MAP_TILES],
    pub is_visible: [[u8; MAP_TILES]; MAP_TILES],
    pub is_explored: [[u8; MAP_TILES]; MAP_TILES],
    pub has_creep: [[u8; MAP_TILES]; MAP_TILES],
    pub is_occupied: [[u8; MAP_TILES]; MAP_TILES],
    pub map_tile_region_id: [[u16; MAP_TILES]; MAP_TILES],
    pub map_split_tiles_mini_tile_mask: [u16; MAX_REGIONS],
    pub map_split_tiles_region1: [u16; MAX_REGIONS],
    pub map_split_tiles_region2: [u16; MAX_REGIONS],
    pub region_count: i32,
    pub regions: [RegionData; MAX_REGIONS],
    pub start_location_count: i32,
    pub start_locations: [Position; MAX_START_LOCATIONS],
    pub is_in_game: u8,
    pub is_multiplayer: u8,
    pub is_battle_net: u8,
    pub is_paused: u8,
    pub is_replay: u8,
    pub selected_unit_count: i32,
    pub selected_units: [i32; MAX_PLAYERS],
    pub self_: i32,
    pub enemy: i32,
    pub neutral: i32,
    pub event_count: i32,
    pub events: [Event; MAX_EVENTS],
    pub event_string_count: i32,
    pub event_strings: [[u8; 256]; MAX_EVENT_STRINGS],
    pub string_count: i32,
    pub strings: [[u8; 1024]; MAX_STRINGS],
    pub shape_count: i32,
    pub shapes: [Shape; MAX_SHAPES],
    pub command_count: i32,
    pub commands: [Command; MAX_COMMANDS],
    pub unit_command_count: i32,
    pub unit_commands: [UnitCommand; MAX_UNIT_COMMANDS],
    pub unit_search_size: i32,
    pub x_unit_search: [UnitFinder; UNIT_ARRAY_LEN * 2],
    pub y_unit_search: [UnitFinder; UNIT_ARRAY_LEN * 2],
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct InboundCounts {
    pub strings: usize,
    pub shapes: usize,
    pub commands: usize,
    pub unit_commands: usize,
}

impl GameData {
    /// Validates every client-owned array count before a command adapter indexes it.
    pub fn inbound_counts(&self) -> Option<InboundCounts> {
        Some(InboundCounts {
            strings: checked_count(self.string_count, MAX_STRINGS)?,
            shapes: checked_count(self.shape_count, MAX_SHAPES)?,
            commands: checked_count(self.command_count, MAX_COMMANDS)?,
            unit_commands: checked_count(self.unit_command_count, MAX_UNIT_COMMANDS)?,
        })
    }

    /// Clears only fields owned by the client side of the frame protocol, after their contents
    /// have been validated and consumed by the server adapter.
    pub fn clear_inbound(&mut self) {
        self.string_count = 0;
        self.shape_count = 0;
        self.command_count = 0;
        self.unit_command_count = 0;
    }
}

const _: () = assert!(size_of::<Position>() == 8);
const _: () = assert!(size_of::<GameInstance>() == 12);
const _: () = assert!(size_of::<GameTable>() == 96);
const _: () = assert!(size_of::<ForceData>() == 32);
const _: () = assert!(size_of::<PlayerData>() == 5_788);
const _: () = assert!(size_of::<UnitData>() == 336);
const _: () = assert!(size_of::<BulletData>() == 80);
const _: () = assert!(size_of::<RegionData>() == 1_068);
const _: () = assert!(size_of::<Event>() == 12);
const _: () = assert!(size_of::<Shape>() == 40);
const _: () = assert!(size_of::<Command>() == 12);
const _: () = assert!(size_of::<UnitCommand>() == 24);
const _: () = assert!(size_of::<UnitFinder>() == 8);
const _: () = assert!(size_of::<GameData>() == 33_017_048);
const _: () = assert!(offset_of!(GameData, client_version) == 0);
const _: () = assert!(offset_of!(GameData, players) == 192);
const _: () = assert!(offset_of!(GameData, units) == 69_656);
const _: () = assert!(offset_of!(GameData, is_walkable) == 3_709_148);
const _: () = assert!(offset_of!(GameData, events) == 10_586_624);
const _: () = assert!(offset_of!(GameData, strings) == 10_962_632);
const _: () = assert!(offset_of!(GameData, commands) == 32_242_640);
const _: () = assert!(offset_of!(GameData, unit_commands) == 32_482_644);

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn validates_untrusted_client_counts() {
        assert_eq!(checked_count(-1, 3), None);
        assert_eq!(checked_count(4, 3), None);
        assert_eq!(checked_count(3, 3), Some(3));
    }
}
