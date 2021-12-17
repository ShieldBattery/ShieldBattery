pub mod commands;
pub mod list;
pub mod unit;

use std::ffi::CStr;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};

use libc::{c_void, sockaddr};
use once_cell::sync::OnceCell;
use quick_error::quick_error;
use winapi::shared::ntdef::HANDLE;

use bw_dat::UnitId;

use crate::app_messages::{MapInfo, Settings};

pub use bw_dat::structs::*;

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
    /// Guaranteed to be called before any of BW's code is ran.
    fn set_settings(&self, settings: &Settings);
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
        map_info: &MapInfo,
        lobby_name: &str,
        game_type: GameType,
    ) -> Result<(), LobbyCreateError>;
    /// `address` is only used by SCR. 1161 sets address by snp::spoof_game.
    unsafe fn join_lobby(
        &self,
        game_info: &mut JoinableGameInfo,
        is_eud_map: bool,
        map_path: &CStr,
        address: std::net::Ipv4Addr,
    ) -> Result<(), u32>;
    unsafe fn game(&self) -> *mut Game;
    unsafe fn game_data(&self) -> *mut JoinableGameInfo;
    unsafe fn players(&self) -> *mut Player;
    /// May be null in some edge case?
    /// But since it is used for both recording and replaying it usually isn't.
    /// Should still check for null.
    unsafe fn replay_data(&self) -> *mut ReplayData;
    unsafe fn replay_header(&self) -> *mut ReplayHeader;
    fn game_command_lengths(&self) -> &[u32];
    unsafe fn process_replay_commands(&self, commands: &[u8], player: StormPlayerId);
    unsafe fn replay_visions(&self) -> ReplayVisions;

    unsafe fn set_player_name(&self, id: u8, name: &str);

    unsafe fn active_units(&self) -> unit::UnitIterator;
    unsafe fn fow_sprites(&self) -> FowSpriteIterator;
    unsafe fn create_fow_sprite(&self, unit: unit::Unit);
    unsafe fn sprite_position(&self, sprite: *mut c_void) -> Point;
    unsafe fn client_selection(&self) -> [Option<unit::Unit>; 12];

    /// Note: Size is unspecified, but will not change between calls.
    /// (Remastered has 12 storm players)
    unsafe fn storm_players(&self) -> Vec<StormPlayer>;
    /// Size unspecified.
    unsafe fn storm_player_flags(&self) -> Vec<u32>;

    unsafe fn storm_set_last_error(&self, error: u32);
    unsafe fn alloc(&self, size: usize) -> *mut u8;
    unsafe fn free(&self, ptr: *mut u8);

    unsafe fn call_original_status_screen_fn(&self, unit_id: UnitId, dialog: *mut Dialog);
}

/// One bool for state that doesn't require specific handling based on version.
/// Probably should refactor this state to some structure that is available as
/// `bw.common_state()` or something later on, but this will work for this one case.
static HAD_ALLIES_ENABLED: AtomicBool = AtomicBool::new(false);

pub fn set_had_allies_enabled(had: bool) {
    HAD_ALLIES_ENABLED.store(had, Ordering::Relaxed)
}

pub fn get_had_allies_enabled() -> bool {
    HAD_ALLIES_ENABLED.load(Ordering::Relaxed)
}

pub struct ReplayVisions {
    pub show_entire_map: bool,
    pub players: u8,
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

#[repr(C, packed)]
pub struct ReplayHeader {
    pub is_bw: u8,
    pub replay_end_frame: u32,
    pub campaign_mission: u16,
    pub save_data_command: [u8; 0xd],
    pub game_info: JoinableGameInfo,
    pub players: [Player; 0xc],
    pub ai_player_names: [u32; 8],
    pub ums_user_select_slots: [u8; 8],
}

#[repr(C)]
pub struct UnitStatusFunc {
    pub index: u32,
    pub has_changed: unsafe extern fn() -> u32,
    pub update_status: unsafe extern fn(*mut Dialog),
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
    assert_eq!(size_of::<StormPlayer>(), 0x22);
    assert_eq!(size_of::<JoinableGameInfo>(), 0x8d);
    assert_eq!(size_of::<GameTemplate>(), 0x20);
    assert_eq!(size_of::<UiEvent>(), 0x12);
    assert_eq!(size_of::<FowSprite>(), 0x10);
    assert_eq!(size_of::<ReplayData>(), 0x20);
    assert_eq!(size_of::<ReplayHeader>(), 0x279);
    assert_eq!(size_of::<UnitStatusFunc>(), 0xc);
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
