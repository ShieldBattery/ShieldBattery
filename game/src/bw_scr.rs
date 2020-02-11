mod pe_image;

use std::marker::PhantomData;
use std::mem;
use std::path::Path;
use std::ptr::{null};
use std::rc::Rc;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Arc;

use libc::c_void;
use samase_scarf::scarf::{self};
use winapi::um::libloaderapi::{GetModuleHandleW};
use winapi::shared::minwindef::{ATOM};
use winapi::um::winuser::{WNDCLASSEXW};

use crate::bw;
use crate::snp;
use crate::windows;

const NET_PLAYER_COUNT: usize = 12;

pub struct BwScr {
    game: Value<*mut bw::Game>,
    players: Value<*mut bw::Player>,
    storm_players: Value<*mut bw::StormPlayer>,
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
    snp_definitions: Value<*mut u8>,
    snp_definitions_size: u32,
    local_player_name: Value<*mut u8>,

    init_network_player_info: unsafe extern "C" fn(u32, u32, u32, u32),
    maybe_receive_turns: unsafe extern "C" fn(),
    select_map_entry: unsafe extern "C" fn(
        *mut scr::GameInput,
        *mut *const scr::LobbyDialogVtable,
        *mut scr::MapDirEntry,
    ),
    game_loop: unsafe extern "C" fn(),
    init_sprites: unsafe extern "C" fn(),
    init_game_network: unsafe extern "C" fn(),
    process_lobby_commands: unsafe extern "C" fn(*const u8, usize, u32),
    choose_snp: unsafe extern "C" fn(u32) -> u32,
    init_storm_networking: unsafe extern "C" fn(),
    mainmenu_entry_hook: scarf::VirtualAddress,
    starcraft_tls_index: SendPtr<*mut u32>,
}

struct SendPtr<T>(T);
unsafe impl<T> Send for SendPtr<T> {}
unsafe impl<T> Sync for SendPtr<T> {}

mod scr {
    use libc::c_void;

    #[repr(C)]
    pub struct LobbyDialogVtable {
        pub unknown: [usize; 0x2a],
        // Actually thiscall, but that isn't available in stable Rust (._.)
        // And the callback is a dummy function anyway
        // Argument is a pointer to some BnetCreatePopup class
        pub create_callback: unsafe extern "stdcall" fn(*mut c_void) -> u32,
        pub safety_padding: [usize; 0x10],
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
        pub unk4: [u8; 0xc],
        pub unk10: BwString,
        pub filename: BwString,
        pub title: BwString,
        pub description: BwString,
        pub error_message: BwString,
        pub unk9c: BwString,
        pub unkb8: BwString,
        pub unkd4: BwString,
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
        pub unk21c: [u8; 4],
    }

    #[repr(C)]
    pub struct BwString {
        pub pointer: *mut u8,
        pub length: usize,
        pub capacity: usize,
        pub inline_buffer: [u8; 0x10],
    }
}

static LOBBY_DIALOG_VTABLE: scr::LobbyDialogVtable = scr::LobbyDialogVtable {
    unknown: [0; 0x2a],
    create_callback: lobby_create_callback,
    safety_padding: [0; 0x10],
};

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
/// This wrapper exists to unnsafely implement Send and Sync for
/// scarf::Operand.
///
/// In general this should not be done as the Operand is a recursive structure
/// containing more Rc<Operand>s, and simultaneously calling rc.clone() from
/// multiple threads is a data race. Rust also isn't flexible enough to have
/// operands use single-threaded Rc during analysis and returned values use
/// thread-safe Arc :l
///
/// This structure should only be used to resolve the Operand to a value in
/// BW's memory, and the resolve function should be careful to not clone
/// anything (it won't need to).
///
/// Note: It is fine to over/underestimate size of an integer type, e.g.
/// using Value<u32> instead of Value<u8> won't corrupt unrelated values.
/// Though using a smaller size than what the value internally is will
/// truncate any read data to that size.
/// (So maybe using Value<u32> always would be fine?)
struct Value<T> {
    op: Rc<scarf::Operand>,
    phantom: PhantomData<T>,
}

impl<T> Value<T> {
    fn new(op: Rc<scarf::Operand>) -> Value<T> {
        Value {
            op,
            phantom: Default::default(),
        }
    }
}

/// Dropping should also not be done as it decrements the unsynchronized
/// refcount. It really shouldn't be happening anyway since BwScr is
/// stored in a global which isn't overwritten ever.
impl<T> Drop for Value<T> {
    fn drop(&mut self) {
        panic!("Why is this being dropped");
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
        T::from_usize(resolve_operand(&self.op))
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
        match self.op.ty {
            OperandType::Memory(ref mem) => {
                let addr = resolve_operand(&mem.address);
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

unsafe fn resolve_operand(op: &Rc<scarf::Operand>) -> usize {
    use samase_scarf::scarf::{ArithOpType, MemAccessSize, OperandType};
    match op.ty {
        OperandType::Constant(c) => c as usize,
        OperandType::Memory(ref mem) => {
            let addr = resolve_operand(&mem.address);
            match mem.size {
                MemAccessSize::Mem8 => (addr as *const u8).read_unaligned() as usize,
                MemAccessSize::Mem16 => (addr as *const u16).read_unaligned() as usize,
                MemAccessSize::Mem32 => (addr as *const u32).read_unaligned() as usize,
                MemAccessSize::Mem64 => (addr as *const u64).read_unaligned() as usize,
            }
        }
        OperandType::Arithmetic(ref arith) => {
            let left = resolve_operand(&arith.left);
            let right = resolve_operand(&arith.right);
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

unsafe impl<T> Send for Value<T> {}
unsafe impl<T> Sync for Value<T> {}

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
        let maybe_receive_turns = step.step_network.ok_or("maybe_receive_turns")?;
        let lobby_state = analysis.lobby_state().ok_or("Lobby state")?;
        let select_map_entry = analysis.select_map_entry();
        let is_multiplayer = select_map_entry.is_multiplayer.clone().ok_or("is_multiplayer")?;
        let select_map_entry = select_map_entry.select_map_entry.ok_or("select_map_entry")?;
        let game_init = analysis.game_init();
        let game_state = game_init.scmain_state.clone().ok_or("Game state")?;
        let mainmenu_entry_hook = game_init.mainmenu_entry_hook.ok_or("Entry hook")?;
        let game_loop = game_init.game_loop.ok_or("Game loop")?;
        let init_sprites = analysis.load_images().ok_or("Init sprites")?;
        let sprites_inited = analysis.images_loaded().ok_or("Sprites inited")?;
        let init_game_network = analysis.init_game_network().ok_or("Init game network")?;
        let process_lobby_commands = analysis.process_lobby_commands()
            .ok_or("Process lobby commands")?;
        let local_player_id = analysis.local_player_id().ok_or("Local player id")?;
        let start = analysis.single_player_start();
        let local_storm_id = start.local_storm_player_id.clone().ok_or("Local storm id")?;
        let local_unique_player_id = start.local_unique_player_id.clone()
            .ok_or("Local unique player id")?;
        let net_player_to_game = start.net_player_to_game.clone().ok_or("Net player to game")?;
        let net_player_to_unique = start.net_player_to_unique.clone()
            .ok_or("Net player to unique")?;
        let choose_snp = analysis.choose_snp().ok_or("choose_snp")?;
        let snp_definitions = analysis.snp_definitions().ok_or("SNP definitions")?;
        let snp_definitions_size = snp_definitions.entry_size;
        let snp_definitions = snp_definitions.snp_definitions;
        let local_player_name = analysis.local_player_name().ok_or("Local player name")?;
        let init_storm_networking = analysis.init_storm_networking()
            .ok_or("init_storm_networking")?;

        let starcraft_tls_index = get_tls_index(&binary).ok_or("TLS index")?;

        debug!("Found all necessary BW data");
        Ok(BwScr {
            game: Value::new(game),
            players: Value::new(players),
            storm_players: Value::new(storm_players.0),
            storm_player_flags: Value::new(storm_player_flags),
            lobby_state: Value::new(lobby_state),
            is_multiplayer: Value::new(is_multiplayer),
            game_state: Value::new(game_state),
            sprites_inited: Value::new(sprites_inited),
            local_player_id: Value::new(local_player_id),
            local_unique_player_id: Value::new(local_unique_player_id),
            local_storm_id: Value::new(local_storm_id),
            net_player_to_game: Value::new(net_player_to_game),
            net_player_to_unique: Value::new(net_player_to_unique),
            snp_definitions: Value::new(snp_definitions),
            snp_definitions_size,
            local_player_name: Value::new(local_player_name),
            init_network_player_info: unsafe { mem::transmute(init_network_player_info.0) },
            maybe_receive_turns: unsafe { mem::transmute(maybe_receive_turns.0) },
            select_map_entry: unsafe { mem::transmute(select_map_entry.0) },
            game_loop: unsafe { mem::transmute(game_loop.0) },
            init_sprites: unsafe { mem::transmute(init_sprites.0) },
            init_game_network: unsafe { mem::transmute(init_game_network.0) },
            process_lobby_commands: unsafe { mem::transmute(process_lobby_commands.0) },
            choose_snp: unsafe { mem::transmute(choose_snp.0) },
            init_storm_networking: unsafe { mem::transmute(init_storm_networking.0) },
            mainmenu_entry_hook,
            starcraft_tls_index: SendPtr(starcraft_tls_index),
        })
    }

    pub unsafe fn patch_game(self: Arc<Self>, image: *mut u8) {
        debug!("Patching SCR");
        let base = GetModuleHandleW(null()) as *mut _;
        let mut active_patcher = crate::PATCHER.lock().unwrap();
        let mut exe = active_patcher.patch_memory(image as *mut _, base, 0);
        let base = base as usize;
        let address = self.mainmenu_entry_hook.0 as usize - base;
        exe.hook_closure_address(GameInit, move |_| {
            debug!("SCR game init hook");
            // BW initializes its internal SNP list with a static constructor,
            // but patch_game() is called even before that, so overwrite the
            // list at GameInit hook.
            self.init_snp();
            crate::initialize();
            crate::process_init_hook();
        }, address);

        drop(exe);

        let user32 = windows::load_library("user32").unwrap();
        let mut patcher = active_patcher.patch_library("user32", 0);
        let address = user32.proc_address("CreateWindowExW").unwrap();
        patcher.hook_closure_address(
            CreateWindowExW,
            create_window_hook,
            address as usize - user32.handle() as usize,
        );
        let address = user32.proc_address("RegisterClassExW").unwrap();
        patcher.hook_closure_address(
            RegisterClassExW,
            register_class_hook,
            address as usize - user32.handle() as usize,
        );

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

    unsafe fn init_snp(&self) {
        let snp_data = self.snp_definitions.resolve();
        *(snp_data as *mut u32) = snp::PROVIDER_ID;
        *(snp_data.add(0xc) as *mut *const bw::SnpCapabilities) = &snp::CAPABILITIES;
        let func_count = (self.snp_definitions_size - 0x10) as usize / 4;

        // Initialize funcs with nullptr addresses, similar to what is done
        // in snp::SNP_FUNCTIONS. SCR has more functions than before.
        // SCR seems to have good default behaviour if the function pointer is
        // null, so assuming that we don't have to make things crash at
        // unimplemented functions.
        for i in 1..func_count {
            *(snp_data.add(0x10 + i * 4) as *mut usize) = 0;
        }
        std::ptr::copy_nonoverlapping(
            &snp::SNP_FUNCTIONS,
            snp_data.add(0x10) as *mut bw::SnpFunctions,
            1,
        );
        *(snp_data.add(0x10) as *mut u32) = self.snp_definitions_size - 0x10;
    }
}

impl bw::Bw for BwScr {
    unsafe fn run_game_loop(&self) {
        self.game_state.write(3); // Playing
        (self.game_loop)();
    }

    unsafe fn clean_up_for_exit(&self) {
        // TODO
    }

    unsafe fn init_sprites(&self) {
        (self.init_sprites)();
        self.sprites_inited.write(1);
    }

    unsafe fn maybe_receive_turns(&self) {
        (self.maybe_receive_turns)();
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
        let data = bw::LobbyGameInitData {
            game_init_command: 0x48,
            random_seed: seed,
            // TODO(tec27): deal with player bytes if we ever allow save games
            player_bytes: [8; 8],
        };
        let ptr = &data as *const bw::LobbyGameInitData as *const u8;
        let len = mem::size_of::<bw::LobbyGameInitData>();
        (self.process_lobby_commands)(ptr, len, 0);
        self.lobby_state.write(9);
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
        init_bw_string(&mut entry.unk10, b"");
        init_bw_string(&mut entry.filename, map_file.as_bytes());
        init_bw_string(&mut entry.title, b"");
        init_bw_string(&mut entry.description, b"");
        init_bw_string(&mut entry.error_message, b"");
        init_bw_string(&mut entry.unk9c, b"");
        init_bw_string(&mut entry.unkb8, b"");
        init_bw_string(&mut entry.unkd4, b"");
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

        let mut object: *const scr::LobbyDialogVtable = &LOBBY_DIALOG_VTABLE;
        (self.select_map_entry)(&mut game_input, &mut object, &mut entry);
        if entry.error != 0 {
            let error = std::ffi::CStr::from_ptr(entry.error_message.pointer as *const i8)
                .to_string_lossy();
            return Err(bw::LobbyCreateError::Other(error.into()));
        }
        (self.init_game_network)();
        Ok(())
    }

    unsafe fn join_lobby(
        &self,
        _game_info: &mut bw::JoinableGameInfo,
        _map_path: &[u8],
    ) -> Result<(), u32> {
        unimplemented!();
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

    unsafe fn storm_players(&self) -> Vec<bw::StormPlayer> {
        let ptr = self.storm_players.resolve() as *const bw::StormPlayer;
        std::slice::from_raw_parts(ptr, NET_PLAYER_COUNT).into()
    }

    unsafe fn storm_player_flags(&self) -> Vec<u32> {
        let ptr = self.storm_player_flags.resolve() as *const u32;
        std::slice::from_raw_parts(ptr, NET_PLAYER_COUNT).into()
    }

    unsafe fn storm_set_last_error(&self, error: u32) {
        // This just sets starcraft.exe errno
        // dword [[fs:[2c] + tls_index * 4] + 8]
        let tls_index = *self.starcraft_tls_index.0;
        let get_tls_table: extern fn() -> *mut *mut u32 = mem::transmute(GET_TLS_TABLE.as_ptr());
        let table = get_tls_table();
        let tls_data = *table.add(tls_index as usize);
        *tls_data.add(2) = error;
    }
}

whack_hooks!(stdcall, 0,
    !0 => GameInit();
    !0 => CreateWindowExW(
        u32, *const u16, *const u16, u32, i32, i32, i32, i32, usize, usize, usize, *mut c_void,
    ) -> *mut c_void;
    !0 => RegisterClassExW(*const WNDCLASSEXW) -> ATOM;
);

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

// SCR refers to the window class with ATOM returned by RegisterClassExW
// (And the class is named OsWindow instead of 1.16.1 SWarClass)
static BW_WINDOW_CLASS: AtomicUsize = AtomicUsize::new(!0);

fn register_class_hook(
    class: *const WNDCLASSEXW,
    orig: unsafe extern fn(*const WNDCLASSEXW) -> ATOM,
) -> ATOM {
    unsafe {
        let os_string;
        let class_name = (*class).lpszClassName;
        let name = match class_name.is_null() {
            true => None,
            false => {
                let len = (0..).find(|&x| *class_name.add(x) == 0).unwrap();
                let slice = std::slice::from_raw_parts(class_name, len);
                os_string = windows::os_string_from_winapi(slice);
                Some(os_string.to_string_lossy())
            }
        };
        debug!("RegisterClassExW with name {:?}", name);
        let is_bw_class = match name {
            None => false,
            Some(s) => s == "OsWindow",
        };
        let result = orig(class);
        if is_bw_class {
            BW_WINDOW_CLASS.store(result as usize, Ordering::Relaxed);
        }
        result
    }
}

/// Stores the window handle.
fn create_window_hook(
    ex_style: u32,
    class_name: *const u16,
    window_name: *const u16,
    style: u32,
    x: i32,
    y: i32,
    width: i32,
    height: i32,
    parent: usize,
    menu: usize,
    instance: usize,
    param: *mut c_void,
    orig: unsafe extern fn(
        u32,
        *const u16,
        *const u16,
        u32,
        i32,
        i32,
        i32,
        i32,
        usize,
        usize,
        usize,
        *mut c_void,
    ) -> *mut c_void,
) -> *mut c_void {
    unsafe {
        let result = orig(
            ex_style,
            class_name,
            window_name,
            style,
            x,
            y,
            width,
            height,
            parent,
            menu,
            instance,
            param,
        );
        let bw_class = BW_WINDOW_CLASS.load(Ordering::Relaxed);
        if class_name as usize == bw_class {
            debug!("Created main window {:p}", result);
            crate::forge::set_scr_window(result);
        }
        result
    }
}
