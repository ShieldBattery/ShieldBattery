use std::path::{Path, PathBuf};
use std::sync::{Arc, RwLock};

use libc::{c_void, sockaddr};
use quick_error::quick_error;
use winapi::shared::ntdef::HANDLE;

/// Gets access to the object that is used for actually manipulating Broodwar state.
pub fn with_bw<F: FnOnce(&Arc<dyn Bw>) -> R, R>(callback: F) -> R {
    let locked = BW_IMPL.read().unwrap();
    let inner = locked.as_ref().unwrap();
    callback(&*inner)
}

pub fn set_bw_impl(bw: Arc<dyn Bw>) {
    *BW_IMPL.write().unwrap() = Some(bw);
}

lazy_static::lazy_static! {
    static ref BW_IMPL: RwLock<Option<Arc<dyn Bw>>> = RwLock::new(None);
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
    unsafe fn set_player_name(&self, id: u8, name: &str);

    /// Note: Size is unspecified, but will not change between calls.
    /// (Remastered has 12 storm players)
    unsafe fn storm_players(&self) -> Vec<StormPlayer>;
    /// Size unspecified.
    unsafe fn storm_player_flags(&self) -> Vec<u32>;

    unsafe fn storm_set_last_error(&self, error: u32);
}

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
            description("Map was not found")
        }
        NonAnsiPath(path: PathBuf) {
            description("A path cannot be passed to BW")
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

pub struct ReplayData;

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

#[repr(C, packed)]
pub struct Unit {
    pub whatever: [u8; 0x4c],
    pub player: u8,
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
    pub dc60: [u8; 0x84],
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
}
