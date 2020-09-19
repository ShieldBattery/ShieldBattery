mod bw_hash_table;
mod commands;
mod file_hook;
mod pe_image;
mod sdf_cache;
mod thiscall;

use std::marker::PhantomData;
use std::mem;
use std::path::Path;
use std::ptr::{null, null_mut};
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};

use byteorder::{ByteOrder, LittleEndian};
use libc::c_void;
use samase_scarf::scarf::{self};
use winapi::um::libloaderapi::{GetModuleHandleW};

use crate::bw::{self, Bw};
use crate::snp;

use sdf_cache::{InitSdfCache, SdfCache};

const NET_PLAYER_COUNT: usize = 12;

pub struct BwScr {
    game: Value<*mut bw::Game>,
    players: Value<*mut bw::Player>,
    storm_players: Value<*mut scr::StormPlayer>,
    storm_player_flags: Value<*mut u32>,
    lobby_state: Value<u8>,
    is_multiplayer: Value<u8>,
    game_state: Value<u8>,
    sprites_inited: Value<u8>,
    local_player_id: Value<u32>,
    local_unique_player_id: Value<u32>,
    local_storm_id: Value<u32>,
    net_player_to_game: Value<*mut u32>,
    net_player_to_unique: Value<*mut u32>,
    local_player_name: Value<*mut u8>,
    fonts: Value<*mut *mut scr::Font>,

    init_network_player_info: unsafe extern "C" fn(u32, u32, u32, u32),
    step_network: unsafe extern "C" fn(),
    select_map_entry: unsafe extern "C" fn(
        *mut scr::GameInput,
        *mut *const scr::LobbyDialogVtable,
        *mut scr::MapDirEntry,
    ) -> u32,
    // arg 1 path, a2 out, a3 is_campaign, a4 unused?
    init_map_from_path: unsafe extern "C" fn(*const u8, *mut c_void, u32, u32) -> u32,
    join_game:
        unsafe extern "C" fn(*mut scr::JoinableGameInfo, *mut scr::BwString, usize) -> u32,
    game_loop: unsafe extern "C" fn(),
    init_sprites: unsafe extern "C" fn(),
    init_game_network: unsafe extern "C" fn(),
    process_lobby_commands: unsafe extern "C" fn(*const u8, usize, u32),
    choose_snp: unsafe extern "C" fn(u32) -> u32,
    init_storm_networking: unsafe extern "C" fn(),
    ttf_malloc: unsafe extern "C" fn(usize) -> *mut u8,
    send_command: unsafe extern "C" fn(*const u8, usize),
    snet_recv_packets: unsafe extern "C" fn(),
    snet_send_packets: unsafe extern "C" fn(),
    mainmenu_entry_hook: scarf::VirtualAddress,
    load_snp_list: scarf::VirtualAddress,
    font_cache_render_ascii: scarf::VirtualAddress,
    ttf_render_sdf: scarf::VirtualAddress,
    process_game_commands: scarf::VirtualAddress,
    step_io: scarf::VirtualAddress,
    game_command_lengths: Vec<u32>,
    /// Some only if hd graphics are to be disabled
    open_file: Option<scarf::VirtualAddress>,
    lobby_create_callback_offset: usize,
    starcraft_tls_index: SendPtr<*mut u32>,

    // State
    sdf_cache: Arc<InitSdfCache>,
    is_replay_seeking: AtomicBool,
    lobby_game_init_command_seen: AtomicBool,
}

struct SendPtr<T>(T);
unsafe impl<T> Send for SendPtr<T> {}
unsafe impl<T> Sync for SendPtr<T> {}

mod scr {
    use libc::{c_void, sockaddr};

    use super::thiscall::Thiscall;

    #[repr(C)]
    pub struct SnpLoadFuncs {
        pub identify: unsafe extern "stdcall" fn(
            u32, // snp index
            *mut u32, // id
            *mut *const u8, // name
            *mut *const u8, // description
            *mut *const crate::bw::SnpCapabilities,
        ) -> u32,
        pub bind: unsafe extern "stdcall" fn(u32, *mut *const SnpFunctions) -> u32,
    }

    #[repr(C)]
    pub struct LobbyDialogVtable {
        pub functions: [usize; 0x50],
    }

    #[repr(C)]
    pub struct GameInput {
        pub name: BwString,
        pub password: BwString,
        pub speed: u8,
        pub game_type_subtype: u32,
        pub turn_rate: u32,
        pub game_flag1: u8,
        pub old_limits: u8,
        pub eud: u8,
        pub safety_padding: [u8; 0x21],
    }

    #[repr(C)]
    pub struct MapDirEntry {
        pub key: u32,
        pub unk4: [u8; 0x1c],
        pub filename: BwString,
        pub title: BwString,
        pub description: BwString,
        pub error_message: BwString,
        pub unk90: BwString,
        pub unkac: BwString,
        pub unkc8: BwString,
        pub unk_linked_list: [usize; 0x3],
        pub loaded: u8,
        pub error: u32,
        pub unk104: [u8; 0x8],
        pub flags: u8,
        pub unk10d: u8,
        pub map_width_tiles: u16,
        pub map_height_tiles: u16,
        pub unk112: [u8; 0xd2],
        pub path_directory: BwString,
        pub path_filename: BwString,
    }

    #[repr(C)]
    pub struct BwString {
        pub pointer: *mut u8,
        pub length: usize,
        pub capacity: usize,
        pub inline_buffer: [u8; 0x10],
    }

    #[repr(C)]
    pub struct FileHandle {
        pub vtable: *const V_FileHandle1,
        pub vtable2: *const V_FileHandle2,
        pub vtable3: *const V_FileHandle3,
        pub metadata: *mut FileMetadata,
        pub peek: *mut FilePeek,
        pub read: *mut FileRead,
        pub file_ok: u32,
        //pub dc18: [u8; 0x10],
        pub close_callback: Function, // 0x1 = pointer, else inline
    }

    #[repr(C)]
    #[derive(Copy, Clone)]
    pub struct OpenParams {
        pub extension: *const u8,
        pub _unk4: u32,
        pub file_type: u32,
        pub locale: u32,
        pub flags: u32,
        pub casc_buffer_size: u32,
        pub safety_padding: [u32; 4],
    }

    #[repr(C)]
    pub struct FileRead {
        pub vtable: *const V_FileRead,
        pub inner: *mut c_void,
    }

    #[repr(C)]
    pub struct FilePeek {
        pub vtable: *const V_FilePeek,
        pub inner: *mut c_void,
    }

    #[repr(C)]
    pub struct FileMetadata {
        pub vtable: *const V_FileMetadata,
        pub inner: *mut c_void,
    }

    /// This seems to be a std::function implementation
    #[repr(C)]
    #[derive(Copy, Clone)]
    pub struct Function {
        pub vtable: *const V_Function,
        pub inner: *mut c_void,
    }

    #[repr(C)]
    pub struct V_FileHandle1 {
        pub destroy: Thiscall<unsafe extern fn(*mut FileHandle, u32)>,
        pub read: Thiscall<unsafe extern fn(*mut FileHandle, *mut u8, u32) -> u32>,
        pub skip: Thiscall<unsafe extern fn(*mut FileHandle, u32)>,
        pub safety_padding: [usize; 0x20],
    }

    #[repr(C)]
    pub struct V_FileHandle2 {
        pub unk0: [usize; 1],
        pub peek: Thiscall<unsafe extern fn(*mut c_void, *mut u8, u32) -> u32>,
        pub safety_padding: [usize; 0x20],
    }

    #[repr(C)]
    pub struct V_FileHandle3 {
        pub unk0: [usize; 1],
        pub tell: Thiscall<unsafe extern fn(*mut c_void) -> u32>,
        pub seek: Thiscall<unsafe extern fn(*mut c_void, u32)>,
        pub file_size: Thiscall<unsafe extern fn(*mut c_void) -> u32>,
        pub safety_padding: [usize; 0x20],
    }

    #[repr(C)]
    pub struct V_FileMetadata {
        pub unk0: [usize; 1],
        pub tell: Thiscall<unsafe extern fn(*mut FileMetadata) -> u32>,
        pub seek: Thiscall<unsafe extern fn(*mut FileMetadata, u32)>,
        pub file_size: Thiscall<unsafe extern fn(*mut FileMetadata) -> u32>,
        pub safety_padding: [usize; 0x20],
    }

    #[repr(C)]
    pub struct V_FileRead {
        pub destroy: usize,
        pub read: Thiscall<unsafe extern fn(*mut FileRead, *mut u8, u32) -> u32>,
        pub skip: Thiscall<unsafe extern fn(*mut FileRead, u32)>,
        pub safety_padding: [usize; 0x20],
    }

    #[repr(C)]
    pub struct V_FilePeek {
        pub destroy: usize,
        pub peek: Thiscall<unsafe extern fn(*mut FilePeek, *mut u8, u32) -> u32>,
        pub safety_padding: [usize; 0x20],
    }

    #[repr(C)]
    pub struct V_Function {
        pub destroy_inner: Thiscall<unsafe extern fn(*mut Function, u32)>,
        pub invoke: Thiscall<unsafe extern fn(*mut Function)>,
        pub get_sizes: Thiscall<unsafe extern fn(*mut Function, *mut u32)>,
        pub copy: Thiscall<unsafe extern fn(*mut Function, *mut Function)>,
        pub copy2: Thiscall<unsafe extern fn(*mut Function, *mut Function)>,
        pub safety_padding: [usize; 0x20],
    }

    #[repr(C)]
    pub struct Font {
        pub unk0: [u8; 0x14],
        pub ttf: *mut TtfSet,
    }

    #[repr(C)]
    pub struct TtfSet {
        pub fonts: [TtfFont; 5],
    }

    #[repr(C)]
    pub struct TtfFont {
        pub unk0: [u8; 0x4],
        pub raw_ttf: *mut u8,
        pub unk8: [u8; 0x78],
        pub scale: f32,
        pub unk94: [u8; 0x1c],
    }

    #[repr(C)]
    pub struct JoinableGameInfo {
        // String -> GameInfoValue
        // Key offset in BwHashTableEntry is 0x8, Value offset 0x28
        pub params: BwHashTable,
        pub unk10: [u8; 0x24],
        pub game_name: BwString,
        pub sockaddr_family: u16,
        // Network endian
        pub port: u16,
        pub ip: [u8; 4],
        pub game_id: u64,
        pub new_game_type: u32,
        pub game_subtype: u32,
        pub unk68: f32,
        pub unk6c: u32,
        pub timestamp: u64,
        pub unk78: u8,
        pub unk79: u8,
        pub unk7a: [u8; 2],
        // SEXP
        pub product_id: u32,
        // 0xe9
        pub game_version: u32,
        // Padding in the case struct grows or there are more fields
        pub safety_padding: [u8; 0x24],
    }

    #[repr(C)]
    pub struct GameInfoValue {
        pub variant: u32,
        pub padding: u32,
        pub data: GameInfoValueUnion,
    }

    #[repr(C)]
    pub union GameInfoValueUnion {
        pub var1: [u8; 0x1c], // Actually a string
        pub var2_3: u64,
        pub var4: f64,
        pub var5: u8,
    }

    #[repr(C)]
    pub struct BwHashTable {
        pub bucket_count: u32,
        pub buckets: *mut *mut BwHashTableEntry,
        pub size: u32,
        pub resize_factor: f32,
    }

    #[repr(C)]
    pub struct BwHashTableEntry {
        pub next: *mut BwHashTableEntry,
        // Key and value are placed in this struct at this point.
        // I would want to assume that BwHashTableEntry<Key, Val>
        // and just declaring key/val as fields would get key and value
        // laid out same as SCR does, but for now just going to hardcode
        // the offsets.
        // It seems somewhat inconsistent whether key/value are
        // 4-aligned or 8-aligned.
        // As BwHashTable is used only once (as of this writing..), I don't
        // want to spend time testing if the layout is correct or not.
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
        pub name: [u8; 0x60],
    }

    #[repr(C)]
    pub struct SnpFunctions {
        pub unk0: usize,
        pub free_packet: unsafe extern "stdcall" fn(*mut sockaddr, *const u8, u32) -> i32,
        pub initialize: unsafe extern "stdcall" fn(
            *const crate::bw::ClientInfo,
            *mut c_void,
            *mut c_void,
            *mut c_void,
        ) -> i32,
        pub unk0c: usize,
        pub receive_packet:
            unsafe extern "stdcall" fn(*mut *mut sockaddr, *mut *const u8, *mut u32) -> i32,
        pub send_packet: unsafe extern "stdcall" fn(*const sockaddr, *const u8, u32) -> i32,
        pub unk18: usize,
        pub broadcast_game: unsafe extern "stdcall"
            fn(*const u8, *const u8, *const u8, i32, u32, i32, i32, i32, *mut c_void, u32) -> i32,
        pub stop_broadcasting_game: unsafe extern "stdcall" fn() -> i32,
        pub unk24: usize,
        pub unk28: usize,
        pub joined_game: Option<unsafe extern "stdcall" fn(*const u8, usize) -> i32>,
        pub unk30: usize,
        pub unk34: usize,
        pub start_listening_for_games: Option<unsafe extern "stdcall" fn() -> i32>,
        pub future_padding: [usize; 0x10],
    }

    #[test]
    fn struct_sizes() {
        use std::mem::size_of;
        assert_eq!(size_of::<JoinableGameInfo>(), 0x84 + 0x24);
        assert_eq!(size_of::<StormPlayer>(), 0x68);
        assert_eq!(size_of::<SnpFunctions>(), 0x3c + 0x10 * size_of::<usize>());
    }
}

// Actually thiscall, but that isn't available in stable Rust (._.)
// Luckily we don't care about ecx
// Argument is a pointer to some BnetCreatePopup class
unsafe extern "stdcall" fn lobby_create_callback(_popup: *mut c_void) -> u32 {
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
    fn from_usize(val: usize) -> Self { val as *mut T }
    fn to_usize(val: Self) -> usize { val as usize }
}

impl BwValue for u8 {
    fn from_usize(val: usize) -> Self { val as u8 }
    fn to_usize(val: Self) -> usize { val as usize }
}

impl BwValue for u32 {
    fn from_usize(val: usize) -> Self { val as u32 }
    fn to_usize(val: Self) -> usize { val as usize }
}

impl<T: BwValue> Value<T> {
    unsafe fn resolve(&self) -> T {
        T::from_usize(resolve_operand(self.op))
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
        use samase_scarf::scarf::{MemAccessSize, OperandType};
        let value = T::to_usize(value);
        match self.op.ty() {
            OperandType::Memory(ref mem) => {
                let addr = resolve_operand(mem.address);
                match mem.size {
                    MemAccessSize::Mem8 => *(addr as *mut u8) = value as u8,
                    MemAccessSize::Mem16 => *(addr as *mut u16) = value as u16,
                    MemAccessSize::Mem32 => *(addr as *mut u32) = value as u32,
                    MemAccessSize::Mem64 => *(addr as *mut u64) = value as u64,
                };
            }
            _ => panic!("Cannot write to {}", self.op),
        };
    }
}

unsafe impl<T> Send for Value<T> {}
unsafe impl<T> Sync for Value<T> {}

unsafe fn resolve_operand(op: scarf::Operand<'_>) -> usize {
    use samase_scarf::scarf::{ArithOpType, MemAccessSize, OperandType};
    match *op.ty() {
        OperandType::Constant(c) => c as usize,
        OperandType::Memory(ref mem) => {
            let addr = resolve_operand(mem.address);
            match mem.size {
                MemAccessSize::Mem8 => (addr as *const u8).read_unaligned() as usize,
                MemAccessSize::Mem16 => (addr as *const u16).read_unaligned() as usize,
                MemAccessSize::Mem32 => (addr as *const u32).read_unaligned() as usize,
                MemAccessSize::Mem64 => (addr as *const u64).read_unaligned() as usize,
            }
        }
        OperandType::Arithmetic(ref arith) => {
            let left = resolve_operand(arith.left);
            let right = resolve_operand(arith.right);
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
                _ => panic!("Unimplemented resolve: {}", op),
            }
        }
        _ => panic!("Unimplemented resolve: {}", op),
    }
}

impl BwScr {
    /// On failure returns a description of address that couldn't be found
    pub fn new() -> Result<BwScr, &'static str> {
        let binary = unsafe {
            let base = GetModuleHandleW(null()) as *const u8;
            let text = pe_image::get_section(base, b".text\0\0\0").unwrap();
            let rdata = pe_image::get_section(base, b".rdata\0\0").unwrap();
            let data = pe_image::get_section(base, b".data\0\0\0").unwrap();
            let reloc = pe_image::get_section(base, b".reloc\0\0").unwrap();
            let sections = vec![pe_image::get_pe_header(base), text, rdata, data, reloc];
            let base = scarf::VirtualAddress(base as u32);
            let mut binary = scarf::raw_bin(base, sections);
            let relocs = scarf::analysis::find_relocs::<scarf::ExecutionStateX86<'_>>(&binary)
                .unwrap();
            binary.set_relocs(relocs);
            binary
        };
        let ctx = scarf::OperandContext::new();
        let mut analysis: samase_scarf::Analysis<scarf::ExecutionStateX86<'_>> =
            samase_scarf::Analysis::new(&binary, &ctx);

        let game = analysis.game().ok_or("Game")?;
        let players = analysis.players().ok_or("Players")?;
        let net_players = analysis.net_players();
        let storm_players = net_players.net_players.clone().ok_or("Storm players")?;
        let init_network_player_info = net_players.init_net_player
            .ok_or("init_network_player_info")?;
        let step = analysis.step_network();
        let storm_player_flags = step.net_player_flags.clone().ok_or("Storm player flags")?;
        let step_network = step.step_network.ok_or("step_network")?;
        let lobby_state = analysis.lobby_state().ok_or("Lobby state")?;
        let select_map_entry = analysis.select_map_entry();
        let is_multiplayer = select_map_entry.is_multiplayer.clone().ok_or("is_multiplayer")?;
        let select_map_entry = select_map_entry.select_map_entry.ok_or("select_map_entry")?;
        let game_init = analysis.game_init();
        let game_state = game_init.scmain_state.clone().ok_or("Game state")?;
        let mainmenu_entry_hook = game_init.mainmenu_entry_hook.ok_or("Entry hook")?;
        let game_loop = game_init.game_loop.ok_or("Game loop")?;
        let init_map_from_path = analysis.init_map_from_path().ok_or("init_map_from_path")?;
        let join_game = analysis.join_game().ok_or("join_game")?;
        let init_sprites = analysis.load_images().ok_or("Init sprites")?;
        let sprites_inited = analysis.images_loaded().ok_or("Sprites inited")?;
        let init_game_network = analysis.init_game_network().ok_or("Init game network")?;
        let process_lobby_commands = analysis.process_lobby_commands()
            .ok_or("Process lobby commands")?;
        let send_command = analysis.send_command().ok_or("send_command")?;
        let local_player_id = analysis.local_player_id().ok_or("Local player id")?;
        let start = analysis.single_player_start();
        let local_storm_id = start.local_storm_player_id.clone().ok_or("Local storm id")?;
        let local_unique_player_id = start.local_unique_player_id.clone()
            .ok_or("Local unique player id")?;
        let net_player_to_game = start.net_player_to_game.clone().ok_or("Net player to game")?;
        let net_player_to_unique = start.net_player_to_unique.clone()
            .ok_or("Net player to unique")?;
        let choose_snp = analysis.choose_snp().ok_or("choose_snp")?;
        let local_player_name = analysis.local_player_name().ok_or("Local player name")?;
        let fonts = analysis.fonts().ok_or("Fonts")?;
        let init = analysis.init_storm_networking();
        let init_storm_networking = init.init_storm_networking.ok_or("init_storm_networking")?;
        let load_snp_list = init.load_snp_list.ok_or("load_snp_list")?;
        let font_cache_render_ascii = analysis.font_cache_render_ascii()
            .ok_or("font_cache_render_ascii")?;
        let ttf_malloc = analysis.ttf_malloc().ok_or("ttf_malloc")?;
        let ttf_render_sdf = analysis.ttf_render_sdf().ok_or("ttf_render_sdf")?;
        let lobby_create_callback_offset =
            analysis.create_game_dialog_vtbl_on_multiplayer_create()
                .ok_or("Lobby create callback vtable offset")?;
        let process_game_commands = analysis.process_commands().process_commands
            .ok_or("process_game_commands")?;
        let game_command_lengths = (*analysis.command_lengths()).clone();
        let snet_recv_packets = analysis.snet_recv_packets().ok_or("snet_recv_packets")?;
        let snet_send_packets = analysis.snet_send_packets().ok_or("snet_send_packets")?;
        let scheduler_vtable = Some(analysis.vtables_for_class(b".?AVSchedulerService@services"))
            // There is only 1 matching vtable for now, hopefully it won't change
            .filter(|x| x.len() == 1)
            .map(|x| x[0])
            .ok_or("Scheduler vtable")?;
        let step_io = unsafe { *(scheduler_vtable.0 as *mut usize).add(3) };

        let starcraft_tls_index = get_tls_index(&binary).ok_or("TLS index")?;

        let disable_hd = match std::env::var_os("SB_NO_HD") {
            Some(s) => s == "1",
            None => false,
        };
        let open_file = if disable_hd {
            let open_file = analysis.file_hook().get(0).cloned()
                .ok_or("open_file (Required due to SB_NO_HD)")?;
            Some(open_file)
        } else {
            None
        };

        debug!("Found all necessary BW data");

        let ctx = Box::leak(Box::new(scarf::OperandContext::new()));
        let sdf_cache = Arc::new(InitSdfCache::new());
        Ok(BwScr {
            game: Value::new(ctx, game),
            players: Value::new(ctx, players),
            storm_players: Value::new(ctx, storm_players.0),
            storm_player_flags: Value::new(ctx, storm_player_flags),
            lobby_state: Value::new(ctx, lobby_state),
            is_multiplayer: Value::new(ctx, is_multiplayer),
            game_state: Value::new(ctx, game_state),
            sprites_inited: Value::new(ctx, sprites_inited),
            local_player_id: Value::new(ctx, local_player_id),
            local_unique_player_id: Value::new(ctx, local_unique_player_id),
            local_storm_id: Value::new(ctx, local_storm_id),
            net_player_to_game: Value::new(ctx, net_player_to_game),
            net_player_to_unique: Value::new(ctx, net_player_to_unique),
            local_player_name: Value::new(ctx, local_player_name),
            fonts: Value::new(ctx, fonts),
            init_network_player_info: unsafe { mem::transmute(init_network_player_info.0) },
            step_network: unsafe { mem::transmute(step_network.0) },
            select_map_entry: unsafe { mem::transmute(select_map_entry.0) },
            game_loop: unsafe { mem::transmute(game_loop.0) },
            init_map_from_path: unsafe { mem::transmute(init_map_from_path.0) },
            join_game: unsafe { mem::transmute(join_game.0) },
            init_sprites: unsafe { mem::transmute(init_sprites.0) },
            init_game_network: unsafe { mem::transmute(init_game_network.0) },
            process_lobby_commands: unsafe { mem::transmute(process_lobby_commands.0) },
            send_command: unsafe { mem::transmute(send_command.0) },
            choose_snp: unsafe { mem::transmute(choose_snp.0) },
            init_storm_networking: unsafe { mem::transmute(init_storm_networking.0) },
            snet_recv_packets: unsafe { mem::transmute(snet_recv_packets.0) },
            snet_send_packets: unsafe { mem::transmute(snet_send_packets.0) },
            ttf_malloc: unsafe { mem::transmute(ttf_malloc.0) },
            load_snp_list,
            mainmenu_entry_hook,
            open_file,
            lobby_create_callback_offset,
            font_cache_render_ascii,
            ttf_render_sdf,
            process_game_commands,
            step_io: scarf::VirtualAddress(step_io as _),
            game_command_lengths,
            starcraft_tls_index: SendPtr(starcraft_tls_index),
            sdf_cache,
            is_replay_seeking: AtomicBool::new(false),
            lobby_game_init_command_seen: AtomicBool::new(false),
        })
    }

    pub unsafe fn patch_game(self: Arc<Self>, image: *mut u8) {
        use self::hooks::*;
        debug!("Patching SCR");
        let base = GetModuleHandleW(null()) as *mut _;
        let mut active_patcher = crate::PATCHER.lock();
        let mut exe = active_patcher.patch_memory(image as *mut _, base, 0);
        let base = base as usize;
        let address = self.mainmenu_entry_hook.0 as usize - base;
        exe.hook_closure_address(GameInit, move |_| {
            debug!("SCR game init hook");
            crate::process_init_hook();
        }, address);
        // This function being run while Windows loader lock is held, crate::initialize
        // cannot be called so hook the exe's entry point and call it from there.
        let address = pe_entry_point_offset(base as *const u8);
        let sdf_cache = self.sdf_cache.clone();
        exe.hook_closure_address(EntryPoint, move |orig| {
            // crate::initialize initializes the async runtime, letting us to start
            // loading SDF cache.
            crate::initialize();
            let async_handle = crate::async_handle();
            let mut sdf_cache = sdf_cache.clone().lock_owned();
            async_handle.spawn(async move {
                let exe_hash = pe_image::hash_pe_header(base as *const u8);
                *sdf_cache = Some(SdfCache::init(exe_hash).await);
            });

            // This function is practically SCR's main(), so it won't return and any code
            // below will not be ran.
            orig();
        }, address);

        let address = self.load_snp_list.0 as usize - base;
        exe.hook_closure_address(LoadSnpList, load_snp_list_hook, address);

        let address = self.process_game_commands.0 as usize - base;
        let this = self.clone();
        exe.hook_closure_address(
            ProcessGameCommands,
            move |data, len, are_recorded_replay_commands, orig| {
                let slice = std::slice::from_raw_parts(data, len);
                if are_recorded_replay_commands == 0 {
                    for command in commands::iter_commands(slice, &this.game_command_lengths) {
                        match command {
                            [commands::id::REPLAY_SEEK, rest @ ..] if rest.len() == 4 => {
                                let frame = LittleEndian::read_u32(rest);
                                let game = this.game();
                                if (*game).frame_count > frame {
                                    this.is_replay_seeking.store(true, Ordering::Relaxed);
                                }
                            }
                            _ => (),
                        }
                    }
                }
                orig(data, len, are_recorded_replay_commands);
            },
            address,
        );
        let address = self.step_io.0 as usize - base;
        let this = self.clone();
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
                    (this.snet_recv_packets)();
                    (this.snet_send_packets)();
                }
            },
            address,
        );
        let address = self.process_lobby_commands as usize - base;
        let this = self.clone();
        exe.hook_closure_address(
            ProcessLobbyCommands,
            move |data, len, player, orig| {
                let slice = std::slice::from_raw_parts(data, len);
                if let Some(&byte) = slice.get(0) {
                    if byte == 0x48 && player == 0 {
                        this.lobby_game_init_command_seen.store(true, Ordering::Relaxed);
                    }
                }
                orig(data, len, player);
            },
            address
        );

        if let Some(open_file) = self.open_file {
            let address = open_file.0 as usize - base;
            exe.hook_closure_address(OpenFile, file_hook::open_file_hook, address);
        }

        sdf_cache::apply_sdf_cache_hooks(&self, &mut exe, base);

        drop(exe);

        {
            let kernel32 = crate::windows::load_library("kernel32").unwrap();
            let mut patcher = active_patcher.patch_library("kernel32", 0);
            let kernel32_base = kernel32.handle() as usize;
            let address = kernel32.proc_address("CreateEventW").unwrap() as usize;
            patcher.hook_closure_address(
                CreateEventW,
                create_event_hook,
                address - kernel32_base,
            );
        }
        crate::forge::init_hooks_scr(&mut active_patcher);
        debug!("Patched.");
    }

    unsafe fn update_nation_and_human_ids(&self) {
        let net_player_to_game = self.net_player_to_game.resolve();
        let net_player_to_unique = self.net_player_to_unique.resolve();
        let local_storm_id = self.local_storm_id.resolve();
        let players = self.players.resolve();
        for i in 0..NET_PLAYER_COUNT {
            *net_player_to_unique.add(i) = 8;
            *net_player_to_game.add(i) = 8;
        }
        // BW also handles SCR observers 12..16
        for game_id in 0..8 {
            let player = players.add(game_id);
            let storm_id = (*player).storm_id;
            // BW would also accept type 9 (observer?)
            if (*player).player_type == bw::PLAYER_TYPE_HUMAN {
                *net_player_to_game.add(storm_id as usize) = game_id as u32;
                *net_player_to_unique.add(storm_id as usize) = game_id as u32;
                if storm_id == local_storm_id {
                    self.local_player_id.write(local_storm_id);
                    self.local_unique_player_id.write(local_storm_id);
                }
            }
        }
    }

    unsafe fn storm_last_error_ptr(&self) -> *mut u32 {
        // This just is starcraft.exe errno
        // dword [[fs:[2c] + tls_index * 4] + 8]
        let tls_index = *self.starcraft_tls_index.0;
        let get_tls_table: extern fn() -> *mut *mut u32 = mem::transmute(GET_TLS_TABLE.as_ptr());
        let table = get_tls_table();
        let tls_data = *table.add(tls_index as usize);
        tls_data.add(2)
    }

    unsafe fn storm_last_error(&self) -> u32 {
        *self.storm_last_error_ptr()
    }
}

impl bw::Bw for BwScr {
    unsafe fn run_game_loop(&self) {
        loop {
            self.game_state.write(3); // Playing
            (self.game_loop)();
            // Replay seeking exits game loop and sets a bool for it to restart,
            // we don't have access to that bool but we hook the replay seek
            // command and set our own
            if self.is_replay_seeking.load(Ordering::Relaxed) == false {
                break;
            }
            self.is_replay_seeking.store(false, Ordering::Relaxed);
        }
    }

    unsafe fn clean_up_for_exit(&self) {
        // TODO
    }

    unsafe fn init_sprites(&self) {
        (self.init_sprites)();
        self.sprites_inited.write(1);
    }

    unsafe fn maybe_receive_turns(&self) {
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
        (self.step_network)();
    }

    unsafe fn init_game_network(&self) {
        (self.init_game_network)()
    }

    unsafe fn init_network_player_info(&self, storm_player_id: u32) {
        (self.init_network_player_info)(storm_player_id, 0, 1, 5);
    }

    unsafe fn do_lobby_game_init(&self, seed: u32) {
        self.update_nation_and_human_ids();
        self.lobby_state.write(8);
        let local_storm_id = self.local_storm_id.resolve();
        if local_storm_id == 0 {
            let data = bw::LobbyGameInitData {
                game_init_command: 0x48,
                random_seed: seed,
                // TODO(tec27): deal with player bytes if we ever allow save games
                player_bytes: [8; 8],
            };
            let ptr = &data as *const bw::LobbyGameInitData as *const u8;
            let len = mem::size_of::<bw::LobbyGameInitData>();
            (self.send_command)(ptr, len);
        }
    }

    unsafe fn try_finish_lobby_game_init(&self) -> bool {
        if self.lobby_game_init_command_seen.load(Ordering::Relaxed) {
            self.lobby_state.write(9);
            true
        } else {
            false
        }
    }

    unsafe fn create_lobby(
        &self,
        map_path: &Path,
        lobby_name: &str,
        game_type: bw::GameType,
    ) -> Result<(), bw::LobbyCreateError> {
        let mut game_input: scr::GameInput = mem::zeroed();
        init_bw_string(&mut game_input.name, lobby_name.as_bytes());
        init_bw_string(&mut game_input.password, b"");
        game_input.speed = 6;
        game_input.game_type_subtype = game_type.as_u32();

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
        let is_replay = map_path.extension()
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
        let result = (self.select_map_entry)(&mut game_input, &mut object, &mut entry);
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
        (self.init_game_network)();
        Ok(())
    }

    unsafe fn join_lobby(
        &self,
        input_game_info: &mut bw::JoinableGameInfo,
        map_path: &[u8],
        address: std::net::Ipv4Addr,
    ) -> Result<(), u32> {
        assert!(*map_path.last().unwrap() == 0, "Map path was not null-terminated");
        let mut params =
            bw_hash_table::HashTable::<scr::BwString, scr::GameInfoValue>::new(0x20, 0x8, 0x28);
        let mut add_param = |key: &[u8], value: u32| {
            let mut string: scr::BwString = mem::zeroed();
            init_bw_string(&mut string, key);
            let mut value = scr::GameInfoValue {
                variant: 2,
                padding: 0,
                data: scr::GameInfoValueUnion {
                    var2_3: value as u64,
                }
            };
            params.insert(&mut string, &mut value);
        };
        add_param(b"save_game_id", input_game_info.save_checksum as u32);
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
        // Not sure if we want to change this one day. I think 0 means dynamic,
        // which is assumed by the host as well AFAIK.
        add_param(b"net_turn_rate", 0);
        // TODO: This is actually important for EUD maps. Host gets it set correctly
        // automatically, but I think we need more code here to support EUD maps.
        add_param(b"flags", 0);

        let mut add_param_string = |key: &[u8], value_str: &[u8]| {
            let mut string: scr::BwString = mem::zeroed();
            init_bw_string(&mut string, key);
            let mut value = scr::GameInfoValue {
                variant: 1,
                padding: 0,
                data: scr::GameInfoValueUnion {
                    var1: mem::zeroed(),
                }
            };
            init_bw_string(&mut *(value.data.var1.as_mut_ptr() as *mut scr::BwString), value_str);
            params.insert(&mut string, &mut value);
        };
        let host_name_length = input_game_info.game_creator
            .iter().position(|&x| x == 0)
            .unwrap_or(input_game_info.game_creator.len());
        add_param_string(b"host_name", &input_game_info.game_creator[..host_name_length]);
        let map_name_length = input_game_info.map_name
            .iter().position(|&x| x == 0)
            .unwrap_or(input_game_info.map_name.len());
        add_param_string(b"map_name", &input_game_info.map_name[..map_name_length]);

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
        let error = (self.join_game)(&mut game_info, &mut password, 0);
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

        let mut out = [0u32; 8];
        let ok = (self.init_map_from_path)(
            map_path.as_ptr(),
            out.as_mut_ptr() as *mut c_void,
            0,
            0,
        );
        if ok == 0 {
            return Err(self.storm_last_error());
        }
        // TODO Team game thing
        Ok(())
    }

    unsafe fn remaining_game_init(&self, name_in: &str) {
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

    unsafe fn game(&self) -> *mut bw::Game {
        self.game.resolve()
    }

    unsafe fn players(&self) -> *mut bw::Player {
        self.players.resolve()
    }

    unsafe fn set_player_name(&self, id: u8, name: &str) {
        let mut buffer = [0; 0x60];
        for (i, &byte) in name.as_bytes().iter().take(0x5f).enumerate() {
            buffer[i] = byte;
        }
        // SCR has longer player names after the bw::Player array,
        // which are ones that it (mostly?) uses.
        let players = self.players();
        (&mut (*players.add(id as usize)).name).copy_from_slice(&buffer[..25]);
        let player_names = players.add(0x10) as *mut u8;
        let long_name = player_names.add(id as usize * 0x60);
        let long_name = std::slice::from_raw_parts_mut(long_name, 0x60);
        long_name.copy_from_slice(&buffer[..0x60]);
    }

    unsafe fn storm_players(&self) -> Vec<bw::StormPlayer> {
        let ptr = self.storm_players.resolve();
        let scr_players = std::slice::from_raw_parts(ptr, NET_PLAYER_COUNT);
        scr_players.iter().map(|player| {
            bw::StormPlayer {
                state: player.state,
                unk1: player.unk1,
                flags: player.flags,
                unk4: player.unk4,
                protocol_version: player.protocol_version,
                name: {
                    let mut name = [0; 0x19];
                    (&mut name[..0x18]).copy_from_slice(&player.name[..0x18]);
                    name
                },
                padding: 0,
            }
        }).collect()
    }

    unsafe fn storm_player_flags(&self) -> Vec<u32> {
        let ptr = self.storm_player_flags.resolve() as *const u32;
        std::slice::from_raw_parts(ptr, NET_PLAYER_COUNT).into()
    }

    unsafe fn storm_set_last_error(&self, error: u32) {
        *self.storm_last_error_ptr() = error;
    }
}

fn create_event_hook(
    security: *mut c_void,
    init_state: u32,
    manual_reset: u32,
    name: *const u16,
    orig: unsafe extern fn(*mut c_void, u32, u32, *const u16) -> *mut c_void,
) -> *mut c_void {
    unsafe {
        use winapi::um::errhandlingapi::SetLastError;
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

fn load_snp_list_hook(
    callbacks: *mut scr::SnpLoadFuncs,
    count: u32,
    orig: unsafe extern fn(*mut scr::SnpLoadFuncs, u32) -> u32,
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

static SNP_FUNCTIONS: scr::SnpFunctions = scr::SnpFunctions {
    unk0: 0,
    free_packet: snp::free_packet,
    initialize: snp_initialize,
    unk0c: 0,
    receive_packet: snp::receive_packet,
    send_packet: snp::send_packet_scr,
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

unsafe extern "stdcall" fn snp_load_identify(
    snp_index: u32,
    id: *mut u32,
    name: *mut *const u8,
    description: *mut *const u8,
    caps: *mut *const crate::bw::SnpCapabilities,
) -> u32 {
    if snp_index > 0 {
        return 0;
    }

    *id = snp::PROVIDER_ID;
    *name = b"Shieldbattery\0".as_ptr();
    *description = b"=)\0".as_ptr();
    *caps = &snp::CAPABILITIES;
    1
}

unsafe extern "stdcall" fn snp_initialize(
    client_info: *const bw::ClientInfo,
    user_data: *mut c_void,
    battle_info: *mut c_void,
    module_data: *mut c_void,
) -> i32 {
    snp::initialize(&*client_info, None);
    // We'll also have to call the SCR's normal LAN SNP init function, which initializes
    // a global that SCR will try to access on game joining. Luckily it won't initialize
    // anything else we don't want.
    let scr_init: unsafe extern "stdcall" fn(
        *const bw::ClientInfo,
        *mut c_void,
        *mut c_void,
        *mut c_void,
    ) -> i32 = mem::transmute(SCR_SNP_INITIALIZE.load(Ordering::Relaxed));
    let result = scr_init(client_info, user_data, battle_info, module_data);
    SNP_INITIALIZED.store(result != 0, Ordering::Relaxed);
    result
}

static SCR_SNP_INITIALIZE: AtomicUsize = AtomicUsize::new(0);
static SNP_INITIALIZED: AtomicBool = AtomicBool::new(false);

unsafe extern "stdcall" fn snp_load_bind(
    snp_index: u32,
    funcs: *mut *const scr::SnpFunctions,
) -> u32 {
    if snp_index > 0 {
        return 0;
    }
    *funcs = &SNP_FUNCTIONS;
    1
}

#[allow(bad_style)]
mod hooks {
    use libc::c_void;

    use super::scr;

    whack_hooks!(0, // cdecl
        !0 => GameInit();
        !0 => EntryPoint();
        !0 => OpenFile(*mut scr::FileHandle, *const u8, *const scr::OpenParams) ->
            *mut scr::FileHandle;
        !0 => FontCacheRenderAscii(@ecx *mut c_void);
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
    );

    whack_hooks!(stdcall, 0,
        !0 => LoadSnpList(*mut scr::SnpLoadFuncs, u32) -> u32;
        !0 => CreateEventW(*mut c_void, u32, u32, *const u16) -> *mut c_void;
        !0 => StepIo(@ecx *mut c_void);
    );
}

// Inline asm is only on nightly rust, so..
// mov eax, fs:[0x2c]; ret
#[link_section = ".text"]
static GET_TLS_TABLE: [u8; 7] = [0x64, 0xa1, 0x2c, 0x00, 0x00, 0x00, 0xc3];

fn get_tls_index(binary: &scarf::BinaryFile<scarf::VirtualAddress>) -> Option<*mut u32> {
    let base = binary.base;
    let pe_start = binary.read_u32(base + 0x3c).ok()?;
    let tls_offset = binary.read_u32(base + pe_start + 0xc0).ok().filter(|&offset| offset != 0)?;
    let tls_address = base + tls_offset;
    let tls_ptr = binary.read_u32(tls_address + 0x8).ok()?;
    Some(tls_ptr as *mut u32)
}

/// Value is assumed to not have null terminator.
/// Leaks memory and BW should not be let to deallocate the buffer
/// if value doens't fit inline.
unsafe fn init_bw_string(out: &mut scr::BwString, value: &[u8]) {
    if value.len() < 16 {
        (&mut out.inline_buffer[..value.len()]).copy_from_slice(value);
        out.inline_buffer[value.len()] = 0;
        out.pointer = out.inline_buffer.as_mut_ptr();
        out.length = value.len();
        out.capacity = 15 | (isize::min_value() as usize);
    } else {
        let mut vec = Vec::with_capacity(value.len() + 1);
        vec.extend(value.iter().cloned());
        vec.push(0);
        out.pointer = vec.as_mut_ptr();
        mem::forget(vec);
        out.length = value.len();
        out.capacity = value.len();
    }
}

/// Returns the entry point of a binary, read from the PE header.
///
/// Adding the returned offset to `binary` would produce function pointer
/// to the entry.
unsafe fn pe_entry_point_offset(binary: *const u8) -> usize {
    let pe_header = binary.add(*(binary.add(0x3c) as *const u32) as usize);
    *(pe_header.add(0x28) as *const u32) as usize
}
