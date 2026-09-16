//! Crash handling for the injected DLL.
//!
//! The process-wide unhandled exception filter runs on whichever thread faulted, and that thread
//! may have almost no stack left (stack overflow) or a corrupted heap. Anything that formats,
//! allocates, loads libraries or calls MiniDumpWriteDump on it risks a second fault inside the
//! filter, which Windows answers by terminating the process with no dump at all. So the faulting
//! thread does as little as possible: it records the exception pointers, writes a fixed-size
//! breadcrumb straight to the log file, wakes a dump thread that was started (with everything it
//! needs pre-resolved) at DLL init, and parks itself so the exception pointers on its stack stay
//! valid while the dump thread writes the minidump on its own healthy stack.

use std::ffi::CStr;
use std::fmt::{self, Write};
use std::fs::File;
use std::io;
use std::mem;
use std::os::windows::io::IntoRawHandle;
use std::path::PathBuf;
use std::ptr::null_mut;
use std::sync::OnceLock;
use std::sync::atomic::{AtomicPtr, AtomicU32, AtomicUsize, Ordering};
use std::time::Duration;

use libc::c_void;
use scopeguard::defer;
use winapi::shared::minwindef::FARPROC;
use winapi::um::errhandlingapi::{
    AddVectoredExceptionHandler, GetLastError, SetUnhandledExceptionFilter,
};
use winapi::um::fileapi::{CREATE_ALWAYS, CreateFileW, WriteFile};
use winapi::um::handleapi::{CloseHandle, INVALID_HANDLE_VALUE};
use winapi::um::memoryapi::VirtualQuery;
use winapi::um::processthreadsapi::{
    GetCurrentProcess, GetCurrentProcessId, GetCurrentThreadId, SetThreadStackGuarantee,
    TerminateProcess,
};
use winapi::um::synchapi::{CreateEventW, SetEvent, WaitForSingleObject};
use winapi::um::tlhelp32::MODULEENTRY32W;
use winapi::um::winbase::{INFINITE, WAIT_OBJECT_0};
use winapi::um::winnt::{
    EXCEPTION_POINTERS, FILE_ATTRIBUTE_NORMAL, GENERIC_WRITE, HANDLE, MEMORY_BASIC_INFORMATION,
    PAGE_EXECUTE_READ, PAGE_EXECUTE_READWRITE, PAGE_READONLY, PAGE_READWRITE, PAGE_WRITECOPY,
};
use winapi::vc::excpt::EXCEPTION_CONTINUE_SEARCH;

use crate::bw_scr::Thiscall;
use crate::windows;

/// Stack reserved for exception handling on threads that call
/// `reserve_exception_handler_stack`. Only the exception dispatcher, the top-level filter and
/// the hand-off to the dump thread need to fit; the dump itself is written elsewhere.
const HANDLER_STACK_GUARANTEE: u32 = 64 * 1024;
/// How long the faulting thread waits for the dump thread before giving up and terminating.
const DUMP_WAIT_MS: u32 = 60_000;
const MINIDUMP_WITH_DATA_SEGS: u32 = 1;
const CPP_EXCEPTION_CODE: u32 = 0xe06d7363;

/// Thread whose exception is currently being handled (0 = no crash yet). Only the first crashing
/// thread gets to write a dump; anything else that faults afterwards just waits to be killed.
static CRASHING_THREAD: AtomicU32 = AtomicU32::new(0);
static INITIAL_EXCEPTION: AtomicPtr<EXCEPTION_POINTERS> = AtomicPtr::new(null_mut());
/// Thread id of the pre-spawned dump thread, 0 if it isn't running (then the faulting thread has
/// to write the dump itself).
static DUMP_THREAD: AtomicU32 = AtomicU32::new(0);
/// Auto-reset events (as HANDLE): the faulting thread signals `DUMP_REQUEST` once the exception
/// is recorded, the dump thread signals `DUMP_DONE` once the dump file is on disk (or has failed).
static DUMP_REQUEST: AtomicUsize = AtomicUsize::new(0);
static DUMP_DONE: AtomicUsize = AtomicUsize::new(0);
/// Second handle to the log file, written with plain `WriteFile` from the crash path so that a
/// trace lands on disk even when the logger can't be used (no stack, held lock, broken heap).
static BREADCRUMB_FILE: AtomicUsize = AtomicUsize::new(0);

type MiniDumpWriteDumpFn = unsafe extern "system" fn(
    HANDLE,
    u32,
    HANDLE,
    u32,
    *mut MinidumpExceptionInfo,
    *mut c_void,
    *mut c_void,
) -> u32;

/// Everything the dump thread needs, resolved at init so the crash path does no library loading
/// or path building.
struct Prepared {
    minidump_write_dump: MiniDumpWriteDumpFn,
    dump_path: Vec<u16>,
}

static PREPARED: OnceLock<Prepared> = OnceLock::new();

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

/// Gives the crash path a handle to the log file. Must be a duplicate of the logger's own handle
/// (they share a file position, so breadcrumbs land after whatever the logger last flushed).
pub fn set_breadcrumb_file(file: File) {
    BREADCRUMB_FILE.store(file.into_raw_handle() as usize, Ordering::Release);
}

/// Resolves dbghelp and the dump path, and starts the thread that will write the minidump when
/// another thread crashes. If any of this fails the crash handler falls back to writing the dump
/// on the faulting thread, which works for ordinary faults but not for stack overflows.
pub fn start_dump_thread() {
    let prepared = match prepare() {
        Ok(p) => p,
        Err(e) => {
            error!("Crash dump thread not started, dumps will be written in-thread: {e}");
            return;
        }
    };
    if PREPARED.set(prepared).is_err() {
        error!("Crash dump thread already started");
        return;
    }
    let spawned = std::thread::Builder::new()
        .name("sb-crash-dump".into())
        // MiniDumpWriteDump walks every thread's stack and module list; give it plenty of room.
        .stack_size(4 * 1024 * 1024)
        .spawn(|| unsafe { dump_thread_main() });
    if let Err(e) = spawned {
        error!("Couldn't spawn crash dump thread, dumps will be written in-thread: {e}");
    }
}

fn prepare() -> Result<Prepared, io::Error> {
    unsafe {
        let minidump_write_dump = load_minidump_write_dump()?;
        let dump_path = windows::winapi_str(logs_dir().join("latest_crash.dmp"));
        let request = CreateEventW(null_mut(), 0, 0, null_mut());
        if request.is_null() {
            return Err(io::Error::last_os_error());
        }
        let done = CreateEventW(null_mut(), 0, 0, null_mut());
        if done.is_null() {
            let err = io::Error::last_os_error();
            CloseHandle(request);
            return Err(err);
        }
        DUMP_REQUEST.store(request as usize, Ordering::Release);
        DUMP_DONE.store(done as usize, Ordering::Release);
        Ok(Prepared {
            minidump_write_dump,
            dump_path,
        })
    }
}

/// Reserves stack on the calling thread for exception handling, so that a stack overflow on it
/// still leaves room to reach the crash handler. Has to be called on each thread separately.
pub fn reserve_exception_handler_stack() {
    let mut size = HANDLER_STACK_GUARANTEE;
    unsafe {
        if SetThreadStackGuarantee(&mut size) == 0 {
            let err = GetLastError();
            debug!("SetThreadStackGuarantee failed: {err:x}");
        }
    }
}

/// Fixed-capacity, truncating text buffer so the crash path can format without the heap.
struct StackBuf<const N: usize> {
    buf: [u8; N],
    len: usize,
}

impl<const N: usize> StackBuf<N> {
    fn new() -> Self {
        StackBuf {
            buf: [0; N],
            len: 0,
        }
    }

    fn as_bytes(&self) -> &[u8] {
        &self.buf[..self.len]
    }
}

impl<const N: usize> fmt::Write for StackBuf<N> {
    fn write_str(&mut self, s: &str) -> fmt::Result {
        let room = N - self.len;
        let take = s.len().min(room);
        self.buf[self.len..self.len + take].copy_from_slice(&s.as_bytes()[..take]);
        self.len += take;
        Ok(())
    }
}

/// Writes one `[CRASH] ...` line to the log file without touching the logger or the heap.
/// Integer/`&str` arguments only; anything whose `Display` allocates defeats the purpose.
fn breadcrumb(args: fmt::Arguments<'_>) {
    let handle = BREADCRUMB_FILE.load(Ordering::Acquire);
    if handle == 0 {
        return;
    }
    let mut buf = StackBuf::<512>::new();
    let _ = buf.write_str("[CRASH] ");
    let _ = buf.write_fmt(args);
    let _ = buf.write_str("\n");
    unsafe {
        let mut written = 0u32;
        WriteFile(
            handle as HANDLE,
            buf.as_bytes().as_ptr() as *const _,
            buf.len as u32,
            &mut written,
            null_mut(),
        );
    }
}

macro_rules! breadcrumb {
    ($($arg:tt)*) => {
        breadcrumb(format_args!($($arg)*))
    };
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

unsafe fn exception_place(exception: *mut EXCEPTION_POINTERS) -> usize {
    unsafe {
        #[cfg(target_arch = "x86")]
        let place = (*(*exception).ContextRecord).Eip;
        #[cfg(target_arch = "x86_64")]
        let place = (*(*exception).ContextRecord).Rip;
        place as usize
    }
}

unsafe fn exception_code(exception: *mut EXCEPTION_POINTERS) -> u32 {
    unsafe { (*(*exception).ExceptionRecord).ExceptionCode }
}

/// The thread that is (or will be) writing the dump: the dump thread when it is running,
/// otherwise the crashing thread itself.
fn dump_writer_thread() -> u32 {
    match DUMP_THREAD.load(Ordering::Acquire) {
        0 => CRASHING_THREAD.load(Ordering::Acquire),
        thread => thread,
    }
}

/// Vectored handler installed once a crash is being handled, to notice the dump writing itself
/// faulting and salvage what it can.
unsafe extern "system" fn crash_dump_exception_handler(exception: *mut EXCEPTION_POINTERS) -> i32 {
    unsafe {
        let place = exception_place(exception);
        let code = exception_code(exception);
        let thread_id = GetCurrentThreadId();

        breadcrumb!(
            "VEH exception handler on thread {thread_id:x} @ {place:08x}, exception {code:08x}"
        );
        if dump_writer_thread() != thread_id {
            // Other thread than crash dump thread, probably just better to let them continue
            // and hope that they handle whatever exception this is.
            // This could be some helper thread that minidump writing uses, so better to let it
            // keep going? I don't think minidump writing spawns any threads but just in case.
            //
            // But sleep a bit first to reduce amount of things happening.
            std::thread::sleep(Duration::new(1, 0));
            return EXCEPTION_CONTINUE_SEARCH;
        }
        // Thread writing crash dump crashed. ugh.
        // Try to get some information out if we can't get the crash dump
        breadcrumb!("Crashed on crash dump thread, trying to write stack pages...");
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

/// Ends the process with `exit_code`. Never returns, even if termination is somehow delayed.
unsafe fn terminate(exit_code: u32) -> ! {
    unsafe {
        TerminateProcess(GetCurrentProcess(), exit_code);
    }
    loop {
        std::thread::sleep(Duration::from_secs(3600));
    }
}

unsafe fn wait_then_terminate(exception_code: u32) -> ! {
    std::thread::sleep(Duration::new(20, 0));
    let thread_id = unsafe { GetCurrentThreadId() };
    breadcrumb!("Thread {thread_id:x} will kill the process after waiting 20 seconds");
    unsafe { terminate(exception_code) }
}

unsafe fn crash_dump_and_exit(exception: *mut EXCEPTION_POINTERS) -> ! {
    unsafe {
        assert!(!exception.is_null());
        let place = exception_place(exception);
        let code = exception_code(exception);
        let thread_id = GetCurrentThreadId();

        if let Err(other) =
            CRASHING_THREAD.compare_exchange(0, thread_id, Ordering::AcqRel, Ordering::Acquire)
        {
            breadcrumb!(
                "Thread {thread_id:x} crashed @ {place:08x} (exception {code:08x}) while the \
                 crash on thread {other:x} is being handled"
            );
            // Hoping that the other thread kills the process, but if it makes no progress in
            // 20 sec then just die
            wait_then_terminate(code);
        }
        INITIAL_EXCEPTION.store(exception, Ordering::Release);

        // The one line that must make it to disk, before anything that could fault again.
        breadcrumb!("Thread {thread_id:x} crashed @ {place:08x}, exception {code:08x}");

        AddVectoredExceptionHandler(1, Some(crash_dump_exception_handler));

        if DUMP_THREAD.load(Ordering::Acquire) != 0 {
            SetEvent(DUMP_REQUEST.load(Ordering::Acquire) as HANDLE);
            let done = DUMP_DONE.load(Ordering::Acquire) as HANDLE;
            if WaitForSingleObject(done, DUMP_WAIT_MS) == WAIT_OBJECT_0 {
                // The dump thread owns the rest of the crash (message box, termination). Stay
                // parked so `exception` (which lives on this stack) remains valid meanwhile.
                loop {
                    std::thread::sleep(Duration::from_secs(3600));
                }
            }
            breadcrumb!("Dump thread made no progress in {DUMP_WAIT_MS} ms, terminating");
            terminate(code);
        }

        // No dump thread to hand off to (crashed before it was started, or it failed to start):
        // do everything on this thread and hope it has the stack and heap for it.
        error!("Crash @ {place:08x} thread {thread_id:x}\nException {code:08x}");
        let mut message = format!("Crash @ {place:08x} thread {thread_id:x}\nException {code:08x}");
        if let Some(cpp_message) = cpp_exception_message(exception) {
            message = format!("{message}\nC++ exception message: '{cpp_message}'");
        }
        if let Err(e) = write_minidump_to_default_path(exception) {
            error!("Couldn't write dump: {e}");
            message = format!("{message}\nCouldn't write dump: {e}");
        }
        finish_crash(&message, code);
    }
}

/// Body of the pre-spawned dump thread: waits for a crash, writes the dump for the crashing
/// thread, then shows the crash dialog and ends the process.
unsafe fn dump_thread_main() {
    unsafe {
        reserve_exception_handler_stack();
        let request = DUMP_REQUEST.load(Ordering::Acquire) as HANDLE;
        let done = DUMP_DONE.load(Ordering::Acquire) as HANDLE;
        DUMP_THREAD.store(GetCurrentThreadId(), Ordering::Release);

        if WaitForSingleObject(request, INFINITE) != WAIT_OBJECT_0 {
            let err = GetLastError();
            // Nothing sensible to do but hand crash handling back to the faulting threads.
            DUMP_THREAD.store(0, Ordering::Release);
            error!("Crash dump thread failed to wait for a crash: {err:x}");
            return;
        }

        let exception = INITIAL_EXCEPTION.load(Ordering::Acquire);
        let crashing_thread = CRASHING_THREAD.load(Ordering::Acquire);
        let place = exception_place(exception);
        let code = exception_code(exception);
        breadcrumb!("Writing latest_crash.dmp for thread {crashing_thread:x}");
        let prepared = PREPARED
            .get()
            .expect("dump thread started without preparation");
        let result = write_minidump(
            prepared.minidump_write_dump,
            &prepared.dump_path,
            exception,
            crashing_thread,
        );
        match &result {
            Ok(()) => breadcrumb!("latest_crash.dmp written"),
            Err(e) => breadcrumb!(
                "Couldn't write latest_crash.dmp, os error {:?}",
                e.raw_os_error()
            ),
        }
        SetEvent(done);

        // The dump is on disk (or has failed); everything below is best effort and may use the
        // heap and the normal logger.
        let mut message =
            format!("Crash @ {place:08x} thread {crashing_thread:x}\nException {code:08x}");
        error!("{message}");
        if let Some(cpp_message) = cpp_exception_message(exception) {
            message = format!("{message}\nC++ exception message: '{cpp_message}'");
        }
        if let Err(e) = result {
            error!("Couldn't write dump: {e}");
            message = format!("{message}\nCouldn't write dump: {e}");
        }
        finish_crash(&message, code);
    }
}

/// Runs the C++ exception object's message() for a MSVC C++ exception. This calls into game code
/// from a crashing process, so it's only done after the dump has been attempted.
unsafe fn cpp_exception_message(exception: *mut EXCEPTION_POINTERS) -> Option<String> {
    unsafe {
        if exception_code(exception) != CPP_EXCEPTION_CODE {
            return None;
        }
        let exception_record = (*exception).ExceptionRecord;
        let cpp_exception = (*exception_record).ExceptionInformation[1] as *mut CppException;
        if cpp_exception.is_null() {
            return None;
        }
        let vtable = (*cpp_exception).vtable;
        if vtable.is_null() {
            return None;
        }
        let cpp_message = (*vtable).message.call1(cpp_exception);
        if cpp_message.is_null() {
            return None;
        }
        let msg = CStr::from_ptr(cpp_message).to_string_lossy().into_owned();
        error!("C++ exception message: '{msg}'");
        Some(msg)
    }
}

unsafe fn finish_crash(message: &str, exception_code: u32) -> ! {
    windows::message_box(
        "Shieldbattery crash :(",
        &format!("{message}\nPlease submit a bug report in the launcher."),
    );
    unsafe { terminate(exception_code) }
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
        let thread_id = GetCurrentThreadId();
        match PREPARED.get() {
            Some(prepared) => write_minidump(
                prepared.minidump_write_dump,
                &prepared.dump_path,
                exception,
                thread_id,
            ),
            None => {
                let minidump_write_dump = load_minidump_write_dump()?;
                let path = windows::winapi_str(logs_dir().join("latest_crash.dmp"));
                write_minidump(minidump_write_dump, &path, exception, thread_id)
            }
        }
    }
}

fn logs_dir() -> PathBuf {
    let args = crate::parse_args();
    args.user_data_path.join("logs")
}

/// Writes a minidump to `path` (nul-terminated UTF-16). `exception` may be null; otherwise it
/// must belong to `thread_id`, which is the thread the dump's exception stream will point at.
unsafe fn write_minidump(
    minidump_write_dump: MiniDumpWriteDumpFn,
    path: &[u16],
    exception: *mut EXCEPTION_POINTERS,
    thread_id: u32,
) -> Result<(), io::Error> {
    unsafe {
        let file = CreateFileW(
            path.as_ptr(),
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
            thread_id,
            exception,
            client_pointers: 0,
        };
        let ok = minidump_write_dump(
            GetCurrentProcess(),
            GetCurrentProcessId(),
            file,
            MINIDUMP_WITH_DATA_SEGS,
            &mut exception_param,
            null_mut(),
            null_mut(),
        );
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

unsafe fn load_minidump_write_dump() -> Result<MiniDumpWriteDumpFn, io::Error> {
    unsafe {
        let dbghelp = windows::load_library("dbghelp")?;
        let func = dbghelp.proc_address("MiniDumpWriteDump")?;
        mem::forget(dbghelp);
        Ok(mem::transmute::<FARPROC, MiniDumpWriteDumpFn>(func))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn stack_buf_truncates_instead_of_overflowing() {
        let mut buf = StackBuf::<8>::new();
        let _ = write!(buf, "{:x}-way too long for this", 0xabcdu32);
        assert_eq!(buf.as_bytes(), b"abcd-way");
        let _ = buf.write_str("more");
        assert_eq!(buf.as_bytes(), b"abcd-way");
    }
}
