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
use crate::game_thread::{send_game_msg_to_async, GameThreadMessage};
use crate::windows::OwnedHandle;

// 'SBAT'
pub const PROVIDER_ID: u32 = 0x53424154;
// NOTE(tec27): The value below is what *Storm* will obey and deal with fragmenting around. We
// maintain our own max payload size that assumes a larger min-MTU (basically always safe nowadays).
// We could probably bump this up but I have yet to see a case where Storm hits this max anyway.
// min-MTU - (rally-point-overhead) - (max-IP-header-size + udp-header-size) - netcode-overhead
pub const SNP_PAYLOAD_SIZE: u32 = 576 - 13 - (60 + 8) - 23;
const STORM_ERROR_NO_MESSAGES_WAITING: u32 = 0x8510006b;

pub static CAPABILITIES: bw::SnpCapabilities = bw::SnpCapabilities {
    size: mem::size_of::<bw::SnpCapabilities>() as u32,
    // As far as I can see, only the 1 bit matters here, and seems to affect how storm
    // allocates for packet data. Only UDP LAN sets it. Doesn't look particularly useful
    // to us. All of the network modes set at least 0x20000000 though, so we'll set it as
    // well.
    unknown1: 0x20000000,
    // minus 16 because Storm normally does that (overhead?)
    max_packet_size: SNP_PAYLOAD_SIZE - 16,
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

struct State {
    spoofed_game: Option<bw::SnpGameInfo>,
    spoofed_game_dirty: bool,
    current_client_info: Option<bw::ClientInfo>,
    messages: Vec<ReceivedMessage>,
}

lazy_static! {
    static ref STATE: Mutex<State> = Mutex::new(State {
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
    CreateNetworkHandler(SendMessages),
    Send(Ipv4Addr, Vec<u8>),
}

/// This is named SendMessages since it allows the network task to
/// send messages to, that is, communicate with SNP layer.
/// But from this module's point of view it's a misleading name, as
/// the only communication there is is for for data being *received*.
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
    send_game_msg_to_async(GameThreadMessage::Snp(message));
}

pub unsafe extern "stdcall" fn free_packet(
    from: *mut sockaddr,
    _data: *const u8,
    _data_len: u32,
) -> i32 {
    drop(Box::from_raw(from as *mut RawReceivedMessage));
    1
}

pub unsafe fn initialize(client_info: &bw::ClientInfo, receive_event: Option<HANDLE>) {
    debug!("SNP initialize");
    with_state(|state| {
        state.spoofed_game = None;
        state.spoofed_game_dirty = false;
        state.current_client_info = Some(*client_info);
        // I don't know what's the intended usage pattern with this handle,
        // but duplicating it should make it safe to send to a thread that may use it
        // without having to synchronize storm unbinding SNP.
        let receive_callback = if let Some(receive_event) = receive_event {
            let receive_event =
                OwnedHandle::duplicate(receive_event).expect("SNP event handle duplication failed");
            Box::new(move || {
                SetEvent(receive_event.get());
            }) as Box<dyn Fn() + Send + Sync + 'static>
        } else {
            Box::new(move || {})
        };
        send_snp_message(SnpMessage::CreateNetworkHandler(SendMessages {
            receive_callback: Arc::new(receive_callback),
        }));
    });
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
        bw::get_bw().storm_set_last_error(STORM_ERROR_NO_MESSAGES_WAITING);
        0
    }
}

pub unsafe extern "stdcall" fn send_packet(
    target: *const sockaddr,
    data: *const u8,
    data_len: u32,
) -> i32 {
    let target = sockaddr_to_std_ip(*target);
    let data = std::slice::from_raw_parts(data, data_len as usize);
    send_snp_message(SnpMessage::Send(target, data.into()));
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
