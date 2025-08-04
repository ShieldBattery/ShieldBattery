use std::cell::Cell;
use std::mem;
use std::ptr::null_mut;
use std::sync::Mutex;
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};

use lazy_static::lazy_static;
use libc::c_void;
use serde_repr::Deserialize_repr;
use winapi::shared::minwindef::{ATOM, FALSE, HINSTANCE};
use winapi::shared::windef::{HMENU, HWND, POINT, RECT};
use winapi::um::wingdi::DEVMODEW;
use winapi::um::winuser::*;

use crate::bw::{Bw, get_bw};
use crate::game_thread::{self, GameThreadMessage, send_game_msg_to_async};

mod scr_hooks {

    use super::{ATOM, DEVMODEW, HINSTANCE, HMENU, HWND, WNDCLASSEXW, c_void};

    system_hooks!(
        !0 => ChangeDisplaySettingsExW(*const u16, *mut DEVMODEW, HWND, u32, *mut c_void) -> i32;
        !0 => CreateWindowExW(
            u32, *const u16, *const u16, u32, i32, i32, i32, i32, HWND, HMENU, HINSTANCE, *mut c_void,
        ) -> HWND;
        !0 => RegisterClassExW(*const WNDCLASSEXW) -> ATOM;
        !0 => ShowWindow(HWND, i32) -> u32;
        !0 => RegisterHotKey(HWND, i32, u32, u32) -> u32;
    );
}

const FOREGROUND_HOTKEY_ID: i32 = 1337;
const FOREGROUND_HOTKEY_TIMEOUT: u32 = 1000;

const DRAW_TIMER_ID: usize = 1338;
const DRAW_TIMEOUT_MILLIS: u32 = 1000 / 60;

const STEP_LOBBY_COMPLETION_ID: usize = 1339;
const STEP_LOBBY_COMPLETION_TIMEOUT: u32 = USER_TIMER_MINIMUM;

/// Controls whether the window position is tracked/saved when a move event occurs. We toggle this
/// once we know that moves must be triggered by user action (instead of during init/quit).
pub static TRACK_WINDOW_POS: AtomicBool = AtomicBool::new(false);

// Currently no nicer way to prevent us from hooking winapi calls we ourselves make
// with remastered :/
thread_local! {
    static DISABLE_SCR_HOOKS: Cell<i32> = const { Cell::new(0) };
}

#[expect(dead_code)]
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
    unsafe {
        if std::thread::panicking() {
            // Avoid recursive locking due to panics
            return DefWindowProcA(window, msg, wparam, lparam);
        }

        let ret = with_scr_hooks_disabled(|| {
            match msg {
                WM_END_WND_PROC_WORKER => {
                    STOP_MESSAGE_PUMP.store(true, Ordering::Release);
                    // Just try to ensure that the very beginning of StartGame handling will always
                    // happen
                    force_mouse_up();
                    return Some(0);
                }
                WM_BRING_WINDOW_FORWARD => {
                    msg_bring_window_forward(window);
                    return Some(0);
                }
                WM_GAME_STARTED => {
                    msg_game_started(window);
                    return Some(0);
                }
                WM_FIX_CLIP_CURSOR => {
                    // Fake a minimize event to the SC:R wndproc to put it in a state where it will
                    // properly ClipCursor
                    if let Some(orig_wnd_proc) = with_forge(|f| f.orig_wnd_proc) {
                        orig_wnd_proc(window, WM_SIZE, SIZE_MINIMIZED, 0);
                    }
                    return Some(0);
                }
                WM_USER => {
                    if !IN_SIZE_MOVE_MENU_LOOP.load(Ordering::Relaxed)
                        || with_forge(|f| !f.use_process_events)
                    {
                        // If we're not using process_events yet, we need to make sure not to pass
                        // this message to SC:R's wndproc. It uses WM_USER as its way of getting
                        // process_events called during resize/context menu (like our timer below).
                        // We also ignore this if we're not in a resize/move/menu loop, as they
                        // can be delivered after that's over and it can cause issues with our
                        // locks.
                        return Some(0);
                    }
                }
                WM_ENTERSIZEMOVE | WM_ENTERMENULOOP => {
                    // These events signal that Windows is going to run its own event loop on our
                    // main thread, so we start a timer to ensure we keep making game loading
                    // progress
                    debug!("Enter size/move/menu loop {msg:#x}");
                    IN_SIZE_MOVE_MENU_LOOP.store(true, Ordering::Release);
                    if with_forge(|f| !f.game_started) {
                        SetTimer(
                            window,
                            STEP_LOBBY_COMPLETION_ID,
                            STEP_LOBBY_COMPLETION_TIMEOUT,
                            None,
                        );

                        if with_forge(|f| {
                            f.event_processing_needs_relock =
                                USING_PROCESS_EVENTS_DISPATCH.load(Ordering::Relaxed);
                            f.event_processing_needs_relock
                        }) {
                            get_bw().unlock_event_processing_for_size_move_menu();
                            debug!("Unlocked event processing lock for size/move/menu loop");
                        }
                    }
                }
                WM_EXITSIZEMOVE | WM_EXITMENULOOP => {
                    // Opposite of the above, we are now running our own window loop again
                    debug!("Exit size/move/menu loop {msg:#x}");
                    IN_SIZE_MOVE_MENU_LOOP.store(false, Ordering::Release);
                    if with_forge(|f| !f.game_started && f.use_process_events) {
                        KillTimer(window, STEP_LOBBY_COMPLETION_ID);

                        if with_forge(|f| {
                            if f.event_processing_needs_relock {
                                f.event_processing_needs_relock = false;
                                true
                            } else {
                                false
                            }
                        }) {
                            debug!("Re-locking event processing lock after size/move/menu loop");
                            get_bw().lock_event_processing_for_size_move_menu();
                        }
                    }
                }
                WM_NCRBUTTONDOWN => {
                    // Ignore right-clicks in the title bar. SC:R does this anyway, but we don't
                    // want to allow them during loading because Windows will lock us out of our
                    // main thread as long as the context menu is open
                    return Some(0);
                }
                WM_SYSCOMMAND => {
                    if with_forge(|f| !f.game_started) {
                        let message = wparam & 0xFFF0;
                        if message == SC_CLOSE {
                            // Ignore alt+f4 during loading, since we don't want the user to be able
                            // to close the game during this time and it messes up the game state
                            debug!("Forge: Ignoring SC_CLOSE during loading");
                            return Some(0);
                        } else if message == SC_MOUSEMENU || message == SC_KEYMENU {
                            // Ignore the mouse menu and key menu messages, which are sent when
                            // the user tries to open the window menu with the mouse or keyboard
                            // (e.g. by clicking on the program icon). If this menu gets opened,
                            // Windows will lock us out of our main thread until it is closed.
                            debug!("Forge: Ignoring window menu during loading");
                            return Some(0);
                        }
                    }
                }
                WM_CLOSE => {
                    // Same as above, but for other potential reasons a close event might be sent
                    if with_forge(|f| !f.game_started) {
                        debug!("Forge: Ignoring window close during loading");
                        return Some(0);
                    }
                }
                WM_HOTKEY | WM_TIMER => msg_timer(window, wparam),
                WM_WINDOWPOSCHANGED => {
                    let new_pos = lparam as *const WINDOWPOS;

                    let window_style = GetWindowLongA(window, GWL_STYLE) as u32;
                    let has_title_bar = (window_style & WS_CAPTION) != 0;

                    if IsIconic(window) == 0
                        // This stops us from tracking position changes for the initial change to
                        // fullscreen
                        && IsZoomed(window) == 0
                        // This stops us from tracking changes for the later fullscreen events
                        && has_title_bar
                        // Window uses -32000 positions to indicate 'minimized' since Windows 3.1 or
                        // so, and for some reason still does this? Anyway we ignore those when
                        // saving this state
                        && (*new_pos).x != -32000
                        && (*new_pos).y != -32000
                        && TRACK_WINDOW_POS.load(Ordering::Acquire)
                    {
                        send_game_msg_to_async(GameThreadMessage::WindowMove(
                            (*new_pos).x,
                            (*new_pos).y,
                            (*new_pos).cx,
                            (*new_pos).cy,
                        ));
                    }
                }

                _ => (),
            }
            None
        });

        if let Some(ret) = ret {
            return ret;
        } else if let Some(ret) = get_bw().window_proc_hook(window, msg, wparam, lparam) {
            return ret;
        }

        let Some(orig_wnd_proc) = with_forge(|f| f.orig_wnd_proc) else {
            return DefWindowProcA(window, msg, wparam, lparam);
        };

        if msg == WM_USER && with_forge(|f| !f.game_started) {
            let should_pass = with_forge(|f| {
                if f.handling_wm_user {
                    // This would cause SC:R to call process_events inside of a process_events,
                    // which is unnecessary and could recurse infinitely, so we just break out by
                    // returning without calling through
                    false
                } else {
                    f.handling_wm_user = true;
                    true
                }
            });

            if !should_pass {
                return 0;
            }
            // process_events() will be called as a result of this WM_USER, so we need to acquire
            // the lock around the wndproc call
            get_bw().lock_event_processing_for_size_move_menu();
            let ret = orig_wnd_proc(window, msg, wparam, lparam);
            get_bw().unlock_event_processing_for_size_move_menu();
            with_forge(|f| {
                f.handling_wm_user = false;
            });

            ret
        } else {
            orig_wnd_proc(window, msg, wparam, lparam)
        }
    }
}

unsafe fn msg_bring_window_forward(window: HWND) {
    unsafe {
        debug!("Forge: Bringing window to foreground");
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
}

unsafe fn msg_game_started(window: HWND) {
    unsafe {
        debug!("Forge: Game started");
        with_forge(|forge| {
            forge.game_started = true;
        });

        // Re-enable the close button
        let menu = GetSystemMenu(window, FALSE);
        EnableMenuItem(menu, SC_CLOSE as u32, MF_BYCOMMAND | MF_ENABLED);
        DrawMenuBar(window);

        // Ensure any leftover lobby init timer is cleaned up
        KillTimer(window, STEP_LOBBY_COMPLETION_ID);
    }
}

unsafe fn msg_timer(window: HWND, timer_id: usize) {
    unsafe {
        if timer_id == DRAW_TIMER_ID {
            get_bw().force_redraw_during_init();
        } else if timer_id == FOREGROUND_HOTKEY_ID as usize {
            // remove hotkey and timer
            UnregisterHotKey(window, FOREGROUND_HOTKEY_ID);
            KillTimer(window, FOREGROUND_HOTKEY_ID as usize);

            debug!("Bringing window to foreground");
            SetForegroundWindow(window);
            ShowWindow(window, SW_SHOWNORMAL);
        } else if timer_id == STEP_LOBBY_COMPLETION_ID && game_thread::step_lobby_init() {
            debug!("Lobby init completed during WM_TIMER");
            force_mouse_up();
        }
    }
}

lazy_static! {
    static ref FORGE: Mutex<Option<Forge>> = Mutex::new(None);
}

struct Forge {
    starting_settings: Settings,
    window: Option<Window>,
    orig_wnd_proc: Option<unsafe extern "system" fn(HWND, u32, usize, isize) -> isize>,
    window_pos_restored: bool,
    use_process_events: bool,
    game_started: bool,

    /// SCR refers to the window class with ATOM returned by RegisterClassExW
    /// (And the class is named OsWindow instead of 1.16.1 SWarClass)
    scr_window_class: Option<ATOM>,

    /// Set to true if the event processing lock needs to be re-locked at the conclusion of the
    /// resize/move/menu loop. This ensures we don't re-lock the lock if it wasn't locked when that
    /// began (and lock everyone out forever).
    event_processing_needs_relock: bool,
    /// Flag set if we're currently letting SC:R handle a WM_USER message, which it will use to
    /// call process_events. If WM_USER events get generated faster than process_events runs, it
    /// can recurse forever => stack overflow (and is also just hard to reason about and very
    /// unnecessary).
    handling_wm_user: bool,
}

static LOCKING_THREAD: AtomicUsize = AtomicUsize::new(!0);
static FORGE_WINDOW: AtomicUsize = AtomicUsize::new(0);
static FORGE_INITED: AtomicBool = AtomicBool::new(false);
// This lets us handle a race condition where SC:R's message handling receives the
// WM_END_WND_PROC_WORKER message before we see it.
static STOP_MESSAGE_PUMP: AtomicBool = AtomicBool::new(false);
static USING_PROCESS_EVENTS_DISPATCH: AtomicBool = AtomicBool::new(false);
static IN_SIZE_MOVE_MENU_LOOP: AtomicBool = AtomicBool::new(false);

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

#[derive(Debug, Copy, Clone, PartialEq, Eq, Default, Deserialize_repr)]
#[repr(u8)]
enum DisplayMode {
    Windowed = 0,
    #[default]
    WindowedFullscreen = 1,
    Fullscreen = 2,
}

#[derive(Debug, Copy, Clone, Default)]
pub struct Settings {
    window_x: Option<i32>,
    window_y: Option<i32>,
    width: Option<i32>,
    height: Option<i32>,

    display_mode: DisplayMode,
}

struct Window {
    handle: HWND,
}

unsafe impl Send for Window {}

fn show_window(window: HWND, show: i32, orig: unsafe extern "C" fn(HWND, i32) -> u32) -> u32 {
    unsafe {
        debug!("ShowWindow {window:p} {show}");
        if show == SW_SHOW
            && is_forge_window(window)
            && !with_forge(|forge| {
                let restored = forge.window_pos_restored;
                forge.window_pos_restored = true;
                restored
            })
        {
            restore_saved_window_pos();
            // Disable the close button, since we don't want the user to be able to close the window
            // during loading. We'll re-enable it once loading is complete.
            let menu = GetSystemMenu(window, FALSE);
            EnableMenuItem(menu, SC_CLOSE as u32, MF_BYCOMMAND | MF_GRAYED);
            DrawMenuBar(window);
        }
        orig(window, show)
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
        debug!("RegisterClassExW with name {name:?}");
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
                        debug!("Created main window {window:p}");

                        forge.set_window(Window { handle: window });
                    }
                }
            });
        }
        window
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

/// Tracks whether the game has previously set a device mode (e.g. a non-null DEVMODEW pointer).
static HAD_DEV_MODE_SET: AtomicBool = AtomicBool::new(false);

fn change_display_settings_ex(
    device_name: *const u16,
    devmode: *mut DEVMODEW,
    hwnd: HWND,
    flags: u32,
    param: *mut c_void,
    orig: unsafe extern "C" fn(*const u16, *mut DEVMODEW, HWND, u32, *mut c_void) -> i32,
) -> i32 {
    unsafe {
        if param.is_null() && hwnd.is_null() {
            // This is the normal way that SC:R calls this function, but just to be safe we ensure
            // these parameters are set this way

            if !devmode.is_null() || HAD_DEV_MODE_SET.load(Ordering::Acquire) {
                let res = orig(device_name, devmode, hwnd, flags, param);
                if res == DISP_CHANGE_SUCCESSFUL {
                    HAD_DEV_MODE_SET.store(!devmode.is_null(), Ordering::Release);
                }
                return res;
            }

            // If the game is trying to reset the display mode but we never had a display mode set,
            // ignore it, as even resetting to the NULL mode causes the reset of a bunch of
            // rendering state => frozen rendering for X time
            debug!("ChangeDisplaySettingsExW: Null with no devmode set, ignoring call");
            DISP_CHANGE_SUCCESSFUL
        } else {
            orig(device_name, devmode, hwnd, flags, param)
        }
    }
}

pub unsafe fn init_hooks_scr(patcher: &mut whack::Patcher) {
    unsafe {
        use self::scr_hooks::*;
        // 1161 init could hook just starcraft/storm import table, unfortunately
        // that method doesn't work with SCR, we'll just GetProcAddress the
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
            "ChangeDisplaySettingsExW", ChangeDisplaySettingsExW, change_display_settings_ex;
            "CreateWindowExW", CreateWindowExW, create_window_w;
            "RegisterClassExW", RegisterClassExW, register_class_w;
            "ShowWindow", ShowWindow, show_window;
            "RegisterHotKey", RegisterHotKey, register_hot_key;
        );
    }
}

pub fn init(
    local_settings: &serde_json::Map<String, serde_json::Value>,
    scr_settings: &serde_json::Map<String, serde_json::Value>,
) {
    let window_x = local_settings
        .get("gameWinX")
        .and_then(|x| x.as_i64())
        .map(|x| x as i32);
    let window_y = local_settings
        .get("gameWinY")
        .and_then(|x| x.as_i64())
        .map(|x| x as i32);
    let width = local_settings
        .get("gameWinWidth")
        .and_then(|x| x.as_i64())
        .filter(|&x| x > 0 && x < 100_000)
        .map(|x| x as i32);
    let height = local_settings
        .get("gameWinHeight")
        .and_then(|x| x.as_i64())
        .filter(|&x| x > 0 && x < 100_000)
        .map(|x| x as i32);

    let display_mode = scr_settings
        .get("displayMode")
        .and_then(|v| serde_json::from_value::<DisplayMode>(v.clone()).ok())
        .unwrap_or_default();

    let settings = Settings {
        window_x,
        window_y,
        width,
        height,

        display_mode,
    };
    *FORGE.lock().unwrap() = Some(Forge {
        starting_settings: settings,
        window: None,
        orig_wnd_proc: None,
        use_process_events: false,
        game_started: false,
        window_pos_restored: false,
        scr_window_class: None,

        event_processing_needs_relock: false,
        handling_wm_user: false,
    });
    FORGE_INITED.store(true, Ordering::Release);
}

const WM_FIRST_CUSTOM: u32 = WM_USER + 27;
const WM_END_WND_PROC_WORKER: u32 = WM_FIRST_CUSTOM;
const WM_BRING_WINDOW_FORWARD: u32 = WM_FIRST_CUSTOM + 1;
const WM_GAME_STARTED: u32 = WM_FIRST_CUSTOM + 2;
const WM_FIX_CLIP_CURSOR: u32 = WM_FIRST_CUSTOM + 3;

/// Starts running the windows event loop -- we'll need that to run in order to get
/// lobby properly set up. The ingame message loop is run by BW, this doesn't have to be called
/// here.
///
/// Returns once `end_wnd_proc` is called.
pub unsafe fn run_wnd_proc() {
    debug!("Forge: run_wnd_proc called");
    unsafe {
        if let Some(handle) = with_forge(|forge| forge.window.as_ref().map(|s| s.handle)) {
            // Set up a timer to trigger redraws at a set interval during initialization
            debug!("Forge: starting draw timer");
            SetTimer(handle, DRAW_TIMER_ID, DRAW_TIMEOUT_MILLIS, None);
            get_bw().force_redraw_during_init();
        }

        // Wait for there to be messages in the queue, then tell SC:R to process events so it will
        // dispatch them. We do this because we need to call `process_events` anyway (for things
        // like sound playback), and it calls through to `PeekMessageW` anyway.
        'outer: while MsgWaitForMultipleObjects(0, null_mut(), FALSE, u32::MAX, QS_ALLINPUT)
            != u32::MAX
        {
            let mut msg: MSG = mem::zeroed();
            let mut done = PeekMessageW(
                &mut msg,
                null_mut(),
                WM_END_WND_PROC_WORKER,
                WM_END_WND_PROC_WORKER,
                PM_REMOVE,
            ) != 0;

            if !done && with_forge(|forge| forge.use_process_events) {
                // Once the lobby is initialized and players have joined (and we won't be
                // touching the game memory outside of the event processing lock), we need to let
                // process_events() dispatch the messages instead, so that it will also handle
                // things like sound playback
                USING_PROCESS_EVENTS_DISPATCH.store(true, Ordering::Release);
                get_bw().process_events();
            } else if !done {
                // Before then, we need to dispatch the messages ourselves so we give SC:R less
                // opportunity to mess with memory we're using (e.g. during join_lobby)
                while PeekMessageW(&mut msg, null_mut(), 0, 0, PM_REMOVE) != 0 {
                    if msg.message == WM_QUIT {
                        debug!("WM_QUIT received, exiting message pump");
                        break 'outer;
                    } else if msg.message == WM_END_WND_PROC_WORKER {
                        done = true;
                        break;
                    }

                    TranslateMessage(&msg);
                    DispatchMessageW(&msg);
                }
            }

            // NOTE(tec27): STOP_MESSAGE_PUMP may have been set by our wndproc hook since
            // process_events calls PeekMessageW in a loop, and the event may have been dispatched
            // to the window during that loop
            if done || STOP_MESSAGE_PUMP.load(Ordering::Acquire) {
                STOP_MESSAGE_PUMP.store(true, Ordering::Release);
                // Just to ensure this is always set once our message pump is done (since
                // process_events will be handling everything at that point)
                USING_PROCESS_EVENTS_DISPATCH.store(true, Ordering::Release);
                return;
            }
        }
        // Going to close everything since the window got closed / error happened.
        // TODO Ask async thread exit instead
        std::process::exit(0);
    }
}

pub fn end_wnd_proc() {
    let handle = with_forge(|forge| match forge.window {
        Some(ref s) => s.handle,
        None => panic!("Cannot stop running window procedure without a window"),
    });
    unsafe {
        PostMessageW(handle, WM_END_WND_PROC_WORKER, 0, 0);
    }
}

pub fn bring_window_forward() {
    let handle = with_forge(|forge| forge.window.as_ref().map(|s| s.handle));
    if let Some(handle) = handle {
        unsafe {
            PostMessageW(handle, WM_BRING_WINDOW_FORWARD, 0, 0);
        }
    }
}

/// Fakes a mouse up event to the game window, intended to stop resizing that may be occuring at
/// the instant the game start (which could otherwise be used to maliciously stall game loading).
pub fn force_mouse_up() {
    let handle = with_forge(|forge| forge.window.as_ref().map(|s| s.handle));
    if let Some(handle) = handle {
        debug!("Forcing WM_LBUTTONUP");
        unsafe {
            let mut point: POINT = std::mem::zeroed();
            let (x, y) = if GetCursorPos(&mut point) != 0 {
                (point.x, point.y)
            } else {
                (0, 0)
            };
            let mut lparam = (y << 16) as u32 | (x as u32 & 0xFFFF);
            if y < 0 {
                lparam |= 0x80000000; // Set the high bit for negative y coordinates
            }
            PostMessageW(handle, WM_LBUTTONUP, 0, lparam as isize);
        }
    }
}

/// Starts using process_events for Windows message dispatch. This should be called once the lobby
/// is initialized and all players have joined (once any game state modifications are complete).
pub fn start_process_events_dispatch() {
    debug!("Starting to use process_events for message dispatch");
    with_forge(|forge| {
        forge.use_process_events = true;
    });
}

pub fn game_started() {
    let handle = with_forge(|forge| forge.window.as_ref().map(|s| s.handle));
    if let Some(handle) = handle {
        unsafe {
            KillTimer(handle, DRAW_TIMER_ID);
            PostMessageW(handle, WM_GAME_STARTED, 0, 0);
        }
    }
}

/// Hackishly resets the state of the window in SC:R's internals so that it re-applies ClipCursor
/// as needed.
pub fn fix_clip_cursor() {
    let handle = with_forge(|forge| forge.window.as_ref().map(|s| s.handle));
    if let Some(handle) = handle {
        unsafe {
            PostMessageW(handle, WM_FIX_CLIP_CURSOR, 0, 0);
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

pub fn restore_saved_window_pos() {
    let (settings, handle) = with_forge(|forge| {
        (
            forge.starting_settings,
            forge.window.as_ref().map(|s| s.handle),
        )
    });
    let Some(handle) = handle else {
        error!("Tried to restore window position without a window");
        return;
    };
    let display_mode = settings.display_mode;
    if display_mode != DisplayMode::Windowed {
        // TODO(tec27): Make this work for fullscreen modes too. With this implementation, it moves
        // the window over but then it gets snapped back to the primary monitor, leaving a bugged
        // taskbar entry on the target monitor.
        debug!("Not restoring window position for {display_mode:?} display mode");
        return;
    };

    // Only restore the position if all the values are set
    if let (Some(x), Some(y), Some(width), Some(height)) = (
        settings.window_x,
        settings.window_y,
        settings.width,
        settings.height,
    ) {
        unsafe {
            debug!("Restoring window position to ({x},{y}) {width}x{height} [{display_mode:?}]");
            let WindowBounds {
                x,
                y,
                width,
                height,
            } = ensure_window_is_visible(x, y, width, height, display_mode);
            debug!("After ensuring window is visible: ({x},{y}) {width}x{height}");

            with_scr_hooks_disabled(|| {
                SetWindowPos(
                    handle,
                    null_mut(),
                    x,
                    y,
                    width,
                    height,
                    SWP_NOZORDER | SWP_NOACTIVATE,
                );
            });
        }
    }
}

#[derive(Debug, Copy, Clone, PartialEq, Eq)]
struct WindowBounds {
    x: i32,
    y: i32,
    width: i32,
    height: i32,
}

fn ensure_window_is_visible(
    x: i32,
    y: i32,
    width: i32,
    height: i32,
    display_mode: DisplayMode,
) -> WindowBounds {
    match display_mode {
        DisplayMode::Windowed => {
            // Ensure the window is within the bounds of all monitors (if the user has a
            // non-rectangular arrangement of monitors this could still result in the window
            // being partially off any screen, but this should only really adjust stuff when
            // the window would have been off the virtual screen anyway)
            let (vleft, vtop, vwidth, vheight) = unsafe {
                (
                    GetSystemMetrics(SM_XVIRTUALSCREEN),
                    GetSystemMetrics(SM_YVIRTUALSCREEN),
                    GetSystemMetrics(SM_CXVIRTUALSCREEN),
                    GetSystemMetrics(SM_CYVIRTUALSCREEN),
                )
            };
            let width = width.min(vwidth);
            let height = height.min(vheight);
            let x = x.max(vleft).min(vleft + vwidth - width);
            let y = y.max(vtop).min(vtop + vheight - height);
            WindowBounds {
                x,
                y,
                width,
                height,
            }
        }
        DisplayMode::WindowedFullscreen | DisplayMode::Fullscreen => {
            // Identify the monitor the x,y position is on, then give that monitor's bounds as the
            // bounds for the window.
            let monitor = unsafe {
                MonitorFromRect(
                    &RECT {
                        left: x,
                        top: y,
                        right: x + width,
                        bottom: y + height,
                    },
                    MONITOR_DEFAULTTONEAREST,
                )
            };
            let (x, y, width, height) = unsafe {
                let mut monitor_info = std::mem::zeroed::<MONITORINFO>();
                monitor_info.cbSize = std::mem::size_of::<MONITORINFO>() as u32;
                GetMonitorInfoA(monitor, &mut monitor_info);
                (
                    monitor_info.rcMonitor.left,
                    monitor_info.rcMonitor.top,
                    monitor_info.rcMonitor.right - monitor_info.rcMonitor.left,
                    monitor_info.rcMonitor.bottom - monitor_info.rcMonitor.top,
                )
            };

            WindowBounds {
                x,
                y,
                width,
                height,
            }
        }
    }
}
