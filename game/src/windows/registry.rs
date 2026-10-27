//! Minimal `HKEY_CURRENT_USER` and `HKEY_LOCAL_MACHINE` reads.
//!
//! Every function here treats "couldn't read it" the same as "isn't set" — callers use these for
//! optional settings, where a missing value and an unreadable one lead to the same behavior.

use scopeguard::defer;
use winapi::shared::minwindef::{DWORD, HKEY};
use winapi::shared::winerror::ERROR_SUCCESS;
use winapi::um::winnt::{KEY_READ, KEY_WOW64_64KEY, REG_DWORD, REG_SZ};
use winapi::um::winreg::{
    HKEY_CURRENT_USER, HKEY_LOCAL_MACHINE, RegCloseKey, RegOpenKeyExW, RegQueryValueExW,
};

use super::{os_string_from_winapi_with_nul, winapi_str};

/// Reads a `REG_DWORD` from `HKCU\{key}`.
pub fn current_user_dword(key: &str, value: &str) -> Option<u32> {
    with_key(HKEY_CURRENT_USER, key, 0, |handle| {
        read_dword(handle, value)
    })
}

/// Reads a `REG_DWORD` from the 64-bit view of `HKLM\{key}`, so a 32-bit process sees the same
/// value a 64-bit one does.
pub fn local_machine_dword(key: &str, value: &str) -> Option<u32> {
    with_key(HKEY_LOCAL_MACHINE, key, KEY_WOW64_64KEY, |handle| {
        read_dword(handle, value)
    })
}

fn read_dword(handle: HKEY, value: &str) -> Option<u32> {
    unsafe {
        let mut data: DWORD = 0;
        let mut size = size_of::<DWORD>() as DWORD;
        let mut kind: DWORD = 0;
        let result = RegQueryValueExW(
            handle,
            winapi_str(value).as_ptr(),
            std::ptr::null_mut(),
            &mut kind,
            &mut data as *mut DWORD as *mut u8,
            &mut size,
        );
        if result as u32 != ERROR_SUCCESS || kind != REG_DWORD {
            return None;
        }
        Some(data)
    }
}

/// Reads a `REG_SZ` from `HKCU\{key}`.
pub fn current_user_string(key: &str, value: &str) -> Option<String> {
    with_key(HKEY_CURRENT_USER, key, 0, |handle| unsafe {
        let value = winapi_str(value);
        // Ask for the size first; registry strings have no useful upper bound to assume.
        let mut size: DWORD = 0;
        let mut kind: DWORD = 0;
        let result = RegQueryValueExW(
            handle,
            value.as_ptr(),
            std::ptr::null_mut(),
            &mut kind,
            std::ptr::null_mut(),
            &mut size,
        );
        if result as u32 != ERROR_SUCCESS || kind != REG_SZ || size == 0 {
            return None;
        }

        // `size` is bytes, and the value may or may not include its terminating null.
        let mut buffer = vec![0u16; size.div_ceil(2) as usize + 1];
        let mut size = (buffer.len() * 2) as DWORD;
        let result = RegQueryValueExW(
            handle,
            value.as_ptr(),
            std::ptr::null_mut(),
            std::ptr::null_mut(),
            buffer.as_mut_ptr() as *mut u8,
            &mut size,
        );
        if result as u32 != ERROR_SUCCESS {
            return None;
        }
        os_string_from_winapi_with_nul(&buffer)
            .into_string()
            .ok()
            .filter(|string| !string.is_empty())
    })
}

fn with_key<T>(
    root: HKEY,
    key: &str,
    extra_access: u32,
    read: impl FnOnce(HKEY) -> Option<T>,
) -> Option<T> {
    unsafe {
        let mut handle: HKEY = std::ptr::null_mut();
        let result = RegOpenKeyExW(
            root,
            winapi_str(key).as_ptr(),
            0,
            KEY_READ | extra_access,
            &mut handle,
        );
        if result as u32 != ERROR_SUCCESS {
            return None;
        }
        defer! {
            RegCloseKey(handle);
        }
        read(handle)
    }
}
