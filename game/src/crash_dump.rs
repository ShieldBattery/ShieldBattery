use std::ffi::CStr;
use std::io;
use std::mem;
use std::path::Path;
use std::ptr::null_mut;

use libc::c_void;
use scopeguard::defer;
use winapi::um::errhandlingapi::SetUnhandledExceptionFilter;
use winapi::um::fileapi::{CreateFileW, CREATE_ALWAYS};
use winapi::um::handleapi::{CloseHandle, INVALID_HANDLE_VALUE};
use winapi::um::processthreadsapi::{
    GetCurrentProcess, GetCurrentProcessId, GetCurrentThreadId, TerminateProcess,
};
use winapi::um::winnt::{EXCEPTION_POINTERS, FILE_ATTRIBUTE_NORMAL, GENERIC_WRITE, HANDLE};

use crate::bw_scr::Thiscall;
use crate::windows;

/// Initializes our own crash handler and patches over
/// SetUnhandledExceptionFilter so that nobody can override it.
pub unsafe fn init_crash_handler() {
    SetUnhandledExceptionFilter(Some(exception_handler));
    let kernel32 = windows::load_library("kernel32").unwrap();
    let address = kernel32
        .proc_address("SetUnhandledExceptionFilter")
        .unwrap();
    let mut patcher = crate::PATCHER.lock();
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

#[repr(C)]
struct CppException {
    vtable: *const CppExceptionVtable,
}

#[repr(C)]
struct CppExceptionVtable {
    delete: Thiscall<unsafe extern "C" fn(*mut CppException)>,
    message: Thiscall<unsafe extern "C" fn(*mut CppException) -> *const i8>,
}

unsafe fn crash_dump_and_exit(exception: *mut EXCEPTION_POINTERS) -> ! {
    assert!(!exception.is_null());
    // TODO
    let place = (*(*exception).ContextRecord).Eip;
    let exception_record = (*exception).ExceptionRecord;
    let exception_code = (*exception_record).ExceptionCode;
    let mut message = format!("Crash @ {:08x}\nException {:08x}", place, exception_code);
    if exception_code == 0xe06d7363 {
        // Execute C++ exception message() function.
        // If this crashes then it's unfortunate though..
        let cpp_exception = (*exception_record).ExceptionInformation[1] as *mut CppException;
        if !cpp_exception.is_null() {
            let vtable = (*cpp_exception).vtable;
            if !vtable.is_null() {
                let cpp_message = (*vtable).message.call1(cpp_exception);
                if !cpp_message.is_null() {
                    let msg = CStr::from_ptr(cpp_message);
                    message = format!(
                        "{}\nC++ exception message: '{}'",
                        message,
                        msg.to_string_lossy(),
                    );
                }
            }
        }
    }

    if let Err(e) = write_minidump_to_default_path(exception) {
        message = format!("{}\nCouldn't write dump: {}", message, e);
    }

    error!("{}", message);
    windows::message_box("Shieldbattery crash :(", &message);
    TerminateProcess(GetCurrentProcess(), exception_code);
    #[allow(clippy::empty_loop)] // This just runs until the process terminates from the above call
    loop {}
}

/// The exception is allowed to be null, in which case it'll just write a minidump
/// without an exception.
/// Note that MiniDumpWriteDump does not (usually?) produce correct call stack for the
/// current thread; in most cases where you don't have an exception you'll likely want
/// to start a helper thread that calls this function, so that the actual thread's state gets
/// dumped correctly.
pub unsafe fn write_minidump_to_default_path(
    exception: *mut EXCEPTION_POINTERS,
) -> Result<(), io::Error> {
    let args = crate::parse_args();
    let minidump_path = args.user_data_path.join("logs/latest_crash.dmp");
    write_minidump(&minidump_path, exception)
}

/// The exception is allowed to be null.
unsafe fn write_minidump(path: &Path, exception: *mut EXCEPTION_POINTERS) -> Result<(), io::Error> {
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
    defer!({
        CloseHandle(file);
    });

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

unsafe fn load_minidump_write_dump() -> Result<
    unsafe extern "system" fn(
        HANDLE,
        u32,
        HANDLE,
        u32,
        *mut MinidumpExceptionInfo,
        *mut c_void,
        *mut c_void,
    ) -> u32,
    io::Error,
> {
    let dbghelp = windows::load_library("dbghelp")?;
    let func = dbghelp.proc_address("MiniDumpWriteDump")?;
    mem::forget(dbghelp);
    Ok(mem::transmute(func))
}
