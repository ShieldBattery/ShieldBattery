pub mod version;

use std::ffi::{OsStr, OsString};
use std::io;
use std::mem;
use std::os::windows::ffi::{OsStrExt, OsStringExt};
use std::ptr::null_mut;

use libc::c_void;

use scopeguard::defer;
use winapi::shared::minwindef::{FARPROC, HMODULE};
use winapi::um::handleapi::{CloseHandle, DuplicateHandle};
use winapi::um::libloaderapi::{FreeLibrary, GetModuleFileNameW, GetModuleHandleExW};
use winapi::um::winnt::HANDLE;
use winapi::um::winuser::MessageBoxW;

/// Convert a rust string to a winapi-usable 0-terminated unicode u16 Vec
pub fn winapi_str<T: AsRef<OsStr>>(input: T) -> Vec<u16> {
    let mut buf = Vec::with_capacity(input.as_ref().len());
    buf.extend(input.as_ref().encode_wide());
    buf.push(0);
    buf
}

// If the conversion was lossy, returns Err(lossy_result)
pub fn ansi_codepage_cstring<T: AsRef<OsStr>>(input: T) -> Result<Vec<u8>, Vec<u8>> {
    use winapi::um::stringapiset::WideCharToMultiByte;
    use winapi::um::winnls::CP_ACP;

    unsafe {
        let os_str = input.as_ref();
        let unicode = winapi_str(os_str);
        let length = WideCharToMultiByte(
            CP_ACP,
            0,
            unicode.as_ptr(),
            unicode.len() as i32,
            null_mut(),
            0,
            null_mut(),
            null_mut(),
        );
        let mut buffer = vec![0u8; length as usize];
        let mut used_default_char = 0;
        WideCharToMultiByte(
            CP_ACP,
            0,
            unicode.as_ptr(),
            unicode.len() as i32,
            buffer.as_mut_ptr() as *mut i8,
            length,
            null_mut(),
            &mut used_default_char,
        );
        assert!(buffer[length as usize - 1] == 0);
        if used_default_char != 0 {
            warn!(
                "Couldn't losslessly convert '{}' to ANSI codepage",
                os_str.to_string_lossy()
            );
            Err(buffer)
        } else {
            Ok(buffer)
        }
    }
}

pub fn os_string_from_winapi(input: &[u16]) -> OsString {
    OsString::from_wide(input)
}

pub struct OwnedHandle(HANDLE);
unsafe impl Sync for OwnedHandle {} // Should be valid for all winapi handles..?
unsafe impl Send for OwnedHandle {} // Should be valid for all winapi handles..?

impl OwnedHandle {
    pub fn duplicate(handle: HANDLE) -> Result<OwnedHandle, io::Error> {
        use winapi::um::processthreadsapi::GetCurrentProcess;
        use winapi::um::winnt::DUPLICATE_SAME_ACCESS;

        unsafe {
            let current_process = GetCurrentProcess();
            let mut out = null_mut();
            let ok = DuplicateHandle(
                current_process,
                handle,
                current_process,
                &mut out,
                0,
                0,
                DUPLICATE_SAME_ACCESS,
            );
            if ok == 0 {
                Err(io::Error::last_os_error())
            } else {
                Ok(OwnedHandle(out))
            }
        }
    }

    pub fn get(&self) -> HANDLE {
        self.0
    }
}

impl Drop for OwnedHandle {
    fn drop(&mut self) {
        unsafe {
            CloseHandle(self.0);
        }
    }
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
    pub fn handle(&self) -> HMODULE {
        self.0
    }

    pub fn proc_address(&self, proc: &str) -> Result<FARPROC, io::Error> {
        use winapi::um::libloaderapi::GetProcAddress;
        unsafe {
            let string = match std::ffi::CString::new(proc) {
                Ok(o) => o,
                Err(_) => return Err(io::ErrorKind::InvalidInput.into()),
            };
            let result = GetProcAddress(self.0, string.as_ptr());
            if result.is_null() {
                Err(io::Error::last_os_error())
            } else {
                Ok(result)
            }
        }
    }

    pub fn proc_address_ordinal(&self, ordinal: u16) -> Result<FARPROC, io::Error> {
        use winapi::um::libloaderapi::GetProcAddress;
        unsafe {
            let result = GetProcAddress(self.0, ordinal as usize as *const i8);
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
    use winapi::um::winnt::PAGE_EXECUTE_READWRITE;
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

pub unsafe fn file_seek(file: *mut c_void, from: io::SeekFrom) -> Result<u64, io::Error> {
    use winapi::um::fileapi::SetFilePointerEx;
    use winapi::um::winbase::{FILE_BEGIN, FILE_CURRENT, FILE_END};

    let (pos, method) = match from {
        io::SeekFrom::Start(s) => (s as i64, FILE_BEGIN),
        io::SeekFrom::End(s) => (s, FILE_END),
        io::SeekFrom::Current(s) => (s, FILE_CURRENT),
    };
    let mut result = 0u64;
    let ok = SetFilePointerEx(
        file as *mut _,
        mem::transmute(pos),
        &mut result as *mut u64 as *mut _,
        method,
    );
    match ok {
        0 => Err(io::Error::last_os_error()),
        _ => Ok(result),
    }
}

pub unsafe fn file_read(file: *mut c_void, out: &mut [u8]) -> Result<(), io::Error> {
    use winapi::um::fileapi::ReadFile;

    let mut read = 0u32;
    let ok = ReadFile(
        file as *mut _,
        out.as_mut_ptr() as *mut _,
        out.len() as u32,
        &mut read,
        null_mut(),
    );
    match ok {
        0 => Err(io::Error::last_os_error()),
        _ if read != out.len() as u32 => {
            Err(io::Error::new(io::ErrorKind::Other, "Failed to read everything"))
        }
        _ => Ok(()),
    }
}

pub unsafe fn file_write(file: *mut c_void, data: &[u8]) -> Result<(), io::Error> {
    use winapi::um::fileapi::WriteFile;

    let mut written = 0u32;
    let ok = WriteFile(
        file as *mut _,
        data.as_ptr() as *const _,
        data.len() as u32,
        &mut written,
        null_mut(),
    );
    match ok {
        0 => Err(io::Error::last_os_error()),
        _ if written != data.len() as u32 => {
            Err(io::Error::new(io::ErrorKind::Other, "Failed to write everything"))
        }
        _ => Ok(()),
    }
}
