use std::mem;
use std::ptr::null_mut;
use std::sync::Mutex;

use bytes::Bytes;
use lazy_static::lazy_static;
use libc::{c_void, sockaddr};
use winapi::um::libloaderapi::{GetModuleFileNameA};
use winapi::shared::ntdef::HANDLE;

use crate::bw::{self, storm};
use crate::windows::{self, OwnedHandle};
use crate::{game_thread_message};

// 'SBAT'
pub const PROVIDER_ID: u32 = 0x53424154;
// min-MTU - (rally-point-overhead) - (max-IP-header-size + udp-header-size)
const SNP_PACKET_SIZE: u32 = 576 - 13 - (60 + 8);
const STORM_ERROR_NO_MESSAGES_WAITING: u32 = 0x8510006b;

pub static SNP_FUNCTIONS: bw::SnpFunctions = bw::SnpFunctions {
    size: mem::size_of::<bw::SnpFunctions>() as u32,
    // Some of these functions have temporary addresses that make it easier to tell what
    // function was being called in stack traces and error messages
    func1: -1isize as *mut c_void,
    unbind,
    free_packet,
    free_server_packet,
    get_game_info,
    func6: -6isize as *mut c_void,
    initialize,
    func8: -8isize as *mut c_void,
    enum_devices,
    receive_games_list,
    receive_packet,
    receive_server_packet,
    func13: -13isize as *mut c_void,
    send_packet,
    send_command,
    broadcast_game,
    stop_broadcasting_game,
    free_device_data,
    find_games,
    func20: -20isize as *mut c_void,
    report_game_result,
    func22: -22isize as *mut c_void,
    func23: -23isize as *mut c_void,
    func24: -24isize as *mut c_void,
    get_league_id,
    do_league_logout,
    get_reply_target,
};

struct State {
    is_bound: bool,
    spoofed_game: Option<bw::SnpGameInfo>,
    spoofed_game_dirty: bool,
    current_client_info: Option<bw::ClientInfo>,
    recv_messages: Option<std::sync::mpsc::Receiver<ReceivedMessage>>,
}

lazy_static! {
    static ref SNP_LIST_ENTRY: bw::SnpListEntry = init_list_entry();
    static ref STATE: Mutex<State> = Mutex::new(State {
        is_bound: false,
        spoofed_game: None,
        spoofed_game_dirty: false,
        current_client_info: None,
        recv_messages: None,
    });
}

fn with_state<F: FnOnce(&mut State) -> R, R>(func: F) -> R {
    let mut state = STATE.lock().unwrap();
    func(&mut state)
}

fn init_list_entry() -> bw::SnpListEntry {
    let mut list_entry = bw::SnpListEntry {
        // Since we don't actually use the list, its fine not to set this
        prev: null_mut(),
        next: -1isize as *mut bw::SnpListEntry, // Ensure the list ends,
        file_path: [0; 260],
        index: 0,
        identifier: PROVIDER_ID,
        // Name/Description don't matter since we don't show the normal network UI
        name: [0; 128],
        description: [0; 128],
        capabilities: bw::SnpCapabilities {
            size: mem::size_of::<bw::SnpCapabilities>() as u32,
            // As far as I can see, only the 1 bit matters here, and seems to affect how storm
            // allocates for packet data. Only UDP LAN sets it. Doesn't look particularly useful
            // to us. All of the network modes set at least 0x20000000 though, so we'll set it as
            // well.
            unknown1: 0x20000000,
            // minus 16 because Storm normally does that (overhead?)
            max_packet_size: SNP_PACKET_SIZE - 16,
            unknown3: 16,
            displayed_player_count: 256,
            // This value is related to timeouts in some way (it's always used alongside
            // GetTickCount, and always as the divisor). The value here matches the one used by
            // UDP LAN and new (post-lan-lat-changes) BNet.
            unknown5: 100000,
            // This value is seemingly related to timeouts as well (and does not affect action
            // latency under normal conditions). The value chosen here sits between UDP LAN
            // (50, minimum) and BNet (500).
            player_latency: 384,
            // This is not really an accurate naming, it's more related to the rate at which
            // packets will be sent. This value matches UDP LAN and new (post-lan-lat-changes)
            // BNet.
            max_player_count: 8,
            // Matches UDP LAN
            turn_delay: 2,
        }
    };
    let self_module = windows::module_from_address(init_list_entry as *mut c_void);
    if let Some((_, module)) = self_module {
        // Using GetModuleFileNameA specifically if the dll is in a
        // not-ascii-but-valid-current-language path.
        unsafe {
            let n = GetModuleFileNameA(
                module,
                list_entry.file_path.as_mut_ptr() as *mut i8,
                list_entry.file_path.len() as u32,
            );
            if n == 0 {
                panic!("GetModuleFileNameA failed: {}", std::io::Error::last_os_error());
            }
        }
    } else {
        panic!("Unable to get self path");
    }
    list_entry
}

pub unsafe fn init_snp_list_hook() {
    // Set up Storm's SNP list ourselves, so that we don't have to worry about having an MPQ file
    // appended to this one and don't have to worry about passing signature checks.
    if *storm::snp_list_initialized == 0 {
        *storm::snp_list_initialized = 1;
        let entry = &*SNP_LIST_ENTRY as *const bw::SnpListEntry as *mut bw::SnpListEntry;
        (*storm::snp_list).prev = entry;
        (*storm::snp_list).next = entry;
    }
}

pub unsafe fn unload_snps(_clear_list: u32, orig: &Fn(u32)) {
    // Never pass clear_list = true, as we initialized the list and Storm can't free the memory
    orig(0);
    if *storm::snp_list_initialized != 0 {
        *storm::snp_list_initialized = 0;
        (*storm::snp_list).prev = null_mut();
        (*storm::snp_list).next = null_mut();
    }
}

pub unsafe fn init_hooks(patcher: &mut whack::ActivePatcher) {
    let mut storm = patcher.patch_library("storm", 0x1500_0000);
    storm::init_vars(&mut storm);
    storm.hook(storm::InitializeSnpList, init_snp_list_hook);
    storm.hook_opt(storm::UnloadSnp, unload_snps);
}

/// Messages sent to the async SNP task from BW's side.
pub enum SnpMessage {
    Destroy,
    // The handle is an event created by storm, signaled when a message is received
    CreateNetworkHandler(SendMessages),
}

pub struct SendMessages {
    sender: std::sync::mpsc::Sender<ReceivedMessage>,
    signal_handle: OwnedHandle,
}

#[repr(C)]
pub struct ReceivedMessage {
    // `from` needs to be the first thing in this struct such that from => ReceivedMessage
    // (so we can free what Storm gives us)
    pub from: sockaddr,
    pub data: Bytes,
}

fn send_snp_message(message: SnpMessage) {
    crate::game_thread_message(crate::GameThreadMessage::Snp(message));
}

extern "stdcall" fn unbind() -> i32 {
    with_state(|state| {
        state.is_bound = false;
        send_snp_message(SnpMessage::Destroy);
        state.spoofed_game = None;
        state.current_client_info = None;
        1
    })
}

unsafe extern "stdcall" fn free_packet(
    from: *mut sockaddr,
    _data: *const u8,
    _data_len: u32,
) -> i32 {
    Box::from_raw(from as *mut ReceivedMessage);
    1
}

extern "stdcall" fn free_server_packet(
    _from: *mut sockaddr,
    _data: *mut c_void,
    _data_len: u32,
) -> i32 {
    1
}

unsafe extern "stdcall" fn get_game_info(
    index: u32,
    _game_name: *const u8,
    _password: *const u8,
    result_info: *mut bw::SnpGameInfo,
) -> i32 {
    if index != 1 {
        return 0;
    }
    with_state(|state| {
        if let Some(ref game) = state.spoofed_game {
            *result_info = game.clone();
            1
        } else {
            0
        }
    })
}

unsafe extern "stdcall" fn initialize(
    client_info: *const bw::ClientInfo,
    _user_data: *mut c_void,
    _battle_info: *mut c_void,
    _module_data: *mut c_void,
    receive_event: HANDLE,
) -> i32 {
    with_state(|state| {
        state.is_bound = true;
        state.spoofed_game = None;
        state.spoofed_game_dirty = false;
        state.current_client_info = Some((*client_info).clone());
        // I don't know what's the intended usage pattern with this handle,
        // but duplicating it should make it safe to send to a thread that may use it
        // without having to synchronize storm unbinding SNP.
        let receive_event = OwnedHandle::duplicate(receive_event)
            .expect("Handle duplication failed");
        let (send_messages, recv_messages) = std::sync::mpsc::channel();
        state.recv_messages = Some(recv_messages);
        send_snp_message(SnpMessage::CreateNetworkHandler(SendMessages {
            sender: send_messages,
            signal_handle: receive_event,
        }));
        1
    })
}

unsafe extern "stdcall" fn enum_devices(device_data: *mut *mut c_void) -> i32 {
    // this function appears unnecessary in modern protocols.
    // the important thing here is to zero out the pointer returned in modem_data,
    // and return true (no error)
    *device_data = null_mut();
    1
}

unsafe extern "stdcall" fn receive_games_list(
    unk1: u32,
    unk2: u32,
    received_list: *mut *mut bw::SnpGameInfo,
) -> i32 {
    unimplemented!()
}

unsafe extern "stdcall" fn receive_packet(
    addr: *mut *mut sockaddr,
    data: *mut *const u8,
    length: *mut u32,
) -> i32 {
    use std::sync::mpsc::TryRecvError;
    if addr.is_null() || data.is_null() || length.is_null() {
        return 0;
    }
    let msg = with_state(|state| {
        if let Some(ref recv) = state.recv_messages {
            recv.try_recv().ok()
        } else {
            error!("Storm tried to receive messages without initializing SNP?");
            None
        }
    });
    if let Some(msg) = msg {
        let ptr = Box::into_raw(Box::new(msg));
        *addr = ptr as *mut sockaddr;
        *data = (*ptr).data.as_ptr();
        *length = (*ptr).data.len() as u32;
        1
    } else {
        *addr = null_mut();
        *data = null_mut();
        *length = 0;
        crate::storm::SErrSetLastError(STORM_ERROR_NO_MESSAGES_WAITING);
        0
    }
}

unsafe extern "stdcall" fn receive_server_packet(
    from: *mut *mut sockaddr,
    data: *mut *mut c_void,
    length: *mut u32,
) -> i32 {
    if !from.is_null() {
        *from = null_mut();
    }
    if !data.is_null() {
        *data = null_mut();
    }
    if !length.is_null() {
        *length = 0;
    }
    0
}

unsafe extern "stdcall" fn send_packet(
    num_targets: u32,
    targets: *const *const sockaddr,
    data: *const u8,
    data_len: u32,
) -> i32 {
    unimplemented!()
}

unsafe extern "stdcall" fn send_command(
    _unk1: *const u8,
    player_name: *const u8,
    unk2: *mut c_void,
    unk3: *mut c_void,
    command: *const u8,
) -> i32 {
    // battle.snp checks that the data at unk2 and unk3 is 0 or it doesn't send
    // unk1 seems to always be '\\.\\game\<game name>'
    1
}

unsafe extern "stdcall" fn broadcast_game(
    _name: *const u8,
    _password: *const u8,
    _game_data: *const u8,
    _game_state: i32,
    _elapsed_time: u32,
    _game_type: i32,
    _unk1: i32,
    _unk2: i32,
    _player_data: *mut c_void,
    _player_count: u32,
) -> i32 {
    1
}

unsafe extern "stdcall" fn stop_broadcasting_game() -> i32 {
    1
}

unsafe extern "stdcall" fn free_device_data(_data: *mut c_void) -> i32 {
    // we never allocate modem data, so the pointer passed in will always be NULL.
    // thus, we can simply return true.
    1
}

unsafe extern "stdcall" fn find_games(_unk1: i32, _list: *mut c_void) -> i32 {
    1
}

unsafe extern "stdcall" fn report_game_result(
    _unk1: i32,
    _player_slots_len: i32,
    _player_name: *const u8,
    _unk2: *const i32,
    _map_name: *const u8,
    _results: *const u8,
) -> i32 {
    1
}

unsafe extern "stdcall" fn get_league_id(id: *mut i32) -> i32 {
    // this function always returns false it seems
    *id = 0;
    0
}

unsafe extern "stdcall" fn do_league_logout(_player_name: *const u8) -> i32 {
    1
}

unsafe extern "stdcall" fn get_reply_target(_dest: *const u8, _dest_len: u32) -> i32 {
    1
}
