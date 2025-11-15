use std::ffi::CStr;
use std::fmt::Write;
use std::io;
use std::mem;
use std::path::{Path, PathBuf};
use std::ptr::null_mut;
use std::sync::atomic::{AtomicPtr, AtomicU32, Ordering};

use libc::c_void;
use scopeguard::defer;
use winapi::um::errhandlingapi::{
    AddVectoredExceptionHandler, GetLastError, SetUnhandledExceptionFilter,
};
use winapi::um::fileapi::{CREATE_ALWAYS, CreateFileW, WriteFile};
use winapi::um::handleapi::{CloseHandle, INVALID_HANDLE_VALUE};
use winapi::um::memoryapi::VirtualQuery;
use winapi::um::processthreadsapi::{
    GetCurrentProcess, GetCurrentProcessId, GetCurrentThreadId, TerminateProcess,
};
use winapi::um::tlhelp32::MODULEENTRY32W;
use winapi::um::winnt::{
    EXCEPTION_POINTERS, FILE_ATTRIBUTE_NORMAL, GENERIC_WRITE, HANDLE, MEMORY_BASIC_INFORMATION,
    PAGE_EXECUTE_READ, PAGE_EXECUTE_READWRITE, PAGE_READONLY, PAGE_READWRITE, PAGE_WRITECOPY,
};
use winapi::vc::excpt::EXCEPTION_CONTINUE_SEARCH;

use crate::bw_scr::Thiscall;
use crate::windows;

static CRASH_DUMP_THREAD: AtomicU32 = AtomicU32::new(0);
static INITIAL_EXCEPTION: AtomicPtr<EXCEPTION_POINTERS> = AtomicPtr::new(null_mut());

/// Initializes our own crash handler and patches over
/// SetUnhandledExceptionFilter so that nobody can override it.
pub unsafe fn init_crash_handler() {
    unsafe {
        use self::hooks::SetUnhandledExceptionFilterDecl;

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
}

mod hooks {
    system_hooks!(
        !0 => SetUnhandledExceptionFilterDecl(*mut libc::c_void) -> *mut libc::c_void;
    );
}

unsafe extern "system" fn exception_handler(exception: *mut EXCEPTION_POINTERS) -> i32 {
    unsafe {
        crash_dump_and_exit(exception);
    }
}

pub unsafe extern "C" fn cdecl_crash_dump(exception: *mut EXCEPTION_POINTERS) -> ! {
    unsafe {
        crash_dump_and_exit(exception);
    }
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

unsafe extern "system" fn crash_dump_exception_handler(exception: *mut EXCEPTION_POINTERS) -> i32 {
    #[cfg(target_arch = "x86")]
    let place = (*(*exception).ContextRecord).Eip;
    #[cfg(target_arch = "x86_64")]
    let place = (*(*exception).ContextRecord).Rip;
    let exception_record = (*exception).ExceptionRecord;
    let exception_code = (*exception_record).ExceptionCode;
    let thread_id = unsafe { GetCurrentThreadId() };

    error!("VEH exception handler on thread {thread_id:x}");
    let message = format!("VEH exception handler @ {place:08x}\nException {exception_code:08x}");

    error!("{message}");
    if CRASH_DUMP_THREAD.load(Ordering::Relaxed) != thread_id {
        // Other thread than crash dump thread, probably just better to let them continue
        // and hope that they handle whatever exception this is.
        // This could be some helper thread that minidump writing uses, so better to let it
        // keep going? I don't think minidump writing spawns any threads but just in case.
        //
        // But sleep a bit first to reduce amount of things happening.
        std::thread::sleep(std::time::Duration::new(1, 0));
        return EXCEPTION_CONTINUE_SEARCH;
    }
    // Thread writing crash dump crashed. ugh.
    // Try to get some information out if we can't get the crash dump
    error!("Crashed on crash dump thread, trying to write stack pages...");
    let init_exception = INITIAL_EXCEPTION.load(Ordering::Relaxed);
    write_stack(init_exception, "crash_stack.bin");
    error!("Trying to enumerate modules..");
    for module in enumerate_modules() {
        error!(
            "{:x}:{:x} {} {}",
            module.modBaseAddr as usize,
            module.modBaseSize,
            windows::os_string_from_winapi_with_nul(&module.szModule).display(),
            windows::os_string_from_winapi_with_nul(&module.szExePath).display(),
        );
    }
    // Maybe should just die here?
    EXCEPTION_CONTINUE_SEARCH
}

unsafe fn enumerate_modules() -> impl Iterator<Item = MODULEENTRY32W> {
    use winapi::um::tlhelp32::*;
    let process_id = GetCurrentProcessId();
    let handle = CreateToolhelp32Snapshot(TH32CS_SNAPMODULE, process_id);
    let mut next = None;
    if handle == INVALID_HANDLE_VALUE {
        let err = GetLastError();
        error!("CreateToolhelp32SnapShot failed: {err:x}");
    } else {
        let mut entry: MODULEENTRY32W = mem::zeroed();
        entry.dwSize = mem::size_of_val(&entry) as u32;
        let ok = Module32FirstW(handle, &mut entry);
        if ok != 0 {
            next = Some(entry);
        } else {
            let err = GetLastError();
            error!("Module32FirstW failed: {err:x}");
        }
    }

    std::iter::from_fn(move || {
        let val = next.take()?;
        let mut entry: MODULEENTRY32W = mem::zeroed();
        entry.dwSize = mem::size_of_val(&entry) as u32;
        let ok = Module32NextW(handle, &mut entry);
        if ok != 0 {
            next = Some(entry);
        }
        Some(val)
    })
}

fn is_read_ok_protect(protect: u32) -> bool {
    protect
        & (PAGE_READONLY
            | PAGE_READWRITE
            | PAGE_EXECUTE_READWRITE
            | PAGE_WRITECOPY
            | PAGE_EXECUTE_READ)
        != 0
}

unsafe fn write_stack(exception: *mut EXCEPTION_POINTERS, filename: &str) {
    #[cfg(target_arch = "x86")]
    let stack_pointer = (*(*exception).ContextRecord).Esp as *const u8;
    #[cfg(target_arch = "x86_64")]
    let stack_pointer = (*(*exception).ContextRecord).Rsp as *const u8;

    error!("Stack pointer {stack_pointer:p}");
    let page_size = 0x1000usize;
    let mut start = stack_pointer.map_addr(|x| x & !(page_size.wrapping_sub(1)));
    let mut buf: MEMORY_BASIC_INFORMATION = mem::zeroed();
    let ok = VirtualQuery(start as *const _, &mut buf, mem::size_of_val(&buf));
    if ok == 0 {
        let err = GetLastError();
        error!("VirtualQuery for stack pointer failed {err:x}");
    } else {
        let can_read = is_read_ok_protect(buf.Protect);
        if !can_read {
            error!("Stack pointer is not readable?? Protect {:x}", buf.Protect);
            return;
        }
        let mut end = buf.BaseAddress as usize + buf.RegionSize;

        // Write some bytes to log first
        let small_dump_len = 0x100;
        let small_dump_end =
            (stack_pointer.add(small_dump_len) as usize).min(end - 0x10) as *const u8;
        let mut pos = stack_pointer;
        let msg = &mut String::new();
        while pos < small_dump_end {
            msg.clear();
            let _ = write!(msg, "{:x}   ", pos as usize);
            for _ in 0..0x10 {
                if (pos as usize) < end {
                    let _ = write!(msg, " {:02x}", *pos);
                }
                pos = pos.add(1);
            }
            error!("{msg}");
        }

        // Write entire stack to a file
        let path = logs_dir().join(filename);
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
            let err = GetLastError();
            error!("Failed to create crash_stack.bin {err:x}");
            return;
        }
        error!("Writing stack to crash_stack.bin...");
        for _ in 0..0x10 {
            let mut written = 0u32;
            let ret = WriteFile(
                file,
                start as *const _,
                (end - start as usize) as u32,
                &mut written,
                null_mut(),
            );
            error!("WriteFile done; ret = {ret:x} written = {written:x}");

            start = end as *const _;
            let ok = VirtualQuery(start as *const _, &mut buf, mem::size_of_val(&buf));
            if ok == 0 || !is_read_ok_protect(buf.Protect) {
                break;
            }
            end = buf.BaseAddress as usize + buf.RegionSize;
        }
    }
}

unsafe fn wait_then_terminate(exception_code: u32) -> ! {
    std::thread::sleep(std::time::Duration::new(20, 0));
    let thread_id = unsafe { GetCurrentThreadId() };
    error!("Thread {thread_id:x} will kill the process after waiting 20 seconds");
    TerminateProcess(GetCurrentProcess(), exception_code);
    #[allow(clippy::empty_loop)]
    loop {}
}

unsafe fn crash_dump_and_exit(exception: *mut EXCEPTION_POINTERS) -> ! {
    unsafe {
        assert!(!exception.is_null());
        // TODO
        #[cfg(target_arch = "x86")]
        let place = (*(*exception).ContextRecord).Eip;
        #[cfg(target_arch = "x86_64")]
        let place = (*(*exception).ContextRecord).Rip;
        let exception_record = (*exception).ExceptionRecord;
        let exception_code = (*exception_record).ExceptionCode;
        let thread_id = GetCurrentThreadId();
        let mut message =
            format!("Crash @ {place:08x} thread {thread_id:x}\nException {exception_code:08x}");

        if let Err(other) =
            CRASH_DUMP_THREAD.compare_exchange(0, thread_id, Ordering::Relaxed, Ordering::Relaxed)
        {
            error!(
                "Crashed on thread {thread_id:x} while handling crash on thread {other:x}:\n{message}"
            );
            // Hoping that the other thread kills the process, but if it makes no progress in
            // 20 sec then just die
            wait_then_terminate(exception_code);
        }
        INITIAL_EXCEPTION.store(exception, Ordering::Relaxed);

        // Log the error before trying to do anything else, so that if this crashes for some
        // reason we at least get the memory address.
        error!("{message}");

        AddVectoredExceptionHandler(1, Some(crash_dump_exception_handler));
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
                        let msg = msg.to_string_lossy();
                        error!("C++ exception message: '{msg}'");
                        message = format!("{message}\nC++ exception message: '{msg}'");
                    }
                }
            }
        }

        if let Err(e) = write_minidump_to_default_path(exception) {
            error!("Couldn't write dump: {e}");
            message = format!("{message}\nCouldn't write dump: {e}");
        }

        message = format!("{message}\nPlease submit a bug report in the launcher.");
        windows::message_box("Shieldbattery crash :(", &message);
        TerminateProcess(GetCurrentProcess(), exception_code);
        #[allow(clippy::empty_loop)]
        // This just runs until the process terminates from the above call
        loop {}
    }
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
    unsafe {
        let minidump_path = logs_dir().join("latest_crash.dmp");
        write_minidump(&minidump_path, exception)
    }
}

fn logs_dir() -> PathBuf {
    let args = crate::parse_args();
    args.user_data_path.join("logs")
}

/// The exception is allowed to be null.
unsafe fn write_minidump(path: &Path, exception: *mut EXCEPTION_POINTERS) -> Result<(), io::Error> {
    unsafe {
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
        error!("Loading MiniDumpWriteDump...");
        let minidump_write_dump = load_minidump_write_dump()?;
        error!("Calling MiniDumpWriteDump...");
        let ok = minidump_write_dump(
            GetCurrentProcess(),
            GetCurrentProcessId(),
            file,
            1, // MiniDumpWithDataSegs
            &mut exception_param,
            null_mut(),
            null_mut(),
        );
        error!("MiniDumpWriteDump done, ret = {ok:x}");
        if ok == 0 {
            Err(io::Error::last_os_error())
        } else {
            // Remove old crash_stack.bin if such exists from older crash
            let path = logs_dir().join("crash_stack.bin");
            let _ = std::fs::remove_file(path);
            Ok(())
        }
    }
}

#[repr(C, packed(4))]
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
    unsafe {
        let dbghelp = windows::load_library("dbghelp")?;
        let func = dbghelp.proc_address("MiniDumpWriteDump")?;
        mem::forget(dbghelp);
        Ok(mem::transmute(func))
    }
}
