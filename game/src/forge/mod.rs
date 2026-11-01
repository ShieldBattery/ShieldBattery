use std::cell::Cell;
use std::mem;
use std::ptr::null_mut;
use std::sync::Mutex;
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::time::{Duration, Instant};

use lazy_static::lazy_static;
use libc::c_void;
use winapi::shared::minwindef::{ATOM, FALSE, HINSTANCE};
use winapi::shared::windef::{HDC, HMENU, HMONITOR, HWND, POINT, RECT};
use winapi::um::winbase::{INFINITE, WAIT_FAILED};
use winapi::um::wingdi::DEVMODEW;
use winapi::um::winuser::*;

use crate::bw::{Bw, get_bw};
use crate::game_thread::{self, GameThreadMessage, send_game_msg_to_async};

mod gamma;
mod raw_mouse;
mod window_placement;

use self::window_placement::{DisplayMode, Settings};

mod scr_hooks {

    use super::{
        ATOM, DEVMODEW, HDC, HINSTANCE, HMENU, HMONITOR, HWND, MSG, POINT, RECT, TRACKMOUSEEVENT,
        WNDCLASSEXW, c_void,
    };

    system_hooks!(
        !0 => ChangeDisplaySettingsExW(*const u16, *mut DEVMODEW, HWND, u32, *mut c_void) -> i32;
        !0 => ClipCursor(*const RECT) -> i32;
        !0 => CreateWindowExW(
            u32, *const u16, *const u16, u32, i32, i32, i32, i32, HWND, HMENU, HINSTANCE, *mut c_void,
        ) -> HWND;
        !0 => GetCursorPos(*mut POINT) -> i32;
        !0 => MonitorFromPoint32(i32, i32, u32) -> HMONITOR;
        !0 => MonitorFromPoint64(POINT, u32) -> HMONITOR;
        !0 => PeekMessageW(*mut MSG, HWND, u32, u32, u32) -> i32;
        !0 => RegisterClassExW(*const WNDCLASSEXW) -> ATOM;
        !0 => RegisterHotKey(HWND, i32, u32, u32) -> u32;
        !0 => SetCursorPos(i32, i32) -> i32;
        !0 => ShowWindow(HWND, i32) -> u32;
        !0 => SystemParametersInfoA(u32, u32, *mut c_void, u32) -> i32;
        !0 => SystemParametersInfoW(u32, u32, *mut c_void, u32) -> i32;
        !0 => TrackMouseEvent(*mut TRACKMOUSEEVENT) -> i32;
        !0 => GetDeviceGammaRamp(HDC, *mut c_void) -> i32;
        !0 => SetDeviceGammaRamp(HDC, *mut c_void) -> i32;
    );
}

/// How long a message pump drain can keep removing mouse moves; see [`peek_message_w`].
const MAX_MOUSE_MOVE_DRAIN: Duration = Duration::from_millis(1);

const FOREGROUND_HOTKEY_ID: i32 = 1337;
const FOREGROUND_HOTKEY_TIMEOUT: u32 = 1000;

const DRAW_TIMER_ID: usize = 1338;
const DRAW_TIMEOUT_MILLIS: u32 = 1000 / 60;

const STEP_LOBBY_COMPLETION_ID: usize = 1339;
const STEP_LOBBY_COMPLETION_TIMEOUT: u32 = USER_TIMER_MINIMUM;

/// Controls whether the window position is tracked/saved when a move event occurs. We toggle this
/// once we know that moves must be triggered by user action (instead of during init/quit).
pub static TRACK_WINDOW_POS: AtomicBool = AtomicBool::new(false);
/// Whether to fake the current primary monitor. Used during the window creation process to launch
/// fullscreen modes on the correct screen.
static FAKE_PRIMARY_MONITOR: AtomicBool = AtomicBool::new(false);
/// While set, SC:R's own `SetCursorPos` calls are dropped (see [`set_cursor_pos`]). Covers the span
/// from SB entering SC:R's game loop until the first game-logic step: SC:R warps the OS cursor to the
/// renderer center as its game loop starts, and its window-resize path re-syncs the OS cursor to the
/// game's internal mouse position. Both fire inside game-loop init, after the loading screen has
/// already handed off to the game, so they would move a cursor the player is already using. SB
/// places the cursor itself at the handoff instead ([`center_cursor_in_game_window`]).
static SUPPRESS_SCR_CURSOR_MOVES: AtomicBool = AtomicBool::new(false);
/// Set by [`BACKGROUND_ENV_VAR`]. See [`stay_in_background`].
static BACKGROUND: AtomicBool = AtomicBool::new(false);
/// Set to `1` to launch the game in the background, for test games run on a machine someone else is
/// using: the game window opens behind other windows without taking focus, and the game leaves the
/// OS cursor alone until someone brings its window to the foreground.
const BACKGROUND_ENV_VAR: &str = "SB_GAME_BACKGROUND";

// Currently no nicer way to prevent us from hooking winapi calls we ourselves make
// with remastered :/
thread_local! {
    static DISABLE_SCR_HOOKS: Cell<i32> = const { Cell::new(0) };
    /// Set while the current drain loop on this thread has removed a `WM_MOUSEMOVE`; see
    /// [`peek_message_w`].
    static MOUSE_MOVE_DRAINED: Cell<bool> = const { Cell::new(false) };
    /// How long the current drain loop on this thread has spent in `PeekMessageW`; see
    /// [`peek_message_w`].
    static DRAIN_PEEKING: Cell<Duration> = const { Cell::new(Duration::ZERO) };
    /// The mouse message [`peek_message_w`] last removed on this thread, and the cursor position
    /// Windows recorded when the message was sent.
    static REMOVED_MOUSE_MESSAGE: Cell<Option<RemovedMouseMessage>> = const { Cell::new(None) };
    /// How many calls into SC:R's window procedure are running on this thread.
    static WND_PROC_DEPTH: Cell<u32> = const { Cell::new(0) };
    /// The position [`get_cursor_pos`] reports to the next call made while SC:R's window procedure
    /// handles a mouse message, and the window procedure depth handling it; see [`wnd_proc_scr`].
    static DISPATCHED_MOUSE_POINT: Cell<Option<(u32, POINT)>> = const { Cell::new(None) };
}

#[derive(Clone, Copy)]
struct RemovedMouseMessage {
    msg: u32,
    wparam: usize,
    lparam: isize,
    point: POINT,
}

/// The position Windows recorded for a mouse message SC:R's window procedure is about to handle, if
/// it's the one [`peek_message_w`] last removed from the queue (rather than one sent directly).
fn queued_mouse_message_point(msg: u32, wparam: usize, lparam: isize) -> Option<POINT> {
    if !(WM_MOUSEFIRST..=WM_MOUSELAST).contains(&msg) {
        return None;
    }
    REMOVED_MOUSE_MESSAGE
        .take()
        .filter(|removed| {
            removed.msg == msg && removed.wparam == wparam && removed.lparam == lparam
        })
        .map(|removed| removed.point)
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
    unsafe {
        if std::thread::panicking() {
            // Avoid recursive locking due to panics
            return DefWindowProcA(window, msg, wparam, lparam);
        }

        let ret = with_scr_hooks_disabled(|| {
            gamma::handle_window_message(window, msg, wparam);
            if raw_mouse::drops_message(window, msg) {
                return Some(0);
            }
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
                WM_USER
                    if (!IN_SIZE_MOVE_MENU_LOOP.load(Ordering::Relaxed)
                        || with_forge(|f| !f.use_process_events))
                    => {
                        // If we're not using process_events yet, we need to make sure not to pass
                        // this message to SC:R's wndproc. It uses WM_USER as its way of getting
                        // process_events called during resize/context menu (like our timer below).
                        // We also ignore this if we're not in a resize/move/menu loop, as they
                        // can be delivered after that's over and it can cause issues with our
                        // locks.
                        return Some(0);
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
                WM_SYSCOMMAND
                    if with_forge(|f| !f.game_started) => {
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
                WM_CLOSE
                    // Same as above, but for other potential reasons a close event might be sent
                    if with_forge(|f| !f.game_started) => {
                        debug!("Forge: Ignoring window close during loading");
                        return Some(0);
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
            // SC:R's window procedure ignores a mouse message's coordinates and reads the cursor's
            // current position for it, so a click handled a frame after it happened lands wherever
            // the cursor moved to since, a drag selection's corner included. Its first
            // `GetCursorPos` call for the message gets the position from when the message was sent
            // instead; any later ones (window mode clamping, say) still get the cursor's current
            // position.
            //
            // Only calls made at this message's own depth get it: handling a click captures the
            // mouse before reading the cursor, which can send the window another message first.
            let depth = WND_PROC_DEPTH.get() + 1;
            let point = queued_mouse_message_point(msg, wparam, lparam).map(|point| (depth, point));
            let outer = match point {
                Some(point) => DISPATCHED_MOUSE_POINT.replace(Some(point)),
                None => DISPATCHED_MOUSE_POINT.get(),
            };
            WND_PROC_DEPTH.set(depth);
            let ret = orig_wnd_proc(window, msg, wparam, lparam);
            WND_PROC_DEPTH.set(depth - 1);
            if point.is_some() {
                DISPATCHED_MOUSE_POINT.set(outer);
            }
            ret
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
        crate::machine_info::log_modules_loaded_since_startup();
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
        } else if timer_id == STEP_LOBBY_COMPLETION_ID && game_thread::try_step_lobby_init() {
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
/// Set once SC:R's game loop takes over pumping messages, at the same time the loading screen's
/// draw timer stops; see [`peek_message_w`].
static GAME_LOOP_PUMPING: AtomicBool = AtomicBool::new(false);

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

/// Whether the game must not take focus or touch the OS cursor: launched in background mode (see
/// [`BACKGROUND_ENV_VAR`]) and its window isn't in the foreground. Once someone activates the
/// window, the game behaves normally while it stays in front.
fn stay_in_background() -> bool {
    BACKGROUND.load(Ordering::Acquire)
        && game_window_handle().is_none_or(|window| unsafe { GetForegroundWindow() } != window)
}

/// The game window's HWND for debug tooling, if the window has been created. Readable from any
/// thread (the handle is only stored, never dereferenced as a pointer here).
#[cfg(debug_assertions)]
pub fn debug_window_handle() -> Option<HWND> {
    game_window_handle()
}

/// The game window's HWND, if the window has been created. Readable from any thread (the handle
/// is only stored here, never dereferenced as a pointer).
pub fn game_window_handle() -> Option<HWND> {
    let raw = FORGE_WINDOW.load(Ordering::Acquire);
    if raw == 0 { None } else { Some(raw as HWND) }
}

impl Forge {
    fn set_window(&mut self, window: Window) {
        assert!(self.window.is_none());
        gamma::window_created();
        FORGE_WINDOW.store(window.handle as usize, Ordering::Release);
        self.window = Some(window);
    }
}

struct Window {
    handle: HWND,
}

unsafe impl Send for Window {}

/// Drops SC:R's cursor warps while [`SUPPRESS_SCR_CURSOR_MOVES`] is set, and every cursor warp while
/// the game has to [`stay_in_background`]. SB's own cursor moves run with the SC:R hooks disabled,
/// so they get past the first gate but not the second: SB code that runs SC:R's window procedure
/// (a faked resize, say) has the hooks disabled too, and SC:R warps from inside it.
fn set_cursor_pos(x: i32, y: i32, orig: unsafe extern "C" fn(i32, i32) -> i32) -> i32 {
    if stay_in_background() {
        debug!("Dropping SetCursorPos({x}, {y}) while in the background");
        return 1;
    }
    if !scr_hooks_disabled() && SUPPRESS_SCR_CURSOR_MOVES.load(Ordering::Acquire) {
        debug!("Dropping SC:R SetCursorPos({x}, {y}) during game loop start");
        return 1;
    }
    raw_mouse::cursor_warped();
    unsafe { orig(x, y) }
}

/// Drops mouse confinement while the game has to [`stay_in_background`], so a game window that
/// isn't in front can't trap the cursor, including confinement SC:R applies from inside SB code
/// that runs its window procedure with the hooks disabled. Releasing the confinement always goes
/// through.
fn clip_cursor(rect: *const RECT, orig: unsafe extern "C" fn(*const RECT) -> i32) -> i32 {
    if !rect.is_null() && stay_in_background() {
        debug!("Dropping ClipCursor while in the background");
        return 1;
    }
    if rect.is_null() {
        return unsafe { orig(rect) };
    }
    // Confining the cursor moves it inside the new bounds if it's outside them.
    with_scr_hooks_disabled(|| unsafe {
        let mut before: POINT = mem::zeroed();
        GetCursorPos(&mut before);
        let result = orig(rect);
        let mut after: POINT = mem::zeroed();
        GetCursorPos(&mut after);
        if (before.x, before.y) != (after.x, after.y) {
            raw_mouse::cursor_warped();
        }
        result
    })
}

/// The variant of a `ShowWindow` command that doesn't activate the window, if it has one.
fn non_activating_show_command(show: i32) -> Option<i32> {
    match show {
        SW_SHOW => Some(SW_SHOWNA),
        SW_SHOWNORMAL | SW_RESTORE => Some(SW_SHOWNOACTIVATE),
        SW_SHOWMINIMIZED => Some(SW_SHOWMINNOACTIVE),
        _ => None,
    }
}

/// Ends a `PM_REMOVE` drain loop that has spent [`MAX_MOUSE_MOVE_DRAIN`] removing messages and just
/// removed a `WM_MOUSEMOVE`, by reporting an empty queue for the next call.
///
/// Every mouse input message a thread removes makes Windows notify each out-of-context WinEvent
/// hook on the desktop (Chromium-based apps commonly have one), and those hook threads contend
/// with the game for the window manager's lock. With a high polling rate mouse, removing a message
/// can then take longer than the gap until the next one arrives, so SC:R's drain-until-empty
/// message pump keeps chasing new input and stalls a frame for tens of milliseconds. Pending
/// mouse moves coalesce into a single queued message, so leaving one behind loses nothing: the
/// next pump receives the latest position. A drain ordinarily takes microseconds and never reaches
/// the limit, so clicks and keys queued behind a mouse move are handled in the same pump. Whether
/// any are queued can't be asked cheaply: Windows only sorts input into the queue status bits
/// when a `PeekMessage` scans that far.
///
/// The limit only applies once SC:R's game loop pumps messages, since it pumps again every frame.
/// Before that, the loading screen redraws on [`DRAW_TIMER_ID`], and Windows returns `WM_TIMER`
/// only after every other queued message, so an ended drain leaves the redraw queued behind the
/// mouse move. Wine signals an expired timer only once until it's removed, so the loading pump
/// would then sleep through every later redraw.
///
/// Also records each mouse message it removes for [`wnd_proc_scr`] to report the message's own
/// cursor position while SC:R handles it.
fn peek_message_w(
    msg: *mut MSG,
    window: HWND,
    filter_min: u32,
    filter_max: u32,
    remove: u32,
    orig: unsafe extern "C" fn(*mut MSG, HWND, u32, u32, u32) -> i32,
) -> i32 {
    let removing = remove & PM_REMOVE != 0;
    let can_return_mouse_move =
        (filter_min == 0 && filter_max == 0) || (filter_min..=filter_max).contains(&WM_MOUSEMOVE);
    // Raw mouse input leaves no legacy mouse moves to chase.
    let limit_drain = removing
        && can_return_mouse_move
        && GAME_LOOP_PUMPING.load(Ordering::Relaxed)
        && !raw_mouse::taking_input();
    if limit_drain && MOUSE_MOVE_DRAINED.get() && DRAIN_PEEKING.get() >= MAX_MOUSE_MOVE_DRAIN {
        MOUSE_MOVE_DRAINED.set(false);
        DRAIN_PEEKING.set(Duration::ZERO);
        return 0;
    }
    let peek_start = Instant::now();
    let result = match removing && raw_mouse::converts(window, filter_min, filter_max) {
        true => raw_mouse::remove_next_message(msg, |msg| unsafe {
            orig(msg, window, filter_min, filter_max, remove)
        }),
        false => unsafe { orig(msg, window, filter_min, filter_max, remove) },
    };
    if !removing {
        return result;
    }
    let removed = (result != 0).then(|| unsafe { *msg });
    if let Some(removed) = removed
        && (WM_MOUSEFIRST..=WM_MOUSELAST).contains(&removed.message)
    {
        REMOVED_MOUSE_MESSAGE.set(Some(RemovedMouseMessage {
            msg: removed.message,
            wparam: removed.wParam,
            lparam: removed.lParam,
            point: removed.pt,
        }));
    }
    if limit_drain {
        MOUSE_MOVE_DRAINED.set(removed.is_some_and(|removed| removed.message == WM_MOUSEMOVE));
        DRAIN_PEEKING.set(match removed {
            Some(_) => DRAIN_PEEKING.get() + peek_start.elapsed(),
            None => Duration::ZERO,
        });
    }
    result
}

/// Reports the position [`wnd_proc_scr`] set for SC:R's window procedure to read for the mouse
/// message it's handling, once; every other call gets the cursor's current position.
fn get_cursor_pos(point: *mut POINT, orig: unsafe extern "C" fn(*mut POINT) -> i32) -> i32 {
    if !point.is_null()
        && !scr_hooks_disabled()
        && let Some((depth, dispatched)) = DISPATCHED_MOUSE_POINT.get()
        && depth == WND_PROC_DEPTH.get()
    {
        DISPATCHED_MOUSE_POINT.set(None);
        unsafe {
            *point = dispatched;
        }
        return 1;
    }
    unsafe { orig(point) }
}

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
        if is_forge_window(window)
            && stay_in_background()
            && let Some(background_show) = non_activating_show_command(show)
        {
            debug!("Showing the window as {background_show} behind other windows");
            let ret = orig(window, background_show);
            with_scr_hooks_disabled(|| {
                SetWindowPos(
                    window,
                    HWND_BOTTOM,
                    0,
                    0,
                    0,
                    0,
                    SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE,
                );
            });
            return ret;
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
        type WndProc = unsafe extern "system" fn(HWND, u32, usize, isize) -> isize;
        let wnd_proc = crate::windows::jump_to(wnd_proc_scr as WndProc as usize);
        let rewritten = WNDCLASSEXW {
            lpfnWndProc: mem::transmute::<usize, WNDPROC>(wnd_proc),
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
                if let Some(bw_class) = forge.scr_window_class
                    && class_name as usize == bw_class as usize
                {
                    debug!("Created main window {window:p}");
                    raw_mouse::window_created();

                    forge.set_window(Window { handle: window });
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

fn monitor_from_point_impl(x: i32, y: i32, flags: u32) -> Option<POINT> {
    if x == 0
        && y == 0
        && flags == MONITOR_DEFAULTTOPRIMARY
        && FAKE_PRIMARY_MONITOR.load(Ordering::Acquire)
        && let Some(bounds) = with_forge(|forge| forge.starting_settings.monitor_bounds())
    {
        let x = bounds.0 + (bounds.2 / 2) as i32;
        let y = bounds.1 + (bounds.3 / 2) as i32;
        debug!("Faking MonitorFromPoint call to ({x}, {y})");
        return Some(POINT { x, y });
    }

    None
}

// 32-bit version, code pushes x/y separately
#[cfg(target_arch = "x86")]
fn monitor_from_point(
    x: i32,
    y: i32,
    flags: u32,
    orig: unsafe extern "C" fn(i32, i32, u32) -> HMONITOR,
) -> HMONITOR {
    unsafe {
        let point = monitor_from_point_impl(x, y, flags).unwrap_or(POINT { x, y });
        orig(point.x, point.y, flags)
    }
}

// 64-bit version, code pushes x/y as a single POINT struct
#[cfg(target_arch = "x86_64")]
fn monitor_from_point(
    point: POINT,
    flags: u32,
    orig: unsafe extern "C" fn(POINT, u32) -> HMONITOR,
) -> HMONITOR {
    unsafe {
        let point = monitor_from_point_impl(point.x, point.y, flags).unwrap_or(point);
        orig(point, flags)
    }
}

pub unsafe fn init_hooks_scr(patcher: &mut whack::Patcher) {
    unsafe {
        use self::gamma::{get_device_gamma_ramp, set_device_gamma_ramp};
        use self::raw_mouse::track_mouse_event;
        use self::scr_hooks::*;
        use crate::mouse_speed::system_parameters_info;
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
            "ClipCursor", ClipCursor, clip_cursor;
            "CreateWindowExW", CreateWindowExW, create_window_w;
            "GetCursorPos", GetCursorPos, get_cursor_pos;
            "PeekMessageW", PeekMessageW, peek_message_w;
            "RegisterClassExW", RegisterClassExW, register_class_w;
            "RegisterHotKey", RegisterHotKey, register_hot_key;
            "SetCursorPos", SetCursorPos, set_cursor_pos;
            "ShowWindow", ShowWindow, show_window;
            "SystemParametersInfoA", SystemParametersInfoA, system_parameters_info;
            "SystemParametersInfoW", SystemParametersInfoW, system_parameters_info;
            "TrackMouseEvent", TrackMouseEvent, track_mouse_event;
        );

        hook_winapi_exports!(patcher, "gdi32",
            "GetDeviceGammaRamp", GetDeviceGammaRamp, get_device_gamma_ramp;
            "SetDeviceGammaRamp", SetDeviceGammaRamp, set_device_gamma_ramp;
        );

        #[cfg(target_arch = "x86")]
        {
            hook_winapi_exports!(patcher, "user32",
                "MonitorFromPoint", MonitorFromPoint32, monitor_from_point;
            );
        }
        #[cfg(target_arch = "x86_64")]
        {
            hook_winapi_exports!(patcher, "user32",
                "MonitorFromPoint", MonitorFromPoint64, monitor_from_point;
            );
        }
    }
}

pub fn init(
    local_settings: &serde_json::Map<String, serde_json::Value>,
    scr_settings: &serde_json::Map<String, serde_json::Value>,
    monitor_bounds: Option<(i32, i32, u32, u32)>,
) {
    let settings = Settings::from_config(local_settings, scr_settings, monitor_bounds);
    let display_mode = settings.display_mode();
    let gamma_setting = if display_mode == DisplayMode::Fullscreen {
        scr_settings
            .get("gamma")
            .and_then(|v| v.as_u64())
            .and_then(|v| u32::try_from(v).ok())
    } else {
        None
    };
    gamma::configure(gamma_setting);
    raw_mouse::init_from_env();

    let background = std::env::var(BACKGROUND_ENV_VAR).as_deref() == Ok("1");
    BACKGROUND.store(background, Ordering::Release);
    if background {
        info!("Launching in the background ({BACKGROUND_ENV_VAR}=1)");
        if display_mode == DisplayMode::Fullscreen {
            warn!(
                "{BACKGROUND_ENV_VAR} can't keep fullscreen mode from taking over the display, \
                use windowed or windowed fullscreen"
            );
        }
    }

    let fake_monitor = display_mode != DisplayMode::Windowed && monitor_bounds.is_some();
    FAKE_PRIMARY_MONITOR.store(fake_monitor, Ordering::Release);

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
        //
        // MWMO_INPUTAVAILABLE also wakes for messages a previous drain left queued; without it, the
        // wait only returns for messages that arrived since the queue was last checked.
        'outer: while MsgWaitForMultipleObjectsEx(
            0,
            null_mut(),
            INFINITE,
            QS_ALLINPUT,
            MWMO_INPUTAVAILABLE,
        ) != WAIT_FAILED
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
        crate::mouse_speed::restore();
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
    if BACKGROUND.load(Ordering::Acquire) {
        debug!("Forge: Leaving the window where it is ({BACKGROUND_ENV_VAR}=1)");
        return;
    }
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
    GAME_LOOP_PUMPING.store(true, Ordering::Relaxed);
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
///
/// SC:R's `WM_SIZE` handler ignores the size-type parameter and checks whether the window is
/// actually iconic, so the faked minimize runs its full resize path: renderer resize, then every
/// resize listener, including the mouse-confinement one that re-applies `ClipCursor` and finishes by
/// warping the OS cursor onto the game's internal mouse position. That warp is dropped by the
/// cursor gate while the game loop is starting (see [`suppress_scr_cursor_moves`]).
pub fn fix_clip_cursor() {
    if stay_in_background() {
        // The confinement it re-applies would only be dropped, and the resize it fakes runs with
        // the hooks disabled.
        return;
    }
    let handle = with_forge(|forge| forge.window.as_ref().map(|s| s.handle));
    if let Some(handle) = handle {
        unsafe {
            PostMessageW(handle, WM_FIX_CLIP_CURSOR, 0, 0);
        }
    }
}

/// Opens or closes the gate that drops SC:R's `SetCursorPos` calls. Open it right before entering
/// SC:R's game loop and close it on the first game-logic step (which runs whether or not the
/// network is stalled, and in replays), so the gate spans exactly SC:R's game-loop init.
pub fn suppress_scr_cursor_moves(suppress: bool) {
    SUPPRESS_SCR_CURSOR_MOVES.store(suppress, Ordering::Release);
}

/// The screen-coordinate center of a window's client area, or `None` if it can't be measured (e.g.
/// the window is minimized).
pub fn window_client_center(hwnd: HWND) -> Option<(i32, i32)> {
    unsafe {
        let mut rect: RECT = mem::zeroed();
        if GetClientRect(hwnd, &mut rect) == 0 {
            return None;
        }
        if rect.right <= 0 || rect.bottom <= 0 {
            return None;
        }
        let mut point = POINT {
            x: rect.right / 2,
            y: rect.bottom / 2,
        };
        if ClientToScreen(hwnd, &mut point) == 0 {
            return None;
        }
        Some((point.x, point.y))
    }
}

/// Warps the OS cursor to the center of the game window's client area. Called when the loading
/// screen hands off to the game, which is where the player expects the game-start centering to
/// happen; SC:R's own centering (which would land later, inside game-loop init) is dropped by the
/// cursor gate. Bypasses that gate. Does nothing while the game has to [`stay_in_background`].
pub fn center_cursor_in_game_window() {
    if stay_in_background() {
        return;
    }
    let Some(hwnd) = game_window_handle() else {
        return;
    };
    let Some((x, y)) = window_client_center(hwnd) else {
        return;
    };
    debug!("Centering cursor in game window at ({x}, {y})");
    with_scr_hooks_disabled(|| unsafe {
        SetCursorPos(x, y);
    });
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
    let display_mode = settings.display_mode();
    if display_mode != DisplayMode::Windowed {
        // Once we hit this point, we no longer need to fake which monitor is the primary one, since
        // the window has already been positioned on what SC:R thought was the primary one
        FAKE_PRIMARY_MONITOR.store(false, Ordering::Release);
        debug!("Not restoring window position for {display_mode:?} display mode");
        return;
    };

    settings.restore(handle);
}
