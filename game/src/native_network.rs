//! ShieldBattery sessions must not contribute to Blizzard's native game-client telemetry.

use std::ffi::CStr;
#[cfg(debug_assertions)]
use std::sync::atomic::{AtomicBool, Ordering};

use libc::c_void;
use winapi::um::winsock2::{WSAHOST_NOT_FOUND, WSASetLastError};

#[cfg(debug_assertions)]
static TRACE_LOOKUPS: AtomicBool = AtomicBool::new(false);

system_hooks!(
    !0 => GetAddrInfo(*const i8, *const i8, *const c_void, *mut *mut c_void) -> i32;
    !0 => GetAddrInfoW(*const u16, *const u16, *const c_void, *mut *mut c_void) -> i32;
);

pub unsafe fn init_hooks(patcher: &mut whack::Patcher) {
    #[cfg(debug_assertions)]
    TRACE_LOOKUPS.store(
        std::env::var_os("SB_TRACE_SC_NETWORK").is_some(),
        Ordering::Relaxed,
    );
    unsafe {
        hook_winapi_exports!(patcher, "ws2_32",
            "getaddrinfo", GetAddrInfo, get_addr_info;
            "GetAddrInfoW", GetAddrInfoW, get_addr_info_w;
        );
    }
    info!("Native Blizzard telemetry DNS suppression enabled");
}

fn get_addr_info(
    node: *const i8,
    service: *const i8,
    hints: *const c_void,
    result: *mut *mut c_void,
    orig: unsafe extern "C" fn(*const i8, *const i8, *const c_void, *mut *mut c_void) -> i32,
) -> i32 {
    unsafe {
        if !node.is_null() {
            let hostname = CStr::from_ptr(node).to_string_lossy();
            #[cfg(debug_assertions)]
            if TRACE_LOOKUPS.load(Ordering::Relaxed) {
                info!("Native DNS lookup: {hostname}");
            }
            if is_telemetry_host(&hostname) && !result.is_null() {
                return hostname_not_found(result);
            }
        }
        orig(node, service, hints, result)
    }
}

fn get_addr_info_w(
    node: *const u16,
    service: *const u16,
    hints: *const c_void,
    result: *mut *mut c_void,
    orig: unsafe extern "C" fn(*const u16, *const u16, *const c_void, *mut *mut c_void) -> i32,
) -> i32 {
    unsafe {
        if !node.is_null() {
            let mut len = 0;
            while *node.add(len) != 0 {
                len += 1;
            }
            let hostname = String::from_utf16_lossy(std::slice::from_raw_parts(node, len));
            #[cfg(debug_assertions)]
            if TRACE_LOOKUPS.load(Ordering::Relaxed) {
                info!("Native DNS lookup: {hostname}");
            }
            if is_telemetry_host(&hostname) && !result.is_null() {
                return hostname_not_found(result);
            }
        }
        orig(node, service, hints, result)
    }
}

fn is_telemetry_host(hostname: &str) -> bool {
    let hostname = hostname.strip_suffix('.').unwrap_or(hostname);
    hostname.eq_ignore_ascii_case("telemetry-in.battle.net")
        || hostname.eq_ignore_ascii_case("telemetry-in.battlenet.com.cn")
}

unsafe fn hostname_not_found(result: *mut *mut c_void) -> i32 {
    debug!("Suppressed native Blizzard telemetry DNS lookup");
    unsafe {
        *result = std::ptr::null_mut();
        WSASetLastError(WSAHOST_NOT_FOUND);
    }
    WSAHOST_NOT_FOUND
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn telemetry_filter_matches_only_the_exact_host() {
        assert!(is_telemetry_host("telemetry-in.battle.net"));
        assert!(is_telemetry_host("TELEMETRY-IN.BATTLE.NET."));
        assert!(is_telemetry_host("telemetry-in.battlenet.com.cn"));
        for hostname in [
            "localhost",
            "battle.net",
            "connect.classic.blizzard.com",
            "telemetry-in.battle.net.example.com",
            "prefix-telemetry-in.battle.net",
            "telemetry-in.battle.net..",
        ] {
            assert!(!is_telemetry_host(hostname));
        }
    }

    #[test]
    fn ansi_and_unicode_hooks_preserve_other_lookups() {
        unsafe extern "C" fn ansi(
            _node: *const i8,
            _service: *const i8,
            hints: *const c_void,
            result: *mut *mut c_void,
        ) -> i32 {
            unsafe { *result = hints.cast_mut() };
            17
        }
        unsafe extern "C" fn unicode(
            _node: *const u16,
            _service: *const u16,
            hints: *const c_void,
            result: *mut *mut c_void,
        ) -> i32 {
            unsafe { *result = hints.cast_mut() };
            17
        }
        let hints = std::ptr::dangling::<c_void>();
        let mut result = std::ptr::null_mut();
        let localhost_w: Vec<u16> = "localhost\0".encode_utf16().collect();
        assert_eq!(
            get_addr_info(
                c"localhost".as_ptr(),
                std::ptr::null(),
                hints,
                &mut result,
                ansi
            ),
            17
        );
        assert_eq!(result, hints.cast_mut());
        result = std::ptr::null_mut();
        assert_eq!(
            get_addr_info_w(
                localhost_w.as_ptr(),
                std::ptr::null(),
                hints,
                &mut result,
                unicode
            ),
            17
        );
        assert_eq!(result, hints.cast_mut());
        assert_eq!(
            get_addr_info(
                c"telemetry-in.battle.net".as_ptr(),
                std::ptr::null(),
                hints,
                &mut result,
                ansi
            ),
            WSAHOST_NOT_FOUND
        );
        assert!(result.is_null());
        let telemetry_w: Vec<u16> = "telemetry-in.battle.net\0".encode_utf16().collect();
        assert_eq!(
            get_addr_info_w(
                telemetry_w.as_ptr(),
                std::ptr::null(),
                hints,
                &mut result,
                unicode
            ),
            WSAHOST_NOT_FOUND
        );
        assert!(result.is_null());
    }

    #[test]
    fn failed_lookup_clears_result_and_sets_winsock_error() {
        let mut result = std::ptr::dangling_mut::<c_void>();
        assert_eq!(
            unsafe { hostname_not_found(&mut result) },
            WSAHOST_NOT_FOUND
        );
        assert!(result.is_null());
        assert_eq!(
            unsafe { winapi::um::winsock2::WSAGetLastError() },
            WSAHOST_NOT_FOUND
        );
    }
}
