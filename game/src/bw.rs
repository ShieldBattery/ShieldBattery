pub mod commands;
pub mod list;
pub mod unit;

use std::path::{Path, PathBuf};

use libc::{c_void, sockaddr};
use once_cell::sync::OnceCell;
use quick_error::quick_error;
use winapi::shared::ntdef::HANDLE;

#[derive(Copy, Clone, Debug, Eq, PartialEq)]
pub struct StormPlayerId(pub u8);

static BW_IMPL: OnceCell<&'static dyn Bw> = OnceCell::new();

/// Gets access to the object that is used for actually manipulating Broodwar state.
pub fn get_bw() -> &'static dyn Bw {
    *BW_IMPL.get().unwrap()
}

pub fn set_bw_impl(bw: &'static dyn Bw) {
    let _ = BW_IMPL.set(bw);
}

/// The interface to Broodwar.
///
/// Has mainly specialized functions that can only be sensibly called from
/// one point in code, but also some functions returning pointers to internal
/// structures that are more versatile.
pub trait Bw: Sync + Send {
    unsafe fn run_game_loop(&self);
    unsafe fn clean_up_for_exit(&self);
    unsafe fn init_sprites(&self);
    unsafe fn remaining_game_init(&self, local_player_name: &str);
    unsafe fn maybe_receive_turns(&self);
    unsafe fn init_game_network(&self);
    unsafe fn do_lobby_game_init(&self, seed: u32);
    unsafe fn try_finish_lobby_game_init(&self) -> bool;

    /// Inits player's info from storm to starcraft.
    /// Called once player has joined and is visible to storm.
    unsafe fn init_network_player_info(&self, storm_player_id: u32);
    unsafe fn create_lobby(
        &self,
        map_path: &Path,
        lobby_name: &str,
        game_type: GameType,
    ) -> Result<(), LobbyCreateError>;
    /// `map_path` must be null-terminated.
    /// `address` is only used by SCR. 1161 sets address by snp::spoof_game.
    unsafe fn join_lobby(
        &self,
        game_info: &mut JoinableGameInfo,
        map_path: &[u8],
        address: std::net::Ipv4Addr,
    ) -> Result<(), u32>;
    unsafe fn game(&self) -> *mut Game;
    unsafe fn players(&self) -> *mut Player;
    /// May be null in some edge case?
    /// But since it is used for both recording and replaying it usually isn't.
    /// Should still check for null.
    unsafe fn replay_data(&self) -> *mut ReplayData;
    fn game_command_lengths(&self) -> &[u32];
    unsafe fn process_replay_commands(&self, commands: &[u8], player: StormPlayerId);

    unsafe fn set_player_name(&self, id: u8, name: &str);

    unsafe fn active_units(&self) -> unit::UnitIterator;
    unsafe fn fow_sprites(&self) -> FowSpriteIterator;
    unsafe fn create_fow_sprite(&self, unit: unit::Unit);
    unsafe fn sprite_position(&self, sprite: *mut c_void) -> Point;

    /// Note: Size is unspecified, but will not change between calls.
    /// (Remastered has 12 storm players)
    unsafe fn storm_players(&self) -> Vec<StormPlayer>;
    /// Size unspecified.
    unsafe fn storm_player_flags(&self) -> Vec<u32>;

    unsafe fn storm_set_last_error(&self, error: u32);
}

pub const MAX_STORM_PLAYERS: usize = 12;

#[derive(Copy, Clone, Debug, Eq, PartialEq)]
pub struct GameType {
    pub primary: u8,
    pub subtype: u8,
}

impl GameType {
    pub fn as_u32(self) -> u32 {
        self.primary as u32 | ((self.subtype as u32) << 16)
    }

    pub fn is_ums(&self) -> bool {
        self.primary == 0xa
    }

    pub fn is_team_game(&self) -> bool {
        matches!(self.primary, 0xb | 0xc | 0xd)
    }
}

quick_error! {
    #[derive(Debug, Clone)]
    pub enum LobbyCreateError {
        Unknown {}
        Invalid {}                 // This scenario is intended for use with a StarCraft Expansion Set.
        WrongGameType {}           // This map can only be played with the "Use Map Settings" game type.
        LadderBadAuth {}           // You must select an authenticated ladder map to start a ladder game.
        AlreadyExists {}           // A game by that name already exists!
        TooManyNames {}            // Unable to create game because there are too many games already running on this network.
        BadParameters {}           // An error occurred while trying to create the game.
        InvalidPlayerCount {}      // The selected scenario is not valid.
        UnsupportedGameType {}     // The selected map does not support the selected game type and options.
        MissingSaveGamePassword {} // You must enter a password to start a saved game.
        MissingReplayPassword {}   // You must enter a password to start a replay.
        IsDirectory {}             // (Changes the directory)
        NoHumanSlots {}            // This map does not have a slot for a human participant.
        NoComputerSlots {}         // You must have at least one computer opponent.
        InvalidLeagueMap {}        // You must select an official league map to start a league game.
        GameTypeUnavailable {}     // Unable to create game because the selected game type is currently unavailable.
        NotEnoughSlots {}          // The selected map does not have enough player slots for the selected game type.
        LeagueMissingBroodwar {}   // Brood War is required to play league games.
        LeagueBadAuth {}           // You must select an authenticated ladder map to start a ladder game.
        MapNotFound {
            display("Map was not found")
        }
        NonAnsiPath(path: PathBuf) {
            display("Path '{}' cannot be passed to BW", path.display())
        }
        Other(msg: String) {
            display("{}", msg)
        }
    }
}

impl LobbyCreateError {
    pub fn from_error_code(code: u32) -> LobbyCreateError {
        match code {
            0x8000_0001 => LobbyCreateError::Invalid,
            0x8000_0002 => LobbyCreateError::WrongGameType,
            0x8000_0003 => LobbyCreateError::LadderBadAuth,
            0x8000_0004 => LobbyCreateError::AlreadyExists,
            0x8000_0005 => LobbyCreateError::TooManyNames,
            0x8000_0006 => LobbyCreateError::BadParameters,
            0x8000_0007 => LobbyCreateError::InvalidPlayerCount,
            0x8000_0008 => LobbyCreateError::UnsupportedGameType,
            0x8000_0009 => LobbyCreateError::MissingSaveGamePassword,
            0x8000_000a => LobbyCreateError::MissingReplayPassword,
            0x8000_000b => LobbyCreateError::IsDirectory,
            0x8000_000c => LobbyCreateError::NoHumanSlots,
            0x8000_000d => LobbyCreateError::NoComputerSlots,
            0x8000_000e => LobbyCreateError::InvalidLeagueMap,
            0x8000_000f => LobbyCreateError::GameTypeUnavailable,
            0x8000_0010 => LobbyCreateError::NotEnoughSlots,
            0x8000_0011 => LobbyCreateError::LeagueMissingBroodwar,
            0x8000_0012 => LobbyCreateError::LeagueBadAuth,
            _ => LobbyCreateError::Unknown,
        }
    }
}

pub const GAME_STATE_ACTIVE: u32 = 0x04;

pub const PLAYER_TYPE_NONE: u8 = 0x0;
pub const PLAYER_TYPE_HUMAN: u8 = 0x2;
pub const PLAYER_TYPE_LOBBY_COMPUTER: u8 = 0x5;
pub const PLAYER_TYPE_OPEN: u8 = 0x6;
pub const RACE_ZERG: u8 = 0x0;
pub const RACE_TERRAN: u8 = 0x1;
pub const RACE_PROTOSS: u8 = 0x2;
pub const RACE_RANDOM: u8 = 0x6;
pub const CHAT_MESSAGE_ALLIES: u8 = 0x3;

#[repr(C)]
#[derive(Clone)]
pub struct Player {
    pub player_id: u32,
    pub storm_id: u32,
    pub player_type: u8,
    pub race: u8,
    pub team: u8,
    pub name: [u8; 25],
}

#[repr(C)]
#[derive(Copy, Clone)]
pub struct StormPlayer {
    pub state: u8,
    pub unk1: u8,
    pub flags: u16,
    pub unk4: u16,
    // Always 5, not useful for us
    pub protocol_version: u16,
    pub name: [u8; 0x19],
    pub padding: u8,
}

#[repr(C, packed)]
pub struct PreplacedUnit {
    pub whatever: [u8; 0x10],
    pub player: u8,
}

#[repr(C)]
pub struct FowSprite {
    pub prev: *mut FowSprite,
    pub next: *mut FowSprite,
    pub unit_id: u16,
    pub sprite: *mut c_void,
}

#[repr(C, packed)]
pub struct Image {
    pub prev: *mut Image,
    pub next: *mut Image,
    pub image_id: u16,
    pub drawfunc: u8,
    pub direction: u8,
    pub flags: u16,
    pub x_offset: i8,
    pub y_offset: i8,
    pub iscript: Iscript,
    pub frameset: u16,
    pub frame: u16,
    pub map_position: Point,
    pub screen_position: Point,
    pub grp_bounds: Rect,
    pub grp: *mut c_void,
    pub drawfunc_param: *mut c_void,
    pub draw: *mut c_void,
    pub step_frame: *mut c_void,
    /// Sprite pointer, struct format differs between 1161/SCR
    pub parent: *mut c_void,
}

#[repr(C)]
#[derive(Copy, Clone)]
pub struct Iscript {
    pub header: u16,
    pub pos: u16,
    pub return_pos: u16,
    pub animation: u8,
    pub wait: u8,
}

#[repr(C, packed)]
pub struct Unit {
    pub prev: *mut Unit,
    pub next: *mut Unit,
    pub hitpoints: i32,
    /// The sprite struct has different format between 1161 and SC:R,
    /// be aware of which struct this is being casted if accessed
    pub sprite: *mut c_void,
    pub move_target: Point,
    pub move_target_unit: *mut Unit,
    pub next_move_waypoint: Point,
    pub unk_move_waypoint: Point,
    pub flingy_flags: u8,
    pub facing_direction: u8,
    pub flingy_turn_speed: u8,
    pub movement_direction: u8,
    pub flingy_id: u16,
    pub unk_26: u8,
    pub flingy_movement_type: u8,
    pub position: Point,
    pub exact_position: Point32,
    pub flingy_top_speed: u32,
    pub current_speed: i32,
    pub next_speed: i32,
    pub speed: i32,
    pub speed2: i32,
    pub acceleration: u16,
    pub new_direction: u8,
    pub target_direction: u8,
    // Flingy end
    pub player: u8,
    pub order: u8,
    pub order_state: u8,
    pub order_signal: u8,
    pub order_fow_unit: u16,
    pub unused52: u16,
    pub order_timer: u8,
    pub ground_cooldown: u8,
    pub air_cooldown: u8,
    pub spell_cooldown: u8,
    pub order_target_pos: Point,
    pub target: *mut Unit,
    // Entity end
    pub shields: i32,
    pub unit_id: u16,
    pub unused66: u16,
    pub next_player_unit: *mut Unit,
    pub prev_player_unit: *mut Unit,
    pub subunit: *mut Unit,
    pub order_queue_begin: *mut c_void,
    pub order_queue_end: *mut c_void,
    pub previous_attacker: *mut Unit,
    pub related: *mut Unit,
    pub highlight_order_count: u8,
    pub order_wait: u8,
    pub unk86: u8,
    pub attack_notify_timer: u8,
    pub previous_unit_id: u16,
    pub minimap_draw_counter: u8,
    pub minimap_draw_color: u8,
    pub unused8c: u16,
    pub rank: u8,
    pub kills: u8,
    pub last_attacking_player: u8,
    pub secondary_order_wait: u8,
    pub ai_spell_flags: u8,
    pub order_flags: u8,
    pub buttons: u16,
    pub invisibility_effects: u8,
    pub movement_state: u8,
    pub build_queue: [u16; 5],
    pub energy: u16,
    pub current_build_slot: u8,
    pub minor_unique_index: u8,
    pub secondary_order: u8,
    pub building_overlay_state: u8,
    pub build_hp_gain: u16,
    pub build_shield_gain: u16,
    pub remaining_build_time: u16,
    pub previous_hp: u16,
    pub loaded_units: [u16; 8],
    pub unit_specific: [u8; 16],
    pub unit_specific2: [u8; 12],
    pub flags: u32,
    pub carried_powerup_flags: u8,
    pub wireframe_seed: u8,
    pub secondary_order_state: u8,
    pub move_target_update_timer: u8,
    pub detection_status: u32,
    pub unke8: u16,
    pub unkea: u16,
    pub currently_building: *mut Unit,
    pub next_invisible: *mut Unit,
    pub prev_invisible: *mut Unit,
    pub rally_pylon: [u8; 8],
    pub path: *mut c_void,
    pub path_frame: u8,
    pub pathing_flags: u8,
    pub _unk106: u8,
    pub _unk107: u8,
    pub collision_points: [u16; 0x4],
    pub death_timer: u16,
    pub defensive_matrix_dmg: u16,
    pub matrix_timer: u8,
    pub stim_timer: u8,
    pub ensnare_timer: u8,
    pub lockdown_timer: u8,
    pub irradiate_timer: u8,
    pub stasis_timer: u8,
    pub plague_timer: u8,
    pub is_under_storm: u8,
    pub irradiated_by: *mut Unit,
    pub irradiate_player: u8,
    pub parasited_by_players: u8,
    pub master_spell_timer: u8,
    pub is_blind: u8,
    pub maelstrom_timer: u8,
    pub _unk125: u8,
    pub acid_spore_count: u8,
    pub acid_spore_timers: [u8; 0x9],
    pub bullet_spread_seed: u16,
    pub scr_carried_unit_high_bits: u16,
    pub ai: *mut c_void,
    pub _dc138: [u8; 0x18],
}

#[repr(C)]
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
pub struct Rect {
    pub left: i16,
    pub top: i16,
    pub right: i16,
    pub bottom: i16,
}

#[repr(C)]
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
pub struct Point {
    pub x: i16,
    pub y: i16,
}

#[repr(C)]
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
pub struct Point32 {
    pub x: i32,
    pub y: i32,
}

#[repr(C)]
pub struct Supplies {
    pub provided: [u32; 0xc],
    pub used: [u32; 0xc],
    pub max: [u32; 0xc],
}

#[repr(C)]
#[derive(Debug, Copy, Clone)]
pub struct Location {
    pub area: Rect32,
    pub unk: u16,
    pub flags: u16,
}

#[repr(C)]
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
pub struct Rect32 {
    pub left: i32,
    pub top: i32,
    pub right: i32,
    pub bottom: i32,
}

#[repr(C, packed)]
pub struct Game {
    pub minerals: [u32; 0xc],
    pub gas: [u32; 0xc],
    pub dc60: [u8; 0x70],
    pub starting_races: [u8; 0xc],
    pub team_game_main_player: [u8; 4],
    pub screen_pos_x_tiles: u16,
    pub screen_pos_y_tiles: u16,
    pub map_width_tiles: u16,
    pub map_height_tiles: u16,
    pub dce8: [u8; 0x4],
    pub tileset: u16,
    pub bgm_song: u16,
    pub dcf0: u8,
    pub active_net_players: u8,
    pub player_race: u8,
    pub custom_singleplayer: u8,
    pub dcf4: [u8; 0x8],
    pub visions: [u32; 0xc],
    pub player_randomization: [u32; 0x8],
    pub frame_count: u32,
    pub saved_elapsed_seconds: u32,
    pub campaign_mission: u16,
    pub next_scenario: [u8; 0x20],
    pub selected_singleplayer_race: u8,
    pub dc177: [u8; 0x15],
    pub unit_availability: [[u8; 0xe4]; 0xc],
    pub dcc3c: [u8; 0x10],
    pub map_path: [u8; 0x104],
    pub map_title: [u8; 0x20],
    pub selection_hotkeys: [[[u32; 0xc]; 0x12]; 0x8],
    pub dc2870: [u8; 0x400],
    pub chat_dialog_recipient: u8,
    pub player_lose_type: u8,
    pub player_has_left: [u8; 0x8],
    pub self_alliance_colors: [u8; 0xc],
    pub player_color_palette: [[u8; 0x8]; 0xc],
    pub player_minimap_color: [u8; 0xc],
    pub dc2cf2: [u8; 0x362],
    pub supplies: [Supplies; 0x3],
    pub dc3204: [u8; 0x30],
    pub all_units_count: [[u32; 0xc]; 0xe4],
    pub completed_units_count: [[u32; 0xc]; 0xe4],
    pub unit_kills: [[u32; 0xc]; 0xe4],
    pub deaths: [[u32; 0xc]; 0xe4],
    pub tech_availability_sc: [[u8; 0x18]; 0xc],
    pub tech_level_sc: [[u8; 0x18]; 0xc],
    pub dcdf74: [u8; 0x24],
    pub upgrade_limit_sc: [[u8; 0x2e]; 0xc],
    pub upgrade_level_sc: [[u8; 0x2e]; 0xc],
    pub dce3e8: [u8; 0xd8],
    pub player_forces: [u8; 0x8],
    pub force_flags: [u8; 0x4],
    pub force_names: [[u8; 0x1e]; 0x4],
    pub alliances: [[u8; 0xc]; 0xc],
    pub dce5d4: [u8; 0x34],
    pub elapsed_seconds: u32,
    pub dce60c: [u8; 0x4],
    pub victory_state: [u8; 0x8],
    pub computers_in_leaderboard: u32,
    pub dce61c: [u8; 0x554],
    pub locations: [Location; 0xff],
    pub dcff5c: [u8; 0x4],
    pub tech_availability_bw: [[u8; 0x14]; 0xc],
    pub tech_level_bw: [[u8; 0x14]; 0xc],
    pub dc10140: [u8; 0x48],
    pub upgrade_limit_bw: [[u8; 0xf]; 0xc],
    pub upgrade_level_bw: [[u8; 0xf]; 0xc],
    pub dc102f0: [u8; 0x60],
    pub is_bw: u8,
    pub dc10351: [u8; 0x9],
    pub scr_init_color_rgba: [[u8; 4]; 8],
    pub scr_unk1037a: [u8; 0x10],
    pub scr_player_color_preference: [u8; 0x10],
    pub padding: [u8; 0x7366],
}

#[repr(C)]
pub struct Rect16 {
    pub left: i16,
    pub top: i16,
    pub right: i16,
    pub bottom: i16,
}

#[repr(C, packed)]
pub struct Control {
    pub next: *mut Control,
    pub area: Rect16,
    pub whatever8: [u8; 0x8],
    pub label: *const u8,
    pub flags: u32,
    pub whatever1c: [u8; 0x4],
    pub id: i16,
    pub whatever22: [u8; 0x4],
    pub custom_value: *mut c_void,
    pub whatever2a: [u8; 0x8],
    pub parent: *mut Dialog,
}

#[repr(C, packed)]
pub struct Dialog {
    pub base: Control,
    pub whatever36: [u8; 0xc],
    pub first_child: *mut Control,
}

#[repr(C, packed)]
pub struct UiEvent {
    pub extended_type: u32,
    pub extended_param: u32,
    pub value: u32,
    pub ty: u16,
    pub x: i16,
    pub y: i16,
}

// A packet which bw sends to init game data
#[repr(C, packed)]
pub struct LobbyGameInitData {
    pub game_init_command: u8,
    pub random_seed: u32,
    pub player_bytes: [u8; 8],
}

#[repr(C, packed)]
pub struct MapListEntry {
    // Storm list pointers, so any value < 0 is list end
    pub prev: *mut MapListEntry,
    pub next: *mut MapListEntry,
    pub name: [u8; 32],
}

#[repr(C)]
#[derive(Clone)]
pub struct SnpGameInfo {
    pub index: u32,
    pub game_state: u32,
    pub unk1: u32,
    pub host_addr: sockaddr,
    pub unk2: u32,
    pub update_time: u32,
    pub unk3: u32,
    pub game_name: [u8; 128],
    pub game_stats: [u8; 128],
    pub next: *mut SnpGameInfo,
    pub extra: *mut c_void,
    pub extra_size: u32,
    pub product_code: u32,
    pub version_code: u32,
}

#[repr(C)]
pub struct SnpFunctions {
    pub size: u32,
    pub func1: *mut c_void,
    pub unbind: unsafe extern "stdcall" fn() -> i32,
    pub free_packet: unsafe extern "stdcall" fn(*mut sockaddr, *const u8, u32) -> i32,
    pub free_server_packet: unsafe extern "stdcall" fn(*mut sockaddr, *mut c_void, u32) -> i32,
    pub get_game_info:
        unsafe extern "stdcall" fn(u32, *const u8, *const u8, *mut SnpGameInfo) -> i32,
    pub func6: *mut c_void,
    pub initialize: unsafe extern "stdcall" fn(
        *const ClientInfo,
        *mut c_void,
        *mut c_void,
        *mut c_void,
        HANDLE,
    ) -> i32,
    pub func8: *mut c_void,
    pub enum_devices: unsafe extern "stdcall" fn(*mut *mut c_void) -> i32,
    pub receive_games_list: unsafe extern "stdcall" fn(u32, u32, *mut *mut SnpGameInfo) -> i32,
    pub receive_packet:
        unsafe extern "stdcall" fn(*mut *mut sockaddr, *mut *const u8, *mut u32) -> i32,
    pub receive_server_packet:
        unsafe extern "stdcall" fn(*mut *mut sockaddr, *mut *mut c_void, *mut u32) -> i32,
    pub func13: *mut c_void, // SelectGame
    pub send_packet: unsafe extern "stdcall" fn(u32, *const *const sockaddr, *const u8, u32) -> i32,
    pub send_command: unsafe extern "stdcall" fn(
        *const u8,
        *const u8,
        *mut c_void,
        *mut c_void,
        *const u8,
    ) -> i32,
    pub broadcast_game: unsafe extern "stdcall" fn(
        *const u8,
        *const u8,
        *const u8,
        i32,
        u32,
        i32,
        i32,
        i32,
        *mut c_void,
        u32,
    ) -> i32,
    pub stop_broadcasting_game: unsafe extern "stdcall" fn() -> i32,
    pub free_device_data: unsafe extern "stdcall" fn(*mut c_void) -> i32,
    pub find_games: unsafe extern "stdcall" fn(i32, *mut c_void) -> i32,
    pub func20: *mut c_void,
    pub report_game_result:
        unsafe extern "stdcall" fn(i32, i32, *const u8, *const i32, *const u8, *const u8) -> i32,
    pub func22: *mut c_void,
    pub func23: *mut c_void,
    pub func24: *mut c_void,
    pub get_league_id: unsafe extern "stdcall" fn(*mut i32) -> i32,
    pub do_league_logout: unsafe extern "stdcall" fn(*const u8) -> i32,
    pub get_reply_target: unsafe extern "stdcall" fn(*const u8, u32) -> i32,
}

#[repr(C)]
pub struct SnpListEntry {
    pub prev: *mut SnpListEntry,
    pub next: *mut SnpListEntry,
    pub file_path: [u8; 260],
    pub index: u32,
    pub identifier: u32,
    pub name: [u8; 128],
    pub description: [u8; 128],
    pub capabilities: SnpCapabilities,
}

#[repr(C)]
#[derive(Clone)]
pub struct SnpCapabilities {
    pub size: u32,
    pub unknown1: u32,
    pub max_packet_size: u32,
    pub unknown3: u32,
    pub displayed_player_count: u32,
    pub unknown5: u32,
    pub player_latency: u32,
    pub max_player_count: u32,
    pub turn_delay: u32,
}

#[repr(C)]
#[derive(Copy, Clone)]
pub struct ClientInfo {
    pub size: u32,
    pub product_name: *const u8,
    pub version_str: *const u8,
    pub product_code: u32,
    pub version_code: u32,
    pub unk1: u32,
    pub max_players: u32,
    pub unk2: u32,
    pub unk3: u32,
    pub unk4: u32,
    pub unk5: u32,
    pub cd_key: *const u8,
    pub owner_name: *const u8,
    pub is_shareware: u32,
    pub language_id: u32,
}

#[repr(C, packed)]
#[derive(Clone, Copy)]
pub struct JoinableGameInfo {
    pub index: u32,
    pub name: [u8; 24],
    pub save_checksum: u32,
    pub map_width: u16,
    pub map_height: u16,
    pub active_player_count: u8,
    pub max_player_count: u8,
    pub game_speed: u8,
    pub approval: u8,
    pub game_type: u16,
    pub game_subtype: u16,
    pub cdkey_checksum: u32,
    pub tileset: u16,
    pub is_replay: u8,
    pub active_computer_players: u8, // Only set when saving - why..
    pub game_creator: [u8; 25],
    pub map_name: [u8; 32],
    pub game_template: GameTemplate,
}

#[repr(C, packed)]
#[derive(Clone, Copy)]
pub struct GameTemplate {
    pub game_type: u16,
    pub game_subtype: u16,
    pub game_subtype_display: u16,
    pub game_subtype_label: u16,
    pub victory_condition: u8,
    pub resource_type: u8,
    pub use_standard_unit_stats: u8,
    pub fog_of_war: u8,
    pub starting_units: u8,
    pub use_fixed_position: u8,
    pub restriction_flags: u8,
    pub allies_enabled: u8,
    pub num_teams: u8,
    pub cheats_enabled: u8,
    pub tournament_mode: u8,
    pub victory_condition_value: u32,
    pub mineral_value: u32,
    pub gas_value: u32,
    pub padding: u8,
}

#[repr(C)]
pub struct ReplayData {
    pub recording: u32,
    pub playing_back: u32,
    pub data_start: *mut u8,
    pub data_length: u32,
    pub unk10: u32,
    pub data_unk: *mut u8,
    pub unk18: u32,
    pub data_pos: *mut u8,
}

unsafe impl Send for SnpFunctions {}
unsafe impl Sync for SnpFunctions {}
unsafe impl Send for SnpListEntry {}
unsafe impl Sync for SnpListEntry {}
unsafe impl Send for SnpGameInfo {}
unsafe impl Sync for SnpGameInfo {}
unsafe impl Send for ClientInfo {}
unsafe impl Sync for ClientInfo {}

#[test]
fn struct_sizes() {
    use std::mem::size_of;
    assert_eq!(size_of::<SnpGameInfo>(), 0x13c);
    assert_eq!(size_of::<Player>(), 0x24);
    assert_eq!(size_of::<StormPlayer>(), 0x22);
    assert_eq!(size_of::<JoinableGameInfo>(), 0x8d);
    assert_eq!(size_of::<GameTemplate>(), 0x20);
    assert_eq!(size_of::<Control>(), 0x36);
    assert_eq!(size_of::<Dialog>(), 0x46);
    assert_eq!(size_of::<UiEvent>(), 0x12);
    assert_eq!(size_of::<Game>(), 0x17700);
    assert_eq!(size_of::<Unit>(), 0x150);
    assert_eq!(size_of::<Image>(), 0x40);
    assert_eq!(size_of::<FowSprite>(), 0x10);
    assert_eq!(size_of::<ReplayData>(), 0x20);
}

pub struct FowSpriteIterator(*mut FowSprite);

impl FowSpriteIterator {
    pub fn new(first: *mut FowSprite) -> FowSpriteIterator {
        FowSpriteIterator(first)
    }
}

impl Iterator for FowSpriteIterator {
    type Item = *mut FowSprite;
    fn next(&mut self) -> Option<*mut FowSprite> {
        if self.0.is_null() {
            return None;
        }
        let fow = self.0;
        unsafe {
            self.0 = (*fow).next;
        }
        Some(fow)
    }
}
