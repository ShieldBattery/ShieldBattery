//! Bounds ClientSdk's retries of Battle.net Agent requests, so the Agent can be left reachable.
//!
//! ClientSdk answers an Agent 401 by authorizing again and resending the request, wrapping the
//! request's callback in another one each time and without a limit. An Agent that keeps
//! answering 401 grows that chain until destroying it overflows the main thread's stack.
//!
//! ClientSdk maps its code with protections that can't be changed, so the limit is applied where
//! the Agent's responses enter the process, at Winsock `recv`:
//!
//! - After `RETRY_LIMIT` 401 responses, later ones reach the SDK as 403, which it reports to the
//!   request's caller as an error without retrying.
//! - Should the Agent's sockets deliver more than `RECEIVE_LIMIT` reads anyway, or the SDK
//!   connect to the Agent more than `CONNECT_LIMIT` times, the Agent is cut off for the rest of
//!   the process: reads from its sockets fail and `usable` turns false, on which the hooks that
//!   let the SDK find and connect to the Agent stop doing so.
//!
//! The cutoff holds whatever ClientSdk does with a response, so nothing here depends on the
//! SDK's build. What the limits do rely on is seeing the SDK's Agent traffic: its connections
//! being made with `connect` to the port in Agent.dat, which the SDK only gets to read while that
//! port can be read from it here too, and, for an Agent that keeps its connections open, its
//! responses being read with `recv`.
//!
//! Both limits last for the whole process. An earlier chain isn't known to be gone after a
//! success or a quiet period, so neither is ever refilled.

use std::cell::Cell;
use std::collections::HashMap;
use std::path::Path;
use std::sync::OnceLock;
use std::sync::atomic::{AtomicBool, AtomicU32, AtomicUsize, Ordering};

use parking_lot::Mutex;

/// The port ClientSdk sends Agent requests to when it can't read one from Agent.dat.
pub const FALLBACK_PORT: u16 = 1120;

const RETRY_LIMIT: usize = 8;
/// A launch's Agent requests come to a few dozen reads at most, while unlimited retries pass this
/// within seconds, long before their callback chain is deep enough to overflow the stack.
const RECEIVE_LIMIT: usize = 200;
/// The Agent closes its connection after every response, which makes this the limit that doesn't
/// need the SDK's reads to be seen. A launch connects to it some ten times at most.
const CONNECT_LIMIT: usize = 64;
const STATUS_PREFIX: &[u8] = b"HTTP/1.1 401";
const MSG_PEEK: i32 = 0x2;
const LOGGED_RESPONSE_LIMIT: usize = 32;

static GUARD_INSTALLED: AtomicBool = AtomicBool::new(false);
static CUT_OFF: AtomicBool = AtomicBool::new(false);
/// The port in Agent.dat when ClientSdk last opened it, 0 when none has been read.
static AGENT_PORT: AtomicU32 = AtomicU32::new(0);
static RETRIES: AtomicUsize = AtomicUsize::new(0);
static SUPPRESSED: AtomicUsize = AtomicUsize::new(0);
static RECEIVES: AtomicUsize = AtomicUsize::new(0);
static CONNECTS: AtomicUsize = AtomicUsize::new(0);
static LOGGED_RESPONSES: AtomicUsize = AtomicUsize::new(0);
static SOCKETS: OnceLock<Mutex<HashMap<usize, AgentSocket>>> = OnceLock::new();

thread_local! {
    /// Set while this module reads Agent.dat itself, so that read passes through the CreateFileW
    /// hook untouched.
    static READING_PORT_FILE: Cell<bool> = const { Cell::new(false) };
}

#[derive(Default)]
struct AgentSocket {
    matched_status_prefix: usize,
}

fn sockets() -> &'static Mutex<HashMap<usize, AgentSocket>> {
    SOCKETS.get_or_init(|| Mutex::new(HashMap::new()))
}

/// To be called once the `recv` and `closesocket` hooks that feed this module are in place.
pub fn set_guard_installed() {
    GUARD_INSTALLED.store(true, Ordering::Release);
}

pub fn guard_installed() -> bool {
    GUARD_INSTALLED.load(Ordering::Acquire)
}

/// Whether the retry limits are in place and the Agent hasn't been cut off.
pub fn usable() -> bool {
    guard_installed() && !CUT_OFF.load(Ordering::Relaxed)
}

/// Whether the current thread is inside this module's own read of Agent.dat.
pub fn is_reading_port_file() -> bool {
    READING_PORT_FILE.get()
}

/// Remembers the Agent's port from the Agent.dat that ClientSdk is about to open at `path`.
/// Returns false when no port can be read from the file, in which case the SDK must not get to
/// read it either: the connections it would make couldn't be told to be the Agent's.
pub fn note_port_file(path: &Path) -> bool {
    READING_PORT_FILE.set(true);
    let port = std::fs::read_to_string(path)
        .ok()
        .and_then(|text| text.trim().parse::<u16>().ok());
    READING_PORT_FILE.set(false);
    // An unreadable file leaves the last port in place, as sockets the SDK already has to it
    // stay the Agent's.
    let Some(port) = port else {
        return false;
    };
    if AGENT_PORT.swap(port.into(), Ordering::Relaxed) != u32::from(port) {
        debug!("ClientSdk's Battle.net Agent port is {port}");
    }
    true
}

/// Whether ClientSdk reaches the Agent at this loopback port.
pub fn is_agent_port(port: u16) -> bool {
    port == FALLBACK_PORT || u32::from(port) == AGENT_PORT.load(Ordering::Relaxed)
}

/// The port of a loopback IPv4 or IPv6 address in `sockaddr` layout, `None` for other addresses.
pub fn loopback_port(sockaddr: &[u8]) -> Option<u16> {
    const AF_INET: u16 = 2;
    const AF_INET6: u16 = 23;
    let family = u16::from_ne_bytes(sockaddr.get(..2)?.try_into().ok()?);
    let port = u16::from_be_bytes(sockaddr.get(2..4)?.try_into().ok()?);
    let loopback = match family {
        AF_INET => *sockaddr.get(4)? == 127,
        AF_INET6 => {
            let ip: [u8; 16] = sockaddr.get(8..24)?.try_into().ok()?;
            let ip = std::net::Ipv6Addr::from(ip);
            ip.is_loopback() || ip.to_ipv4_mapped().is_some_and(|ip| ip.is_loopback())
        }
        _ => false,
    };
    loopback.then_some(port)
}

/// To be called for every connect, so that a reused socket handle doesn't stay classified as the
/// Agent's.
pub fn on_connect(socket: usize, to_agent: bool) {
    if !guard_installed() {
        return;
    }
    let mut sockets = sockets().lock();
    if to_agent {
        sockets.insert(socket, AgentSocket::default());
        if CONNECTS.fetch_add(1, Ordering::Relaxed) == CONNECT_LIMIT {
            CUT_OFF.store(true, Ordering::Relaxed);
            warn!(
                "ClientSdk connected to the Battle.net Agent more than {CONNECT_LIMIT} times, \
                blocking the Agent for the rest of this launch"
            );
        }
    } else {
        sockets.remove(&socket);
    }
}

pub fn on_close(socket: usize) {
    if guard_installed() {
        sockets().lock().remove(&socket);
    }
}

/// Whether a read from `socket` has to fail without reaching Winsock.
pub fn receive_refused(socket: usize) -> bool {
    CUT_OFF.load(Ordering::Relaxed) && sockets().lock().contains_key(&socket)
}

/// To be called with the bytes a `recv` call on `socket` returned. Only the last digit of a
/// status code is ever changed.
pub fn on_recv(socket: usize, data: &mut [u8], flags: i32) {
    if !guard_installed() {
        return;
    }
    let mut sockets = sockets().lock();
    let Some(socket) = sockets.get_mut(&socket) else {
        return;
    };
    // A peek shows the SDK what the later read will, without spending anything twice.
    let peek = flags & MSG_PEEK != 0;
    if !peek {
        if RECEIVES.fetch_add(1, Ordering::Relaxed) == RECEIVE_LIMIT {
            CUT_OFF.store(true, Ordering::Relaxed);
            warn!(
                "ClientSdk read from the Battle.net Agent more than {RECEIVE_LIMIT} times, \
                blocking the Agent for the rest of this launch"
            );
        }
        if socket.matched_status_prefix == 0 {
            log_response_status(data);
        }
    }
    #[cfg(debug_assertions)]
    if std::env::var_os("SB_TEST_AGENT_UNLIMITED_401").is_some() {
        return;
    }
    let matched = scan_status(
        socket.matched_status_prefix,
        data,
        peek,
        &RETRIES,
        &SUPPRESSED,
    );
    if !peek {
        socket.matched_status_prefix = matched;
    }
}

fn log_response_status(data: &[u8]) {
    if let [
        b'H',
        b'T',
        b'T',
        b'P',
        b'/',
        b'1',
        b'.',
        _,
        b' ',
        a,
        b,
        c,
        ..,
    ] = *data
        && LOGGED_RESPONSES.fetch_add(1, Ordering::Relaxed) < LOGGED_RESPONSE_LIMIT
    {
        info!(
            "Battle.net Agent answered ClientSdk with HTTP {}{}{}",
            a as char, b as char, c as char
        );
    }
}

/// Matches `data` against a 401 status line, continuing from the `matched` bytes of it that
/// earlier reads on the socket ended with, and returns how many bytes of it `data` ends with.
fn scan_status(
    mut matched: usize,
    data: &mut [u8],
    peek: bool,
    retries: &AtomicUsize,
    suppressed: &AtomicUsize,
) -> usize {
    for byte in data {
        let expected = STATUS_PREFIX[matched];
        // HTTP/1.0 responses are limited the same way.
        if *byte == expected || (matched == 7 && *byte == b'0') {
            matched += 1;
        } else {
            return 0;
        }
        if matched == STATUS_PREFIX.len() {
            let suppress = if peek {
                retries.load(Ordering::Relaxed) >= RETRY_LIMIT
            } else {
                retries
                    .try_update(Ordering::Relaxed, Ordering::Relaxed, |n| {
                        (n < RETRY_LIMIT).then_some(n + 1)
                    })
                    .is_err()
            };
            if suppress {
                *byte = b'3';
                if !peek {
                    let count = suppressed.fetch_add(1, Ordering::Relaxed) + 1;
                    info!("Passing a Battle.net Agent 401 to ClientSdk as 403; count={count}");
                }
            }
            return 0;
        }
    }
    matched
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_401_spends_budget_and_then_becomes_terminal() {
        let retries = AtomicUsize::new(0);
        let suppressed = AtomicUsize::new(0);
        let mut socket = AgentSocket::default();
        for status in [b"HTTP/1.1 200 OK\r\n".as_slice(), b"HTTP/1.0 500 Error\r\n"] {
            let mut response = status.to_vec();
            socket.matched_status_prefix = scan_status(
                socket.matched_status_prefix,
                &mut response,
                false,
                &retries,
                &suppressed,
            );
            assert_eq!(response, status);
        }
        let mut body = b"HTTP/1.1 200 OK\r\n\r\nHTTP/1.1 401 is in the body".to_vec();
        scan_status(0, &mut body, false, &retries, &suppressed);
        assert_eq!(retries.load(Ordering::Relaxed), 0);
        for _ in 0..RETRY_LIMIT {
            let mut response = b"HTTP/1.1 401 Unauthorized\r\n".to_vec();
            socket.matched_status_prefix = scan_status(
                socket.matched_status_prefix,
                &mut response,
                false,
                &retries,
                &suppressed,
            );
            assert_eq!(response, b"HTTP/1.1 401 Unauthorized\r\n");
        }
        let mut response = b"HTTP/1.0 401 Unauthorized\r\n".to_vec();
        scan_status(
            socket.matched_status_prefix,
            &mut response,
            false,
            &retries,
            &suppressed,
        );
        assert_eq!(response, b"HTTP/1.0 403 Unauthorized\r\n");
        assert_eq!(retries.load(Ordering::Relaxed), RETRY_LIMIT);
        assert_eq!(suppressed.load(Ordering::Relaxed), 1);
    }

    #[test]
    fn fragmented_status_and_peek_spend_one_allowance() {
        let retries = AtomicUsize::new(0);
        let suppressed = AtomicUsize::new(0);
        let mut first = b"HTTP/1.1 40".to_vec();
        let matched = scan_status(0, &mut first, false, &retries, &suppressed);
        assert_eq!(matched, 11);
        let mut second = b"1 Unauthorized\r\n".to_vec();
        scan_status(matched, &mut second, true, &retries, &suppressed);
        assert_eq!(retries.load(Ordering::Relaxed), 0);
        scan_status(matched, &mut second, false, &retries, &suppressed);
        assert_eq!(retries.load(Ordering::Relaxed), 1);
    }

    #[test]
    fn loopback_ports() {
        let v4 = |ip: [u8; 4], port: u16| {
            let mut address = [0u8; 16];
            address[..2].copy_from_slice(&2u16.to_ne_bytes());
            address[2..4].copy_from_slice(&port.to_be_bytes());
            address[4..8].copy_from_slice(&ip);
            address
        };
        let v6 = |ip: &str, port: u16| {
            let ip: std::net::Ipv6Addr = ip.parse().unwrap();
            let mut address = [0u8; 28];
            address[..2].copy_from_slice(&23u16.to_ne_bytes());
            address[2..4].copy_from_slice(&port.to_be_bytes());
            address[8..24].copy_from_slice(&ip.octets());
            address
        };
        assert_eq!(loopback_port(&v4([127, 0, 0, 1], 1120)), Some(1120));
        assert_eq!(loopback_port(&v4([127, 1, 2, 3], 63482)), Some(63482));
        assert_eq!(loopback_port(&v4([10, 0, 0, 1], 1120)), None);
        assert_eq!(loopback_port(&v6("::1", 1120)), Some(1120));
        assert_eq!(loopback_port(&v6("::ffff:127.0.0.1", 1120)), Some(1120));
        assert_eq!(loopback_port(&v6("2001:db8::1", 1120)), None);
        assert_eq!(loopback_port(&v6("::1", 1120)[..20]), None);
        assert_eq!(loopback_port(&[]), None);
    }

    #[test]
    fn concurrent_responses_share_one_nonrefilling_budget() {
        let retries = AtomicUsize::new(0);
        let suppressed = AtomicUsize::new(0);
        std::thread::scope(|scope| {
            for _ in 0..32 {
                scope.spawn(|| {
                    let mut response = b"HTTP/1.1 401 Unauthorized\r\n".to_vec();
                    scan_status(0, &mut response, false, &retries, &suppressed);
                });
            }
        });
        assert_eq!(retries.load(Ordering::Relaxed), RETRY_LIMIT);
        assert_eq!(suppressed.load(Ordering::Relaxed), 32 - RETRY_LIMIT);
    }
}
