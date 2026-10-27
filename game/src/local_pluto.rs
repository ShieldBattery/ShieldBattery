//! Local-practice host for the pinned Win32 Pluto v2 companion ABI.
use std::cell::{Cell, RefCell};
use std::ffi::{CStr, c_void};
use std::mem;
use std::os::windows::ffi::OsStrExt;
use std::path::PathBuf;

use crate::bw_scr::BwScr;
use crate::windows;

#[repr(C)]
struct Host {
    size: u32,
    version: u32,
    user: *mut c_void,
    submit_packet: unsafe extern "C" fn(*mut c_void, *const u8, u32) -> i32,
    print_local: unsafe extern "C" fn(*mut c_void, *const i8),
    request_leave: unsafe extern "C" fn(*mut c_void),
}
#[repr(C)]
struct Config {
    size: u32,
    version: u32,
    bot_path: *const u16,
    log_path: *const u16,
}
#[repr(C)]
struct Frame {
    size: u32,
    version: u32,
    epoch: u32,
    frame: u32,
    local_player: u32,
    latency_frames: u32,
    flags: u32,
}
type Initialize = unsafe extern "C" fn(*const Host, *const Config) -> i32;
type Step = unsafe extern "C" fn(*const Frame) -> i32;
type End = unsafe extern "C" fn(u32, u32) -> i32;
type Shutdown = unsafe extern "C" fn() -> i32;
struct Companion {
    frame: Step,
    end: End,
    shutdown: Shutdown,
    running: bool,
    started: bool,
    resigned: bool,
}
thread_local! {
    static ATTEMPTED: Cell<bool> = const { Cell::new(false) };
    static LEAVE: Cell<bool> = const { Cell::new(false) };
    static COMPANION: RefCell<Option<Companion>> = const { RefCell::new(None) };
}

unsafe extern "C" fn submit(user: *mut c_void, data: *const u8, length: u32) -> i32 {
    if user.is_null() || data.is_null() || length == 0 || length > 512 || LEAVE.get() {
        return -2;
    }
    unsafe {
        (&*user.cast::<BwScr>())
            .local_pluto_packet(std::slice::from_raw_parts(data, length as usize))
    }
}
unsafe extern "C" fn print(user: *mut c_void, text: *const i8) {
    if !user.is_null() && !text.is_null() {
        unsafe { (&*user.cast::<BwScr>()).print_text(CStr::from_ptr(text)) };
    }
}
unsafe extern "C" fn leave(_: *mut c_void) {
    LEAVE.set(true);
}
fn context(bw: &BwScr) -> Option<Frame> {
    let (frame, local_player) = unsafe { bw.local_pluto_context()? };
    Some(Frame {
        size: size_of::<Frame>() as u32,
        version: 1,
        epoch: 1,
        frame,
        local_player,
        latency_frames: 2,
        flags: 3,
    })
}
fn load(bw: &'static BwScr, frame: &Frame) -> Result<Companion, String> {
    let setup = crate::game_thread::setup_info().ok_or("Local game setup missing")?;
    let bundle = setup
        .local_pluto
        .as_ref()
        .ok_or("Local Pluto handoff missing")?;
    let dll = PathBuf::from(&bundle.companion_path);
    let bot = PathBuf::from(&bundle.bot_path);
    let log = PathBuf::from(&bundle.log_path);
    let directory = PathBuf::from(&bundle.working_directory);
    if ![&dll, &bot, &log, &directory]
        .iter()
        .all(|p| p.is_absolute())
        || dll != directory.join("pluto-companion.dll")
        || bot != directory.join("pluto.dll")
        || log != directory.join("companion.log")
        || std::env::current_dir().map_err(|e| e.to_string())? != directory
        || bundle.companion_sha256.len() != 64
    {
        return Err("Invalid local Pluto bundle paths".into());
    }
    own_inference_processes()?;
    let library = windows::load_library(dll).map_err(|e| e.to_string())?;
    let proc = |name| library.proc_address(name).map_err(|e| e.to_string());
    let initialize: Initialize = unsafe { mem::transmute(proc("PlutoInitialize")?) };
    let start: Step = unsafe { mem::transmute(proc("PlutoMatchStart")?) };
    let step: Step = unsafe { mem::transmute(proc("PlutoFrame")?) };
    let end: End = unsafe { mem::transmute(proc("PlutoMatchEnd")?) };
    let shutdown: Shutdown = unsafe { mem::transmute(proc("PlutoShutdown")?) };
    let bot: Vec<u16> = bot.as_os_str().encode_wide().chain(Some(0)).collect();
    let log: Vec<u16> = log.as_os_str().encode_wide().chain(Some(0)).collect();
    let host = Host {
        size: size_of::<Host>() as u32,
        version: 1,
        user: std::ptr::from_ref(bw).cast_mut().cast(),
        submit_packet: submit,
        print_local: print,
        request_leave: leave,
    };
    let config = Config {
        size: size_of::<Config>() as u32,
        version: 1,
        bot_path: bot.as_ptr(),
        log_path: log.as_ptr(),
    };
    // The companion retains callbacks and binds bot operands into its own allocations.
    // Its module and the pointed-to host state must survive until process exit.
    mem::forget(library);
    let initialized = unsafe { initialize(&host, &config) };
    if initialized != 0 {
        return Err(format!("PlutoInitialize returned {initialized}"));
    }
    let started = unsafe { start(frame) };
    if started != 0 {
        unsafe { shutdown() };
        return Err(format!("PlutoMatchStart returned {started}"));
    }
    info!("Pluto v2 library companion started");
    Ok(Companion {
        frame: step,
        end,
        shutdown,
        running: true,
        started: true,
        resigned: false,
    })
}
pub(crate) fn before_step(bw: &'static BwScr) {
    if !crate::is_local_game()
        || !crate::game_thread::setup_info().is_some_and(|s| s.local_pluto.is_some())
        || crate::bwapi_instance().is_some()
        || ATTEMPTED.replace(true)
    {
        return;
    }
    let Some(frame) = context(bw).filter(|f| f.frame == 0) else {
        error!("Pluto v2 refused: initial frame/context unavailable");
        return;
    };
    match load(bw, &frame) {
        Ok(companion) => COMPANION.set(Some(companion)),
        Err(e) => error!("Pluto v2 initialization failed: {e}"),
    }
}
pub(crate) fn after_step(bw: &BwScr) {
    COMPANION.with_borrow_mut(|companion| {
        let Some(c) = companion.as_mut().filter(|c| c.running) else {
            return;
        };
        let Some(frame) = context(bw) else {
            c.running = false;
            error!("Pluto v2 stopped: local context lost");
            return;
        };
        let result = unsafe { (c.frame)(&frame) };
        if result == 2 {
            c.running = false;
            info!("Pluto v2 waiting for settled result");
        } else if result < 0 {
            c.running = false;
            error!("Pluto v2 frame failed: {result}");
        }
    });
    if COMPANION.with_borrow(|c| c.is_some()) && unsafe { bw.local_pluto_result() }.is_some() {
        unsafe { bw.local_pluto_leave() };
    }
    if LEAVE.replace(false) {
        COMPANION.with_borrow_mut(|companion| {
            if let Some(c) = companion.as_mut() {
                c.running = false;
                c.resigned = true;
            }
        });
        unsafe { bw.local_pluto_leave() };
    }
}
pub(crate) fn match_end(bw: &BwScr) {
    COMPANION.with_borrow_mut(|companion| {
        if let Some(mut c) = companion.take() {
            if c.started {
                c.started = false;
                if let Some(won) = c
                    .resigned
                    .then_some(false)
                    .or_else(|| unsafe { bw.local_pluto_result() })
                {
                    let result = unsafe { (c.end)(1, u32::from(won)) };
                    info!("Pluto v2 match-end: won {won}, status {result}");
                } else {
                    info!("Pluto v2 aborted without a settled result; no learning result saved");
                }
            }
            unsafe { (c.shutdown)() };
        }
    });
    LEAVE.set(false);
}

pub(crate) fn settled_result(state: u8) -> Option<bool> {
    match state {
        1 | 2 => Some(false),
        3 => Some(true),
        _ => None,
    }
}

fn own_inference_processes() -> Result<(), String> {
    use winapi::um::handleapi::CloseHandle;
    use winapi::um::jobapi2::{
        AssignProcessToJobObject, CreateJobObjectW, SetInformationJobObject,
    };
    use winapi::um::processthreadsapi::GetCurrentProcess;
    use winapi::um::winnt::{
        JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE, JOBOBJECT_EXTENDED_LIMIT_INFORMATION,
        JobObjectExtendedLimitInformation,
    };
    unsafe {
        let job = CreateJobObjectW(std::ptr::null_mut(), std::ptr::null());
        if job.is_null() {
            return Err(std::io::Error::last_os_error().to_string());
        }
        let mut limits: JOBOBJECT_EXTENDED_LIMIT_INFORMATION = mem::zeroed();
        limits.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
        if SetInformationJobObject(
            job,
            JobObjectExtendedLimitInformation,
            std::ptr::from_mut(&mut limits).cast(),
            size_of_val(&limits) as u32,
        ) == 0
            || AssignProcessToJobObject(job, GetCurrentProcess()) == 0
        {
            let error = std::io::Error::last_os_error();
            CloseHandle(job);
            return Err(error.to_string());
        }
        // This non-inheritable handle remains owned by the game process until exit. Closing its
        // handle table kills inference descendants, including after a crash or forced app stop.
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    #[test]
    fn an_unfinished_or_invalid_state_cannot_save_a_loss() {
        assert_eq!(super::settled_result(0), None);
        assert_eq!(super::settled_result(4), None);
        assert_eq!(super::settled_result(255), None);
        assert_eq!(super::settled_result(1), Some(false));
        assert_eq!(super::settled_result(2), Some(false));
        assert_eq!(super::settled_result(3), Some(true));
    }
}
