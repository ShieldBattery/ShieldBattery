use std::cell::Cell;
use std::ffi::{CStr, CString, OsString};
use std::marker::PhantomData;
use std::mem;
use std::os::windows::ffi::OsStringExt;
use std::path::{Path, PathBuf};
use std::ptr::{self, NonNull, null, null_mut};
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, AtomicI32, AtomicU8, AtomicU32, AtomicUsize, Ordering};
use std::time::Instant;

use bw_dat::UnitId;
use byteorder::{ByteOrder, LittleEndian};
use hashbrown::HashMap;
use libc::c_void;
use parking_lot::{Mutex, RwLock};
use smallvec::SmallVec;
use winapi::shared::minwindef::FILETIME;
use winapi::shared::windef::HWND;
use winapi::um::errhandlingapi::{GetLastError, SetLastError};
use winapi::um::fileapi::INVALID_FILE_ATTRIBUTES;
use winapi::um::libloaderapi::GetModuleHandleW;
use winapi::um::winnt::FILE_ATTRIBUTE_DIRECTORY;

use scr_analysis::{DatType, VirtualAddress, scarf};
use sdf_cache::{InitSdfCache, SdfCache};
use shader_replaces::ShaderReplaces;
pub use thiscall::Thiscall;

use crate::GameThreadMessage;
use crate::app_messages::{
    AtomicStartingFog, MapInfo, MinimapColorMode, SbUserId, Settings, StartingFog,
};
use crate::bw::apm_stats::ApmStats;
use crate::bw::players::{BwPlayerId, StormPlayerId};
use crate::bw::unit::{Unit, UnitIterator};
use crate::bw::{self, Bw, FowSpriteIterator, LobbyOptions, SnpFunctions};
use crate::bw::{UserLatency, commands};
use crate::bw_scr::scr::SafeBwString;
use crate::game_state::JoinedPlayer;
use crate::game_thread::{self, send_game_msg_to_async};
use crate::netcode_v2;
use crate::recurse_checked_mutex::Mutex as RecurseCheckedMutex;
use crate::snp;
use crate::sync::DumbSpinLock;
use crate::team_colors::{GameStartInfo, TeamColorConfig, TeamColorState};
use crate::windows;

pub mod scr;

mod bw_hash_table;
mod bw_vector;
mod chat;
mod console;
mod dialog_hook;
mod draw_inject;
mod draw_overlay;
mod file_hook;
mod game;
mod pe_image;
mod sdf_cache;
mod shader_replaces;
mod thiscall;

const NET_PLAYER_COUNT: usize = 12;
const SHADER_ID_MASK: u32 = 0x1c;

pub struct BwScr {
    game: Value<*mut bw::Game>,
    game_data: Value<*mut bw::BwGameData>,
    players: Value<*mut bw::Player>,
    chk_players: Value<*mut bw::Player>,
    pathing: Value<*mut bw::Pathing>,
    init_chk_player_types: Value<*mut u8>,
    storm_players: Value<*mut scr::StormPlayer>,
    storm_player_flags: Value<*mut u32>,
    lobby_state: Value<u8>,
    is_multiplayer: Value<u8>,
    in_lobby_or_game: Value<u32>,
    game_state: Value<u8>,
    sprites_inited: Value<u8>,
    is_replay: Value<u32>,
    local_player_id: Value<u32>,
    local_unique_player_id: Value<u32>,
    local_storm_id: Value<u32>,
    command_user: Value<u32>,
    unique_command_user: Value<u32>,
    storm_command_user: Value<u32>,
    rng_seed: Value<u32>,
    /// Indicates whether the network is okay to proceed with the next turn (i.e. all turns are
    /// available from all players)
    is_network_ready: Value<u8>,
    /// User latency setting, 0 = Low, 1 = High, 2 = Extra High
    net_user_latency: Value<u32>,
    net_player_to_game: Value<*mut u32>,
    net_player_to_unique: Value<*mut u32>,
    local_player_name: Value<*mut u8>,
    fonts: Value<*mut *mut scr::Font>,
    first_active_unit: Value<*mut bw::Unit>,
    first_player_unit: Value<*mut *mut bw::Unit>,
    client_selection: Value<*mut *mut bw::Unit>,
    sprites_by_y_tile: Value<*mut *mut scr::Sprite>,
    sprites_by_y_tile_end: Value<*mut *mut scr::Sprite>,
    sprite_x: (Value<*mut *mut scr::Sprite>, u32, scarf::MemAccessSize),
    sprite_y: (Value<*mut *mut scr::Sprite>, u32, scarf::MemAccessSize),
    replay_data: Value<*mut bw::ReplayData>,
    replay_header: Value<*mut bw::ReplayHeader>,
    enable_rng: Value<u32>,
    replay_visions: Value<u8>,
    local_visions: Value<u8>,
    replay_show_entire_map: Value<u8>,
    allocator: Value<*mut scr::Allocator>,
    allocated_order_count: Value<u32>,
    order_limit: Value<u32>,
    map_width_pixels: Value<u32>,
    map_height_pixels: Value<u32>,
    /// Coordinates of screen topleft corner (in map pixels)
    screen_x: Value<u32>,
    screen_y: Value<u32>,
    /// How many map pixels are shown on screen, that is, 640 on 4:3 and default zoom.
    /// Value is larger on 16:9, as well as when zooming out.
    game_screen_width_bwpx: Value<u32>,
    game_screen_height_bwpx: Value<u32>,
    /// How much of the window is vertically used by game screen (0.0 ..= 1.0)
    /// Usually ~0.8 so that the ui console doesn't cover bottom of the map.
    game_screen_height_ratio: Option<Value<f32>>,
    zoom: Value<f32>,
    cursor_scale_factor: Value<f32>,
    units: Value<*mut scr::BwVector>,
    vertex_buffer: Value<*mut scr::VertexBuffer>,
    renderer: Value<*mut scr::Renderer>,
    draw_commands: Value<*mut scr::DrawCommands>,
    /// [[u8; 4]; 256], mostly unused in SC:R, but still gets used for player colors at least.
    main_palette: Value<*mut u8>,
    rgb_colors: Value<*mut [[f32; 0x4]; 0x8]>,
    use_rgb_colors: Value<u8>,
    /// The per-player applied-skin table unit rendering reads, resolved together with its stride
    /// (all-or-nothing). `None` (either missing) turns the peer-skin relay off rather than failing
    /// game launch: BW still renders the local player's own skin from the slot `init_game` filled.
    skin_table: Option<SkinTable>,
    /// Shift+Tab minimap player-color cycle (0 = normal). Saved/restored across game launches.
    minimap_color_mode: Option<Value<u8>>,
    /// Tab minimap-terrain toggle (nonzero = terrain hidden). Saved/restored across game launches.
    minimap_terrain_hidden: Option<Value<u8>>,
    /// The three minimap dot-draw functions the minimap-only team-color mode overrides, resolved
    /// together (all-or-nothing). `Some` = all three were located and hooked, so that mode drives
    /// the dots from `rgb_colors`; `None` (any missing) keeps it on BW's own diplomacy dots.
    minimap_draw_hooks: Option<MinimapDrawHooks>,
    /// BW's in-game chat send-scope byte (`chat_box_mode`): 0 = box closed, 1 = single-player local,
    /// 2 = everyone, 3 = allies, 4 = a specific player, 5 = observers. Read at chat-send time to
    /// scope the netcode v2 relay message. Non-fatal if unlocated (chat degrades to everyone).
    chat_box_mode: Option<Value<u8>>,
    statres_icons: Value<*mut scr::DdsGrpSet>,
    cmdicons: Value<*mut scr::DdsGrpSet>,
    replay_bfix: Option<Value<*mut scr::ReplayBfix>>,
    replay_gcfg: Option<Value<*mut scr::ReplayGcfg>>,
    anti_troll: Option<Value<*mut scr::AntiTroll>>,
    first_dialog: Option<Value<*mut bw::Dialog>>,
    graphic_layers: Option<Value<*mut bw::GraphicLayer>>,
    snet_local_player_list: Option<Value<*mut bw::StormListHead<bw::SNetPlayerConnection>>>,
    /// Resolved symbols for the netcode v2 (rally-point2) turn hooks. Required at launch; see
    /// [`NetcodeV2Bw`].
    netcode_v2: NetcodeV2Bw,
    free_sprites: LinkedList<scr::Sprite>,
    active_fow_sprites: LinkedList<bw::FowSprite>,
    free_fow_sprites: LinkedList<bw::FowSprite>,
    free_images: LinkedList<bw::Image>,
    free_orders: LinkedList<bw::Order>,

    uses_new_join_param_variant: bool,

    // Array of bw::UnitStatusFunc for each unit id,
    // called to update what controls on status screen are shown if the unit
    // is single selected.
    status_screen_funcs: Option<VirtualAddress>,
    original_status_screen_update: Vec<unsafe extern "C" fn(*mut bw::Dialog)>,

    init_network_player_info: unsafe extern "C" fn(u32, u32, u32, u32),
    step_network: unsafe extern "C" fn() -> usize,
    select_map_entry: unsafe extern "C" fn(
        *mut scr::GameInput,
        *mut *const scr::LobbyDialogVtable,
        *mut scr::MapDirEntry,
    ) -> u32,
    // arg 1 path, a2 out, a3 is_campaign, a4 unused?
    init_map_from_path: unsafe extern "C" fn(*const u8, *mut c_void, u32, u32) -> u32,
    join_game: unsafe extern "C" fn(*mut scr::JoinableGameInfo, *mut scr::BwString, usize) -> u32,
    game_loop: unsafe extern "C" fn(),
    init_sprites: unsafe extern "C" fn(),
    init_real_time_lighting: Option<unsafe extern "C" fn()>,
    // Setting the argument to nonzero seems to be used by the new bnet lobbies/mm?
    // Skips over some player initialization and lobby map downloads.
    // It may be slightly more ideal for us to call init_game_network(1) as well, but
    // it would at least require the host to call init_team_game_playable_slots(), and
    // as there may be other similar data that would not be inited, it's going to do
    // init_game_network(0) for now. And that's closer to 1161 behaviour.
    init_game_network: unsafe extern "C" fn(u32),
    process_lobby_commands: unsafe extern "C" fn(*const u8, usize, u32),
    /// BW's native player-color randomizer, or `None` if analysis couldn't locate it (then base
    /// colors stay as BW left them). Takes no arguments; assigns `rgb_colors` from the per-player
    /// color state.
    randomize_player_colors: Option<unsafe extern "C" fn()>,
    choose_snp: unsafe extern "C" fn(u32) -> u32,
    init_storm_networking: unsafe extern "C" fn(),
    storm_create_game: unsafe extern "system" fn(
        *const u8,
        *const u8,
        *const u8,
        u32,
        u32,
        u32,
        *const c_void,
        u32,
        u32,
        u32,
        *const u8,
        *const u8,
        *mut u32,
        *mut c_void,
        u32,
    ) -> u32,
    ttf_malloc: unsafe extern "C" fn(usize) -> *mut u8,
    // Returns a pointer to the 0x20-byte game template for the given game type/subtype (BW's
    // registry loaded from data files), or null if unregistered. cdecl(type_low, type_high, subtype).
    find_game_type_template: unsafe extern "C" fn(u32, u32, u32) -> *const u8,
    send_command: unsafe extern "C" fn(*const u8, usize),
    snet_recv_packets: unsafe extern "C" fn(),
    snet_send_packets: unsafe extern "C" fn(),
    process_events: unsafe extern "C" fn(u32),
    process_game_commands: unsafe extern "C" fn(*const u8, usize, u32),
    move_screen: unsafe extern "C" fn(u32, u32),
    get_render_target: unsafe extern "C" fn(u32) -> *mut scr::RenderTarget,
    load_consoles: Thiscall<unsafe extern "C" fn(*mut scr::BwHashTable<u32, *mut scr::UiConsole>)>,
    init_consoles:
        Thiscall<unsafe extern "C" fn(*mut scr::BwHashTable<u32, *mut scr::UiConsole>, u32)>,
    get_ui_consoles: unsafe extern "C" fn() -> *mut scr::BwHashTable<u32, *mut scr::UiConsole>,
    // select_units(amount, pointers, bool, bool)
    select_units: unsafe extern "C" fn(usize, *const *mut bw::Unit, u32, u32),
    update_game_screen_size: unsafe extern "C" fn(f32),
    move_unit: Thiscall<unsafe extern "C" fn(*mut bw::Unit, i32, i32)>,
    render_screen: unsafe extern "C" fn(*mut c_void, usize),
    lookup_sound_id: unsafe extern "C" fn(*const scr::BwString) -> u32,
    play_sound: unsafe extern "C" fn(u32, f32, *mut c_void, *mut i32, *mut i32) -> u32,
    print_text: unsafe extern "C" fn(*const u8, u32, u32),
    save_replay: unsafe extern "C" fn(*const i8) -> u32,
    sc_main: Option<VirtualAddress>,
    mainmenu_entry_hook: VirtualAddress,
    load_snp_list: VirtualAddress,
    start_udp_server: VirtualAddress,
    font_cache_render_ascii: VirtualAddress,
    ttf_render_sdf: VirtualAddress,
    step_io: VirtualAddress,
    init_game_data: VirtualAddress,
    init_unit_data: VirtualAddress,
    step_game: VirtualAddress,
    step_network_addr: VirtualAddress,
    step_replay_commands: VirtualAddress,
    order_harvest_gas: VirtualAddress,
    game_command_lengths: Vec<u32>,
    prism_pixel_shaders: Vec<VirtualAddress>,
    prism_renderer_vtable: VirtualAddress,
    console_vtables: Vec<VirtualAddress>,
    replay_minimap_patch: Option<scr_analysis::Patch>,
    cursor_dimension_patch: Option<scr_analysis::Patch>,
    open_file: VirtualAddress,
    prepare_issue_order: VirtualAddress,
    create_game_multiplayer: VirtualAddress,
    spawn_dialog: VirtualAddress,
    step_game_logic: VirtualAddress,
    net_format_turn_rate: VirtualAddress,
    init_obs_ui: VirtualAddress,
    draw_graphic_layers: VirtualAddress,
    decide_cursor_type: VirtualAddress,
    load_ddsgrp_cursor: VirtualAddress,
    lobby_create_callback_offset: usize,
    starcraft_tls_index: SendPtr<*mut u32>,
    print_text_addr: VirtualAddress,
    net_player_count_addr: VirtualAddress,

    // State
    exe_build: u32,
    disable_hd: AtomicBool,
    sdf_cache: Arc<InitSdfCache>,
    is_replay_seeking: AtomicBool,
    lobby_game_init_command_seen: AtomicBool,
    shader_replaces: ShaderReplaces,
    renderer_state: Mutex<RendererState>,
    open_replay_file_count: AtomicUsize,
    open_replay_files: Mutex<Vec<SendPtr<*mut c_void>>>,
    is_carbot: AtomicBool,
    show_skins: AtomicBool,
    /// Is the game rendering draw commands with is_hd value 1 or 0? Second index will
    /// be set during transfers between SD/HD
    is_hd_mode: [AtomicBool; 2],
    /// The hd mode guesses for overlay break when there are no BW draw commands and we have
    /// just finished switching between SD/HD. Renderer_Render hook uses this to manually fix
    /// the values if it detects this.
    last_overlay_hd_value: AtomicBool,
    starting_fog: AtomicStartingFog,
    /// Saved Shift+Tab minimap color mode to restore at the start of a game (from local settings).
    saved_minimap_color_mode: AtomicU8,
    /// Saved Tab minimap-terrain-hidden flag to restore at the start of a game (from local settings).
    saved_minimap_terrain_hidden: AtomicBool,
    /// Whether the saved minimap settings have already been applied this game (so we only restore
    /// them once, letting in-game toggles afterwards stick).
    minimap_settings_restored: AtomicBool,
    /// Custom team-color configuration parsed from the launch settings, or `None` when the feature
    /// isn't configured. Written on the async thread at `set_settings`, read once on the game
    /// thread at game init.
    team_color_config: Mutex<Option<TeamColorConfig>>,
    /// Live team-color state for the current game, or `None` when the feature is inactive (UMS,
    /// missing analysis, RGB colors off, or no config). Built and used on the game thread.
    team_color_runtime: Mutex<Option<TeamColorRuntime>>,
    use_legacy_cursor_sizing: AtomicBool,
    use_custom_cursor_size: AtomicBool,
    custom_cursor_size: Mutex<f32>,
    visualize_network_stalls: AtomicBool,
    is_processing_game_commands: AtomicBool,
    /// True if the network is currently stalled (updated whenever `step_network` is called).
    in_network_stall: AtomicBool,
    /// If [`in_network_stall`] is true, this will be the first time the stall was observed, which
    /// can be used to calculate the stall length when it resolves.
    network_stall_start: RwLock<Option<Instant>>,
    /// Avoid reporting the same player being dropped multiple times.
    /// Bit 0x1 = Net id 0, 0x2 = net id 1, etc.
    dropped_players: AtomicU32,
    // Path that reads/writes of CSettings.json will be redirected to
    settings_file_path: RwLock<String>,
    detection_status_copy: Mutex<Vec<u32>>,
    render_state: RecurseCheckedMutex<RenderState>,
    apm_state: RecurseCheckedMutex<ApmStats>,
    /// Keeps track of what game_screen_height_ratio was originally.
    /// (It depends a bit on what console the player uses)
    original_game_screen_height_ratio: AtomicU32,
    /// If console was hidden in replay / obs ui
    console_hidden_state: AtomicBool,
    /// Whether the game has been started (e.g. we're done loading in)
    game_started: AtomicBool,
    /// Whether game results have been sent to the GameState thread yet
    game_results_sent: AtomicBool,
    /// Used to have step_game_logic_hook do things once at start of the game, after initial
    /// units are spawned and game logic is ready to run normally.
    /// Will be reset on replay rewinds.
    first_game_logic_frame_done: AtomicBool,
    sound_id_cache: Mutex<HashMap<String, u32>>,
    /// When the game countdown started (if it has started)
    countdown_start: Mutex<Option<Instant>>,
    print_text_hooks_disabled: AtomicI32,
    chat_manager: Mutex<chat::ChatManager>,
    /// Ensures that things that qualify as "event processing" (e.g. process_events,
    /// maybe_receive_turns) don't execute from multiple threads at the same time (which may happen
    /// at certain points during game init).
    event_processing_lock: DumbSpinLock,
}

/// Resolved BW symbols the netcode v2 turn hooks need. Resolution is **required** — a missing symbol
/// fails game launch like any other analyzed symbol. There is no native-networking fallback at the
/// launch level: the platform is a full cutover to rally-point2 (all clients run the same netcode),
/// so a build that can't resolve the hooks must not run rather than silently degrade. (The per-hook
/// `orig` fallthrough still covers the *phases* the turn transport doesn't carry yet — lobby join, and any game
/// the app didn't hand a rally-point2 session.)
///
/// The `net_player_flags` array and the RNG-enable flag are reused from the existing [`BwScr`]
/// fields (`storm_player_flags` / `enable_rng`), so they are not duplicated here.
struct NetcodeV2Bw {
    /// OUT hook target: `send_turn_message(buffer_ptr, len)` — the fully-assembled local turn just
    /// before it crosses into Storm's broadcast.
    send_turn_message: VirtualAddress,
    /// IN hook target: `receive_storm_turns(...)`, replaced wholesale (we never call the original,
    /// so its obfuscated inner routine that memsets the arrays never runs).
    receive_storm_turns: VirtualAddress,
    /// PIPE hook target: `flush_local_turns_to_latency_depth(...)`, replaced wholesale.
    flush_local_turns: VirtualAddress,
    /// Called by the PIPE replacement to flush one turn (keep-alive seed + `send_turn_message` +
    /// sync append). No stack args — it reads its globals directly.
    flush_outgoing_command_turn: unsafe extern "C" fn(),
    /// Called by the IN replacement inside the synced-RNG window to drain `pending_leave_reason`.
    apply_pending_player_leaves: unsafe extern "C" fn(),
    /// `player_turns[12]`: per-slot pointer to that slot's command bytes for the executable turn.
    player_turns: Value<*mut *mut u8>,
    /// `player_turns_size[12]`: per-slot command byte length.
    player_turns_size: Value<*mut u32>,
    /// `game_frame_count`: the executable-turn index, used as the consensus coordinate on outbound
    /// turns and as the "next frame" fed to the turn state on receive.
    game_frame_count: Value<u32>,
    /// `pending_leave_reason[12]` base: the synced per-slot leave mailbox (nonzero reason = a pending
    /// leave `apply_pending_player_leaves` will apply, then clear, in the synced-RNG window).
    pending_leave_reason: Value<*mut i32>,
    /// Hook target: `storm_join_game(...)`, the Storm-level network join handshake. The netcode-v2
    /// native-lobby join replacement replaces it wholesale (building equivalent session state from
    /// our own inputs) whenever a lobby session seed is staged.
    storm_join_game: VirtualAddress,
    /// Looks up the session-player node with the given 12-byte net key, or creates (and zero-inits,
    /// slot field = 0xffff) a fresh one. cdecl(net_key_ptr).
    storm_session_player_lookup_or_create:
        unsafe extern "C" fn(*const u8) -> *mut scr::StormSessionPlayer,
    /// Returns (creating if needed) the local player's session-player node. cdecl, no args.
    get_local_storm_session_player: unsafe extern "C" fn() -> *mut scr::StormSessionPlayer,
    /// Copies a slot name (max 0x7f chars + NUL) into the slot-name registry the lobby slot-setup
    /// handler's name lookups read. cdecl(slot, name_ptr); return value unused.
    storm_register_slot_name: unsafe extern "C" fn(u32, *const u8) -> u32,
    /// Handler for async lobby command class 0x4A, the per-slot force/alliance/vision apply.
    /// cdecl(record_ptr, guard); record is the 63-byte serialized command body.
    /// Resolved but not yet called by anything (no caller wired up yet).
    #[allow(dead_code)]
    apply_lobby_force_cmd: unsafe extern "C" fn(*const u8, i32) -> i32,
    /// Drains Storm's deferred inbound packet queue (packets that arrived before the local slot /
    /// turn-base were known). cdecl, no args; return value unused.
    snet_drain_deferred_queue: unsafe extern "C" fn() -> u32,
    /// `storm_local_player_slot`: the local storm session slot global (0xff = not in a session).
    storm_local_player_slot: Value<u8>,
    /// `storm_turn_base`: the base added to a session slot to form the game-level net player id.
    storm_turn_base: Value<u32>,
}

/// Live custom-team-color state for one game, present only while the feature is active. Everything
/// here lives on and is touched from the BW main thread.
struct TeamColorRuntime {
    /// The assignment engine, advanced as the local player's alliances change.
    state: TeamColorState,
    /// BW's original `rgb_colors` captured at game init: the per-slot fallback for any slot the
    /// engine leaves unassigned, and the full palette restored in the Standard / minimap-only modes.
    original_rgb_colors: [[f32; 4]; 8],
    /// BW's original `use_rgb_colors` switch captured at game init. Restored verbatim in the
    /// Standard / minimap-only modes so units reproduce the game's native appearance (palette-index
    /// or RGB, whichever it ran), and forced on for the spans where custom colors apply.
    original_use_rgb_colors: u8,
    /// The Shift+Tab color mode the user currently sees. The real `minimap_color_mode` global is
    /// pinned to a fixed value per mode (so BW's own diplomacy recolor never fires), leaving this
    /// the source of truth for what the user selected.
    virtual_mode: MinimapColorMode,
    /// The local player id and the outgoing alliance row currently reflected in the assignment,
    /// or `None` for an observer/replay (no live tracking). Diffed each frame to detect changes.
    local_alliance_row: Option<(u8, [bool; 8])>,
}

/// The three structurally-identical minimap dot-draw functions the minimap-only team-color mode
/// overrides, resolved together (all-or-nothing). Hooking all three lets that mode feed the dots a
/// swapped `rgb_colors` palette for the span of the draw without touching unit colors; a subset
/// would color some dots from `rgb_colors` and leave others on BW's palette-index path, so the
/// feature only engages when every site is present.
/// The per-player applied-skin table: 16 slots (players 0..12, observers 12..16) of `stride`
/// bytes each, holding the opaque skin state BW's unit rendering reads per frame to pick skinned
/// graphics. `init_game` fills only the local player's slot (from local settings/ownership);
/// every other slot starts zeroed and renders default skins until bytes are written into it. The
/// blob layout is opaque to us — slots are only ever copied whole, never parsed.
struct SkinTable {
    base: Value<*mut u8>,
    /// Per-slot stride in bytes. Also the exact length of every blob read from or written into
    /// the table: rendering may read the full slot, so partial writes could mix two players'
    /// state and are never done.
    stride: usize,
}

/// Slot count of [`SkinTable`]: players[] ids 0..12 plus observer ids 12..16, matching the
/// `players[]` indices `unique_player_for_storm` can return.
const SKIN_TABLE_SLOTS: usize = 16;

struct MinimapDrawHooks {
    /// Dispatcher: draws the local player's units and lone sprites inline and calls the two
    /// per-player helpers for everyone else. Takes no argument this feature relies on.
    draw_minimap_units: VirtualAddress,
    /// Per-player helper for high/neutral player ids (8..12). `cdecl(player)`.
    draw_minimap_player_units: VirtualAddress,
    /// Per-player helper for other non-local main players. `cdecl(player)`.
    draw_minimap_main_player_units: VirtualAddress,
}

/// RAII guard for the minimap-only team-color swap. Holds `rgb_colors`'s contents and the
/// `use_rgb_colors` switch from just before the swap and restores both on drop, after the bracketed
/// minimap draw has read the assignment. Forcing the switch on makes the dot-draw sites read
/// `rgb_colors` even when the game ran in palette-index mode, without disturbing unit draws (which
/// happen outside these guards). Created only by [`BwScr::begin_minimap_team_colors`], which
/// validated the pointer in the same game frame on the same thread.
struct MinimapColorSwap {
    rgb_ptr: *mut [[f32; 4]; 8],
    saved_rgb: [[f32; 4]; 8],
    use_rgb_colors: Value<u8>,
    saved_use_rgb: u8,
}

impl Drop for MinimapColorSwap {
    fn drop(&mut self) {
        unsafe {
            *self.rgb_ptr = self.saved_rgb;
            self.use_rgb_colors.write(self.saved_use_rgb);
        }
    }
}

/// The next virtual mode in the Shift+Tab cycle (Standard -> minimap-only -> everywhere -> ...),
/// matching the order BW's native cycle presents.
fn next_minimap_mode(mode: MinimapColorMode) -> MinimapColorMode {
    match mode {
        MinimapColorMode::Standard => MinimapColorMode::PresetOnMinimapOnly,
        MinimapColorMode::PresetOnMinimapOnly => MinimapColorMode::Preset,
        MinimapColorMode::Preset => MinimapColorMode::Standard,
    }
}

/// A per-game shuffle seed drawn from local entropy. The shuffle is a purely local aesthetic, so a
/// wall-clock seed is fine; a replay re-rolling its own shuffle on each viewing is acceptable.
fn shuffle_seed() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_nanos() as u64)
        .unwrap_or(0)
}

/// Outcome of the OUT hook consulting the turn state, deciding whether the turn went to rally-point2 or
/// should fall through to native Storm.
enum TurnSendOutcome {
    /// No live turn state for this turn (lobby phase, or no rally-point2 session) — run native.
    Native,
    /// Handed to the turn state's driver.
    Submitted,
    /// The turn state is live but the driver channel is closed/full mid-game. Not falling back to Storm
    /// (peers are on the relay, so a Storm send wouldn't reach them); the dropped local turn makes
    /// our own IN stall, surfacing the dead session as a lag screen rather than a silent desync.
    Failed,
}

/// Outcome of the IN hook consulting the turn state.
enum TurnReceiveOutcome {
    /// No live turn state for this step — run native `receive_storm_turns`.
    Native,
    /// Every required slot's turn is ready and the arrays are filled — return 1 (dispatch).
    Ready,
    /// A required slot is missing — return 0 (stall); nothing was consumed.
    Stall,
}

/// The leave reason the `forceUnsyncedLeave` debug command writes into `pending_leave_reason`. BW's
/// "dropped" reason (`0x40000006` → `strPLAYER_WAS_DROPPED`), so a forced leave reads on this
/// client exactly as a real drop does — same string, same synced-leave handling.
#[cfg(debug_assertions)]
const FORCED_UNSYNCED_LEAVE_REASON: i32 = 0x40000006u32 as i32;

/// The amount the `forceDesync` debug command adds to the local player's minerals. A visible,
/// obviously-divergent resource change; on its own it only desyncs indirectly (once the extra
/// minerals alter a spend), so it's paired with the RNG-seed perturbation below for a deterministic
/// trip of the per-turn sync check.
#[cfg(debug_assertions)]
const FORCED_DESYNC_MINERAL_BONUS: u32 = 5000;

/// The value the `forceDesync` debug command XORs into this client's synced RNG seed. The seed is
/// folded into the per-turn sync checksum every client compares, so diverging it on one client
/// trips the peers' sync check on the next matching turn — a deterministic, immediate desync
/// trigger (and, because every subsequent RNG draw diverges, a genuine cascading one) rather than
/// waiting for a resource change to indirectly affect unit state.
#[cfg(debug_assertions)]
const FORCED_DESYNC_RNG_XOR: u32 = 0x5B5B_5B5B;

/// State mutated during renderer draw call
struct RenderState {
    overlay: draw_overlay::OverlayState,
    render: draw_inject::RenderState,
    debug_statbtn_dialog_offset: (i32, i32),
}

struct SendPtr<T>(T);
unsafe impl<T> Send for SendPtr<T> {}
unsafe impl<T> Sync for SendPtr<T> {}

/// Keeps track of pointers to renderer structures as they are collected
struct RendererState {
    shader_inputs: Vec<ShaderState>,
}

#[derive(Copy, Clone)]
struct ShaderState {
    shader: *mut scr::Shader,
    vertex_path: *const u8,
    pixel_path: *const u8,
}

impl RendererState {
    unsafe fn set_shader_inputs(
        &mut self,
        shader: *mut scr::Shader,
        vertex_path: *const u8,
        pixel_path: *const u8,
    ) {
        unsafe {
            let id = (*shader).id as usize;
            if self.shader_inputs.len() <= id {
                self.shader_inputs.resize_with(id + 1, || ShaderState {
                    shader: null_mut(),
                    vertex_path: null(),
                    pixel_path: null(),
                });
            }
            if self.shader_inputs[id].shader != shader {
                self.shader_inputs[id] = ShaderState {
                    shader,
                    vertex_path,
                    pixel_path,
                };
            }
        }
    }
}

unsafe impl Send for RendererState {}
unsafe impl Sync for RendererState {}

// Actually thiscall, but that isn't available in stable Rust (._.)
// Luckily we don't care about ecx
// Argument is a pointer to some BnetCreatePopup class
unsafe extern "system" fn lobby_create_callback(_popup: *mut c_void) -> u32 {
    // Return 1001 = Error, 1003 = Ok but needs proxy, 1004 = Other error
    0
}

/// scarf::Operand is a type describing arbitrary expression returned by
/// analysis. For example, it can be a constant memory address 0x123456,
/// pointer indirection Mem32[0x123456], or even arbitrary arithmetic
/// expressions combined with previous examples.
///
/// We cannot resolve the analysis results immediately to concrete pointers
/// after analysis, as the objects can be located in memory that BW has yet
/// to allocate. Instead resolving is done whenever the object is requested.
/// (It isn't that slow performance-wise, and who knows if a future patch
/// moves data around even in middle of game to be a nuisance)
///
/// Note: It is fine to over/underestimate size of an integer type, e.g.
/// using Value<u32> instead of Value<u8> won't corrupt unrelated values.
/// Though using a smaller size than what the value internally is will
/// truncate any read data to that size.
/// (So maybe using Value<u32> always would be fine?)
#[derive(Copy, Clone)]
struct Value<T> {
    op: scarf::Operand<'static>,
    phantom: PhantomData<T>,
}

impl<T> Value<T> {
    fn new(ctx: scarf::OperandCtx<'static>, op: scarf::Operand<'_>) -> Value<T> {
        Value {
            op: ctx.copy_operand(op),
            phantom: Default::default(),
        }
    }
}

trait BwValue {
    fn from_usize(val: usize) -> Self;
    fn to_usize(val: Self) -> usize;
}

impl<T> BwValue for *mut T {
    fn from_usize(val: usize) -> Self {
        val as *mut T
    }
    fn to_usize(val: Self) -> usize {
        val as usize
    }
}

impl BwValue for u8 {
    fn from_usize(val: usize) -> Self {
        val as u8
    }
    fn to_usize(val: Self) -> usize {
        val as usize
    }
}

impl BwValue for u32 {
    fn from_usize(val: usize) -> Self {
        val as u32
    }
    fn to_usize(val: Self) -> usize {
        val as usize
    }
}

impl BwValue for f32 {
    fn from_usize(val: usize) -> Self {
        f32::from_bits(val as u32)
    }
    fn to_usize(val: Self) -> usize {
        val.to_bits() as usize
    }
}

impl<T: BwValue> Value<T> {
    unsafe fn resolve(&self) -> T {
        unsafe { T::from_usize(resolve_operand(self.op, &[])) }
    }

    unsafe fn resolve_with_custom(&self, custom: &[usize]) -> T {
        unsafe { T::from_usize(resolve_operand(self.op, custom)) }
    }

    /// Resolves the value as a pointer so it can be read/written as needed.
    ///
    /// Will panic if it is not possible to form a pointer to the value.
    /// (For example, if the value is defined as `Mem32[addr] ^ 0x12341234`)
    /// Because of that, it is preferable to use resolve/write instead of this
    /// where possible. (Write is not that much more flexible either at the moment,
    /// as it isn't necessary, but it could be improved if needed)
    unsafe fn resolve_as_ptr(&self) -> *mut T {
        unsafe {
            use scr_analysis::scarf::{MemAccessSize, OperandType};
            match self.op.ty() {
                OperandType::Memory(mem) => {
                    let expected_size = match mem::size_of::<T>() {
                        1 => MemAccessSize::Mem8,
                        2 => MemAccessSize::Mem16,
                        3..=4 => MemAccessSize::Mem32,
                        5..=8 => MemAccessSize::Mem64,
                        _ => panic!("Cannot form pointer to {}", self.op),
                    };
                    if mem.size != expected_size {
                        panic!("Cannot form pointer to {}", self.op);
                    }
                    let (base, offset) = mem.address();
                    let base = resolve_operand(base, &[]);
                    base.wrapping_add(offset as usize) as *mut T
                }
                _ => panic!("Cannot form pointer to {}", self.op),
            }
        }
    }

    /// Writes over the value.
    ///
    /// Note that most `Value`s that contain pointers point to statically
    /// allocated data in BW's memory, which cannot be overwritten.
    /// But the pointers obviously let writing over the pointed-to data,
    /// so it isn't necessary to use this function for them.
    ///
    /// (Unlike in 1.16.1, the Game/Player structures are dynamically allocated
    /// so their pointer could technically be changed. But there still isn't
    /// any reason to.)
    unsafe fn write(&self, value: T) {
        unsafe {
            use scr_analysis::scarf::{MemAccessSize, OperandType};
            let value = T::to_usize(value);
            match self.op.ty() {
                OperandType::Memory(mem) => {
                    let (base, offset) = mem.address();
                    let addr = resolve_operand(base, &[]).wrapping_add(offset as usize);
                    match mem.size {
                        MemAccessSize::Mem8 => *(addr as *mut u8) = value as u8,
                        MemAccessSize::Mem16 => (addr as *mut u16).write_unaligned(value as u16),
                        MemAccessSize::Mem32 => (addr as *mut u32).write_unaligned(value as u32),
                        MemAccessSize::Mem64 => (addr as *mut u64).write_unaligned(value as u64),
                    };
                }
                _ => panic!("Cannot write to {}", self.op),
            };
        }
    }
}

unsafe impl<T> Send for Value<T> {}
unsafe impl<T> Sync for Value<T> {}

unsafe fn resolve_operand(op: scarf::Operand<'_>, custom: &[usize]) -> usize {
    unsafe {
        use scr_analysis::scarf::{ArithOpType, MemAccessSize, OperandType};
        match *op.ty() {
            OperandType::Constant(c) => c as usize,
            OperandType::Memory(ref mem) => {
                let (base, offset) = mem.address();
                let addr = resolve_operand(base, custom).wrapping_add(offset as usize);
                if addr < 0x80 {
                    let val = read_fs_gs(addr);
                    match mem.size {
                        MemAccessSize::Mem8 => val & 0xff,
                        MemAccessSize::Mem16 => val & 0xffff,
                        #[allow(clippy::identity_op)] // only identity_op on x86
                        MemAccessSize::Mem32 => val & 0xffff_ffff,
                        MemAccessSize::Mem64 => val,
                    }
                } else {
                    match mem.size {
                        MemAccessSize::Mem8 => (addr as *const u8).read_unaligned() as usize,
                        MemAccessSize::Mem16 => (addr as *const u16).read_unaligned() as usize,
                        MemAccessSize::Mem32 => (addr as *const u32).read_unaligned() as usize,
                        MemAccessSize::Mem64 => (addr as *const u64).read_unaligned() as usize,
                    }
                }
            }
            OperandType::Arithmetic(ref arith) => {
                let left = resolve_operand(arith.left, custom);
                let right = resolve_operand(arith.right, custom);
                match arith.ty {
                    ArithOpType::Add => left.wrapping_add(right),
                    ArithOpType::Sub => left.wrapping_sub(right),
                    ArithOpType::Mul => left.wrapping_mul(right),
                    ArithOpType::Div => left / right,
                    ArithOpType::Modulo => left % right,
                    ArithOpType::And => left & right,
                    ArithOpType::Or => left | right,
                    ArithOpType::Xor => left ^ right,
                    ArithOpType::Lsh => left.wrapping_shl(right as u32),
                    ArithOpType::Rsh => left.wrapping_shr(right as u32),
                    ArithOpType::Equal => (left == right) as usize,
                    ArithOpType::GreaterThan => (left > right) as usize,
                    _ => panic!("Unimplemented resolve: {op}"),
                }
            }
            OperandType::Custom(id) => custom
                .get(id as usize)
                .copied()
                .unwrap_or_else(|| panic!("Resolve needs custom id {id}")),
            _ => panic!("Unimplemented resolve: {op}"),
        }
    }
}

struct LinkedList<T> {
    start: Value<*mut T>,
    end: Value<*mut T>,
}

impl<T> LinkedList<T> {
    pub unsafe fn resolve(&self) -> bw::list::LinkedList<T> {
        unsafe {
            bw::list::LinkedList {
                start: self.start.resolve_as_ptr(),
                end: self.end.resolve_as_ptr(),
            }
        }
    }
}

/// For compatibility with two different struct layouts
trait GameInfoValueTrait: bw_hash_table::BwMove {
    unsafe fn from_u32(val: u32) -> Self;
    unsafe fn from_string(this: *mut Self, val: &[u8]);
}

impl GameInfoValueTrait for scr::GameInfoValueOld {
    unsafe fn from_u32(val: u32) -> Self {
        Self {
            variant: 2,
            data: scr::GameInfoValueUnion { var2_3: val as u64 },
        }
    }

    unsafe fn from_string(this: *mut Self, val: &[u8]) {
        unsafe {
            (*this).variant = 1;
            init_bw_string(
                ptr::addr_of_mut!((*this).data.var1) as *mut scr::BwString,
                val,
            );
        }
    }
}

impl GameInfoValueTrait for scr::GameInfoValue {
    unsafe fn from_u32(val: u32) -> Self {
        Self {
            variant: 2,
            data: scr::GameInfoValueUnion { var2_3: val as u64 },
        }
    }

    unsafe fn from_string(this: *mut Self, val: &[u8]) {
        unsafe {
            (*this).variant = 1;
            init_bw_string(
                ptr::addr_of_mut!((*this).data.var1) as *mut scr::BwString,
                val,
            );
        }
    }
}

pub enum BwInitError {
    AnalysisFail(&'static str),
    UnsupportedVersion(u32),
}

impl From<&'static str> for BwInitError {
    fn from(val: &'static str) -> BwInitError {
        BwInitError::AnalysisFail(val)
    }
}

/// Resolves the netcode v2 turn-hook symbols. Every symbol is required — a missing one is a launch
/// failure naming it, consistent with the rest of `BwScr::new` (no native fallback at launch; full
/// cutover to rally-point2).
fn resolve_netcode_v2(
    analysis: &mut scr_analysis::Analysis<'_>,
    ctx: scarf::OperandCtx<'static>,
) -> Result<NetcodeV2Bw, BwInitError> {
    let send_turn_message = analysis.send_turn_message().ok_or("send_turn_message")?;
    let receive_storm_turns = analysis
        .receive_storm_turns()
        .ok_or("receive_storm_turns")?;
    let flush_local_turns = analysis
        .flush_local_turns_to_latency_depth()
        .ok_or("flush_local_turns_to_latency_depth")?;
    let flush_outgoing_command_turn = analysis
        .flush_outgoing_command_turn()
        .ok_or("flush_outgoing_command_turn")?;
    let apply_pending_player_leaves = analysis
        .apply_pending_player_leaves()
        .ok_or("apply_pending_player_leaves")?;
    let player_turns = analysis.player_turns().ok_or("player_turns")?;
    let player_turns_size = analysis.player_turns_size().ok_or("player_turns_size")?;
    let game_frame_count = analysis.game_frame_count().ok_or("game_frame_count")?;
    let pending_leave_reason = analysis
        .pending_leave_reason()
        .ok_or("pending_leave_reason")?;
    let storm_join_game = analysis.storm_join_game().ok_or("storm_join_game")?;
    let storm_session_player_lookup_or_create = analysis
        .storm_session_player_lookup_or_create()
        .ok_or("storm_session_player_lookup_or_create")?;
    let get_local_storm_session_player = analysis
        .get_local_storm_session_player()
        .ok_or("get_local_storm_session_player")?;
    let storm_register_slot_name = analysis
        .storm_register_slot_name()
        .ok_or("storm_register_slot_name")?;
    let apply_lobby_force_cmd = analysis
        .apply_lobby_force_cmd()
        .ok_or("apply_lobby_force_cmd")?;
    let snet_drain_deferred_queue = analysis
        .snet_drain_deferred_queue()
        .ok_or("snet_drain_deferred_queue")?;
    let storm_local_player_slot = analysis
        .storm_local_player_slot()
        .ok_or("storm_local_player_slot")?;
    let storm_turn_base = analysis.storm_turn_base().ok_or("storm_turn_base")?;

    Ok(NetcodeV2Bw {
        send_turn_message,
        receive_storm_turns,
        flush_local_turns,
        flush_outgoing_command_turn: unsafe { mem::transmute(flush_outgoing_command_turn.0) },
        apply_pending_player_leaves: unsafe { mem::transmute(apply_pending_player_leaves.0) },
        player_turns: Value::new(ctx, player_turns),
        player_turns_size: Value::new(ctx, player_turns_size),
        game_frame_count: Value::new(ctx, game_frame_count),
        pending_leave_reason: Value::new(ctx, pending_leave_reason),
        storm_join_game,
        storm_session_player_lookup_or_create: unsafe {
            mem::transmute(storm_session_player_lookup_or_create.0)
        },
        get_local_storm_session_player: unsafe { mem::transmute(get_local_storm_session_player.0) },
        storm_register_slot_name: unsafe { mem::transmute(storm_register_slot_name.0) },
        apply_lobby_force_cmd: unsafe { mem::transmute(apply_lobby_force_cmd.0) },
        snet_drain_deferred_queue: unsafe { mem::transmute(snet_drain_deferred_queue.0) },
        storm_local_player_slot: Value::new(ctx, storm_local_player_slot),
        storm_turn_base: Value::new(ctx, storm_turn_base),
    })
}

/// Writes a Storm session-player node's slot the way native join does: the low byte only. A node is
/// created with its `u16` slot field set to 0xffff, and native join overwrites just the low byte,
/// leaving the high byte 0xff; readers compare only the low byte, so writing the full `u16` would
/// diverge from native and be wrong.
unsafe fn write_session_player_slot(node: *mut scr::StormSessionPlayer, slot: u8) {
    unsafe {
        (&raw mut (*node).slot).cast::<u8>().write(slot);
    }
}

/// Copies a player name into a session-player node's `name` buffer, matching Storm's own bound: at
/// most 0x7f characters plus a NUL terminator (the buffer is 0x80 bytes).
unsafe fn copy_session_player_name(node: *mut scr::StormSessionPlayer, name: &CStr) {
    unsafe {
        let bytes = name.to_bytes();
        let len = bytes.len().min(0x7f);
        let dest = (&raw mut (*node).name).cast::<u8>();
        ptr::copy_nonoverlapping(bytes.as_ptr(), dest, len);
        dest.add(len).write(0);
    }
}

/// The classic chat command's fixed record size: a 2-byte header (`0x5c`, sender game id) followed
/// by a 0x50-byte NUL-padded text field.
const CHAT_RECORD_LEN: usize = 0x52;

/// Builds the classic `0x5c` chat command record — `[0x5c][sender_game_id][0x50 NUL-padded
/// text]` — the fixed layout the native command dispatcher renders on the overlay with
/// attribution from `sender_game_id` and (for a live, not-yet-recorded command) appends to the
/// replay. `text` is truncated (on a UTF-8 boundary) to [`commands::CHAT_TEXT_CAPACITY`] bytes if
/// it doesn't already fit; the remainder of the text field, and its final byte, stay `0` (the
/// NUL terminator).
fn build_chat_record(sender_game_id: u8, text: &str) -> [u8; CHAT_RECORD_LEN] {
    let mut record = [0u8; CHAT_RECORD_LEN];
    record[0] = commands::id::CHAT;
    record[1] = sender_game_id;
    let text = commands::truncate_utf8(text, commands::CHAT_TEXT_CAPACITY);
    record[2..2 + text.len()].copy_from_slice(text.as_bytes());
    record
}

impl BwScr {
    /// On failure returns a description of address that couldn't be found
    pub fn new() -> Result<BwScr, BwInitError> {
        let binary = unsafe {
            let base = GetModuleHandleW(null()) as *const u8;
            let text = pe_image::get_section(base, b".text\0\0\0").unwrap();
            let rdata = pe_image::get_section(base, b".rdata\0\0").unwrap();
            let data = pe_image::get_section(base, b".data\0\0\0").unwrap();
            let reloc = pe_image::get_section(base, b".reloc\0\0").unwrap();
            #[cfg(target_arch = "x86_64")]
            let pdata = pe_image::get_section(base, b".pdata\0\0").unwrap();

            #[cfg(target_arch = "x86")]
            let sections = vec![pe_image::get_pe_header(base), text, rdata, data, reloc];
            #[cfg(target_arch = "x86_64")]
            let sections = vec![
                pe_image::get_pe_header(base),
                text,
                rdata,
                data,
                pdata,
                reloc,
            ];

            let base = VirtualAddress(base as _);
            #[allow(unused_mut)] // As mutation is needed only on the cfg(x86) part
            let mut binary = scarf::raw_bin(base, sections);
            #[cfg(target_arch = "x86")]
            {
                let relocs =
                    scarf::analysis::find_relocs::<scarf::ExecutionStateX86<'_>>(&binary).unwrap();
                binary.set_relocs(relocs);
            }
            binary
        };
        let exe_build = get_exe_build();
        info!("StarCraft build {exe_build}");
        // We probably would be able to support some older versions too, but require at least the
        // initial 1.23.9 patch (1.23.9.9899, from July 2021).
        if exe_build < 9899 {
            return Err(BwInitError::UnsupportedVersion(exe_build));
        }

        let analysis_ctx = scarf::OperandContext::new();
        let mut analysis = scr_analysis::Analysis::new(&binary, &analysis_ctx);

        let ctx: scarf::OperandCtx<'static> = Box::leak(Box::new(scarf::OperandContext::new()));
        let game = analysis.game().ok_or("Game")?;
        let game_data = analysis.game_data().ok_or("Game Data")?;
        let players = analysis.players().ok_or("Players")?;
        let pathing = analysis.pathing().ok_or("Pathing")?;
        let chk_players = analysis.chk_init_players().ok_or("CHK players")?;
        let init_chk_player_types = analysis
            .original_chk_player_types()
            .ok_or("Orig CHK player types")?;
        let storm_players = analysis.storm_players().ok_or("Storm players")?;
        let init_network_player_info = analysis
            .init_net_player()
            .ok_or("init_network_player_info")?;
        let storm_player_flags = analysis.net_player_flags().ok_or("Storm player flags")?;
        let step_network = analysis.step_network().ok_or("step_network")?;
        let lobby_state = analysis.lobby_state().ok_or("Lobby state")?;
        let is_multiplayer = analysis.is_multiplayer().ok_or("is_multiplayer")?;
        let in_lobby_or_game = analysis.in_lobby_or_game().ok_or("in_lobby_or_game")?;
        let select_map_entry = analysis.select_map_entry().ok_or("select_map_entry")?;
        let game_state = analysis.game_state().ok_or("Game state")?;
        let rng_seed = analysis.rng_seed().ok_or("RNG seed")?;
        let sc_main = analysis.sc_main();
        let mainmenu_entry_hook = analysis.mainmenu_entry_hook().ok_or("Entry hook")?;
        let game_loop = analysis.game_loop().ok_or("Game loop")?;
        let init_map_from_path = analysis.init_map_from_path().ok_or("init_map_from_path")?;
        let join_game = analysis.join_game().ok_or("join_game")?;
        let init_sprites = analysis.load_images().ok_or("Init sprites")?;
        let init_real_time_lighting = analysis.init_real_time_lighting();
        let sprites_inited = analysis.images_loaded().ok_or("Sprites inited")?;
        let init_game_network = analysis.init_game_network().ok_or("Init game network")?;
        let storm_create_game = analysis.storm_create_game().ok_or("storm_create_game")?;
        let process_lobby_commands = analysis
            .process_lobby_commands()
            .ok_or("Process lobby commands")?;
        // Non-fatal: without it, base player colors stay as BW left them (deterministic slot order)
        // rather than failing game launch.
        let randomize_player_colors = analysis.randomize_player_colors();
        if randomize_player_colors.is_none() {
            warn!("Could not find randomize_player_colors; base colors will not randomize");
        }
        let send_command = analysis.send_command().ok_or("send_command")?;
        let is_replay = analysis.is_replay().ok_or("is_replay")?;
        let local_player_id = analysis.local_player_id().ok_or("Local player id")?;
        let local_storm_id = analysis.local_storm_player_id().ok_or("Local storm id")?;
        let local_unique_player_id = analysis
            .local_unique_player_id()
            .ok_or("Local unique player id")?;
        let command_user = analysis.command_user().ok_or("Command user")?;
        let unique_command_user = analysis
            .unique_command_user()
            .ok_or("Unique command user")?;
        let storm_command_user = analysis.storm_command_user().ok_or("Storm command user")?;
        let is_network_ready = analysis.network_ready().ok_or("Is network ready")?;
        let net_user_latency = analysis.net_user_latency().ok_or("Net user latency")?;
        let net_format_turn_rate = analysis
            .net_format_turn_rate()
            .ok_or("net_format_turn_rate")?;
        let net_player_to_game = analysis.net_player_to_game().ok_or("Net player to game")?;
        let net_player_to_unique = analysis
            .net_player_to_unique()
            .ok_or("Net player to unique")?;
        let choose_snp = analysis.choose_snp().ok_or("choose_snp")?;
        let local_player_name = analysis.local_player_name().ok_or("Local player name")?;
        let fonts = analysis.fonts().ok_or("Fonts")?;
        let init_storm_networking = analysis
            .init_storm_networking()
            .ok_or("init_storm_networking")?;
        let load_snp_list = analysis.load_snp_list().ok_or("load_snp_list")?;
        let start_udp_server = analysis.start_udp_server().ok_or("start_udp_server")?;
        let font_cache_render_ascii = analysis
            .font_cache_render_ascii()
            .ok_or("font_cache_render_ascii")?;
        let ttf_malloc = analysis.ttf_malloc().ok_or("ttf_malloc")?;
        let find_game_type_template = analysis
            .find_game_type_template()
            .ok_or("find_game_type_template")?;
        let ttf_render_sdf = analysis.ttf_render_sdf().ok_or("ttf_render_sdf")?;
        let lobby_create_callback_offset = analysis
            .create_game_dialog_vtbl_on_multiplayer_create()
            .ok_or("Lobby create callback vtable offset")?;
        let process_events = analysis.process_events().ok_or("process_events")?;
        let process_game_commands = analysis.process_commands().ok_or("process_game_commands")?;
        let game_command_lengths = analysis.command_lengths();
        let snet_recv_packets = analysis.snet_recv_packets().ok_or("snet_recv_packets")?;
        let snet_send_packets = analysis.snet_send_packets().ok_or("snet_send_packets")?;
        let step_io = analysis.step_io().ok_or("step_io")?;
        let init_game_data = analysis.init_game().ok_or("init_game_data")?;
        let init_unit_data = analysis.init_units().ok_or("init_unit_data")?;
        let step_replay_commands = analysis
            .step_replay_commands()
            .ok_or("step_replay_commands")?;
        let save_replay = analysis.save_replay().ok_or("save_replay")?;
        let order_harvest_gas = analysis.order_harvest_gas().ok_or("order_harvest_gas")?;

        let prism_pixel_shaders = analysis
            .prism_pixel_shaders()
            .ok_or("Prism pixel shaders")?;
        let prism_renderer_vtable = analysis.prism_renderer_vtable().ok_or("Prism renderer")?;
        let console_vtables = analysis.console_vtables();

        let first_active_unit = analysis.first_active_unit().ok_or("first_active_unit")?;
        let first_player_unit = analysis.first_player_unit().ok_or("first_player_unit")?;
        let client_selection = analysis.client_selection().ok_or("client_selection")?;
        let sprite_x = analysis.sprite_x().ok_or("sprite_x")?;
        let sprite_y = analysis.sprite_y().ok_or("sprite_y")?;
        let sprites_by_y_tile = analysis
            .sprites_by_y_tile_start()
            .ok_or("sprites_by_y_tile_start")?;
        let sprites_by_y_tile_end = analysis
            .sprites_by_y_tile_end()
            .ok_or("sprites_by_y_tile_end")?;
        let step_game = analysis.step_game().ok_or("step_game")?;
        let free_sprites = LinkedList {
            start: Value::new(
                ctx,
                analysis.first_free_sprite().ok_or("first_free_sprite")?,
            ),
            end: Value::new(ctx, analysis.last_free_sprite().ok_or("last_free_sprite")?),
        };
        let active_fow_sprites = LinkedList {
            start: Value::new(
                ctx,
                analysis
                    .first_active_fow_sprite()
                    .ok_or("first_active_fow_sprite")?,
            ),
            end: Value::new(
                ctx,
                analysis
                    .last_active_fow_sprite()
                    .ok_or("last_active_fow_sprite")?,
            ),
        };
        let free_fow_sprites = LinkedList {
            start: Value::new(
                ctx,
                analysis
                    .first_free_fow_sprite()
                    .ok_or("first_free_fow_sprite")?,
            ),
            end: Value::new(
                ctx,
                analysis
                    .last_free_fow_sprite()
                    .ok_or("last_free_fow_sprite")?,
            ),
        };
        let free_images = LinkedList {
            start: Value::new(ctx, analysis.first_free_image().ok_or("first_free_image")?),
            end: Value::new(ctx, analysis.last_free_image().ok_or("last_free_image")?),
        };
        let free_orders = LinkedList {
            start: Value::new(ctx, analysis.first_free_order().ok_or("first_free_order")?),
            end: Value::new(ctx, analysis.last_free_order().ok_or("last_free_order")?),
        };

        let replay_data = analysis.replay_data().ok_or("replay_data")?;
        let replay_header = analysis.replay_header().ok_or("replay_header")?;
        let enable_rng = analysis.enable_rng().ok_or("Enable RNG")?;
        let replay_visions = analysis.replay_visions().ok_or("replay_visions")?;
        let local_visions = analysis.local_visions().ok_or("local_visions")?;
        let replay_show_entire_map = analysis
            .replay_show_entire_map()
            .ok_or("replay_show_entire_map")?;
        let allocator = analysis.allocator().ok_or("allocator")?;
        let allocated_order_count = analysis
            .allocated_order_count()
            .ok_or("allocated_order_count")?;
        let order_limit = analysis.order_limit().ok_or("order_limit")?;
        let replay_bfix = analysis.replay_bfix();
        let replay_gcfg = analysis.replay_gcfg();
        let prepare_issue_order = analysis
            .prepare_issue_order()
            .ok_or("prepare_issue_order")?;
        let create_game_multiplayer = analysis
            .create_game_multiplayer()
            .ok_or("create_game_multiplayer")?;
        let spawn_dialog = analysis.spawn_dialog().ok_or("spawn_dialog")?;
        let step_game_logic = analysis.step_game_logic().ok_or("step_game_logic")?;
        let anti_troll = analysis.anti_troll();
        let first_dialog = analysis.first_dialog();
        let graphic_layers = analysis.graphic_layers();
        let snet_local_player_list = analysis.snet_local_player_list();
        let units = analysis.units().ok_or("units")?;
        let vertex_buffer = analysis.vertex_buffer().ok_or("vertex_buffer")?;
        let renderer = analysis.renderer().ok_or("renderer")?;
        let draw_commands = analysis.draw_commands().ok_or("draw_commands")?;
        let map_width_pixels = analysis.map_width_pixels().ok_or("map_width_pixels")?;
        let map_height_pixels = analysis.map_height_pixels().ok_or("map_height_pixels")?;
        let main_palette = analysis.main_palette().ok_or("main_palette")?;
        let rgb_colors = analysis.rgb_colors().ok_or("rgb_colors")?;
        let use_rgb_colors = analysis.use_rgb_colors().ok_or("use_rgb_colors")?;
        // These two are non-fatal: if the analysis can't locate them we just lose the
        // save/restore of the minimap color/terrain toggles rather than failing game launch.
        let minimap_color_mode = analysis.minimap_color_mode();
        if minimap_color_mode.is_none() {
            warn!("Could not find minimap_color_mode global");
        }
        let minimap_terrain_hidden = analysis.minimap_terrain_hidden();
        if minimap_terrain_hidden.is_none() {
            warn!("Could not find minimap_terrain_hidden global");
        }
        // Non-fatal, all-or-nothing: reading or writing skin blobs needs both the table base and
        // its stride. Without them peers just see default skins, as they would natively when a
        // blob never arrives.
        let skin_table = match (analysis.player_skins(), analysis.skins_size()) {
            (Some(base), Some(stride)) => Some((base, stride)),
            _ => {
                warn!("Could not find player_skins/skins_size; peer skins will not be relayed");
                None
            }
        };
        // Non-fatal, all-or-nothing: the three minimap dot-draw functions are hooked together so the
        // minimap-only team-color mode can swap the palette for the span of the draw. Without all
        // three that mode falls back to BW's own diplomacy dots rather than failing game launch.
        let minimap_draw_hooks = match (
            analysis.draw_minimap_units(),
            analysis.draw_minimap_player_units(),
            analysis.draw_minimap_main_player_units(),
        ) {
            (
                Some(draw_minimap_units),
                Some(draw_minimap_player_units),
                Some(draw_minimap_main_player_units),
            ) => Some(MinimapDrawHooks {
                draw_minimap_units,
                draw_minimap_player_units,
                draw_minimap_main_player_units,
            }),
            _ => {
                warn!(
                    "Could not find all minimap draw functions; minimap-only team colors will use BW diplomacy dots"
                );
                None
            }
        };
        // Non-fatal: without it, in-game chat can't read its send-scope and every message goes to
        // everyone rather than failing game launch.
        let chat_box_mode = analysis.chat_box_mode();
        if chat_box_mode.is_none() {
            warn!("Could not find chat_box_mode global");
        }
        let statres_icons = analysis.statres_icons().ok_or("statres_icons")?;
        let cmdicons = analysis.cmdicons().ok_or("cmdicons")?;
        let screen_x = analysis.screen_x().ok_or("screen_x")?;
        let screen_y = analysis.screen_y().ok_or("screen_y")?;
        let game_screen_width_bwpx = analysis
            .game_screen_width_bwpx()
            .ok_or("game_screen_width_bwpx")?;
        let game_screen_height_bwpx = analysis
            .game_screen_height_bwpx()
            .ok_or("game_screen_height_bwpx")?;
        let game_screen_height_ratio = analysis.game_screen_height_ratio();
        let zoom = analysis.zoom().ok_or("zoom")?;
        let move_screen = analysis.move_screen().ok_or("move_screen")?;
        let update_game_screen_size = analysis
            .update_game_screen_size()
            .ok_or("update_game_screen_size")?;
        let move_unit = analysis.move_unit().ok_or("move_unit")?;
        let get_render_target = analysis.get_render_target().ok_or("get_render_target")?;
        let load_consoles = analysis.load_consoles().ok_or("load_consoles")?;
        let init_consoles = analysis.init_consoles().ok_or("init_consoles")?;
        let get_ui_consoles = analysis.get_ui_consoles().ok_or("get_ui_consoles")?;
        let init_obs_ui = analysis.init_obs_ui().ok_or("init_obs_ui")?;
        let draw_graphic_layers = analysis
            .draw_graphic_layers()
            .ok_or("draw_graphic_layers")?;
        let render_screen = analysis.render_screen().ok_or("render_screen")?;
        let decide_cursor_type = analysis.decide_cursor_type().ok_or("decide_cursor_type")?;
        let load_ddsgrp_cursor = analysis.load_ddsgrp_cursor().ok_or("load_ddsgrp_cursor")?;
        let cursor_scale_factor = analysis
            .cursor_scale_factor()
            .ok_or("cursor_scale_factor")?;
        let select_units = analysis.select_units().ok_or("select_units")?;
        let lookup_sound_id = analysis.lookup_sound_id().ok_or("lookup_sound")?;
        let play_sound = analysis.play_sound().ok_or("play_sound")?;
        let print_text_addr = analysis.print_text().ok_or("print_text")?;
        let net_player_count_addr = analysis.net_player_count().ok_or("net_player_count")?;

        let uses_new_join_param_variant = match analysis.join_param_variant_type_offset() {
            Some(0) => false,
            #[cfg(target_arch = "x86")]
            Some(0x20) => true,
            #[cfg(target_arch = "x86_64")]
            Some(0x28) => true,
            _ => return Err(BwInitError::AnalysisFail("join_param_variant_layout")),
        };

        let starcraft_tls_index = analysis.get_tls_index().ok_or("TLS index")?;

        let open_file = analysis
            .file_hook()
            .ok_or("open_file (Required due to SB_NO_HD)")?;

        let replay_minimap_patch = analysis.replay_minimap_unexplored_fog_patch();
        let cursor_dimension_patch = analysis.cursor_dimension_patch();

        let status_screen_funcs = analysis.status_screen_funcs();
        let original_status_screen_update = if let Some(arr) = status_screen_funcs {
            unsafe {
                let arr = arr.0 as *const bw::UnitStatusFunc;
                (0..228).map(|i| (*arr.add(i)).update_status).collect()
            }
        } else {
            Vec::new()
        };

        // Required: a resolution failure fails launch (full cutover to rally-point2, no native
        // fallback at the launch level).
        let netcode_v2 = resolve_netcode_v2(&mut analysis, ctx)?;

        init_bw_dat(&mut analysis)?;

        debug!("Found all necessary BW data");

        let sdf_cache = Arc::new(InitSdfCache::new());
        Ok(BwScr {
            game: Value::new(ctx, game),
            game_data: Value::new(ctx, game_data),
            players: Value::new(ctx, players),
            chk_players: Value::new(ctx, chk_players),
            pathing: Value::new(ctx, pathing),
            init_chk_player_types: Value::new(ctx, init_chk_player_types),
            storm_players: Value::new(ctx, storm_players),
            storm_player_flags: Value::new(ctx, storm_player_flags),
            lobby_state: Value::new(ctx, lobby_state),
            is_multiplayer: Value::new(ctx, is_multiplayer),
            in_lobby_or_game: Value::new(ctx, in_lobby_or_game),
            game_state: Value::new(ctx, game_state),
            sprites_inited: Value::new(ctx, sprites_inited),
            is_replay: Value::new(ctx, is_replay),
            local_player_id: Value::new(ctx, local_player_id),
            local_unique_player_id: Value::new(ctx, local_unique_player_id),
            local_storm_id: Value::new(ctx, local_storm_id),
            command_user: Value::new(ctx, command_user),
            unique_command_user: Value::new(ctx, unique_command_user),
            storm_command_user: Value::new(ctx, storm_command_user),
            rng_seed: Value::new(ctx, rng_seed),
            is_network_ready: Value::new(ctx, is_network_ready),
            net_user_latency: Value::new(ctx, net_user_latency),
            net_player_to_game: Value::new(ctx, net_player_to_game),
            net_player_to_unique: Value::new(ctx, net_player_to_unique),
            local_player_name: Value::new(ctx, local_player_name),
            fonts: Value::new(ctx, fonts),
            first_active_unit: Value::new(ctx, first_active_unit),
            first_player_unit: Value::new(ctx, first_player_unit),
            client_selection: Value::new(ctx, client_selection),
            sprites_by_y_tile: Value::new(ctx, sprites_by_y_tile),
            sprites_by_y_tile_end: Value::new(ctx, sprites_by_y_tile_end),
            sprite_x: (Value::new(ctx, sprite_x.0), sprite_x.1, sprite_x.2),
            sprite_y: (Value::new(ctx, sprite_y.0), sprite_y.1, sprite_y.2),
            replay_data: Value::new(ctx, replay_data),
            replay_header: Value::new(ctx, replay_header),
            enable_rng: Value::new(ctx, enable_rng),
            replay_visions: Value::new(ctx, replay_visions),
            local_visions: Value::new(ctx, local_visions),
            replay_show_entire_map: Value::new(ctx, replay_show_entire_map),
            allocator: Value::new(ctx, allocator),
            allocated_order_count: Value::new(ctx, allocated_order_count),
            order_limit: Value::new(ctx, order_limit),
            units: Value::new(ctx, units),
            vertex_buffer: Value::new(ctx, vertex_buffer),
            renderer: Value::new(ctx, renderer),
            draw_commands: Value::new(ctx, draw_commands),
            map_width_pixels: Value::new(ctx, map_width_pixels),
            map_height_pixels: Value::new(ctx, map_height_pixels),
            main_palette: Value::new(ctx, main_palette),
            rgb_colors: Value::new(ctx, rgb_colors),
            use_rgb_colors: Value::new(ctx, use_rgb_colors),
            minimap_color_mode: minimap_color_mode.map(|op| Value::new(ctx, op)),
            minimap_terrain_hidden: minimap_terrain_hidden.map(|op| Value::new(ctx, op)),
            skin_table: skin_table.map(|(base, stride)| SkinTable {
                base: Value::new(ctx, base),
                stride: stride as usize,
            }),
            minimap_draw_hooks,
            chat_box_mode: chat_box_mode.map(|op| Value::new(ctx, op)),
            statres_icons: Value::new(ctx, statres_icons),
            cmdicons: Value::new(ctx, cmdicons),
            screen_x: Value::new(ctx, screen_x),
            screen_y: Value::new(ctx, screen_y),
            game_screen_width_bwpx: Value::new(ctx, game_screen_width_bwpx),
            game_screen_height_bwpx: Value::new(ctx, game_screen_height_bwpx),
            zoom: Value::new(ctx, zoom),
            cursor_scale_factor: Value::new(ctx, cursor_scale_factor),
            game_screen_height_ratio: game_screen_height_ratio.map(move |x| Value::new(ctx, x)),
            replay_bfix: replay_bfix.map(move |x| Value::new(ctx, x)),
            replay_gcfg: replay_gcfg.map(move |x| Value::new(ctx, x)),
            anti_troll: anti_troll.map(move |x| Value::new(ctx, x)),
            first_dialog: first_dialog.map(move |x| Value::new(ctx, x)),
            graphic_layers: graphic_layers.map(move |x| Value::new(ctx, x)),
            snet_local_player_list: snet_local_player_list.map(move |x| Value::new(ctx, x)),
            netcode_v2,
            free_sprites,
            active_fow_sprites,
            free_fow_sprites,
            free_images,
            free_orders,
            uses_new_join_param_variant,
            status_screen_funcs,
            original_status_screen_update,
            net_format_turn_rate,
            init_obs_ui,
            draw_graphic_layers,
            decide_cursor_type,
            load_ddsgrp_cursor,
            update_game_screen_size: unsafe { mem::transmute(update_game_screen_size.0) },
            init_network_player_info: unsafe { mem::transmute(init_network_player_info.0) },
            step_network: unsafe { mem::transmute(step_network.0) },
            step_network_addr: step_network,
            select_map_entry: unsafe { mem::transmute(select_map_entry.0) },
            game_loop: unsafe { mem::transmute(game_loop.0) },
            init_map_from_path: unsafe { mem::transmute(init_map_from_path.0) },
            join_game: unsafe { mem::transmute(join_game.0) },
            init_sprites: unsafe { mem::transmute(init_sprites.0) },
            init_real_time_lighting: unsafe {
                init_real_time_lighting.map(|x| mem::transmute(x.0))
            },
            init_game_network: unsafe { mem::transmute(init_game_network.0) },
            storm_create_game: unsafe { mem::transmute(storm_create_game.0) },
            process_lobby_commands: unsafe { mem::transmute(process_lobby_commands.0) },
            randomize_player_colors: randomize_player_colors
                .map(|f| unsafe { mem::transmute::<usize, unsafe extern "C" fn()>(f.0 as usize) }),
            send_command: unsafe { mem::transmute(send_command.0) },
            choose_snp: unsafe { mem::transmute(choose_snp.0) },
            init_storm_networking: unsafe { mem::transmute(init_storm_networking.0) },
            snet_recv_packets: unsafe { mem::transmute(snet_recv_packets.0) },
            snet_send_packets: unsafe { mem::transmute(snet_send_packets.0) },
            ttf_malloc: unsafe { mem::transmute(ttf_malloc.0) },
            find_game_type_template: unsafe { mem::transmute(find_game_type_template.0) },
            process_events: unsafe { mem::transmute(process_events.0) },
            process_game_commands: unsafe { mem::transmute(process_game_commands.0) },
            move_screen: unsafe { mem::transmute(move_screen.0) },
            get_render_target: unsafe { mem::transmute(get_render_target.0) },
            load_consoles: Thiscall::foreign(load_consoles.0 as usize),
            init_consoles: Thiscall::foreign(init_consoles.0 as usize),
            move_unit: Thiscall::foreign(move_unit.0 as usize),
            get_ui_consoles: unsafe { mem::transmute(get_ui_consoles.0) },
            select_units: unsafe { mem::transmute(select_units.0) },
            render_screen: unsafe { mem::transmute(render_screen.0) },
            lookup_sound_id: unsafe { mem::transmute(lookup_sound_id.0) },
            play_sound: unsafe { mem::transmute(play_sound.0) },
            print_text: unsafe { mem::transmute(print_text_addr.0) },
            save_replay: unsafe { mem::transmute(save_replay.0) },
            load_snp_list,
            start_udp_server,
            sc_main,
            mainmenu_entry_hook,
            open_file,
            lobby_create_callback_offset,
            font_cache_render_ascii,
            ttf_render_sdf,
            step_replay_commands,
            order_harvest_gas,
            step_game,
            step_io,
            init_game_data,
            init_unit_data,
            game_command_lengths,
            prism_pixel_shaders,
            prism_renderer_vtable,
            console_vtables,
            replay_minimap_patch,
            cursor_dimension_patch,
            prepare_issue_order,
            create_game_multiplayer,
            spawn_dialog,
            step_game_logic,
            print_text_addr,
            net_player_count_addr,
            starcraft_tls_index: SendPtr(starcraft_tls_index),
            exe_build,
            sdf_cache,
            is_replay_seeking: AtomicBool::new(false),
            lobby_game_init_command_seen: AtomicBool::new(false),
            disable_hd: AtomicBool::new(false),
            shader_replaces: ShaderReplaces::new(),
            renderer_state: Mutex::new(RendererState {
                shader_inputs: Vec::with_capacity(0x30),
            }),
            open_replay_file_count: AtomicUsize::new(0),
            open_replay_files: Mutex::new(Vec::new()),
            is_carbot: AtomicBool::new(false),
            show_skins: AtomicBool::new(false),
            is_hd_mode: [AtomicBool::new(true), AtomicBool::new(false)],
            last_overlay_hd_value: AtomicBool::new(false),
            starting_fog: AtomicStartingFog::new(StartingFog::Transparent),
            saved_minimap_color_mode: AtomicU8::new(0),
            saved_minimap_terrain_hidden: AtomicBool::new(false),
            minimap_settings_restored: AtomicBool::new(false),
            team_color_config: Mutex::new(None),
            team_color_runtime: Mutex::new(None),
            use_legacy_cursor_sizing: AtomicBool::new(false),
            use_custom_cursor_size: AtomicBool::new(false),
            custom_cursor_size: Mutex::new(0.25),
            visualize_network_stalls: AtomicBool::new(false),
            is_processing_game_commands: AtomicBool::new(false),
            in_network_stall: AtomicBool::new(false),
            network_stall_start: RwLock::new(None),
            dropped_players: AtomicU32::new(0),
            settings_file_path: RwLock::new(String::new()),
            detection_status_copy: Mutex::new(Vec::new()),
            render_state: RecurseCheckedMutex::new(RenderState {
                render: draw_inject::RenderState::new(),
                overlay: draw_overlay::OverlayState::new(),
                debug_statbtn_dialog_offset: (0, 0),
            }),
            apm_state: RecurseCheckedMutex::new(ApmStats::new()),
            original_game_screen_height_ratio: AtomicU32::new(0),
            console_hidden_state: AtomicBool::new(false),
            game_started: AtomicBool::new(false),
            game_results_sent: AtomicBool::new(false),
            first_game_logic_frame_done: AtomicBool::new(false),
            sound_id_cache: Mutex::new(HashMap::new()),
            countdown_start: Mutex::new(None),
            print_text_hooks_disabled: AtomicI32::new(0),
            chat_manager: Mutex::new(chat::ChatManager::new()),
            event_processing_lock: DumbSpinLock::new(),
        })
    }

    pub unsafe fn patch_game(&'static self, image: *mut u8) {
        unsafe {
            use self::hooks::*;
            debug!("Patching SCR");
            let base = GetModuleHandleW(null()) as *mut _;
            let mut active_patcher = crate::PATCHER.lock();
            let mut exe = active_patcher.patch_memory(image as *mut _, base, 0);
            let base = base as usize;

            if let Some(sc_main) = self.sc_main {
                // This is a hook at early point during program startup, some initial
                // settings have been done already though.
                // Just used for checking if documents path is somehow unaccessible,
                // as this is right after BW does it's own checks for it.
                // mainmenu_entry_hook is further into this same function.
                //
                // Update: Now that we hook SHGetFolderPathW anyway maybe this hook
                // is pretty redundant, probably should be deleted once we're sure it
                // won't give any extra information.
                let address = sc_main.0 as usize - base;
                exe.hook_closure_address(
                    ScMain,
                    move |orig| {
                        check_documents_starcraft_path_accessibility();
                        orig();
                    },
                    address,
                );
            }

            let address = self.mainmenu_entry_hook.0 as usize - base;
            exe.call_hook_closure_address(
                GameInit,
                move |_| {
                    debug!("SCR game init hook");
                    crate::process_init_hook();
                },
                address,
            );

            let address = self.load_snp_list.0 as usize - base;
            exe.hook_closure_address(LoadSnpList, load_snp_list_hook, address);
            // The UDP server seems to be just Bonjour stuff, which we don't use.
            let address = self.start_udp_server.0 as usize - base;
            exe.hook_closure_address(StartUdpServer, |_, _| 1, address);

            let address = self.process_game_commands as usize - base;
            exe.hook_closure_address(
                ProcessGameCommands,
                move |data, len, are_recorded_replay_commands, orig| {
                    let command_user = self.command_user.resolve();
                    let unique_command_user = self.unique_command_user.resolve();
                    let is_replay = game_thread::is_replay();
                    let is_observer = command_user >= 128;
                    let slice = std::slice::from_raw_parts(data, len);
                    let slice = commands::filter_invalid_commands(
                        slice,
                        are_recorded_replay_commands != 0,
                        is_observer,
                        &self.game_command_lengths,
                    );
                    let mut sync_seen = false;
                    // New scope for mutex locks (Not necessarily needed but avoiding calling back to
                    // BW with mutexes locked is generally a good pattern to follow IMO)
                    {
                        let mut apm_state = self.apm_state.lock();
                        for command in commands::iter_commands(&slice, &self.game_command_lengths) {
                            if let Some(ref mut apm) = apm_state
                                && (!is_replay || are_recorded_replay_commands != 0) {
                                    apm.action(unique_command_user as u8, command);
                                }
                            match command {
                                [commands::id::REPLAY_SEEK, rest @ ..] if rest.len() == 4
                                    && are_recorded_replay_commands == 0 => {
                                        let frame = LittleEndian::read_u32(rest);
                                        let game = self.game();
                                        if (*game).frame_count > frame {
                                            self.is_replay_seeking.store(true, Ordering::Relaxed);
                                        }
                                    }
                                [commands::id::SYNC, ..] | [commands::id::NOP, ..]
                                    if are_recorded_replay_commands == 0 => {
                                        sync_seen = true;
                                    }
                                _ => (),
                            }
                        }
                    }

                    if !is_replay
                        && let Some(players) = self.check_player_drops() {
                            let frame = (*self.game()).frame_count;
                            let turn_seq = self.snet_next_turn_sequence_number().wrapping_sub(1);
                            info!(
                                "Dropped players {:?} at some point between last check and before \
                            handling commands for game player {} net {}. Game frame 0x{:x}, \
                            turn seq {}",
                                players,
                                command_user,
                                self.storm_command_user.resolve(),
                                frame,
                                turn_seq,
                            );
                        }
                    // There should be no way this is called recursively, but even still
                    // handle that case by keeping track of was_processing.
                    let was_processing = self.is_processing_game_commands.load(Ordering::Relaxed);
                    self.is_processing_game_commands
                        .store(true, Ordering::Relaxed);
                    orig(slice.as_ptr(), slice.len(), are_recorded_replay_commands);
                    self.is_processing_game_commands
                        .store(was_processing, Ordering::Relaxed);
                    if !is_replay {
                        if !sync_seen {
                            if is_observer {
                                // Observers don't send sync commands correctly.
                                // Send no-op command 0x05 which counts as a correct sync to
                                // prevent them from dropping.
                                //
                                // SC:R's setup has observers with storm id >= 128,
                                // for which process_game_commands is not called at all.
                                // Our setup uses "normal" storm ids for observers, as that
                                // makes allocating storm ids during launch simpler, but will
                                // require doing this (As well as filtering out almost all
                                // commands the observer sends)
                                orig(&5u8, 1, 0);
                            } else {
                                let storm_user = self.storm_command_user.resolve();
                                self.dropped_players.store(
                                    self.dropped_players.load(Ordering::Relaxed)
                                        | (1 << storm_user),
                                    Ordering::Relaxed,
                                );
                                info!(
                                    "Didn't see sync command for game player {command_user} net {storm_user}, {slice:02x?}, \
                                they will be dropped",
                                );
                            }
                        }
                        if let Some(players) = self.check_player_drops() {
                            let frame = (*self.game()).frame_count;
                            let turn_seq = self.snet_next_turn_sequence_number().wrapping_sub(1);
                            info!(
                                "Dropped players {:?} while handling commands for game player {} \
                            net {}, {:02x?}. Game frame 0x{:x}, turn seq {}",
                                players,
                                command_user,
                                self.storm_command_user.resolve(),
                                slice,
                                frame,
                                turn_seq,
                            );
                        }
                    }
                },
                address,
            );
            let address = self.step_io.0 as usize - base;
            exe.hook_closure_address(
                StepIo,
                move |scheduler, orig| {
                    orig(scheduler);
                    // BW actually only calls these in a case which would be equivalent with our SNP
                    // code calling receive_callback() (Which is nop in SCR for now), but these
                    // are cheap enough to always call. It may also be slightly better on
                    // unreliable networks as this sends packets every frame instead of every
                    // time a packets are received in a frame.
                    //
                    // Still need to check that the SNP is ready BW side.
                    //
                    // The native-lobby seam (and the sessionless solo path) still create a real
                    // Storm session, so the chosen SNP provider initializes and Storm's own lobby
                    // tick keeps running: this pump drives that tick's flush + receive, and the
                    // OUT/IN hooks intercept the sends/receives it produces to carry them over the
                    // rally-point2 relay instead of a real network. All actual transport rides the
                    // relay; the SNP provider itself only ever moves bytes into the inert stubs.
                    if SNP_INITIALIZED.load(Ordering::Relaxed) {
                        (self.snet_recv_packets)();
                        (self.snet_send_packets)();
                    }
                },
                address,
            );
            let address = self.process_lobby_commands as usize - base;
            exe.hook_closure_address(
                ProcessLobbyCommands,
                move |data, len, player, orig| {
                    let slice = std::slice::from_raw_parts(data, len);
                    // Anything other than a bare 1-byte 0x05 keep-alive is rare during lobby, so
                    // log it: the command byte, sender, and the lobby_state it arrives into (a
                    // 0x69 slot-setup resets lobby_state to 4, stomping a hand-written 8).
                    if slice.len() > 1 || slice.first() != Some(&5) {
                        debug!(
                            "Lobby command {:02x?} from player {} at lobby_state {}",
                            &slice[..slice.len().min(16)],
                            player,
                            self.lobby_state.resolve(),
                        );
                    }
                    if let Some(&byte) = slice.first()
                        && byte == 0x48
                        && player == 0
                    {
                        let seq = self.snet_next_turn_sequence_number();
                        // I think that the sequence number for next turn gets incremented
                        // before reaching this point, so subtract one to get current
                        // turn.
                        debug!(
                            "Lobby game init command seen at turn seq {}",
                            seq.wrapping_sub(1),
                        );
                        self.lobby_game_init_command_seen
                            .store(true, Ordering::Relaxed);
                    }
                    orig(data, len, player);
                },
                address,
            );
            let address = self.step_game.0 as usize - base;
            exe.hook_closure_address(
                StepGame,
                move |orig| {
                    if let Some(mut apm) = self.apm_state.lock() {
                        apm.new_frame();
                    }
                    orig();
                    game_thread::after_step_game();
                    self.update_team_colors_from_alliances();
                },
                address,
            );
            let address = self.step_network_addr.0 as usize - base;
            exe.hook_closure_address(
                StepNetwork,
                move |orig| {
                    let ret = orig();

                    let in_stall = !self.is_network_ready();
                    let was_in_stall = self.in_network_stall.swap(in_stall, Ordering::Relaxed);
                    if in_stall && !was_in_stall {
                        let now = Instant::now();
                        let mut stall_start = self.network_stall_start.write();
                        *stall_start = Some(now);
                    } else if !in_stall && was_in_stall {
                        let mut stall_start = self.network_stall_start.write();
                        let stall_duration = stall_start.unwrap_or_else(Instant::now).elapsed();
                        *stall_start = None;

                        send_game_msg_to_async(GameThreadMessage::NetworkStall(stall_duration));
                    }

                    ret
                },
                address,
            );

            // Netcode v2 turn hooks. Symbol resolution is required, so these always install; each
            // body falls through to `orig` (BW's original turn handling) when there is no turn state
            // (a replay), so installing them changes nothing for a replay.
            {
                let nc = &self.netcode_v2;
                let address = nc.send_turn_message.0 as usize - base;
                exe.hook_closure_address(
                    SendTurnMessage,
                    move |buffer, len, orig| match self.netcode_v2_send_turn(buffer, len) {
                        TurnSendOutcome::Submitted => 1,
                        TurnSendOutcome::Failed => {
                            error!("Netcode v2: local turn could not be submitted to the turn transport");
                            1
                        }
                        TurnSendOutcome::Native => orig(buffer, len),
                    },
                    address,
                );

                let address = nc.receive_storm_turns.0 as usize - base;
                exe.hook_closure_address(
                    ReceiveStormTurns,
                    move |a1, a2, a3, a4, a5, orig| match self.netcode_v2_receive_turns() {
                        TurnReceiveOutcome::Ready => 1,
                        TurnReceiveOutcome::Stall => 0,
                        TurnReceiveOutcome::Native => orig(a1, a2, a3, a4, a5),
                    },
                    address,
                );

                let address = nc.flush_local_turns.0 as usize - base;
                exe.hook_closure_address(
                    FlushLocalTurns,
                    move |a1, a2, orig| {
                        if self.netcode_v2_flush_pipe() {
                            0
                        } else {
                            orig(a1, a2)
                        }
                    },
                    address,
                );

                // Full replacement for Storm's network join handshake, active only when a lobby
                // session seed is staged (the native-lobby join seam). With no seed staged — always,
                // for now — it falls through to the original, so installing it is a no-op for every
                // existing path.
                let address = nc.storm_join_game.0 as usize - base;
                exe.hook_closure_address(
                    StormJoinGame,
                    move |a1, a2, a3, out, a5, a6, a7, a8, a9, orig| {
                        match netcode_v2::with_lobby_session_seed(|seed| {
                            self.v2_run_join_replacement(seed, out)
                        }) {
                            Some(ret) => ret,
                            None => orig(a1, a2, a3, out, a5, a6, a7, a8, a9),
                        }
                    },
                    address,
                );
                debug!("Netcode v2 turn hooks installed");
            }

            let address = self.net_format_turn_rate.0 as usize - base;
            exe.hook_closure_address(
                NetFormatTurnRate,
                move |result: *mut scr::NetFormatTurnRateResult, dtr_scan_in_progress, orig| {
                    // NOTE(tec27): We don't use the original value at all but it's a convenient way to
                    // get them to allocate a real string for us.
                    orig(result, dtr_scan_in_progress);

                    let turn_rate = match (*self.game_data()).turn_rate {
                        0 => 24, // This only happens with DTR, and is temporary anyway
                        val => val,
                    };
                    // Under a live turn state the PIPE hook owns the latency pipeline, so the native
                    // `2 + user_latency` builtin turns no longer describe the delay: `latency_turns()`
                    // reports the current pipe depth (floor 1, retunable mid-game by a relay's buffer
                    // directive). Read it fresh each format call so the display tracks the live depth;
                    // fall back to native state when there is no turn state (a replay).
                    let v2_turns = if self.game_started.load(Ordering::Acquire) {
                        netcode_v2::with_turn_state(|s| s.latency_turns())
                    } else {
                        None
                    };
                    let effective_latency = match v2_turns {
                        Some(latency_turns) => ((1000 * latency_turns + 500) / turn_rate) as f32,
                        None => {
                            let cur_user_latency = self.net_user_latency.resolve();
                            let user_delay = 2 /* proto_latency */ + cur_user_latency;
                            ((1000f32 * user_delay as f32 + 500f32) / turn_rate as f32).round()
                        }
                    };
                    let value = format!("Lat: {effective_latency:.0}ms");
                    (*result).text.replace_all(value.as_str());
                    result
                },
                address,
            );

            let address = self.update_game_screen_size as usize - base;
            exe.hook_closure_address(
                UpdateGameScreenSize,
                move |zoom, orig| {
                    // When using f5 to switch between sd-hd, 4:3 - 16:9 the game moves screen x
                    // to `x - 0.5 * (new_width - old_width)`, to keep the screen centered
                    // on what it used to be.
                    // However, if the screen happens to be near right edge of map, its x coordinate
                    // is clamped to (map_width_pixels - new_width) before centering move is done,
                    // causing the aspect-ratio correcting screen move be wrong.
                    //
                    // So we just implement the same algorithm but do aspect ratio fix first and
                    // right edge limiting second.
                    //
                    // Worth noting that update_game_screen_size is called for other cases than
                    // sd-hd switch, but I *think* that if we limit our changes to trigger only
                    // when game_screen_width_bwpx has changed, it won't break the other use cases.
                    // (Not sure what the other use cases are)
                    //
                    // If the above doesn't work, reading a global value that selects the screen
                    // size mode can be used to properly have these changes trigger only on
                    // sd-hd switch. But there isn't analysis for it right now, so hoping that it
                    // isn't needed.
                    let old_width = self.game_screen_width_bwpx.resolve();
                    let old_x = self.screen_x.resolve();
                    orig(zoom);
                    let new_width = self.game_screen_width_bwpx.resolve();
                    if old_width != new_width {
                        let new_x = (|| {
                            let diff = (new_width as i32).checked_sub(old_width as i32)?;
                            (old_x as i32).checked_sub(diff / 2)
                        })();
                        if let Some(new_x) = new_x {
                            let max_x =
                                self.map_width_pixels.resolve().saturating_sub(new_width) as i32;
                            let new_x = new_x.clamp(0, max_x) as u32;
                            let y = self.screen_y.resolve();
                            (self.move_screen)(new_x, y);
                        }
                    }
                },
                address,
            );

            let address = self.init_game_data.0 as usize - base;
            exe.hook_closure_address(
                InitGameData,
                move |orig| {
                    let ok = log_time("init_game_data", || orig());
                    if ok == 0 {
                        error!("init_game_data failed");
                        return 0;
                    }
                    if let Some(anti_troll) = self.anti_troll {
                        (*anti_troll.resolve()).active = 0;
                    }
                    game_thread::after_init_game_data();
                    1
                },
                address,
            );
            let address = self.init_obs_ui.0 as usize - base;
            exe.hook_closure_address(
                InitObsUi,
                move |orig| {
                    // Make bw think that it doesn't need to create obs ui,
                    // and load default ingame consoles instead
                    // ('is_dummy_ui' function in obs ui vtable would have to be patched
                    // if consoles aren't loaded)
                    let is_replay = self.is_replay.resolve();
                    let local_id = self.local_unique_player_id.resolve();
                    if is_replay != 0 || local_id >= 0x80 {
                        self.is_replay.write(0);
                        self.local_unique_player_id.write(0);
                        let ui_consoles = (self.get_ui_consoles)();
                        let game = self.game();
                        let race_char = match (*game).player_race {
                            0 => b'z',
                            1 => b't',
                            _ => b'p',
                        };
                        self.load_consoles.call1(ui_consoles);
                        self.init_consoles.call2(ui_consoles, race_char as u32);
                        orig();
                        self.is_replay.write(is_replay);
                        self.local_unique_player_id.write(local_id);
                    } else {
                        orig();
                    }
                    if let Some(ratio) = self.game_screen_height_ratio {
                        self.original_game_screen_height_ratio
                            .store(ratio.resolve().to_bits(), Ordering::Relaxed);
                    }
                },
                address,
            );
            let address = self.init_unit_data.0 as usize - base;
            exe.hook_closure_address(
                InitUnitData,
                move |orig| {
                    game_thread::before_init_unit_data(self);
                    log_time("init_unit_data", || orig());
                },
                address,
            );
            let address = self.step_replay_commands.0 as usize - base;
            exe.hook_closure_address(
                StepReplayCommands,
                |orig| {
                    game_thread::step_replay_commands(orig);
                },
                address,
            );
            let address = self.order_harvest_gas.0 as usize - base;
            exe.hook_closure_address(
                OrderFn,
                |unit, orig| {
                    game_thread::order_harvest_gas(self, unit, orig);
                },
                address,
            );

            if let Some(ref patch) = self.replay_minimap_patch {
                let address = patch.address.0 as usize - base;
                exe.replace(address, &patch.data);
            }

            if !self.use_legacy_cursor_sizing.load(Ordering::Acquire)
                && let Some(ref patch) = self.cursor_dimension_patch
            {
                debug!("Applying cursor dimension patch");
                let address = patch.address.0 as usize - base;
                exe.replace(address, &patch.data);
            } else {
                debug!("Legacy cursor sizing enabled");
            }

            let address = self.open_file.0 as usize - base;
            exe.hook_closure_address(
                OpenFile,
                move |a, b, c, orig| file_hook::open_file_hook(self, a, b, c, orig),
                address,
            );

            #[cfg(target_arch = "x86")]
            let prepare_issue_order_hook =
                move |unit, order, xy, target, fow, clear_queue, _orig| {
                    let unit = match Unit::from_ptr(unit) {
                        Some(s) => s,
                        None => return,
                    };
                    let order = bw_dat::OrderId(order as u8);
                    let x = xy as i16;
                    let y = (xy >> 16) as i16;
                    let target = Unit::from_ptr(target);
                    let fow = fow as u16;
                    let clear_queue = clear_queue != 0;

                    game::prepare_issue_order(self, unit, order, x, y, target, fow, clear_queue);
                };

            #[cfg(target_arch = "x86_64")]
            let prepare_issue_order_hook =
                move |unit, order, target: *mut bw::PointAndUnit, fow, clear_queue, _orig| {
                    let unit = match Unit::from_ptr(unit) {
                        Some(s) => s,
                        None => return,
                    };
                    let order = bw_dat::OrderId(order as u8);
                    let x = (*target).pos.x;
                    let y = (*target).pos.y;
                    let target = Unit::from_ptr((*target).unit);
                    let fow = fow as u16;
                    let clear_queue = clear_queue != 0;

                    game::prepare_issue_order(self, unit, order, x, y, target, fow, clear_queue);
                };

            let address = self.prepare_issue_order.0 as usize - base;
            exe.hook_closure_address(PrepareIssueOrder, prepare_issue_order_hook, address);

            let address = self.create_game_multiplayer.0 as usize - base;
            exe.hook_closure_address(
                CreateGameMultiplayer,
                move |info, name, password, map_path, a5, a6, a7, a8, orig| {
                    // Logging these params just to have some more context if ever needed.
                    // (This is a 16-byte struct passed by value)
                    let unk0 = a5;
                    let turn_rate = a6;
                    let is_bnet_matchmaking = a7 & 0xff;
                    let unk9 = (a7 >> 8) & 0xff;
                    let old_game_limits = (a7 >> 16) & 0xff;
                    let eud = (a7 >> 24) & 0xff;
                    let dynamic_turn_rate = a8;
                    info!(
                        "Called create_game_multiplayer, game params {unk0} {turn_rate} {is_bnet_matchmaking} {unk9} {old_game_limits} {eud} {dynamic_turn_rate}",
                    );
                    // This value is originally set to how many human player starting locations
                    // there are, but set it to match what we set for join side in
                    // game_state::join_lobby. Makes sure everybody can join if there are observers.
                    (*info).max_player_count = game_thread::setup_info().unwrap().slots.len() as u8;
                    orig(info, name, password, map_path, a5, a6, a7, a8)
                },
                address,
            );

            let address = self.spawn_dialog.0 as usize - base;
            exe.hook_closure_address(
                SpawnDialog,
                |a, b, c, o| dialog_hook::spawn_dialog_hook(a, b, c, o),
                address,
            );

            let address = self.step_game_logic.0 as usize - base;
            exe.hook_closure_address(
                StepGameLogic,
                move |a, o| step_game_logic_hook(self, a, o),
                address,
            );

            let address = self.decide_cursor_type.0 as usize - base;
            exe.hook_closure_address(
                DecideCursorType,
                move |orig| {
                    if let Some(render_state) = self.render_state.lock()
                        && let Some(val) = render_state.overlay.decide_cursor_type()
                    {
                        return val as u32;
                    }
                    orig()
                },
                address,
            );

            let address = self.load_ddsgrp_cursor.0 as usize - base;
            let check_custom_cursor_size = move || {
                if self.use_custom_cursor_size.load(Ordering::Acquire) {
                    let custom_size = *self.custom_cursor_size.lock();
                    self.cursor_scale_factor.write(custom_size);
                }
            };
            #[cfg(target_arch = "x86")]
            exe.hook_closure_address(
                LoadDdsgrpCursor,
                move |filepath, b, hotspot_x, hotspot_y, e, orig| {
                    check_custom_cursor_size();
                    orig(filepath, b, hotspot_x, hotspot_y, e)
                },
                address,
            );
            #[cfg(target_arch = "x86_64")]
            exe.hook_closure_address(
                LoadDdsgrpCursor,
                move |filepath, b, hotspot_xy, e, orig| {
                    check_custom_cursor_size();
                    orig(filepath, b, hotspot_xy, e)
                },
                address,
            );

            let address = self.print_text_addr.0 as usize - base;
            exe.hook_closure_address(
                PrintText,
                move |text, player, unused, orig| {
                    if text.is_null() {
                        return;
                    }
                    if self.print_text_hooks_disabled.load(Ordering::Acquire) <= 0
                        && let Ok(text) = CStr::from_ptr(text).to_str()
                    {
                        let handled = self.chat_manager.lock().handle_message(text, player);
                        if handled {
                            return;
                        }
                    }

                    orig(text, player, unused);
                },
                address,
            );

            let address = self.net_player_count_addr.0 as usize - base;
            exe.hook_closure_address(
                NetPlayerCount,
                move |orig| {
                    if netcode_v2::with_turn_state(|_| ()).is_some() {
                        // The native count reads the Storm session player list, which for a netcode-v2
                        // game holds only the local player (no Storm peers) — so BW would classify the
                        // game as single-player and draw the single-player minimap UI. Report the true
                        // count of registered net players so the multiplayer UI (diplomacy +
                        // communication buttons) is created.
                        let players = self.storm_players.resolve();
                        (0..bw::MAX_STORM_PLAYERS)
                            .filter(|&i| (*players.add(i)).state == 1)
                            .count() as u32
                    } else {
                        orig()
                    }
                },
                address,
            );

            if let Some(funcs) = self.status_screen_funcs {
                let funcs = std::slice::from_raw_parts_mut(funcs.0 as *mut bw::UnitStatusFunc, 228);
                for func in funcs {
                    unsafe extern "C" fn always_true() -> u32 {
                        1
                    }
                    unsafe extern "C" fn update_status(status_screen: *mut bw::Dialog) {
                        unsafe {
                            let bw = bw::get_bw();

                            let selected = match bw.client_selection()[0] {
                                Some(s) => s,
                                None => return,
                            };
                            let local_id = bw.local_player_id.resolve();
                            if local_id >= 0x80 {
                                // Show full unit info for observers
                                bw.local_player_id.write(selected.player() as u32);
                            }
                            bw.call_original_status_screen_fn(selected.id(), status_screen);
                            if local_id >= 0x80 {
                                bw.local_player_id.write(local_id);
                            }
                            let status_screen = bw_dat::dialog::Dialog::new(status_screen);
                            game_thread::after_status_screen_update(bw, status_screen, selected);
                        }
                    }
                    // Updating status every frame by always returning 1 from has_changed
                    // should be very cheap relative to other SC:R stuff, and allows us
                    // to intercept the dialog layout with less work.
                    func.has_changed = always_true;
                    func.update_status = update_status;
                }
            }

            self.rendering_patches(&mut exe, base);

            for &vtable in &self.console_vtables {
                let vtable = vtable.0 as *const scr::V_UiConsole;
                let relative = (*vtable).hit_test.cast_usize() - base;
                // Make console hittest return false when console is hidden.
                //
                // Unfortunately BW doesn't update hittest result until mouse moves,
                // so there's small bug with clicks right after console is shown/hidden.
                exe.hook_closure_address(
                    Console_HitTest,
                    move |console, x, y, orig| match self.console_hidden() {
                        true => 0,
                        false => orig(console, x, y),
                    },
                    relative,
                );
            }

            sdf_cache::apply_sdf_cache_hooks(self, &mut exe, base);

            let create_file_hook_closure =
                move |a, b, c, d, e, f, g, o| create_file_hook(self, a, b, c, d, e, f, g, o);
            let get_file_attributes_closure = move |a, o| get_file_attributes_hook(self, a, o);

            let close_handle_hook = move |handle, orig: unsafe extern "C" fn(_) -> _| {
                self.check_replay_file_finish(handle);
                orig(handle)
            };
            let init_time = Instant::now();
            let init_tick_count = winapi::um::sysinfoapi::GetTickCount();
            let get_tick_count_hook = move |_orig: unsafe extern "C" fn() -> u32| {
                // BW uses GetTickCount for a lot of things that should really have better than
                // 16ms resolution, so we hook this to give them a better timer. In practice this
                // improves the reliability of turn timing, which hopefully improves the reliability of
                // the netcode, and maybe other things

                // We add the initial tick count here because some other Windows APIs
                // (notably GetMessageTime) return values that are expected to be in the same range.
                // Without doing this, SC:R will discard some otherwise valid events and make it so
                // things like keypresses take multiple presses to achieve one action.
                (init_time.elapsed().as_millis() as u32).wrapping_add(init_tick_count)
            };
            drop(exe);
            hook_winapi_exports!(&mut active_patcher, "kernel32",
                "CreateEventW", CreateEventW, create_event_hook;
                "CreateFileW", CreateFileW, create_file_hook_closure;
                "CopyFileW", CopyFileW, copy_file_hook;
                "CloseHandle", CloseHandle, close_handle_hook;
                "GetFileAttributesW", GetFileAttributesW, get_file_attributes_closure;
                "GetTickCount", GetTickCount, get_tick_count_hook;
                "GetSystemTimePreciseAsFileTime", GetSystemTimePreciseAsFileTime, get_system_time_precise_as_file_time_hook;
            );
            hook_winapi_exports!(&mut active_patcher, "shell32",
                "SHGetFolderPathW", SHGetFolderPathW, sh_get_folder_path_w_hook;
            );

            // SCR wants to update gamepad state every frame, but in the end it
            // won't do any with it anyway. The query isn't completely free,
            // so dummy it out to let game spend time on better things.
            //
            // Note: This patch gets only applied if the DLL is already loaded,
            // so that we don't end up loading the DLL for no reason if a future
            // patch stops using this function.
            if windows::module_handle("xinput9_1_0").is_some() {
                let xinput_get_state_hook =
                    |_, _, _| winapi::shared::winerror::ERROR_DEVICE_NOT_CONNECTED;
                hook_winapi_exports!(&mut active_patcher, "xinput9_1_0",
                    "XInputGetState", XInputGetState, xinput_get_state_hook;
                );
            }
            crate::forge::init_hooks_scr(&mut active_patcher);
            debug!("Patched.");
        }
    }

    pub unsafe fn post_async_init(&'static self) {
        unsafe {
            let base = GetModuleHandleW(null()) as usize;
            let sdf_cache = self.sdf_cache.clone();
            let async_handle = crate::async_handle();
            let mut sdf_cache = sdf_cache.lock_owned();
            async_handle.spawn(async move {
                let exe_hash = pe_image::hash_pe_header(base as *const u8);
                *sdf_cache = Some(SdfCache::init(exe_hash).await);
            });
        }
    }

    unsafe fn rendering_patches(&'static self, exe: &mut whack::ModulePatcher<'_>, base: usize) {
        unsafe {
            use self::hooks::*;
            let renderer_vtable = self.prism_renderer_vtable.0 as *const scr::V_Renderer;

            let draw = (*renderer_vtable).draw;
            let create_shader = (*renderer_vtable).create_shader;

            let address = self.draw_graphic_layers.0 as usize - base;
            // draw_graphic_layers is the main BW draw command queuing function.
            // Usually called once per render to queue DrawCommands for all sprites of the game
            // as well as UI, but when the user is in middle of switching between
            // SD and HD, it will be called a second time with `second_draw == 1`
            // so that the game will be able to fade between the two graphic modes.
            exe.hook_closure_address(
                DrawGraphicLayers,
                move |extra_funcs, extra_func_len, second_draw, orig| {
                    // Detect a Shift+Tab color-mode cycle before queuing draws, so this frame renders
                    // with the corrected mode/colors. A no-op unless custom team colors are active.
                    // Only on the primary pass; the SD/HD-fade second pass sees the same global.
                    if second_draw == 0 {
                        self.poll_team_color_mode();
                    }
                    // It is expected that extra_funcs array has one (just one) function that
                    // draws the UI console. If console is hidden just call orig with 0 extra funcs
                    // and it should make the static parts of console hidden.
                    // (Interactable parts of the console are dialogs which need to be hidden
                    // separately.)
                    let graphic_layers =
                        self.graphic_layers.and_then(|x| NonNull::new(x.resolve()));
                    if self.console_hidden() {
                        if let Some(layers) = graphic_layers {
                            // Don't draw tooltip layer if it was active.
                            // It can stay active when hiding console depending on where
                            // the mouse was on when console was hidden, even if the control
                            // becomes uninteractable.
                            // (Pretty sure that none of the menus use tooltips)
                            (*layers.as_ptr().add(1)).draw = 0;
                        }
                        orig(extra_funcs, 0, second_draw);
                    } else {
                        orig(extra_funcs, extra_func_len, second_draw);
                    }
                    let renderer = self.renderer.resolve();
                    let commands = self.draw_commands.resolve();
                    let vertex_buffer = self.vertex_buffer.resolve();
                    let players = self.players();
                    let game = self.game();
                    if game.is_null() {
                        // Early screen draw
                        return;
                    }
                    let game = bw_dat::Game::from_ptr(game);
                    let has_init_bw = game_thread::HAS_INIT_BW.load(Ordering::Acquire);
                    let game_started = self.game_started.load(Ordering::Acquire);
                    let is_replay_or_obs = self.is_replay_or_obs();
                    let is_replay = self.is_replay.resolve() != 0;
                    let is_team_game = game_thread::is_team_game();
                    let main_palette = self.main_palette.resolve();
                    let rgb_colors = self.rgb_colors.resolve();
                    let use_rgb_colors = self.use_rgb_colors.resolve();
                    let statres_icons = self.statres_icons.resolve();
                    let cmdicons = self.cmdicons.resolve();
                    let replay_visions = self.replay_visions.resolve();
                    let active_units = self.active_units();
                    let first_player_unit = self.first_player_unit.resolve();
                    let first_dialog = self.resolve_first_dialog();
                    // Assuming that the last added draw command (Added during orig() call)
                    // will have the is_hd value that is currently being used.
                    // Could also probably examine the render target from get_render_target,
                    // as that changes depending on if BW is currently rendering HD or not.
                    let is_hd = if second_draw == 0 {
                        (*commands)
                            .draw_command_count
                            .checked_sub(1)
                            .and_then(|idx| (*commands).commands.get(idx as usize))
                            .map(|x| x.is_hd != 0)
                            .unwrap_or_else(|| {
                                // Fallback: Use what previous frame had during render
                                self.is_hd_mode[0].load(Ordering::Relaxed)
                            })
                    } else {
                        // Always use previous frame's info for second draw, as we'd have to track
                        // if the previous draw command was added by us (BW adding nothing) or not
                        // otherwise.
                        self.is_hd_mode[1].load(Ordering::Relaxed)
                    };
                    if second_draw == 0 {
                        self.last_overlay_hd_value.store(is_hd, Ordering::Relaxed);
                    }
                    // SC:R only enables carbot if both of these flags are set
                    let is_carbot = self.is_carbot.load(Ordering::Relaxed)
                        && self.show_skins.load(Ordering::Relaxed);
                    // Render target 1 is for UI layers (0xb to 0x1d inclusive)
                    let render_target =
                        draw_inject::RenderTarget::new((self.get_render_target)(1), 1);
                    if let Some(mut render_state) = self.render_state.lock() {
                        let countdown_start = *self.countdown_start.lock();
                        let apm_guard = self.apm_state.lock();
                        let apm = apm_guard.as_deref();
                        let size = ((*render_target.bw).width, (*render_target.bw).height);
                        // A snapshot of who has lost connection, for the survivor overlay. `None`
                        // (a replay, or a re-entrant lock) renders as an all-healthy status.
                        let disconnect_status =
                            netcode_v2::with_turn_state(|s| s.disconnect_status())
                                .unwrap_or_else(netcode_v2::DisconnectStatus::healthy);
                        // A snapshot of the network-stats overlay, or `None` when it is toggled off
                        // (or there is no session). Safe to reach the turn state here: the draw path
                        // holds no turn-state lock across `step`.
                        let net_stats =
                            netcode_v2::with_turn_state(|s| s.net_stats_status(Instant::now()))
                                .flatten();
                        // If we're switching between SD/HD, egui flexboxes will break due
                        // to render target size constantly changing, so we allow the overlay
                        // to request a second pass to provide nicer look.
                        // This means we do 4 passes per frame while changing graphics quality,
                        // but the performance should not be that bad..
                        for _ in 0..2 {
                            let overlay_out = render_state.overlay.step(
                                &draw_overlay::BwVars {
                                    is_replay_or_obs,
                                    is_replay,
                                    is_team_game,
                                    game,
                                    players,
                                    main_palette,
                                    rgb_colors,
                                    use_rgb_colors,
                                    replay_visions,
                                    active_units,
                                    first_player_unit,
                                    first_dialog,
                                    graphic_layers,
                                    is_hd,
                                    has_init_bw,
                                    countdown_start,
                                    game_started,
                                },
                                apm,
                                size,
                                game_thread::setup_info(),
                                &disconnect_status,
                                net_stats.as_ref(),
                            );
                            if cfg!(debug_assertions) {
                                self.handle_debug_ui_actions(&overlay_out, &mut render_state);
                            }
                            if replay_visions != overlay_out.replay_visions {
                                self.replay_visions.write(overlay_out.replay_visions);
                                self.local_visions.write(overlay_out.replay_visions);
                                // Has to be called here or otherwise there's minimap flicker
                                // with the resources disappearing until the game logic moves
                                // forward a step.
                                game_thread::add_fow_sprites_for_replay_vision_change(self);
                            }
                            if let Some(unit) = overlay_out.select_unit {
                                let units = [*unit];
                                (self.select_units)(units.len(), units.as_ptr(), 1, 1);
                                self.center_screen(&unit.position());
                            }
                            let console_shown = !self.console_hidden();
                            if overlay_out.show_console != console_shown {
                                if overlay_out.show_console {
                                    self.show_console(first_dialog);
                                } else {
                                    self.hide_console(first_dialog);
                                }
                            }
                            let bw = &draw_inject::BwVars {
                                renderer,
                                commands,
                                vertex_buf: vertex_buffer,
                                is_hd,
                                is_carbot,
                                statres_icons,
                                cmdicons,
                            };
                            if overlay_out.run_second_draw {
                                draw_inject::update_textures_without_adding_overlays(
                                    &mut render_state.render,
                                    bw,
                                    overlay_out,
                                );
                            } else {
                                draw_inject::add_overlays(
                                    &mut render_state.render,
                                    bw,
                                    overlay_out,
                                    &render_target,
                                );
                                break;
                            }
                        }
                    }
                },
                address,
            );
            // Minimap-only team colors: while the feature is active in that mode, swap the engine's
            // assignment into `rgb_colors` for the span of each minimap dot draw and restore the
            // previous contents afterward, so the dots recolor without touching unit colors. The
            // dispatcher draws the local player and lone sprites inline and calls the two per-player
            // helpers for everyone else, so the guards nest (see `begin_minimap_team_colors`). Full
            // cdecl overrides; each falls through to `orig` untouched in any other mode. Installed
            // only when all three sites resolved; otherwise that mode stays on BW's diplomacy dots.
            if let Some(minimap_hooks) = self.minimap_draw_hooks.as_ref() {
                let address = minimap_hooks.draw_minimap_units.0 as usize - base;
                exe.hook_closure_address(
                    DrawMinimapUnits,
                    move |orig| {
                        // A Shift+Tab press earlier in this frame has already moved the real
                        // color-mode global, but the layer-draw poll runs after the minimap is
                        // drawn — detect the cycle here first so this frame's dots don't render
                        // one mode behind (a one-frame wrong-palette flash). Must happen before
                        // the swap guard exists: applying a mode change writes `rgb_colors`, and
                        // a guard restore after that would clobber it.
                        self.poll_team_color_mode();
                        let _swap = self.begin_minimap_team_colors();
                        orig();
                    },
                    address,
                );
                let address = minimap_hooks.draw_minimap_player_units.0 as usize - base;
                exe.hook_closure_address(
                    DrawMinimapPlayerUnits,
                    move |player, orig| {
                        let _swap = self.begin_minimap_team_colors();
                        orig(player);
                    },
                    address,
                );
                let address = minimap_hooks.draw_minimap_main_player_units.0 as usize - base;
                exe.hook_closure_address(
                    DrawMinimapMainPlayerUnits,
                    move |player, orig| {
                        let _swap = self.begin_minimap_team_colors();
                        orig(player);
                    },
                    address,
                );
            }
            // Render hook
            let relative = draw.cast_usize() - base;
            exe.hook_closure_address(
                Renderer_Render,
                move |renderer, commands, width, height, orig| {
                    let draw_command_count = (*commands).draw_command_count as usize;

                    // Update is_hd value based on what BW output to final render target draw
                    // (Can have two values when doing the transfer between SD/HD)
                    let mut n = 0;
                    for i in 0..draw_command_count {
                        let cmd = &raw mut (*commands).commands[i];
                        if (*cmd).render_target_id == 0 {
                            self.is_hd_mode[n].store((*cmd).is_hd != 0, Ordering::Relaxed);
                            n += 1;
                            if n == 2 {
                                break;
                            }
                        }
                    }
                    if n == 1 {
                        // n == 1 should mean that no SD/HD transfers were active this frame.

                        // Set the other just opposite of what the first one was if it isn't
                        // currently used. Will be a good guess if second draw gets used next
                        // frame.
                        let main_hd_mode = self.is_hd_mode[0].load(Ordering::Relaxed);
                        self.is_hd_mode[1].store(!main_hd_mode, Ordering::Relaxed);
                        // On the other hand, if SD/HD switch just finished, this is first
                        // frame where second draw doesn't get used and main_hd_mode is
                        // opposite of what it was previous frame.
                        // This means that overlay code may have added wrong draw commands,
                        // which have to be fixed now to prevent a single black frame flickering.
                        if self.last_overlay_hd_value.load(Ordering::Relaxed) != main_hd_mode {
                            for i in 0..draw_command_count {
                                let cmd = &raw mut (*commands).commands[i];
                                (*cmd).is_hd = main_hd_mode as u32;
                            }
                        }
                    }
                    if self.shader_replaces.has_changed() {
                        // Hot reload shaders.
                        // Unfortunately repatching the .exe to replace shader sets in BW
                        // memory is not currently possible.
                        // Will have to write over the previously allocated scr::PrismShader slice
                        // instead.
                        for (id, new_set) in self.shader_replaces.iter_shaders() {
                            if let Some(shader_set) = self.prism_pixel_shaders.get(id as usize) {
                                let shader_set = shader_set.0 as usize as *mut scr::PrismShaderSet;
                                assert_eq!((*shader_set).count as usize, new_set.len());
                                let out = std::slice::from_raw_parts_mut(
                                    (*shader_set).shaders,
                                    (*shader_set).count as usize,
                                );
                                if out[0].data != new_set[0].data {
                                    out.copy_from_slice(new_set);
                                    let args = {
                                        let renderer_state = self.renderer_state.lock();
                                        renderer_state.shader_inputs.get(id as usize).copied()
                                    };
                                    if let Some(args) = args {
                                        create_shader.call6(
                                            renderer,
                                            args.shader,
                                            null(),
                                            args.vertex_path,
                                            args.pixel_path,
                                            null_mut(),
                                        );
                                    }
                                }
                            }
                        }
                    }

                    let show_network_stalled =
                        if self.visualize_network_stalls.load(Ordering::Relaxed)
                            && !self.is_network_ready()
                        {
                            1.0
                        } else {
                            0.0
                        };

                    // Leave unexplored area in UMS maps black
                    let use_new_mask = if crate::game_thread::is_ums()
                        || self.starting_fog.load(Ordering::Relaxed) != StartingFog::Transparent
                    {
                        0.0
                    } else {
                        1.0
                    };
                    for i in 0..draw_command_count {
                        let cmd = &raw mut (*commands).commands[i];
                        if (*cmd).shader_id == SHADER_ID_MASK {
                            (*cmd).shader_constants[0] = use_new_mask;
                            (*cmd).shader_constants[1] = show_network_stalled;
                        }
                    }
                    let ret = orig(renderer, commands, width, height);
                    if let Some(mut render_state) = self.render_state.lock() {
                        draw_inject::free_textures(&mut render_state.render);
                    }
                    ret
                },
                relative,
            );

            // CreateShader hook
            let relative = create_shader.cast_usize() - base;
            exe.hook_closure_address(
                Renderer_CreateShader,
                move |renderer, shader, text, vertex, pixel, arg5, orig| {
                    {
                        let mut renderer_state = self.renderer_state.lock();
                        renderer_state.set_shader_inputs(shader, vertex, pixel);
                    }
                    orig(renderer, shader, text, vertex, pixel, arg5)
                },
                relative,
            );

            for (id, shader_set) in self.shader_replaces.iter_shaders() {
                if let Some(&address) = self.prism_pixel_shaders.get(id as usize) {
                    let patch = scr::PrismShaderSet {
                        count: shader_set.len() as u32,
                        shaders: shader_set.as_ptr() as *mut _,
                    };
                    let relative = address.0 as usize - base;
                    exe.replace_val(relative, patch);
                }
            }
        }
    }

    /// OUT hook body (`send_turn_message`): in-game, hand the fully-assembled local turn to the turn
    /// state, having stripped the native latency/turn-rate control commands so they can't rewrite the
    /// pinned globals mid-game. Before the game starts, the lobby stays on native Storm networking
    /// unless the turn state's lobby seam is latched on (see [`TurnState::enable_lobby_seam`] — the
    /// native-lobby setup path, a later slice); when it is, the raw buffer goes to
    /// [`TurnState::submit_local_lobby_turn`] with no [`commands::strip_control_commands`] — the
    /// lobby command set is different from the in-game one and must relay byte-identical. Returns
    /// [`TurnSendOutcome::Native`] whenever there is no live session, or (pre-game) the seam isn't
    /// enabled.
    unsafe fn netcode_v2_send_turn(&self, buffer: *const u8, len: usize) -> TurnSendOutcome {
        unsafe {
            if !self.game_started.load(Ordering::Acquire) {
                let commands = std::slice::from_raw_parts(buffer, len);
                let outcome = netcode_v2::with_turn_state(|s| {
                    if !s.lobby_seam_enabled() {
                        return None;
                    }
                    Some(s.submit_local_lobby_turn(commands))
                })
                .flatten();
                return match outcome {
                    None => TurnSendOutcome::Native,
                    Some(true) => TurnSendOutcome::Submitted,
                    Some(false) => TurnSendOutcome::Failed,
                };
            }
            let nc = &self.netcode_v2;
            let frame = nc.game_frame_count.resolve();
            let commands = std::slice::from_raw_parts(buffer, len);
            let filtered = commands::strip_control_commands(commands, &self.game_command_lengths);
            match netcode_v2::with_turn_state(|s| s.submit_local_turn(&filtered, Some(frame))) {
                None => TurnSendOutcome::Native,
                Some(true) => TurnSendOutcome::Submitted,
                Some(false) => TurnSendOutcome::Failed,
            }
        }
    }

    /// IN hook body (full replacement of `receive_storm_turns`): drain the turn state and, when every
    /// required slot is ready, fill `player_turns[]` / `player_turns_size[]` / `net_player_flags[]`
    /// and run the synced leave pass. Never calls the original.
    ///
    /// Before the game starts, the lobby stays fully native (native join is retained for now) unless
    /// the turn state's lobby seam is latched on (see [`TurnState::enable_lobby_seam`] — the
    /// native-lobby setup path, a later slice). When it is, this fills the same arrays from the
    /// lobby-phase turn assembly instead — [`TurnState::lobby_receive_turns`], the lobby analogue of
    /// the in-game turn assembly below, paced by the local echo rather than a readiness set. That
    /// branch is drain→gate→dispatch only: it runs no leave/directive machinery, since there are no
    /// frames or leaves during lobby in this slice.
    ///
    /// With the seam still off, the turn state's pipe is empty at the lobby→game transition — the
    /// first in-game receive would stall forever (`network_ready = 0` → `step_network` skips the
    /// PIPE flush → deadlock; native avoids this because the lobby's unconditional flush pre-seeds
    /// the pipe). [`seed_netcode_v2_pipe`](Self::seed_netcode_v2_pipe) closes that gap by running
    /// the PIPE fill once at the transition.
    unsafe fn netcode_v2_receive_turns(&self) -> TurnReceiveOutcome {
        unsafe {
            if !self.game_started.load(Ordering::Acquire) {
                let nc = &self.netcode_v2;
                // Chat stays live for the driver's whole session, unlike lobby commands, so it can
                // already be arriving before the game starts. Nothing renders it yet — drain and
                // discard so the channel never backs up and wedges the driver (mirrors `lobby_in`'s
                // own discard-drain once the game HAS started; see `drain_chat_inbound`).
                netcode_v2::with_turn_state(|s| {
                    s.drain_chat_inbound(false);
                    // Drain the connectivity stream pre-start too so it can't back up and wedge the
                    // driver; a pre-start peer frame records nothing (there is no in-game overlay
                    // yet to show it on), though an own-slot frame still updates the self-link flag
                    // — harmlessly, since that overlay is gated on the game having started too.
                    s.pump_connectivity(false, Instant::now());
                });
                let ready = netcode_v2::with_turn_state(|s| {
                    if !s.lobby_seam_enabled() {
                        return None;
                    }
                    if !s.lobby_receive_turns() {
                        return Some(false);
                    }
                    Self::fill_turn_dispatch(
                        nc.player_turns.resolve(),
                        nc.player_turns_size.resolve(),
                        self.storm_player_flags.resolve(),
                        s.lobby_dispatch_buffers(),
                    );
                    Some(true)
                })
                .flatten();
                return match ready {
                    None => TurnReceiveOutcome::Native,
                    Some(false) => TurnReceiveOutcome::Stall,
                    Some(true) => TurnReceiveOutcome::Ready,
                };
            }
            let nc = &self.netcode_v2;
            let next_frame = nc.game_frame_count.resolve();
            // Apply coordinated synced leaves due at this frame BEFORE the readiness check below, so a
            // departing slot is already dropped from `required` when `receive_turns` runs and its
            // `pending_leave_reason` is written for `run_synced_leave_pass` to drain on the ready
            // step. A due leave is what unstalls a step gated on the departing peer. The directive is
            // observed during `receive_turns`' drain; on the step it first arrives the readiness check
            // still stalls, and the next poll of this (stalled) receive applies it here and proceeds.
            self.apply_due_leaves(nc, next_frame);
            // If applying those leaves emptied the remote-human roster in a game that has computer
            // players, close the networked session: the lone human plays on versus the AI entirely
            // locally while the relay session ends cleanly behind them. This is the same local-only
            // latch the victory dialog uses, triggered instead by the roster emptying.
            //
            // Once local-only, a later result report (the human eventually wins or loses versus the
            // AI) is handed to a driver that has already sent its leave intent, so the driver drops
            // it and no HTTP fallback runs — a report from a session that has closed has nowhere
            // trustworthy to go, and games with computers do not track results, so dropping it is
            // correct. Gated on computers-present precisely so a human-only game — where "alone"
            // means the winner's result is imminent — never closes ahead of that report.
            if netcode_v2::with_turn_state(|s| s.should_self_close()).unwrap_or(false) {
                netcode_v2::begin_local_only();
            }
            // Debug-only: the `forceUnsyncedLeave` command's local (non-consensus) injection — same effect,
            // sourced from a queued slot rather than a relay directive. Must also precede the receive.
            #[cfg(debug_assertions)]
            self.apply_forced_unsynced_leaves(nc);
            // Debug-only: the `forceDesync` command's one-shot mineral perturbation on this client.
            #[cfg(debug_assertions)]
            self.apply_forced_desync();
            // Debug-only: the `sendChat` command's queued messages, sent + locally echoed through
            // the same path a human's own Enter keypress uses.
            #[cfg(debug_assertions)]
            self.apply_debug_chat();
            // In-game chat delivered from peers over the relay, each injected as the classic chat
            // record after passing its target scope's receive-side filter.
            self.apply_chat_inbound();
            // Peer skin blobs delivered over the relay, each written into its sender's current
            // players[] slot of the applied-skin table.
            self.apply_skins_inbound();
            // Relay-pushed slot-connectivity changes: a peer's drop/reconnect updates the turn
            // state's disconnected set, our own updates the self-link flag, for the survivor
            // overlay to render. Render-side only — no game state, alliances, or turn pipeline are
            // touched here.
            netcode_v2::with_turn_state(|s| s.pump_connectivity(true, Instant::now()));
            let ready = netcode_v2::with_turn_state(|s| {
                if !s.receive_turns(next_frame) {
                    return false;
                }
                // The bytes are owned by the turn state (refcounted `Bytes`) and stay valid until the
                // next `receive_turns`, which covers the whole step_network dispatch.
                Self::fill_turn_dispatch(
                    nc.player_turns.resolve(),
                    nc.player_turns_size.resolve(),
                    self.storm_player_flags.resolve(),
                    s.dispatch_buffers(),
                );
                s.apply_due_directive(next_frame);
                // Exactly once per executed step (one local turn leaves the pipe), NOT per dispatched
                // slot — see TurnState::mark_local_turn_executed.
                s.mark_local_turn_executed();
                true
            });
            match ready {
                None => TurnReceiveOutcome::Native,
                Some(false) => TurnReceiveOutcome::Stall,
                Some(true) => {
                    // Leave pass runs with the turn-state lock released: the leave handlers can issue
                    // commands that re-enter the OUT hook, which would re-lock the turn state.
                    let leaving = self.run_synced_leave_pass(nc);
                    for storm in leaving {
                        netcode_v2::with_turn_state(|s| s.mark_slot_left(storm));
                    }
                    TurnReceiveOutcome::Ready
                }
            }
        }
    }

    /// Fills `player_turns[]` / `player_turns_size[]` / `net_player_flags[]` from a set of dispatched
    /// per-slot buffers. Shared by [`netcode_v2_receive_turns`](Self::netcode_v2_receive_turns)'s
    /// lobby-phase and in-game branches, which differ only in where `buffers` comes from.
    ///
    /// A full replacement doesn't run the native memset, so every slot is cleared first: a stale
    /// ready bit on a slot we don't fill would make step_network dispatch garbage.
    unsafe fn fill_turn_dispatch<'a>(
        player_turns: *mut *mut u8,
        player_turns_size: *mut u32,
        flags: *mut u32,
        buffers: impl Iterator<Item = (StormPlayerId, &'a [u8])>,
    ) {
        unsafe {
            for i in 0..bw::MAX_STORM_PLAYERS {
                *flags.add(i) = 0;
                *player_turns_size.add(i) = 0;
            }
            for (storm, bytes) in buffers {
                let i = storm.0 as usize;
                *player_turns.add(i) = bytes.as_ptr() as *mut u8;
                *player_turns_size.add(i) = bytes.len() as u32;
                *flags.add(i) = 0x10000 | 0x20000; // present | turn-ready
            }
        }
    }

    /// PIPE hook body (full replacement of `flush_local_turns_to_latency_depth`): flush enough turns
    /// to reach the turn state's latency target, driven off its own in-flight counter rather than
    /// the native `get_outstanding_turn_count` (which goes degenerate-0 once Storm's send/ack
    /// counters stop advancing, causing an unbounded flush). Returns `false` before the game starts
    /// or with no live session, so the caller runs the original.
    unsafe fn netcode_v2_flush_pipe(&self) -> bool {
        unsafe {
            if !self.game_started.load(Ordering::Acquire) {
                return false;
            }
            let nc = &self.netcode_v2;
            // Read the shortfall under the lock, then release before flushing — each flush re-enters
            // the OUT hook (which re-locks the turn state) and bumps the in-flight counter by one.
            let to_flush = netcode_v2::with_turn_state(|s| {
                s.latency_turns().saturating_sub(s.outstanding_turns())
            });
            match to_flush {
                None => false,
                Some(n) => {
                    for _ in 0..n {
                        (nc.flush_outgoing_command_turn)();
                    }
                    true
                }
            }
        }
    }

    /// Seeds the turn state's pipe at the lobby→game transition. The lobby is gated native, so nothing
    /// has primed the turn state when the game starts: the first in-game receive would stall waiting for
    /// turns no one has sent, and the PIPE flush that would send them only runs once the network is
    /// ready — a lockstep deadlock. Native pre-seeds via the lobby's unconditional flush; this is
    /// the turn transport's equivalent, running the PIPE fill once, unconditionally, from the game thread
    /// right after `set_game_started`. Every client seeds its own `latency_turns` turns, which
    /// reach peers via the relay fan-out (and ourselves via the local echo), so everyone's first
    /// receive finds a full turn queued. No-op when there is no live session (the lobby's native
    /// flush already primed the native pipe).
    pub fn seed_netcode_v2_pipe(&self) {
        unsafe {
            self.netcode_v2_flush_pipe();
        }
    }

    /// Seeds Storm's session-player list with the given non-local session members, standing in for
    /// the peer-admit that native networking performs when each member's join packet arrives. For
    /// each member: look up (or create) its list node by net key, write the low byte of its slot,
    /// set the present/turn-expected flag, and register its slot name.
    ///
    /// The local player is never in `members` — its node is set up by the local-identity fixup in
    /// the join replacement instead. The host uses this to admit its peers after `storm_create_game`;
    /// the join replacement uses it to admit everyone but the local player.
    pub unsafe fn v2_seed_storm_session_members(&self, members: &[netcode_v2::StormMemberSeed]) {
        unsafe {
            let nc = &self.netcode_v2;
            for member in members {
                let node = (nc.storm_session_player_lookup_or_create)(member.net_key.as_ptr());
                if node.is_null() {
                    // The lookup allocates on miss and only returns null on allocation failure,
                    // which shouldn't happen; skip the member rather than dereference null.
                    error!(
                        "netcode v2: failed to create Storm session player for slot {}",
                        member.slot
                    );
                    continue;
                }
                write_session_player_slot(node, member.slot);
                // Bit 0x4 = present/turn-expected. Native sets it from a Storm event listener when a
                // peer is admitted; seeding replaces that admit, so seeding must set it or the
                // receive-turns barrier would never expect this member's turns.
                (*node).flags |= 0x4;
                // Write the node's own name buffer, not just the slot-name registry: native
                // init_net_player reads a session member's name straight off the node (via
                // storm_get_player_name_data) and skips a member whose node name is empty, leaving
                // that player's net_player_info entry unpopulated (state stays 0). Without this a
                // seeded remote is invisible to the per-player registration that follows.
                copy_session_player_name(node, &member.name);
                (nc.storm_register_slot_name)(
                    member.slot as u32,
                    member.name.as_ptr() as *const u8,
                );
            }
        }
    }

    /// Writes one human's `net_player_info` (the "storm players") entry directly: state = in-use plus
    /// the display name. Native `init_net_player` only fills this from a session member Storm's own
    /// provider-gated lookup resolves, which succeeds for the local player but not for a
    /// roster-seeded remote, so a remote's entry would otherwise stay empty — leaving its name blank
    /// everywhere the table is read (the multiplayer-player count that gates the diplomacy UI, the
    /// "player was dropped" notice, chat sender names). The `flags`/`unk4`/`protocol_version` values
    /// match what the native `init_network_player_info(_, 0, 1, 5)` path always wrote; they are only
    /// snapshotted into a per-player record, never read by gameplay.
    pub unsafe fn v2_register_net_player(&self, storm_id: u8, name: &str) {
        unsafe {
            let players = self.storm_players.resolve();
            let entry = players.add(storm_id as usize);
            let mut fabricated = scr::StormPlayer {
                state: 1,
                unk1: 0,
                flags: 0,
                unk4: 1,
                protocol_version: 5,
                name: [0; 0x60],
            };
            for (&input, out) in name.as_bytes().iter().zip(fabricated.name.iter_mut()) {
                *out = input;
            }
            *entry = fabricated;
        }
    }

    /// Copies BW's game template for `game_type` into `game_data.game_template`. On the host, native
    /// game creation does this from a registry BW loads from data files; the roster-driven peer join
    /// builds its session locally and never receives the host's game-info blob, so its template block
    /// stays zeroed — which BW reads as a Use-Map-Settings game (map triggers run, no alliance UI,
    /// map-defined victory instead of the real game type's rules). Every client loads the same
    /// registry at startup, so this local lookup reproduces the host's template exactly. Errors if the
    /// game type is not registered.
    pub unsafe fn apply_game_type_template(&self, game_type: bw::BwGameType) -> Result<(), ()> {
        unsafe {
            // The lookup keys on the game type split into low/high bytes; our game types all fit in
            // the low byte, so the high byte is always 0.
            let template = (self.find_game_type_template)(
                game_type.primary as u32,
                0,
                game_type.subtype as u32,
            );
            if template.is_null() {
                error!(
                    "No game template registered for type {}/{}",
                    game_type.primary, game_type.subtype
                );
                return Err(());
            }
            let dest = self.game_data.resolve();
            (*dest).game_template = *(template as *const bw::GameTemplate);
            Ok(())
        }
    }

    /// Full replacement for `storm_join_game` used when a lobby session seed is staged: builds this
    /// client's Storm session state from our own inputs rather than the network join handshake the
    /// native function performs (two sends and two blocking waits).
    ///
    /// The native function's prefix tears down any prior session, and a native peer's session state
    /// (game-info blob plus globals) is assembled by an inbound-message handler that never runs in
    /// this seam. `storm_create_game` constructs the equivalent state from our own inputs, after
    /// which the local identity is corrected to the roster slot and the other members are seeded in
    /// place of the network admit. Nothing ever compares session blobs across machines, so each
    /// client building its own from identical server-fed inputs is sound.
    ///
    /// Returns 1 (TRUE) on success — the native caller then stores `*out_net_player_id` as the local
    /// net player id — or 0 (FALSE) on failure, handing control to the caller's join-failure path.
    unsafe fn v2_run_join_replacement(
        &self,
        seed: &netcode_v2::LobbySessionSeed,
        out_net_player_id: *mut u32,
    ) -> u32 {
        unsafe {
            let nc = &self.netcode_v2;
            // The native join flow retries: a failure after this replacement already succeeded once
            // (e.g. the caller's map load) re-invokes it. storm_create_game is the one non-idempotent
            // step, so skip it when a session is already live. `in_lobby_or_game` is the reliable
            // test: create_local_storm_session itself sets it to 1 and nothing else on this path
            // touches it, so it is provably 0 on the first attempt and 1 on every retry after a
            // successful create. (storm_local_player_slot's 0xff not-in-session sentinel is what
            // native join's own entry guard checks, but its pre-first-write state is unverified — a
            // zero-initialized global would read as "in session" and wrongly skip the first create.)
            // Every step below is overwrite-or-recompute and safe to re-run.
            let session_already_live = self.in_lobby_or_game.resolve() != 0;
            if !session_already_live {
                // 1. Build equivalent session state. A fresh local session with no peers makes the
                //    local player session slot 0; the fixup below moves it to the roster slot.
                if let Err(e) = self.create_local_storm_session(
                    &seed.game_name,
                    &seed.local_name,
                    seed.slot_count,
                ) {
                    error!("netcode v2: join replacement storm_create_game failed: {e:08x}");
                    return 0;
                }
            }
            // 2. Local identity fixup: correct the local session slot and node from the 0 that create
            //    produced to this client's roster slot.
            nc.storm_local_player_slot.write(seed.local_slot);
            let local = (nc.get_local_storm_session_player)();
            if local.is_null() {
                error!("netcode v2: join replacement could not resolve local session player");
                return 0;
            }
            write_session_player_slot(local, seed.local_slot);
            // Create already wrote the local name into this node; rewriting it keeps the fixup
            // self-sufficient and identical for any future caller.
            copy_session_player_name(local, &seed.local_name);
            (nc.storm_register_slot_name)(
                seed.local_slot as u32,
                seed.local_name.as_ptr() as *const u8,
            );
            // 3. Seed the other members. Done after the local fixup so its slot-name registration for
            //    the local slot re-registers over the local name create left at that index.
            self.v2_seed_storm_session_members(&seed.members);
            // 4. The local game-level net player id the native caller stores: session slot plus the
            //    turn base.
            // Every roster consumer treats the game-level net player id as identical to the session
            // slot; that holds because the turn base stays 0 in this flow (its native writers are
            // the Storm turn-advance and join paths, which never run here). Assert it so a violation
            // is loud in debug rather than a silent identity mismatch.
            debug_assert_eq!(
                nc.storm_turn_base.resolve(),
                0,
                "storm_turn_base expected to be 0"
            );
            *out_net_player_id = seed.local_slot as u32 + nc.storm_turn_base.resolve();
            // 5. Native join's success tail drains Storm's deferred inbound queue. Nothing can be
            //    queued when no Storm networking has run, but calling it keeps the replacement
            //    faithful to the native tail and covers any provider-queued edge.
            (nc.snet_drain_deferred_queue)();
            // 6. TRUE: the caller treats the join as succeeded.
            1
        }
    }

    /// Applies coordinated synced leaves due at `next_frame`, run at the top of the IN hook before
    /// the readiness check. Drains the turn state's [`LeaveTracker`](netcode_v2) for slots whose
    /// relay-agreed apply frame has arrived, writes each departing slot's `pending_leave_reason`
    /// mailbox (drained by [`run_synced_leave_pass`](Self::run_synced_leave_pass) in the synced-RNG
    /// window on the ready step) and drops it from the readiness set — so a step stalled on the
    /// departing peer can proceed. No-op with no live session.
    ///
    /// This is the **production** leave path: the reason, slot, and apply frame all come from the
    /// authority relay's directive, so every client applies the identical leave at the identical
    /// frame and the native drain is deterministic across all of them (including clients that never
    /// observed the drop locally). It is the consensus-backed twin of the debug-only, per-client
    /// [`apply_forced_unsynced_leaves`](Self::apply_forced_unsynced_leaves).
    unsafe fn apply_due_leaves(&self, nc: &NetcodeV2Bw, next_frame: u32) {
        unsafe {
            let Some(due) = netcode_v2::with_turn_state(|s| s.take_due_leaves(next_frame)) else {
                return; // no live session
            };
            for (storm, reason) in due {
                *nc.pending_leave_reason.resolve().add(storm.0 as usize) = reason as i32;
            }
        }
    }

    /// Debug-only `forceUnsyncedLeave` application, run at the top of the IN hook. Drains the slots the
    /// `forceUnsyncedLeave` command queued on the turn state and, for each one that maps to a storm id,
    /// writes that storm's `pending_leave_reason` mailbox and drops the slot from the readiness set.
    /// The existing native synced-leave pass ([`run_synced_leave_pass`](Self::run_synced_leave_pass))
    /// then detects the written reason and applies it in the synced-RNG window on a ready step,
    /// exactly as it would for a real drop; the `mark_slot_left` here is idempotent with the pass's
    /// own re-report. An unmapped slot (no storm id yet) can't be leaked into `pending_leave_reason`,
    /// so it's warned and skipped.
    ///
    /// # Determinism
    ///
    /// Writing `pending_leave_reason` and running `apply_pending_player_leaves` consumes synced RNG
    /// on THIS client only. That is faithful to the real per-client leave mechanism, but a one-sided
    /// injection desyncs a *continuing* multi-player game: peers that didn't apply the same leave on
    /// the same turn diverge. For a 1v1 opponent-drop test (one remaining client) this is correct as
    /// is; for 3+ player games the caller must inject the same slot on every remaining client on the
    /// same turn — which is what the (still-unbuilt) coordinated-leave consensus will do. This is the
    /// trigger, NOT the consensus; it deliberately does no cross-client coordination.
    #[cfg(debug_assertions)]
    unsafe fn apply_forced_unsynced_leaves(&self, nc: &NetcodeV2Bw) {
        unsafe {
            let Some(forced) = netcode_v2::with_turn_state(|s| s.take_forced_unsynced_leaves())
            else {
                // No live session — nothing to force.
                return;
            };
            for slot in forced {
                let storm = netcode_v2::with_turn_state(|s| s.storm_id_for_slot(slot)).flatten();
                let Some(storm) = storm else {
                    warn!("netcode v2: forceUnsyncedLeave for unmapped slot {slot:?}; skipping");
                    continue;
                };
                *nc.pending_leave_reason.resolve().add(storm.0 as usize) =
                    FORCED_UNSYNCED_LEAVE_REASON;
                netcode_v2::with_turn_state(|s| {
                    s.mark_slot_left(storm);
                    // Observation-only: tag the slot's net-stats row with how it departed.
                    s.record_departure(storm, FORCED_UNSYNCED_LEAVE_REASON as u32);
                });
            }
        }
    }

    /// Debug-only `forceDesync` application, run at the top of the IN hook. When the command has
    /// armed the turn state's one-shot flag, diverges this client's simulation from its peers:
    ///
    /// - XORs [`FORCED_DESYNC_RNG_XOR`] into the synced RNG seed. The seed is folded into the
    ///   per-turn sync checksum, so this trips the peers' sync check on the next matching turn
    ///   deterministically (and every subsequent RNG draw diverges, so the desync also cascades
    ///   through unit behavior). This is the reliable trigger.
    /// - Adds [`FORCED_DESYNC_MINERAL_BONUS`] to the local player's minerals, a visible in-game
    ///   confirmation the command landed and a second, resource-level divergence.
    ///
    /// No-op with no live session, or before the game struct exists.
    ///
    /// # Determinism
    ///
    /// The whole point is to break determinism: these writes happen on this client alone, so its
    /// state and command stream drift from every peer. This is the trigger for observing desync
    /// behavior through the transport, and it deliberately does no cross-client coordination.
    #[cfg(debug_assertions)]
    unsafe fn apply_forced_desync(&self) {
        unsafe {
            let armed = netcode_v2::with_turn_state(|s| s.take_forced_desync());
            if armed != Some(true) {
                // No live session, or no perturbation pending.
                return;
            }

            // The synced RNG seed sits one u32 past the operand analysis resolves (mirrors the read
            // in `BwScr::rng_seed`).
            let seed_ptr = self.rng_seed.resolve_as_ptr().add(1);
            let old_seed = seed_ptr.read_unaligned();
            let new_seed = old_seed ^ FORCED_DESYNC_RNG_XOR;
            seed_ptr.write_unaligned(new_seed);
            warn!("netcode v2: forceDesync perturbed RNG seed {old_seed:#x} -> {new_seed:#x}");

            let game = self.game();
            if game.is_null() {
                // The RNG divergence above is enough to trip the sync check; the minerals write is
                // just a visible extra, so a missing game struct isn't fatal.
                warn!("netcode v2: forceDesync before game struct exists; skipped minerals write");
                return;
            }
            let game = bw_dat::Game::from_ptr(game);
            let player = self.local_player_id.resolve();
            // The game's minerals array has one entry per game player (12 wide); an observer's id
            // falls outside it and has no resources to perturb anyway.
            const GAME_PLAYER_COUNT: u32 = 12;
            if player >= GAME_PLAYER_COUNT {
                warn!(
                    "netcode v2: forceDesync with non-player local id {player}; skipped minerals"
                );
                return;
            }
            let player = player as u8;
            let current = game.minerals(player);
            let perturbed = current.saturating_add(FORCED_DESYNC_MINERAL_BONUS);
            game.set_minerals(player, perturbed);
            warn!(
                "netcode v2: forceDesync perturbed local player {player} minerals {current} -> {perturbed}"
            );
        }
    }

    /// Debug-only `sendChat` application, run on the game thread alongside
    /// [`apply_forced_unsynced_leaves`](Self::apply_forced_unsynced_leaves)/[`apply_forced_desync`](Self::apply_forced_desync).
    /// Drains the messages the `sendChat` command queued and sends + locally echoes each one
    /// through [`send_chat_message`](Self::send_chat_message) — the exact path the in-game chat
    /// box's own send tap uses — so a debug-triggered message is indistinguishable downstream from
    /// one a human typed.
    #[cfg(debug_assertions)]
    unsafe fn apply_debug_chat(&self) {
        unsafe {
            let Some(queued) = netcode_v2::with_turn_state(|s| s.take_debug_chat_queue()) else {
                return; // no live session
            };
            for (target, text) in queued {
                self.send_chat_message(target, &text);
            }
        }
    }

    /// Send path shared by the in-game chat box's send tap (`dialog_hook::chat_box_event_handler`)
    /// and the `sendChat` debug command: submits `text` to the active netcode v2 session's chat
    /// channel, scoped by `target`, then injects this client's own local echo — the classic chat
    /// record for our own storm id — the same way a peer's message is injected. Suppressing the
    /// native battlenet-gateway chat send (dead under netcode v2 anyway) also suppresses its local
    /// ClientSdk loopback echo, so this injection is the only thing that renders our own message.
    ///
    /// Returns `false` when there is no live netcode v2 session, so the caller falls back to
    /// native chat handling unchanged. A `true` return means a session took the message — even if
    /// the relay send itself failed, chat is best-effort (see
    /// [`TurnState::submit_chat`](netcode_v2::TurnState::submit_chat)), and the only thing that
    /// matters to the caller is whether native chat should be suppressed.
    unsafe fn send_chat_message(&self, target: netcode_v2::ChatTarget, text: &str) -> bool {
        unsafe {
            let Some(sent) =
                netcode_v2::with_turn_state(|s| s.submit_chat(target, text.to_string()))
            else {
                return false; // no live session
            };
            if !sent {
                debug!("netcode v2: chat_out channel unavailable; message not queued for peers");
            }
            let local_storm = StormPlayerId(self.local_storm_id.resolve() as u8);
            if !self.inject_chat_message(local_storm, text) {
                debug!("netcode v2: local chat echo dropped; local storm id unresolved");
            }
            true
        }
    }

    /// Injects one chat message — attributed to `storm_player` — as the classic chat record, so it
    /// renders on the overlay with correct attribution and lands in the replay. Used for both a
    /// peer's message arriving over the netcode v2 relay (`apply_chat_inbound`) and this client's
    /// own local echo (`send_chat_message`, with `storm_player` set to this client's own storm id)
    /// — one path renders both, so the two can never diverge in formatting or attribution.
    ///
    /// Returns `false` (injecting nothing) when `storm_player` can't be resolved to a `players[]`
    /// slot right now — see [`unique_player_for_storm`](Self::unique_player_for_storm) — e.g. it
    /// already left.
    unsafe fn inject_chat_message(&self, storm_player: StormPlayerId, text: &str) -> bool {
        unsafe {
            let Some(unique_player) = self.unique_player_for_storm(storm_player) else {
                return false;
            };
            let record = build_chat_record(unique_player, text);
            // `0`: a live command not yet on the replay's command log, so the native command
            // processor appends it (`add_to_replay_data`) the same as any other in-game command —
            // see `process_injected_game_command`'s doc comment for the full reasoning.
            let injected = self.process_injected_game_command(&record, storm_player, 0);
            #[cfg(debug_assertions)]
            if injected {
                let own = storm_player.0 as u32 == self.local_storm_id.resolve();
                netcode_v2::with_turn_state(|s| {
                    s.record_chat(crate::debug_control::DebugChatLogEntry {
                        sender_game_id: unique_player,
                        text: commands::truncate_utf8(text, commands::CHAT_TEXT_CAPACITY)
                            .to_string(),
                        own,
                    })
                });
            }
            injected
        }
    }

    /// Whether a received chat message naming `target` should be shown to the local player, given
    /// its sender's BW storm id. Mirrors the scopes the `MsgFltr` chat-target dialog offers (see
    /// `dialog_hook::chat_target_scope`): `All` always shows; `Allies` shows only to a player
    /// currently allied with the sender; `Observers` shows only if the local player is an
    /// observer; `Players` shows only if the local rp2 slot is a member of its mask — a lone
    /// recipient's mask has one bit, while a team-shared-control game's sender put every slot on
    /// both the addressed team and its own team into the mask. Anything else is dropped silently
    /// by the caller.
    unsafe fn chat_target_visible(
        &self,
        sender_storm: StormPlayerId,
        target: netcode_v2::ChatTarget,
    ) -> bool {
        unsafe {
            match target {
                netcode_v2::ChatTarget::All => true,
                netcode_v2::ChatTarget::Players(mask) => {
                    netcode_v2::with_turn_state(|s| mask.contains(s.local_slot_id()))
                        .unwrap_or(false)
                }
                netcode_v2::ChatTarget::Observers => {
                    BwPlayerId(self.local_unique_player_id.resolve() as u8).is_observer()
                }
                netcode_v2::ChatTarget::Allies => {
                    match self.unique_player_for_storm(sender_storm) {
                        Some(sender_unique) => self.is_allied_with(sender_unique),
                        // The sender can't be resolved to a live player right now (e.g. already
                        // left) — nothing to compare alliances against, so don't show it as if it
                        // were an ally message.
                        None => false,
                    }
                }
            }
        }
    }

    /// Whether the local player is currently allied with `other_unique_player` (a `players[]`
    /// index). A team game shares one alliance per team, so it's decided by comparing
    /// `players[].team`; otherwise each player sets alliances individually, tracked in
    /// `game.alliances[a][b]` — `a`'s live alliance state toward `b`, `0` for an enemy and
    /// nonzero for an ally (plain or allied-victory). Picks whichever the game actually uses so it
    /// reflects in-game alliance changes, not just the lobby's starting teams.
    unsafe fn is_allied_with(&self, other_unique_player: u8) -> bool {
        unsafe {
            let local = self.local_unique_player_id.resolve() as u8;
            // Observers hold no alliances: a local observer (BW id 0x80-0x83) never sees
            // allies-scoped chat, and an observer sender (players[12..16]) is allied with no one.
            // This also keeps the indexing below inside players[0..8] and alliances[0..12] — both
            // observer encodings would run past those bounds.
            if BwPlayerId(local).is_observer() || BwPlayerId(other_unique_player).is_observer() {
                return false;
            }
            if local == other_unique_player {
                return true;
            }
            if game_thread::is_team_game() {
                let players = self.players();
                let local_team = (*players.add(local as usize)).team;
                let other_team = (*players.add(other_unique_player as usize)).team;
                local_team == other_team
            } else {
                (*self.game()).alliances[local as usize][other_unique_player as usize] != 0
            }
        }
    }

    /// Resolves a BW storm id to its `players[]` index: player slots `0..8` and observer slots
    /// `12..16` (ids 0x80-0x83). The intervening `8..12` are neutral/special slots that never carry
    /// a session storm id and are deliberately skipped. This is the mapping used to attribute a
    /// command — chat or replayed — to its author. Returns `None` if no slot currently holds the
    /// storm id (e.g. the player already left).
    unsafe fn unique_player_for_storm(&self, storm_player: StormPlayerId) -> Option<u8> {
        unsafe {
            let players = self.players();
            (0..8)
                .chain(12..16)
                .find(|&i| (*players.add(i)).storm_id as u8 == storm_player.0)
                .map(|s| s as u8)
        }
    }

    /// The game player id whose identity a command runs under, given the sender's `players[]` index
    /// (from [`unique_player_for_storm`](Self::unique_player_for_storm)). In a team game a normal
    /// player's commands run under that team's main player; an observer has no team (its
    /// `players[].team` is 0, which would underflow `team_game_main_player`), so it acts under its
    /// own slot. Outside a team game, and always for an observer, the slot index is the game player.
    unsafe fn command_game_player(&self, unique_player: u8) -> u8 {
        unsafe {
            if game_thread::is_team_game() && !BwPlayerId(unique_player).is_observer() {
                let players = self.players();
                // Teams start from 1
                let team = (*players.add(unique_player as usize)).team;
                (*self.game()).team_game_main_player[team as usize - 1]
            } else {
                unique_player
            }
        }
    }

    /// Feeds `commands` through the native command processor as if it had arrived from
    /// `storm_player`'s own turn — the mechanism
    /// [`process_replay_commands`](Self::process_replay_commands) uses to re-feed a saved replay's
    /// log back through, generalized here to a buffer assembled at runtime instead of one read
    /// back from a replay file. Resolves `storm_player`'s BW player identity (storm id → unique
    /// player → that team's game player, for a team game) and stamps `command_user`/
    /// `unique_command_user` for the one call, restoring the local player's identity immediately
    /// after so nothing downstream mistakes this client for `storm_player`.
    ///
    /// Unlike `process_replay_commands`, this leaves `enable_rng` untouched: that toggle exists for
    /// re-deriving a saved replay's RNG draws, and every command this helper injects (chat, so far)
    /// consumes no RNG — there is nothing here for it to gate.
    ///
    /// `are_recorded_replay_commands` is the third argument the native processor (and its
    /// `ProcessGameCommands` hook) takes: `1` means "these commands are already on the replay
    /// log" — the value `process_replay_commands` passes when re-feeding a saved replay's own
    /// commands back through, so the native processor's `add_to_replay_data` does not double-write
    /// them. `0` means a live, not-yet-recorded command, which the processor *does* append to the
    /// growing replay log. A message produced live during this game wants the latter, so it lands
    /// in the replay the same way it would have if the native chat gateway still worked.
    ///
    /// One side effect worth naming: the `ProcessGameCommands` hook's "didn't see a sync command
    /// this call" bookkeeping is gated only on `is_replay` (never true here — this only runs
    /// during a live game), not on this argument, so an injected call — which never carries a
    /// `0x37` sync command — logs the same "will be dropped" line real turn dispatch logs for an
    /// actually-desynced peer. That bookkeeping (`dropped_players`, read only by
    /// `check_player_drops`) is a logging dedup flag, not itself what drops anyone from the game;
    /// this is a known, accepted side effect of reusing this entry point for out-of-band chat
    /// rather than adding a new native one.
    ///
    /// Returns `false` (injecting nothing) if `storm_player` doesn't currently own a `players[]`
    /// slot — see [`unique_player_for_storm`](Self::unique_player_for_storm).
    unsafe fn process_injected_game_command(
        &self,
        commands: &[u8],
        storm_player: StormPlayerId,
        are_recorded_replay_commands: u32,
    ) -> bool {
        unsafe {
            let Some(unique_player) = self.unique_player_for_storm(storm_player) else {
                return false;
            };
            let game_player = self.command_game_player(unique_player);
            self.command_user.write(game_player as u32);
            self.unique_command_user.write(unique_player as u32);
            (self.process_game_commands)(
                commands.as_ptr(),
                commands.len(),
                are_recorded_replay_commands,
            );
            self.command_user.write(self.local_player_id.resolve());
            self.unique_command_user
                .write(self.local_unique_player_id.resolve());
            true
        }
    }

    /// In-game chat delivered from peers over the netcode v2 relay: drains what's arrived (see
    /// [`TurnState::drain_chat_inbound`](netcode_v2::TurnState::drain_chat_inbound)) and injects
    /// each message that passes the receive-side scope filter
    /// ([`chat_target_visible`](Self::chat_target_visible)) as the classic chat record. Run once
    /// per receive on the game thread, alongside the debug forced-leave/desync application.
    unsafe fn apply_chat_inbound(&self) {
        unsafe {
            let Some(messages) = netcode_v2::with_turn_state(|s| s.drain_chat_inbound(true)) else {
                return; // no live session
            };
            for (slot, chat) in messages {
                let Some(sender_storm) =
                    netcode_v2::with_turn_state(|s| s.storm_id_for_slot(slot)).flatten()
                else {
                    debug!("netcode v2: chat from unmapped slot {slot:?}; dropping");
                    continue;
                };
                let target = netcode_v2::ChatTarget::from_wire(chat.target_kind, chat.target_slot);
                if !self.chat_target_visible(sender_storm, target) {
                    continue;
                }
                if !self.inject_chat_message(sender_storm, &chat.text) {
                    debug!(
                        "netcode v2: chat from slot {slot:?} (storm {sender_storm:?}) could not \
                         be attributed to a players[] slot; dropping"
                    );
                }
            }
        }
    }

    /// Peer skin blobs delivered over the netcode v2 relay: drains what's arrived (see
    /// [`TurnState::drain_skin_inbound`](netcode_v2::TurnState::drain_skin_inbound)) and writes
    /// each into its sender's slot of the applied-skin table. Run once per receive on the game
    /// thread, alongside the chat application.
    ///
    /// The sender's rp2 slot is resolved through its storm id to a `players[]` slot *at apply
    /// time* — `players[]` indices are assigned at game init, not in lobby order, so any
    /// lobby-time index would attribute the blob to the wrong player. Applying is safe at any
    /// frame: the table is non-synced cosmetic state read only by rendering, and whether peers'
    /// skins display at all remains the local viewer's own skins-enabled/ownership gating inside
    /// BW's skin lookup.
    unsafe fn apply_skins_inbound(&self) {
        unsafe {
            let Some(blobs) = netcode_v2::with_turn_state(|s| s.drain_skin_inbound()) else {
                return; // no live session
            };
            for (slot, blob) in blobs {
                let Some(sender_storm) =
                    netcode_v2::with_turn_state(|s| s.storm_id_for_slot(slot)).flatten()
                else {
                    debug!("netcode v2: skin blob from unmapped slot {slot:?}; dropping");
                    continue;
                };
                let Some(unique_player) = self.unique_player_for_storm(sender_storm) else {
                    debug!(
                        "netcode v2: skin blob from slot {slot:?} (storm {sender_storm:?}) could \
                         not be attributed to a players[] slot; dropping"
                    );
                    continue;
                };
                if !self.write_player_skin_blob(unique_player, &blob) {
                    debug!(
                        "netcode v2: skin blob from slot {slot:?} not applied (table missing or \
                         blob length {} != slot stride)",
                        blob.len()
                    );
                }
            }
        }
    }

    /// Reproduces `receive_storm_turns`' synced player-leave pass for the IN replacement: runs
    /// `apply_pending_player_leaves` inside the synced-RNG window (leave handling can consume synced
    /// RNG, so it must run with the same RNG state on every client) and returns the storm slots whose
    /// pending reason was drained this pass, so the turn state can drop them from its readiness set. Must be
    /// called with the turn-state lock released — the leave handlers can re-enter the OUT hook.
    unsafe fn run_synced_leave_pass(&self, nc: &NetcodeV2Bw) -> SmallVec<[StormPlayerId; 4]> {
        unsafe {
            let reasons = nc.pending_leave_reason.resolve();
            let mut leaving = SmallVec::new();
            for i in 0..bw::MAX_STORM_PLAYERS {
                if *reasons.add(i) != 0 {
                    leaving.push(StormPlayerId(i as u8));
                }
            }
            let orig_rng = self.enable_rng.resolve();
            self.enable_rng.write(1);
            (nc.apply_pending_player_leaves)();
            self.enable_rng.write(orig_rng);
            leaving
        }
    }

    /// Triggers the game to process any events (such as Windows messages, sound playback, etc.).
    /// Typically the game will call this itself as part of stepping the game loop, but this may
    /// need to be manually called during initialization/shutdown.
    pub unsafe fn process_events(&self) {
        self.event_processing_lock.lock();
        unsafe {
            (self.process_events)(3);
        }
        self.event_processing_lock.unlock();
    }

    /// Unlocks the event processing lock when Windows has taken over our wndproc (i.e. for
    /// resizing or a context menu). Once that completes, `lock_event_processing_for_subwndproc`
    /// must be called to re-acquire the lock.
    pub unsafe fn unlock_event_processing_for_size_move_menu(&self) {
        self.event_processing_lock.unlock();
    }

    /// Locks the event processing lock when Windows has stopped taking over our wndproc (i.e. for
    /// resizing or a context menu), since afterwards we'll be back inside `process_events`.
    pub unsafe fn lock_event_processing_for_size_move_menu(&self) {
        self.event_processing_lock.lock();
    }

    /// Forces a redraw of the graphic layers. This should only be used during game initialization,
    /// as we don't provide the necessary extra functions to properly render an ingame UI.
    pub unsafe fn force_redraw_during_init(&self) {
        unsafe {
            (self.render_screen)(std::ptr::null_mut(), 0);
        }
    }

    pub fn set_countdown_start(&self, time: Instant) {
        let mut c = self.countdown_start.lock();
        *c = Some(time);
    }

    /// Returns whether the game has started. This is thread-safe.
    pub fn has_game_started(&self) -> bool {
        self.game_started.load(Ordering::Acquire)
    }

    /// Sets that the game has started. This is thread-safe.
    pub fn set_game_started(&self) {
        self.game_started.store(true, Ordering::Release);
    }

    unsafe fn handle_debug_ui_actions(
        &self,
        overlay_out: &draw_overlay::StepOutput,
        render_state: &mut RenderState,
    ) {
        if let Some((ctrl, show)) = overlay_out.show_hide_control {
            if show {
                if ctrl.control_type() == 0 {
                    // ctrl.show() crashes for dialogs, but this seems to work..
                    // (It tries to check if mouse x/y is on control, but
                    // to do that it'll access parent rect, which won't exist
                    // for dialogs)
                    (*(*ctrl)).flags |= 0x2;
                } else {
                    ctrl.show();
                }
            } else {
                ctrl.hide();
            }
        }
        if let Some((index, show)) = overlay_out.show_hide_graphic_layer {
            assert!(index < 8);
            let graphic_layers = self.graphic_layers.and_then(|x| NonNull::new(x.resolve()));
            if let Some(layers) = graphic_layers {
                let layer = layers.as_ptr().add(index as usize);
                if show {
                    if (*layer).draw_func.is_some() {
                        (*layer).draw = 1;
                    }
                } else {
                    (*layer).draw = 0;
                }
            }
        }
        let x_diff =
            overlay_out.statbtn_dialog_offset.0 - render_state.debug_statbtn_dialog_offset.0;
        let y_diff =
            overlay_out.statbtn_dialog_offset.1 - render_state.debug_statbtn_dialog_offset.1;
        render_state.debug_statbtn_dialog_offset = overlay_out.statbtn_dialog_offset;
        self.offset_statbtn_dialog(x_diff, y_diff);
    }

    pub unsafe fn offset_statbtn_dialog(&self, x_diff: i32, y_diff: i32) -> bool {
        if x_diff == 0 && y_diff == 0 {
            return true;
        }
        let first_dialog = self.resolve_first_dialog();
        if let Some(dialog) =
            bw::iter_dialogs(first_dialog).find(|x| x.as_control().string() == "StatBtn")
        {
            (**dialog.as_control()).area.left += x_diff as i16;
            (**dialog.as_control()).area.right += x_diff as i16;
            (**dialog.as_control()).area.top += y_diff as i16;
            (**dialog.as_control()).area.bottom += y_diff as i16;
            true
        } else {
            false
        }
    }

    unsafe fn center_screen(&self, pos: &bw::Point) {
        unsafe {
            let width = self.game_screen_width_bwpx.resolve();
            let height = self.game_screen_height_bwpx.resolve();
            let max_width = match self.map_width_pixels.resolve().checked_sub(width) {
                Some(s) => s,
                None => return,
            };
            let max_height = match self.map_height_pixels.resolve().checked_sub(height) {
                Some(s) => s,
                None => return,
            };
            let x = (pos.x as u32).saturating_sub(width / 2).clamp(0, max_width);
            let y = (pos.y as u32)
                .saturating_sub(height / 2)
                .clamp(0, max_height);
            (self.move_screen)(x, y);
        }
    }

    pub unsafe fn move_unit(&self, unit: Unit, pos: &bw::Point) {
        self.move_unit.call3(*unit, pos.x as i32, pos.y as i32)
    }

    unsafe fn update_nation_and_human_ids(&self) {
        unsafe {
            let net_player_to_game = self.net_player_to_game.resolve();
            let net_player_to_unique = self.net_player_to_unique.resolve();
            let local_storm_id = self.local_storm_id.resolve();
            let players = self.players.resolve();
            for i in 0..NET_PLAYER_COUNT {
                *net_player_to_unique.add(i) = 8;
                *net_player_to_game.add(i) = 8;
            }
            // 0..8 are normal player slots, 8..12 can be used by UMS, 12..16 are observers
            for i in 0..16 {
                let player = players.add(i);
                let storm_id = (*player).storm_id;

                debug!(
                    "Slot {} has id {}, player_type {}, storm_id {}",
                    i,
                    (*player).id,
                    (*player).player_type,
                    (*player).storm_id
                );
                // Note: We set obs slot player types also be PLAYER_TYPE_HUMAN while BW uses
                // a separate value for them, so this if includes both players and observers.
                // Not 100% sure why we do it differently from BW, probably ended up doing that since
                // the existing code didn't account for it and BW doesn't seem to care?
                if (*player).player_type == bw::PLAYER_TYPE_HUMAN {
                    assert!(storm_id < 16);
                    let game_id = match i < 12 {
                        true => i,
                        false => 128 + (i - 12),
                    };
                    *net_player_to_game.add(storm_id as usize) = game_id as u32;
                    *net_player_to_unique.add(storm_id as usize) = game_id as u32;
                    if storm_id == local_storm_id {
                        self.local_player_id.write(game_id as u32);
                        self.local_unique_player_id.write(game_id as u32);
                    }
                }
            }
        }
    }

    unsafe fn storm_last_error_ptr(&self) -> *mut u32 {
        unsafe {
            // This just is starcraft.exe errno
            // dword [[fs:[2c] + tls_index * 4] + 4]
            let tls_index = *self.starcraft_tls_index.0;
            let table = read_fs_gs(0xb * mem::size_of::<usize>()) as *mut *mut u32;
            let tls_data = *table.add(tls_index as usize);
            tls_data.add(1)
        }
    }

    unsafe fn storm_last_error(&self) -> u32 {
        unsafe { *self.storm_last_error_ptr() }
    }

    unsafe fn init_team_game_playable_slots(&self) {
        unsafe {
            // There's a bw::Player structure that contains player types as they were
            // defined in the map scenario.chk; It is being used in lobby to know which slots
            // are completely disabled, which ones are available for humans etc.
            // Team games override that and set all those slots to open so that they can
            // have all 8 slots available in lobby on smaller maps.
            // This requires the player types to be copied to a backup array; usually people
            // joining that get the array's contents from a message sent by the host, but we
            // skip that. Copying that information from the chk players
            // (which is same what the host does) is fine since we guarantee that all players
            // have the map file ready before joining, so the data there is valid.
            let chk_players = self.chk_players.resolve();
            let init_player_types = self.init_chk_player_types.resolve();
            for i in 0..12 {
                *init_player_types.add(i) = (*chk_players.add(i)).player_type;
            }
        }
    }

    unsafe fn create_fow_sprite_main(&self, unit: Unit) -> Option<()> {
        unsafe {
            // Going to be pessimistic and guess that the existing function for creating fog
            // sprites is likely to be inlined in some future build.
            // So going to write explicitly the equivalent function.
            //
            // This is simpler what BW does since it just allocates the Sprite/Image objects and
            // copies existing data there, but it should not cause any issues.
            //
            // Also taking care to not actually add any objects to active lists before all
            // allocations are done so that we can recover cleanly from allocation failures.
            // (Though allocation failure is an edge case that likely never gets actually hit or
            // tested :/)
            let free_fow_sprites = self.free_fow_sprites.resolve();
            let free_sprites = self.free_sprites.resolve();
            let free_images = self.free_images.resolve();
            let fow = free_fow_sprites.alloc()?;
            let sprite = free_sprites.alloc()?;
            let mut images: SmallVec<[bw::list::Allocation<bw::Image>; 8]> = SmallVec::new();
            let in_sprite = (**unit).flingy.sprite as *mut scr::Sprite;
            *sprite.value() = scr::Sprite {
                prev: null_mut(),
                next: null_mut(),
                sprite_id: (*in_sprite).sprite_id,
                player: (*in_sprite).player,
                selection_index: (*in_sprite).selection_index,
                visibility_mask: 0xff,
                elevation_level: (*in_sprite).elevation_level,
                flags: (*in_sprite).flags,
                selection_flash_timer: (*in_sprite).selection_flash_timer,
                index: (*in_sprite).index,
                width: (*in_sprite).width,
                height: (*in_sprite).height,
                pos_x: (*in_sprite).pos_x,
                pos_y: (*in_sprite).pos_y,
                main_image: null_mut(),
                first_image: null_mut(),
                last_image: null_mut(),
            };
            let mut in_image = (*in_sprite).first_image;
            while !in_image.is_null() {
                let image = free_images.alloc()?;
                *image.value() = bw::Image {
                    prev: null_mut(),
                    next: null_mut(),
                    image_id: (*in_image).image_id,
                    drawfunc: (*in_image).drawfunc,
                    direction: (*in_image).direction,
                    flags: (*in_image).flags,
                    x_offset: (*in_image).x_offset,
                    y_offset: (*in_image).y_offset,
                    iscript: bw::Iscript {
                        header: (*in_image).iscript.header,
                        pos: (*in_image).iscript.pos,
                        return_pos: (*in_image).iscript.return_pos,
                        animation: (*in_image).iscript.animation,
                        wait: (*in_image).iscript.wait,
                    },
                    frameset: (*in_image).frameset,
                    frame: (*in_image).frame,
                    map_position: (*in_image).map_position,
                    screen_position: (*in_image).screen_position,
                    grp_bounds: (*in_image).grp_bounds,
                    grp: (*in_image).grp,
                    drawfunc_param: (*in_image).drawfunc_param,
                    draw: (*in_image).draw,
                    step_frame: (*in_image).step_frame,
                    parent: sprite.value() as *mut bw::Sprite,
                };
                if in_image == (*in_sprite).main_image {
                    (*sprite.value()).main_image = image.value();
                }
                images.push(image);
                in_image = (*in_image).next;
            }
            *fow.value() = bw::FowSprite {
                prev: null_mut(),
                next: null_mut(),
                unit_id: (**unit).unit_id,
                sprite: sprite.value() as *mut c_void,
            };

            // Now the allocations can be moved to active lists
            let fow_list = self.active_fow_sprites.resolve();
            let sprite_lists_start = self.sprites_by_y_tile.resolve();
            let sprite_lists_end = self.sprites_by_y_tile_end.resolve();
            let y_tile = self.sprite_y(in_sprite) / 32;
            if y_tile >= 0x100 {
                error!("Sprite y tile was invalid: 0x{y_tile:x}");
                return None;
            }
            let sprite_list = bw::list::LinkedList {
                start: sprite_lists_start.add(y_tile as usize),
                end: sprite_lists_end.add(y_tile as usize),
            };
            let sprite_images = bw::list::LinkedList {
                start: &mut (*sprite.value()).first_image,
                end: &mut (*sprite.value()).last_image,
            };
            while let Some(image) = images.pop() {
                image.move_to(&sprite_images);
            }
            sprite.move_to(&sprite_list);
            fow.move_to(&fow_list);
            Some(())
        }
    }

    unsafe fn sprite_x(&self, sprite: *mut scr::Sprite) -> i16 {
        unsafe {
            let ptr = sprite as usize + self.sprite_x.1 as usize;
            let value = match self.sprite_x.2 {
                scarf::MemAccessSize::Mem8 => (ptr as *mut u8).read_unaligned() as usize,
                scarf::MemAccessSize::Mem16 => (ptr as *mut u16).read_unaligned() as usize,
                scarf::MemAccessSize::Mem32 => (ptr as *mut u32).read_unaligned() as usize,
                scarf::MemAccessSize::Mem64 => (ptr as *mut u64).read_unaligned() as usize,
            };
            self.sprite_x.0.resolve_with_custom(&[value]) as i16
        }
    }

    unsafe fn sprite_y(&self, sprite: *mut scr::Sprite) -> i16 {
        unsafe {
            let ptr = sprite as usize + self.sprite_y.1 as usize;
            let value = match self.sprite_y.2 {
                scarf::MemAccessSize::Mem8 => (ptr as *mut u8).read_unaligned() as usize,
                scarf::MemAccessSize::Mem16 => (ptr as *mut u16).read_unaligned() as usize,
                scarf::MemAccessSize::Mem32 => (ptr as *mut u32).read_unaligned() as usize,
                scarf::MemAccessSize::Mem64 => (ptr as *mut u64).read_unaligned() as usize,
            };
            self.sprite_y.0.resolve_with_custom(&[value]) as i16
        }
    }

    unsafe fn register_possible_replay_handle(&self, handle: *mut c_void) {
        self.open_replay_file_count.fetch_add(1, Ordering::Relaxed);
        self.open_replay_files.lock().push(SendPtr(handle));
    }

    unsafe fn check_replay_file_finish(&self, handle: *mut c_void) {
        unsafe {
            if self.open_replay_file_count.load(Ordering::Relaxed) == 0 {
                return;
            }
            let mut open_files = self.open_replay_files.lock();
            match open_files.iter().position(|x| x.0 == handle) {
                Some(i) => {
                    open_files.swap_remove(i);
                    self.open_replay_file_count.fetch_sub(1, Ordering::Relaxed);
                }
                None => return,
            };
            drop(open_files);

            if crate::replay::has_replay_magic_bytes(handle) {
                let result = crate::replay::add_shieldbattery_data(
                    handle,
                    self,
                    self.exe_build,
                    game_thread::setup_info().unwrap(),
                    game_thread::player_id_mapping(),
                );
                if let Err(e) = result {
                    error!("Unable to write extended replay data: {e}");
                }
            }
        }
    }

    /// Generic over scr::GameInfoValue and scr::GameInfoValueOld to support different versions
    /// in case blizzard is being indecisive.
    unsafe fn build_join_game_params<T: GameInfoValueTrait>(
        &self,
        input_game_info: &mut bw::BwGameData,
        is_eud: bool,
        options: LobbyOptions,
    ) -> bw_hash_table::HashTable<scr::BwString, T> {
        unsafe {
            let mut params = bw_hash_table::HashTable::<scr::BwString, T>::new(0x20);
            let mut add_param = |key: &[u8], value: u32| {
                let mut string: scr::BwString = mem::zeroed();
                init_bw_string(&mut string, key);
                let mut value = T::from_u32(value);
                params.insert(&mut string, &mut value);
            };
            add_param(b"save_game_id", input_game_info.save_checksum);
            add_param(b"is_replay", input_game_info.is_replay as u32);
            // Can lie for most of these player counts
            add_param(b"players_current", 1);
            add_param(b"players_max", input_game_info.max_player_count as u32);
            add_param(b"observers_current", 0);
            add_param(b"observers_max", 0);
            add_param(b"players_ai", 0);
            add_param(b"closed_slots", 0);
            add_param(b"proxy", 0);
            add_param(b"game_speed", input_game_info.game_speed as u32);
            add_param(b"map_tile_set", input_game_info.tileset as u32);
            add_param(b"map_width", input_game_info.map_width as u32);
            add_param(b"map_height", input_game_info.map_height as u32);
            add_param(b"net_turn_rate", options.turn_rate);
            // Flag 0x4 = Old limits, 0x10 = EUD
            let flags = if options.game_type.is_ums() && is_eud {
                0x14
            } else if options.use_legacy_limits {
                0x4
            } else {
                0x0
            };
            add_param(b"flags", flags);

            let mut add_param_string = |key: &[u8], value_str: &[u8]| {
                let mut string: scr::BwString = mem::zeroed();
                init_bw_string(&mut string, key);
                let mut value: T = mem::zeroed();
                T::from_string(&mut value, value_str);
                params.insert(&mut string, &mut value);
            };
            let host_name_length = input_game_info
                .game_creator
                .iter()
                .position(|&x| x == 0)
                .unwrap_or(input_game_info.game_creator.len());
            add_param_string(
                b"host_name",
                &input_game_info.game_creator[..host_name_length],
            );
            let map_name_length = input_game_info
                .map_name
                .iter()
                .position(|&x| x == 0)
                .unwrap_or(input_game_info.map_name.len());
            add_param_string(b"map_name", &input_game_info.map_name[..map_name_length]);
            params
        }
    }

    unsafe fn check_player_drops(&self) -> Option<Vec<u8>> {
        unsafe {
            let mut result = None;
            let mut dropped_players = self.dropped_players.load(Ordering::Relaxed);
            for (i, _) in self
                .storm_player_flags()
                .iter()
                .enumerate()
                .filter(|x| *x.1 == 0x1_0000)
            {
                if dropped_players & (1 << i) == 0 {
                    dropped_players |= 1 << i;
                    result.get_or_insert_with(Vec::new).push(i as u8);
                    self.dropped_players
                        .store(dropped_players, Ordering::Relaxed);
                }
            }
            result
        }
    }

    /// This function should reset any state that affects synced gameplay logic to what
    /// it is on game init.
    ///
    /// This is currently being called on as early as possible, before game_loop() call,
    /// but if any later additions need to initialize state based on BW state, it could
    /// be moved to be called at init_game_data, init_unit_data, or other later initialization
    /// hooks too.
    ///
    /// The only case where this may be called more than once is when the user
    /// seeks replay backwards and it has to be simulated from start over again, so
    /// we don't need to and shouldn't reset any network state.
    fn reset_state_for_game_init(&self) {
        self.detection_status_copy.lock().clear();
        self.first_game_logic_frame_done
            .store(false, Ordering::Relaxed);
        if let Some(mut apm) = self.apm_state.lock() {
            *apm = ApmStats::new();
        }
    }

    fn resolve_first_dialog(&self) -> Option<bw_dat::dialog::Dialog> {
        unsafe {
            self.first_dialog
                .map(|x| x.resolve())
                .filter(|x| !x.is_null())
                .map(|x| bw_dat::dialog::Dialog::new(x))
        }
    }

    fn is_replay_or_obs(&self) -> bool {
        unsafe { self.is_replay.resolve() != 0 || self.local_unique_player_id.resolve() >= 0x80 }
    }

    /// Sets [game_results_sent] atomically, returning whether the results need to be sent by the
    /// caller.
    pub fn trigger_game_results_sent(&self) -> bool {
        !self.game_results_sent.swap(true, Ordering::Relaxed)
    }

    /// Reads the current Shift+Tab minimap player-color mode, or `None` if the global wasn't located
    /// during analysis (or holds an unrecognized value). Only valid to call while a game is running.
    pub fn read_minimap_color_mode(&self) -> Option<MinimapColorMode> {
        self.minimap_color_mode
            .as_ref()
            .and_then(|value| MinimapColorMode::try_from(unsafe { value.resolve() }).ok())
    }

    /// Reads the current Tab minimap-terrain-hidden flag, or `None` if the global wasn't located
    /// during analysis. Only valid to call while a game is running.
    pub fn read_minimap_terrain_hidden(&self) -> Option<bool> {
        self.minimap_terrain_hidden
            .as_ref()
            .map(|value| unsafe { value.resolve() != 0 })
    }

    /// Reads BW's in-game chat send-scope byte (`chat_box_mode`), or `None` if the global wasn't
    /// located during analysis. Only meaningful while the chat box is open, which is the case at
    /// chat-send time.
    pub fn read_chat_box_mode(&self) -> Option<u8> {
        self.chat_box_mode
            .as_ref()
            .map(|value| unsafe { value.resolve() })
    }

    /// Applies the saved minimap color/terrain toggle values (from local settings) to the game's
    /// globals. Runs at most once per game; subsequent in-game toggles are left untouched. Should
    /// be called from the minimap dialog's init event, once the globals are valid. Globals that
    /// weren't located during analysis are skipped.
    ///
    /// When custom team colors are active the real color-mode global no longer carries the user's
    /// mode (it is pinned per virtual mode); the team-color mapping is reapplied here instead so it
    /// wins over the minimap init's own reset of the global. The terrain toggle is independent and
    /// is always restored as before.
    pub fn restore_minimap_settings(&self) {
        if self.minimap_settings_restored.swap(true, Ordering::Relaxed) {
            return;
        }
        if let Some(value) = self.minimap_terrain_hidden.as_ref() {
            let hidden = self.saved_minimap_terrain_hidden.load(Ordering::Acquire);
            unsafe { value.write(u8::from(hidden)) };
        }
        let guard = self.team_color_runtime.lock();
        if let Some(runtime) = guard.as_ref() {
            unsafe { self.apply_team_color_mode(runtime) };
        } else if let Some(value) = self.minimap_color_mode.as_ref() {
            let mode = self.saved_minimap_color_mode.load(Ordering::Acquire);
            unsafe { value.write(mode) };
        }
    }

    /// Runs BW's native player-color randomizer, then switches `use_rgb_colors` on so its colors
    /// render. Every playing slot defaults to the "random" color sentinel, so this assigns each a
    /// synced-random color drawn on the shared game seed (all clients agree with no network relay).
    /// BW's own game-start path skips this randomize call for SB sessions, leaving deterministic
    /// slot-order colors, so it's invoked here once game init has run and the RNG seed is set. A
    /// no-op (leaving BW's colors as-is) when the randomizer wasn't located during analysis. Runs
    /// before the custom team-color engine snapshots the color state, so that engine's non-preset
    /// modes restore this randomized baseline rather than slot-order colors.
    pub fn randomize_base_player_colors(&self) {
        if let Some(randomize) = self.randomize_player_colors {
            unsafe {
                randomize();
                self.use_rgb_colors.write(1);
            }
        }
    }

    /// Copies the local player's slot out of the applied-skin table, for relaying to peers. The
    /// slot index is `local_unique_player_id` — the `players[]` id the local player's units render
    /// under, and the one `init_game` filled from local settings/ownership — so this must only be
    /// called after game init has run. Returns `None` when the table wasn't located, or the local
    /// id isn't a table slot (never expected for a seated player or observer). The bytes are
    /// opaque; a player with no skins yields a mostly-zero blob, which is still relayed so every
    /// slot's table entry ends up identical on every client.
    pub fn read_local_skin_blob(&self) -> Option<Vec<u8>> {
        let table = self.skin_table.as_ref()?;
        unsafe {
            let slot = self.local_unique_player_id.resolve() as usize;
            if slot >= SKIN_TABLE_SLOTS {
                return None;
            }
            let base = table.base.resolve();
            if base.is_null() {
                return None;
            }
            Some(std::slice::from_raw_parts(base.add(slot * table.stride), table.stride).to_vec())
        }
    }

    /// Writes one peer's skin blob into `unique_player`'s slot of the applied-skin table, taking
    /// effect the next rendered frame. Returns `false` without writing when the table wasn't
    /// located, the slot index is out of table range, or `blob` isn't exactly one slot long —
    /// the sender reads whole slots, so any other length is a malformed or cross-version frame,
    /// and a partial write could leave a slot mixing two states rendering might parse.
    unsafe fn write_player_skin_blob(&self, unique_player: u8, blob: &[u8]) -> bool {
        let Some(table) = self.skin_table.as_ref() else {
            return false;
        };
        let slot = unique_player as usize;
        if slot >= SKIN_TABLE_SLOTS || blob.len() != table.stride {
            return false;
        }
        unsafe {
            let base = table.base.resolve();
            if base.is_null() {
                return false;
            }
            std::ptr::copy_nonoverlapping(blob.as_ptr(), base.add(slot * table.stride), blob.len());
        }
        true
    }

    /// Builds the team-color engine for this game if the feature is active, snapshots BW's original
    /// player colors, and applies the initial assignment. A no-op — leaving the untouched path in
    /// place — when the feature isn't configured, the game is UMS, the minimap color-mode global
    /// wasn't located, or the `rgb_colors` pointer is null. Runs once at game init on the game
    /// thread, after alliances are finalized.
    ///
    /// The feature drives colors regardless of whether BW ran with `use_rgb_colors` on: the modes
    /// that show custom colors force the switch on for the spans they apply to, so palette-index
    /// games (single-player, vs-AI, palette-mode replays) get custom colors too.
    pub fn init_team_colors(&self) {
        let Some(config) = self.team_color_config.lock().clone() else {
            return;
        };
        // UMS maps set player colors deliberately (CRGB / forces), so the feature stays off there.
        if game_thread::is_ums() {
            return;
        }
        // The color-mode global is the virtual-mode carrier; without it the mode machinery can't
        // run, so fall back to the untouched path.
        if self.minimap_color_mode.is_none() {
            return;
        }
        unsafe {
            let rgb_ptr = self.rgb_colors.resolve();
            if rgb_ptr.is_null() {
                warn!("rgb_colors pointer was null at team-color init");
                return;
            }
            // Captured before any mode is applied: the switch as BW ran the game, restored verbatim
            // by the modes that keep the native appearance.
            let original_use_rgb_colors = self.use_rgb_colors.resolve();
            let original_rgb_colors = *rgb_ptr;
            if original_rgb_colors
                .iter()
                .flatten()
                .all(|v| v.to_bits() == 0)
            {
                warn!(
                    "rgb_colors snapshot is entirely zero at team-color init; colors may be wrong"
                );
            }

            // Active players are players[] 0..8 whose in-game type is human (2) or computer (1).
            let players = self.players();
            let mut active_players = Vec::with_capacity(8);
            for i in 0..8u8 {
                if matches!((*players.add(i as usize)).player_type, 1 | 2) {
                    active_players.push(i);
                }
            }
            let local_player = if self.is_replay_or_obs() {
                None
            } else {
                // A seated player's id is always a real player slot; anything else would index
                // out of bounds in the assignment engine, so degrade to the seatless (static)
                // assignment instead of trusting it.
                let id = self.local_player_id.resolve();
                if id < 8 {
                    Some(id as u8)
                } else {
                    warn!("Local player id {id} out of player-slot range at team-color init");
                    None
                }
            };
            let game = self.game();
            let mut initial_allies = [[false; 8]; 8];
            for (a, row) in initial_allies.iter_mut().enumerate() {
                for (b, cell) in row.iter_mut().enumerate() {
                    *cell = (*game).alliances[a][b] != 0;
                }
            }
            let info = GameStartInfo {
                active_players,
                local_player,
                initial_allies,
            };
            let state = TeamColorState::new(config, &info, shuffle_seed());
            let virtual_mode =
                MinimapColorMode::try_from(self.saved_minimap_color_mode.load(Ordering::Acquire))
                    .unwrap_or_default();
            let local_alliance_row =
                local_player.map(|local| (local, initial_allies[local as usize]));
            let runtime = TeamColorRuntime {
                state,
                original_rgb_colors,
                original_use_rgb_colors,
                virtual_mode,
                local_alliance_row,
            };
            let mut guard = self.team_color_runtime.lock();
            *guard = Some(runtime);
            if let Some(runtime) = guard.as_ref() {
                self.apply_team_color_mode(runtime);
            }
        }
    }

    /// The active team-color virtual minimap mode, or `None` when the feature is inactive (the
    /// caller then reads BW's real global as before). Used at game exit to persist the mode the
    /// user actually sees rather than the pinned real-global value.
    pub fn team_color_virtual_mode(&self) -> Option<MinimapColorMode> {
        self.team_color_runtime
            .lock()
            .as_ref()
            .map(|runtime| runtime.virtual_mode)
    }

    /// Detects a Shift+Tab color-mode cycle by polling: BW cycles the real global (or forces it to
    /// 2 for observers) on the keypress, so any value other than the one pinned for the current
    /// virtual mode means the user cycled. Any unexpected value counts as exactly one forward step,
    /// after which the mapping is reapplied. Called every rendered frame; a no-op when the feature
    /// is inactive. Cycling never disturbs the engine's assignment/cursor state.
    unsafe fn poll_team_color_mode(&self) {
        unsafe {
            let mut guard = self.team_color_runtime.lock();
            let Some(runtime) = guard.as_mut() else {
                return;
            };
            let Some(global) = self.minimap_color_mode.as_ref() else {
                return;
            };
            if global.resolve() != self.pinned_real_mode(runtime.virtual_mode) {
                runtime.virtual_mode = next_minimap_mode(runtime.virtual_mode);
                self.apply_team_color_mode(runtime);
            }
        }
    }

    /// Reacts to a live change of the local player's outgoing alliance row (custom lobbies where
    /// players ally mid-game). Diffs the row, advances the engine, and rewrites `rgb_colors` when
    /// the assignment changed and colors are currently shown. Called after each `step_game`; a
    /// no-op when the feature is inactive or there is no local seat (observer/replay).
    unsafe fn update_team_colors_from_alliances(&self) {
        unsafe {
            let mut guard = self.team_color_runtime.lock();
            let Some(runtime) = guard.as_mut() else {
                return;
            };
            let Some((local, last_row)) = runtime.local_alliance_row else {
                return;
            };
            let game = self.game();
            let mut row = [false; 8];
            for (i, cell) in row.iter_mut().enumerate() {
                *cell = (*game).alliances[local as usize][i] != 0;
            }
            if row == last_row {
                return;
            }
            runtime.local_alliance_row = Some((local, row));
            let changed = runtime.state.update_local_alliances(&row);
            if changed && runtime.virtual_mode == MinimapColorMode::Preset {
                self.write_team_color_rgb(runtime);
            }
        }
    }

    /// The value the real `minimap_color_mode` global is pinned to for a given virtual mode.
    /// Standard and Preset both use BW's RGB path (real 0, our colors written / originals restored).
    /// Minimap-only pins real 0 when the three draw sites are hooked ([`minimap_draw_hooks`] is
    /// `Some`) — that keeps the dots on the `rgb_colors` read path the draw hooks feed — and falls
    /// back to real 1 (BW's own diplomacy dots) when any site is missing.
    ///
    /// [`minimap_draw_hooks`]: Self::minimap_draw_hooks
    fn pinned_real_mode(&self, mode: MinimapColorMode) -> u8 {
        match mode {
            MinimapColorMode::Standard | MinimapColorMode::Preset => 0,
            MinimapColorMode::PresetOnMinimapOnly => {
                if self.minimap_draw_hooks.is_some() {
                    0
                } else {
                    1
                }
            }
        }
    }

    /// Installs the minimap-only team-color assignment into `rgb_colors` for the span of one minimap
    /// dot draw, returning an RAII guard that restores the array's previous contents when dropped.
    /// Returns `None` (no swap) unless the feature is active in the
    /// [`PresetOnMinimapOnly`](MinimapColorMode::PresetOnMinimapOnly) virtual mode, so every other
    /// mode — and the inactive feature — draws from the untouched array.
    ///
    /// The three minimap draw functions each bracket their original call with this guard. The
    /// dispatcher draws the local player and lone sprites inline and calls the two per-player helpers
    /// for everyone else, so the guards nest: each saves and restores the *current* `rgb_colors`
    /// contents and `use_rgb_colors` switch, so an inner guard hands back exactly the state its
    /// caller installed and only the outermost guard restores BW's originals. Forcing the switch on
    /// makes the dot-draw sites read `rgb_colors` even when the game ran in palette-index mode. The
    /// swap is confined to the draw — outside it the array and switch hold their originals, so unit
    /// colors stay untouched and only the minimap dots read the assignment. The runtime lock is
    /// released before the guard is returned, so the nested draws can re-acquire it. No heap
    /// allocation: the saved copy lives in the returned guard on the caller's stack.
    fn begin_minimap_team_colors(&self) -> Option<MinimapColorSwap> {
        let assignment = {
            let guard = self.team_color_runtime.lock();
            let runtime = guard.as_ref()?;
            if runtime.virtual_mode != MinimapColorMode::PresetOnMinimapOnly {
                return None;
            }
            let mut out = runtime.original_rgb_colors;
            for (slot, color) in runtime.state.colors().iter().enumerate() {
                if let Some(color) = color {
                    out[slot] = *color;
                }
            }
            out
        };
        unsafe {
            let rgb_ptr = self.rgb_colors.resolve();
            if rgb_ptr.is_null() {
                return None;
            }
            let saved_rgb = *rgb_ptr;
            *rgb_ptr = assignment;
            let saved_use_rgb = self.use_rgb_colors.resolve();
            self.use_rgb_colors.write(1);
            Some(MinimapColorSwap {
                rgb_ptr,
                saved_rgb,
                use_rgb_colors: self.use_rgb_colors,
                saved_use_rgb,
            })
        }
    }

    /// Pins the real `minimap_color_mode` global and sets the `use_rgb_colors` switch and
    /// `rgb_colors` to match the runtime's current virtual mode. `Preset` forces the switch on and
    /// writes the computed assignment, so units read our colors regardless of how BW ran the game.
    /// The other modes restore BW's original switch and colors, reproducing the game's native
    /// appearance. Keeping the real global pinned per mode keeps BW's own diplomacy recolor from
    /// stomping our colors. Minimap-only leaves the originals in place here (units keep their real
    /// colors); its assignment, and the forced switch, are swapped in only for the span of each
    /// minimap draw hook.
    unsafe fn apply_team_color_mode(&self, runtime: &TeamColorRuntime) {
        unsafe {
            if let Some(global) = self.minimap_color_mode.as_ref() {
                global.write(self.pinned_real_mode(runtime.virtual_mode));
            }
            match runtime.virtual_mode {
                MinimapColorMode::Preset => {
                    self.use_rgb_colors.write(1);
                    self.write_team_color_rgb(runtime);
                }
                MinimapColorMode::Standard | MinimapColorMode::PresetOnMinimapOnly => {
                    self.use_rgb_colors.write(runtime.original_use_rgb_colors);
                    let rgb_ptr = self.rgb_colors.resolve();
                    if !rgb_ptr.is_null() {
                        *rgb_ptr = runtime.original_rgb_colors;
                    }
                }
            }
        }
    }

    /// Writes the engine's current assignment into `rgb_colors`, a full 8-slot write each time.
    /// Slots the engine leaves unassigned keep BW's original color from the init snapshot.
    unsafe fn write_team_color_rgb(&self, runtime: &TeamColorRuntime) {
        unsafe {
            let rgb_ptr = self.rgb_colors.resolve();
            if rgb_ptr.is_null() {
                return;
            }
            let colors = runtime.state.colors();
            let mut out = runtime.original_rgb_colors;
            for (slot, color) in colors.iter().enumerate() {
                if let Some(color) = color {
                    out[slot] = *color;
                }
            }
            *rgb_ptr = out;
        }
    }

    /// Saves a replay to the specified path. The path should be a valid filesystem path.
    /// Returns true if the replay was saved successfully.
    pub fn save_replay(&self, path: &str) -> bool {
        let Ok(path) = CString::new(path) else {
            error!("Replay path contained null byte");
            return false;
        };
        unsafe {
            // At this point, the replay header doesn't have the correct end frame set, so we have
            // to set that ourselves. This matches what SC:R does to save replays for crash dumps.
            let game = self.game();
            let replay_header = self.replay_header();
            let old_frame_count = (*replay_header).replay_end_frame;
            (*replay_header).replay_end_frame = (*game).frame_count;

            let result = (self.save_replay)(path.as_ptr());

            (*replay_header).replay_end_frame = old_frame_count;
            result != 0
        }
    }

    pub fn set_use_legacy_cursor_sizing(&self, use_legacy: bool) {
        self.use_legacy_cursor_sizing
            .store(use_legacy, Ordering::Release);
    }

    pub fn pathing(&self) -> *mut bw::Pathing {
        unsafe { self.pathing.resolve() }
    }

    pub fn rng_seed(&self) -> u32 {
        unsafe {
            // TODO(tec27): add analysis for this instead
            let seed = self.rng_seed.resolve_as_ptr();
            seed.add(1).read_unaligned()
        }
    }

    /// Look up the idea for a given sound. Note that unknown IDs will cause a crash.
    fn lookup_sound(&self, id: impl Into<String>) -> u32 {
        let id = id.into();
        let mut cache = self.sound_id_cache.lock();
        if let Some(sound_id) = cache.get(&id).copied() {
            return sound_id;
        }

        let result = unsafe {
            let mut id: SafeBwString = (&id).into();
            (self.lookup_sound_id)(id.borrow().as_ptr())
        };
        // NOTE(tec27): We could use this more as an LRU cache, but there's such a small number of
        // possible sounds that it doesn't really seem worth it to me.
        cache.insert(id, result);
        result
    }

    /// Plays the specified sound. These IDs can be found in rez/sfx.json in the game files.
    /// Unknown sound IDs will cause a crash.
    pub fn play_sound(&self, id: impl Into<String>) {
        unsafe {
            (self.play_sound)(
                self.lookup_sound(id),
                1.0, // volume
                std::ptr::null_mut(),
                std::ptr::null_mut(),
                std::ptr::null_mut(),
            );
        }
    }

    fn with_print_text_hooks_disabled(&self, f: impl FnOnce()) {
        self.print_text_hooks_disabled
            .fetch_add(1, Ordering::SeqCst);
        f();
        self.print_text_hooks_disabled
            .fetch_sub(1, Ordering::SeqCst);
    }

    /// Prints text as a chat message from no one.
    #[allow(dead_code)]
    pub fn print_text(&self, text: &CStr) {
        self.with_print_text_hooks_disabled(|| unsafe {
            (self.print_text)(text.as_ptr() as *const u8, 16, 0);
        });
    }

    /// Prints text as a chat message from the specified user (slot ID).
    #[allow(dead_code)]
    pub fn print_text_from_user(&self, text: &CStr, user: u32) {
        self.with_print_text_hooks_disabled(|| unsafe {
            (self.print_text)(text.as_ptr() as *const u8, user, 0);
        });
    }

    /// Prints centered text. This does not make a transmission sound like the other versions of
    /// print_text.
    #[allow(dead_code)]
    pub fn print_centered_text(&self, text: &CStr) {
        self.with_print_text_hooks_disabled(|| unsafe {
            (self.print_text)(text.as_ptr() as *const u8, u32::MAX, 0);
        });
    }

    /// Call with a chat message to possibly handle it if it contains a command. Returns whether it
    /// was handled (and if so, the message should be cleared and not sent).
    pub fn handle_chat_command(&self, text: &str) -> bool {
        self.chat_manager.lock().handle_send_chat(text)
    }

    pub fn init_chat_manager(
        &self,
        players: &[JoinedPlayer],
        local_user_id: SbUserId,
        blocked_users: &[SbUserId],
        is_chat_restricted: bool,
    ) {
        let mut chat_manager = self.chat_manager.lock();
        chat_manager.set_players(players);
        // Must be set before the blocked players so the local user can't end up blocked.
        chat_manager.set_local_player_info(local_user_id, is_chat_restricted);
        chat_manager.set_blocked_players(blocked_users);
    }

    pub fn snet_next_turn_sequence_number(&self) -> u16 {
        unsafe {
            if let Some(list) = self.snet_local_player_list {
                let list = list.resolve();
                let player = (*list).node.next;
                if player.addr() & 0x1 != 0 || player.addr() == 0 {
                    warn!("No local player connection for SNet???");
                    return u16::MAX;
                }
                // Class 2 are synced game commands
                (*player).next_seq_for_class[2]
            } else {
                u16::MAX
            }
        }
    }
}

#[allow(dead_code)]
#[derive(Copy, Clone)]
#[repr(u32)]
pub enum BwCursorType {
    Arrow = 0,
    Illegal = 1,
    TargetYellow = 2,
    TargetRed = 3,
    TargetGreen = 4,
    TargetNeutral = 5,
    SelectableGreen = 6,
    SelectableRed = 7,
    SelectableYellow = 8,
    Drag = 9,
    Time = 10,
    ScrollUp = 11,
    ScrollUpRight = 12,
    ScrollRight = 13,
    ScrollDownRight = 14,
    ScrollDown = 15,
    ScrollDownLeft = 16,
    ScrollLeft = 17,
    ScrollUpLeft = 18,
}

impl bw::Bw for BwScr {
    fn set_settings(&self, settings: &Settings) {
        let is_carbot = settings
            .scr
            .get("selectedSkin")
            .and_then(|x| x.as_str())
            .unwrap_or_else(|| {
                warn!("settings.scr.selectedSkin was not set");
                ""
            })
            == "carbot";
        let show_skins = settings
            .scr
            .get("showBonusSkins")
            .and_then(|x| x.as_bool())
            .unwrap_or_else(|| {
                warn!("settings.scr.showBonusSkins was not set");
                true
            });
        let starting_fog: StartingFog = settings
            .local
            .get("startingFog")
            .and_then(|x| serde_json::from_value(x.clone()).ok())
            .unwrap_or_default();
        let minimap_color_mode: MinimapColorMode = settings
            .local
            .get("minimapColorMode")
            .and_then(|x| serde_json::from_value(x.clone()).ok())
            .unwrap_or_default();
        let minimap_terrain_hidden = settings
            .local
            .get("minimapTerrainHidden")
            .and_then(|x| x.as_bool())
            .unwrap_or(false);
        let visualize_network_stalls = settings
            .local
            .get("visualizeNetworkStalls")
            .and_then(|x| x.as_bool())
            .unwrap_or(false);
        let disable_hd = settings
            .local
            .get("disableHd")
            .and_then(|x| x.as_bool())
            .unwrap_or(false);

        let use_custom_cursor_size = settings
            .local
            .get("useCustomCursorSize")
            .and_then(|x| x.as_bool())
            .unwrap_or(false);
        let custom_cursor_size = settings
            .local
            .get("customCursorSize")
            .and_then(|x| x.as_f64())
            .unwrap_or(0.25) as f32;

        self.is_carbot.store(is_carbot, Ordering::Release);
        self.show_skins.store(show_skins, Ordering::Release);
        self.starting_fog.store(starting_fog, Ordering::Release);
        self.saved_minimap_color_mode
            .store(minimap_color_mode as u8, Ordering::Release);
        self.saved_minimap_terrain_hidden
            .store(minimap_terrain_hidden, Ordering::Release);
        self.use_custom_cursor_size
            .store(use_custom_cursor_size, Ordering::Release);
        *self.custom_cursor_size.lock() = custom_cursor_size;

        *self.team_color_config.lock() =
            settings.team_colors.as_ref().and_then(|tc| tc.to_config());

        self.visualize_network_stalls
            .store(visualize_network_stalls, Ordering::Release);
        self.disable_hd.store(disable_hd, Ordering::Release);
        if disable_hd && settings.scr.get("hdGraphicsOn").and_then(|x| x.as_bool()) == Some(true) {
            // Obviously would be nice to have to have the app settings to notice this but
            // this check is trivial to add, and better than spending time on wondering why the
            // game crashed.
            panic!("Cannot disable HD and have HD graphics enabled at the same time");
        }

        let mut settings_file_path = self.settings_file_path.write();
        settings_file_path.clear();
        settings_file_path.push_str(&settings.settings_file_path);
    }

    unsafe fn run_game_loop(&self) {
        let turn_seq = self.snet_next_turn_sequence_number();
        debug!("Game loop running, turn seq {turn_seq}");
        unsafe {
            loop {
                self.reset_state_for_game_init();
                self.game_state.write(3); // Playing
                (self.game_loop)();
                // Replay seeking exits game loop and sets a bool for it to restart,
                // we don't have access to that bool but we hook the replay seek
                // command and set our own
                if !self.is_replay_seeking.load(Ordering::Relaxed) {
                    break;
                }
                self.is_replay_seeking.store(false, Ordering::Relaxed);
            }
        }
    }

    unsafe fn clean_up_for_exit(&self) {
        // TODO
    }

    unsafe fn init_sprites(&self) {
        unsafe {
            log_time("init_sprites", || (self.init_sprites)());
            self.sprites_inited.write(1);
            if let Some(init_rtl) = self.init_real_time_lighting {
                log_time("init_real_time_lighting", || init_rtl());
            }
        }
    }

    /// Sends/receives packets and steps the network, returning whether or not the network could
    /// be stepped (i.e. false => no new turns available/network stall).
    unsafe fn maybe_receive_turns(&self) -> bool {
        self.event_processing_lock.lock();

        let ret = unsafe {
            // NOTE: This is actually not the same function that 1161 calls, but one
            // level higher that also ends up handling any received commands.
            // I think there was an issue where maybe_receive_turns was being inlined
            // in some patches, making it not ideal function for SCR.
            // Due to this being a function that does more, we have to do extra synchronization
            // with do_lobby_game_init + try_finish_lobby_game_init that 1161 doesn't need to do.
            //
            // For SCR-1161 crossplay we'd have to make this part consistent across games.
            // I think using 1161's function here is hard, but it would be better for load times,
            // as this synchronization can add extra few hundred milliseconds to loads.

            // Also call snet recv/send functions which we usually call in step_io hook.
            // In some points where we expect maybe_receive_turns to advance networking state
            // during lobby init, the main thread isn't running it's usual event loop that
            // would call step_io.
            // Hopefully this doesn't have thread safety issues when called from the async thread..
            // Since the main thread isn't running it's normal loop at all, it's probably fine.
            if SNP_INITIALIZED.load(Ordering::Relaxed) {
                (self.snet_recv_packets)();
                (self.snet_send_packets)();
                (self.step_network)() != 0
            } else {
                // The SNP provider initializes once native create/join runs (create_lobby /
                // create_game_multiplayer), which hasn't necessarily happened yet at every point
                // this is called — report progress rather than treat a not-yet-initialized SNP as
                // a stall.
                true
            }
        };

        self.event_processing_lock.unlock();
        ret
    }

    unsafe fn init_game_network(&self) {
        unsafe { (self.init_game_network)(0) }
    }

    unsafe fn init_network_player_info(&self, storm_player_id: u32) {
        unsafe {
            (self.init_network_player_info)(storm_player_id, 0, 1, 5);
        }
    }

    unsafe fn ready_lobby_for_start(&self) {
        debug!("Readying lobby for start");
        unsafe {
            self.update_nation_and_human_ids();
            self.lobby_state.write(8);
        }
    }

    unsafe fn do_lobby_game_init(&self, seed: u32) {
        unsafe {
            let data = bw::LobbyGameInitData {
                game_init_command: 0x48,
                random_seed: seed,
                // TODO(tec27): deal with player bytes if we ever allow save games
                player_bytes: [8; 8],
            };
            let ptr = &data as *const bw::LobbyGameInitData as *const u8;
            let len = mem::size_of::<bw::LobbyGameInitData>();

            // Only the host (storm id 0) sends the lobby-init `0x48` record; peers receive it. The
            // seed is server-distributed, so every client hand-set its own lobby_state to 8 and the
            // record carries the same value everywhere — the host's send reaches peers over the
            // session's reliable lobby channel (the rp2 lobby seam when active, native Storm
            // otherwise), where their handle_lobby_init_0x48 accepts it (sender slot 0, lobby_state
            // 8). The ProcessLobbyCommands hook trips lobby_game_init_command_seen on every client,
            // so try_finish_lobby_game_init drives lobby_state → 9.
            //
            // This is a single send with no retry: once the seam accepts the bytes, the reliable
            // control stream plus the relay's per-session replay log guarantee delivery, so the only
            // loss window is a local submit failure with an effectively-dead driver — and a peer
            // stuck waiting for the record is bounded by the server's game-load timeout, which
            // cancels the whole load.
            let local_storm_id = self.local_storm_id.resolve();
            if local_storm_id == 0 {
                debug!(
                    "Sending lobby game init data: {:#x} {:#x} {:#x?} (lobby_state {})",
                    data.game_init_command,
                    seed,
                    data.player_bytes,
                    self.lobby_state.resolve(),
                );
                (self.send_command)(ptr, len);
            }
        }
    }

    unsafe fn try_finish_lobby_game_init(&self) -> bool {
        unsafe {
            if self.lobby_game_init_command_seen.load(Ordering::Relaxed) {
                self.lobby_state.write(9);
                true
            } else {
                false
            }
        }
    }

    unsafe fn create_lobby(
        &self,
        map_path: &Path,
        map_info: &MapInfo,
        lobby_name: &str,
        options: LobbyOptions,
    ) -> Result<(), bw::LobbyCreateError> {
        unsafe {
            let mut game_input: scr::GameInput = mem::zeroed();
            init_bw_string(&mut game_input.name, lobby_name.as_bytes());
            init_bw_string(&mut game_input.password, b"");
            game_input.speed = 6;
            game_input.game_type_subtype = options.game_type.as_u32();
            game_input.turn_rate = options.turn_rate;
            if options.use_legacy_limits {
                game_input.old_limits = 1;
            }

            if options.game_type.is_ums() {
                let is_eud = match map_info {
                    MapInfo::Replay(_) => false,
                    MapInfo::Game(game_map) => game_map.map_data.is_eud,
                };
                if is_eud {
                    game_input.old_limits = 1;
                    game_input.eud = 1;
                }
            }

            let map_dir = match map_path.parent() {
                Some(s) => s.into(),
                None => {
                    warn!(
                        "Assuming map '{}' is in current working directory",
                        map_path.display()
                    );
                    match std::env::current_dir() {
                        Ok(o) => o,
                        Err(_) => return Err(bw::LobbyCreateError::MapNotFound),
                    }
                }
            };
            let map_dir = match map_dir.to_str() {
                Some(s) => s,
                None => return Err(bw::LobbyCreateError::MapNotFound),
            };
            let map_file = match map_path.file_name().and_then(|x| x.to_str()) {
                Some(s) => s,
                None => return Err(bw::LobbyCreateError::MapNotFound),
            };

            let mut map_dir: Vec<u8> = map_dir.as_bytes().into();
            if map_dir.last().cloned() != Some(b'\\') {
                // BW does just dir.append(filename), so dir must have a trailing backslash
                map_dir.push(b'\\');
            }

            let mut entry: scr::MapDirEntry = mem::zeroed();
            init_bw_string(&mut entry.filename, map_file.as_bytes());
            init_bw_string(&mut entry.title, b"");
            init_bw_string(&mut entry.description, b"");
            init_bw_string(&mut entry.error_message, b"");
            init_bw_string(&mut entry.unk90, b"");
            init_bw_string(&mut entry.unkac, b"");
            init_bw_string(&mut entry.unkc8, b"");
            init_bw_string(&mut entry.path_directory, &map_dir);
            init_bw_string(&mut entry.path_filename, map_file.as_bytes());
            entry.unk_linked_list[1] = entry.unk_linked_list.as_ptr() as usize;
            let is_replay = map_path
                .extension()
                .and_then(|ext| ext.to_str())
                .filter(|&ext| ext == "rep")
                .is_some();

            entry.flags = if is_replay {
                0x4
            } else {
                // Map
                0x2
            };

            let mut vtable = scr::LobbyDialogVtable {
                functions: [0usize; 0x50],
            };
            vtable.functions[self.lobby_create_callback_offset / mem::size_of::<usize>()] =
                lobby_create_callback as *const () as usize;

            let mut object: *const scr::LobbyDialogVtable = &vtable;
            let result = log_time("select_map_entry", || {
                (self.select_map_entry)(&mut game_input, &mut object, &mut entry)
            });
            if entry.error != 0 {
                let error = std::ffi::CStr::from_ptr(entry.error_message.pointer as *const i8)
                    .to_string_lossy();
                return Err(bw::LobbyCreateError::Other(error.into()));
            }
            if result != 0 {
                // The error check above should have already failed, but check return code
                // as well, struct offsets may change and we may miss the error.
                return Err(bw::LobbyCreateError::from_error_code(result));
            }
            log_time("init_game_network", || (self.init_game_network)(0));
            Ok(())
        }
    }

    unsafe fn join_lobby(
        &self,
        input_game_info: &mut bw::BwGameData,
        is_eud: bool,
        options: LobbyOptions,
        map_path: &CStr,
        address: std::net::Ipv4Addr,
    ) -> Result<(), u32> {
        unsafe {
            // The GameInfoValue struct is being changed on the newer versions that keeps
            // getting rolled back.. Keep support for both versions.
            let params = if self.uses_new_join_param_variant {
                self.build_join_game_params::<scr::GameInfoValue>(input_game_info, is_eud, options)
            } else {
                // HashTable itself has same layout regardless of which values it contains,
                // so this kind of cast is fine. Only BW is going to read params after this,
                // we can treat it as just bunch of bytes.
                // Well.. mostly. Technically the destructor at the end of this function
                // is dropping the HashTable, but scr::GameInfoValue doesn't have any destructors
                // now so it is fine. We just leak the few strings that we have.
                // Should remove this branch at some point anyway, once we're sure we don't need
                // to support 9411.
                mem::transmute(self.build_join_game_params::<scr::GameInfoValueOld>(
                    input_game_info,
                    is_eud,
                    options,
                ))
            };

            let mut game_info = scr::JoinableGameInfo {
                params: params.bw_table(),
                // AF_INET
                sockaddr_family: 2,
                port: 6112u16.to_be(),
                ip: address.octets(),
                // I don't think this gets read at any point, we skip past the part where
                // BW would register a game id in its global structures.
                // Just set this to some clearly invalid value.
                game_id: 0x1234_1234_1234_1234,
                // This game type enum is mostly offset by -1 for some reason, TvB is -2..
                // Hence "new" game type
                new_game_type: match input_game_info.game_type {
                    0xf => 0xd,
                    x => x as u32 - 1,
                },
                game_subtype: input_game_info.game_subtype as u32,
                // SEXP
                product_id: 0x53455850,
                game_version: 0xe9,
                ..mem::zeroed()
            };
            init_bw_string(&mut game_info.game_name, &input_game_info.name);
            let mut password: scr::BwString = mem::zeroed();
            init_bw_string(&mut password, b"");
            self.storm_set_last_error(0);
            let error = log_time("join_game", || {
                (self.join_game)(&mut game_info, &mut password, 0)
            });
            if error != 0 {
                // Try storm error first, if it's 0 then use the returned error.
                let storm_error = self.storm_last_error();
                if storm_error != 0 {
                    return Err(self.storm_last_error());
                } else {
                    return Err(error);
                }
            }
            debug!("Joined game");

            // Needs to be at least 0x24 bytes, but adding some buffer space in case the
            // output struct changes.
            let mut out = [0u32; 0x10];
            self.storm_set_last_error(0);
            let ok = (self.init_map_from_path)(
                map_path.as_ptr() as *const u8,
                out.as_mut_ptr() as *mut c_void,
                0,
                0,
            );
            if ok == 0 {
                let error = self.storm_last_error();
                error!("init_map_from_path failed: {error:08x}");
                return Err(error);
            }
            self.init_team_game_playable_slots();
            Ok(())
        }
    }

    unsafe fn remaining_game_init(&self, name_in: &str) {
        unsafe {
            let local_player_name = self.local_player_name.resolve();
            let local_player_name = std::slice::from_raw_parts_mut(local_player_name, 25);
            let name = name_in.as_bytes();
            for (&input, out) in name.iter().zip(local_player_name.iter_mut()) {
                *out = input;
            }
            // This kind of init_storm_networking call wasn't needed (Did it even exist?) in 1.16.1,
            // would be interesting to know/verify what code loaded the SNP list there.
            (self.init_storm_networking)();
            let ok = (self.choose_snp)(crate::snp::PROVIDER_ID);
            if ok == 0 {
                panic!("Failed to select SNP");
            }
            self.is_multiplayer.write(1);
        }
    }

    unsafe fn create_local_storm_session(
        &self,
        game_name: &CStr,
        local_player_name: &CStr,
        slot_count: u32,
    ) -> Result<u32, u32> {
        unsafe {
            // Storm writes the created session's local player id here. A fresh session with no
            // network peers always yields 0; the caller overwrites the roster slot afterward.
            let mut out_storm_id: u32 = 0;
            // Copied synchronously into a Storm global that only feeds game-list broadcasts. It is
            // never read while a LOCAL session with no peers is running, so zeroed content is safe.
            let mut scratch = [0u8; 0xa8];
            self.storm_set_last_error(0);
            let ok = (self.storm_create_game)(
                game_name.as_ptr() as *const u8,
                ptr::null(),
                ptr::null(),
                0,
                0,
                0,
                ptr::null(),
                0,
                slot_count,
                0,
                local_player_name.as_ptr() as *const u8,
                ptr::null(),
                &mut out_storm_id,
                scratch.as_mut_ptr() as *mut c_void,
                0,
            );
            if ok == 0 {
                let error = self.storm_last_error();
                error!("storm_create_game failed: {error:08x}");
                return Err(error);
            }
            self.in_lobby_or_game.write(1);
            Ok(out_storm_id)
        }
    }

    unsafe fn set_lobby_state(&self, state: u8) {
        unsafe {
            self.lobby_state.write(state);
        }
    }

    unsafe fn lobby_state(&self) -> u8 {
        unsafe { self.lobby_state.resolve() }
    }

    unsafe fn local_storm_id(&self) -> u32 {
        unsafe { self.local_storm_id.resolve() }
    }

    unsafe fn game(&self) -> *mut bw::Game {
        unsafe { self.game.resolve() }
    }

    unsafe fn game_data(&self) -> *mut bw::BwGameData {
        unsafe { self.game_data.resolve() }
    }

    unsafe fn players(&self) -> *mut bw::Player {
        unsafe { self.players.resolve() }
    }

    unsafe fn replay_data(&self) -> *mut bw::ReplayData {
        unsafe { self.replay_data.resolve() }
    }

    unsafe fn replay_header(&self) -> *mut bw::ReplayHeader {
        unsafe { self.replay_header.resolve() }
    }

    fn game_command_lengths(&self) -> &[u32] {
        &self.game_command_lengths
    }

    unsafe fn process_replay_commands(&self, commands: &[u8], storm_player: StormPlayerId) {
        unsafe {
            let Some(unique_player) = self.unique_player_for_storm(storm_player) else {
                return;
            };
            let game_player = self.command_game_player(unique_player);
            self.command_user.write(game_player as u32);
            self.unique_command_user.write(unique_player as u32);
            self.enable_rng.write(1);
            (self.process_game_commands)(commands.as_ptr(), commands.len(), 1);
            self.command_user.write(self.local_player_id.resolve());
            self.unique_command_user
                .write(self.local_unique_player_id.resolve());
            self.enable_rng.write(0);
        }
    }

    unsafe fn replay_visions(&self) -> bw::ReplayVisions {
        unsafe {
            bw::ReplayVisions {
                show_entire_map: self.replay_show_entire_map.resolve() != 0,
                players: self.replay_visions.resolve(),
            }
        }
    }

    unsafe fn set_player_name(&self, id: u8, name: &str) {
        unsafe {
            let mut buffer = [0; 0x60];
            for (i, &byte) in name.as_bytes().iter().take(0x5f).enumerate() {
                buffer[i] = byte;
            }
            // SCR has longer player names after the bw::Player array,
            // which are ones that it (mostly?) uses.
            let players = self.players();
            (*players.add(id as usize))
                .name
                .copy_from_slice(&buffer[..25]);
            let player_names = players.add(0x10) as *mut u8;
            let long_name = player_names.add(id as usize * 0x60);
            let long_name = std::slice::from_raw_parts_mut(long_name, 0x60);
            long_name.copy_from_slice(&buffer[..0x60]);
        }
    }

    unsafe fn active_units(&self) -> UnitIterator {
        unsafe { UnitIterator::new(Unit::from_ptr(self.first_active_unit.resolve())) }
    }

    unsafe fn fow_sprites(&self) -> FowSpriteIterator {
        unsafe { FowSpriteIterator::new(self.active_fow_sprites.start.resolve()) }
    }

    unsafe fn create_fow_sprite(&self, unit: Unit) {
        unsafe {
            self.create_fow_sprite_main(unit);
        }
    }

    unsafe fn sprite_position(&self, sprite: *mut c_void) -> bw::Point {
        unsafe {
            let sprite = sprite as *mut scr::Sprite;
            bw::Point {
                x: self.sprite_x(sprite),
                y: self.sprite_y(sprite),
            }
        }
    }

    unsafe fn client_selection(&self) -> [Option<Unit>; 12] {
        unsafe {
            let selection = self.client_selection.resolve();
            let mut out = [None; 12];
            for (i, item) in out.iter_mut().enumerate() {
                *item = Unit::from_ptr(*selection.add(i));
            }
            out
        }
    }

    unsafe fn storm_player_flags(&self) -> Vec<u32> {
        unsafe {
            let ptr = self.storm_player_flags.resolve() as *const u32;
            std::slice::from_raw_parts(ptr, NET_PLAYER_COUNT).into()
        }
    }

    unsafe fn storm_set_last_error(&self, error: u32) {
        unsafe {
            *self.storm_last_error_ptr() = error;
        }
    }

    unsafe fn alloc(&self, size: usize) -> *mut u8 {
        unsafe {
            let allocator = self.allocator.resolve();
            (*(*allocator).vtable).alloc.call3(allocator, size, 8)
        }
    }

    unsafe fn free(&self, ptr: *mut u8) {
        unsafe {
            let allocator = self.allocator.resolve();
            (*(*allocator).vtable).free.call2(allocator, ptr)
        }
    }

    unsafe fn call_original_status_screen_fn(&self, unit_id: UnitId, dialog: *mut bw::Dialog) {
        unsafe {
            if let Some(&func) = self.original_status_screen_update.get(unit_id.0 as usize) {
                func(dialog);
            }
        }
    }

    unsafe fn is_network_ready(&self) -> bool {
        unsafe { self.is_network_ready.resolve() != 0 }
    }

    unsafe fn set_user_latency(&self, latency: UserLatency) {
        unsafe {
            self.net_user_latency.write(match latency {
                UserLatency::Low => 0,
                UserLatency::High => 1,
                UserLatency::ExtraHigh => 2,
            });
        }
    }

    unsafe fn window_proc_hook(
        &self,
        window: HWND,
        msg: u32,
        wparam: usize,
        lparam: isize,
    ) -> Option<isize> {
        unsafe {
            let mut render_state = match self.render_state.lock() {
                Some(s) => s,
                None => {
                    warn!(
                        "Recursive window proc call?, not passing message {msg:x} to overlay state"
                    );
                    return None;
                }
            };
            render_state
                .overlay
                .window_proc(window, msg, wparam, lparam)
        }
    }

    fn starting_fog(&self) -> StartingFog {
        self.starting_fog.load(Ordering::Acquire)
    }
}

fn init_bw_dat(analysis: &mut scr_analysis::Analysis<'_>) -> Result<(), &'static str> {
    unsafe fn copy_dat_table(
        table: &scr_analysis::DatTablePtr<'_>,
        out: &mut Vec<bw::DatTable>,
        entries: usize,
    ) {
        unsafe {
            // Dat tables in SC:R memory have at least one extra field, bw_dat expects
            // 1.16.1 compatible format.
            let mut value = resolve_operand(table.address, &[]) as *const u8;
            for _ in 0..entries {
                let bw_table = value as *mut bw::DatTable;
                out.push(bw::DatTable {
                    data: (*bw_table).data,
                    entry_size: (*bw_table).entry_size,
                    entries: (*bw_table).entries,
                });
                value = value.add(table.entry_size as usize);
            }
        }
    }

    let units = analysis.dat_table(DatType::Units).ok_or("units.dat")?;
    let weapons = analysis.dat_table(DatType::Weapons).ok_or("weapons.dat")?;
    let upgrades = analysis
        .dat_table(DatType::Upgrades)
        .ok_or("upgrades.dat")?;
    let techdata = analysis
        .dat_table(DatType::TechData)
        .ok_or("techdata.dat")?;
    let orders = analysis.dat_table(DatType::Orders).ok_or("orders.dat")?;
    let mut out = Vec::with_capacity(0x36 + 0x18 + 0xc + 0xb + 0x13);
    unsafe {
        copy_dat_table(&units, &mut out, 0x36);
        copy_dat_table(&weapons, &mut out, 0x18);
        copy_dat_table(&upgrades, &mut out, 0xc);
        copy_dat_table(&techdata, &mut out, 0xb);
        copy_dat_table(&orders, &mut out, 0x13);
        let mut table = out.leak().as_ptr();
        bw_dat::init_units(table, 0x36);
        table = table.add(0x36);
        bw_dat::init_weapons(table, 0x18);
        table = table.add(0x18);
        bw_dat::init_upgrades(table, 0xc);
        table = table.add(0xc);
        bw_dat::init_techdata(table, 0xb);
        table = table.add(0xb);
        bw_dat::init_orders(table, 0x13);
        bw_dat::set_is_scr(true);
        bw_dat::set_bw_malloc(bw_malloc, bw_free);
    }
    Ok(())
}

unsafe extern "C" fn bw_malloc(size: usize) -> *mut u8 {
    unsafe { bw::get_bw().alloc(size) }
}

unsafe extern "C" fn bw_free(ptr: *mut u8) {
    unsafe { bw::get_bw().free(ptr) }
}

fn get_exe_build() -> u32 {
    let exe_path = windows::module_name(std::ptr::null_mut()).expect("Couldn't get exe path");
    match windows::version::get_version(Path::new(&exe_path)) {
        Some(s) => s.3 as u32,
        None => 0,
    }
}

fn create_event_hook(
    security: *mut c_void,
    init_state: u32,
    manual_reset: u32,
    name: *const u16,
    orig: unsafe extern "C" fn(*mut c_void, u32, u32, *const u16) -> *mut c_void,
) -> *mut c_void {
    unsafe {
        if !name.is_null() {
            let name_len = (0..).find(|&i| *name.add(i) == 0).unwrap();
            let name = std::slice::from_raw_parts(name, name_len);
            if ascii_compare_u16_u8(name, b"Starcraft Check For Other Instances") {
                // BW just checks last error to be ERROR_ALREADY_EXISTS
                SetLastError(0);
                return null_mut();
            }
        }
        orig(security, init_state, manual_reset, name)
    }
}

fn get_file_attributes_hook(
    bw: &BwScr,
    filename: *const u16,
    orig: unsafe extern "C" fn(*const u16) -> u32,
) -> u32 {
    // Using functions that call orig to both not trigger more hooks
    // and avoid the fact that rust Path functions actually call CreateFileW which
    // may be slightly different.
    // This matches what bw does.
    let is_dir = move |path: &Path| {
        let buf = windows::winapi_str(path);
        let ret = unsafe { orig(buf.as_ptr()) };
        ret != INVALID_FILE_ATTRIBUTES && ret & FILE_ATTRIBUTE_DIRECTORY != 0
    };
    let is_file = move |path: &Path| {
        let buf = windows::winapi_str(path);
        let ret = unsafe { orig(buf.as_ptr()) };
        ret != INVALID_FILE_ATTRIBUTES && ret & FILE_ATTRIBUTE_DIRECTORY == 0
    };
    unsafe {
        if !filename.is_null() {
            let name_len = (0..).find(|&i| *filename.add(i) == 0).unwrap();
            let filename = std::slice::from_raw_parts(filename, name_len);
            if check_filename(filename, b"CSettings.json") {
                let replacement = bw.settings_file_path.read();
                if replacement.is_empty() {
                    error!("Replacement settings file path not set")
                } else {
                    debug!("Mapping CSettings.json GetFileAttributesW call to {replacement}");
                    return orig(windows::winapi_str(&*replacement).as_ptr());
                }
            } else if check_dir_filename(filename, b"Battle.net") {
                stop_precise_system_time_hook();
            } else if check_dir_filename(filename, b"Maps") {
                // SC:R determines location of CASC data by first finding a directory
                // which has either
                //      - subdirectory "Maps"
                //      - file ".build.info"
                // The lookup order , where "." is exe directory, is:
                // 1) "."
                // 2) ".."
                // 3) "../Data"
                // 4) "../../Data"
                // 5) "../../../Data"
                // Since exe is in x86/ or x86_64/ subdir, 1) is something that is not supposed
                // to match, and if it does then the game won't find the actual data that
                // is supposed to be in 2).
                //
                // If for some(*) reason, there is a directory that contains Maps, StarCraft.exe,
                // but not .build.info, we will just say that such directory doesn't exist at all.
                //
                // (*) SHGetFolderPathW may fail for some users for reasons not understood,
                // which causes game to fallback into using exe dir as documents path, creating
                // Maps directory there.
                let mut path = PathBuf::from(OsString::from_wide(filename));
                if is_dir(&path) {
                    path.set_file_name("StarCraft.exe");
                    if is_file(&path) {
                        path.set_file_name(".build.info");
                        if !is_file(&path) {
                            warn!("Maps dir found relative to game exe");
                            return INVALID_FILE_ATTRIBUTES;
                        }
                    }
                }
            }
        }

        orig(filename)
    }
}

fn create_file_hook(
    bw: &BwScr,
    filename_ptr: *const u16,
    access: u32,
    share: u32,
    security: *mut c_void,
    creation_disposition: u32,
    flags: u32,
    template: *mut c_void,
    orig: unsafe extern "C" fn(
        *const u16,
        u32,
        u32,
        *mut c_void,
        u32,
        u32,
        *mut c_void,
    ) -> *mut c_void,
) -> *mut c_void {
    use winapi::um::fileapi::{CREATE_ALWAYS, CREATE_NEW};
    use winapi::um::winnt::GENERIC_READ;
    unsafe {
        let mut is_replay = false;
        let mut access = access;
        let mut needs_time_hook = false;
        let filename = match filename_ptr.is_null() {
            true => None,
            false => {
                let name_len = (0..).find(|&i| *filename_ptr.add(i) == 0).unwrap();
                Some(std::slice::from_raw_parts(filename_ptr, name_len))
            }
        };
        if let Some(filename) = filename {
            // Check for creating a replay file. (We add more data to it after BW has done
            // writing it)
            //
            // SC:R currently creates the file as LastReplay.rep, and then copies
            // it to the second autosave place after writing it.
            // But, to be future-proof (paranoid) against it possibly being refactored,
            // accept any file ending with .rep and check for magic bytes when at CloseHandle
            // hook.
            if creation_disposition == CREATE_ALWAYS {
                let ext = Some(()).and_then(|()| filename.get(filename.len().checked_sub(4)?..));
                if let Some(ext) = ext {
                    is_replay = ascii_compare_u16_u8_casei(ext, b".rep");
                    if is_replay {
                        // To read the replay magic bytes at CloseHandle hook,
                        // we'll need read access to the newly created file as well.
                        // Can't think of any issues this extra flag may cause..
                        access |= GENERIC_READ;
                    }
                }
            }

            if !is_replay {
                // Check if this is for CSettings.json and redirect it to our own file instead
                if check_filename(filename, b"CSettings.json") {
                    let replacement = bw.settings_file_path.read();
                    if replacement.is_empty() {
                        error!("Replacement settings file path not set")
                    } else {
                        debug!("Mapping CSettings.json CreateFile call to {replacement}");
                        return orig(
                            windows::winapi_str(&*replacement).as_ptr(),
                            access,
                            share,
                            security,
                            creation_disposition,
                            flags,
                            template,
                        );
                    }
                }

                // Redirect CASC log to our log directory.
                if check_filename(filename, b"SCR-NGDP-DiagnosticLog.txt") {
                    let args = crate::parse_args();
                    let replacement = args.user_data_path.join("logs/SCR-NGDP-DiagnosticLog.txt");
                    return orig(
                        windows::winapi_str(&replacement).as_ptr(),
                        access,
                        share,
                        security,
                        creation_disposition,
                        flags,
                        template,
                    );
                }

                // Check for CASC repair marker. If trying to read, just pretend it doesn't
                // exits. If trying to create (SC:R thought that the installation is broken),
                // exit without creating the file (Hopefully the crash dump will have some
                // information on the issue if it is our fault).
                if check_filename(filename, b"CascRepair.mrk") {
                    if matches!(creation_disposition, CREATE_ALWAYS | CREATE_NEW) {
                        panic!("Unable to read CASC archive, may have to repair installation");
                    } else {
                        SetLastError(winapi::shared::winerror::ERROR_FILE_NOT_FOUND);
                        return -1isize as *mut c_void;
                    }
                } else if check_filename(filename, b"cookie.bin") {
                    needs_time_hook = true;
                } else if check_filename(filename, b"Agent.dat") {
                    // Should happen earlier, but just in case
                    stop_precise_system_time_hook();
                }
            }
        }
        let handle = orig(
            filename_ptr,
            access,
            share,
            security,
            creation_disposition,
            flags,
            template,
        );
        if handle != -1isize as *mut c_void && is_replay {
            bw.register_possible_replay_handle(handle);
        }
        if handle == -1isize as *mut c_void
            && let Some(filename) = filename
        {
            // Log failures outside few expected cases, as CreateFileW failing is
            // mostly unexpected, even if the caller is able to handle them.
            // Expected errors that show up still in logging are telemetry & replay saving
            // related, skipping those gets too inconvenient to do.
            let error = GetLastError();
            let skip =
                check_filename(filename, b"CONOUT$") || check_filename(filename, b"cookie.bin");
            if !skip {
                debug!(
                    "CreateFileW for '{}' with params {access:x} {share:x} \
                        {creation_disposition:x} {flags:x} failed with code {error}",
                    windows::os_string_from_winapi(filename).display(),
                );
                // Logging may have written over last error, so set it again
                SetLastError(error);
            }
        }
        if handle != -1isize as *mut c_void && needs_time_hook {
            start_precise_system_time_hook();
        }

        handle
    }
}

fn check_filename(filename: &[u16], compare: &[u8]) -> bool {
    let ending =
        Some(()).and_then(|()| filename.get(filename.len().checked_sub(compare.len() + 1)?..));
    if let Some(ending) = ending {
        (ending[0] == b'\\' as u16 || ending[0] == b'/' as u16)
            && ascii_compare_u16_u8_casei(&ending[1..], compare)
    } else {
        ascii_compare_u16_u8_casei(filename, compare)
    }
}

/// check_filename but ignores trailing slash / backslash
fn check_dir_filename(filename: &[u16], compare: &[u8]) -> bool {
    if let Some((&last, rest)) = filename.split_last()
        && (last == b'/' as u16 || last == b'\\' as u16)
    {
        check_filename(rest, compare)
    } else {
        check_filename(filename, compare)
    }
}

fn copy_file_hook(
    src_name: *const u16,
    dest_name: *const u16,
    fail_if_exist: u32,
    orig: unsafe extern "C" fn(*const u16, *const u16, u32) -> u32,
) -> u32 {
    unsafe {
        if src_name.is_null() || dest_name.is_null() {
            return orig(src_name, dest_name, fail_if_exist);
        }
        let compare = b"lastreplay.rep";
        let src_name_len = (0..).find(|&i| *src_name.add(i) == 0).unwrap();
        let src_name_slice = std::slice::from_raw_parts(src_name, src_name_len);
        let is_copying_lastreplay = src_name_slice
            .len()
            .checked_sub(compare.len())
            .and_then(|suffix_len| src_name_slice.get(suffix_len..))
            .filter(|suffix| ascii_compare_u16_u8_casei(suffix, compare))
            .is_some();
        if !is_copying_lastreplay {
            return orig(src_name, dest_name, fail_if_exist);
        }

        // Fix dest name to [SB]HHMMSS-maptitle.rep
        // Limit filename to 50 chars -- SC:R doesn't really seem to have
        // any limit anymore but if there's something silly with the map title
        // keep it short anyway.
        let dest_name_len = (0..).find(|&i| *dest_name.add(i) == 0).unwrap();
        let dest_name_slice = std::slice::from_raw_parts(dest_name, dest_name_len);
        let mut path = PathBuf::from(windows::os_string_from_winapi(dest_name_slice));
        path.pop();

        let mut filename_base = format!(
            "[SB]{}-{}",
            chrono::Local::now().format("%H%M%S"),
            game_thread::map_name_for_filename(),
        );
        if filename_base.len() > 50 {
            // Truncate position must be in UTF-8 char boundary for it to not panic.
            // Not sure if the map title is UTF-8 in the first place though..
            let truncate_pos = (50..)
                .take_while(|&i| i < filename_base.len())
                .find(|&i| filename_base.is_char_boundary(i));
            if let Some(pos) = truncate_pos {
                filename_base.truncate(pos);
            }
        }

        let mut i = 2;
        let mut filename = format!("{filename_base}.rep");
        // Add (2) (3) etc if filename already exists.
        // Since the filename contains a timestamp, this should only happen on super-rare cases
        // if two games are being ran at a same time in SB development, but losing one of
        // those replays wouldn't be nice =)
        loop {
            path.push(&filename);
            if !path.exists() {
                break;
            }
            path.pop();
            if i > 32 {
                // ???
                error!(
                    "Couldn't find suitable filename for {} / {}",
                    path.display(),
                    filename_base,
                );
                // Return success anyway.
                return 1;
            }
            filename = format!("{filename_base} ({i}).rep");
            i += 1;
        }

        let result = orig(src_name, windows::winapi_str(&path).as_ptr(), fail_if_exist);
        if result != 0 {
            send_game_msg_to_async(GameThreadMessage::ReplaySaved(path));
        }

        result
    }
}

fn ascii_compare_u16_u8_casei(a: &[u16], b: &[u8]) -> bool {
    if a.len() != b.len() {
        return false;
    }
    for i in 0..a.len() {
        if a[i] >= 0x80 || !(a[i] as u8).eq_ignore_ascii_case(&b[i]) {
            return false;
        }
    }
    true
}

fn ascii_compare_u16_u8(a: &[u16], b: &[u8]) -> bool {
    if a.len() != b.len() {
        return false;
    }
    for i in 0..a.len() {
        if a[i] >= 0x80 || a[i] != b[i] as u16 {
            return false;
        }
    }
    true
}

thread_local! {
    /// A counter for how many GetSystemTimePreciseAsFileTime hooks to modify on this thread.
    static PRECISE_SYSTEM_TIME_HOOK_ENABLED_COUNT: Cell<u32> = const { Cell::new(0) };

    /// Avoids hooking our own time retrieval during logging
    pub static IS_LOGGING_TIME_CALL: Cell<bool> = const { Cell::new(false) };
}

pub fn start_precise_system_time_hook() {
    // Experimentally derived to be a good value
    PRECISE_SYSTEM_TIME_HOOK_ENABLED_COUNT.set(1);
}

fn stop_precise_system_time_hook() {
    PRECISE_SYSTEM_TIME_HOOK_ENABLED_COUNT.set(0);
}

fn get_system_time_precise_as_file_time_hook(
    time: *mut FILETIME,
    orig: unsafe extern "C" fn(*mut FILETIME),
) {
    unsafe {
        orig(time);

        if PRECISE_SYSTEM_TIME_HOOK_ENABLED_COUNT.get() > 0 && !IS_LOGGING_TIME_CALL.get() {
            debug!("Modifying GetSystemTimePreciseAsFileTime result");
            // Making StarCraft feel young again makes it initialize a bit faster
            (*time).dwHighDateTime = 0x01BF53B7;
            (*time).dwLowDateTime = 0x8F200000;

            PRECISE_SYSTEM_TIME_HOOK_ENABLED_COUNT.with(|count| {
                count.update(|c| c.saturating_sub(1));
            });
        }
    }
}

fn load_snp_list_hook(
    callbacks: *mut scr::SnpLoadFuncs,
    count: u32,
    orig: unsafe extern "C" fn(*mut scr::SnpLoadFuncs, u32) -> u32,
) -> u32 {
    let mut funcs = scr::SnpLoadFuncs {
        identify: snp_load_identify,
        bind: snp_load_bind,
    };

    unsafe {
        // Call bind for SCR's LAN funcs to determine function count
        // and to get pointer to its initialize function, which we'll
        // have to call at our SNP initialize.
        assert!(count != 0);
        let mut orig_scr_funcs = null();
        let ok = ((*callbacks).bind)(1, &mut orig_scr_funcs);
        assert!(ok != 0);
        SCR_SNP_INITIALIZE.store((*orig_scr_funcs).initialize as usize, Ordering::Relaxed);
        orig(&mut funcs, 1)
    }
}

static SNP_FUNCTIONS: SnpFunctions = SnpFunctions {
    unk0: 0,
    free_packet: snp::free_packet,
    initialize: snp_initialize,
    unk0c: 0,
    receive_packet: snp::receive_packet,
    send_packet: snp::send_packet,
    unk18: 0,
    broadcast_game: snp::broadcast_game,
    stop_broadcasting_game: snp::stop_broadcasting_game,
    unk24: 0,
    unk28: 0,
    joined_game: None,
    unk30: 0,
    unk34: 0,
    start_listening_for_games: None,
    future_padding: [0; 0x10],
};

unsafe extern "system" fn snp_load_identify(
    snp_index: u32,
    id: *mut u32,
    name: *mut *const i8,
    description: *mut *const i8,
    caps: *mut *const crate::bw::SnpCapabilities,
) -> u32 {
    unsafe {
        if snp_index > 0 {
            return 0;
        }

        *id = snp::PROVIDER_ID;
        *name = c"Shieldbattery".as_ptr();
        *description = c"=)".as_ptr();
        *caps = &snp::CAPABILITIES;
        1
    }
}

unsafe extern "system" fn snp_initialize(
    client_info: *const bw::ClientInfo,
    user_data: *mut c_void,
    battle_info: *mut c_void,
    module_data: *mut c_void,
) -> i32 {
    unsafe {
        // No ShieldBattery packet transport is set up here — all traffic rides the rally-point2
        // relay — but SCR's own LAN SNP init still runs: it initializes a global SCR accesses when
        // joining a game, and it won't initialize anything else we don't want. Storm's own lobby
        // session tick (the StepIo pump, `maybe_receive_turns`) only runs once this has completed,
        // so its result is latched into `SNP_INITIALIZED` for those to gate on.
        let scr_init: unsafe extern "system" fn(
            *const bw::ClientInfo,
            *mut c_void,
            *mut c_void,
            *mut c_void,
        ) -> i32 = mem::transmute(SCR_SNP_INITIALIZE.load(Ordering::Relaxed));
        let result = scr_init(client_info, user_data, battle_info, module_data);
        SNP_INITIALIZED.store(result != 0, Ordering::Relaxed);
        result
    }
}

static SCR_SNP_INITIALIZE: AtomicUsize = AtomicUsize::new(0);
static SNP_INITIALIZED: AtomicBool = AtomicBool::new(false);

unsafe extern "system" fn snp_load_bind(snp_index: u32, funcs: *mut *const SnpFunctions) -> u32 {
    unsafe {
        if snp_index > 0 {
            return 0;
        }
        *funcs = &SNP_FUNCTIONS;
        1
    }
}

#[allow(bad_style)]
mod hooks {
    use libc::c_void;
    use winapi::shared::minwindef::FILETIME;

    use crate::bw;

    use super::scr;

    whack_hooks!(0, // cdecl
        !0 => ScMain();
        !0 => GameInit();
        !0 => OpenFile(*mut scr::FileHandle, *const u8, *const scr::OpenParams) ->
            *mut scr::FileHandle;
        !0 => Ttf_RenderSdf(
            *mut scr::TtfFont,
            f32,
            u32, // glyph id
            u32, // a4 border
            u32, // a5 edge_value
            f32,
            *mut u32, // a7 out width pixels
            *mut u32, // a8 out width pixels
            *mut u32, // a9 out x unk (unused)
            *mut u32, // a10 out y unk (unused)
        ) -> *mut u8;
        !0 => ProcessGameCommands(*const u8, usize, u32);
        !0 => ProcessLobbyCommands(*const u8, usize, u32);
        !0 => SendCommand(*const u8, usize);
        !0 => InitGameData() -> u32;
        !0 => InitObsUi();
        !0 => InitUnitData();
        !0 => StepGame();
        !0 => StepReplayCommands();
        !0 => CreateGameMultiplayer(
            *mut bw::BwGameData, // Note: 1.16.1 struct, not scr::JoinableGameInfo
            *const u8, // Game name
            *const u8, // Password (null)
            *const u8, // Map path?
            usize, usize, usize, usize, // 0x10 byte struct passed by value
        ) -> u32;
        !0 => SpawnDialog(*mut bw::Dialog, usize, usize) -> usize;
        !0 => StepGameLogic(usize) -> usize;
        !0 => StepNetwork() -> usize;
        // Netcode v2 turn hooks. All cdecl. OUT/IN/PIPE; each falls through to `orig` when there's no
        // live rally-point2 session (see the hook bodies).
        !0 => SendTurnMessage(*const u8, usize) -> usize;
        !0 => ReceiveStormTurns(u32, u32, *mut c_void, *mut c_void, *mut c_void) -> u32;
        !0 => FlushLocalTurns(usize, usize) -> usize;
        !0 => NetFormatTurnRate(*mut scr::NetFormatTurnRateResult, bool) ->
            *mut scr::NetFormatTurnRateResult;
        !0 => UpdateGameScreenSize(f32);
        // The three minimap dot-draw functions, hooked for the minimap-only team-color mode. All
        // cdecl (the dispatcher takes no argument we use; both per-player helpers take the player id
        // as their first stack argument and the caller cleans it up). Full overrides that always
        // fall through to `orig`.
        !0 => DrawMinimapUnits();
        !0 => DrawMinimapPlayerUnits(u32);
        !0 => DrawMinimapMainPlayerUnits(u32);
        !0 => DrawGraphicLayers(*mut c_void, usize, u32);
        !0 => DecideCursorType() -> u32;
        !0 => PrintText(*const i8, u32, u32);
        !0 => NetPlayerCount() -> u32;
    );

    system_hooks!(
        // Storm's network join handshake, stdcall with 9 dword args (retn 0x24 on x86). The netcode
        // v2 native-lobby join replacement replaces it wholesale when a lobby session seed is staged.
        // Only arg 4 (`*mut u32`, out: local game-level net player id) is consulted; the rest — name
        // strings, expected game id/version, host net key, advertise value — are opaque here and are
        // passed through verbatim to the original on the native (unseeded) path.
        !0 => StormJoinGame(usize, usize, usize, *mut u32, usize, usize, usize, usize, usize) -> u32;
        !0 => LoadSnpList(*mut scr::SnpLoadFuncs, u32) -> u32;
        !0 => CreateEventW(*mut c_void, u32, u32, *const u16) -> *mut c_void;
        !0 => CloseHandle(*mut c_void) -> u32;
        !0 => GetTickCount() -> u32;
        !0 => CreateFileW(
            *const u16,
            u32,
            u32,
            *mut c_void,
            u32,
            u32,
            *mut c_void,
        ) -> *mut c_void;
        !0 => CopyFileW(*const u16, *const u16, u32) -> u32;
        !0 => GetFileAttributesW(*const u16) -> u32;
        !0 => XInputGetState(u32, *mut c_void) -> u32;
        !0 => GetSystemTimePreciseAsFileTime(*mut FILETIME);
        !0 => SHGetFolderPathW(*mut c_void, i32, *mut c_void, u32, *mut u16) -> i32;
    );

    thiscall_hooks!(
        !0 => FontCacheRenderAscii(*mut c_void);
        !0 => StartUdpServer(*mut c_void) -> u32;
        !0 => StepIo(*mut c_void);
        !0 => Renderer_Render(*mut scr::Renderer, *mut scr::DrawCommands, u32, u32) -> u32;
        !0 => Renderer_CreateShader(
            *mut scr::Renderer,
            *mut scr::Shader,
            *const u8,
            *const u8,
            *const u8,
            *mut c_void,
        ) -> usize;
        !0 => Console_HitTest(*mut scr::UiConsole, i32, i32) -> u8;
        !0 => OrderFn(*mut bw::Unit);
    );

    #[cfg(target_arch = "x86")]
    whack_hooks!(0, // cdecl
        !0 => LoadDdsgrpCursor(*const u8, bool, f32, f32, usize) -> usize;
    );

    #[cfg(target_arch = "x86_64")]
    whack_hooks!(0, // cdecl
        !0 => LoadDdsgrpCursor(*const u8, bool, u64, usize) -> usize;
    );

    #[cfg(target_arch = "x86")]
    thiscall_hooks!(
        !0 => PrepareIssueOrder(*mut bw::Unit, u32, u32, *mut bw::Unit, u32, u32);
    );

    #[cfg(target_arch = "x86_64")]
    thiscall_hooks!(
        !0 => PrepareIssueOrder(*mut bw::Unit, u32, *mut bw::PointAndUnit, u32, u32);
    );
}

// Inline asm was only on nightly rust when this was written..
// mov eax, [esp + 4]; mov eax, fs:[eax]; ret
#[cfg(target_arch = "x86")]
#[unsafe(link_section = ".text")]
#[unsafe(no_mangle)] // Workaround for linker errors on opt-level 1 ??
static READ_FS_GS: [u8; 8] = [0x8b, 0x44, 0xe4, 0x04, 0x64, 0x8b, 0x00, 0xc3];

// mov rax, gs:[rcx]; ret
#[cfg(target_arch = "x86_64")]
#[unsafe(link_section = ".text")]
#[unsafe(no_mangle)] // Workaround for linker errors on opt-level 1 ??
static READ_FS_GS: [u8; 5] = [0x65, 0x48, 0x8b, 0x01, 0xc3];

unsafe fn read_fs_gs(offset: usize) -> usize {
    unsafe {
        let func: extern "C" fn(usize) -> usize = mem::transmute(READ_FS_GS.as_ptr());
        func(offset)
    }
}

/// Value is assumed to not have null terminator.
/// Leaks memory and BW should not be let to deallocate the buffer
/// if value doesn't fit inline.
unsafe fn init_bw_string(out: *mut scr::BwString, value: &[u8]) {
    unsafe {
        if value.len() < 16 {
            let inline_buffer: *mut [u8; 16] = &raw mut (*out).inline_buffer;
            (&mut *inline_buffer)[..value.len()].copy_from_slice(value);
            (&mut *inline_buffer)[value.len()] = 0;
            (*out).pointer = inline_buffer.cast();
            (*out).length = value.len();
            (*out).capacity = 15 | (isize::MIN as usize);
        } else {
            let mut vec = mem::ManuallyDrop::new(Vec::with_capacity(value.len() + 1));
            vec.extend(value.iter().cloned());
            vec.push(0);
            (*out).pointer = vec.as_mut_ptr();
            (*out).length = value.len();
            (*out).capacity = value.len();
        }
    }
}

fn log_time<F: FnOnce() -> R, R>(name: &str, func: F) -> R {
    let time = Instant::now();
    let ret = func();
    debug!("{} took {:?}", name, time.elapsed());
    ret
}

/// This is the main function for progressing synced game logic, including
/// receiving handling of network commands, and replay commands if this is replay.
///
/// If replay is being seeked (replay_seek_frame global), this function will
/// run several steps before returning, otherwise it progresses a single step.
unsafe fn step_game_logic_hook(
    bw: &'static BwScr,
    param: usize, // Always 0, nonzero would affect replay playback somehow
    orig: unsafe extern "C" fn(usize) -> usize,
) -> usize {
    if !bw.first_game_logic_frame_done.load(Ordering::Relaxed) {
        bw.first_game_logic_frame_done
            .store(true, Ordering::Relaxed);
        if game_thread::is_replay() {
            // Make replay buttons line up better with the pre-SC:R replay ui
            bw.offset_statbtn_dialog(3, -3);
        }
    }
    // Observer / replay UI in SC:R has a bug with toggling player visions:
    // In order to immediately update un/detected sprite to match what players see,
    // BW calls update_detection_status(unit) that in addition to updating sprite
    // (not expected to be synced), will write to unit.detection_status (expected to be synced).
    //
    // Fixing this by reverting any changes to unit.detection_status outside step_game_logic,
    // this simpler to implement than adding analysis for the obs UI functions.
    let units = bw.units.resolve();
    {
        // For first call of this function detection_status_copy should be empty
        // and this loop before orig will not write to anything.
        //
        // FWIW, it is be fine to rely on (*units).length and (*units).data being
        // constant for the all step_game_logic calls across single game.
        let detection_status = bw.detection_status_copy.lock();
        let unit_ptr = (*units).data as *mut bw::Unit;
        for (i, value) in detection_status.iter().copied().enumerate() {
            (*unit_ptr.add(i)).detection_status = value;
        }
    }
    let ret = orig(param);
    {
        let mut detection_status = bw.detection_status_copy.lock();
        let unit_count = (*units).length;
        let unit_ptr = (*units).data as *mut bw::Unit;
        detection_status.clear();
        detection_status.extend((0..unit_count).map(|i| (*unit_ptr.add(i)).detection_status));
    }
    ret
}

unsafe fn check_documents_starcraft_path_accessibility() {
    use winapi::um::fileapi::GetFileAttributesW;
    use winapi::um::shlobj::{CSIDL_PERSONAL, SHGetFolderPathW};
    // Using same functions what BW uses to see if something weird goes wrong there.
    let mut buffer = [0u16; 0x104];
    let result = SHGetFolderPathW(
        null_mut(),
        CSIDL_PERSONAL,
        null_mut(),
        0,
        buffer.as_mut_ptr(),
    );
    if result != 0 {
        warn!(
            "SHGetFolderPathW(CSIDL_PERSONAL) failed: {:08x} {}",
            result,
            std::io::Error::from_raw_os_error(result),
        );
        return;
    }
    let mut path = windows::os_string_from_winapi_with_nul(&buffer);
    path.push("\\StarCraft\\");
    let result = GetFileAttributesW(windows::winapi_str(&path).as_ptr());
    if result == 0xffff_ffff {
        // Note: BW is able to handle this folder not existing, but our call point
        // is after the point in which it should have been created already.
        let error = std::io::Error::last_os_error();
        warn!("BW documents path '{path:?}' is not usable: {error}");
    } else if result & FILE_ATTRIBUTE_DIRECTORY == 0 {
        warn!("BW documents path '{path:?}' is not a directory, file attributes are {result:08x}");
    }
}

fn sh_get_folder_path_w_hook(
    hwnd: *mut c_void,
    csidl: i32,
    token: *mut c_void,
    flags: u32,
    out_path: *mut u16,
    orig: unsafe extern "C" fn(*mut c_void, i32, *mut c_void, u32, *mut u16) -> i32,
) -> i32 {
    #[cold]
    fn write_dir_out(out: &mut [u16], path: &Path) {
        warn!("Fallback SHGetFolderPathW set to {}", path.display());
        let mut u16_path = windows::winapi_str(path);
        // Sanity check that there is null terminator
        assert!(*u16_path.last().unwrap() == 0);
        // Remove trailing slash / backslash, if it exists,
        // since SHGetFolderPathW documents it not being included
        while let Some(&last) = u16_path.get(u16_path.len() - 2) {
            if last == b'/' as u16 || last == b'\\' as u16 {
                u16_path.pop();
                *u16_path.last_mut().unwrap() = 0;
            } else {
                break;
            }
        }
        if u16_path.len() > out.len() {
            // Shouldn't happen, as the buffer must be MAX_PATH (260) characters long
            panic!("Documents dir path too long");
        }
        out[..u16_path.len()].copy_from_slice(&u16_path);
    }

    unsafe {
        use winapi::um::shlobj::CSIDL_PERSONAL;
        let ret = orig(hwnd, csidl, token, flags, out_path);
        // Bw uses SHGetFolderPathW to figure out documents dir and has unfortunate
        // fallbacks where it creates maps directory next to starcraft.exe if it fails
        // So if we detect the arguments that bw uses, and the function fails, we try to
        // find the result from another way.
        if ret != 0 && csidl == CSIDL_PERSONAL && hwnd.is_null() && token.is_null() && flags == 0 {
            let out = std::slice::from_raw_parts_mut(out_path, 260);
            warn!(
                "SHGetFolderPathW(CSIDL_PERSONAL) failed: {ret:x}; trying directories crate fallback"
            );
            // Not sure if the directories crate gives any different results; it still
            // calls SHGetKnownFolderPath without any user tokens or such,
            // so unless it has different results it would fail as well.
            if let Some(dirs) = directories::UserDirs::new()
                && let Some(documents) = dirs.document_dir()
            {
                write_dir_out(out, documents);
                return 0;
            }
            warn!("directories crate fallback failed; trying std::env::home_dir");
            if let Some(home_dir) = std::env::home_dir() {
                let documents = home_dir.join("Documents");
                if documents.is_dir() {
                    write_dir_out(out, &documents);
                    return 0;
                } else {
                    warn!("{} is not a directory", documents.display());
                }
            } else {
                warn!("std::env::home_dir failed");
            }
        }
        ret
    }
}
