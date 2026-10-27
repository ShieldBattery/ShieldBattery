pub mod clipboard;
pub mod registry;
pub mod version;
pub mod wifi;

use std::ffi::{OsStr, OsString};
use std::io;
use std::mem;
use std::os::windows::ffi::{OsStrExt, OsStringExt};
use std::ptr::null_mut;

use libc::c_void;

use scopeguard::defer;
use winapi::shared::minwindef::{FARPROC, HMODULE};
use winapi::um::libloaderapi::{
    FreeLibrary, GetModuleFileNameW, GetModuleHandleExW, GetModuleHandleW,
};
use winapi::um::winuser::MessageBoxW;

/// Convert a rust string to a winapi-usable 0-terminated unicode u16 Vec
pub fn winapi_str<T: AsRef<OsStr>>(input: T) -> Vec<u16> {
    let mut buf = Vec::with_capacity(input.as_ref().len());
    buf.extend(input.as_ref().encode_wide());
    buf.push(0);
    buf
}

/// If there are null characters, or garbage after one in the string, they will
/// be also included in the result.
pub fn os_string_from_winapi(input: &[u16]) -> OsString {
    OsString::from_wide(input)
}

/// Truncates string to end at first 0 in `input`
pub fn os_string_from_winapi_with_nul(input: &[u16]) -> OsString {
    let end = input.iter().position(|&x| x == 0).unwrap_or(input.len());
    OsString::from_wide(&input[..end])
}

pub fn module_handle(name: &str) -> Option<HMODULE> {
    unsafe {
        let handle = GetModuleHandleW(winapi_str(name).as_ptr());
        if handle.is_null() { None } else { Some(handle) }
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
        let mut buf = vec![0u16; 128];
        loop {
            let result = GetModuleFileNameW(handle, buf.as_mut_ptr(), buf.len() as u32);
            match result {
                // The name was truncated to fit
                n if n as usize == buf.len() => {
                    let new_len = buf.len() * 2;
                    buf.resize(new_len, 0);
                }
                0 => {
                    // Error
                    return None;
                }
                n => {
                    return Some(os_string_from_winapi(&buf[..n as usize]));
                }
            }
        }
    }
}

/// Whether the calling thread has its implicit TLS array, which every `thread_local!` access
/// reads through.
///
/// ntdll's parallel loader maps DLLs on thread pool workers that skip loader initialization, so
/// those threads have no TLS array and any `thread_local!` access on them faults. They still call
/// hooked winapi functions: with software restriction or AppLocker policies active, the loader's
/// policy check opens files with CreateFileW for each DLL it maps.
pub fn thread_has_tls() -> bool {
    let tls_array: *mut c_void;
    // TEB::ThreadLocalStoragePointer
    unsafe {
        #[cfg(target_arch = "x86_64")]
        std::arch::asm!(
            "mov {}, gs:[0x58]",
            out(reg) tls_array,
            options(nostack, readonly, preserves_flags),
        );
        #[cfg(target_arch = "x86")]
        std::arch::asm!(
            "mov {}, fs:[0x2c]",
            out(reg) tls_array,
            options(nostack, readonly, preserves_flags),
        );
    }
    !tls_array.is_null()
}

/// Current time as a FILETIME value (100ns intervals since 1601-01-01 UTC), read without going
/// through `GetSystemTimePreciseAsFileTime`, which is hooked to hand SC:R a fake time.
///
/// `resolve_precise_system_time` must have been called for this to have sub-tick precision;
/// until then it falls back to the coarser `GetSystemTimeAsFileTime`.
pub fn precise_system_time() -> u64 {
    use std::sync::atomic::Ordering;
    use winapi::shared::minwindef::FILETIME;
    use winapi::um::sysinfoapi::GetSystemTimeAsFileTime;

    let func = RTL_GET_SYSTEM_TIME_PRECISE.load(Ordering::Acquire);
    unsafe {
        if func.is_null() {
            let mut time: FILETIME = mem::zeroed();
            GetSystemTimeAsFileTime(&mut time);
            ((time.dwHighDateTime as u64) << 32) | time.dwLowDateTime as u64
        } else {
            let func: unsafe extern "system" fn() -> i64 = mem::transmute(func);
            func() as u64
        }
    }
}

static RTL_GET_SYSTEM_TIME_PRECISE: std::sync::atomic::AtomicPtr<c_void> =
    std::sync::atomic::AtomicPtr::new(null_mut());

/// Looks up `ntdll!RtlGetSystemTimePrecise` for `precise_system_time`. Done ahead of time rather
/// than on first use, since the first use may be on a thread in the middle of loading a DLL, where
/// GetProcAddress can wait on that same load.
pub fn resolve_precise_system_time() {
    use std::sync::atomic::Ordering;
    // Failure goes unlogged, as logging isn't set up yet when this runs, and the fallback only
    // costs precision.
    if let Ok(func) =
        load_library("ntdll").and_then(|lib| lib.proc_address("RtlGetSystemTimePrecise"))
    {
        RTL_GET_SYSTEM_TIME_PRECISE.store(func as *mut c_void, Ordering::Release);
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
    use winapi::um::winnt::PAGE_EXECUTE_READWRITE;
    unsafe { set_memory_protection(addr, length, PAGE_EXECUTE_READWRITE) }
}

unsafe fn set_memory_protection(
    addr: *mut c_void,
    length: usize,
    protection: u32,
) -> Result<MemoryProtectionGuard, io::Error> {
    use winapi::um::memoryapi::VirtualProtect;
    let mut old = 0;
    let ok = unsafe { VirtualProtect(addr as *mut _, length, protection, &mut old) };
    match ok {
        0 => Err(io::Error::last_os_error()),
        _ => Ok(MemoryProtectionGuard(addr, length, old)),
    }
}

/// Describes the page containing `addr` (state, protection, type) for diagnostics, or the error
/// `VirtualQuery` returned.
#[cfg(debug_assertions)]
pub unsafe fn describe_page(addr: *const c_void) -> String {
    use winapi::um::memoryapi::VirtualQuery;
    use winapi::um::winnt::MEMORY_BASIC_INFORMATION;
    let mut info: MEMORY_BASIC_INFORMATION = unsafe { std::mem::zeroed() };
    let size = std::mem::size_of::<MEMORY_BASIC_INFORMATION>();
    let written = unsafe { VirtualQuery(addr as *const _, &mut info, size) };
    if written == 0 {
        return format!("VirtualQuery failed: {}", io::Error::last_os_error());
    }
    format!(
        "base {:p} size {:#x} state {:#x} protect {:#x} type {:#x}",
        info.BaseAddress, info.RegionSize, info.State, info.Protect, info.Type,
    )
}

/// Jumps made by [`jump_to`], keyed by the function each one jumps to.
static JUMPS: parking_lot::Mutex<Vec<(usize, usize)>> = parking_lot::Mutex::new(Vec::new());

/// An address outside this module that jumps to `function`, or `function` itself if no memory
/// could be made for one. For function pointers handed to code outside this module (method table
/// entries, window procedures): tools that hook graphics or input often patch the code such a
/// pointer leads to, and with the pointer leading here they patch this jump instead of this
/// module's code. Made once per function and never freed, since the pointer may be read at any time.
pub fn jump_to(function: usize) -> usize {
    use winapi::um::memoryapi::{VirtualAlloc, VirtualFree, VirtualProtect};
    use winapi::um::processthreadsapi::{FlushInstructionCache, GetCurrentProcess};
    use winapi::um::winnt::{
        MEM_COMMIT, MEM_RELEASE, MEM_RESERVE, PAGE_EXECUTE_READ, PAGE_READWRITE,
    };

    let mut jumps = JUMPS.lock();
    if let Some(&(_, jump)) = jumps.iter().find(|&&(target, _)| target == function) {
        return jump;
    }
    #[cfg(target_arch = "x86_64")]
    let code = {
        // mov rax, function; jmp rax
        let mut code = vec![0x48, 0xb8];
        code.extend_from_slice(&(function as u64).to_le_bytes());
        code.extend_from_slice(&[0xff, 0xe0]);
        code
    };
    #[cfg(target_arch = "x86")]
    let code = {
        // mov eax, function; jmp eax
        let mut code = vec![0xb8];
        code.extend_from_slice(&(function as u32).to_le_bytes());
        code.extend_from_slice(&[0xff, 0xe0]);
        code
    };
    let jump = unsafe {
        let memory = VirtualAlloc(
            null_mut(),
            code.len(),
            MEM_COMMIT | MEM_RESERVE,
            PAGE_READWRITE,
        );
        if memory.is_null() {
            return function;
        }
        std::ptr::copy_nonoverlapping(code.as_ptr(), memory.cast::<u8>(), code.len());
        let mut old_protection = 0;
        if VirtualProtect(memory, code.len(), PAGE_EXECUTE_READ, &mut old_protection) == 0 {
            VirtualFree(memory, 0, MEM_RELEASE);
            return function;
        }
        FlushInstructionCache(GetCurrentProcess(), memory, code.len());
        memory as usize
    };
    jumps.push((function, jump));
    jump
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
    let ok = unsafe {
        SetFilePointerEx(
            file as *mut _,
            mem::transmute(pos),
            &mut result as *mut u64 as *mut _,
            method,
        )
    };
    match ok {
        0 => Err(io::Error::last_os_error()),
        _ => Ok(result),
    }
}

pub unsafe fn file_read(file: *mut c_void, out: &mut [u8]) -> Result<(), io::Error> {
    use winapi::um::fileapi::ReadFile;

    let mut read = 0u32;
    let ok = unsafe {
        ReadFile(
            file as *mut _,
            out.as_mut_ptr() as *mut _,
            out.len() as u32,
            &mut read,
            null_mut(),
        )
    };
    match ok {
        0 => Err(io::Error::last_os_error()),
        _ if read != out.len() as u32 => Err(io::Error::other("Failed to read everything")),
        _ => Ok(()),
    }
}

pub unsafe fn file_write(file: *mut c_void, data: &[u8]) -> Result<(), io::Error> {
    use winapi::um::fileapi::WriteFile;

    let mut written = 0u32;
    let ok = unsafe {
        WriteFile(
            file as *mut _,
            data.as_ptr() as *const _,
            data.len() as u32,
            &mut written,
            null_mut(),
        )
    };
    match ok {
        0 => Err(io::Error::last_os_error()),
        _ if written != data.len() as u32 => Err(io::Error::other("Failed to write everything")),
        _ => Ok(()),
    }
}

#[cfg(test)]
mod test {
    use std::time::{Duration, SystemTime, UNIX_EPOCH};

    use super::*;

    #[test]
    fn ordinary_threads_have_tls() {
        assert!(thread_has_tls());
        assert!(std::thread::spawn(thread_has_tls).join().unwrap());
    }

    #[test]
    fn precise_system_time_is_current_time() {
        /// FILETIME of 1970-01-01 00:00:00 UTC.
        const UNIX_EPOCH_FILETIME: u64 = 116_444_736_000_000_000;
        let check = || {
            let filetime = precise_system_time();
            let now = SystemTime::now().duration_since(UNIX_EPOCH).unwrap();
            let since_epoch = Duration::from_nanos((filetime - UNIX_EPOCH_FILETIME) * 100);
            assert!(now.abs_diff(since_epoch) < Duration::from_secs(1));
        };
        // Both the fallback and the ntdll function.
        check();
        resolve_precise_system_time();
        assert!(
            !RTL_GET_SYSTEM_TIME_PRECISE
                .load(std::sync::atomic::Ordering::Acquire)
                .is_null()
        );
        check();
    }
}
