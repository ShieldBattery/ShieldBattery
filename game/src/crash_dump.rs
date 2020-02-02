use std::io;
use std::mem;
use std::path::Path;
use std::ptr::null_mut;

use libc::c_void;
use scopeguard::defer;
use winapi::um::errhandlingapi::{SetUnhandledExceptionFilter};
use winapi::um::fileapi::{CreateFileW, CREATE_ALWAYS};
use winapi::um::handleapi::{CloseHandle, INVALID_HANDLE_VALUE};
use winapi::um::processthreadsapi::{
    GetCurrentProcess, GetCurrentThreadId, GetCurrentProcessId,
};
use winapi::um::winnt::{EXCEPTION_POINTERS, FILE_ATTRIBUTE_NORMAL, HANDLE, GENERIC_WRITE};

use crate::windows;

/// Initializes our own crash handler and patches over
/// SetUnhandledExceptionFilter so that nobody can override it.
pub unsafe fn init_crash_handler() {
    SetUnhandledExceptionFilter(Some(exception_handler));
    let kernel32 = windows::load_library("kernel32").unwrap();
    let address = kernel32.proc_address("SetUnhandledExceptionFilter").unwrap();
    let mut patcher = crate::PATCHER.lock().unwrap();
    let mut patcher = patcher.patch_library("kernel32", 0);
    patcher.hook_closure_address(
        SetUnhandledExceptionFilterDecl,
        |_new, _orig| null_mut(),
        address as usize - kernel32.handle() as usize,
    );
}

whack_hooks!(stdcall, 0,
    !0 => SetUnhandledExceptionFilterDecl(*mut c_void) -> *mut c_void;
);

unsafe extern "system" fn exception_handler(exception: *mut EXCEPTION_POINTERS) -> i32 {
    crash_dump_and_exit(exception);
}

pub unsafe extern "C" fn cdecl_crash_dump(exception: *mut EXCEPTION_POINTERS) -> ! {
    crash_dump_and_exit(exception);
}

unsafe fn crash_dump_and_exit(exception: *mut EXCEPTION_POINTERS) -> ! {
    // TODO
    let args = crate::parse_args();
    let minidump_path = args.user_data_path.join("logs/latest_crash.dmp");
    let place = (*(*exception).ContextRecord).Eip;
    if let Err(e) = write_minidump(&minidump_path, exception) {
        panic!("Crash @ {:08x}, couldn't write dump: {}", place, e);
    };
    panic!("Crash @ {:08x}", place);
}

unsafe fn write_minidump(
    path: &Path,
    exception: *mut EXCEPTION_POINTERS,
) -> Result<(), io::Error> {
    let file = CreateFileW(
        windows::winapi_str(path).as_ptr(),
        GENERIC_WRITE,
        0,
        null_mut(),
        CREATE_ALWAYS,
        FILE_ATTRIBUTE_NORMAL,
        null_mut(),
    );
    if file == INVALID_HANDLE_VALUE {
        return Err(io::Error::last_os_error());
    }
    defer!({ CloseHandle(file); });

    let mut exception_param = MinidumpExceptionInfo {
        thread_id: GetCurrentThreadId(),
        exception,
        client_pointers: 0,
    };
    let minidump_write_dump = load_minidump_write_dump()?;
    let ok = minidump_write_dump(
        GetCurrentProcess(),
        GetCurrentProcessId(),
        file,
        1, // MiniDumpWithDataSegs
        &mut exception_param,
        null_mut(),
        null_mut(),
    );
    if ok == 0 {
        Err(io::Error::last_os_error())
    } else {
        Ok(())
    }
}

#[repr(C)]
struct MinidumpExceptionInfo {
    thread_id: u32,
    exception: *mut EXCEPTION_POINTERS,
    client_pointers: u32,
}

unsafe fn load_minidump_write_dump() -> Result<unsafe extern "system" fn(
    HANDLE,
    u32,
    HANDLE,
    u32,
    *mut MinidumpExceptionInfo,
    *mut c_void,
    *mut c_void,
) -> u32, io::Error> {
    let dbghelp = windows::load_library("dbghelp")?;
    let func = dbghelp.proc_address("MiniDumpWriteDump")?;
    mem::forget(dbghelp);
    Ok(mem::transmute(func))
}
