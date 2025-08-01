use std::ffi::CStr;
use std::marker::PhantomData;
use std::mem;
use std::path::{Path, PathBuf};
use std::ptr::{self, NonNull, null, null_mut};
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, AtomicI32, AtomicU32, AtomicUsize, Ordering};
use std::time::Instant;

use bw_dat::UnitId;
use byteorder::{ByteOrder, LittleEndian};
use hashbrown::HashMap;
use libc::c_void;
use parking_lot::{Mutex, RwLock};
use smallvec::SmallVec;
use winapi::shared::minwindef::FILETIME;
use winapi::shared::windef::HWND;
use winapi::um::errhandlingapi::SetLastError;
use winapi::um::libloaderapi::GetModuleHandleW;

use scr_analysis::{DatType, VirtualAddress, scarf};
use sdf_cache::{InitSdfCache, SdfCache};
use shader_replaces::ShaderReplaces;
pub use thiscall::Thiscall;
use winapi::um::processthreadsapi::GetCurrentThreadId;

use crate::app_messages::{AtomicStartingFog, MapInfo, SbUserId, Settings, StartingFog};
use crate::bw::apm_stats::ApmStats;
use crate::bw::players::StormPlayerId;
use crate::bw::unit::{Unit, UnitIterator};
use crate::bw::{self, Bw, FowSpriteIterator, LobbyOptions, SnpFunctions};
use crate::bw::{UserLatency, commands};
use crate::bw_scr::scr::SafeBwString;
use crate::game_state::JoinedPlayer;
use crate::game_thread::{self, send_game_msg_to_async};
use crate::recurse_checked_mutex::Mutex as RecurseCheckedMutex;
use crate::snp;
use crate::sync::DumbSpinLock;
use crate::windows;
use crate::{GameThreadMessage, PROCESS_INIT_HOOK_REACHED};

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
    units: Value<*mut scr::BwVector>,
    vertex_buffer: Value<*mut scr::VertexBuffer>,
    renderer: Value<*mut scr::Renderer>,
    draw_commands: Value<*mut scr::DrawCommands>,
    /// [[u8; 4]; 256], mostly unused in SC:R, but still gets used for player colors at least.
    main_palette: Value<*mut u8>,
    rgb_colors: Value<*mut [[f32; 0x4]; 0x8]>,
    use_rgb_colors: Value<u8>,
    statres_icons: Value<*mut scr::DdsGrpSet>,
    cmdicons: Value<*mut scr::DdsGrpSet>,
    replay_bfix: Option<Value<*mut scr::ReplayBfix>>,
    replay_gcfg: Option<Value<*mut scr::ReplayGcfg>>,
    anti_troll: Option<Value<*mut scr::AntiTroll>>,
    first_dialog: Option<Value<*mut bw::Dialog>>,
    graphic_layers: Option<Value<*mut bw::GraphicLayer>>,
    snet_local_player_list: Option<Value<*mut bw::StormListHead<bw::SNetPlayerConnection>>>,
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
    choose_snp: unsafe extern "C" fn(u32) -> u32,
    init_storm_networking: unsafe extern "C" fn(),
    ttf_malloc: unsafe extern "C" fn(usize) -> *mut u8,
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
    lobby_create_callback_offset: usize,
    starcraft_tls_index: SendPtr<*mut u32>,
    print_text_addr: VirtualAddress,

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
        let select_map_entry = analysis.select_map_entry().ok_or("select_map_entry")?;
        let game_state = analysis.game_state().ok_or("Game state")?;
        let rng_seed = analysis.rng_seed().ok_or("RNG seed")?;
        let mainmenu_entry_hook = analysis.mainmenu_entry_hook().ok_or("Entry hook")?;
        let game_loop = analysis.game_loop().ok_or("Game loop")?;
        let init_map_from_path = analysis.init_map_from_path().ok_or("init_map_from_path")?;
        let join_game = analysis.join_game().ok_or("join_game")?;
        let init_sprites = analysis.load_images().ok_or("Init sprites")?;
        let init_real_time_lighting = analysis.init_real_time_lighting();
        let sprites_inited = analysis.images_loaded().ok_or("Sprites inited")?;
        let init_game_network = analysis.init_game_network().ok_or("Init game network")?;
        let process_lobby_commands = analysis
            .process_lobby_commands()
            .ok_or("Process lobby commands")?;
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
        let select_units = analysis.select_units().ok_or("select_units")?;
        let lookup_sound_id = analysis.lookup_sound_id().ok_or("lookup_sound")?;
        let play_sound = analysis.play_sound().ok_or("play_sound")?;
        let print_text_addr = analysis.print_text().ok_or("print_text")?;

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
            statres_icons: Value::new(ctx, statres_icons),
            cmdicons: Value::new(ctx, cmdicons),
            screen_x: Value::new(ctx, screen_x),
            screen_y: Value::new(ctx, screen_y),
            game_screen_width_bwpx: Value::new(ctx, game_screen_width_bwpx),
            game_screen_height_bwpx: Value::new(ctx, game_screen_height_bwpx),
            zoom: Value::new(ctx, zoom),
            game_screen_height_ratio: game_screen_height_ratio.map(move |x| Value::new(ctx, x)),
            replay_bfix: replay_bfix.map(move |x| Value::new(ctx, x)),
            replay_gcfg: replay_gcfg.map(move |x| Value::new(ctx, x)),
            anti_troll: anti_troll.map(move |x| Value::new(ctx, x)),
            first_dialog: first_dialog.map(move |x| Value::new(ctx, x)),
            graphic_layers: graphic_layers.map(move |x| Value::new(ctx, x)),
            snet_local_player_list: snet_local_player_list.map(move |x| Value::new(ctx, x)),
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
            process_lobby_commands: unsafe { mem::transmute(process_lobby_commands.0) },
            send_command: unsafe { mem::transmute(send_command.0) },
            choose_snp: unsafe { mem::transmute(choose_snp.0) },
            init_storm_networking: unsafe { mem::transmute(init_storm_networking.0) },
            snet_recv_packets: unsafe { mem::transmute(snet_recv_packets.0) },
            snet_send_packets: unsafe { mem::transmute(snet_send_packets.0) },
            ttf_malloc: unsafe { mem::transmute(ttf_malloc.0) },
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
            load_snp_list,
            start_udp_server,
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
                            if let Some(ref mut apm) = apm_state {
                                if !is_replay || are_recorded_replay_commands != 0 {
                                    apm.action(unique_command_user as u8, command);
                                }
                            }
                            match command {
                                [commands::id::REPLAY_SEEK, rest @ ..] if rest.len() == 4 => {
                                    if are_recorded_replay_commands == 0 {
                                        let frame = LittleEndian::read_u32(rest);
                                        let game = self.game();
                                        if (*game).frame_count > frame {
                                            self.is_replay_seeking.store(true, Ordering::Relaxed);
                                        }
                                    }
                                }
                                [commands::id::SYNC, ..] | [commands::id::NOP, ..] => {
                                    if are_recorded_replay_commands == 0 {
                                        sync_seen = true;
                                    }
                                }
                                _ => (),
                            }
                        }
                    }

                    if !is_replay {
                        if let Some(players) = self.check_player_drops() {
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
                    if let Some(&byte) = slice.first() {
                        if byte == 0x48 && player == 0 {
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
                    let cur_user_latency = self.net_user_latency.resolve();
                    let user_delay = 2 /* proto_latency */ + cur_user_latency;
                    let effective_latency =
                        ((1000f32 * user_delay as f32 + 500f32) / turn_rate as f32).round();
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
            if let Some(ref patch) = self.cursor_dimension_patch {
                let address = patch.address.0 as usize - base;
                exe.replace(address, &patch.data);
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
                    if let Some(render_state) = self.render_state.lock() {
                        if let Some(val) = render_state.overlay.decide_cursor_type() {
                            return val as u32;
                        }
                    }
                    orig()
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
                    if self.print_text_hooks_disabled.load(Ordering::Acquire) <= 0 {
                        if let Ok(text) = CStr::from_ptr(text).to_str() {
                            let handled = self.chat_manager.lock().handle_message(text, player);
                            if handled {
                                return;
                            }
                        }
                    }

                    orig(text, player, unused);
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
                if let Err(e) = crate::replay::add_shieldbattery_data(
                    handle,
                    self,
                    self.exe_build,
                    game_thread::setup_info().unwrap(),
                    game_thread::player_id_mapping(),
                ) {
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
        is_chat_restricted: bool,
    ) {
        let mut chat_manager = self.chat_manager.lock();
        chat_manager.set_players(players);
        chat_manager.set_local_player_info(local_user_id, is_chat_restricted);
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
        self.is_carbot.store(is_carbot, Ordering::Relaxed);
        self.show_skins.store(show_skins, Ordering::Relaxed);
        self.starting_fog.store(starting_fog, Ordering::Relaxed);
        self.visualize_network_stalls
            .store(visualize_network_stalls, Ordering::Relaxed);
        self.disable_hd.store(disable_hd, Ordering::Relaxed);
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
            (self.snet_recv_packets)();
            (self.snet_send_packets)();
            (self.step_network)() != 0
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
            let local_storm_id = self.local_storm_id.resolve();
            if local_storm_id == 0 {
                let data = bw::LobbyGameInitData {
                    game_init_command: 0x48,
                    random_seed: seed,
                    // TODO(tec27): deal with player bytes if we ever allow save games
                    player_bytes: [8; 8],
                };
                debug!(
                    "Sending lobby game init data: {:#x} {:#x} {:#x?}",
                    data.game_init_command, seed, data.player_bytes
                );
                let ptr = &data as *const bw::LobbyGameInitData as *const u8;
                let len = mem::size_of::<bw::LobbyGameInitData>();
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
                lobby_create_callback as usize;

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
            let players = self.players();
            let game = self.game();
            let unique_player =
                match (0..8).position(|i| (*players.add(i)).storm_id as u8 == storm_player.0) {
                    Some(s) => s as u8,
                    None => return,
                };
            let game_player = if game_thread::is_team_game() {
                // Teams start from 1
                let team = (*players.add(unique_player as usize)).team;
                (*game).team_game_main_player[team as usize - 1]
            } else {
                unique_player
            };
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

    unsafe fn storm_players(&self) -> Vec<bw::StormPlayer> {
        unsafe {
            let ptr = self.storm_players.resolve();
            let scr_players = std::slice::from_raw_parts(ptr, NET_PLAYER_COUNT);
            scr_players
                .iter()
                .map(|player| bw::StormPlayer {
                    state: player.state,
                    unk1: player.unk1,
                    flags: player.flags,
                    unk4: player.unk4,
                    protocol_version: player.protocol_version,
                    name: {
                        let mut name = [0; 0x19];
                        name[..0x18].copy_from_slice(&player.name[..0x18]);
                        name
                    },
                    padding: 0,
                })
                .collect()
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
            }
        }

        orig(filename)
    }
}

fn create_file_hook(
    bw: &BwScr,
    filename: *const u16,
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
        if !filename.is_null() {
            let name_len = (0..).find(|&i| *filename.add(i) == 0).unwrap();
            let filename = std::slice::from_raw_parts(filename, name_len);
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
                }

                if check_filename(filename, b"cookie.bin") {
                    start_precise_system_time_hook();
                } else if check_filename(filename, b"Agent.dat") {
                    stop_precise_system_time_hook();
                }
            }
        }
        let handle = orig(
            filename,
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
        handle
    }
}

fn check_filename(filename: &[u16], compare: &[u8]) -> bool {
    let ending =
        Some(()).and_then(|()| filename.get(filename.len().checked_sub(compare.len() + 1)?..));
    if let Some(ending) = ending {
        if (ending[0] == b'\\' as u16 || ending[0] == b'/' as u16)
            && ascii_compare_u16_u8_casei(&ending[1..], compare)
        {
            return true;
        }
    }
    false
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

// We only want to hook one specific thread that uses these times.
static PRECISE_SYSTEM_TIME_HOOK_ENABLED_ON: AtomicU32 = AtomicU32::new(0);

pub fn start_precise_system_time_hook() {
    let thread_id = unsafe { GetCurrentThreadId() };
    PRECISE_SYSTEM_TIME_HOOK_ENABLED_ON.store(thread_id, Ordering::Release);
}

fn stop_precise_system_time_hook() {
    PRECISE_SYSTEM_TIME_HOOK_ENABLED_ON.store(0, Ordering::Release);
}

fn get_system_time_precise_as_file_time_hook(
    time: *mut FILETIME,
    orig: unsafe extern "C" fn(*mut FILETIME),
) {
    unsafe {
        orig(time);

        if !PROCESS_INIT_HOOK_REACHED.load(Ordering::Acquire)
            && PRECISE_SYSTEM_TIME_HOOK_ENABLED_ON.load(Ordering::Acquire) == GetCurrentThreadId()
        {
            // Making StarCraft feel young again makes it initialize a bit faster
            (*time).dwHighDateTime = 0x01BF53B7;
            (*time).dwLowDateTime = 0x8F200000;
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
        snp::initialize(&*client_info, None);
        // We'll also have to call the SCR's normal LAN SNP init function, which initializes
        // a global that SCR will try to access on game joining. Luckily it won't initialize
        // anything else we don't want.
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
        !0 => GameInit();
        !0 => EntryPoint();
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
        !0 => NetFormatTurnRate(*mut scr::NetFormatTurnRateResult, bool) ->
            *mut scr::NetFormatTurnRateResult;
        !0 => UpdateGameScreenSize(f32);
        !0 => DrawGraphicLayers(*mut c_void, usize, u32);
        !0 => DecideCursorType() -> u32;
        !0 => PrintText(*const i8, u32, u32);
    );

    system_hooks!(
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
