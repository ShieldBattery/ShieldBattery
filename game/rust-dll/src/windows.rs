use std::ffi::{OsStr, OsString};
use std::io;
use std::os::windows::ffi::{OsStrExt, OsStringExt};
use std::ptr::null_mut;

use libc::c_void;

use scopeguard::defer;
use winapi::shared::minwindef::{FARPROC, HMODULE};
use winapi::um::libloaderapi::{FreeLibrary, GetModuleFileNameW, GetModuleHandleExW};
use winapi::um::winuser::{MessageBoxW};

/// Convert a rust string to a winapi-usable 0-terminated unicode u16 Vec
pub fn winapi_str<T: AsRef<OsStr>>(input: T) -> Vec<u16> {
    let mut buf = Vec::with_capacity(input.as_ref().len());
    buf.extend(input.as_ref().encode_wide());
    buf.push(0);
    buf
}

pub fn os_string_from_winapi(input: &[u16]) -> OsString {
    OsString::from_wide(input)
}

pub fn module_from_address(address: *mut c_void) -> Option<(OsString, HMODULE)> {
    unsafe {
        let mut out = null_mut();
        let ok = GetModuleHandleExW(4, address as *const _, &mut out);
        if ok == 0 {
            return None;
        }
        defer!({
            FreeLibrary(out);
        });
        module_name(out).map(|name| (name, out))
    }
}

pub fn module_name(handle: HMODULE) -> Option<OsString> {
    unsafe {
        let mut buf_size = 128;
        let mut buf = Vec::with_capacity(buf_size);
        loop {
            let result = GetModuleFileNameW(handle, buf.as_mut_ptr(), buf_size as u32);
            match result {
                n if n == buf_size as u32 => {
                    // reserve does not guarantee to reserve exactly specified size,
                    // unline with_capacity
                    let reserve_amt = buf.capacity();
                    buf.reserve(reserve_amt);
                    buf_size = buf.capacity();
                }
                0 => {
                    // Error
                    return None;
                }
                n => {
                    let winapi_str = ::std::slice::from_raw_parts(buf.as_ptr(), n as usize);
                    return Some(os_string_from_winapi(winapi_str));
                }
            }
        }
    }
}

pub fn message_box(caption: &str, msg: &str) {
    unsafe {
        MessageBoxW(
            null_mut(),
            winapi_str(msg).as_ptr(),
            winapi_str(caption).as_ptr(),
            0,
        );
    }
}

pub fn load_library<T: AsRef<OsStr>>(name: T) -> Result<Library, io::Error> {
    use winapi::um::libloaderapi::LoadLibraryW;
    unsafe {
        let handle = LoadLibraryW(winapi_str(name).as_ptr());
        if handle.is_null() {
            Err(io::Error::last_os_error())
        } else {
            Ok(Library(handle))
        }
    }
}

#[derive(Eq, PartialEq)]
pub struct Library(HMODULE);

impl Library {
    pub fn proc_address(self, proc: &str) -> Result<FARPROC, io::Error> {
        use winapi::um::libloaderapi::GetProcAddress;
        unsafe {
            let string = match std::ffi::CString::new(proc) {
                Ok(o) => o,
                Err(e) => return Err(io::ErrorKind::InvalidInput.into()),
            };
            let result = GetProcAddress(self.0, string.as_ptr());
            if result.is_null() {
                Err(io::Error::last_os_error())
            } else {
                Ok(result)
            }
        }
    }
}

impl Drop for Library {
    fn drop(&mut self) {
        unsafe {
            FreeLibrary(self.0);
        }
    }
}

pub unsafe fn unprotect_memory(
    addr: *mut c_void,
    length: usize,
) -> Result<MemoryProtectionGuard, io::Error> {
    use winapi::um::memoryapi::VirtualProtect;
    use winapi::um::winnt::{PAGE_EXECUTE_READWRITE};
    let mut old = 0;
    let ok = VirtualProtect(addr as *mut _, length, PAGE_EXECUTE_READWRITE, &mut old);
    match ok {
        0 => Err(io::Error::last_os_error()),
        _ => Ok(MemoryProtectionGuard(addr, length, old)),
    }
}

#[must_use]
pub struct MemoryProtectionGuard(*mut c_void, usize, u32);

impl Drop for MemoryProtectionGuard {
    fn drop(&mut self) {
        use winapi::um::memoryapi::VirtualProtect;
        unsafe {
            let mut old = 0;
            let ok = VirtualProtect(self.0 as *mut _, self.1, self.2, &mut old);
            if ok == 0 {
                error!("Couldn't reprotect memory: {}", io::Error::last_os_error());
            }
        }
    }
}
