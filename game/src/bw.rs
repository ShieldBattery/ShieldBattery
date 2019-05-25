#![allow(non_upper_case_globals, non_camel_case_types)]

use libc::{c_void, sockaddr};
use winapi::shared::ntdef::HANDLE;

whack_hooks!(stdcall, 0x00400000,
    0x004E0AE0 => WinMain(*mut c_void, *mut c_void, *const u8, i32) -> i32;
    0x004E08A5 => GameInit();
    0x004C4980 => OnSNetPlayerJoined(*mut c_void);
    0x0047F8F0 => ChatCommand(*const u8);
    0x0047F0E0 => ScrollScreen();

    0x004A5230 => MinimapCtrl_InitButton(@eax *mut Control);
    0x004913D0 => MinimapCtrl_ShowAllianceDialog();
    0x004A5200 => DrawMinimap();
    0x004A4E00 => Minimap_TimerRefresh();
    0x0041CA00 => RedrawScreen();
    0x00491310 => AllianceDialog_EventHandler(@ecx *mut Control, @edx *mut UiEvent) -> u32;
    0x0046FEA0 => GameScreenLeftClick(@ecx *mut c_void);
    0x0048EC10 => PlaySoundAtPos(@ebx u32, u32, u32, u32);
    0x004865D0 => ProcessCommands(@eax *const u8, u32, u32);
    0x0047CDD0 => Command_Sync(@edi *const u8) -> u32;
    0x00485F50 => ChatMessage(@ecx u32, @edx *const u8, u32) -> u32;
    0x004194E0 => LoadDialog(@eax *mut Dialog, @ebx *mut c_void, *mut c_void, *const u8, u32);
    0x004EE180 => InitUiVariables();
    0x00458120 => DrawStatusScreen();
    0x004591D0 => UpdateCommandCard();
    0x004598D0 => CmdBtn_EventHandler(@ecx *mut Control, @edx *mut UiEvent) -> u32;
    0x00458900 => DrawCommandButton(@ecx *mut Control, @edx i32, i32, *mut c_void);
    0x004E5640 => DrawResourceCounts(@ecx *mut Control, @edx *mut c_void);
    0x004DDD30 => GetGluAllString(u32) -> *const u8;
    0x004A2D60 => UpdateNetTimeoutPlayers();
    0x004CB190 =>
        CenterScreenOnOwnStartLocation(@eax *mut PreplacedUnit, @ecx *mut c_void) -> u32;
);

whack_funcs!(stdcall, init_funcs, 0x00400000,
    0x004D7390 => init_sprites();
    0x004D3CC0 => choose_network_provider(@ebx u32);
    0x004A8050 => select_map_or_directory(
        // game_name, password, game_type, speed, directory, map entry
        *const u8, *const u8, u32, u32, *const u8, @eax *mut MapListEntry
    ) -> u32;
    0x004A73C0 => get_maps_list(
        // flags, directory, last_map_name, callback(entry, name, flags) -> listbox_index
        u32, *const u8, *const u8,
        @eax unsafe extern "stdcall" fn(*mut MapListEntry, *const u8, u32) -> u32,
    );
    0x004D4130 => init_game_network();
    0x00472110 => on_lobby_game_init(@eax u32, @edx *const LobbyGameInitData);
    0x004A8D40 => update_nation_and_human_ids(@esi u32);
    0x00470D10 => init_network_player_info(u32, u32, u32, u32);
    0x004E0710 => game_loop();
    0x004D3B50 => join_game(@ebx *mut JoinableGameInfo) -> u32;
    0x004BF5D0 => init_map_from_path(*const u8, *mut c_void, u32) -> u32;
    0x00470150 => init_team_game_playable_slots();
    0x00486580 => maybe_receive_turns();
    0x004F3280 => send_multiplayer_chat_message(@eax *const u8);

    0x004CDE70 => add_to_replay_data(@eax *mut ReplayData, @ebx *const u8, @edi u32, u32);
    0x0048D0C0 => display_message(@edi *const u8, @eax u32);
    0x004207B0 => clean_up_for_exit(@ebx u32);
);

whack_vars!(init_vars, 0x00400000,
    0x0058F440 => is_brood_war: u8;
    0x0057EE9C => local_player_name: [u8; 25];
    0x0057F0B4 => is_multiplayer: u8;
    0x0059BB70 => current_map_folder_path: [u8; 260];
    0x0051A27C => map_list_root: *mut MapListEntry;
    0x0057EEE0 => players: [Player; 12];
    0x0066FE20 => storm_players: [StormPlayer; 8];
    0x0051268C => local_storm_id: u32;
    0x0066FBFA => lobby_state: u8;
    0x0057F23C => frame_count: u32;
    0x0058D700 => victory_state: [u8; 8];
    0x00581D61 => player_lose_type: u8;
    0x00581D62 => player_has_left: [u8; 8];
    0x00596904 => game_state: u32;
    0x0057F1DA => chat_message_recipients: u8;
    0x0068C144 => chat_message_type: u8;

    0x00596BBC => replay_data: *mut ReplayData;
    0x006D0F18 => replay_visions: u32;
    0x0057F0B0 => player_visions: u32;
    0x00581D60 => chat_dialog_recipent: u32;
    0x00581DD6 => player_minimap_color: [u8; 12];
    0x006CEB39 => resource_minimap_color: u8;
    0x006D5BC4 => timeout_bin: *mut Dialog;
    0x00512684 => local_nation_id: u32;
    0x006D0F14 => is_replay: u32;
    0x00597248 => primary_selected: *mut Unit;
    0x0057EE7C => storm_id_to_human_id: [u32; 8];
    0x00512678 => current_command_player: u32;
);

pub mod storm {
    use super::*;

    #[repr(C)]
    pub struct SCode {
        pub whatever: [u8; 0x4c],
        pub code_offsets: [*mut u8; 0xa1],
    }

    whack_hooks!(stdcall, 0x15000000,
        0x1503DE90 => InitializeSnpList();
        0x150380A0 => UnloadSnp(u32);
    );

    whack_vars!(init_vars, 0x15000000,
        0x1505E630 => snp_list_initialized: u32;
        // Not actually a full entry, just next/prev pointers
        0x1505AD6C => snp_list: SnpListEntry;
        0x1505EC04 => surface_copy_code: *mut SCode;
    );
}

// Misc non-function-level patches
pub const INIT_SPRITES_RENDER_ONE: usize = 0x0047AEB1;
pub const INIT_SPRITES_RENDER_TWO: usize = 0x0047AFB1;

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

#[repr(C, packed)]
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
#[derive(Clone)]
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
}
