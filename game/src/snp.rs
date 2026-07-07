use std::mem;
use std::ptr::null_mut;

use libc::{c_void, sockaddr};

use crate::bw::{self, Bw};

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

// The functions below are Storm's SNP provider table. A game never actually moves bytes through
// them — all real traffic rides the rally-point2 turn transport — but the provider must still be
// chosen (`choose_snp`) for Storm's local session create to succeed, and the table entries must be
// valid, non-null function pointers. So they are kept as inert stubs: a receive that reports "no
// messages", sends and frees that no-op, and broadcast calls that succeed without doing anything.

pub unsafe extern "system" fn free_packet(
    _from: *mut sockaddr,
    _data: *const u8,
    _data_len: u32,
) -> i32 {
    1
}

pub unsafe extern "system" fn receive_packet(
    addr: *mut *mut sockaddr,
    data: *mut *const u8,
    length: *mut u32,
) -> i32 {
    if addr.is_null() || data.is_null() || length.is_null() {
        return 0;
    }
    unsafe {
        *addr = null_mut();
        *data = null_mut();
        *length = 0;
        bw::get_bw().storm_set_last_error(STORM_ERROR_NO_MESSAGES_WAITING);
    }
    0
}

pub unsafe extern "system" fn send_packet(
    _target: *const sockaddr,
    _data: *const u8,
    _data_len: u32,
) -> i32 {
    1
}

pub unsafe extern "system" fn broadcast_game(
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

pub unsafe extern "system" fn stop_broadcasting_game() -> i32 {
    1
}
