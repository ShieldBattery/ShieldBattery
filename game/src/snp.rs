use std::mem;
use std::net::Ipv4Addr;
use std::ptr::null_mut;
use std::sync::{Arc, Mutex};

use bytes::Bytes;
use lazy_static::lazy_static;
use libc::{c_void, sockaddr};
use winapi::shared::ntdef::HANDLE;
use winapi::shared::ws2def::{AF_INET, SOCKADDR_IN};
use winapi::um::synchapi::SetEvent;
use winapi::um::sysinfoapi::GetTickCount;

use crate::bw;
use crate::game_thread::{game_thread_message, GameThreadMessage};
use crate::windows::{OwnedHandle};

// 'SBAT'
pub const PROVIDER_ID: u32 = 0x53424154;
// min-MTU - (rally-point-overhead) - (max-IP-header-size + udp-header-size)
pub const SNP_PACKET_SIZE: u32 = 576 - 13 - (60 + 8);
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
    initialize: initialize_1161,
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

pub static CAPABILITIES: bw::SnpCapabilities = bw::SnpCapabilities {
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
};

static mut STORM_VISIBLE_SPOOFED_GAME: Option<bw::SnpGameInfo> = None;

struct State {
    is_bound: bool,
    spoofed_game: Option<bw::SnpGameInfo>,
    spoofed_game_dirty: bool,
    current_client_info: Option<bw::ClientInfo>,
    messages: Vec<ReceivedMessage>,
}

lazy_static! {
    static ref STATE: Mutex<State> = Mutex::new(State {
        is_bound: false,
        spoofed_game: None,
        spoofed_game_dirty: false,
        current_client_info: None,
        messages: Vec::with_capacity(32),
    });
}

fn with_state<F: FnOnce(&mut State) -> R, R>(func: F) -> R {
    let mut state = STATE.lock().unwrap();
    func(&mut state)
}

fn std_ip_to_sockaddr(address: Ipv4Addr) -> sockaddr {
    unsafe {
        let mut from = SOCKADDR_IN {
            sin_family: AF_INET as u16,
            sin_port: 6112,
            ..mem::zeroed()
        };
        let octets = from.sin_addr.S_un.S_un_b_mut();
        octets.s_b1 = address.octets()[0];
        octets.s_b2 = address.octets()[1];
        octets.s_b3 = address.octets()[2];
        octets.s_b4 = address.octets()[3];
        mem::transmute(from)
    }
}

fn sockaddr_to_std_ip(address: sockaddr) -> Ipv4Addr {
    unsafe {
        let addr: SOCKADDR_IN = mem::transmute(address);
        let octets = addr.sin_addr.S_un.S_un_b();
        Ipv4Addr::new(octets.s_b1, octets.s_b2, octets.s_b3, octets.s_b4)
    }
}

pub fn spoof_game(name: &str, address: Ipv4Addr) {
    with_state(|state| unsafe {
        let current_client_info = match state.current_client_info {
            Some(ref s) => s,
            None => {
                error!("spoof_game: current client info not set");
                return;
            }
        };
        let mut info = bw::SnpGameInfo {
            index: 1,
            game_state: bw::GAME_STATE_ACTIVE,
            host_addr: std_ip_to_sockaddr(address),
            update_time: GetTickCount(),
            product_code: current_client_info.product_code,
            version_code: current_client_info.version_code,
            unk2: 0x50,
            unk3: 0xa7,
            ..mem::zeroed()
        };
        for (out, val) in info.game_name.iter_mut().zip(name.as_bytes().iter()) {
            *out = *val;
        }
        debug!("Spoofing game for address {:?}", address);
        state.spoofed_game_dirty = true;
        state.spoofed_game = Some(info);
    });
}

/// Messages sent to the async SNP task from BW's side.
pub enum SnpMessage {
    Destroy,
    // The handle is an event created by storm, signaled when a message is received
    CreateNetworkHandler(SendMessages),
    Send(Vec<Ipv4Addr>, Vec<u8>),
}

#[derive(Clone)]
pub struct SendMessages {
    receive_callback: Arc<Box<dyn Fn() + Send + Sync + 'static>>,
}

impl SendMessages {
    pub fn send(&self, message: ReceivedMessage) {
        with_state(|state| {
            state.messages.push(message);
        });
        (self.receive_callback)();
    }
}

pub struct ReceivedMessage {
    pub from: Ipv4Addr,
    pub data: Bytes,
}

#[repr(C)]
struct RawReceivedMessage {
    // `from` needs to be the first thing in this struct such that from => ReceivedMessage
    // (so we can free what Storm gives us)
    from: sockaddr,
    data: Bytes,
}

fn send_snp_message(message: SnpMessage) {
    game_thread_message(GameThreadMessage::Snp(message));
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

pub unsafe extern "stdcall" fn free_packet(
    from: *mut sockaddr,
    _data: *const u8,
    _data_len: u32,
) -> i32 {
    Box::from_raw(from as *mut RawReceivedMessage);
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

unsafe extern "stdcall" fn initialize_1161(
    client_info: *const bw::ClientInfo,
    _user_data: *mut c_void,
    _battle_info: *mut c_void,
    _module_data: *mut c_void,
    receive_event: HANDLE,
) -> i32 {
    initialize(&*client_info, Some(receive_event));
    1
}

pub unsafe fn initialize(client_info: &bw::ClientInfo, receive_event: Option<HANDLE>) {
    debug!("SNP initialize");
    with_state(|state| {
        state.is_bound = true;
        state.spoofed_game = None;
        state.spoofed_game_dirty = false;
        state.current_client_info = Some(client_info.clone());
        // I don't know what's the intended usage pattern with this handle,
        // but duplicating it should make it safe to send to a thread that may use it
        // without having to synchronize storm unbinding SNP.
        let receive_callback = if let Some(receive_event) = receive_event {
            let receive_event = OwnedHandle::duplicate(receive_event)
                .expect("SNP event handle duplication failed");
            Box::new(move || {
                SetEvent(receive_event.get());
            }) as Box<dyn Fn() + Send + Sync + 'static>
        } else {
            Box::new(move || {
            })
        };
        send_snp_message(SnpMessage::CreateNetworkHandler(SendMessages {
            receive_callback: Arc::new(receive_callback),
        }));
    });
}

unsafe extern "stdcall" fn enum_devices(device_data: *mut *mut c_void) -> i32 {
    // this function appears unnecessary in modern protocols.
    // the important thing here is to zero out the pointer returned in modem_data,
    // and return true (no error)
    *device_data = null_mut();
    1
}

unsafe extern "stdcall" fn receive_games_list(
    _unk1: u32,
    _unk2: u32,
    received_list: *mut *mut bw::SnpGameInfo,
) -> i32 {
    with_state(|state| {
        match state.spoofed_game {
            Some(ref s) => {
                if STORM_VISIBLE_SPOOFED_GAME.is_none() {
                    STORM_VISIBLE_SPOOFED_GAME = Some(mem::zeroed());
                }
                let ptr: *mut bw::SnpGameInfo = STORM_VISIBLE_SPOOFED_GAME.as_mut().unwrap();
                if state.spoofed_game_dirty {
                    *ptr = s.clone();
                    state.spoofed_game_dirty = false;
                }
                *received_list = ptr;
            }
            None => {
                *received_list = null_mut();
            }
        }
        1
    })
}

pub unsafe extern "stdcall" fn receive_packet(
    addr: *mut *mut sockaddr,
    data: *mut *const u8,
    length: *mut u32,
) -> i32 {
    if addr.is_null() || data.is_null() || length.is_null() {
        return 0;
    }
    let msg = with_state(|state| {
        if state.messages.is_empty() {
            None
        } else {
            Some(state.messages.remove(0))
        }
    });
    if let Some(msg) = msg {
        let msg = RawReceivedMessage {
            from: std_ip_to_sockaddr(msg.from),
            data: msg.data,
        };
        let ptr = Box::into_raw(Box::new(msg));
        *addr = ptr as *mut sockaddr;
        *data = (*ptr).data.as_ptr();
        *length = (*ptr).data.len() as u32;
        1
    } else {
        *addr = null_mut();
        *data = null_mut();
        *length = 0;
        bw::with_bw(|bw| bw.storm_set_last_error(STORM_ERROR_NO_MESSAGES_WAITING));
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
    let targets = std::slice::from_raw_parts(targets, num_targets as usize);
    let targets = targets.iter().map(|t| sockaddr_to_std_ip(**t)).collect();
    let data = std::slice::from_raw_parts(data, data_len as usize);
    send_snp_message(SnpMessage::Send(targets, data.into()));
    1
}

pub unsafe extern "stdcall" fn send_packet_scr(
    target: *const sockaddr,
    data: *const u8,
    data_len: u32,
) -> i32 {
    let targets = &[target];
    let targets = targets.iter().map(|t| sockaddr_to_std_ip(**t)).collect();
    let data = std::slice::from_raw_parts(data, data_len as usize);
    send_snp_message(SnpMessage::Send(targets, data.into()));
    1
}

unsafe extern "stdcall" fn send_command(
    _unk1: *const u8,
    _player_name: *const u8,
    _unk2: *mut c_void,
    _unk3: *mut c_void,
    _command: *const u8,
) -> i32 {
    // battle.snp checks that the data at unk2 and unk3 is 0 or it doesn't send
    // unk1 seems to always be '\\.\\game\<game name>'
    1
}

pub unsafe extern "stdcall" fn broadcast_game(
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

pub unsafe extern "stdcall" fn stop_broadcasting_game() -> i32 {
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
