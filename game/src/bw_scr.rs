use std::cell::Cell;
use std::ffi::{CStr, CString, OsString};
use std::marker::PhantomData;
use std::mem;
use std::os::windows::ffi::OsStringExt;
use std::path::{Path, PathBuf};
use std::ptr::{self, NonNull, null, null_mut};
use std::sync::atomic::{AtomicBool, AtomicI32, AtomicU8, AtomicU32, AtomicUsize, Ordering};
use std::sync::{Arc, OnceLock};
use std::time::{Duration, Instant};

use bw_dat::UnitId;
use byteorder::{ByteOrder, LittleEndian};
use libc::c_void;
use overlay_ui::net_quality::NetQualityView;
use overlay_ui::options::SettingChange;
use overlay_ui::shell::PauseControl;
use parking_lot::{Mutex, RwLock};
use smallvec::SmallVec;
use winapi::shared::minwindef::FILETIME;
use winapi::shared::windef::HWND;
use winapi::shared::ws2def::SOCKADDR;
use winapi::um::errhandlingapi::{GetLastError, SetLastError};
use winapi::um::fileapi::INVALID_FILE_ATTRIBUTES;
#[cfg(debug_assertions)]
use winapi::um::libloaderapi::GetModuleHandleW;
use winapi::um::winnt::FILE_ATTRIBUTE_DIRECTORY;

use init::{bw_free, bw_malloc, get_exe_build};
use network::NetcodeV2Bw;
use scr_analysis::{VirtualAddress, scarf};
use sdf_cache::InitSdfCache;
pub(crate) use selection::SelectedUnit;
pub(super) use selection::can_be_group_selected;
use selection::{ClickFeedback, ObserverUiCallbacks, PlacementOverlayPools, PylonAuras};
use shader_replaces::ShaderReplaces;
pub use thiscall::Thiscall;

use crate::GameThreadMessage;
use crate::app_messages::{
    AtomicStartingFog, BlockRequestFailed, MapInfo, MinimapColorMode, SbUserId, Settings,
    SettingsChanged, StartingFog,
};
use crate::bw::apm_stats::ApmStats;
use crate::bw::players::{BwPlayerId, StormPlayerId};
use crate::bw::unit::{Unit, UnitIterator};
use crate::bw::{self, Bw, FowSpriteIterator, LobbyOptions, SnpFunctions};
use crate::bw::{UserLatency, commands};
use crate::bw_scr::draw_inject::warn_once;
use crate::bw_scr::game_stats::GameStats;
use crate::forge::window_client_center;
use crate::game_state::JoinedPlayer;
use crate::game_thread::{self, send_game_msg_to_async};
use crate::netcode_v2;
use crate::offline_cookie;
use crate::recurse_checked_mutex::Mutex as RecurseCheckedMutex;
use crate::snp;
use crate::sync::DumbSpinLock;
use crate::team_colors::{GameStartInfo, TeamColorConfig, TeamColorState};
use crate::windows;

pub mod scr;

mod bw_hash_table;
mod bw_vector;
mod chat;
mod chat_history;
mod console;
mod dialog_hook;
mod draw_inject;
mod draw_overlay;
mod file_hook;
mod fog_style;
mod game;
mod game_files;
mod game_locale;
mod game_settings;
mod game_stats;
mod hotkey_presses;
mod init;
mod monitors;
mod network;
mod patching;
mod pe_image;
mod rendering;
mod replay_save;
mod replay_transport;
mod replay_vision_choice;
mod sdf_cache;
mod selection;
mod shader_replaces;
mod sound;
mod stat_txt;
pub(crate) mod thiscall;
mod tick_gates;

const NET_PLAYER_COUNT: usize = 12;
const SHADER_ID_MASK: u32 = 0x1c;

/// Whether a fog mask draw is the minimap's rather than the game view's. Both draw to the UI
/// render target; the game view's quad spans the whole window width (everything above the
/// console), the minimap's a small corner of it. Mask quads are 4 vertices of
/// `x, y, u, v`, with positions in 0.0 ..= 1.0 window coordinates.
unsafe fn is_minimap_mask_draw(cmd: &scr::DrawCommand, vertex_buf: *mut scr::VertexBuffer) -> bool {
    unsafe {
        let verts = ((*vertex_buf).buffer.data as *const u8).add(cmd.vertex_buffer_offset_bytes)
            as *const [f32; 4];
        let verts = std::slice::from_raw_parts(verts, 4);
        let (min_x, max_x) = verts.iter().fold((f32::MAX, f32::MIN), |(min, max), v| {
            (min.min(v[0]), max.max(v[0]))
        });
        max_x - min_x < 0.5
    }
}

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
    selection: selection::SelectionState,
    sprites_by_y_tile: Value<*mut *mut scr::Sprite>,
    sprites_by_y_tile_end: Value<*mut *mut scr::Sprite>,
    sprite_x: (Value<*mut *mut scr::Sprite>, u32, scarf::MemAccessSize),
    sprite_y: (Value<*mut *mut scr::Sprite>, u32, scarf::MemAccessSize),
    replay_data: Value<*mut bw::ReplayData>,
    replay_header: Value<*mut bw::ReplayHeader>,
    /// Countdown the trigger step decrements once per frame: triggers run on the frame it reads
    /// as zero, then it resets to 30. The native player-leave handler forces it to 1 in live games
    /// but not when the recorded leave command plays back, so replay playback restores that write
    /// itself (see [`process_replay_commands`](Self::process_replay_commands)).
    trigger_execution_timer: Value<u16>,
    /// The tick at which the game loop wants its next logic step. `step_game_logic` adds the
    /// frame delay to it once per simulated frame, so anything that makes one call simulate extra
    /// frames also pushes real-time pacing that far ahead unless the value is restored. `None` if
    /// analysis could not find it, which only a game that rolls back needs.
    next_game_step_tick: Option<Value<u32>>,
    /// The frame `step_game_logic` fast-forwards a replay to, which seeking by keyframe sets
    /// itself. `None` if analysis could not find it, which turns seeking by keyframe off.
    replay_seek_frame: Option<Value<u32>>,
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
    /// What lets a watcher's view scroll past the map's bottom edge, out from under the overlay's
    /// bottom panels. `None` where the analysis did not find it, which leaves the edge where the
    /// game puts it.
    bottom_overpan: Option<BottomOverpan>,
    cursor_scale_factor: Value<f32>,
    units: Value<*mut scr::BwVector>,
    /// The global `u16[player][group]` table holding the frame each selection group was last
    /// written on. `None` when the analysis could not place it, which costs the control-groups
    /// panel its stale marking and nothing else.
    selection_hotkey_last_used_frames: Option<Value<*mut u16>>,
    /// The map's per-tile flags, `width * height` of them, which carry each player's vision of the
    /// tile. `None` when the analysis could not place them, which costs the observer panels their
    /// map-vision reading and nothing else.
    map_tile_flags: Option<Value<*mut u32>>,
    vertex_buffer: Value<*mut scr::VertexBuffer>,
    renderer: Value<*mut scr::Renderer>,
    draw_commands: Value<*mut scr::DrawCommands>,
    /// [[u8; 4]; 256], mostly unused in SC:R, but still gets used for player colors at least.
    main_palette: Value<*mut u8>,
    rgb_colors: Value<*mut bw::RgbColors>,
    use_rgb_colors: Value<u8>,
    /// The per-player applied-skin table unit rendering reads, resolved together with its stride
    /// (all-or-nothing). `None` (either missing) turns the peer-skin relay off rather than failing
    /// game launch: BW still renders the local player's own skin from the slot `init_game` filled.
    skin_table: Option<SkinTable>,
    /// Base of the local skin source (`skins`), populated at startup from owned/selected skins.
    /// The native create path derives the local player's raw skin blob from this; used to locate
    /// that blob so a bypassed-join client can populate its own slot. `None` if unlocated.
    skins: Option<Value<*mut u8>>,
    sound: sound::Sound,
    /// Shift+Tab minimap player-color cycle (0 = normal). Saved/restored across game launches.
    minimap_color_mode: Option<Value<u8>>,
    /// Tab minimap-terrain toggle (nonzero = terrain hidden). Saved/restored across game launches.
    minimap_terrain_hidden: Option<Value<u8>>,
    /// The three minimap dot-draw functions the minimap-only team-color mode overrides, resolved
    /// together (all-or-nothing). `Some` = all three were located and hooked, so that mode drives
    /// the dots from `rgb_colors`; `None` (any missing) keeps it on BW's own diplomacy dots.
    minimap_draw_hooks: Option<MinimapDrawHooks>,
    /// SC:R's nearest-palette-color lookup and the tileset cycling table it reads, resolved together
    /// (all-or-nothing): guarding the lookup needs both the function to hook and the pointer to
    /// test. `None` (either missing) leaves the lookup unguarded.
    palette_color_lookup: Option<PaletteColorLookup>,
    /// SC:R's `get_player_color`, hooked so the team-color feature can tint units owned by the high
    /// player ids (`8..12`), which never read `rgb_colors` on the game view. `None` leaves those
    /// units in their native color in every mode.
    get_player_color: Option<VirtualAddress>,
    /// SC:R's `update_minimap_dialog_horizontal_offset(expand)`, hooked so a watcher's minimap
    /// always sits in the bottom-left corner. `None` leaves it wherever the minimap position
    /// setting puts it.
    update_minimap_dialog_horizontal_offset: Option<VirtualAddress>,
    /// SC:R's replay autosave and the path builder it uses. `None` (either missing) leaves the
    /// autosave as SC:R implements it.
    replay_autosave: Option<replay_save::ReplayAutosave>,
    /// BW's in-game chat send-scope byte (`chat_box_mode`): 0 = box closed, 1 = single-player local,
    /// 2 = everyone, 3 = allies, 4 = a specific player, 5 = observers. Read at chat-send time to
    /// scope the netcode v2 relay message. Non-fatal if unlocated (chat degrades to everyone).
    chat_box_mode: Option<Value<u8>>,
    /// Whether the game is paused. Non-fatal if unlocated: the menu then offers no pausing.
    is_paused: Option<Value<u8>>,
    statres_icons: Value<*mut scr::DdsGrpSet>,
    cmdicons: Value<*mut scr::DdsGrpSet>,
    /// The status panel's unit wireframes, one frame per unit id. `None` (unlocated) leaves the
    /// overlay drawing every unit with its command icon.
    wirefram: Option<Value<*mut scr::DdsGrpSet>>,
    /// The palette remap the wireframes' layers are colored through, read from the game's files on
    /// the first draw. Its outer `None` is a remap not yet read; its inner one a remap the game had
    /// no readable file for.
    wireframe_remap: OnceLock<Option<draw_overlay::WireframeRemap>>,
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
    update_game_screen_size: unsafe extern "C" fn(f32),
    move_unit: Thiscall<unsafe extern "C" fn(*mut bw::Unit, i32, i32)>,
    render_screen: unsafe extern "C" fn(*mut c_void, usize),
    /// What the in-game loop calls instead of `render_screen` on an iteration it doesn't draw:
    /// ends the renderer's frame without drawing or presenting it, and begins the next.
    skip_render: Option<unsafe extern "C" fn()>,
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
    order_reset_collision_harvester: VirtualAddress,
    do_next_queued_order: VirtualAddress,
    order_attack_unit: VirtualAddress,
    check_unit_resources_and_supply: VirtualAddress,
    unit_cost_cache: UnitCostCache,
    game_command_lengths: Vec<u32>,
    prism_pixel_shaders: Vec<VirtualAddress>,
    prism_renderer_vtable: VirtualAddress,
    dx9_renderer_vtables: Vec<VirtualAddress>,
    console_vtables: Vec<VirtualAddress>,
    replay_minimap_patch: Option<scr_analysis::Patch>,
    cursor_dimension_patch: Option<scr_analysis::Patch>,
    open_file: VirtualAddress,
    prepare_issue_order: VirtualAddress,
    create_game_multiplayer: VirtualAddress,
    spawn_dialog: VirtualAddress,
    step_game_logic: VirtualAddress,
    /// One iteration of the in-game loop: message pump, logic step when due, draw and present.
    /// Frame pacing waits at its start; without it the game runs unpaced.
    step_game_loop: Option<VirtualAddress>,
    net_format_turn_rate: VirtualAddress,
    init_obs_ui: VirtualAddress,
    draw_graphic_layers: VirtualAddress,
    /// What draws the software cursor, and moves it above the overlay; `None` where the analysis
    /// cannot place it all, which leaves the cursor drawn under the overlay.
    software_cursor: Option<SoftwareCursor>,
    decide_cursor_type: VirtualAddress,
    tick_gated_work: tick_gates::TickGatedWork,
    /// SC:R's hotkey presses waiting to activate their buttons; `None` where the analysis can't
    /// place them, which leaves later input able to overtake a press.
    delayed_control_activations: Option<hotkey_presses::DelayedControlActivations>,
    load_ddsgrp_cursor: VirtualAddress,
    lobby_create_callback_offset: usize,
    starcraft_tls_index: SendPtr<*mut u32>,
    print_text_addr: VirtualAddress,
    net_player_count_addr: VirtualAddress,
    /// Allocation function of the engine's second allocation path: a plain
    /// `alloc(size, tag, tag2, flags)` over the same OS heap the allocator vtable object uses.
    /// Pathing, AI regions, replay recording and save/load allocate through this one rather than
    /// through the vtable object.
    #[cfg(debug_assertions)]
    engine_alloc: VirtualAddress,
    /// Deallocation function paired with `engine_alloc`, `free(ptr, tag, tag2, flags)`.
    #[cfg(debug_assertions)]
    engine_free: VirtualAddress,
    /// The observer UI's entry points for notifications from the simulation, or `None` if analysis
    /// could not find all of them.
    observer_ui_callbacks: Option<ObserverUiCallbacks>,
    /// The functions a right click calls to place the order confirmation marker and to make the
    /// target's selection circle blink, which write into the simulation's memory between logic
    /// steps, or `None` if analysis could not find both.
    click_feedback: Option<ClickFeedback>,
    placement_overlays: Option<PlacementOverlayPools>,
    /// The pylon power fields, or `None` if analysis could not find them.
    pylon_auras: Option<PylonAuras>,
    /// The functions the trigger step calls to open the defeat and victory dialogs, or `None` if
    /// analysis could not find both.
    mission_dialog_openers: Option<(VirtualAddress, VirtualAddress)>,
    /// The function that shows a line of game information text (a player leaving or being
    /// eliminated), or `None` if analysis could not find it.
    show_game_message: Option<VirtualAddress>,
    /// The synced simulation state the rollback engine snapshots, as resolved analysis results
    /// that still have to be turned into addresses once a game is running.
    rollback_ranges: Vec<crate::rollback::ranges::RangeSpec>,

    // State
    exe_build: u32,
    disable_hd: AtomicBool,
    sdf_cache: Arc<InitSdfCache>,
    is_replay_seeking: AtomicBool,
    /// Whether the replay has been sent to the frame its setup asked it to start at.
    replay_start_seek_sent: AtomicBool,
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
    /// Whether the last frame the renderer drew was partway through a switch between SD and HD,
    /// which draws the final picture in both.
    hd_switching: AtomicBool,
    /// The span of this frame's draw commands that are the overlay's, as `(first, end)` indices.
    /// The overlay draws straight to the backbuffer like the game's own final pass does, so the
    /// render hook reading the HD mode off that pass must step past these.
    overlay_draw_commands: (AtomicU32, AtomicU32),
    /// The span of this frame's draw commands that are the software cursor's, which goes to the
    /// backbuffer as well and must be stepped past the same way.
    software_cursor_draw_commands: (AtomicU32, AtomicU32),
    starting_fog: AtomicStartingFog,
    /// Saved Shift+Tab minimap color mode to restore at the start of a game (from local settings).
    saved_minimap_color_mode: AtomicU8,
    /// Saved Tab minimap-terrain-hidden flag to restore at the start of a game (from local settings).
    saved_minimap_terrain_hidden: AtomicBool,
    /// Whether the saved minimap settings have already been applied this game (so we only restore
    /// them once, letting in-game toggles afterwards stick).
    minimap_settings_restored: AtomicBool,
    /// Receive steps spent so far waiting to broadcast this client's own skin blob, or
    /// `u32::MAX` once it has been sent (it is sent exactly once per game — see
    /// [`broadcast_local_skin_once`](Self::broadcast_local_skin_once)).
    skin_broadcast_attempts: AtomicU32,
    /// Whether [`SKINS_LOCAL_BLOB_OFFSET`] has been validated against the native fill this game
    /// (see [`validate_local_skin_offset`](BwScr::validate_local_skin_offset)).
    skin_offset_validated: AtomicBool,
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
    /// Engine pieces for the adjustable middle-mouse grab pan, resolved all-or-nothing. `None`
    /// (any piece missing) leaves the game's built-in pan behavior untouched rather than failing
    /// game launch.
    grab_pan: Option<GrabPan>,
    /// Whether the user's custom grab pan sensitivity replaces the game's built-in pan behavior
    /// (which moves the camera across the map's entire scrollable extent in 100 pixels of mouse
    /// travel). When false the built-in behavior runs unmodified.
    grab_pan_sensitivity_on: AtomicBool,
    /// Camera pixels moved per mouse pixel dragged while grab panning, stored as `f32` bits.
    /// Written on the async thread at `set_settings`, read on the game thread per pan update.
    grab_pan_gain: AtomicU32,
    /// Whether grab panning moves the camera opposite to the drag (drag left pans right), like
    /// touchpad-style "natural" scrolling. Only takes effect while the custom sensitivity is on,
    /// since the built-in pan behavior runs untouched otherwise.
    grab_pan_inverted: AtomicBool,
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
    /// The per-second history the observer panels' rates, graphs and timeline are built from.
    /// Sampled from the simulation step, so it sees every frame simulated, a replay seek's
    /// fast-forward included.
    game_stats: RecurseCheckedMutex<GameStats>,
    /// Keeps track of what game_screen_height_ratio was originally.
    /// (It depends a bit on what console the player uses)
    original_game_screen_height_ratio: AtomicU32,
    /// Set while `init_obs_ui` runs with a watcher's `is_replay` and `local_unique_player_id`
    /// swapped for a player's, so code it reaches can still tell the local client is a watcher.
    obs_ui_init_as_player: AtomicBool,
    /// If console was hidden in replay / obs ui
    console_hidden_state: AtomicBool,
    /// The unit the game's view follows for a watcher who asked it to.
    followed_unit: Mutex<Option<FollowedUnit>>,
    /// If the minimap was hidden in replay / obs ui. Separate from the console's state: the minimap
    /// is its own surface and observers keep it while hiding the rest of the console.
    minimap_hidden_state: AtomicBool,
    /// If the console's command panel was hidden because the overlay's replay transport is standing
    /// in for the replay controls it carries.
    command_panel_hidden_state: AtomicBool,
    /// Whether the game has been started (e.g. we're done loading in)
    game_started: AtomicBool,
    /// Whether game init is drawing frames to get its textures onto the GPU (see
    /// `settle_init_uploads`), during which the overlay keeps showing the loading screen.
    init_uploads_settling: AtomicBool,
    /// Whether game results have been sent to the GameState thread yet
    game_results_sent: AtomicBool,
    /// Used to have step_game_logic_hook do things once at start of the game, after initial
    /// units are spawned and game logic is ready to run normally.
    /// Will be reset on replay rewinds.
    first_game_logic_frame_done: AtomicBool,
    /// When the game countdown started (if it has started)
    countdown_start: Mutex<Option<Instant>>,
    /// When the game last formatted its turn rate readout in a game that rolls back. The game only
    /// formats it while the player has the readout turned on, which is what the network quality
    /// chip that replaces it follows.
    turn_rate_readout_at: Mutex<Option<Instant>>,
    print_text_hooks_disabled: AtomicI32,
    /// How the `PrintText` hook treats the chat line being injected right now, as a
    /// [`ChatInjection`] discriminant.
    chat_injection: AtomicU8,
    /// Chat a game that predicts inputs showed while stalled, which goes into the replay once the
    /// stalled step runs (see [`netcode_v2_receive_predicted`](Self::netcode_v2_receive_predicted)).
    chat_shown_while_stalled: Mutex<Vec<netcode_v2::InjectedChat>>,
    chat_manager: Mutex<chat::ChatManager>,
    /// Every line the chat put on screen this game, which the overlay's chat log reads back.
    /// Filled where the chat renders rather than where it arrives, so it holds exactly what the
    /// player saw.
    chat_history: Mutex<chat_history::ChatHistory>,
    /// How replay playback is running, tracked off the command stream rather than read out of the
    /// game's own globals.
    replay_transport: Mutex<replay_transport::ReplayTransport>,
    /// The replay visions the viewer chose, which SC:R's globals lose when it starts a replay over.
    replay_vision_choice: Mutex<replay_vision_choice::ReplayVisionChoice>,
    /// What the overlay's options screen shows: the settings the app sent at launch, plus whatever
    /// the player has since moved there. Held here rather than in the overlay because the settings
    /// arrive long before the first frame is drawn.
    options: Mutex<overlay_ui::options::OptionsView>,
    /// Carries the settings the game changes on its own keys into [`options`](Self::options).
    engine_settings: Mutex<draw_overlay::options::EngineSettingsFollower>,
    /// The options screen's lists that are read off this machine rather than out of a setting,
    /// which is the displays the game can be put on. Read once, when the settings arrive; shared
    /// rather than copied so a frame takes the list without cloning the names in it.
    option_lists: Mutex<Arc<overlay_ui::options::OptionsLists>>,
    /// The observer panels the player last left on screen, as the app saved them, until the overlay
    /// takes them up.
    observer_panels: Mutex<Option<overlay_ui::shell::PanelPrefs>>,
    /// SC:R's own settings registry, which the options screen writes its changes through. `None`
    /// when the analysis could not place it, which leaves SC:R's settings to take effect next game.
    game_settings: Option<game_settings::GameSettings>,
    /// How many of the F5 key messages the options screen posted to switch graphics are still on
    /// their way to the window: those are SC:R's, past whatever the overlay holds the keyboard for.
    posted_graphics_keys: AtomicU8,
    /// Changes to SC:R's settings registry waiting for the start of the next frame. Some of the
    /// registry's listeners rebuild the renderer's render targets on the spot (real-time lighting
    /// does), which is only safe while no draw command refers to them: between frames, where SC:R's
    /// own options and hotkeys make their changes. The options screen runs mid-frame, so its
    /// changes wait here.
    pending_game_setting_writes:
        Mutex<Vec<(&'static str, &'static str, game_settings::SettingValue)>>,
    /// Where the game's names for units, upgrades and techs are read from. `None` when the analysis
    /// could not place stat_txt, which leaves the overlay's panels without names.
    stat_txt: Option<stat_txt::StatTxt>,
    /// The language the game is running in, which the overlay follows where it has a translation
    /// for it. `None` when the analysis could not find the game's locale state.
    game_locale: Option<game_locale::GameLocale>,
    /// The overlay language the user's settings ask for, which the overlay falls back to where the
    /// game's language has no translation.
    settings_locale: Mutex<overlay_ui::i18n::Locale>,
    /// Ensures that things that qualify as "event processing" (e.g. process_events,
    /// maybe_receive_turns) don't execute from multiple threads at the same time (which may happen
    /// at certain points during game init).
    event_processing_lock: DumbSpinLock,
}

/// Live custom-team-color state for one game, present only while the feature is active. Everything
/// here lives on and is touched from the BW main thread.
struct TeamColorRuntime {
    /// The assignment engine, advanced as the local player's alliances change.
    state: TeamColorState,
    /// BW's original `rgb_colors` captured at game init: the per-slot fallback for any slot the
    /// engine leaves unassigned, and the full palette restored in the Standard / minimap-only modes.
    original_rgb_colors: bw::RgbColors,
    /// BW's original `use_rgb_colors` switch captured at game init. Restored verbatim in the
    /// Standard / minimap-only modes so units reproduce the game's native appearance (palette-index
    /// or RGB, whichever it ran), and forced on for the spans where custom colors apply.
    original_use_rgb_colors: u8,
    /// The Shift+Tab color mode the user currently sees. The real `minimap_color_mode` global is
    /// pinned to a fixed value per mode (so BW's own diplomacy recolor never fires), leaving this
    /// the source of truth for what the user selected.
    virtual_mode: MinimapColorMode,
    /// The local player id (in a shared-control team game, its team's main player, whose row the
    /// team's alliance commands change) and the outgoing alliance row currently reflected in the
    /// assignment, or `None` for an observer/replay (no live tracking). Diffed each frame to detect
    /// changes.
    local_alliance_row: Option<(u8, [bool; 8])>,
}

impl TeamColorRuntime {
    /// The full `rgb_colors` contents for the current assignment: each main player slot the engine
    /// assigned takes its color (the rest keep BW's original from the init snapshot), and every
    /// high player id (`8..12`) takes the scheme's neutral color.
    fn assigned_rgb_colors(&self) -> bw::RgbColors {
        let mut out = self.original_rgb_colors;
        for (slot, color) in self.state.colors().iter().enumerate() {
            if let Some(color) = color {
                out[slot] = *color;
            }
        }
        out[8..].fill(self.state.neutral());
        out
    }
}

/// The three structurally-identical minimap dot-draw functions the minimap-only team-color mode
/// overrides, resolved together (all-or-nothing). Hooking all three lets that mode feed the dots a
/// swapped `rgb_colors` palette for the span of the draw without touching unit colors; a subset
/// would color some dots from `rgb_colors` and leave others on BW's palette-index path, so the
/// feature only engages when every site is present.
/// Reads up to `len` bytes starting at `addr`, stopping at the end of the mapped, readable region
/// `addr` falls in — so an unmapped or guard address yields `None` instead of faulting, and a read
/// that would cross into unmapped memory is truncated. For diagnostic memory inspection only.
unsafe fn safe_read_bytes(addr: *const u8, len: usize) -> Option<Vec<u8>> {
    use winapi::um::memoryapi::VirtualQuery;
    use winapi::um::winnt::{
        MEMORY_BASIC_INFORMATION, PAGE_EXECUTE_READ, PAGE_EXECUTE_READWRITE, PAGE_READONLY,
        PAGE_READWRITE, PAGE_WRITECOPY,
    };
    if addr.is_null() {
        return None;
    }
    unsafe {
        let mut info: MEMORY_BASIC_INFORMATION = mem::zeroed();
        let ok = VirtualQuery(
            addr as *const _,
            &mut info,
            mem::size_of::<MEMORY_BASIC_INFORMATION>(),
        );
        if ok == 0 {
            return None;
        }
        let readable = info.Protect
            & (PAGE_READONLY
                | PAGE_READWRITE
                | PAGE_EXECUTE_READWRITE
                | PAGE_WRITECOPY
                | PAGE_EXECUTE_READ)
            != 0;
        if !readable {
            return None;
        }
        let region_end = info.BaseAddress as usize + info.RegionSize;
        let avail = region_end.saturating_sub(addr as usize);
        let read_len = len.min(avail);
        if read_len == 0 {
            return None;
        }
        Some(std::slice::from_raw_parts(addr, read_len).to_vec())
    }
}

/// Engine pieces for the adjustable middle-mouse grab pan.
///
/// BW's own grab pan works by having the middle-down handler store an anchor and install a pan
/// callback into `global_event_handlers[3]` (the "active drag" slot, shared with box selection);
/// the event loop calls that slot each pass the mouse moved while it's non-null, and the middle-up
/// handler nulls it.
///
/// Our middle-down hook lets the original run (so the cursor still hides for the duration) and then
/// swaps the slot to a callback of our own that pans the camera by the cursor's movement times the
/// user's gain, rather than BW's fraction-of-the-whole-map mapping. To make this a *relative* drag
/// that can pan arbitrarily far — and to keep the OS cursor off the window edge, where the
/// `MouseConfine` clip would otherwise pin it and stall the pan — the callback warps the cursor back
/// to the window center every pass and accumulates the offset from center. On middle-up we restore
/// the cursor to where the drag began.
///
/// The cursor is read and warped with the Win32 `GetCursorPos`/`SetCursorPos` (screen coordinates),
/// not the game's cursor globals: the warp needs to *set* the cursor in screen space anyway, and
/// this avoids depending on the `mouse_x`/`mouse_y` global analysis, which doesn't resolve on every
/// game build.
///
/// A drag can also end without middle-up firing (UI transitions that null or memset the handler
/// table), so the swapped-in callback keeps no resources needing teardown: it simply stops being
/// called. The only cost of a middle-up we miss is the cursor staying at center instead of being
/// restored, until the next input moves it.
struct GrabPan {
    middle_down_handler: VirtualAddress,
    middle_up_handler: VirtualAddress,
    /// Base of the event-handler function-pointer table; slot 3 is the active drag callback.
    global_event_handlers: Value<*mut u8>,
    /// Screen-coordinate cursor positions for the active warp drag, or `None` when no custom-gain
    /// drag is in progress (so middle-up doesn't restore the cursor when the feature is off).
    /// Written and read on the game thread only (input handling is single-threaded); the Mutex is
    /// just for `Sync`.
    anchor: Mutex<Option<GrabPanAnchor>>,
}

#[derive(Copy, Clone)]
struct GrabPanAnchor {
    /// Where the cursor was when the drag began, restored on middle-up.
    origin_x: i32,
    origin_y: i32,
    /// The window-center point the cursor is warped back to each pass; the per-pass camera movement
    /// is the cursor's offset from here.
    center_x: i32,
    center_y: i32,
    /// Leftover sub-pixel camera movement carried between passes, so a gain below 1 still pans on
    /// slow drags instead of truncating every fractional step to zero.
    frac_x: f32,
    frac_y: f32,
}

/// Installed into `global_event_handlers[3]` while a custom-sensitivity grab pan is active. The
/// event argument is unused: the cursor is read from the OS instead (see [`GrabPan`]).
unsafe extern "C" fn grab_pan_update_hook(_event: *mut bw::ControlEvent) {
    crate::bw::get_bw().grab_pan_update()
}

/// The per-player applied-skin table: 16 slots — the 12 storm player slots followed by 4
/// observer slots — of `stride` bytes each, holding the opaque skin state BW's unit rendering
/// reads to pick skinned graphics. The table is indexed by the lobby-stable *storm* identity,
/// not the randomized `players[]` id: natively each slot is filled from that member's lobby
/// slot-setup command, which SB sessions don't run — so only the local player's slot gets
/// filled (from local settings/ownership, during game startup), and every remote slot stays
/// zeroed (rendering default skins) until relayed bytes are written into it. The blob layout is
/// opaque to us — slots are only ever copied whole, never parsed.
struct SkinTable {
    base: Value<*mut u8>,
    /// Per-slot stride in bytes. Also the exact length of every blob read from or written into
    /// the table: rendering may read the full slot, so partial writes could mix two players'
    /// state and are never done.
    stride: usize,
}

/// Slot count of [`SkinTable`]: the 12 storm player slots plus the 4-slot observer block.
const SKIN_TABLE_SLOTS: usize = 16;

/// The player color preference that asks BW's color randomizer for a random color.
const PLAYER_COLOR_RANDOM: u8 = 0x16;

/// Byte offset within the `skins` local source at which the local player's own raw skin blob is
/// stored inline. The native create path copies this region into `player_skins[local]`; a
/// netcode-v2 bypassed-join client, whose create path is replaced and so never runs that copy,
/// copies it itself (see [`BwScr::fill_local_skin_from_source`]). Validated each game on any client
/// whose native fill did run (the host), so a version bump that moves it surfaces as a logged
/// mismatch rather than a silently wrong blob.
///
/// Per-arch because the `skins` struct's layout differs by pointer width, and the value is
/// architecture-verified, never guessed from the other: an offset off by even a few bytes copies
/// unrelated memory into the slot, which the digest then parses. `None` disables only the own-blob
/// fill (the host's native fill and the peer-blob relay are arch-agnostic and still work); the
/// bypassed-join own-skin relay stays off until the value is known.
///
/// Both values are found empirically by matching the source against the native fill at runtime
/// (the struct is anti-tamper-obfuscated, so static analysis can't recover them); the per-game
/// validation on the host re-checks them (see [`validate_local_skin_offset`](BwScr::validate_local_skin_offset)).
#[cfg(target_arch = "x86")]
const SKINS_LOCAL_BLOB_OFFSET: Option<usize> = Some(0x14);
#[cfg(target_arch = "x86_64")]
const SKINS_LOCAL_BLOB_OFFSET: Option<usize> = Some(0x28);

struct PaletteColorLookup {
    /// `u32 find_nearest_palette_color(const u8 (*palette)[4], u32 rgb_color)`, the hook target.
    find_nearest_palette_color: VirtualAddress,
    /// Pointer to the 256-byte table marking which palette indices the loaded tileset color-cycles.
    /// Allocated with the terrain and nulled when the terrain is freed, so it is null outside a
    /// loaded map.
    is_cycling_color_table: Value<*mut u8>,
}

struct MinimapDrawHooks {
    /// Dispatcher: draws the local player's units and lone sprites inline and calls the two
    /// per-player helpers for everyone else. Takes no argument this feature relies on.
    draw_minimap_units: VirtualAddress,
    /// Per-player helper for high/neutral player ids (8..12). `cdecl(player)`.
    draw_minimap_player_units: VirtualAddress,
    /// Per-player helper for other non-local main players. `cdecl(player)`.
    draw_minimap_main_player_units: VirtualAddress,
}

/// RAII guard for a temporary `rgb_colors` / `use_rgb_colors` swap. Holds the array's contents and
/// the switch from just before the swap and restores both on drop, after the bracketed native call
/// has read the swapped-in state. Created only by [`BwScr::swap_rgb_colors`], which validated the
/// pointer on the same thread just before the swap.
///
/// Used by the minimap-only team-color mode (see [`BwScr::begin_minimap_team_colors`]) and by
/// replay saving (see [`BwScr::begin_replay_save_colors`]).
struct RgbColorSwap {
    rgb_ptr: *mut bw::RgbColors,
    saved_rgb: bw::RgbColors,
    use_rgb_colors: Value<u8>,
    saved_use_rgb: u8,
}

impl Drop for RgbColorSwap {
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

/// The per-player record of what the last unit cost check found a unit to cost, which spending
/// the resources and the AI's budget checks read afterwards, and the check of a player's
/// resources against that record.
struct UnitCostCache {
    minerals: Value<*mut u32>,
    gas: Value<*mut u32>,
    supply: Value<*mut u32>,
    /// `(player, show_error) -> bool`; with `show_error`, a player that can't afford the costs on
    /// record is shown the message for whichever resource they lack.
    check_resources: unsafe extern "C" fn(u32, u32) -> u32,
}

/// Players [`UnitCostCache`] keeps a record for.
const UNIT_COST_CACHE_PLAYERS: usize = 12;

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

/// SC:R's list of spawned dialogs, its first dialog read from the game every time it is asked for.
///
/// Pressing a dialog's button can close dialogs and spawn others, which moves the list's head: a
/// first dialog read before such a press can be one already closed and deleted, whose own link still
/// leads into the list. Walking from it reaches the dead dialog first, and a press sent to that one
/// runs its closing code a second time.
#[derive(Copy, Clone)]
pub struct DialogList {
    head: Option<Value<*mut bw::Dialog>>,
}

impl DialogList {
    pub fn first(self) -> Option<bw_dat::dialog::Dialog> {
        unsafe {
            self.head
                .map(|x| x.resolve())
                .filter(|x| !x.is_null())
                .map(|x| bw_dat::dialog::Dialog::new(x))
        }
    }
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

impl BwValue for u16 {
    fn from_usize(val: usize) -> Self {
        val as u16
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

/// How a chat message injected into the game is shown and recorded.
#[derive(Copy, Clone, PartialEq, Eq)]
#[repr(u8)]
enum ChatInjection {
    /// Shown, and written to the replay with the step that injects it.
    Live,
    /// Shown, but not written to the replay: the step it arrived at hasn't run.
    ShowWhileStalled,
    /// Written to the replay with the step that injects it, without being shown again.
    RecordShown,
}

/// The decoder of an obfuscated sprite coordinate (`Custom_0` being the stored word), cut down to
/// the low 16 bits a coordinate is. The game's decoders run to dozens of terms, most of them
/// shifted entirely out of those bits, and every decode interprets the whole tree, so leaving the
/// simplifier to drop those terms once makes each decode a fraction of the work.
fn sprite_coordinate_decoder(
    ctx: scarf::OperandCtx<'static>,
    decoder: scarf::Operand<'_>,
) -> Value<*mut *mut scr::Sprite> {
    Value::new(ctx, ctx.and_const(ctx.copy_operand(decoder), 0xffff))
}

pub(crate) unsafe fn resolve_operand(op: scarf::Operand<'_>, custom: &[usize]) -> usize {
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

/// The BW game player id of a `players[]` slot index.
///
/// Player slots `0..8` are their own id, but observers are out-of-band: slots `12..16` have the
/// ids `0x80..0x84` (128-131). Native code keyed off a game player id — chat name rendering,
/// command attribution — recognizes an observer only by that id range, and treats the raw slot
/// indices 12-15 as some other (nonexistent) player, so a slot index must be converted before it
/// is used anywhere a game player id is expected.
fn game_player_id_for_slot(slot: u8) -> u8 {
    match slot {
        12..=15 => 0x80 + (slot - 12),
        other => other,
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
            if sent {
                debug!(
                    "netcode v2: chat queued for peers, to {target:?}, {} bytes",
                    text.len()
                );
            } else {
                debug!("netcode v2: chat_out channel unavailable; message not queued for peers");
            }
            let deferred = netcode_v2::with_turn_state(|s| {
                let deferred = s.predicts_inputs();
                if deferred {
                    s.queue_local_chat_echo(target, text.to_string());
                }
                deferred
            })
            .unwrap_or(false);
            if deferred {
                return true;
            }
            let local_storm = StormPlayerId(self.local_storm_id.resolve() as u8);
            if !self.inject_chat_message(local_storm, target, text) {
                debug!("netcode v2: local chat echo dropped; local storm id unresolved");
            }
            true
        }
    }

    /// Injects the local echo of this client's own chat messages that
    /// [`send_chat_message`](Self::send_chat_message) left for the next step.
    unsafe fn apply_local_chat_echoes(&self) {
        unsafe {
            let Some(texts) = netcode_v2::with_turn_state(|s| s.take_local_chat_echoes()) else {
                return;
            };
            let local_storm = StormPlayerId(self.local_storm_id.resolve() as u8);
            for (target, text) in texts {
                if !self.inject_chat_message(local_storm, target, &text) {
                    debug!("netcode v2: local chat echo dropped; local storm id unresolved");
                }
            }
        }
    }

    /// Shows the chat that arrived, and this client's own, while a game that predicts inputs is
    /// stalled waiting for turns, rather than holding it until the step can run.
    unsafe fn show_chat_while_stalled(&self) {
        unsafe {
            let local_storm = StormPlayerId(self.local_storm_id.resolve() as u8);
            let echoes = netcode_v2::with_turn_state(|s| s.take_local_chat_echoes())
                .unwrap_or_default()
                .into_iter()
                .map(|(target, text)| (local_storm, target, text));
            let inbound = self.visible_chat_inbound();
            let mut shown = self.chat_shown_while_stalled.lock();
            for (storm, target, text) in echoes.chain(inbound) {
                if self.inject_chat(storm, target, &text, ChatInjection::ShowWhileStalled) {
                    shown.push((storm, target, text));
                }
            }
        }
    }

    /// Records the chat [`show_chat_while_stalled`](Self::show_chat_while_stalled) showed, now that
    /// the step it waited at runs.
    unsafe fn record_chat_shown_while_stalled(&self) {
        unsafe {
            let shown = std::mem::take(&mut *self.chat_shown_while_stalled.lock());
            for (storm, target, text) in shown {
                if !self.inject_chat(storm, target, &text, ChatInjection::RecordShown) {
                    debug!("netcode v2: chat shown while stalled not recorded; its sender left");
                }
            }
        }
    }

    /// Injects one chat message — attributed to `storm_player` — as the classic chat record, so it
    /// renders on the overlay with correct attribution and lands in the replay. Used for both a
    /// peer's message arriving over the netcode v2 relay (`apply_chat_inbound`) and this client's
    /// own local echo (`send_chat_message`, with `storm_player` set to this client's own storm id)
    /// — one path renders both, so the two can never diverge in formatting or attribution.
    ///
    /// `target` is the scope the message was sent with, which only the sender knows: it is carried
    /// here so the line recorded in the chat history says who it was addressed to, the way the
    /// scope tag over it reads.
    ///
    /// Returns `false` (injecting nothing) when `storm_player` can't be resolved to a `players[]`
    /// slot right now — see [`unique_player_for_storm`](Self::unique_player_for_storm) — e.g. it
    /// already left.
    unsafe fn inject_chat_message(
        &self,
        storm_player: StormPlayerId,
        target: netcode_v2::ChatTarget,
        text: &str,
    ) -> bool {
        unsafe { self.inject_chat(storm_player, target, text, ChatInjection::Live) }
    }

    /// [`inject_chat_message`](Self::inject_chat_message), shown and recorded as `injection` says.
    unsafe fn inject_chat(
        &self,
        storm_player: StormPlayerId,
        target: netcode_v2::ChatTarget,
        text: &str,
        injection: ChatInjection,
    ) -> bool {
        unsafe {
            let Some(unique_player) = self.unique_player_for_storm(storm_player) else {
                return false;
            };
            // The record's sender field is a game player *id*, not a `players[]` index — the
            // native renderer's name/format path only recognizes observers by their id range
            // (0x80..0x84); an index in 12..16 falls through to its nameless bare-text path.
            let sender_id = game_player_id_for_slot(unique_player);
            // Asked before the injection, because the injection is what prints the line and the
            // print hook takes this same lock to decide whether to suppress it. The answer is what
            // keeps a muted or blocked player's message out of the history as well as off screen.
            let suppressed = self
                .chat_manager
                .lock()
                .is_sender_filtered(sender_id as u32);
            // The record's text field is fixed-size, so a long message reaches the screen (and the
            // replay) truncated; the history holds that same truncation rather than the original.
            let text = commands::truncate_utf8(text, commands::CHAT_TEXT_CAPACITY);
            let record = build_chat_record(sender_id, text);
            // `0`: a live command not yet on the replay's command log, so the native command
            // processor appends it (`add_to_replay_data`) the same as any other in-game command —
            // see `process_injected_game_command`'s doc comment for the full reasoning. `1` shows
            // it without recording it.
            let recorded = match injection {
                ChatInjection::ShowWhileStalled => 1,
                ChatInjection::Live | ChatInjection::RecordShown => 0,
            };
            self.chat_injection
                .store(injection as u8, Ordering::Relaxed);
            let injected = self.process_injected_game_command(&record, storm_player, recorded);
            self.chat_injection
                .store(ChatInjection::Live as u8, Ordering::Relaxed);
            if injected
                && recorded == 0
                && let Some((_, false)) = rollback_step()
            {
                let step = self.netcode_v2.game_frame_count.resolve();
                netcode_v2::with_turn_state(|s| {
                    s.note_injected_chat(step, storm_player, target, text)
                });
            }
            // The player sees a line once: a step simulated again injects it again, and chat shown
            // while stalled is injected a second time to record it, but neither shows anything new.
            let first_shown =
                injected && !rollback_resimulating() && injection != ChatInjection::RecordShown;
            let own = storm_player.0 as u32 == self.local_storm_id.resolve();
            #[cfg(debug_assertions)]
            if first_shown {
                netcode_v2::with_turn_state(|s| {
                    s.record_chat(crate::debug_control::DebugChatLogEntry {
                        sender_game_id: sender_id,
                        text: text.to_string(),
                        own,
                    })
                });
            }
            if first_shown && !suppressed {
                self.record_chat_history_line(sender_id, unique_player, own, target, text);
            }
            injected
        }
    }

    /// Seeks a replay to the frame its setup asked it to start at, through the same command the
    /// replay UI's own seeking sends. Only the first start of playback seeks: a seek SC:R handles
    /// itself restarts playback from the beginning, and must not be sent on to the start frame
    /// again.
    unsafe fn seek_to_replay_start_frame(&self) {
        unsafe {
            if self.replay_start_seek_sent.swap(true, Ordering::Relaxed) {
                return;
            }
            let Some(frame) = game_thread::replay_start_frame() else {
                return;
            };
            // Seeking to the last frame or past it would end the replay before it is shown.
            let header = self.replay_header();
            let frame = match header.is_null() {
                true => frame,
                false => frame.min((*header).replay_end_frame.saturating_sub(1)),
            };
            if (*self.game()).frame_count >= frame {
                return;
            }
            debug!("Seeking replay to its start frame {frame}");
            let mut command = [commands::id::REPLAY_SEEK, 0, 0, 0, 0];
            LittleEndian::write_u32(&mut command[1..], frame);
            (self.send_command)(command.as_ptr(), command.len());
        }
    }

    /// Records the [`replay::notice_lines`](crate::replay::notice_lines) into this client's replay
    /// without showing them, under [`commands::REPLAY_NOTICE_SENDER`] so the native chat handler
    /// renders them as bare text on playback.
    ///
    /// Must run before the game's first logic step: that puts the lines ahead of every rollback
    /// snapshot, so no rollback rewinds the replay log past them and no re-simulation records them
    /// again.
    unsafe fn record_replay_notice(&self) {
        unsafe {
            let local_storm = StormPlayerId(self.local_storm_id.resolve() as u8);
            self.chat_injection
                .store(ChatInjection::RecordShown as u8, Ordering::Relaxed);
            for line in crate::replay::notice_lines(env!("SHIELDBATTERY_VERSION")) {
                let record = build_chat_record(commands::REPLAY_NOTICE_SENDER, &line);
                if !self.process_injected_game_command(&record, local_storm, 0) {
                    warn!("Replay notice not recorded; local storm id unresolved");
                    break;
                }
            }
            self.chat_injection
                .store(ChatInjection::Live as u8, Ordering::Relaxed);
        }
    }

    /// Adds one player's message to the chat history, with the sender and the scope the screen
    /// showed it under. Called only for a message that was both injected and not suppressed, so the
    /// history and the screen can never disagree about what the game said.
    unsafe fn record_chat_history_line(
        &self,
        sender_id: u8,
        unique_player: u8,
        own: bool,
        target: netcode_v2::ChatTarget,
        text: &str,
    ) {
        unsafe {
            let line = chat_history::ChatLine {
                game_frame: self.current_game_frame(),
                kind: chat_history::ChatLineKind::Player {
                    sender_game_id: sender_id,
                    sender_name: self.player_display_name(unique_player),
                    own,
                    scope: self.chat_scope_for(target, own),
                },
                text: text.to_string(),
            };
            self.chat_history.lock().push(line);
        }
    }

    /// Records a line the game printed that carries no chat sender — a player leaving, an alliance
    /// changing — which is what SC:R's own log holds beside the chat. A player's own message is
    /// recorded by [`inject_chat_message`](Self::inject_chat_message) instead, which knows who it
    /// was addressed to; the id ranges skipped here are exactly the ones
    /// [`chat::ChatManager`] treats as chat senders.
    unsafe fn record_chat_history_system_line(&self, text: &str, player: u32) {
        unsafe {
            if matches!(player, 0..=11 | 128..=131) {
                return;
            }
            let line = chat_history::ChatLine {
                game_frame: self.current_game_frame(),
                kind: chat_history::ChatLineKind::System,
                text: text.to_string(),
            };
            self.chat_history.lock().push(line);
        }
    }

    /// Records a line a replay printed. A replay's chat comes from its recorded commands rather than
    /// from anything injected, so the printed line is the only record of it: one with a chat sender
    /// is that player's message, printed after their name, and anything else is a notice.
    unsafe fn record_replay_chat_history_line(&self, text: &str, player: u32) {
        unsafe {
            let game_frame = self.current_game_frame();
            let player_index = match player {
                0..=11 => Some(player),
                128..=131 => Some(player - 128 + 12),
                _ => None,
            };
            let line = match player_index {
                Some(player_index) => {
                    let sender_name = self.player_display_name(player_index as u8);
                    chat_history::ChatLine {
                        game_frame,
                        kind: chat_history::ChatLineKind::Player {
                            sender_game_id: player as u8,
                            own: false,
                            // The game's classic chat record carries no scope: a replay shows its
                            // watcher every line as said to everyone.
                            scope: chat_history::ChatScope::All,
                            sender_name: sender_name.clone(),
                        },
                        text: chat_history::strip_sender_prefix(text, &sender_name).to_string(),
                    }
                }
                None => chat_history::ChatLine {
                    game_frame,
                    kind: chat_history::ChatLineKind::System,
                    text: text.to_string(),
                },
            };
            self.chat_history.lock().push_replayed(line);
        }
    }

    /// The scope a chat history line records for a message sent with `target`.
    ///
    /// A single-recipient message names its recipient only when the local player sent it: an
    /// inbound one reached this client because this client was addressed, so the only name its mask
    /// could yield is the reader's own.
    unsafe fn chat_scope_for(
        &self,
        target: netcode_v2::ChatTarget,
        own: bool,
    ) -> chat_history::ChatScope {
        unsafe {
            match target {
                netcode_v2::ChatTarget::All => chat_history::ChatScope::All,
                netcode_v2::ChatTarget::Allies => chat_history::ChatScope::Allies,
                netcode_v2::ChatTarget::Observers => chat_history::ChatScope::Observers,
                netcode_v2::ChatTarget::Players(mask) => chat_history::ChatScope::Players {
                    recipient: own
                        .then(|| mask.single_member())
                        .flatten()
                        .and_then(|slot| {
                            netcode_v2::with_turn_state(|s| s.storm_id_for_slot(slot)).flatten()
                        })
                        .and_then(|storm| self.unique_player_for_storm(storm))
                        .map(|unique_player| self.player_display_name(unique_player)),
                },
            }
        }
    }

    /// A `players[]` slot's name as the overlay should show it, with a placeholder for the slots
    /// the game left nameless.
    unsafe fn player_display_name(&self, unique_player: u8) -> String {
        unsafe {
            let name = bw::player_name(self.players().add(unique_player as usize));
            if name.is_empty() {
                format!("Player {}", unique_player + 1)
            } else {
                name.into_owned()
            }
        }
    }

    /// The frame the game is on, or 0 before there is a game to ask.
    unsafe fn current_game_frame(&self) -> u32 {
        unsafe {
            let game = self.game();
            if game.is_null() {
                0
            } else {
                (*game).frame_count
            }
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

    /// The value to write to `command_user` for a command injected under the sender's `players[]`
    /// index (from [`unique_player_for_storm`](Self::unique_player_for_storm)). In a team game a
    /// normal player's commands run under that team's main player; otherwise it is the sender's own
    /// `players[]` index.
    ///
    /// For an observer this stays the raw `players[]` index (12..15), NOT the out-of-band game
    /// player id (0x80..0x83): the [`ProcessGameCommands`] hook classifies any `command_user >= 128`
    /// as an observer turn and strips all but a few command ids from it (chat among those removed),
    /// so writing the 0x80-ranged id here would drop the very command being injected. Attribution
    /// still uses the 0x80-ranged id where it belongs — the chat *record's* sender byte, which the
    /// native renderer reads — via [`game_player_id_for_slot`] in
    /// [`inject_chat_message`](Self::inject_chat_message).
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
            for (sender_storm, target, text) in self.visible_chat_inbound() {
                if !self.inject_chat_message(sender_storm, target, &text) {
                    debug!(
                        "netcode v2: chat from storm {sender_storm:?} could not be attributed to \
                         a players[] slot; dropping"
                    );
                }
            }
        }
    }

    /// Drains the chat that has arrived from peers, keeping each message the local player should
    /// see, with its sender's storm id and the scope it was sent to.
    unsafe fn visible_chat_inbound(&self) -> Vec<netcode_v2::InjectedChat> {
        unsafe {
            let Some(messages) = netcode_v2::with_turn_state(|s| s.drain_chat_inbound(true)) else {
                return Vec::new(); // no live session
            };
            let mut visible = Vec::with_capacity(messages.len());
            for (slot, chat) in messages {
                let Some(sender_storm) =
                    netcode_v2::with_turn_state(|s| s.storm_id_for_slot(slot)).flatten()
                else {
                    debug!("netcode v2: chat from unmapped slot {slot:?}; dropping");
                    continue;
                };
                let target = netcode_v2::ChatTarget::from_wire(chat.target_kind, chat.target_slot);
                if self.chat_target_visible(sender_storm, target) {
                    visible.push((sender_storm, target, chat.text));
                } else {
                    debug!(
                        "netcode v2: chat from storm {sender_storm:?} sent to {target:?} isn't \
                         for this player; dropping"
                    );
                }
            }
            visible
        }
    }

    /// Validates [`SKINS_LOCAL_BLOB_OFFSET`] once per game against the authoritative native fill:
    /// on a client whose `player_skins[local]` slot BW itself populated (the host), the blob at
    /// `skins + SKINS_LOCAL_BLOB_OFFSET` must equal that slot. A mismatch means the offset is wrong
    /// for this game version — warned, so it surfaces in the wild without corrupting anything
    /// (the fill never overwrites a populated slot, so a stale offset can only fail to fill). A
    /// no-op on a client whose slot is empty (nothing authoritative to check against yet); the
    /// once-flag is cleared in that case so a later round retries once the fill has run. Every read
    /// is `VirtualQuery`-bounded, so an unmapped address is skipped, never faulted.
    fn validate_local_skin_offset(&self) {
        if self.skin_offset_validated.swap(true, Ordering::Relaxed) {
            return;
        }
        let (Some(offset), Some(table), Some(skins)) = (
            SKINS_LOCAL_BLOB_OFFSET,
            self.skin_table.as_ref(),
            self.skins.as_ref(),
        ) else {
            return;
        };
        unsafe {
            let table_base = table.base.resolve();
            let local_slot = self.local_storm_id.resolve() as usize;
            if table_base.is_null() || local_slot >= SKIN_TABLE_SLOTS {
                return;
            }
            let stride = table.stride;
            let Some(native) = safe_read_bytes(table_base.add(local_slot * stride), stride) else {
                return;
            };
            // Only a slot BW itself filled is an authoritative reference. Before that (or on a
            // bypassed-join client, which never gets a native fill) there is nothing to validate
            // against — retry on a later round.
            if !native.iter().any(|&b| b != 0) {
                self.skin_offset_validated.store(false, Ordering::Relaxed);
                return;
            }
            let skins_base = skins.resolve();
            if skins_base.is_null() {
                return;
            }
            let source = safe_read_bytes(skins_base.add(offset), stride);
            if source.as_deref() != Some(native.as_slice()) {
                warn!(
                    "netcode v2: skins+{offset:#x} does not match the native local skin blob; the \
                     offset is likely wrong for this game version"
                );
            }
        }
    }

    /// Populates the local player's own raw skin slot from the `skins` local source, for a client
    /// whose native create path didn't (a netcode-v2 bypassed-join client — its join is replaced,
    /// so the native `skins`→`player_skins[local]` copy never runs, leaving the slot zero and the
    /// player invisibly-skinned to peers). Copies the inline blob at
    /// [`SKINS_LOCAL_BLOB_OFFSET`] into the local slot so it is both digested locally and available
    /// to broadcast. Must run before `init_game`'s one-shot digest.
    ///
    /// No-op when the slot already holds data — the host's native fill ran, and its blob is
    /// authoritative, so this never overwrites a good blob (which also means a wrong offset can
    /// only ever fail to fill, never corrupt). Also a no-op when [`SKINS_LOCAL_BLOB_OFFSET`] is
    /// unknown for this architecture, the source/table is unlocated, or the source blob is empty
    /// (the account owns/selected no skin).
    fn fill_local_skin_from_source(&self) {
        let (Some(offset), Some(table), Some(skins)) = (
            SKINS_LOCAL_BLOB_OFFSET,
            self.skin_table.as_ref(),
            self.skins.as_ref(),
        ) else {
            return;
        };
        unsafe {
            let table_base = table.base.resolve();
            let local_slot = self.local_storm_id.resolve() as usize;
            if table_base.is_null() || local_slot >= SKIN_TABLE_SLOTS {
                return;
            }
            let stride = table.stride;
            let dst = table_base.add(local_slot * stride);
            // Never clobber a native fill: the host already holds an authoritative blob here.
            if std::slice::from_raw_parts(dst, stride)
                .iter()
                .any(|&b| b != 0)
            {
                return;
            }
            let skins_base = skins.resolve();
            if skins_base.is_null() {
                return;
            }
            let Some(blob) = safe_read_bytes(skins_base.add(offset), stride) else {
                return;
            };
            // A shorter read means the source region is smaller than a slot — never expected, but
            // a partial copy could mix state, so skip it. An all-zero source means no skin.
            if blob.len() != stride || !blob.iter().any(|&b| b != 0) {
                return;
            }
            std::ptr::copy_nonoverlapping(blob.as_ptr(), dst, stride);
            debug!(
                "netcode v2: filled local skin slot {local_slot} from skins+{offset:#x} \
                 ({stride} bytes)"
            );
        }
    }

    /// Runs one round of the peer-skin exchange from the pre-`init_game` lobby-init loop: broadcast
    /// this client's own blob (once its slot is populated) and write any peers' arrived blobs into
    /// the raw skin table. Called each lobby-init step so received blobs land in the table *before*
    /// `init_game`'s one-shot digest reads it into the render struct — the only point at which a
    /// written blob actually renders. The native fill populates the local slot during this same
    /// window (the host's is already present when the loop starts), so the local broadcast goes out
    /// early enough for peers to apply it before their own digest. Applying is idempotent, so the
    /// in-game receive step keeps draining too (covering a reconnect's replayed blobs).
    pub(crate) fn exchange_skins_during_lobby_init(&self) {
        self.validate_local_skin_offset();
        self.fill_local_skin_from_source();
        self.broadcast_local_skin_once();
        unsafe { self.apply_skins_inbound() };
    }

    /// How many exchange rounds [`broadcast_local_skin_once`](Self::broadcast_local_skin_once)
    /// waits on a still-zeroed local skin slot before sending it as-is. The slot is normally
    /// populated by the time the first round runs (the host's native fill, or
    /// [`fill_local_skin_from_source`](Self::fill_local_skin_from_source) on a bypassed-join
    /// client), but this bounds the wait for the rare case it isn't yet — and a player who owns no
    /// skin legitimately keeps an all-zero slot forever, so the wait must terminate. An eventual
    /// zero send costs nothing (peers render default skins, exactly as if nothing were sent).
    const SKIN_BROADCAST_MAX_WAIT_STEPS: u32 = 240;

    /// Broadcasts this client's own applied-skin blob to peers, exactly once per game. The local
    /// slot is populated before this runs — by BW's native create-path fill on the host, or by
    /// [`fill_local_skin_from_source`](Self::fill_local_skin_from_source) on a bypassed-join client
    /// — so it reads the slot and sends. If the slot is somehow still zero, it retries up to
    /// [`SKIN_BROADCAST_MAX_WAIT_STEPS`](Self::SKIN_BROADCAST_MAX_WAIT_STEPS) rounds, then sends
    /// as-is (all zero being the legitimate state for a player with no skin). Sending late costs
    /// nothing: the relay retains the latest blob per slot and replays it to any member, so arrival
    /// time only affects when peers' units pop from default to skinned.
    ///
    /// UMS keeps map-authored presentation fully native, mirroring the color handling, and a
    /// replay/session-less game has no turn state, so the submit lands nowhere (`submitted:
    /// false` in the log is expected there, not a fault).
    fn broadcast_local_skin_once(&self) {
        let attempts = self.skin_broadcast_attempts.load(Ordering::Relaxed);
        if attempts == u32::MAX {
            return;
        }
        if game_thread::is_ums() {
            self.skin_broadcast_attempts
                .store(u32::MAX, Ordering::Relaxed);
            return;
        }
        let Some(blob) = self.read_local_skin_blob() else {
            debug!(
                "netcode v2: no local skin blob to relay (table unresolved or local id out of \
                 table range)"
            );
            self.skin_broadcast_attempts
                .store(u32::MAX, Ordering::Relaxed);
            return;
        };
        let has_data = blob.iter().any(|&b| b != 0);
        if !has_data && attempts < Self::SKIN_BROADCAST_MAX_WAIT_STEPS {
            self.skin_broadcast_attempts
                .store(attempts + 1, Ordering::Relaxed);
            return;
        }
        self.skin_broadcast_attempts
            .store(u32::MAX, Ordering::Relaxed);
        let len = blob.len();
        let sent = netcode_v2::with_turn_state(|s| s.submit_local_skin(blob)).unwrap_or(false);
        // An all-zero send here means the slot never filled within the wait — the expected
        // outcome for a player with no skins, and harmless either way.
        debug!(
            "netcode v2: local skin blob read ({len} bytes, {}) after {attempts} receive steps, \
             submitted: {sent}",
            if has_data { "has data" } else { "all zero" },
        );
    }

    /// Peer skin blobs delivered over the netcode v2 relay: drains what's arrived (see
    /// [`TurnState::drain_skin_inbound`](netcode_v2::TurnState::drain_skin_inbound)) and writes
    /// each into its sender's slot of the applied-skin table. Run once per receive on the game
    /// thread, alongside the chat application.
    ///
    /// The table slot is the sender's *storm* id — the lobby-stable identity the table is
    /// indexed by (native code fills it from lobby-time slot-setup commands, before `players[]`
    /// indices randomize) — so the sender's rp2 slot resolves through the storm map only, never
    /// to a `players[]` id. Applying is safe at any frame: the table is non-synced cosmetic
    /// state read only by rendering, and whether peers' skins display at all remains the local
    /// viewer's own skins-enabled/ownership gating inside BW's skin lookup.
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
                if self.write_player_skin_blob(sender_storm.0, &blob) {
                    // An all-zero blob is normal for a sender with no skins; logged so a peer
                    // whose skin doesn't render can be told apart from a blob that never arrived.
                    debug!(
                        "netcode v2: applied skin blob from slot {slot:?} to storm slot \
                         {sender_storm:?} ({} bytes, {})",
                        blob.len(),
                        if blob.iter().any(|&b| b != 0) {
                            "has data"
                        } else {
                            "all zero"
                        },
                    );
                } else {
                    debug!(
                        "netcode v2: skin blob from slot {slot:?} not applied (table missing or \
                         blob length {} != slot stride)",
                        blob.len()
                    );
                }
            }
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

    /// Gets the textures game init just created onto the GPU before the game loop starts, drawing
    /// loading screen frames to do it.
    ///
    /// Game init creates around 2,000 textures (consoles, tileset, UI) with no contents; each
    /// records its copy into the renderer's current frame, and the frame's present submits them
    /// all. Left to the game loop, that's one frame spending 60-110 ms in the copies and a later
    /// present blocking as long again while the GPU works through them, all during the first
    /// steps, when every player still waits on every other's turns.
    ///
    /// The first frame here submits the copies, and drawing it creates a few more textures whose
    /// copies go with the second. The renderer keeps three frames in flight: before a present
    /// returns, it waits for the GPU to finish the frame presented two before it, whose resources
    /// the next frame reuses. So once the fourth present returns, the GPU has finished both
    /// frames' copies.
    ///
    /// Done before the game loop's own init, which is where the logic step timer starts, so the
    /// time spent here holds the game's start back rather than its first steps.
    unsafe fn settle_init_uploads(&self) {
        const SETTLE_FRAMES: u32 = 4;
        self.init_uploads_settling.store(true, Ordering::Release);
        for _ in 0..SETTLE_FRAMES {
            unsafe { self.force_redraw_during_init() };
        }
        self.init_uploads_settling.store(false, Ordering::Release);
    }

    pub fn set_countdown_start(&self, time: Instant) {
        let mut c = self.countdown_start.lock();
        *c = Some(time);
    }

    /// What the network quality chip shows, or `None` when it isn't drawn: outside live games (a
    /// replay), and while the player has the game's turn rate readout off.
    fn net_quality_view(&self) -> Option<NetQualityView> {
        // How long after the game last formatted its turn rate readout the chip stays up. The game
        // formats it on every frame it draws it, so a lapse this long means the readout was turned
        // off.
        const READOUT_LAPSE: Duration = Duration::from_millis(250);
        let formatted_at = (*self.turn_rate_readout_at.lock())?;
        if formatted_at.elapsed() > READOUT_LAPSE {
            return None;
        }
        let fps_font_height = unsafe { self.small_font_height() };
        netcode_v2::with_turn_state(|s| NetQualityView {
            // The pipe holds the turn every command waits for anyway (a command issued on one frame
            // runs on the next, as in single player), which isn't delay the connection added. A solo
            // game's pipe is just that turn.
            delay: s.pipe_depth().saturating_sub(1),
            rollback: if s.predicts_inputs() {
                crate::rollback_live::shown_rollback()
            } else {
                0
            },
            rated_rollback: if s.predicts_inputs() {
                crate::rollback_live::rated_rollback()
            } else {
                0
            },
            fps_font_height,
        })
    }

    /// The line height of the game's smallest font, which its FPS and turn rate readouts are drawn
    /// in: the max height byte of the font's header. `None` until the font is loaded.
    unsafe fn small_font_height(&self) -> Option<u8> {
        unsafe {
            let small_font = *self.fonts.resolve();
            if small_font.is_null() || (*small_font).unk0.is_null() {
                return None;
            }
            Some(*((*small_font).unk0 as *const u8).add(0xb))
        }
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

    /// The whole unit array, which is what a unique id has to be looked up in. `None` until the
    /// game allocates it.
    unsafe fn unit_array(&self) -> Option<bw_dat::UnitArray> {
        unsafe {
            match self.units.resolve() {
                vector if vector.is_null() => None,
                vector => Some(bw_dat::UnitArray::new(
                    (*vector).data as *mut bw::Unit,
                    (*vector).length,
                )),
            }
        }
    }

    /// Keeps the game's view on the unit a watcher asked it to follow, starting on `start` when
    /// they have just asked.
    ///
    /// Following ends once the unit is gone or out of sight inside something, and once the view is
    /// anywhere but where following it left the view the frame before: the watcher (or something
    /// they asked for) has moved it, and following on would pull it straight back.
    unsafe fn follow_unit(&self, start: Option<Unit>) {
        unsafe {
            let mut followed = self.followed_unit.lock();
            let Some(units) = self.unit_array() else {
                *followed = None;
                return;
            };
            if let Some(unit) = start {
                *followed = Some(FollowedUnit {
                    unique_id: units.to_unique_id(unit),
                    left_screen_at: None,
                });
            }
            let Some(follow) = followed.as_mut() else {
                return;
            };
            let screen = (self.screen_x.resolve(), self.screen_y.resolve());
            let unit = units
                .get_by_unique_id(follow.unique_id)
                .filter(|unit| !unit.is_hidden());
            match unit {
                Some(unit) if follow.left_screen_at.is_none_or(|left| left == screen) => {
                    self.center_screen(&unit.position());
                    follow.left_screen_at =
                        Some((self.screen_x.resolve(), self.screen_y.resolve()));
                }
                _ => *followed = None,
            }
        }
    }

    /// The furthest down the view's top edge may scroll, in map pixels: the game's own bound where
    /// it can be read, which counts the room past the map's bottom edge. `None` for a map shorter
    /// than the view.
    unsafe fn screen_max_y(&self) -> Option<u32> {
        unsafe {
            match &self.bottom_overpan {
                Some(overpan) => Some(overpan.scroll_max_y.resolve()),
                None => self
                    .map_height_pixels
                    .resolve()
                    .checked_sub(self.game_screen_height_bwpx.resolve()),
            }
        }
    }

    /// Lets the view scroll past the map's bottom edge by `share` of the view's height, less a
    /// sliver, so what is at the bottom of the map can be brought out from under the overlay's
    /// bottom panels while the map's last pixels still reach under them rather than leaving a gap.
    ///
    /// The room is the game's own, kept in tiles at default zoom, which every clamp on the view's
    /// position counts through the bound it feeds. Tiles are coarser than the panels' edge, so the
    /// room is set to the tiles that cover the share and the bound itself to the exact pixel. Both
    /// stay short of the view's own height less a tile, past which the game's fog pass would start
    /// reading rows below the map's last. A share of nothing leaves the game's own bound alone.
    unsafe fn set_bottom_overpan(&self, share: f32) {
        unsafe {
            let Some(overpan) = &self.bottom_overpan else {
                return;
            };
            let zoom = self.zoom.resolve();
            let view_height = self.game_screen_height_bwpx.resolve() as f32;
            let room = (share.max(0.0) * view_height - OVERPAN_UNDERLAP)
                .clamp(0.0, (view_height - TILE_PIXELS).max(0.0));
            let tiles = (room * zoom / TILE_PIXELS).ceil() as u16;
            let mut moved = false;
            if overpan.padding_tiles.resolve() != tiles {
                overpan.padding_tiles.write(tiles);
                (overpan.update_scroll_bounds)();
                moved = true;
            }
            let map_height = self.map_height_pixels.resolve() as f32;
            if room > 0.0 && map_height + room >= view_height {
                let max_y = (map_height + room - view_height).round() as u32;
                if overpan.scroll_max_y.resolve() != max_y {
                    overpan.scroll_max_y.write(max_y);
                    debug!(
                        "View may scroll {room} pixels ({tiles} tiles) past the map's bottom edge: \
                         top edge at most {max_y} for a map {map_height} tall and a view \
                         {view_height} tall",
                    );
                    moved = true;
                }
            }
            if moved {
                // Through the game's own move, which redraws the view for a position the new
                // bound pulled in.
                (self.move_screen)(self.screen_x.resolve(), self.screen_y.resolve());
            }
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
            let max_height = match self.screen_max_y() {
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

    /// Answers the unit cost check the way it answers for a unit that costs nothing and needs no
    /// supply: records zero mineral and gas costs for `player`, and a zero supply cost if supply
    /// is being checked, then checks the player's resources against that record. `None` for a
    /// player the record has no entry for.
    pub unsafe fn check_free_unit_resources(
        &self,
        player: u8,
        check_supply: bool,
        show_error: u32,
    ) -> Option<u32> {
        unsafe {
            let index = usize::from(player);
            if index >= UNIT_COST_CACHE_PLAYERS {
                return None;
            }
            let cache = &self.unit_cost_cache;
            *cache.minerals.resolve().add(index) = 0;
            *cache.gas.resolve().add(index) = 0;
            if check_supply {
                *cache.supply.resolve().add(index) = 0;
            }
            Some((cache.check_resources)(player.into(), show_error))
        }
    }

    pub unsafe fn move_unit(&self, unit: Unit, pos: &bw::Point) {
        self.move_unit.call3(*unit, pos.x as i32, pos.y as i32)
    }

    /// Runs after the game's middle-mouse-down handler (which has hidden the cursor and installed
    /// the built-in pan callback). If the custom sensitivity is enabled, records where the drag
    /// began, warps the cursor to the window center, and swaps the active-drag slot to
    /// [`grab_pan_update_hook`].
    fn grab_pan_middle_down(&self) {
        use winapi::shared::windef::POINT;
        use winapi::um::winuser::{GetCursorPos, SetCursorPos};

        let Some(ref grab_pan) = self.grab_pan else {
            return;
        };
        // Clear any drag that ended without its middle-up (e.g. a UI transition that cleared the
        // slot) so a later middle-up can't restore the cursor to a stale origin.
        *grab_pan.anchor.lock() = None;
        if !self.grab_pan_sensitivity_on.load(Ordering::Acquire) {
            return;
        }
        let Some(hwnd) = crate::forge::game_window_handle() else {
            return;
        };
        unsafe {
            let mut origin = POINT { x: 0, y: 0 };
            if GetCursorPos(&mut origin) == 0 {
                return;
            }
            let Some((center_x, center_y)) = window_client_center(hwnd) else {
                return;
            };
            SetCursorPos(center_x, center_y);
            *grab_pan.anchor.lock() = Some(GrabPanAnchor {
                origin_x: origin.x,
                origin_y: origin.y,
                center_x,
                center_y,
                frac_x: 0.0,
                frac_y: 0.0,
            });
            let table = grab_pan.global_event_handlers.resolve() as *mut usize;
            table
                .add(3)
                .write(grab_pan_update_hook as *const () as usize);
        }
    }

    /// The active-drag callback while a custom-sensitivity grab pan is in progress. Moves the camera
    /// by the cursor's offset from the window center times the gain, then warps the cursor back to
    /// center so the next pass measures fresh movement and the cursor never reaches the confine
    /// edge. The dispatcher only calls this on passes where the mouse actually moved, so a still
    /// cursor simply holds the camera.
    fn grab_pan_update(&self) {
        use winapi::shared::windef::POINT;
        use winapi::um::winuser::{GetCursorPos, SetCursorPos};

        let Some(ref grab_pan) = self.grab_pan else {
            return;
        };
        let mut gain = f32::from_bits(self.grab_pan_gain.load(Ordering::Acquire));
        if self.grab_pan_inverted.load(Ordering::Acquire) {
            // Negating the gain reverses the camera movement on both axes at once; the sub-pixel
            // carry below is sign-agnostic (trunc and remainder both follow the value's sign).
            gain = -gain;
        }
        unsafe {
            let mut pos = POINT { x: 0, y: 0 };
            if GetCursorPos(&mut pos) == 0 {
                return;
            }
            let mut guard = grab_pan.anchor.lock();
            let Some(anchor) = guard.as_mut() else {
                return;
            };
            let dx = pos.x - anchor.center_x;
            let dy = pos.y - anchor.center_y;
            if dx == 0 && dy == 0 {
                return;
            }
            // Apply whole camera pixels this pass and carry the fraction, so a gain below 1
            // accumulates across passes instead of losing every step to truncation.
            let move_x = dx as f32 * gain + anchor.frac_x;
            let move_y = dy as f32 * gain + anchor.frac_y;
            let whole_x = move_x.trunc();
            let whole_y = move_y.trunc();
            anchor.frac_x = move_x - whole_x;
            anchor.frac_y = move_y - whole_y;
            let (center_x, center_y) = (anchor.center_x, anchor.center_y);
            drop(guard);

            let x = self.screen_x.resolve() as f32 + whole_x;
            let y = self.screen_y.resolve() as f32 + whole_y;
            // The `as u32` casts saturate, clamping negatives to 0; move_screen clamps to the
            // map's scroll bounds itself.
            (self.move_screen)(x as u32, y as u32);
            SetCursorPos(center_x, center_y);
        }
    }

    /// Runs on middle-mouse-up before the game's handler reveals the cursor again. Restores the
    /// cursor to where the drag began, undoing the warping done during the drag. Does nothing if no
    /// warp drag was active (the custom sensitivity was off, so the cursor was never warped).
    fn grab_pan_middle_up(&self) {
        use winapi::um::winuser::SetCursorPos;

        let Some(ref grab_pan) = self.grab_pan else {
            return;
        };
        let Some(anchor) = grab_pan.anchor.lock().take() else {
            return;
        };
        unsafe {
            SetCursorPos(anchor.origin_x, anchor.origin_y);
        }
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
                if matches!(
                    (*player).player_type,
                    bw::PLAYER_TYPE_HUMAN | bw::PLAYER_TYPE_OBSERVER
                ) {
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

    /// Re-asserts the observer slots' storm ids, the storm↔game id table entries derived from
    /// them, and the local ids, after game init.
    ///
    /// Observers hold ordinary storm ids (their rp2 slots — the whole netcode addresses them
    /// that way), but BW's own convention gives observers out-of-band storm ids `0x80 + n`, and
    /// its game-start path renumbers an occupied observer slot (and, on the observer's own
    /// client, the local storm id) to that convention. Team-game init additionally rebuilds the
    /// storm↔game tables from per-team lobby data that describes only the 8 team slots, losing
    /// the observer entries written during the lobby phase. Either way the result is the same:
    /// an observer's commands resolve to the no-player id on everyone else, and the observer's
    /// own client loses its observer-ranged unique id and starts participating in sync as if it
    /// were a player. The storm ids each slot is supposed to hold are recorded at seating time
    /// in [`game_thread::OBSERVER_STORM_IDS`]; inits that change nothing get identical values
    /// rewritten, so this runs unconditionally.
    unsafe fn restore_observer_id_mappings(&self) {
        unsafe {
            let net_player_to_game = self.net_player_to_game.resolve();
            let net_player_to_unique = self.net_player_to_unique.resolve();
            let players = self.players.resolve();
            for (n, storm_id) in game_thread::OBSERVER_STORM_IDS.iter().enumerate() {
                let storm_id = storm_id.load(Ordering::Relaxed);
                let player = players.add(12 + n);
                if (*player).player_type != bw::PLAYER_TYPE_OBSERVER {
                    continue;
                }
                if storm_id >= NET_PLAYER_COUNT as u32 {
                    continue;
                }
                let game_id = 128 + n as u32;
                debug!(
                    "Restoring observer id mapping: storm {} -> game {} (slot had storm {}, table had {})",
                    storm_id,
                    game_id,
                    (*player).storm_id,
                    *net_player_to_game.add(storm_id as usize),
                );
                (*player).storm_id = storm_id;
                *net_player_to_game.add(storm_id as usize) = game_id;
                *net_player_to_unique.add(storm_id as usize) = game_id;
                let local_storm_id = self.local_storm_id.resolve();
                // The local client is this observer if its storm id matches — either still the
                // real one, or the renumbered value when init got to the local id too.
                if local_storm_id == storm_id || local_storm_id == game_id {
                    self.local_storm_id.write(storm_id);
                    self.local_player_id.write(game_id);
                    self.local_unique_player_id.write(game_id);
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
    /// The only case where this may be called more than once is a replay seek that SC:R
    /// handles itself (one past the replay's end, or with the keyframe seeker unavailable),
    /// which simulates the replay from the start over again, so we don't need to and
    /// shouldn't reset any network state.
    fn reset_state_for_game_init(&self) {
        #[cfg(debug_assertions)]
        crate::rollback_harness::reset_for_game_init();
        crate::replay_seek::reset_for_game_init();
        crate::rollback_live::reset_for_game_init();
        crate::frame_timing::reset();
        crate::frame_pacing::reset();
        self.detection_status_copy.lock().clear();
        // A replay starting over for a seek SC:R makes itself simulates from frame 0 again, and
        // records its chat from there.
        self.chat_history.lock().clear();
        self.first_game_logic_frame_done
            .store(false, Ordering::Relaxed);
        if let Some(mut apm) = self.apm_state.lock() {
            *apm = ApmStats::new();
        }
        // A replay starting over simulates from frame 0 again, and the history is rebuilt from
        // there.
        if let Some(mut stats) = self.game_stats.lock() {
            stats.clear();
        }
    }

    /// Advances the observer panels' history by whatever the simulation step just did.
    ///
    /// Sampled after the step rather than before it, so a sample is what the frame ended as. Only
    /// while the local client is watching rather than playing: nothing else reads the history, and
    /// a player's own game should not pay for it.
    fn sample_game_stats(&self) {
        if !self.game_started.load(Ordering::Acquire) || !self.is_replay_or_obs() {
            return;
        }
        unsafe {
            let game = self.game();
            if game.is_null() {
                return;
            }
            let game = bw_dat::Game::from_ptr(game);
            let active_units = self.active_units();
            let vector = self.units.resolve();
            if vector.is_null() {
                return;
            }
            let units = bw_dat::UnitArray::new((*vector).data as *mut bw::Unit, (*vector).length);
            // Only a rollback steps a frame that can come out differently the second time; a
            // replay seek that goes back over frames replays the same commands.
            let resimulation = match crate::rollback::tick_running() {
                true => game_stats::Resimulation::MayDiffer,
                false => game_stats::Resimulation::Identical,
            };
            // The replay's own length says when the last sample is taken, which ends whatever fight
            // is going on; a game being played only ends as its players leave.
            let end_frame = (self.is_replay.resolve() != 0)
                .then(|| self.replay_header())
                .filter(|header| !header.is_null())
                .map(|header| (*header).replay_end_frame);
            if let Some(mut stats) = self.game_stats.lock() {
                stats.set_end_frame(end_frame);
                stats.step(
                    game.frame_count(),
                    resimulation,
                    &game_stats::DatUnits,
                    || {
                        game_stats::read_snapshot(
                            game,
                            self.players(),
                            active_units,
                            &units,
                            self.selection_hotkey_last_used_frames
                                .map(|frames| frames.resolve() as *const u16),
                            self.map_tile_flags_slice(game),
                        )
                    },
                );
                #[cfg(debug_assertions)]
                dump_game_stats(&stats);
            }
        }
    }

    /// Reads again what the observer panels show of the game as it stands (number keys, vision)
    /// when the frame on screen has moved away from where it was read without the simulation
    /// sampling it, as a replay seek that lands paused leaves it.
    fn refresh_stale_game_stats(&self) {
        if !self.game_started.load(Ordering::Acquire) || !self.is_replay_or_obs() {
            return;
        }
        unsafe {
            let game = self.game();
            if game.is_null() {
                return;
            }
            let game = bw_dat::Game::from_ptr(game);
            let Some(units) = self.unit_array() else {
                return;
            };
            let Some(mut stats) = self.game_stats.lock() else {
                return;
            };
            if !stats.current_state_stale(game.frame_count()) {
                return;
            }
            let snapshot = game_stats::read_snapshot(
                game,
                self.players(),
                self.active_units(),
                &units,
                self.selection_hotkey_last_used_frames
                    .map(|frames| frames.resolve() as *const u16),
                self.map_tile_flags_slice(game),
            );
            stats.refresh_current_state(snapshot, &game_stats::DatUnits);
        }
    }

    /// The map's per-tile flags, one for every tile of the map being played.
    unsafe fn map_tile_flags_slice(&self, game: bw_dat::Game) -> Option<&[u32]> {
        unsafe {
            let flags = self.map_tile_flags.as_ref()?.resolve();
            if flags.is_null() {
                return None;
            }
            let count = usize::from(game.map_width_tiles()) * usize::from(game.map_height_tiles());
            Some(std::slice::from_raw_parts(flags, count))
        }
    }

    fn resolve_first_dialog(&self) -> Option<bw_dat::dialog::Dialog> {
        self.dialogs().first()
    }

    fn dialogs(&self) -> DialogList {
        DialogList {
            head: self.first_dialog,
        }
    }

    fn is_replay_or_obs(&self) -> bool {
        unsafe { self.is_replay.resolve() != 0 || self.local_unique_player_id.resolve() >= 0x80 }
    }

    /// Whether the local client is watching a live game from an observer slot.
    fn is_live_observer(&self) -> bool {
        unsafe { self.is_replay.resolve() == 0 && self.local_unique_player_id.resolve() >= 0x80 }
    }

    /// Sets [game_results_sent] atomically, returning whether the results need to be sent by the
    /// caller.
    pub fn trigger_game_results_sent(&self) -> bool {
        !self.game_results_sent.swap(true, Ordering::Relaxed)
    }

    /// Puts settings the player moved on the in-game options screen into effect, and hands them to
    /// the app to save.
    ///
    /// SC:R's own settings go through its settings registry at the start of the next frame (see
    /// `pending_game_setting_writes`), which applies most of them on the spot; ShieldBattery's go
    /// to whatever in the DLL reads them. A setting only a launch reads (the screen marks those) is
    /// saved and nothing more.
    fn apply_setting_changes(&self, changes: &[SettingChange]) {
        for &change in changes {
            if let Some(write) = draw_overlay::options::registry_setting(change) {
                self.pending_game_setting_writes.lock().push(write);
            }
            if let SettingChange::HdGraphicsOn(on) = change {
                self.switch_graphics(on);
            }
            self.apply_local_setting_change(change);
        }
        self.save_setting_changes(changes);
    }

    /// Hands settings that changed during the game to the app to save.
    fn save_setting_changes(&self, changes: &[SettingChange]) {
        let mut saved = SettingsChanged::default();
        for &change in changes {
            match draw_overlay::options::app_setting(change) {
                Some(setting) => {
                    let object = if setting.local {
                        &mut saved.local
                    } else {
                        &mut saved.scr
                    };
                    object.insert(setting.key.into(), setting.value);
                }
                None => {
                    if let SettingChange::Monitor(choice) = change {
                        let lists = self.option_lists.lock();
                        saved.monitor = Some(choice.and_then(|index| {
                            lists.monitors.get(index).map(|monitor| monitor.bounds)
                        }));
                    }
                }
            }
        }
        send_game_msg_to_async(GameThreadMessage::SettingsChanged(saved));
    }

    /// Switches between SD and HD graphics the way the game's own F5 key does, by pressing it: the
    /// key switches whichever way the game is not drawing, so it is pressed only while that differs
    /// from what the player asked for. The game refuses it while a switch is still fading in.
    fn switch_graphics(&self, hd: bool) {
        use winapi::um::winuser::{PostMessageW, VK_F5, WM_KEYDOWN, WM_KEYUP};
        if self.disable_hd.load(Ordering::Acquire)
            || self.is_hd_mode[0].load(Ordering::Relaxed) == hd
        {
            return;
        }
        let Some(window) = crate::forge::game_window_handle() else {
            return;
        };
        // A repeat count of one for the press; a release also marks the key as having been down and
        // as going up.
        const PRESS: isize = 1;
        const RELEASE: isize = 1 | (1 << 30) | (1 << 31);
        self.posted_graphics_keys.store(2, Ordering::Release);
        unsafe {
            PostMessageW(window, WM_KEYDOWN, VK_F5 as usize, PRESS);
            PostMessageW(window, WM_KEYUP, VK_F5 as usize, RELEASE);
        }
    }

    /// Writes the options screen's queued changes into SC:R's settings registry. Must run on the
    /// game's main thread between frames, as SC:R's own writes do.
    fn write_pending_game_settings(&self) {
        let writes = mem::take(&mut *self.pending_game_setting_writes.lock());
        for (group, key, value) in writes {
            match &self.game_settings {
                Some(settings) => {
                    if !unsafe { settings.set(group, key, value) } {
                        debug!("SC:R has no {group}.{key} setting yet, saving it only");
                    }
                }
                None => debug!("No settings registry, saving {group}.{key} only"),
            }
        }
    }

    /// Hands one of ShieldBattery's own settings to what reads it in the DLL, for the ones read
    /// while a game runs.
    fn apply_local_setting_change(&self, change: SettingChange) {
        match change {
            SettingChange::GrabPanOn(on) => {
                self.grab_pan_sensitivity_on.store(on, Ordering::Release);
            }
            SettingChange::GrabPanSensitivity(value) => {
                self.grab_pan_gain
                    .store(grab_pan_gain(value as f32).to_bits(), Ordering::Release);
            }
            SettingChange::GrabPanInverted(on) => {
                self.grab_pan_inverted.store(on, Ordering::Release);
            }
            SettingChange::MinimapTerrain(terrain) => {
                let hidden = terrain == overlay_ui::options::MinimapTerrain::Hidden;
                self.saved_minimap_terrain_hidden
                    .store(hidden, Ordering::Release);
                if let Some(value) = self.minimap_terrain_hidden.as_ref() {
                    unsafe { value.write(u8::from(hidden)) };
                }
            }
            SettingChange::MinimapColorMode(mode) => {
                let mode = match mode {
                    overlay_ui::options::MinimapColorMode::Standard => MinimapColorMode::Standard,
                    overlay_ui::options::MinimapColorMode::PresetOnMinimapOnly => {
                        MinimapColorMode::PresetOnMinimapOnly
                    }
                    overlay_ui::options::MinimapColorMode::Preset => MinimapColorMode::Preset,
                };
                self.saved_minimap_color_mode
                    .store(mode as u8, Ordering::Release);
                // With team colors on, the mode the player sees is the engine's own, and the
                // game's global is pinned to whatever that mode needs.
                let mut guard = self.team_color_runtime.lock();
                if let Some(runtime) = guard.as_mut() {
                    runtime.virtual_mode = mode;
                    unsafe { self.apply_team_color_mode(runtime) };
                } else if let Some(value) = self.minimap_color_mode.as_ref() {
                    unsafe { value.write(mode as u8) };
                }
            }
            SettingChange::FramePacing(pacing) => {
                let options = *self.options.lock();
                crate::frame_pacing::reconfigure(
                    Some(draw_overlay::options::frame_pacing_id(pacing)),
                    options.vsync_on,
                );
            }
            SettingChange::VsyncOn(on) => {
                let options = *self.options.lock();
                crate::frame_pacing::reconfigure(
                    Some(draw_overlay::options::frame_pacing_id(options.frame_pacing)),
                    on,
                );
            }
            SettingChange::RollbackTarget(target) => {
                crate::rollback_live::set_player_rollback_target(target);
            }
            _ => (),
        }
    }

    /// Brings the options screen's copy of the settings the game changes on its own keys up to
    /// date with what the game shows this frame, and returns the changes the game made.
    ///
    /// Whether the game draws in HD is read off the final picture the renderer last drew, which is
    /// what the game shows whatever any one draw command asked for, and not while a switch between
    /// the two is still drawing both.
    fn follow_engine_settings(&self) -> Vec<SettingChange> {
        use overlay_ui::options as ui;
        let minimap_color_mode = self
            .team_color_virtual_mode()
            .or_else(|| self.read_minimap_color_mode())
            .map(|mode| match mode {
                MinimapColorMode::Standard => ui::MinimapColorMode::Standard,
                MinimapColorMode::PresetOnMinimapOnly => ui::MinimapColorMode::PresetOnMinimapOnly,
                MinimapColorMode::Preset => ui::MinimapColorMode::Preset,
            });
        let registry = draw_overlay::options::KEYED_REGISTRY_SETTINGS.map(|setting| {
            let settings = self.game_settings.as_ref()?;
            // SAFETY: the overlay's frame runs on the game's main thread, once a game is running.
            unsafe { settings.get(setting.group, setting.key) }
        });
        let read = draw_overlay::options::EngineSettings {
            registry,
            hd_graphics_on: (!self.hd_switching.load(Ordering::Relaxed))
                .then(|| self.is_hd_mode[0].load(Ordering::Relaxed)),
            minimap_terrain: self
                .read_minimap_terrain_hidden()
                .map(|hidden| match hidden {
                    true => ui::MinimapTerrain::Hidden,
                    false => ui::MinimapTerrain::Shown,
                }),
            minimap_color_mode,
        };
        let changes = self
            .engine_settings
            .lock()
            .follow(read, &mut self.options.lock());
        // Already in effect, since the game made them; the app still has to save them, or the
        // value it last saved from the screen would be put back at the next launch.
        if !changes.is_empty() {
            self.save_setting_changes(&changes);
        }
        changes
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
    /// render. The randomizer writes each player slot's color preference into `rgb_colors`,
    /// drawing a distinct synced-random color on the shared game seed for every slot whose
    /// preference is the "random" sentinel (all clients agree with no network relay). Game init
    /// presets a color for each slot it counts as taken, slot 0 always red, and leaves the rest
    /// on the sentinel. A team game counts every slot as taken, so there all of them are reset to
    /// the sentinel first, and each team takes a fresh draw (see
    /// [`share_team_colors`](Self::share_team_colors)) rather than a preset that is the same every
    /// game.
    /// BW's own game-start path skips this randomize call for SB sessions, leaving deterministic
    /// slot-order colors, so it's invoked here once game init has run and the RNG seed is set. A
    /// no-op (leaving BW's colors as-is) when the randomizer wasn't located during analysis. Runs
    /// before the custom team-color engine snapshots the color state, so that engine's non-preset
    /// modes restore this randomized baseline rather than slot-order colors.
    ///
    /// The randomizer draws once per random-color slot from the synced RNG. Replay playback never
    /// re-runs it (the recorded colors are restored from the replay instead), so letting those
    /// draws stand would start every live game's simulation with an RNG stream offset from the
    /// one playback derives from the recorded seed — desyncing the replay of every game that gets
    /// here. The seed is restored around the call so the sim's stream starts exactly at the game
    /// seed either way; the drawn colors still agree on every client because each draws them from
    /// that same seed state.
    pub fn randomize_base_player_colors(&self) {
        if let Some(randomize) = self.randomize_player_colors {
            unsafe {
                // The u32 at the resolved operand is the advancing LCG state the synced rand
                // mutates on every draw; one u32 past it is the static game seed (never advances
                // — restoring that instead would be a no-op), and two past is the draw counter.
                // Restore state + counter so the sim's RNG stream is exactly as if the
                // randomizer never drew, which is what replay playback derives from the
                // recorded seed.
                let base = self.rng_seed.resolve_as_ptr();
                let saved_state = base.read_unaligned();
                let saved_draws = base.add(2).read_unaligned();
                if game_thread::is_team_game() {
                    let game = self.game();
                    for i in 0..8 {
                        (*game).scr_player_color_preference[i] = PLAYER_COLOR_RANDOM;
                    }
                }
                randomize();
                base.write_unaligned(saved_state);
                base.add(2).write_unaligned(saved_draws);
                self.use_rgb_colors.write(1);
            }
        }
    }

    /// Gives each shared-control team (Team Melee, Team FFA) a single color across all of its
    /// members' player slots. The team's units are drawn in its main player's color while
    /// per-player UI (chat, the overlay) uses each member's own, so every member's slot takes the
    /// team's color in each color form BW keeps: `rgb_colors`, the color preference, the minimap
    /// palette index and the unit remap palette.
    ///
    /// In a live game team `t` takes the color drawn for slot `t - 1`, so teams are colored by
    /// their team index the way melee players are by their player index, and a team's color never
    /// depends on which of its slots are filled or which of them BW made the main player. A replay
    /// already holds the colors its game showed, so there each team takes its main player's
    /// recorded color, which also gives replays of games whose teammates had their own colors one
    /// color per team.
    ///
    /// Only slots with a human or computer in them are written: the teams of empty slots aren't
    /// the same on every client. A no-op outside team games and when the `rgb_colors` pointer is
    /// null.
    pub fn share_team_colors(&self) {
        if !game_thread::is_team_game() {
            return;
        }
        unsafe {
            let rgb_ptr = self.rgb_colors.resolve();
            if rgb_ptr.is_null() {
                return;
            }
            let game = self.game();
            let players = self.players();
            let main_players = (*game).team_game_main_player;
            let from_main_player = game_thread::is_replay();
            let rgb = *rgb_ptr;
            let preference = (*game).scr_player_color_preference;
            let minimap = (*game).player_minimap_color;
            let palette = (*game).player_color_palette;
            for i in 0..8 {
                let player = *players.add(i);
                if !matches!(player.player_type, 1 | 2) {
                    continue;
                }
                let team = player.team as usize;
                let Some(main) = team
                    .checked_sub(1)
                    .and_then(|index| main_players.get(index))
                    .map(|&main| main as usize)
                    .filter(|&main| main < 8)
                else {
                    continue;
                };
                let source = if from_main_player { main } else { team - 1 };
                (*rgb_ptr)[i] = rgb[source];
                (*game).scr_player_color_preference[i] = preference[source];
                (*game).player_minimap_color[i] = minimap[source];
                (*game).player_color_palette[i] = palette[source];
            }
        }
    }

    /// Gives each high player id (`8..12`, the neutral player and the unused ids next to it) whose
    /// `rgb_colors` entry BW left unassigned the color it draws in on the palette path.
    ///
    /// BW never assigns those entries (its color setup, randomizer and lobby sync all stop at 8),
    /// leaving them fully transparent, yet the minimap reads them for every high player's units
    /// whenever `use_rgb_colors` is on. Only the palette path, which colors those units from
    /// `player_minimap_color` and forces them opaque, draws them at all, so a game that renders in
    /// RGB colors would otherwise show no minimap dot for neutral units (critters, eggs, map-placed
    /// buildings). An entry that already holds a color (one restored from a replay that recorded
    /// it) is left as it is.
    pub fn fill_neutral_player_colors(&self) {
        unsafe {
            let rgb_ptr = self.rgb_colors.resolve();
            let main_palette = self.main_palette.resolve();
            if rgb_ptr.is_null() || main_palette.is_null() {
                return;
            }
            let game = self.game();
            for player in 8..12 {
                let entry = &mut (*rgb_ptr)[player];
                if entry[3] != 0.0 {
                    continue;
                }
                let index = (*game).player_minimap_color[player] as usize;
                let rgb = main_palette.add(4 * index);
                *entry = [
                    f32::from(*rgb) / 255.0,
                    f32::from(*rgb.add(1)) / 255.0,
                    f32::from(*rgb.add(2)) / 255.0,
                    1.0,
                ];
            }
        }
    }

    /// Copies the local player's slot out of the applied-skin table, for relaying to peers. The
    /// slot index is the local *storm* id — the table is indexed by the lobby-stable storm
    /// identity, not the randomized `players[]` id (native code fills it from lobby-time
    /// slot-setup state, before game init shuffles `players[]`). The fill lands at some point
    /// during game startup after the init hook this DLL's post-init setup runs under, so
    /// init-time calls read a still-zeroed slot; only call this once the game loop has started
    /// (see [`broadcast_local_skin_once`](Self::broadcast_local_skin_once)). Returns `None` when
    /// the table wasn't located, or the local storm id isn't a table slot. The bytes are opaque;
    /// a player with no skins yields a mostly-zero blob, which is still relayed so every slot's
    /// table entry ends up identical on every client.
    pub fn read_local_skin_blob(&self) -> Option<Vec<u8>> {
        let table = self.skin_table.as_ref()?;
        unsafe {
            let slot = self.local_storm_id.resolve() as usize;
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

    /// Writes one peer's skin blob into `storm_slot`'s entry of the applied-skin table (the
    /// table is storm-id-indexed — see [`read_local_skin_blob`](Self::read_local_skin_blob)),
    /// taking effect the next rendered frame. Returns `false` without writing when the table
    /// wasn't located, the slot index is out of table range, or `blob` isn't exactly one slot
    /// long — the sender reads whole slots, so any other length is a malformed or cross-version
    /// frame, and a partial write could leave a slot mixing two states rendering might parse.
    unsafe fn write_player_skin_blob(&self, storm_slot: u8, blob: &[u8]) -> bool {
        let Some(table) = self.skin_table.as_ref() else {
            return false;
        };
        let slot = storm_slot as usize;
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
                game_thread::replay_seat_of_local_user()
                    .filter(|seat| active_players.contains(seat))
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
                plays_as: [None; 8],
            };
            // A shared-control team is one player in the game, the one that owns its units, so it
            // gets one color, the alliances between its members count for nothing, and the local
            // team's alliances are read from its main player's row.
            let info = if game_thread::is_team_game() {
                let mut player_teams = [0u8; 8];
                for (i, team) in player_teams.iter_mut().enumerate() {
                    *team = (*players.add(i)).team;
                }
                info.with_shared_control_teams(player_teams, (*game).team_game_main_player)
            } else {
                info
            };
            // Shuffled from the game's own seed, which its replay records, so a replay of the
            // watcher's own game shuffles the way the game did.
            let state = TeamColorState::new(config, &info, u64::from(self.rng_seed()));
            let virtual_mode =
                MinimapColorMode::try_from(self.saved_minimap_color_mode.load(Ordering::Acquire))
                    .unwrap_or_default();
            let local_alliance_row = info
                .local_player
                .map(|local| (local, initial_allies[local as usize]));
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

    /// The scheme's neutral color for units owned by `player`, when that is a high player id
    /// (`8..12`) and the team-color feature is showing its colors on the game view (the
    /// [`Preset`](MinimapColorMode::Preset) mode). `None` otherwise, leaving BW's own color.
    fn neutral_unit_color_override(&self, player: u8) -> Option<[f32; 4]> {
        if !(8..12).contains(&player) {
            return None;
        }
        let guard = self.team_color_runtime.lock();
        let runtime = guard.as_ref()?;
        (runtime.virtual_mode == MinimapColorMode::Preset).then(|| runtime.state.neutral())
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
    /// the assignment changed and colors are currently shown. Called after each `step_game` and on
    /// each drawn frame; a no-op when the feature is inactive or there is no local seat (an
    /// observer, or a replay of a game the watcher was not in).
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
            if game.is_null() {
                return;
            }
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
    /// released before the guard is returned, so the nested draws can re-acquire it.
    fn begin_minimap_team_colors(&self) -> Option<RgbColorSwap> {
        let assignment = {
            let guard = self.team_color_runtime.lock();
            let runtime = guard.as_ref()?;
            if runtime.virtual_mode != MinimapColorMode::PresetOnMinimapOnly {
                return None;
            }
            runtime.assigned_rgb_colors()
        };
        self.swap_rgb_colors(assignment, 1)
    }

    /// Installs BW's original player colors and `use_rgb_colors` switch (the init snapshot) for the
    /// span of one native replay save, returning an RAII guard that restores the current state
    /// when dropped. SC:R serializes the live `rgb_colors` array into the replay when saving, so
    /// without this a save made while the
    /// [`Preset`](MinimapColorMode::Preset) mode has the local player's personal assignment in
    /// that array would record that assignment instead of the game's real colors, and everyone
    /// watching the replay would see it. Returns `None` (nothing to restore) when the feature is
    /// inactive, as the array then already holds the real colors.
    fn begin_replay_save_colors(&self) -> Option<RgbColorSwap> {
        let (colors, use_rgb) = {
            let guard = self.team_color_runtime.lock();
            let runtime = guard.as_ref()?;
            (runtime.original_rgb_colors, runtime.original_use_rgb_colors)
        };
        self.swap_rgb_colors(colors, use_rgb)
    }

    /// Writes `colors` into `rgb_colors` and `use_rgb` into the `use_rgb_colors` switch, returning
    /// a guard that puts back the previous contents of both when dropped. Guards nest: each one
    /// restores exactly the state that was current when it was created. Returns `None` without
    /// writing anything when the `rgb_colors` pointer is null. No heap allocation: the saved copy
    /// lives in the returned guard on the caller's stack.
    fn swap_rgb_colors(&self, colors: bw::RgbColors, use_rgb: u8) -> Option<RgbColorSwap> {
        unsafe {
            let rgb_ptr = self.rgb_colors.resolve();
            if rgb_ptr.is_null() {
                return None;
            }
            let saved_rgb = *rgb_ptr;
            *rgb_ptr = colors;
            let saved_use_rgb = self.use_rgb_colors.resolve();
            self.use_rgb_colors.write(use_rgb);
            Some(RgbColorSwap {
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

    /// Writes the engine's current assignment into `rgb_colors`, a full write of every slot each
    /// time (see [`TeamColorRuntime::assigned_rgb_colors`]).
    unsafe fn write_team_color_rgb(&self, runtime: &TeamColorRuntime) {
        unsafe {
            let rgb_ptr = self.rgb_colors.resolve();
            if rgb_ptr.is_null() {
                return;
            }
            *rgb_ptr = runtime.assigned_rgb_colors();
        }
    }

    /// Saves a replay to the specified path. The path should be a valid filesystem path.
    /// Returns true if the replay was saved successfully. The native save function is hooked to
    /// record the game's real player colors (see
    /// [`begin_replay_save_colors`](Self::begin_replay_save_colors)), so calling it here goes
    /// through that hook too.
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

            replay_save::sanitize_recording(
                self.replay_data(),
                (*game).frame_count,
                self.game_command_lengths(),
            );
            let result = (self.save_replay)(path.as_ptr());
            replay_save::rearm_recorder_after_save(self.replay_data(), (*game).frame_count);

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
        self.chat_manager
            .lock()
            .handle_send_chat(text, |player| unsafe { !self.is_allied_with(player.0) })
    }

    /// What the game offers the local player for pausing: SC:R's own rules, which its menu shows
    /// as one button or the other. A player with pauses left may pause a running game (three a
    /// game), and anyone in the game may resume a paused one. Only a live multiplayer game pauses
    /// this way: a replay has its own playback controls.
    unsafe fn pause_control(&self, game: bw_dat::Game, is_replay: bool) -> Option<PauseControl> {
        unsafe {
            if is_replay || netcode_v2::with_turn_state(|_| ()).is_none() {
                return None;
            }
            let paused = self.is_paused.as_ref()?.resolve() != 0;
            if paused {
                return Some(PauseControl::Resume);
            }
            // Pauses are counted per person rather than per side: in a shared-control game the
            // players on one side each have their own.
            let local = self.local_unique_player_id.resolve() as usize;
            let left = *(**game).pauses_remaining.get(local)?;
            (left > 0).then_some(PauseControl::Pause { left: Some(left) })
        }
    }

    /// What this game's rules allow of alliances and chat recipients, for the alliances screen.
    unsafe fn alliance_rules(&self) -> draw_overlay::AllianceRules {
        unsafe {
            let game_data = self.game_data();
            if game_data.is_null() {
                return draw_overlay::AllianceRules::default();
            }
            let game_type = (*game_data).game_type();
            draw_overlay::AllianceRules {
                // The game allows alliance changes only at exactly this value, and ignores the
                // commands for them otherwise.
                alliances_open: (*game_data).game_template.allies_enabled == 1,
                allies_chat: bw::get_had_allies_enabled(),
                shared_control: game_type.is_team_game(),
            }
        }
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

    pub fn set_blocked_players(&self, blocked_users: &[SbUserId]) {
        self.chat_manager.lock().set_blocked_players(blocked_users);
    }

    /// A player's actions per minute over the game so far, or `None` before a whole second of it
    /// has been counted.
    pub fn average_apm(&self, player: u8) -> Option<u32> {
        self.apm_state
            .lock()
            .and_then(|apm| apm.player_average_apm(player))
    }

    pub fn block_request_failed(&self, failure: &BlockRequestFailed) {
        self.chat_manager.lock().block_request_failed(failure);
    }

    pub fn report_result(&self, result: &crate::app_messages::ReportResult) {
        self.chat_manager.lock().report_result(result);
    }

    /// Prints the notices other threads queued on the chat manager. Must run on the game thread.
    fn print_chat_notices(&self) {
        let notices = self.chat_manager.lock().take_pending_notices();
        for notice in notices {
            self.print_text(&notice);
        }
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

/// Accessors the rollback engine needs into BW state.
impl BwScr {
    /// The first analysis result a game that rolls back needs and this build of the game didn't
    /// yield, or `None` when there is none and this DLL can roll back.
    pub(crate) fn rollback_missing_analysis(&self) -> Option<&'static str> {
        if self.next_game_step_tick.is_none() {
            return Some("next_game_step_tick");
        }
        if self.selection.local_selection.is_none() {
            return Some("local_selection");
        }
        if self.selection.simulated_selections.is_none() {
            return Some("selections");
        }
        if self.observer_ui_callbacks.is_none() {
            return Some("observer UI callbacks");
        }
        if self.selection.selection_visuals.is_none() {
            return Some("selection visuals");
        }
        if self.click_feedback.is_none() {
            return Some("click feedback");
        }
        if self.placement_overlays.is_none() {
            return Some("building placement overlay pools");
        }
        if self.pylon_auras.is_none() {
            return Some("pylon power fields");
        }
        if self.mission_dialog_openers.is_none() {
            return Some("mission dialog openers");
        }
        if self.show_game_message.is_none() {
            return Some("show_game_message");
        }
        if self.rollback_ranges.is_empty() {
            return Some("snapshot ranges");
        }
        self.rollback_ranges
            .iter()
            .find(|x| x.operand().is_none())
            .map(|x| x.name())
    }

    /// The analysis results the rollback engine turns into snapshot ranges.
    pub(crate) fn rollback_range_specs(&self) -> &[crate::rollback::ranges::RangeSpec] {
        &self.rollback_ranges
    }

    /// The value the snapshot's analysis result `name` holds right now, which for a list head is
    /// the list's first entry; 0 when analysis did not resolve it.
    pub(crate) unsafe fn rollback_list_head(&self, name: &str) -> usize {
        unsafe {
            self.rollback_ranges
                .iter()
                .find(|x| x.name() == name)
                .and_then(|x| x.operand())
                .map(|op| resolve_operand(op, &[]))
                .unwrap_or(0)
        }
    }

    /// Shows replay playback through the vision of the players in `players` (a bit per player),
    /// as the replay UI's vision toggles do.
    #[cfg(debug_assertions)]
    pub(crate) unsafe fn rollback_set_replay_vision(&self, players: u8) {
        unsafe {
            self.note_replay_vision_choice(self.replay_visions.resolve(), players);
            self.replay_visions.write(players);
            self.local_visions.write(players);
            game_thread::add_fow_sprites_for_replay_vision_change(self);
        }
    }

    /// The current map's pathing state, or null before a map has been loaded.
    pub(crate) unsafe fn rollback_pathing(&self) -> *mut bw::Pathing {
        unsafe { self.pathing.resolve() }
    }

    /// The tick the game loop schedules its next logic step for, or 0 if analysis didn't find it.
    pub(crate) unsafe fn rollback_next_game_step_tick(&self) -> u32 {
        unsafe { self.next_game_step_tick().unwrap_or(0) }
    }

    /// The tick the game loop schedules its next logic step for, if analysis found it.
    pub(crate) unsafe fn next_game_step_tick(&self) -> Option<u32> {
        unsafe { self.next_game_step_tick.as_ref().map(|x| x.resolve()) }
    }

    pub(crate) unsafe fn rollback_set_next_game_step_tick(&self, value: u32) {
        unsafe {
            if let Some(tick) = &self.next_game_step_tick {
                tick.write(value);
            }
        }
    }

    /// Whether this build of the game lets a replay be fast-forwarded to a frame of our choosing,
    /// which seeking by keyframe needs.
    pub(crate) fn can_set_replay_seek_frame(&self) -> bool {
        self.replay_seek_frame.is_some()
    }

    /// The frame `step_game_logic` is fast-forwarding the replay to, or 0 when this build has no
    /// way to tell.
    pub(crate) unsafe fn replay_seek_frame(&self) -> u32 {
        unsafe { self.replay_seek_frame.as_ref().map_or(0, |x| x.resolve()) }
    }

    /// Has `step_game_logic` fast-forward the replay to frame count `frame`, simulating frames
    /// without rendering in between until it gets there.
    pub(crate) unsafe fn set_replay_seek_frame(&self, frame: u32) {
        unsafe {
            if let Some(seek_frame) = &self.replay_seek_frame {
                seek_frame.write(frame);
            }
        }
    }

    /// Sends the replay UI's seek command, the way its seek bar does.
    #[cfg(debug_assertions)]
    pub(crate) unsafe fn send_replay_seek(&self, frame: u32) {
        unsafe {
            let mut command = [commands::id::REPLAY_SEEK, 0, 0, 0, 0];
            LittleEndian::write_u32(&mut command[1..], frame);
            (self.send_command)(command.as_ptr(), command.len());
        }
    }

    /// Pauses or resumes replay playback at the fastest speed, the way the replay UI's pause button
    /// does.
    #[cfg(debug_assertions)]
    pub(crate) unsafe fn send_replay_pause(&self, paused: bool) {
        unsafe {
            let mut command = [
                commands::id::REPLAY_SPEED,
                paused as u8,
                0,
                0,
                0,
                0,
                0,
                0,
                0,
                0,
            ];
            LittleEndian::write_u32(&mut command[2..], 6);
            LittleEndian::write_u32(&mut command[6..], 1);
            (self.send_command)(command.as_ptr(), command.len());
        }
    }

    /// ShieldBattery's APM counts for the replay UI, which a keyframe carries so a seek can put
    /// them back as they were on its frame.
    pub(crate) fn apm_stats(&self) -> Option<ApmStats> {
        self.apm_state.lock().map(|x| x.clone())
    }

    pub(crate) fn set_apm_stats(&self, stats: ApmStats) {
        if let Some(mut apm) = self.apm_state.lock() {
            *apm = stats;
        }
    }

    /// How many network turns the game has dispatched since its game loop started, or `None` when
    /// no game is loaded. BW's turn counter reads one past that: it counts the turn being
    /// dispatched as well while the IN hook runs, and between steps.
    pub(crate) unsafe fn rollback_turns_dispatched(&self) -> Option<u32> {
        unsafe {
            (!self.game().is_null())
                .then(|| self.netcode_v2.game_frame_count.resolve().saturating_sub(1))
        }
    }

    /// Opens the victory or defeat dialog the way the trigger step does, for a frame that asked for
    /// it during a rollback tick and has since been confirmed.
    pub(crate) unsafe fn rollback_open_mission_dialog(
        &self,
        dialog: crate::rollback::game_end::MissionDialog,
    ) {
        use crate::rollback::game_end::MissionDialog;
        unsafe {
            let Some((defeat, victory)) = self.mission_dialog_openers else {
                return;
            };
            let opener = match dialog {
                MissionDialog::Defeat => defeat,
                MissionDialog::Victory => victory,
            };
            let open = mem::transmute::<usize, unsafe extern "C" fn()>(opener.0 as usize);
            open();
        }
    }

    /// Where the camera is, in map pixels.
    pub(crate) unsafe fn rollback_screen_position(&self) -> (u32, u32) {
        unsafe { (self.screen_x.resolve(), self.screen_y.resolve()) }
    }

    /// The frame the simulation is on, or `None` when no game is loaded.
    pub(crate) unsafe fn rollback_frame_count(&self) -> Option<u32> {
        unsafe {
            let game = self.game();
            (!game.is_null()).then(|| (*game).frame_count)
        }
    }

    /// The [`state_hash`](crate::rollback::state_hash::state_hash) of the current frame, or `None`
    /// when no game is loaded.
    pub(crate) unsafe fn rollback_state_hash(&self) -> Option<u64> {
        unsafe {
            let game = self.game();
            if game.is_null() {
                return None;
            }
            Some(crate::rollback::state_hash::state_hash(
                self,
                game,
                &self.rng_words(),
            ))
        }
    }

    /// The words around the RNG seed operand: the seed plus the advancing draw state.
    unsafe fn rng_words(&self) -> [u32; 6] {
        unsafe {
            let seed_ptr = self.rng_seed.resolve_as_ptr();
            let mut rng = [0u32; 6];
            for (i, out) in rng.iter_mut().enumerate() {
                *out = seed_ptr.add(i).read_unaligned();
            }
            rng
        }
    }
}

/// Accessors only the debug instrumentation (the rollback probe, the replay harness and the live
/// monkey) needs into BW state, compiled out of release DLLs along with it.
#[cfg(debug_assertions)]
impl BwScr {
    /// The vtable shared by the game allocator instances, so instrumentation can swap slots in it.
    pub(crate) unsafe fn probe_allocator_vtable(&self) -> *mut scr::AllocatorVtable {
        unsafe {
            let allocator = self.allocator.resolve();
            if allocator.is_null() {
                return null_mut();
            }
            (*allocator).vtable
        }
    }

    /// The executable's base address, and the address and size of its data section including the
    /// zero-initialized part: the static memory the game's globals live in.
    pub(crate) fn rollback_exe_data_section(&self) -> Option<(usize, usize, usize)> {
        unsafe {
            let base = GetModuleHandleW(null()) as *const u8;
            let data = pe_image::get_section(base, b".data\0\0\0")?;
            Some((
                base as usize,
                data.virtual_address.0 as usize,
                data.virtual_size as usize,
            ))
        }
    }

    /// Selects one of the local player's workers, both in the local UI (so its hotkeys work) and
    /// with a selection command. Returns whether there was one.
    #[cfg(debug_assertions)]
    pub(crate) unsafe fn input_probe_select_worker(&self) -> bool {
        unsafe {
            let local_player = self.local_unique_player_id.resolve();
            if local_player >= 8 {
                return false;
            }
            let worker = self
                .harness_selectable_units(local_player as u8)
                .into_iter()
                .find(|&unit| matches!((*unit).unit_id, 7 | 41 | 64));
            let Some(worker) = worker else {
                return false;
            };
            self.engine_select(&[worker]);
            let units = self.units.resolve();
            let index = (worker as usize - (*units).data as usize) / mem::size_of::<bw::Unit>();
            let tag = (index as u16 + 1) | (((*worker).minor_unique_index as u16 & 0x1f) << 11);
            let mut select = vec![0x63, 1];
            select.extend_from_slice(&tag.to_le_bytes());
            select.extend_from_slice(&[0, 0]);
            (self.send_command)(select.as_ptr(), select.len());
            true
        }
    }

    /// Issues commands the way a player's clicks would, through the local command buffer the
    /// game's own UI fills: selects some of the local player's units and right-clicks a map
    /// position with them. `random` picks the units and the position. Returns whether there was
    /// anything to select.
    pub(crate) unsafe fn rollback_issue_random_commands(
        &self,
        mut random: impl FnMut() -> u32,
    ) -> bool {
        unsafe {
            let game = self.game();
            let local_player = self.local_unique_player_id.resolve();
            if game.is_null() || local_player >= 8 {
                return false;
            }
            let units = self.units.resolve();
            let unit_ptr = (*units).data as *mut bw::Unit;
            let own: Vec<(usize, u8)> = (0..(*units).length)
                .map(|i| (i, unit_ptr.add(i)))
                .filter(|&(_, unit)| {
                    !(*unit).flingy.sprite.is_null() && (*unit).player as u32 == local_player
                })
                .map(|(i, unit)| (i, (*unit).minor_unique_index))
                .collect();
            if own.is_empty() {
                return false;
            }
            // A unit's tag is its one-based pool index in the low 11 bits and how many times the
            // slot has been reused above them; the 1.21 select command pads each to 4 bytes.
            let count = 1 + random() as usize % own.len().min(12);
            let mut select = vec![0x63, count as u8];
            for _ in 0..count {
                let (index, reuse) = own[random() as usize % own.len()];
                let tag = (index as u16 + 1) | ((reuse as u16 & 0x1f) << 11);
                select.extend_from_slice(&tag.to_le_bytes());
                select.extend_from_slice(&[0, 0]);
            }
            (self.send_command)(select.as_ptr(), select.len());
            let width = (*game).map_width_tiles as u32 * 32;
            let height = (*game).map_height_tiles as u32 * 32;
            let x = (random() % width.max(1)) as u16;
            let y = (random() % height.max(1)) as u16;
            // The 1.21 right click: position, target tag (none) and its padding, the target's unit
            // type (none), not queued.
            let mut right_click = vec![0x60];
            for value in [x, y, 0, 0, 0xe4] {
                right_click.extend_from_slice(&value.to_le_bytes());
            }
            right_click.push(0);
            (self.send_command)(right_click.as_ptr(), right_click.len());
            true
        }
    }

    /// Reads the synced-state fingerprint of the current frame, or `None` when no game is loaded.
    ///
    /// Same fields the low-rate sync probe logs: the words around the RNG seed operand (the seed
    /// plus the advancing draw state), the first four players' resources, and the trigger
    /// countdown. Together they move with essentially every synced operation, which is what makes
    /// them usable as a per-frame equality check between two runs of the same game.
    pub(crate) unsafe fn probe_fingerprint(&self) -> Option<crate::rollback_probe::Fingerprint> {
        unsafe {
            let game = self.game();
            if game.is_null() {
                return None;
            }
            let rng = self.rng_words();
            let all_minerals = (*game).minerals;
            let all_gas = (*game).gas;
            let mut minerals = [0u32; 4];
            minerals.copy_from_slice(&all_minerals[..4]);
            let mut gas = [0u32; 4];
            gas.copy_from_slice(&all_gas[..4]);
            Some(crate::rollback_probe::Fingerprint {
                frame: (*game).frame_count,
                rng,
                minerals,
                gas,
                trigger_timer: self.trigger_execution_timer.resolve(),
                elapsed_seconds: (*game).elapsed_seconds,
                player_types: std::array::from_fn(|i| (*self.players().add(i)).player_type),
                state_hash: crate::rollback::state_hash::state_hash(self, game, &rng),
            })
        }
    }
}

impl BwScr {
    /// The language the overlay draws in: the game's own where the overlay has a translation for
    /// it, so the overlay's text reads in the same language as the game's text beside it, and the
    /// one the settings ask for otherwise.
    ///
    /// # Safety
    ///
    /// Must be called on the game's main thread.
    unsafe fn overlay_locale(&self) -> overlay_ui::i18n::Locale {
        self.game_locale
            .as_ref()
            .and_then(|game_locale| unsafe { game_locale.overlay_locale() })
            .unwrap_or_else(|| *self.settings_locale.lock())
    }
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
        let grab_pan_sensitivity_on = settings
            .local
            .get("grabPanSensitivityOn")
            .and_then(|x| x.as_bool())
            .unwrap_or(false);
        let grab_pan_sensitivity = settings
            .local
            .get("grabPanSensitivity")
            .and_then(|x| x.as_f64())
            .unwrap_or(40.0) as f32;
        let grab_pan_inverted = settings
            .local
            .get("grabPanInverted")
            .and_then(|x| x.as_bool())
            .unwrap_or(false);
        let grab_pan_gain = grab_pan_gain(grab_pan_sensitivity);

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
        self.grab_pan_sensitivity_on
            .store(grab_pan_sensitivity_on, Ordering::Release);
        self.grab_pan_gain
            .store(grab_pan_gain.to_bits(), Ordering::Release);
        self.grab_pan_inverted
            .store(grab_pan_inverted, Ordering::Release);

        *self.team_color_config.lock() =
            settings.team_colors.as_ref().and_then(|tc| tc.to_config());

        // The overlay's options screen opens on what the app was playing on. Nothing writes back
        // into these settings from here, so this is the only time the game's side of them is read.
        // Which display the game is on is the one setting the screen shows that the app names in
        // its own terms: a launch names it by the desktop rectangle it covers, and the list the
        // screen picks from is this machine's rather than anything the app sent.
        let (displays, launched_monitor) = monitors::displays(settings.monitor_bounds);
        *self.options.lock() = draw_overlay::options::options_view_from_settings(
            &settings.scr,
            &settings.local,
            launched_monitor,
        );
        *self.option_lists.lock() = Arc::new(overlay_ui::options::OptionsLists {
            monitors: displays,
            ..overlay_ui::options::OptionsLists::default()
        });

        // A watcher's panels are as they left them in the last game they watched. Saved by an older
        // or newer client, unknown fields are ignored and missing ones take their defaults.
        *self.observer_panels.lock() = settings
            .local
            .get("observerPanels")
            .and_then(|panels| serde_json::from_value(panels.clone()).ok());

        // The overlay reads its language from a process-wide locale, set here because settings
        // arrive long before any overlay exists, and kept as what the overlay falls back to where
        // the game runs in a language it has no translation for (see `overlay_locale`). A tag we
        // ship no catalog for keeps English, which every string falls back to anyway.
        let locale = settings
            .language
            .as_deref()
            .and_then(overlay_ui::i18n::Locale::from_tag);
        if let Some(language) = &settings.language
            && locale.is_none()
        {
            warn!("No in-game UI translations for language '{language}', using English");
        }
        let locale = locale.unwrap_or(overlay_ui::i18n::Locale::En);
        *self.settings_locale.lock() = locale;
        overlay_ui::i18n::set_locale(locale);

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
                // SC:R warps the cursor to the renderer center as its game loop starts and again
                // (to the internal mouse position) when it processes the faked minimize from
                // `fix_clip_cursor`; both land inside game-loop init, after the loading screen has
                // handed off. Drop them until the first game-logic step (`step_game_logic_hook`
                // closes the gate); SB already placed the cursor at the handoff.
                crate::forge::suppress_scr_cursor_moves(true);
                (self.game_loop)();
                crate::forge::suppress_scr_cursor_moves(false);
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
            // TODO(tec27): deal with player bytes if we ever allow save games
            let data = bw::lobby_game_init_record(seed);

            // Only the host (storm id 0) sends the lobby-init `0x48` record; peers receive it. The
            // seed is server-distributed, so every client hand-set its own lobby_state to 8 and the
            // record carries the same value everywhere — the host's send reaches peers over the
            // session's reliable lobby channel (the rp2 lobby seam when active, native Storm
            // otherwise), where their handle_lobby_init_0x48 accepts it (sender slot 0, lobby_state
            // 8). The ProcessLobbyCommands hook trips lobby_game_init_command_seen on every client,
            // so try_finish_lobby_game_init drives lobby_state → 9.
            //
            // This is a single send: the driver keeps every lobby command this client authored and
            // sends them all again on each new link to its relay, which delivers each to every peer
            // once, so a send that went into a link that later turned out dead still arrives after
            // the reconnect. The only loss window is a local submit failure with an effectively-dead
            // driver, and a peer stuck waiting for the record is bounded by the server's game-load
            // timeout, which cancels the whole load.
            let local_storm_id = self.local_storm_id.resolve();
            if local_storm_id == 0 {
                debug!(
                    "Sending lobby game init data: {data:02x?} (seed {seed:#x}, lobby_state {})",
                    self.lobby_state.resolve(),
                );
                (self.send_command)(data.as_ptr(), data.len());
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
            let game = self.game();
            let frame = if game.is_null() {
                0
            } else {
                (*game).frame_count
            };
            // SC:R keeps a per-player history of recent multi-unit selections in hotkey groups
            // 10-17, which an Alt+click recalls. Each selection overwrites the entry stamped with
            // the oldest network turn count. A live game only runs commands on turn frames, so its
            // stamps order exactly like the commands' frames. Playback's turn count follows its own
            // timer instead: slower than a turn rate 24 game's, rescaled by the replay speed, and
            // stopped while seeking, which files selections into other groups than the live game
            // did. The commands run with a count that goes up once per frame, which orders like
            // the live game's for any turn rate and is the count a turn rate 24 game had.
            let turns = self.netcode_v2.game_frame_count.resolve();
            self.netcode_v2
                .game_frame_count
                .write(frame.wrapping_add(1));
            (self.process_game_commands)(commands.as_ptr(), commands.len(), 1);
            self.netcode_v2.game_frame_count.write(turns);
            if commands.first() == Some(&commands::id::LEAVE_GAME) {
                // A live game applies a player's departure through the pending-leave drain, which
                // besides removing the player also forces the trigger step to run on the next
                // frame. The leave command it records into the replay reproduces the removal on
                // playback but not that forced trigger pass, leaving playback's 30-frame trigger
                // cycle out of phase with the live game's from the departure onward; any later
                // trigger-driven elimination then lands on a different frame and the replay
                // diverges. Restoring the write here keeps playback on the live schedule (both
                // run the command handling before the trigger step, so the pass fires on the same
                // frame either way).
                self.trigger_execution_timer.write(1);
                debug!(
                    "Replay: storm player {} left at frame {}; forcing the next trigger pass",
                    storm_player.0, frame,
                );
            }
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
            let selection = self.selection.client_selection.resolve();
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
            // Alt+S and Alt+L open BW's save and load dialogs straight from gameplay, without the
            // game menu's buttons (which `dialog_hook` disables). A saved game can't be loaded
            // through ShieldBattery, so a live game never lets BW see either hotkey.
            #[cfg(debug_assertions)]
            if self.game_started.load(Ordering::Acquire) {
                let game = self.game();
                if !game.is_null() {
                    crate::input_latency_probe::on_window_message(msg, wparam, (*game).frame_count);
                    crate::hotkey_order_probe::on_window_message(
                        msg,
                        wparam,
                        self.delayed_control_activations
                            .as_ref()
                            .and_then(|x| x.first_deadline()),
                    );
                }
            }
            if hotkey_presses::activates_waiting_presses(msg)
                && let Some(presses) = &self.delayed_control_activations
            {
                #[cfg(debug_assertions)]
                let activate = !crate::hotkey_order_probe::keeps_presses_waiting();
                #[cfg(not(debug_assertions))]
                let activate = true;
                if activate {
                    presses.activate_waiting();
                }
            }
            if is_save_or_load_hotkey(msg, wparam)
                && self.game_started.load(Ordering::Acquire)
                && !game_thread::is_replay()
            {
                return Some(0);
            }
            // The options screen's own F5 presses go straight to the game, whatever the overlay is
            // holding the keyboard for: the screen is open while they arrive.
            use winapi::um::winuser::{VK_F5, WM_KEYDOWN, WM_KEYUP};
            if (msg == WM_KEYDOWN || msg == WM_KEYUP)
                && wparam == VK_F5 as usize
                && self
                    .posted_graphics_keys
                    .try_update(Ordering::AcqRel, Ordering::Acquire, |left| {
                        left.checked_sub(1)
                    })
                    .is_ok()
            {
                return None;
            }
            let mut render_state = match self.render_state.lock() {
                Some(s) => s,
                None => {
                    // If the lock is held for a long time (e.g. the crash dialog is pumping
                    // messages after a crash during overlay rendering), this path repeats for
                    // every message, so warning more than once would just flood the log.
                    warn_once!(
                        "Recursive window proc call?, not passing message {msg:x} to overlay state"
                    );
                    return None;
                }
            };
            let first_dialog = self.resolve_first_dialog();
            render_state
                .overlay
                .window_proc(window, msg, wparam, lparam, first_dialog)
        }
    }

    fn starting_fog(&self) -> StartingFog {
        self.starting_fog.load(Ordering::Acquire)
    }
}

/// The game's room for scrolling past the map's bottom edge.
struct BottomOverpan {
    /// The room, in tiles at default zoom.
    padding_tiles: Value<u16>,
    /// The bound every clamp on the view's top edge reads, which counts the room.
    scroll_max_y: Value<u32>,
    /// Recomputes the bounds after the room changes.
    update_scroll_bounds: unsafe extern "C" fn(),
}

/// How many map pixels a tile is.
const TILE_PIXELS: f32 = 32.0;

/// How much of the map, in map pixels, still reaches under the overlay's bottom panels with the view
/// scrolled as far past the map's bottom edge as it goes: a quarter of a tile, so the map meets the
/// panels rather than leaving a strip of nothing between them, and nothing at the bottom of the
/// map is hidden by more than a sliver.
const OVERPAN_UNDERLAP: f32 = TILE_PIXELS / 4.0;

/// A unit the game's view follows: its unique id, and where following it last left the view.
struct FollowedUnit {
    unique_id: u32,
    left_screen_at: Option<(u32, u32)>,
}

/// SC:R's software cursor draw, and the stack of render modes that sets the layer and render target
/// every draw command queued under it goes to.
struct SoftwareCursor {
    /// `fn()`; draws the cursor unless it is hidden or the hardware cursor is in use.
    draw: VirtualAddress,
    push_mode_override: unsafe extern "C" fn(u16),
    pop_mode_override: unsafe extern "C" fn(),
}

/// Appends what the observer stats recorded since the last call to the file `SB_STATS_DUMP` names,
/// for tuning what the timeline reports against real replays.
#[cfg(debug_assertions)]
fn dump_game_stats(stats: &GameStats) {
    use std::io::Write;
    static DUMP: Mutex<Option<(std::fs::File, u32)>> = Mutex::new(None);
    let mut dump = DUMP.lock();
    if dump.is_none() {
        // A directory, holding one file per game: named after the soak run playing it where there
        // is one, and after the process otherwise.
        let Some(dir) = std::env::var_os("SB_STATS_DUMP") else {
            return;
        };
        let run = std::env::var_os("SB_ROLLBACK_SOAK")
            .and_then(|done| {
                std::path::Path::new(&done)
                    .file_name()
                    .map(|name| name.to_string_lossy().replace(".done.json", ""))
            })
            .unwrap_or_else(|| std::process::id().to_string());
        let path = std::path::Path::new(&dir).join(format!("stats-{run}.csv"));
        match std::fs::File::create(&path) {
            Ok(file) => *dump = Some((file, 0)),
            Err(e) => {
                warn!("Couldn't create the stats dump: {e}");
                return;
            }
        }
    }
    let Some((file, through)) = dump.as_mut() else {
        return;
    };
    let (lines, newest) = stats.debug_lines_after(*through);
    *through = newest;
    for line in lines {
        let _ = writeln!(file, "{line}");
    }
}

/// Hands the observer panels the watcher has on screen to the app, which saves them for the next
/// game they watch.
fn save_observer_panels(panels: overlay_ui::shell::PanelPrefs) {
    match serde_json::to_value(panels) {
        Ok(value) => {
            let mut saved = SettingsChanged::default();
            saved.local.insert("observerPanels".into(), value);
            send_game_msg_to_async(GameThreadMessage::SettingsChanged(saved));
        }
        Err(e) => warn!("Couldn't save the observer panels: {e}"),
    }
}

/// The camera-px-per-mouse-px gain the grab pan sensitivity setting stands for.
///
/// The 0-150 slider value maps exponentially onto a gain of 0.125..=512 (2^-3..=2^9): the floor
/// pans at an eighth of the cursor's speed for precise framing, 50 is 1:1, and each 12.5 slider
/// units doubles the speed from there. The drag callback accumulates sub-pixel remainder so gains
/// below 1 still move the camera on slow drags.
fn grab_pan_gain(sensitivity: f32) -> f32 {
    (sensitivity.clamp(0.0, 150.0) * 0.08 - 3.0).exp2()
}

/// Whether a window message is part of an Alt+S (save game) or Alt+L (load game) keypress. Windows
/// sends an Alt combination as `WM_SYSKEYDOWN`/`WM_SYSKEYUP` with the key's virtual key code, and
/// `WM_SYSCHAR` with its character. An AltGr combination (Ctrl+Alt, which some layouts use to type
/// characters) arrives as ordinary key messages instead, so text input is never caught here.
fn is_save_or_load_hotkey(msg: u32, wparam: usize) -> bool {
    use winapi::um::winuser::{WM_SYSCHAR, WM_SYSKEYDOWN, WM_SYSKEYUP};
    match msg {
        WM_SYSKEYDOWN | WM_SYSKEYUP => matches!(wparam, 0x53 | 0x4c),
        WM_SYSCHAR => matches!(wparam, 0x53 | 0x73 | 0x4c | 0x6c),
        _ => false,
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
    use winapi::um::fileapi::{CREATE_ALWAYS, CREATE_NEW, OPEN_EXISTING};
    use winapi::um::winnt::{DELETE, GENERIC_READ, GENERIC_WRITE};
    unsafe {
        // The loader's worker threads reach this without TLS (see `windows::thread_has_tls`), so
        // paths they can take must not use `thread_local!`; the cookie.bin handling below that
        // does is only reached by the game opening its own files.
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
                } else if check_filename(filename, b"cookie.bin")
                    && !offline_cookie::is_inspecting()
                {
                    needs_time_hook = true;
                    debug!(
                        "CreateFileW for cookie.bin with params {access:x} {share:x} \
                            {creation_disposition:x} {flags:x}"
                    );
                    // Only plain reads are pointed elsewhere; anything that could write goes to
                    // the SDK's own file.
                    if access & (GENERIC_WRITE | DELETE) == 0
                        && creation_disposition == OPEN_EXISTING
                    {
                        let real_path = PathBuf::from(windows::os_string_from_winapi(filename));
                        if let Some(target) = offline_cookie::redirect_target(&real_path) {
                            let handle = orig(
                                windows::winapi_str(&target).as_ptr(),
                                access,
                                share,
                                security,
                                creation_disposition,
                                flags,
                                template,
                            );
                            if handle != -1isize as *mut c_void {
                                start_precise_system_time_hook();
                            } else {
                                let error = GetLastError();
                                warn!("Opening the offline cookie copy failed with code {error}");
                                SetLastError(error);
                            }
                            return handle;
                        }
                    }
                } else if check_filename(filename, b"Agent.dat") {
                    // Should happen earlier, but just in case
                    stop_precise_system_time_hook();
                    // Agent.dat holds the port of the Battle.net Agent, which ClientSdk talks to
                    // over HTTP. Nothing we use needs it, and when the Agent answers 401 ClientSdk
                    // retries forever (~45/s), nesting each retry's callback in the last one's
                    // until destroying the chain overflows the main thread's stack. Failing the
                    // open makes ClientSdk send its requests to AGENT_FALLBACK_PORT, which
                    // connect_hook refuses, and retry this open every few seconds. A refused
                    // connection makes ClientSdk try to launch the Agent, which shell_execute_hook
                    // blocks.
                    static LOGGED_AGENT_BLOCK: AtomicBool = AtomicBool::new(false);
                    if !LOGGED_AGENT_BLOCK.swap(true, Ordering::Relaxed) {
                        debug!("Blocking ClientSdk's Agent.dat lookup");
                    }
                    SetLastError(winapi::shared::winerror::ERROR_FILE_NOT_FOUND);
                    return -1isize as *mut c_void;
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

/// The port ClientSdk sends Battle.net Agent requests to when it can't read one from Agent.dat,
/// which create_file_hook always makes it fail to.
const AGENT_FALLBACK_PORT: u16 = 1120;

fn shell_execute_hook(
    hwnd: *mut c_void,
    verb: *const u16,
    file: *const u16,
    parameters: *const u16,
    directory: *const u16,
    show: i32,
    orig: unsafe extern "C" fn(
        *mut c_void,
        *const u16,
        *const u16,
        *const u16,
        *const u16,
        i32,
    ) -> *mut c_void,
) -> *mut c_void {
    unsafe {
        if !file.is_null() {
            const AGENT_PATH: &[u8] = b"\\battle.net\\agent\\agent.exe";
            let len = (0..).find(|&i| *file.add(i) == 0).unwrap();
            let file_slice = std::slice::from_raw_parts(file, len);
            let names_agent = file_slice
                .get(len.saturating_sub(AGENT_PATH.len())..)
                .filter(|ending| ending.len() == AGENT_PATH.len())
                .is_some_and(|ending| {
                    ending.iter().zip(AGENT_PATH).all(|(&a, &b)| {
                        let a = if a == b'/' as u16 { b'\\' as u16 } else { a };
                        a < 0x80 && (a as u8).eq_ignore_ascii_case(&b)
                    })
                });
            // ClientSdk launches the Agent whenever an Agent request fails to connect, and each
            // Agent it launches outlives the game. ClientSdk takes a failed launch as the request
            // failing, without retrying it.
            if names_agent {
                debug!("Blocking ClientSdk's Battle.net Agent launch");
                // Values of 32 and under are ShellExecuteW's errors, 2 being file not found.
                return 2 as *mut c_void;
            }
        }
        orig(hwnd, verb, file, parameters, directory, show)
    }
}

fn connect_hook(
    socket: usize,
    address: *const SOCKADDR,
    address_len: i32,
    orig: unsafe extern "C" fn(usize, *const SOCKADDR, i32) -> i32,
) -> i32 {
    use winapi::shared::ws2def::{AF_INET, SOCKADDR_IN};
    use winapi::um::winsock2::{SOCKET_ERROR, WSASetLastError};

    unsafe {
        if !address.is_null()
            && (*address).sa_family == AF_INET as u16
            && address_len as usize >= mem::size_of::<SOCKADDR_IN>()
        {
            let address = &*(address as *const SOCKADDR_IN);
            let ip = u32::from_be(*address.sin_addr.S_un.S_addr());
            if u16::from_be(address.sin_port) == AGENT_FALLBACK_PORT && ip >> 24 == 127 {
                // Whatever answers there is either not the Agent, or an Agent that may answer
                // 401, which ClientSdk retries with no limit, nesting each retry's callback in
                // the last one's until destroying the chain overflows the main thread's stack.
                static LOGGED_AGENT_CONNECT: AtomicBool = AtomicBool::new(false);
                if !LOGGED_AGENT_CONNECT.swap(true, Ordering::Relaxed) {
                    debug!("Refusing ClientSdk's Battle.net Agent connection");
                }
                WSASetLastError(winapi::shared::winerror::WSAECONNREFUSED as i32);
                return SOCKET_ERROR;
            }
        }
        orig(socket, address, address_len)
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
        if replay_save::last_save_skipped() {
            // SC:R treats a failed copy as a missing autosave and carries on.
            warn!("Not copying LastReplay.rep to the autosave folder: it holds an earlier game");
            SetLastError(winapi::shared::winerror::ERROR_FILE_NOT_FOUND);
            return 0;
        }

        // Rename the copy after the user's replay name template, keeping SC:R's folder.
        let dest_name_len = (0..).find(|&i| *dest_name.add(i) == 0).unwrap();
        let dest_name_slice = std::slice::from_raw_parts(dest_name, dest_name_len);
        let mut path = PathBuf::from(windows::os_string_from_winapi(dest_name_slice));
        path.pop();

        let filename_base =
            crate::replay_name::render(crate::replay_name::template(), &replay_name_context());

        let mut i = 2;
        let mut filename = format!("{filename_base}.rep");
        // Add (2) (3) etc if filename already exists. A template without the time (say, just the
        // matchup and opponent) repeats for every rematch within SC:R's per-day folder, so the
        // limit only guards against an endless loop.
        loop {
            path.push(&filename);
            if !path.exists() {
                break;
            }
            path.pop();
            if i > 9999 {
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

/// The game's details that a replay name template can refer to, read once the game has ended.
///
/// By then a player who left or was defeated no longer reads as a human in `players[]`, so humans
/// come from the player id mapping made at game start (their race and team stay in place), named
/// by their ShieldBattery account rather than the in-game name.
unsafe fn replay_name_context() -> crate::replay_name::NameContext {
    unsafe {
        let bw = bw::get_bw();
        let players = bw.players();
        let setup_info = game_thread::setup_info();
        let local_user_id = game_thread::local_user_id();
        let user_name = |id: SbUserId| {
            setup_info
                .and_then(|info| info.users.iter().find(|u| u.id == id))
                .map(|u| u.name.clone())
        };

        let mut participants = Vec::new();
        for mapping in game_thread::player_id_mapping() {
            let Some(id) = mapping.game_id.filter(|id| !id.is_observer()) else {
                continue;
            };
            let player = players.add(id.0 as usize);
            participants.push((
                id.0,
                crate::replay_name::NamePlayer {
                    name: user_name(mapping.sb_user_id)
                        .unwrap_or_else(|| bw::player_name(player).into_owned()),
                    race: (*player).race.try_into().ok(),
                    team: (*player).team,
                    is_local: Some(mapping.sb_user_id) == local_user_id,
                },
            ));
        }
        for i in 0..8u8 {
            let player = players.add(i as usize);
            // Computers have no player id mapping. In-game player type 1 = computer.
            if (*player).player_type == 1 {
                participants.push((
                    i,
                    crate::replay_name::NamePlayer {
                        name: bw::player_name(player).into_owned(),
                        race: (*player).race.try_into().ok(),
                        team: (*player).team,
                        is_local: false,
                    },
                ));
            }
        }
        participants.sort_by_key(|&(id, _)| id);

        let now = chrono::Local::now();
        crate::replay_name::NameContext {
            date: now.format("%Y-%m-%d").to_string(),
            time: now.format("%H%M%S").to_string(),
            map: game_thread::map_name_for_filename(),
            is_ums: game_thread::is_ums(),
            local_name: local_user_id.and_then(user_name),
            players: participants.into_iter().map(|(_, p)| p).collect(),
        }
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

        // Only the thread that opened cookie.bin ever has the count set, and the count lives in
        // TLS, which some threads don't have.
        if !windows::thread_has_tls() {
            return;
        }
        if PRECISE_SYSTEM_TIME_HOOK_ENABLED_COUNT.get() > 0 {
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
    use winapi::shared::ws2def::SOCKADDR;

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
        !0 => StepGameLoop();
        // Takes an array of callbacks to run before drawing the layers, and its length; the
        // in-game loop passes its per-frame HUD update alone.
        !0 => RenderScreen(*mut c_void, usize);
        !0 => StepReplayCommands();
        // Takes the full replay file path; returns nonzero on success.
        !0 => SaveReplay(*const i8) -> u32;
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
        !0 => RecordTurnSyncSlot();
        !0 => NetFormatTurnRate(*mut scr::NetFormatTurnRateResult, bool) ->
            *mut scr::NetFormatTurnRateResult;
        !0 => UpdateGameScreenSize(f32);
        // The default middle-mouse-down/up UI event handlers. Each takes the event and returns a
        // value the dispatcher ignores. Down is hooked to swap in the custom-sensitivity grab pan
        // callback after the original installs the built-in one; up to restore the cursor position.
        !0 => UiDefaultMiddleDownHandler(*mut c_void) -> u32;
        !0 => UiDefaultMiddleUpHandler(*mut c_void) -> u32;
        // The three minimap dot-draw functions, hooked for the minimap-only team-color mode. All
        // cdecl (the dispatcher takes no argument we use; both per-player helpers take the player id
        // as their first stack argument and the caller cleans it up). Full overrides that always
        // fall through to `orig`.
        !0 => DrawMinimapUnits();
        !0 => DrawMinimapPlayerUnits(u32);
        !0 => DrawMinimapMainPlayerUnits(u32);
        !0 => DrawGraphicLayers(*mut c_void, usize, u32);
        !0 => DrawSoftwareCursor();
        !0 => DecideCursorType() -> u32;
        // BW's tick-gated client-side work; see `tick_gates`.
        !0 => UpdateScreenScrolling();
        !0 => UpdatePaletteCycles();
        !0 => UpdateGameCursor();
        !0 => StepMenuCursorAnimation();
        !0 => PrintText(*const i8, u32, u32);
        !0 => NetPlayerCount() -> u32;
        // Picks the palette index closest to an RGB color; the first argument is the
        // `[[u8; 4]; 256]` palette. Hooked to keep it from reading the tileset color-cycling table
        // while no terrain is loaded.
        !0 => FindNearestPaletteColor(*const u8, u32) -> u32;
        // `get_player_color(out, player)`: writes the player's `[f32; 4]` unit tint to `out` and
        // returns `out`. `player` is a single byte, so only the low byte of the argument is
        // meaningful.
        !0 => GetPlayerColor(*mut [f32; 4], u32) -> *mut [f32; 4];
        // `save_replay_by_name(name, replace_existing)`. `replace_existing` is a C bool, so it is a
        // single byte in the register/stack slot rather than a full word.
        !0 => SaveReplayByName(*const i8, u8) -> i32;
        // `update_minimap_dialog_horizontal_offset(expand)`: moves the minimap dialog left by the
        // widescreen margin when `expand` (a C bool) is set, and back when it isn't.
        !0 => UpdateMinimapDialogHorizontalOffset(u8);
    );

    // Instrumentation-only hooks, all cdecl.
    //
    // EngineAlloc / EngineFree are the engine's second allocation path over the OS heap, counted
    // per simulation step alongside the allocator vtable object's own traffic. Both take (size or
    // pointer, allocation tag pointer, tag, flags); the free's boolean result comes back in the
    // low byte of the return register, so the whole register value is passed through.
    #[cfg(debug_assertions)]
    whack_hooks!(0, // cdecl
        !0 => EngineAlloc(usize, usize, u32, u32) -> *mut u8;
        !0 => EngineFree(*mut u8, usize, u32, u32) -> u32;
    );

    // Hooks the rollback engine keeps once-per-frame effects in step with its re-simulation
    // through, all cdecl.
    //
    // PlaySound's signature matches the `play_sound` function pointer BwScr calls directly:
    // (sound id, volume, unknown, x, y).
    whack_hooks!(0, // cdecl
        !0 => PlaySound(u32, f32, *mut c_void, *mut i32, *mut i32) -> u32;
        // (player, unit id, check supply, show error) -> can afford
        !0 => CheckUnitResourcesAndSupply(u32, u32, u32, u32) -> u32;
        !0 => ShowGameMessage(*const u8, u32);
        // Place the order confirmation marker at a map position.
        !0 => ShowCursorMarkerAt(i32, i32);
        // Replace the local selection: (unit count, units, play the selection response, send a
        // selection command).
        !0 => SelectUnits(u32, *const *mut bw::Unit, u32, u32);
        // Open the defeat and victory dialogs.
        !0 => OpenDefeatMissionDialog();
        !0 => OpenVictoryMissionDialog();
    );

    // The observer UI's notifications from the simulation, methods on the observer UI object that
    // take the unit concerned. The trailing flag of the first is whether to track a unit that is
    // already complete, and of the last whether the research or upgrade completed rather than
    // being canceled; both are C bools passed in a full argument slot.
    thiscall_hooks!(
        !0 => ObserverUiTrackBuildingUnit(*mut c_void, *mut bw::Unit, u32);
        !0 => ObserverUiTrackResearchOrUpgrade(*mut c_void, *mut bw::Unit);
        !0 => ObserverUiRemoveBuildingUnitRecord(*mut c_void, *mut bw::Unit);
        !0 => ObserverUiFinishResearchOrUpgrade(*mut c_void, *mut bw::Unit, u32);
        // Make a unit's (or fog sprite's) selection circle blink, the object in ecx on 32-bit.
        !0 => SetSpriteSelectionFlashTimer(*mut c_void, u32);
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
        !0 => Sleep(u32);
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
        !0 => ShellExecuteW(
            *mut c_void,
            *const u16,
            *const u16,
            *const u16,
            *const u16,
            i32,
        ) -> *mut c_void;
        !0 => WsConnect(usize, *const SOCKADDR, i32) -> i32;
    );

    thiscall_hooks!(
        !0 => FontCacheRenderAscii(*mut c_void);
        !0 => StartUdpServer(*mut c_void) -> u32;
        !0 => StepIo(*mut c_void);
        !0 => Renderer_Render(*mut scr::Renderer, *mut scr::DrawCommands, u32, u32) -> u32;
        // Ignores `this`; SC:R's Prism renderer keeps its swap chain in globals.
        !0 => Renderer_SwapBuffers(*mut scr::Renderer) -> usize;
        !0 => Renderer_CreateShader(
            *mut scr::Renderer,
            *mut scr::Shader,
            *const u8,
            *const u8,
            *const u8,
            *mut c_void,
        ) -> usize;
        !0 => Console_HitTest(*mut scr::UiConsole, i32, i32) -> u8;
        !0 => Console_Draw(*mut scr::UiConsole) -> u32;
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
        // Game-loop init is over (this runs after the loop's first message pump, stalled network
        // or not, and in replays), so SC:R's cursor moves are the player's again.
        crate::forge::suppress_scr_cursor_moves(false);
        if game_thread::is_replay() {
            // Make replay buttons line up better with the pre-SC:R replay ui
            bw.offset_statbtn_dialog(3, -3);
            bw.restore_replay_visions();
            bw.seek_to_replay_start_frame();
            bw.restore_replay_playback();
        } else {
            bw.record_replay_notice();
        }
    }
    // Observer / replay UI in SC:R has a bug with toggling player visions:
    // In order to immediately update un/detected sprite to match what players see,
    // BW calls update_detection_status(unit) that in addition to updating sprite
    // (not expected to be synced), will write to unit.detection_status (expected to be synced).
    //
    // Fixing this by reverting any changes to unit.detection_status outside step_game_logic,
    // this simpler to implement than adding analysis for the obs UI functions.
    //
    // That vision-toggle UI only exists on replay and observer clients; a playing client's
    // vision changes all go through synced commands handled inside step_game_logic, so nothing
    // can corrupt detection_status between steps there and the save/restore passes are skipped.
    // A low-rate fingerprint of the synced state, logged in live games and replay playback
    // alike: any simulation divergence perturbs the RNG draw sequence and resource flow almost
    // immediately, so diffing these lines between a live game's log and its replay's log finds
    // the first diverged interval without any special tooling. The `rng` words are the u32s
    // around the operand the analysis resolves as the RNG seed — the block holds the seed and
    // the advancing rand state/draw counters, so some of the words move with every synced draw.
    // `trigger_timer` is the trigger step's countdown: a live-vs-playback difference in it
    // means the two run their trigger passes on different frames (a player leave restarts it).
    {
        let game = bw.game();
        if !game.is_null() {
            let frame = (*game).frame_count;
            static LAST_PROBE_FRAME: AtomicU32 = AtomicU32::new(u32::MAX);
            if frame.is_multiple_of(240) && LAST_PROBE_FRAME.swap(frame, Ordering::Relaxed) != frame
            {
                let seed_ptr = bw.rng_seed.resolve_as_ptr();
                let mut rng_words = [0u32; 6];
                for (i, out) in rng_words.iter_mut().enumerate() {
                    *out = seed_ptr.add(i).read_unaligned();
                }
                let minerals = (*game).minerals;
                let gas = (*game).gas;
                let trigger_timer = bw.trigger_execution_timer.resolve();
                debug!(
                    "Sync probe: frame {} rng {:x?} minerals {:?} gas {:?} trigger_timer {}",
                    frame,
                    rng_words,
                    &minerals[..4],
                    &gas[..4],
                    trigger_timer,
                );
            }
        }
    }
    #[cfg(debug_assertions)]
    if !game_thread::is_replay() {
        let game = bw.game();
        if !game.is_null() {
            crate::input_latency_probe::on_step((*game).frame_count, || {
                bw.input_probe_select_worker()
            });
            crate::hotkey_order_probe::on_step((*game).frame_count, || {
                bw.input_probe_select_worker()
            });
        }
    }
    let has_obs_vision_ui = game_thread::is_replay()
        || BwPlayerId(bw.local_unique_player_id.resolve() as u8).is_observer();
    if !has_obs_vision_ui {
        return step_one_game_logic_step(bw, param, orig);
    }
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
    let ret = step_one_game_logic_step(bw, param, orig);
    {
        let mut detection_status = bw.detection_status_copy.lock();
        let unit_count = (*units).length;
        let unit_ptr = (*units).data as *mut bw::Unit;
        detection_status.clear();
        detection_status.extend((0..unit_count).map(|i| (*unit_ptr.add(i)).detection_status));
    }
    ret
}

/// The frame the step in progress produces during a rollback tick, and whether it re-simulates a
/// frame the game has already shown, or `None` outside a rollback tick.
fn rollback_step() -> Option<(u32, bool)> {
    crate::rollback::tick_running().then(|| {
        (
            crate::rollback::step_frame(),
            crate::rollback::in_resimulation(),
        )
    })
}

/// Whether the step in progress re-simulates a frame the game has already shown, so what it does
/// for the game's record-keeping rather than its simulation already happened.
fn rollback_resimulating() -> bool {
    rollback_step().is_some_and(|(_, resimulating)| resimulating)
}

/// Whether this client has native sync (0x37) turned off: it neither sends sync commands nor
/// verifies peers' ones. Native sync hashes state that a rollback re-simulation does not
/// reproduce, so a client that rolls back would otherwise report its peers as desynced.
fn native_sync_disabled() -> bool {
    crate::rollback_live::native_sync_off()
}

/// Whether the step in progress re-simulates a frame of a live netcode v2 game, whose turns
/// already went out and came in when the frame was first simulated. Replay playback re-simulates
/// through the replay's own command stream instead, and has no session to take turns from.
fn live_rollback_resimulating() -> bool {
    rollback_resimulating() && netcode_v2::with_turn_state(|_| ()).is_some()
}

/// The single place [`step_game_logic_hook`] hands control to BW's own logic step, so anything
/// that has to bracket the simulation only has to be attached here instead of at each of the
/// hook's exit paths.
unsafe fn step_one_game_logic_step(
    bw: &'static BwScr,
    param: usize,
    orig: unsafe extern "C" fn(usize) -> usize,
) -> usize {
    unsafe {
        if let Some(ret) = crate::rollback_live::run_game_logic_step(bw, param, orig) {
            return ret;
        }
        #[cfg(debug_assertions)]
        if let Some(ret) = crate::rollback_bench::run_game_logic_step(bw, param, orig) {
            return ret;
        }
        if let Some(ret) = crate::replay_seek::run_game_logic_step(bw, param, orig) {
            return ret;
        }
        step_outside_rollback(bw, param, orig)
    }
}

/// Runs a logic step that no rollback driver took: through the replay harness, which leaves it to
/// BW's own step unless it is armed.
#[cfg(debug_assertions)]
unsafe fn step_outside_rollback(
    bw: &'static BwScr,
    param: usize,
    orig: unsafe extern "C" fn(usize) -> usize,
) -> usize {
    unsafe {
        crate::rollback_soak::run_game_logic_step(bw, || {
            crate::rollback_harness::run_game_logic_step(bw, param, orig)
        })
    }
}

/// Runs a logic step that no rollback driver took.
#[cfg(not(debug_assertions))]
unsafe fn step_outside_rollback(
    _bw: &'static BwScr,
    param: usize,
    orig: unsafe extern "C" fn(usize) -> usize,
) -> usize {
    unsafe { orig(param) }
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn observer_slots_map_to_out_of_band_game_player_ids() {
        for slot in 0..8u8 {
            assert_eq!(game_player_id_for_slot(slot), slot);
        }
        assert_eq!(game_player_id_for_slot(12), 0x80);
        assert_eq!(game_player_id_for_slot(13), 0x81);
        assert_eq!(game_player_id_for_slot(14), 0x82);
        assert_eq!(game_player_id_for_slot(15), 0x83);
        for slot in 12..16u8 {
            assert!(BwPlayerId(game_player_id_for_slot(slot)).is_observer());
        }
    }

    #[test]
    fn save_and_load_hotkeys_are_only_their_alt_messages() {
        use winapi::um::winuser::{WM_CHAR, WM_KEYDOWN, WM_SYSCHAR, WM_SYSKEYDOWN, WM_SYSKEYUP};
        for &vk in b"SL" {
            assert!(is_save_or_load_hotkey(WM_SYSKEYDOWN, vk as usize));
            assert!(is_save_or_load_hotkey(WM_SYSKEYUP, vk as usize));
            // Without Alt (or with AltGr) the same key is ordinary input.
            assert!(!is_save_or_load_hotkey(WM_KEYDOWN, vk as usize));
        }
        for &ch in b"sSlL" {
            assert!(is_save_or_load_hotkey(WM_SYSCHAR, ch as usize));
            assert!(!is_save_or_load_hotkey(WM_CHAR, ch as usize));
        }
        // Other Alt hotkeys, like Alt+M for the game menu, pass through.
        assert!(!is_save_or_load_hotkey(WM_SYSKEYDOWN, b'M' as usize));
        assert!(!is_save_or_load_hotkey(WM_SYSCHAR, b'm' as usize));
    }
}
