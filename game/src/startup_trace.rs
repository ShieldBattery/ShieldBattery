//! A timeline of the process's startup up to the game's own init (`scr_init`): when this DLL was
//! injected, which modules loaded and unloaded in between, and when the game reached init.
//!
//! A crash before `scr_init` prints the timeline, and every launch logs it at init, so a crashing
//! launch can be compared with healthy launches on the same machine.

use std::cell::UnsafeCell;
use std::fmt::{self, Write};
use std::mem;
use std::ptr::null_mut;
use std::sync::atomic::{AtomicBool, AtomicU64, AtomicUsize, Ordering};

use libc::c_void;
use winapi::shared::minwindef::FILETIME;
use winapi::shared::ntdef::{NTSTATUS, UNICODE_STRING};
use winapi::um::processthreadsapi::{GetCurrentProcess, GetProcessTimes};

use crate::windows;

const MAX_MODULE_EVENTS: usize = 128;
/// UTF-16 units of each module's name that are kept. Longer names are cut off.
const NAME_UNITS: usize = 24;
const LDR_DLL_NOTIFICATION_REASON_UNLOADED: u32 = 2;
/// How many module events go in one crash breadcrumb line, which is limited to 512 bytes.
const EVENTS_PER_BREADCRUMB: usize = 12;

#[derive(Clone, Copy)]
struct ModuleEvent {
    /// 100 ns units since the process was created.
    at: u64,
    unloaded: bool,
    name: [u16; NAME_UNITS],
    name_len: usize,
}

impl ModuleEvent {
    const EMPTY: ModuleEvent = ModuleEvent {
        at: 0,
        unloaded: false,
        name: [0; NAME_UNITS],
        name_len: 0,
    };
}

/// Fixed storage for module events, as they're recorded under the loader lock (where allocating
/// risks deadlocking) and read from the crash handler (where the heap may be broken).
struct ModuleEvents {
    /// Slots handed out so far; can exceed `MAX_MODULE_EVENTS`, the excess being events that
    /// didn't fit.
    claimed: AtomicUsize,
    /// Set once the slot's event has been written.
    ready: [AtomicBool; MAX_MODULE_EVENTS],
    events: [UnsafeCell<ModuleEvent>; MAX_MODULE_EVENTS],
}

// Each slot is written only by the thread that claimed it, and only read once `ready` says the
// write is complete.
unsafe impl Sync for ModuleEvents {}

static MODULE_EVENTS: ModuleEvents = ModuleEvents {
    claimed: AtomicUsize::new(0),
    ready: [const { AtomicBool::new(false) }; MAX_MODULE_EVENTS],
    events: [const { UnsafeCell::new(ModuleEvent::EMPTY) }; MAX_MODULE_EVENTS],
};

/// FILETIME of the process's creation, the origin of every time recorded here.
static PROCESS_CREATED: AtomicU64 = AtomicU64::new(0);
/// Times since process creation (100 ns units) at which `OnInject` and `scr_init` were reached;
/// 0 until then.
static INJECTED_AT: AtomicU64 = AtomicU64::new(0);
static GAME_INIT_AT: AtomicU64 = AtomicU64::new(0);
/// Cookie of the module load notification registration, 0 if not registered.
static NOTIFICATION_COOKIE: AtomicUsize = AtomicUsize::new(0);

#[repr(C)]
struct DllNotificationData {
    flags: u32,
    full_dll_name: *const UNICODE_STRING,
    base_dll_name: *const UNICODE_STRING,
    dll_base: *mut c_void,
    size_of_image: u32,
}

type DllNotificationFn = unsafe extern "system" fn(u32, *const DllNotificationData, *mut c_void);
type LdrRegisterDllNotificationFn =
    unsafe extern "system" fn(u32, DllNotificationFn, *mut c_void, *mut *mut c_void) -> NTSTATUS;
type LdrUnregisterDllNotificationFn = unsafe extern "system" fn(*mut c_void) -> NTSTATUS;

/// Starts recording. Called from `OnInject` once logging works.
pub fn init() {
    let created = unsafe {
        let mut created: FILETIME = mem::zeroed();
        let mut exited: FILETIME = mem::zeroed();
        let mut kernel: FILETIME = mem::zeroed();
        let mut user: FILETIME = mem::zeroed();
        match GetProcessTimes(
            GetCurrentProcess(),
            &mut created,
            &mut exited,
            &mut kernel,
            &mut user,
        ) {
            0 => None,
            _ => Some((created.dwHighDateTime as u64) << 32 | created.dwLowDateTime as u64),
        }
    };
    match created {
        Some(created) => PROCESS_CREATED.store(created, Ordering::Relaxed),
        None => {
            warn!(
                "Couldn't get the process creation time, startup times count from injection: {}",
                std::io::Error::last_os_error(),
            );
            PROCESS_CREATED.store(windows::precise_system_time(), Ordering::Relaxed);
        }
    }
    INJECTED_AT.store(since_process_start().max(1), Ordering::Relaxed);

    let registered = windows::load_library("ntdll").and_then(|ntdll| {
        let register = ntdll.proc_address("LdrRegisterDllNotification")?;
        unsafe {
            let register: LdrRegisterDllNotificationFn = mem::transmute(register);
            let mut cookie = null_mut();
            match register(0, on_module_event, null_mut(), &mut cookie) {
                0 => {
                    NOTIFICATION_COOKIE.store(cookie as usize, Ordering::Relaxed);
                    Ok(())
                }
                status => Err(std::io::Error::other(format!(
                    "LdrRegisterDllNotification failed: {status:08x}"
                ))),
            }
        }
    });
    if let Err(e) = registered {
        warn!("Module loads before game init won't be recorded: {e}");
    }
}

/// Stops recording and logs the timeline. Called at the start of `scr_init`.
pub fn finish() {
    GAME_INIT_AT.store(since_process_start().max(1), Ordering::Relaxed);
    let cookie = NOTIFICATION_COOKIE.swap(0, Ordering::Relaxed);
    if cookie != 0 {
        let unregistered = windows::load_library("ntdll").and_then(|ntdll| {
            let unregister = ntdll.proc_address("LdrUnregisterDllNotification")?;
            unsafe {
                let unregister: LdrUnregisterDllNotificationFn = mem::transmute(unregister);
                unregister(cookie as *mut c_void);
            }
            Ok(())
        });
        if let Err(e) = unregistered {
            warn!("Couldn't stop recording module loads: {e}");
        }
    }

    let recorded = recorded_events();
    let mut message = String::new();
    let _ = write!(
        message,
        "Startup (ms since process creation): injected {}, ",
        Ms(INJECTED_AT.load(Ordering::Relaxed)),
    );
    if recorded != 0 {
        let _ = write!(message, "{}, ", ModuleTimeline(0..recorded));
    }
    let _ = write!(
        message,
        "game init {}{}",
        Ms(GAME_INIT_AT.load(Ordering::Relaxed)),
        Overflow,
    );
    debug!("{message}");
}

/// Whether `scr_init` has been reached.
pub fn game_init_reached() -> bool {
    GAME_INIT_AT.load(Ordering::Relaxed) != 0
}

/// Writes crash breadcrumbs for a crash before game init: when it happened and the module
/// timeline up to it. Writes nothing once game init has been reached. Formats without allocating.
pub fn breadcrumb_crash_before_game_init(breadcrumb: impl Fn(fmt::Arguments<'_>)) {
    if game_init_reached() {
        return;
    }
    breadcrumb(format_args!(
        "Crashed before game init, {} ms after process creation (injected at {} ms)",
        Ms(since_process_start()),
        Ms(INJECTED_AT.load(Ordering::Relaxed)),
    ));
    let recorded = recorded_events();
    for start in (0..recorded).step_by(EVENTS_PER_BREADCRUMB) {
        let end = (start + EVENTS_PER_BREADCRUMB).min(recorded);
        breadcrumb(format_args!(
            "Modules since injection (ms): {}",
            ModuleTimeline(start..end)
        ));
    }
    let overflow = Overflow;
    if overflow.dropped() != 0 {
        breadcrumb(format_args!("{overflow}"));
    }
}

/// 100 ns units since the process was created.
fn since_process_start() -> u64 {
    windows::precise_system_time().saturating_sub(PROCESS_CREATED.load(Ordering::Relaxed))
}

/// Runs under the loader lock on whichever thread loads or unloads a module, so it only copies
/// into fixed storage.
unsafe extern "system" fn on_module_event(
    reason: u32,
    data: *const DllNotificationData,
    _context: *mut c_void,
) {
    let at = since_process_start();
    let index = MODULE_EVENTS.claimed.fetch_add(1, Ordering::Relaxed);
    if index >= MAX_MODULE_EVENTS {
        return;
    }
    let mut event = ModuleEvent {
        at,
        unloaded: reason == LDR_DLL_NOTIFICATION_REASON_UNLOADED,
        ..ModuleEvent::EMPTY
    };
    unsafe {
        let name = if data.is_null() {
            std::ptr::null()
        } else {
            (*data).base_dll_name
        };
        if !name.is_null() && !(*name).Buffer.is_null() {
            let len = ((*name).Length as usize / 2).min(NAME_UNITS);
            event.name[..len].copy_from_slice(std::slice::from_raw_parts((*name).Buffer, len));
            event.name_len = len;
        }
        *MODULE_EVENTS.events[index].get() = event;
    }
    MODULE_EVENTS.ready[index].store(true, Ordering::Release);
}

/// How many leading slots hold a complete event. A slot claimed but not yet written (a load still
/// in progress on another thread) ends the count.
fn recorded_events() -> usize {
    let claimed = MODULE_EVENTS
        .claimed
        .load(Ordering::Relaxed)
        .min(MAX_MODULE_EVENTS);
    (0..claimed)
        .find(|&i| !MODULE_EVENTS.ready[i].load(Ordering::Acquire))
        .unwrap_or(claimed)
}

/// Formats 100 ns units as milliseconds with one decimal.
struct Ms(u64);

impl fmt::Display for Ms {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}.{}", self.0 / 10_000, self.0 / 1_000 % 10)
    }
}

/// Formats recorded module events as `name@ms`, unloads as `-name@ms`. Only covers slots below
/// `recorded_events()`.
struct ModuleTimeline(std::ops::Range<usize>);

impl fmt::Display for ModuleTimeline {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        for (i, index) in self.0.clone().enumerate() {
            let event = unsafe { &*MODULE_EVENTS.events[index].get() };
            if i != 0 {
                f.write_str(", ")?;
            }
            if event.unloaded {
                f.write_char('-')?;
            }
            for c in char::decode_utf16(event.name[..event.name_len].iter().copied()) {
                f.write_char(c.unwrap_or(char::REPLACEMENT_CHARACTER))?;
            }
            write!(f, "@{}", Ms(event.at))?;
        }
        Ok(())
    }
}

/// Notes module events that didn't fit in the storage, if there were any.
struct Overflow;

impl Overflow {
    fn dropped(&self) -> usize {
        MODULE_EVENTS
            .claimed
            .load(Ordering::Relaxed)
            .saturating_sub(MAX_MODULE_EVENTS)
    }
}

impl fmt::Display for Overflow {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self.dropped() {
            0 => Ok(()),
            dropped => write!(f, " ({dropped} later module events not recorded)"),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ms_keeps_one_decimal() {
        assert_eq!(Ms(2_684_321).to_string(), "268.4");
        assert_eq!(Ms(9_999).to_string(), "0.9");
        assert_eq!(Ms(0).to_string(), "0.0");
    }
}
