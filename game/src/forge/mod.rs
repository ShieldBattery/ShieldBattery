use std::cell::Cell;
use std::mem;
use std::ptr::null_mut;
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::Mutex;

use lazy_static::lazy_static;
use libc::c_void;
use winapi::shared::minwindef::{ATOM, HINSTANCE};
use winapi::shared::windef::{HMENU, HWND};
use winapi::um::wingdi::DEVMODEW;
use winapi::um::winuser::*;

use crate::game_thread::{send_game_msg_to_async, GameThreadMessage};

mod scr_hooks {
    use super::{c_void, ATOM, DEVMODEW, HINSTANCE, HMENU, HWND, WNDCLASSEXW};

    whack_hooks!(stdcall, 0,
        !0 => CreateWindowExW(
            u32, *const u16, *const u16, u32, i32, i32, i32, i32, HWND, HMENU, HINSTANCE, *mut c_void,
        ) -> HWND;
        !0 => RegisterClassExW(*const WNDCLASSEXW) -> ATOM;
        !0 => ShowWindow(HWND, i32) -> u32;
        !0 => ChangeDisplaySettingsExW(*const u16, *mut DEVMODEW, HWND, u32, *mut c_void) -> i32;
        !0 => SetWindowPos(HWND, HWND, i32, i32, i32, i32, u32) -> u32;
        !0 => SetCursorPos(i32, i32) -> i32;
        !0 => GetWindowLongW(HWND, i32) -> u32;
        !0 => RegisterHotKey(HWND, i32, u32, u32) -> u32;
    );
}

const FOREGROUND_HOTKEY_ID: i32 = 1337;
const FOREGROUND_HOTKEY_TIMEOUT: u32 = 1000;

// Currently no nicer way to prevent us from hooking winapi calls we ourselves make
// with remastered :/
thread_local! {
    static DISABLE_SCR_HOOKS: Cell<i32> = Cell::new(0);
}

fn scr_hooks_disabled() -> bool {
    DISABLE_SCR_HOOKS.with(|x| x.get()) != 0
}

fn with_scr_hooks_disabled<F: FnOnce() -> R, R>(func: F) -> R {
    DISABLE_SCR_HOOKS.with(|x| {
        x.set(x.get() + 1);
        let ret = func();
        x.set(x.get() - 1);
        ret
    })
}

unsafe extern "system" fn wnd_proc_scr(
    window: HWND,
    msg: u32,
    wparam: usize,
    lparam: isize,
) -> isize {
    if std::thread::panicking() {
        // Avoid recursive locking due to panics
        return DefWindowProcA(window, msg, wparam, lparam);
    }

    let ret = with_scr_hooks_disabled(|| {
        match msg {
            WM_GAME_STARTED => {
                msg_game_started(window);
                return Some(0);
            }
            WM_HOTKEY | WM_TIMER => msg_timer(window, wparam as i32),
            WM_WINDOWPOSCHANGED => {
                let new_pos = lparam as *const WINDOWPOS;
                debug!(
                    "Window pos changed to {},{},{},{}, flags 0x{:x}",
                    (*new_pos).x,
                    (*new_pos).y,
                    (*new_pos).cx,
                    (*new_pos).cy,
                    (*new_pos).flags,
                );

                // Window uses -32000 positions to indicate 'minimized' since Windows 3.1 or so, and
                // for some reason still does this? Anyway we ignore those when saving this state
                if (*new_pos).x != -32000 && (*new_pos).y != -32000 {
                    with_forge(|forge| {
                        // TODO(tec27): We should probably also ignore events if the game has
                        // completed, as SC:R seems to send one during the quit process
                        if forge.game_started {
                            send_game_msg_to_async(GameThreadMessage::WindowMove(
                                (*new_pos).x,
                                (*new_pos).y,
                                (*new_pos).cx,
                                (*new_pos).cy,
                            ));
                        }
                    });
                }
            }
            _ => (),
        }
        None
    });
    if let Some(ret) = ret {
        ret
    } else {
        let orig_wnd_proc = with_forge(|f| f.orig_wnd_proc);
        if let Some(orig_wnd_proc) = orig_wnd_proc {
            orig_wnd_proc(window, msg, wparam, lparam)
        } else {
            DefWindowProcA(window, msg, wparam, lparam)
        }
    }
}

unsafe fn msg_game_started(window: HWND) {
    debug!("Forge: Game started");
    with_forge(|forge| {
        forge.game_started = true;
    });

    // Windows Vista+ likes to prevent you from bringing yourself into the foreground,
    // but will allow you to do so if you're handling a global hotkey. So... we register
    // a global hotkey and then press it ourselves, then bring ourselves into the
    // foreground while handling it.
    RegisterHotKey(window, FOREGROUND_HOTKEY_ID, 0, VK_F22 as u32);
    {
        let mut key_input = INPUT {
            type_: INPUT_KEYBOARD,
            ..mem::zeroed()
        };
        key_input.u.ki_mut().wVk = VK_F22 as u16;
        key_input.u.ki_mut().wScan = MapVirtualKeyA(VK_F22 as u32, 0) as u16;
        SendInput(1, &mut key_input, mem::size_of::<INPUT>() as i32);
        key_input.u.ki_mut().dwFlags |= KEYEVENTF_KEYUP;
        SendInput(1, &mut key_input, mem::size_of::<INPUT>() as i32);
        // Set a timer just in case the input doesn't get dispatched in a reasonable timeframe
        SetTimer(
            window,
            FOREGROUND_HOTKEY_ID as usize,
            FOREGROUND_HOTKEY_TIMEOUT,
            None,
        );
    }
}

unsafe fn msg_timer(window: HWND, timer_id: i32) {
    if timer_id as i32 == FOREGROUND_HOTKEY_ID {
        // remove hotkey and timer
        UnregisterHotKey(window, FOREGROUND_HOTKEY_ID);
        KillTimer(window, FOREGROUND_HOTKEY_ID as usize);

        // Show the window and bring it to the front
        ShowWindow(window, SW_SHOWNORMAL);
        SetForegroundWindow(window);

        ShowCursor(1);
    }
}

lazy_static! {
    static ref FORGE: Mutex<Option<Forge>> = Mutex::new(None);
}

// TODO(tec27): Utilize `settings` to init the window position, then remove this allow
#[allow(dead_code)]
struct Forge {
    settings: Settings,
    window: Option<Window>,
    orig_wnd_proc: Option<unsafe extern "system" fn(HWND, u32, usize, isize) -> isize>,
    game_started: bool,

    /// SCR refers to the window class with ATOM returned by RegisterClassExW
    /// (And the class is named OsWindow instead of 1.16.1 SWarClass)
    scr_window_class: Option<ATOM>,
}

static LOCKING_THREAD: AtomicUsize = AtomicUsize::new(!0);
static FORGE_WINDOW: AtomicUsize = AtomicUsize::new(0);
static FORGE_INITED: AtomicBool = AtomicBool::new(false);

fn with_forge<F: FnOnce(&mut Forge) -> R, R>(func: F) -> R {
    let thread_id = unsafe { winapi::um::processthreadsapi::GetCurrentThreadId() as usize };
    if LOCKING_THREAD.load(Ordering::Relaxed) == thread_id {
        panic!("Forge object is being locked recursively");
    }
    let mut forge = FORGE.lock().unwrap();
    LOCKING_THREAD.store(thread_id, Ordering::Relaxed);
    let forge = forge.as_mut().expect("Forge was never initialized");
    let result = func(forge);
    LOCKING_THREAD.store(!0, Ordering::Relaxed);
    result
}

/// SCR hooks can be called at surprising places while someone higher up
/// call stack has locked forge, so this function exists to allow those
/// hooks to ignore unrelated windows.
fn is_forge_window(hwnd: HWND) -> bool {
    FORGE_WINDOW.load(Ordering::Acquire) as *mut _ == hwnd
}

fn forge_inited() -> bool {
    FORGE_INITED.load(Ordering::Acquire)
}

impl Forge {
    fn set_window(&mut self, window: Window) {
        assert!(self.window.is_none());
        FORGE_WINDOW.store(window.handle as usize, Ordering::Release);
        self.window = Some(window);
    }
}

// TODO(tec27): Use these values to position the window initially and then remove this allow
#[allow(dead_code)]
pub struct Settings {
    window_x: Option<i32>,
    window_y: Option<i32>,
    width: i32,
    height: i32,
}

struct Window {
    handle: HWND,
}

unsafe impl Send for Window {}

fn scr_set_cursor_pos(x: i32, y: i32, orig: unsafe extern "C" fn(i32, i32) -> i32) -> i32 {
    // Unlike 1161, SCR is aware of the desktop resolution,
    // so we just have to block this if the game hasn't started yet.
    if !scr_hooks_disabled() {
        let game_started = with_forge(|forge| forge.game_started);
        if !game_started {
            return 1;
        }
    }
    unsafe { orig(x, y) }
}

fn show_window(window: HWND, show: i32, orig: unsafe extern "C" fn(HWND, i32) -> u32) -> u32 {
    // SCR May have reasons to hide/reshow window, so allow that once game has started.
    // (Though it seems to be calling SetWindowPos always instead)
    // Never allow 1161's ShowWindow calls to get through.
    unsafe {
        let call_orig = if is_forge_window(window) && !scr_hooks_disabled() {
            with_forge(|forge| forge.game_started) &&
                // SC:R tells the window to minimize if in Fullscreen mode, but this is
                // unnecessary in modern Windows versions and actually pretty harmful to UX
                show != SW_MINIMIZE
        } else {
            true
        };

        if call_orig {
            debug!("ShowWindow {:p} {}", window, show);
            orig(window, show)
        } else {
            debug!("Skipping ShowWindow {:p} {}", window, show);
            1
        }
    }
}

#[allow(clippy::too_many_arguments)] // Not our function
fn set_window_pos(
    hwnd: HWND,
    hwnd_after: HWND,
    x: i32,
    y: i32,
    w: i32,
    h: i32,
    flags: u32,
    orig: unsafe extern "C" fn(HWND, HWND, i32, i32, i32, i32, u32) -> u32,
) -> u32 {
    // Add SWP_NOACTIVATE | SWP_HIDEWINDOW when scr calls this during
    // its window creation, which happens early enough in loading that
    // we don't want to show the window yet.
    unsafe {
        debug!(
            "SetWindowPos {:p} {},{} {},{} flags 0x{:x}",
            hwnd, x, y, w, h, flags
        );
        let new_flags = if !scr_hooks_disabled() && is_forge_window(hwnd) {
            with_forge(|forge| {
                if forge.game_started {
                    flags
                } else {
                    debug!("Adding SWP_NOACTIVATE | SWP_HIDEWINDOW as the game has not started");
                    flags | SWP_NOACTIVATE | SWP_HIDEWINDOW
                }
            })
        } else {
            flags
        };

        orig(hwnd, hwnd_after, x, y, w, h, new_flags)
    }
}

fn change_display_settings_ex(
    device_name: *const u16,
    devmode: *mut DEVMODEW,
    hwnd: HWND,
    flags: u32,
    param: *mut c_void,
    orig: unsafe extern "C" fn(*const u16, *mut DEVMODEW, HWND, u32, *mut c_void) -> i32,
) -> i32 {
    unsafe {
        // SC:R seems to call this setting despite not needing to in its current rendering APIs.
        // DX11 and DX12 (the only options you can achieve without changing non-public settings)
        // use DXGI with ResizeTarget + SetFullScreenState, which is more performant and enables
        // better switching between applications. For whatever reason, Blizzard seems to have left
        // these calls in, so we just ignore them unless they're weirdly formatted.

        if !param.is_null() || !hwnd.is_null() {
            // Unexpected parameters, let windows do whatever
            warn!("Unexpected ChangeDisplaySettingsExW params");
            return orig(device_name, devmode, hwnd, flags, param);
        }
        if !devmode.is_null() && (*devmode).dmSize as usize > mem::size_of::<DEVMODEW>() {
            // This probably never happens and if it does it could be handled,
            // but just error for now.
            error!(
                "Received larger than expected devmode: {:x} bytes (expected at most {:x}",
                (*devmode).dmSize,
                mem::size_of::<DEVMODEW>(),
            );
            return orig(device_name, devmode, hwnd, flags, param);
        }

        debug!("Ignoring ChangeDisplaySettingsExW call");
        DISP_CHANGE_SUCCESSFUL
    }
}

fn register_class_w(
    class: *const WNDCLASSEXW,
    orig: unsafe extern "C" fn(*const WNDCLASSEXW) -> ATOM,
) -> ATOM {
    unsafe {
        let os_string;
        let class_name = (*class).lpszClassName;
        let name = match class_name.is_null() {
            true => None,
            false => {
                let len = (0..).find(|&x| *class_name.add(x) == 0).unwrap();
                let slice = std::slice::from_raw_parts(class_name, len);
                os_string = crate::windows::os_string_from_winapi(slice);
                Some(os_string.to_string_lossy())
            }
        };
        debug!("RegisterClassExW with name {:?}", name);
        let is_bw_class = match name {
            None => false,
            Some(s) => s == "OsWindow",
        };
        if !is_bw_class {
            return orig(class);
        }
        let orig_wnd_proc = (*class).lpfnWndProc;
        let rewritten = WNDCLASSEXW {
            lpfnWndProc: Some(wnd_proc_scr),
            ..*class
        };
        let result = orig(&rewritten);
        with_forge(|forge| {
            forge.orig_wnd_proc = orig_wnd_proc;
            forge.scr_window_class = Some(result);
        });
        result
    }
}

/// Stores the window handle.
#[allow(clippy::too_many_arguments)] // Not our function
fn create_window_w(
    ex_style: u32,
    class_name: *const u16,
    window_name: *const u16,
    style: u32,
    x: i32,
    y: i32,
    width: i32,
    height: i32,
    parent: HWND,
    menu: HMENU,
    instance: HINSTANCE,
    param: *mut c_void,
    orig: unsafe extern "C" fn(
        u32,
        *const u16,
        *const u16,
        u32,
        i32,
        i32,
        i32,
        i32,
        HWND,
        HMENU,
        HINSTANCE,
        *mut c_void,
    ) -> HWND,
) -> HWND {
    unsafe {
        let window = orig(
            ex_style,
            class_name,
            window_name,
            style,
            x,
            y,
            width,
            height,
            parent,
            menu,
            instance,
            param,
        );
        // A thread panicking inside with_forge can create a window, so don't try
        // locking forge during panics.
        if forge_inited() && !std::thread::panicking() {
            with_forge(|forge| {
                if let Some(bw_class) = forge.scr_window_class {
                    if class_name as usize == bw_class as usize {
                        debug!("Created main window {:p}", window);

                        forge.set_window(Window { handle: window });
                    }
                }
            });
        }
        window
    }
}

fn get_window_long_w(window: HWND, long: i32, orig: unsafe extern "C" fn(HWND, i32) -> u32) -> u32 {
    // SC:R uses GetWindowLongW(GWL_STYLE) and stores the result. It may then update
    // that Starcraft-side copy of the style and call SetWindowLongW() to update
    // it at Windows side. However, GWL_STYLE also contains a flag that controls
    // the windows's visibility, and we delay showing the window longer than
    // SC:R expects, so it receives GWL_STYLE for which WS_VISIBLE is not set,
    // later unintentionally passing it to SetWindowLongW which hides the window.
    //
    // This is relevant at least when the game is started up in windowed fullscreen
    // and then switched to windowed mode afterwards.
    // For some reason starting in windowed mode does not have the same issue.
    let value = unsafe { orig(window, long) };
    if long == GWL_STYLE {
        value | WS_VISIBLE
    } else {
        value
    }
}

fn register_hot_key(
    window: HWND,
    id: i32,
    modifiers: u32,
    vkcode: u32,
    orig: unsafe extern "C" fn(HWND, i32, u32, u32) -> u32,
) -> u32 {
    // SC:R calls this to hook printscreen and alt+printscreen presses, but does a very bad job of
    // handling these that makes alt+printscreen non-functional as long as the game is running. More
    // stupidly, they also handle printscreen presses are part of normal keypress events, and thus
    // these hotkeys are not even particularly necessary in the first place (I can only hope that
    // on prior versions of Windows this was not the case, and thus this implementation made sense
    // at *some* point, but I really have no idea)

    // Pass non-printscreen hotkeys through (although at the time of writing, there aren't any)
    if vkcode != 0x2c {
        unsafe {
            return orig(window, id, modifiers, vkcode);
        }
    }

    1
}

pub unsafe fn init_hooks_scr(patcher: &mut whack::Patcher) {
    use self::scr_hooks::*;
    // 1161 init can hook just starcraft/storm import table, unfortunately
    // that method won't work with SCR, we'll just GetProcAddress the
    // required functions and hook them instead.
    // May cause some unintended hooks if some another third-party DLL that
    // is part of this same process also calls these functions, but ideally
    // we'd only have the hooks act on main window HWND.
    //
    // Also this will mean that when we call these functions, those calls also get hooked,
    // so the hooks need to be able to handle that (The hooking library is unfortunately
    // not much of a help here, we'll have to set global bools)

    // TODO possibly port keyboard hooks as well.
    hook_winapi_exports!(patcher, "user32",
        "CreateWindowExW", CreateWindowExW, create_window_w;
        "RegisterClassExW", RegisterClassExW, register_class_w;
        "ShowWindow", ShowWindow, show_window;
        "ChangeDisplaySettingsExW", ChangeDisplaySettingsExW, change_display_settings_ex;
        "SetWindowPos", SetWindowPos, set_window_pos;
        "SetCursorPos", SetCursorPos, scr_set_cursor_pos;
        "GetWindowLongW", GetWindowLongW, get_window_long_w;
        "RegisterHotKey", RegisterHotKey, register_hot_key;
    );
}

pub fn init(settings: &serde_json::Map<String, serde_json::Value>) {
    let window_x = settings
        .get("gameWinX")
        .and_then(|x| x.as_i64())
        .map(|x| x as i32);
    let window_y = settings
        .get("gameWinY")
        .and_then(|x| x.as_i64())
        .map(|x| x as i32);
    let width = settings
        .get("gameWinWidth")
        .and_then(|x| x.as_i64())
        .filter(|&x| x > 0 && x < 100_000)
        .unwrap_or_else(|| {
            warn!("Using default window width");
            640
        });
    let height = settings
        .get("gameWinHeight")
        .and_then(|x| x.as_i64())
        .filter(|&x| x > 0 && x < 100_000)
        .unwrap_or_else(|| {
            warn!("Using default window height");
            480
        });

    let settings = Settings {
        window_x,
        window_y,
        width: width as i32,
        height: height as i32,
    };
    *FORGE.lock().unwrap() = Some(Forge {
        settings,
        window: None,
        orig_wnd_proc: None,
        game_started: false,
        scr_window_class: None,
    });
    FORGE_INITED.store(true, Ordering::Release);
}

const WM_END_WND_PROC_WORKER: u32 = WM_USER + 27;
const WM_GAME_STARTED: u32 = WM_USER + 7;

/// Starts running the windows event loop -- we'll need that to run in order to get
/// lobby properly set up. The ingame message loop is run by BW, this doesn't have to be called
/// here.
///
/// Returns once `end_wnd_proc` is called.
pub unsafe fn run_wnd_proc() {
    // Note: Currently done even if forge itself is disabled and we use SCR's
    // own window. Having run/end_wnd_proc go through the Bw trait
    // and be separate for 1.16.1 and SCR would maybe be cleaner.
    let mut msg: MSG = mem::zeroed();
    while GetMessageA(&mut msg, null_mut(), 0, 0) != 0 {
        if msg.message == WM_END_WND_PROC_WORKER {
            return;
        }
        TranslateMessage(&msg);
        DispatchMessageA(&msg);
    }
    // Going to close everything since the window got closed / error happened.
    // TODO Ask async thread exit instead
    std::process::exit(0);
}

pub fn end_wnd_proc() {
    let handle = with_forge(|forge| match forge.window {
        Some(ref s) => s.handle,
        None => panic!("Cannot stop running window procedure without a window"),
    });
    unsafe {
        PostMessageA(handle, WM_END_WND_PROC_WORKER, 0, 0);
    }
}

pub fn game_started() {
    let handle = with_forge(|forge| forge.window.as_ref().map(|s| s.handle));
    if let Some(handle) = handle {
        unsafe {
            PostMessageA(handle, WM_GAME_STARTED, 0, 0);
        }
    }
}

pub fn hide_window() {
    let handle = with_forge(|forge| forge.window.as_ref().map(|s| s.handle));
    if let Some(handle) = handle {
        unsafe {
            with_scr_hooks_disabled(|| {
                ShowWindow(handle, SW_HIDE);
            });
        }
    }
}
