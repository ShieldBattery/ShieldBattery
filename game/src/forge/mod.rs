mod direct_x;
mod indirect_draw;
mod renderer;

use std::cell::Cell;
use std::ffi::CStr;
use std::io;
use std::mem;
use std::ptr::{null, null_mut};
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::{Mutex};

use lazy_static::lazy_static;
use libc::c_void;

use winapi::shared::guiddef::GUID;
use winapi::shared::minwindef::{ATOM, FARPROC, HINSTANCE, HMODULE};
use winapi::shared::windef::{HBITMAP, HDC, HGDIOBJ, HMENU, HWND, POINT, RECT};
use winapi::um::dsound::{
    IDirectSound, IDirectSoundBuffer, IDirectSoundVtbl, DSBCAPS_GLOBALFOCUS, DSBCAPS_PRIMARYBUFFER,
    DSBUFFERDESC, DS_OK,
};
use winapi::um::unknwnbase::IUnknown;
use winapi::um::wingdi::{GetDeviceCaps, BITMAP, BITSPIXEL, DEVMODEW};
use winapi::um::winuser::*;

use crate::game_thread::{send_game_msg_to_async, GameThreadMessage};
use crate::windows::os_string_from_winapi;

use self::renderer::Renderer;

mod hooks {
    use super::{
        c_void, ATOM, FARPROC, HBITMAP, HDC, HGDIOBJ, HINSTANCE, HMENU, HMODULE, HWND, POINT, RECT,
        WNDCLASSEXA,
    };
    whack_export!(pub extern "system" CreateWindowExA(
        u32, *const i8, *const i8, u32, i32, i32, i32, i32, HWND, HMENU, HINSTANCE, *mut c_void,
    ) -> HWND);
    whack_export!(pub extern "system" RegisterClassExA(*const WNDCLASSEXA) -> ATOM);
    whack_export!(pub extern "system" GetSystemMetrics(i32) -> i32);
    whack_export!(pub extern "system" GetProcAddress(HMODULE, *const i8) -> FARPROC);
    whack_export!(pub extern "system" IsIconic(HWND) -> u32);
    whack_export!(pub extern "system" IsWindowVisible(HWND) -> u32);
    whack_export!(pub extern "system" ClientToScreen(HWND, *mut POINT) -> u32);
    whack_export!(pub extern "system" ScreenToClient(HWND, *mut POINT) -> u32);
    whack_export!(pub extern "system" GetClientRect(HWND, *mut RECT) -> u32);
    whack_export!(pub extern "system" GetCursorPos(*mut POINT) -> u32);
    whack_export!(pub extern "system" SetCursorPos(i32, i32) -> i32);
    whack_export!(pub extern "system" ClipCursor(*const RECT) -> i32);
    whack_export!(pub extern "system" SetCapture(HWND) -> HWND);
    whack_export!(pub extern "system" ReleaseCapture() -> u32);
    whack_export!(pub extern "system" ShowWindow(HWND, i32) -> u32);
    whack_export!(pub extern "system" GetKeyState(i32) -> i32);
    whack_export!(pub extern "system" CreateCompatibleBitmap(HDC, i32, i32) -> HBITMAP);
    whack_export!(pub extern "system" DeleteObject(HGDIOBJ) -> u32);
    whack_export!(pub extern "system" GetObjectA(HGDIOBJ, u32, *mut c_void) -> u32);
    whack_export!(pub extern "system" GetBitmapBits(HBITMAP, u32, *mut c_void) -> u32);

    whack_hooks!(stdcall, 0x00400000,
        0x0041E280 => RenderScreen();
    );
}

mod scr_hooks {
    use super::{
        c_void, ATOM, HINSTANCE, HMENU, HWND, WNDCLASSEXW, DEVMODEW,
    };
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
    );
}

struct ChangeDisplaySettingsParams {
    /// With terminating 0
    device_name: Option<Vec<u16>>,
    devmode: DEVMODEW,
    flags: u32,
}

unsafe fn c_str_opt<'a>(val: *const i8) -> Option<&'a CStr> {
    if val.is_null() {
        None
    } else {
        Some(CStr::from_ptr(val))
    }
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

unsafe extern "system" fn wnd_proc(window: HWND, msg: u32, wparam: usize, lparam: isize) -> isize {
    if std::thread::panicking() {
        // Avoid recursive locking due to panics
        return DefWindowProcA(window, msg, wparam, lparam);
    }

    let mut lparam = lparam;
    match msg {
        WM_NCHITTEST => {
            let display_mode = with_forge(|forge| forge.settings.display_mode);
            if display_mode != DisplayMode::Window {
                return HTCLIENT;
            }
        }
        WM_NCLBUTTONDOWN | WM_NCLBUTTONUP | WM_NCMOUSEMOVE | WM_NCPAINT | WM_ACTIVATE
        | WM_CAPTURECHANGED | WM_KILLFOCUS | WM_PAINT | WM_SETFOCUS | WM_SHOWWINDOW | WM_SIZE
        | WM_WINDOWPOSCHANGED | WM_WINDOWPOSCHANGING => {
            return DefWindowProcA(window, msg, wparam, lparam);
        }
        WM_DISPLAYCHANGE => {
            // TODO(tec27): we might need to do something with this, swallowing DISPLAYCHANGE is
            // the first attempt at fixing the "Launch fullscreen BW while in ShieldBattery
            // game = OMFG WHY IS ALL MY RENDERING MESSED UP?" bug
            return DefWindowProcA(window, msg, wparam, lparam);
        }
        WM_ACTIVATEAPP => {
            // BW needs to receive the initial WM_ACTIVATEAPP to function properly.
            let was_active = with_forge(|forge| {
                let was = forge.bw_window_active;
                forge.bw_window_active = true;
                was
            });
            if was_active {
                return DefWindowProcA(window, msg, wparam, lparam);
            }
        }
        WM_SYSCOMMAND => {
            if wparam == SC_KEYMENU || wparam == SC_MOUSEMENU {
                return 0;
            } else if wparam != SC_CLOSE {
                return DefWindowProcA(window, msg, wparam, lparam);
            }
        }
        WM_MOVE => {
            let x = (lparam & 0xffff) as i16 as i32;
            let y = (lparam >> 16) as i16 as i32;
            with_forge(|forge| {
                if let Some(ref mut window) = forge.window {
                    window.client_x = x;
                    window.client_y = y;
                }
            });
            return DefWindowProcA(window, msg, wparam, lparam);
        }
        WM_EXITSIZEMOVE => {
            let pos = with_forge(|forge| {
                if let Some(ref mut window) = forge.window {
                    Some((window.client_x, window.client_y))
                } else {
                    None
                }
            });
            if let Some(pos) = pos {
                send_game_msg_to_async(GameThreadMessage::WindowMove(pos.0, pos.1));
            }
        }
        WM_GETMINMAXINFO => {
            // Make it so Windows doesn't limit this window to the display resolution, so we can
            // size the client area to precisely match the display resolution
            // (with borders hanging over)
            DefWindowProcA(window, msg, wparam, lparam);
            let min_max = lparam as *mut MINMAXINFO;
            if !min_max.is_null() {
                (*min_max).ptMaxTrackSize.x = 999999;
                (*min_max).ptMaxTrackSize.y = 999999;
            }
            return 0;
        }
        WM_LBUTTONDBLCLK | WM_LBUTTONDOWN | WM_LBUTTONUP | WM_MBUTTONDBLCLK | WM_MBUTTONDOWN
        | WM_MBUTTONUP | WM_RBUTTONDBLCLK | WM_RBUTTONDOWN | WM_RBUTTONUP | WM_XBUTTONDBLCLK
        | WM_XBUTTONDOWN | WM_XBUTTONUP | WM_MOUSEMOVE => {
            let x = (lparam & 0xffff) as i16;
            let y = (lparam >> 16) as i16;
            let (fake_x, fake_y) = with_forge(|forge| {
                // cache the actual mouse position for GetCursorPos
                forge.real_cursor_pos = (x, y);
                if forge.should_clip_cursor {
                    let clip_rect = forge.stored_cursor_rect.unwrap_or_else(|| RECT {
                        left: 0,
                        top: 0,
                        right: 640,
                        bottom: 480,
                    });
                    forge.perform_scaled_clip_cursor(&clip_rect);
                    forge.should_clip_cursor = false;
                }
                forge.client_to_game_pos(x, y)
            });
            lparam = (fake_x as u16 as isize) | ((fake_y as u16 as isize) << 16);
        }
        WM_SYSKEYDOWN => {
            if wparam as i32 == VK_MENU {
                with_forge(|forge| {
                    forge.should_clip_cursor = false;
                    forge.release_clip_cursor();
                });
            }
        }
        // WM_KEYUP is sent for alt if the user pressed another key while holding alt,
        // while WM_SYSKEYUP is sent if alt was just pressed by itself.
        WM_KEYUP | WM_SYSKEYUP => {
            if wparam as i32 == VK_MENU {
                with_forge(|forge| {
                    forge.should_clip_cursor = true;
                    if forge.cursor_in_window() {
                        if let Some(rect) = forge.stored_cursor_rect {
                            forge.perform_scaled_clip_cursor(&rect);
                        }
                    }
                });
            }
        }
        WM_NCACTIVATE => {
            // This has to be done in a tricky way to avoid recursive locking
            let mut key_release_messages = Vec::new();
            let mut orig_wnd_proc = None;
            with_forge(|forge| {
                orig_wnd_proc = forge.orig_wnd_proc;
                let activate = wparam != 0;
                forge.window_active = activate;
                if activate {
                    // Window is now active
                    forge.should_clip_cursor = true;
                } else {
                    // Window is now inactive, unclip the mouse (and disable input)
                    forge.should_clip_cursor = false;
                    forge.release_clip_cursor();
                    // As we don't give the activation messages to bw, send some key release
                    // messages to prevent them from staying down once the window is activated again.
                    let significant_held_keys_in_bw = [
                        VK_MENU, VK_CONTROL, VK_SHIFT, VK_LBUTTON, VK_MBUTTON, VK_RBUTTON,
                    ];
                    for &key in significant_held_keys_in_bw.iter() {
                        if let Some(msg) = forge.release_held_key_message(key) {
                            key_release_messages.push(msg);
                        }
                    }
                }
            });
            if let Some(orig_wnd_proc) = orig_wnd_proc {
                for (msg, wparam, lparam) in key_release_messages {
                    orig_wnd_proc(window, msg, wparam, lparam);
                }
            }
            return DefWindowProcA(window, msg, wparam, lparam);
        }
        WM_GAME_STARTED => {
            msg_game_started(window);
            return 0;
        }
        WM_HOTKEY | WM_TIMER => msg_timer(window, wparam as i32),
        WM_SETCURSOR => {
            if (lparam & 0xffff) != HTCLIENT {
                return DefWindowProcA(window, msg, wparam, lparam);
            } else {
                SetCursor(null_mut());
                return 0;
            }
        }
        _ => (),
    }

    let orig_wnd_proc = with_forge(|f| f.orig_wnd_proc);
    if let Some(orig_wnd_proc) = orig_wnd_proc {
        orig_wnd_proc(window, msg, wparam, lparam)
    } else {
        DefWindowProcA(window, msg, wparam, lparam)
    }
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
                    (*new_pos).x, (*new_pos).y, (*new_pos).cx, (*new_pos).cy, (*new_pos).flags,
                );
            }
            _ => (),
        }
        None
    });
    let ret = if let Some(ret) = ret {
        ret
    } else {
        let orig_wnd_proc = with_forge(|f| f.orig_wnd_proc);
        if let Some(orig_wnd_proc) = orig_wnd_proc {
            orig_wnd_proc(window, msg, wparam, lparam)
        } else {
            DefWindowProcA(window, msg, wparam, lparam)
        }
    };
    ret
}

unsafe fn msg_game_started(window: HWND) {
    let mut display_change_request = None;
    debug!("Forge: Game started");
    with_forge(|forge| {
        forge.game_started = true;
        // This request must be handled while forge is not being accessed,
        // as ChangeDisplaySettingsExW will call WndProc before it returns.
        display_change_request = forge.display_change_request.take();
    });
    if let Some(ref mut params) = display_change_request {
        debug!("Applying delayed display settings change");
        let device_name = match params.device_name {
            Some(ref x) => x.as_ptr(),
            None => null(),
        };
        let result = ChangeDisplaySettingsExW(
            device_name,
            &mut params.devmode,
            null_mut(),
            params.flags,
            null_mut(),
        );
        if result != DISP_CHANGE_SUCCESSFUL {
            let os_string;
            let device_name_string = match params.device_name {
                Some(ref x) => {
                    os_string = os_string_from_winapi(x);
                    os_string.to_string_lossy()
                }
                None => "(Default device)".into(),
            };
            error!(
                "Changing display mode for {} failed. Result {:x}",
                device_name_string, result,
            );
        }
    }
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

        // Set the final window title for scene switchers to key off of. Note that this
        // is different from BW's "typical" title so that people don't have to reconfigure
        // scene switchers when moving between our service and others.
        SetWindowTextA(window, "Brood War - ShieldBattery\0".as_ptr() as *const i8);

        // Show the window and bring it to the front
        ShowWindow(window, SW_SHOWNORMAL);
        SetForegroundWindow(window);

        with_forge(|forge| {
            if !forge.is_scr() {
                // Clip the cursor
                forge.perform_scaled_clip_cursor(&RECT {
                    left: 0,
                    top: 0,
                    right: 640,
                    bottom: 480,
                });
                // Move the cursor to the middle of the window
                forge.set_cursor_to_game_pos(320, 240);
            }
        });
        ShowCursor(1);
    }
}

fn register_class_a(
    class: *const WNDCLASSEXA,
    orig: unsafe extern fn(*const WNDCLASSEXA) -> ATOM,
) -> ATOM {
    unsafe {
        let name = c_str_opt((*class).lpszClassName);
        let is_bw_class = match name {
            None => false,
            Some(s) => s.to_str() == Ok("SWarClass"),
        };
        if !is_bw_class {
            return orig(class);
        }

        with_forge(|forge| {
            forge.orig_wnd_proc = (*class).lpfnWndProc;
        });
        let rewritten = WNDCLASSEXA {
            style: (*class).style | CS_OWNDC,
            lpfnWndProc: Some(wnd_proc),
            ..*class
        };
        debug!("Rewrote SWarClass to have CS_OWNDC");
        return orig(&rewritten);
    }
}

unsafe fn create_window_a(
    ex_style: u32,
    class_name: *const i8,
    window_name: *const i8,
    style: u32,
    x: i32,
    y: i32,
    width: i32,
    height: i32,
    parent: HWND,
    menu: HMENU,
    instance: HINSTANCE,
    param: *mut c_void,
    orig: unsafe extern fn(
        u32,
        *const i8,
        *const i8,
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
    let class = c_str_opt(class_name);
    debug!(
        "CreateWindowExA called for class {:?} ({}, {}), {}x{}",
        class, x, y, width, height,
    );
    let is_bw_window = match class {
        None => false,
        Some(s) => s.to_str() == Ok("SWarClass"),
    };
    if !is_bw_window {
        return orig(
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
    }
    // Access the global Forge instance to get setup parameters, but release the lock
    // before calling CreateWindowEx, as it calls wnd_proc.
    let (style, (left, top, width, height)) = with_forge(|forge| {
        assert!(forge.window.is_none());
        let settings = &forge.settings;
        let area = match settings.display_mode {
            DisplayMode::FullScreen => {
                let monitor_size = get_monitor_size();
                (0, 0, monitor_size.0, monitor_size.1)
            }
            DisplayMode::BorderlessWindow | DisplayMode::Window => {
                // Use the saved window coordinates (if available/applicable), or center the window otherwise
                // TODO(tec27): Check that the saved coordinates are still visible before we apply them
                let width = settings.width;
                let height = settings.height;
                let work_area = windows_work_area();
                let left = settings
                    .window_x
                    .unwrap_or_else(|| ((work_area.right - work_area.left) - width) / 2);
                let top = settings
                    .window_y
                    .unwrap_or_else(|| ((work_area.bottom - work_area.top) - height) / 2);
                (left, top, width, height)
            }
        };
        let style = match settings.display_mode {
            DisplayMode::FullScreen | DisplayMode::BorderlessWindow => WS_POPUP | WS_VISIBLE,
            DisplayMode::Window => WS_POPUP | WS_VISIBLE | WS_CAPTION | WS_SYSMENU,
        };
        (style, area)
    });
    set_dpi_aware();

    // we want the *client rect* to be our width/height, not the actual window size
    let mut window_rect = RECT {
        left,
        top,
        right: left + width,
        bottom: top + height,
    };
    AdjustWindowRect(&mut window_rect, style, 0);
    let window_width = window_rect.right - window_rect.left;
    let window_height = window_rect.bottom - window_rect.top;
    debug!(
        "Rewriting CreateWindowExA call to ({}, {}), {}x{}",
        window_rect.left, window_rect.top, window_width, window_height,
    );
    let window = orig(
        ex_style,
        class_name,
        // We change the window name here to make scene switching at the right time easier
        // (we set a different title just as we bring the window into the foreground)
        "ShieldBattery initializing...\0".as_ptr() as *const i8,
        style,
        window_rect.left,
        window_rect.top,
        window_width,
        window_height,
        parent,
        menu,
        instance,
        param,
    );
    // In some cases, Windows seems to not give us a window of the size we requested, so we also
    // re-apply the size and position here just in case
    SetWindowPos(
        window,
        HWND_BOTTOM,
        window_rect.left,
        window_rect.top,
        window_width,
        window_height,
        SWP_NOACTIVATE | SWP_HIDEWINDOW,
    );
    ShowWindow(window, SW_HIDE);
    with_forge(|forge| {
        forge.set_window(Window::new(
            window,
            left,
            top,
            width,
            height,
            &forge.settings,
        ));
    });
    window
}

lazy_static! {
    static ref FORGE: Mutex<Option<Forge>> = Mutex::new(None);
}

struct Forge {
    settings: Settings,
    renderer: Renderer,
    window: Option<Window>,
    orig_wnd_proc: Option<unsafe extern "system" fn(HWND, u32, usize, isize) -> isize>,
    should_clip_cursor: bool,
    real_cursor_pos: (i16, i16),
    stored_cursor_rect: Option<RECT>,
    game_started: bool,
    input_disabled: bool,
    bw_window_active: bool,
    window_active: bool,
    real_create_sound_buffer: Option<
        unsafe extern "system" fn(
            *mut IDirectSound,
            *const DSBUFFERDESC,
            *mut *mut IDirectSoundBuffer,
            *mut IUnknown,
        ) -> i32,
    >,
    active_bitmap: Option<HBITMAP>,
    captured_window: Option<HWND>,

    /// SCR refers to the window class with ATOM returned by RegisterClassExW
    /// (And the class is named OsWindow instead of 1.16.1 SWarClass)
    scr_window_class: Option<ATOM>,
    /// Delayed display change for SCR fullscreen switching.
    display_change_request: Option<ChangeDisplaySettingsParams>,
}

// Since it stores HBITMAP
unsafe impl Send for Forge {}

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
    fn is_scr(&self) -> bool {
        // Could be a separate flag but this also does the trick =)
        self.scr_window_class.is_some()
    }

    fn set_window(&mut self, window: Window) {
        assert!(self.window.is_none());
        FORGE_WINDOW.store(window.handle as usize, Ordering::Release);
        self.window = Some(window);
    }

    fn perform_scaled_clip_cursor(&mut self, rect: &RECT) -> i32 {
        self.input_disabled = false;
        let window = match self.window {
            Some(ref s) => s,
            None => return 1,
        };
        if !self.game_started {
            // if we're not actually in the game yet, just ignore any requests to lock the cursor
            return 1;
        }
        // BW thinks its running full screen 640x480, so it will request a 640x480 clip
        // Instead, we'll request a mouse_resolution-sized rect at the top-left of our client area
        let x_scale = window.mouse_resolution_width as f64 / 640.0;
        let y_scale = window.mouse_resolution_height as f64 / 480.0;

        let actual_rect = RECT {
            left: ((rect.left as f64 * x_scale + 0.5) as i32).wrapping_add(window.client_x),
            top: ((rect.top as f64 * y_scale + 0.5) as i32).wrapping_add(window.client_y),
            right: ((rect.right as f64 * x_scale + 0.5) as i32).wrapping_add(window.client_x),
            bottom: ((rect.bottom as f64 * y_scale + 0.5) as i32).wrapping_add(window.client_y),
        };
        unsafe { ClipCursor(&actual_rect) }
    }

    fn release_clip_cursor(&mut self) -> i32 {
        unsafe {
            self.input_disabled = true;
            ClipCursor(null_mut())
        }
    }

    fn cursor_in_window(&self) -> bool {
        unsafe {
            match self.window {
                Some(ref window) => {
                    let mut client_rect: RECT = mem::zeroed();
                    GetClientRect(window.handle, &mut client_rect);
                    let screen_rect = window.client_rect_to_screen(&client_rect);
                    let mut cursor_position: POINT = mem::zeroed();
                    GetCursorPos(&mut cursor_position);
                    self.window_active && PtInRect(&screen_rect, cursor_position) != 0
                }
                None => false,
            }
        }
    }

    fn release_held_key_message(&self, key: i32) -> Option<(u32, usize, isize)> {
        let (x, y) = self.client_to_game_pos(self.real_cursor_pos.0, self.real_cursor_pos.1);
        let mouse_lparam = (x as u16 as isize) | ((y as u16 as isize) << 16);
        unsafe {
            if GetAsyncKeyState(key) as u16 & 0x8000 != 0 {
                return Some(match key {
                    VK_LBUTTON => (WM_LBUTTONUP, 0, mouse_lparam),
                    VK_RBUTTON => (WM_RBUTTONUP, 0, mouse_lparam),
                    VK_MBUTTON => (WM_MBUTTONUP, 0, mouse_lparam),
                    // lparam could be better, but bw shouldn't even look at it..
                    other => (WM_KEYUP, other as usize, 0xc0000001u32 as isize),
                });
            }
        }
        None
    }

    /// Converts window's client area -relative coordinates to BW's screen coordinates.
    ///
    /// That is, depending on mouse scaling, X coordinates may be converted from
    /// (0..640) range to (0..640) (Sensitivity same as normal 1.16.1),
    /// (0..window_width) to (0..640) (Sensitivity same as in desktop),
    /// or to something in between those extremes.
    fn client_to_game_pos(&self, x: i16, y: i16) -> (i16, i16) {
        match self.window {
            Some(ref w) => {
                let x = ((x as f64 * 640.0 / w.mouse_resolution_width as f64) + 0.5) as i16;
                let y = ((y as f64 * 480.0 / w.mouse_resolution_height as f64) + 0.5) as i16;
                (x, y)
            }
            None => (0, 0),
        }
    }

    fn game_pos_to_screen(&self, x: i32, y: i32) -> (i32, i32) {
        match self.window {
            Some(ref w) => {
                let x = ((x as f64 * w.mouse_resolution_width as f64 / 640.0) + 0.5) as i32
                    + w.client_x;
                let y = ((y as f64 * w.mouse_resolution_height as f64 / 480.0) + 0.5) as i32
                    + w.client_y;
                (x, y)
            }
            None => (0, 0),
        }
    }

    /// Calls winapi SetCursorPos, input coordinates are from BW's point of view.
    ///
    /// Return value is also equivalent to what SetCursorPos returns (0 fail, 1 success).
    fn set_cursor_to_game_pos(&self, x: i32, y: i32) -> i32 {
        // if we're not actually in the game yet, just ignore any requests to reposition the cursor
        if !self.game_started {
            return 1;
        }
        let (x, y) = self.game_pos_to_screen(x, y);
        unsafe { SetCursorPos(x, y) }
    }
}

impl Window {
    fn client_rect_to_screen(&self, client_rect: &RECT) -> RECT {
        unsafe {
            let mut top_left = POINT {
                x: client_rect.left,
                y: client_rect.top,
            };
            ClientToScreen(self.handle, &mut top_left);
            let mut bottom_right = POINT {
                x: client_rect.right,
                y: client_rect.bottom,
            };
            ClientToScreen(self.handle, &mut bottom_right);
            RECT {
                left: top_left.x,
                top: top_left.y,
                right: bottom_right.x,
                bottom: bottom_right.y,
            }
        }
    }
}

const MOUSE_SETTING_MAX: u8 = 10;
pub struct Settings {
    mouse_sensitivity: u8,
    display_mode: DisplayMode,
    window_x: Option<i32>,
    window_y: Option<i32>,
    width: i32,
    height: i32,
    maintain_aspect_ratio: bool,
}

impl Settings {
    fn get_output_size(&self, client_rect: &RECT, ddraw_width: u32, ddraw_height: u32) -> RECT {
        let mut result = RECT {
            left: 0,
            top: 0,
            right: client_rect.right,
            bottom: client_rect.bottom,
        };
        if self.display_mode == DisplayMode::FullScreen && self.maintain_aspect_ratio {
            let original_ratio = ddraw_width as f32 / ddraw_height as f32;
            let actual_ratio = result.right as f32 / result.bottom as f32;
            if original_ratio > actual_ratio {
                // we want to avoid having fractional parts to avoid weird alignments in linear
                // filtering, so we decrease the width until no fractions are necessary. Since BW
                // s 4:3, this can be done in 3 steps or less
                let mut height_unrounded = result.right as f32 / original_ratio;
                while height_unrounded.fract() > 0.0001 {
                    result.right -= 1;
                    height_unrounded = result.right as f32 / original_ratio;
                }
                result.bottom = height_unrounded as i32;
            } else {
                let mut width_unrounded = result.bottom as f32 * original_ratio;
                while width_unrounded.fract() > 0.0001 {
                    result.bottom -= 1;
                    width_unrounded = result.bottom as f32 * original_ratio;
                }
                result.right = width_unrounded as i32;
            }

            // Center the frame in the screen
            if result.right < client_rect.right {
                result.left = ((client_rect.right - result.right) as f32 / 2.0 + 0.5) as i32;
                result.right += result.left;
            }
            if result.bottom < client_rect.bottom {
                result.top = ((client_rect.bottom - result.bottom) as f32 / 2.0 + 0.5) as i32;
                result.bottom += result.top;
            }
        }
        result
    }
}

#[derive(Copy, Clone, Debug, Eq, PartialEq)]
enum DisplayMode {
    FullScreen,
    BorderlessWindow,
    Window,
}

struct Window {
    handle: HWND,
    client_x: i32,
    client_y: i32,
    mouse_resolution_width: i32,
    mouse_resolution_height: i32,
}

unsafe impl Send for Window {}

impl Window {
    pub fn new(
        handle: HWND,
        client_x: i32,
        client_y: i32,
        width: i32,
        height: i32,
        settings: &Settings,
    ) -> Window {
        let (mouse_resolution_width, mouse_resolution_height) =
            Window::calculate_mouse_resolution(width, height, settings);
        Window {
            handle,
            client_x,
            client_y,
            mouse_resolution_width,
            mouse_resolution_height,
        }
    }

    fn calculate_mouse_resolution(width: i32, height: i32, settings: &Settings) -> (i32, i32) {
        let width = width as f64;
        let height = height as f64;
        let original_ratio = 640.0 / 480.0;
        let actual_ratio = width / height;
        let mouse_width;
        let mouse_height;
        if actual_ratio - original_ratio >= 0.001 {
            // Means the screen has a wider aspect ratio than 4:3 (typical)
            let delta = (height - 480.0) / MOUSE_SETTING_MAX as f64;
            mouse_height = (height - (delta * settings.mouse_sensitivity as f64)) + 0.5;
            mouse_width = (mouse_height * 4.0 / 3.0) + 0.5;
        } else {
            // Means the screen has a narrower aspect ratio than 4:3 (usually means 1280x1024)
            let delta = (width - 640.0) / MOUSE_SETTING_MAX as f64;
            mouse_width = (width - (delta * settings.mouse_sensitivity as f64)) + 0.5;
            mouse_height = (mouse_width * 3.0 / 4.0) + 0.5;
        }
        debug!(
            "Mouse Resolution: {}x{}",
            mouse_width as i32, mouse_height as i32
        );
        (mouse_width as i32, mouse_height as i32)
    }
}

fn windows_work_area() -> RECT {
    unsafe {
        let mut out: RECT = mem::zeroed();
        SystemParametersInfoA(SPI_GETWORKAREA, 0, &mut out as *mut RECT as *mut _, 0);
        out
    }
}

fn get_monitor_size() -> (i32, i32) {
    unsafe { (GetSystemMetrics(SM_CXSCREEN), GetSystemMetrics(SM_CYSCREEN)) }
}

// This is an inline function in Microsoft headers, so winapi doesn't have it.
fn is_win8_point1_or_greater() -> bool {
    use winapi::um::winbase::VerifyVersionInfoW;
    use winapi::um::winnt::{
        VerSetConditionMask, OSVERSIONINFOEXW, VER_GREATER_EQUAL, VER_MAJORVERSION,
        VER_MINORVERSION, VER_SERVICEPACKMAJOR,
    };
    unsafe {
        let mut info = OSVERSIONINFOEXW {
            dwOSVersionInfoSize: mem::size_of::<OSVERSIONINFOEXW>() as u32,
            dwMajorVersion: 0x6,
            dwMinorVersion: 0x3,
            wServicePackMajor: 0,
            ..mem::zeroed()
        };
        let condition_mask = VerSetConditionMask(
            VerSetConditionMask(
                VerSetConditionMask(0, VER_MAJORVERSION, VER_GREATER_EQUAL),
                VER_MINORVERSION,
                VER_GREATER_EQUAL,
            ),
            VER_SERVICEPACKMAJOR,
            VER_GREATER_EQUAL,
        );
        VerifyVersionInfoW(
            &mut info,
            VER_MAJORVERSION | VER_MINORVERSION | VER_SERVICEPACKMAJOR,
            condition_mask,
        ) != 0
    }
}

fn set_dpi_aware() {
    unsafe {
        if is_win8_point1_or_greater() {
            match crate::windows::load_library("shcore.dll") {
                Ok(shcore) => match shcore.proc_address("SetProcessDpiAwareness") {
                    Ok(func) => {
                        const PROCESS_PER_MONITOR_DPI_AWARE: u32 = 2;
                        let func: unsafe extern "system" fn(u32) -> i32 = mem::transmute(func);
                        let result = func(PROCESS_PER_MONITOR_DPI_AWARE);
                        if result == 0 {
                            return;
                        } else {
                            let err = io::Error::from_raw_os_error(result);
                            error!("SetProcessDpiAwareness failed: {}", err);
                        }
                    }
                    Err(e) => {
                        error!("Couldn't find SetProcessDpiAwareness: {}", e);
                    }
                },
                Err(e) => {
                    error!("Couldn't load shcore.dll: {}", e);
                }
            }
        }
        match crate::windows::load_library("user32.dll") {
            Ok(user32) => match user32.proc_address("SetProcessDPIAware") {
                Ok(func) => {
                    let func: unsafe extern "system" fn() -> u32 = mem::transmute(func);
                    func();
                }
                Err(e) => {
                    error!("Couldn't find SetProcessDPIAware: {}", e);
                }
            },
            Err(e) => {
                error!("Couldn't load user32.dll: {}", e);
            }
        }
    }
}

fn render_screen(orig: unsafe extern fn()) {
    unsafe {
        orig();
    }
    with_forge(|forge| {
        if forge.game_started {
            forge.renderer.render();
        }
    });
}

fn get_system_metrics(index: i32, orig: unsafe extern fn(i32) -> i32) -> i32 {
    match index {
        SM_CXSCREEN | SM_CXFULLSCREEN => 640,
        SM_CYSCREEN | SM_CYFULLSCREEN => 480,
        _ => unsafe { orig(index) },
    }
}

unsafe fn get_proc_address(
    module: HMODULE,
    name: *const i8,
    orig: unsafe extern fn(HMODULE, *const i8) -> FARPROC,
) -> FARPROC {
    match CStr::from_ptr(name).to_str() {
        Ok("DirectDrawCreate") => {
            debug!("Injecting custom DirectDrawCreate");
            indirect_draw::direct_draw_create as usize as FARPROC
        }
        Ok("DirectSoundCreate8") => {
            debug!("Injecting custom DirectSoundCreate8");
            direct_sound_create as usize as FARPROC
        }
        _ => orig(module, name),
    }
}

unsafe extern "system" fn direct_sound_create(
    device: *const GUID,
    out: *mut *mut IDirectSound,
    unused: *mut IUnknown,
) -> i32 {
    unsafe fn inner(
        device: *const GUID,
        out: *mut *mut IDirectSound,
        unused: *mut IUnknown,
    ) -> Result<i32, io::Error> {
        // Returning Ok() here means that our custom hooking didn't error, not necessarily
        // that windows succeeeded.
        use crate::windows;

        type DirectDrawCreatePtr =
            unsafe extern "system" fn(*const GUID, *mut *mut IDirectSound, *mut IUnknown) -> i32;

        let dsound = windows::load_library("dsound.dll")?;
        let real_create = dsound.proc_address("DirectSoundCreate8")?;
        let real_create: DirectDrawCreatePtr = mem::transmute(real_create);

        let result = real_create(device, out, unused);
        if result != DS_OK {
            debug!(
                "DirectSound creation failed: {} / {}",
                result,
                io::Error::from_raw_os_error(result),
            );
            return Ok(result);
        }
        debug!("DirectSound created");
        let vtable = (**out).lpVtbl as *mut IDirectSoundVtbl;
        let _guard = windows::unprotect_memory(vtable as *mut c_void, 0x20)?;
        with_forge(|forge| {
            forge.real_create_sound_buffer = Some((*vtable).CreateSoundBuffer);
        });
        (*vtable).CreateSoundBuffer = create_sound_buffer;
        debug!("CreateSoundBuffer hooked");
        Ok(DS_OK)
    }
    inner(device, out, unused)
        .unwrap_or_else(|e| panic!("DirectSound initialization failed: {}", e))
}

unsafe extern "system" fn create_sound_buffer(
    this: *mut IDirectSound,
    desc: *const DSBUFFERDESC,
    buffer: *mut *mut IDirectSoundBuffer,
    unused: *mut IUnknown,
) -> i32 {
    let orig = with_forge(|forge| forge.real_create_sound_buffer.unwrap());
    if (*desc).dwFlags & (DSBCAPS_GLOBALFOCUS | (*desc).dwFlags & DSBCAPS_PRIMARYBUFFER) != 0 {
        orig(this, desc, buffer, unused)
    } else {
        let mut fixed = *desc;
        fixed.dwFlags |= DSBCAPS_GLOBALFOCUS;
        orig(this, &fixed, buffer, unused)
    }
}

unsafe fn is_iconic(window: HWND, orig: unsafe extern fn(HWND) -> u32) -> u32 {
    if is_forge_window(window) {
        0
    } else {
        orig(window)
    }
}

unsafe fn is_window_visible(window: HWND, orig: unsafe extern fn(HWND) -> u32) -> u32 {
    if is_forge_window(window) {
        1
    } else {
        orig(window)
    }
}

unsafe fn client_to_screen(
    window: HWND,
    point: *mut POINT,
    orig: unsafe extern fn(HWND, *mut POINT) -> u32,
) -> u32 {
    if is_forge_window(window) {
        // We want BW to think its full screen, and therefore any coordinates it wants in
        // screenspace would be the same as the ones its passing in
        1
    } else {
        orig(window, point)
    }
}

unsafe fn get_client_rect(
    window: HWND,
    out: *mut RECT,
    orig: unsafe extern fn(HWND, *mut RECT) -> u32,
) -> u32 {
    if is_forge_window(window) {
        (*out) = RECT {
            left: 0,
            top: 0,
            right: 640,
            bottom: 480,
        };
        1
    } else {
        orig(window, out)
    }
}

unsafe fn get_cursor_pos(val: *mut POINT) -> u32 {
    // BW thinks its running full screen in 640x480, so we give it our mouse_resolution-scaled coords
    let (x, y) = with_forge(|forge| {
        forge.client_to_game_pos(forge.real_cursor_pos.0, forge.real_cursor_pos.1)
    });
    (*val).x = x as i32;
    (*val).y = y as i32;
    1
}

unsafe fn set_cursor_pos(x: i32, y: i32) -> i32 {
    with_forge(|forge| forge.set_cursor_to_game_pos(x, y))
}

fn scr_set_cursor_pos(x: i32, y: i32, orig: unsafe extern fn(i32, i32) -> i32) -> i32 {
    // Unlike 1161, SCR is aware of the desktop resolution,
    // so we just have to block this if the game hasn't started yet.
    if !scr_hooks_disabled() {
        let game_started = with_forge(|forge| forge.game_started);
        if !game_started {
            return 1;
        }
    }
    unsafe {
        orig(x, y)
    }
}

unsafe fn clip_cursor(rect: *const RECT) -> i32 {
    with_forge(|forge| {
        if rect.is_null() {
            forge.stored_cursor_rect = None;
            forge.release_clip_cursor()
        } else {
            forge.stored_cursor_rect = Some(*rect);
            if forge.cursor_in_window() {
                forge.perform_scaled_clip_cursor(&*rect)
            } else {
                1
            }
        }
    })
}

unsafe fn set_capture(window: HWND) -> HWND {
    with_forge(|forge| {
        if let Some(window) = forge.captured_window {
            PostMessageA(window, WM_CAPTURECHANGED, 0, window as isize);
        }
        forge.captured_window = Some(window);
    });
    window
}

unsafe fn release_capture() -> u32 {
    with_forge(|forge| {
        forge.captured_window = None;
    });
    1
}

fn show_window(window: HWND, show: i32, orig: unsafe extern fn(HWND, i32) -> u32) -> u32 {
    // SCR May have reasons to hide/reshow window, so allow that once game has started.
    // (Though it seems to be calling SetWindowPos always instead)
    // Never allow 1161's ShowWindow cals to get through.
    unsafe {
        let call_orig = if is_forge_window(window) && !scr_hooks_disabled() {
            with_forge(|forge| forge.is_scr() && forge.game_started)
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

fn set_window_pos(
    hwnd: HWND,
    hwnd_after: HWND,
    x: i32,
    y: i32,
    w: i32,
    h: i32,
    flags: u32,
    orig: unsafe extern fn(HWND, HWND, i32, i32, i32, i32, u32) -> u32,
) -> u32 {
    // Add SWP_NOACTIVATE | SWP_HIDEWINDOW when scr calls this during
    // its window creation, which happens early enough in loading that
    // we don't want to show the window yet.
    unsafe {
        debug!("SetWindowPos {:p} {},{} {},{} flags {:x}", hwnd, x, y, w, h, flags);
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
    orig: unsafe extern fn(*const u16, *mut DEVMODEW, HWND, u32, *mut c_void) -> i32,
) -> i32 {
    unsafe {
        // We want to block SCR from switching to fullscreen before game has completely started,
        // buffer the change request if it occurs while we're loading.
        // (Note: Exclusive fullscreen only; windowed fullscreen calls this without setting
        // devmode)
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
                (*devmode).dmSize, mem::size_of::<DEVMODEW>(),
            );
            return orig(device_name, devmode, hwnd, flags, param);
        }
        let call_orig = if !scr_hooks_disabled() {
            with_forge(|forge| {
                if forge.game_started {
                    true
                } else {
                    if devmode.is_null() {
                        // Resetting to default settings (out of fullscreen),
                        // so clear any buffered fullscreen request we may have.
                        forge.display_change_request = None;
                    } else {
                        debug!("Delaying ChangeDisplaySettingsExW");
                        let device_name = if device_name.is_null() {
                            None
                        } else {
                            let len = (0..).find(|&i| *device_name.add(i) == 0).unwrap();
                            let slice = std::slice::from_raw_parts(device_name, len + 1);
                            Some(slice.into())
                        };
                        forge.display_change_request = Some(ChangeDisplaySettingsParams {
                            device_name,
                            devmode: devmode.read(),
                            flags,
                        });
                    }
                    false
                }
            })
        } else {
            true
        };
        if call_orig {
            debug!("Letting ChangeDisplaySettingsExW of window {:p} pass through", hwnd);
            orig(device_name, devmode, hwnd, flags, param)
        } else {
            DISP_CHANGE_SUCCESSFUL
        }
    }
}

fn get_key_state(key: i32, orig: unsafe extern fn(i32) -> i32) -> i32 {
    if with_forge(|forge| forge.window_active) {
        unsafe {
            orig(key)
        }
    } else {
        // This will get run at least from WM_NCACTIVATE handler's key
        // releasing code, as bw checks the state of modifier keys.
        // If bw checks key state for some other reason while the window
        // is not active, it shouldn't be acting on it anyways.
        0
    }
}

unsafe fn create_compatible_bitmap(
    dc: HDC,
    width: i32,
    height: i32,
    orig: unsafe extern fn(HDC, i32, i32) -> HBITMAP,
) -> HBITMAP {
    // We have to track the one bitmap BW creates, so we can tell BW it's 8 bits per pixel when it
    // calls GetObject on it.
    let result = orig(dc, width, height);
    if !result.is_null() {
        with_forge(|forge| {
            if forge.active_bitmap.is_some() {
                warn!("BW is using multiple bitmaps at once?");
            }
            forge.active_bitmap = Some(result);
        });
    }
    result
}

unsafe fn gdi_delete_object(object: HGDIOBJ, orig: unsafe extern fn(HGDIOBJ) -> u32) -> u32 {
    with_forge(|forge| {
        if forge.active_bitmap == Some(object as *mut _) {
            forge.active_bitmap = None;
        }
    });
    orig(object)
}

unsafe fn gdi_get_object(
    object: HGDIOBJ,
    size: u32,
    out: *mut c_void,
    orig: unsafe extern fn(HGDIOBJ, u32, *mut c_void) -> u32,
) -> u32 {
    let result = orig(object, size, out);
    if result != 0 && with_forge(|forge| forge.active_bitmap == Some(object as *mut _)) {
        let bitmap = out as *mut BITMAP;
        (*bitmap).bmWidthBytes = (*bitmap).bmWidth;
        (*bitmap).bmBitsPixel = 1;
        // Fortunately BW doesn't care about the data pointer.
    }
    result
}

unsafe fn get_bitmap_bits(
    bitmap: HBITMAP,
    size: u32,
    bits: *mut c_void,
    orig: unsafe extern fn(HBITMAP, u32, *mut c_void) -> u32,
) -> u32 {
    // BW 1.16.1 calls GetBitmapBits only when drawing korean text.
    // (It uses Gdi32 DrawText to draw it to a bitmap DC, and then reads it from there)
    // Since BW believes it has told Windows it is using 8-bit video mode, it assumes that
    // GetBitmapBits returns 8bpp bitmap, so we have to fix it up.
    // This hook assumes that the text is always drawn as simple white-on-black text (which it is).
    //
    // Technically, it seems that it should be possible to just make windows use 8bpp bitmaps, but
    // I wasn't able to make it work.

    // Maybe the DC isn't always 32-bit? I'm not trusting Windows being consistent or sensible.
    let window = match with_forge(|forge| forge.window.as_ref().map(|x| x.handle)) {
        Some(s) => s,
        None => return 0,
    };
    let dc = GetDC(window);
    if dc.is_null() {
        error!(
            "GetBitmapBitsHook couldn't access default DC: {}",
            io::Error::last_os_error()
        );
        // BW actually doesn't check the return value D:
        return 0;
    }
    let bpp = GetDeviceCaps(dc, BITSPIXEL) as u32;
    ReleaseDC(window, dc);
    if bpp % 8 != 0 || bpp > 32 || bpp == 0 {
        error!("Nonsensical value for DC bit depth: {}", bpp);
        return 0;
    }

    // 0xff, 0xffff, etc
    let pixel_mask = ((1 << bpp as u64) - 1) as u32;
    let bytes_per_pixel = bpp / 8;
    let mut buffer = vec![0; size as usize * bytes_per_pixel as usize];
    let bytes_read = orig(
        bitmap,
        size * bytes_per_pixel,
        buffer.as_mut_ptr() as *mut c_void,
    );

    let mut bw_buffer = bits as *mut u8;
    let mut pos = 0;
    while pos < bytes_read as usize {
        let val = (buffer.as_ptr().add(pos) as *const u32).read_unaligned() & pixel_mask;
        *bw_buffer.add(pos) = match val {
            0 => 0,
            _ => 255,
        };
        pos += bytes_per_pixel as usize;
        bw_buffer = bw_buffer.add(1);
    }
    bytes_read / bytes_per_pixel
}

fn register_class_w(
    class: *const WNDCLASSEXW,
    orig: unsafe extern fn(*const WNDCLASSEXW) -> ATOM,
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
    orig: unsafe extern fn(
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
                        // This maybe should do SetWindowPos like the 1161 hook does,
                        // but trusting that the x/y/w/h are fine for now.
                        forge.set_window(Window::new(
                            window,
                            x,
                            y,
                            width,
                            height,
                            &forge.settings,
                        ));
                    }
                }
            });
        }
        window
    }
}

fn get_window_long_w(
    window: HWND,
    long: i32,
    orig: unsafe extern fn(HWND, i32) -> u32,
) -> u32 {
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

pub unsafe fn init_hooks_1161(patcher: &mut whack::Patcher) {
    use self::hooks::*;
    let mut starcraft = patcher.patch_exe(0x0040_0000);
    starcraft.import_hook_opt(&b"user32"[..], CreateWindowExA, create_window_a);
    starcraft.import_hook_opt(&b"user32"[..], RegisterClassExA, register_class_a);
    starcraft.import_hook_opt(&b"user32"[..], GetSystemMetrics, get_system_metrics);
    starcraft.import_hook_opt(&b"kernel32"[..], GetProcAddress, get_proc_address);
    starcraft.import_hook_opt(&b"user32"[..], IsIconic, is_iconic);
    starcraft.import_hook_opt(&b"user32"[..], ClientToScreen, client_to_screen);
    starcraft.import_hook_opt(&b"user32"[..], GetClientRect, get_client_rect);
    starcraft.import_hook(&b"user32"[..], GetCursorPos, get_cursor_pos);
    starcraft.import_hook(&b"user32"[..], SetCursorPos, set_cursor_pos);
    starcraft.import_hook(&b"user32"[..], ClipCursor, clip_cursor);
    starcraft.import_hook(&b"user32"[..], SetCapture, set_capture);
    starcraft.import_hook(&b"user32"[..], ReleaseCapture, release_capture);
    starcraft.import_hook_opt(&b"user32"[..], ShowWindow, show_window);
    starcraft.import_hook_opt(&b"user32"[..], GetKeyState, get_key_state);
    starcraft.import_hook_opt(
        &b"gdi32"[..],
        CreateCompatibleBitmap,
        create_compatible_bitmap,
    );
    starcraft.import_hook_opt(&b"gdi32"[..], DeleteObject, gdi_delete_object);
    starcraft.import_hook_opt(&b"gdi32"[..], GetObjectA, gdi_get_object);
    starcraft.import_hook_opt(&b"gdi32"[..], GetBitmapBits, get_bitmap_bits);
    starcraft.hook_opt(RenderScreen, render_screen);
    starcraft.apply();

    let mut storm = patcher.patch_library("storm", 0x1500_0000);
    storm.import_hook_opt(&b"user32"[..], IsIconic, is_iconic);
    storm.import_hook_opt(&b"user32"[..], IsWindowVisible, is_window_visible);
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
    );
}

pub fn init(settings: &serde_json::Map<String, serde_json::Value>) {
    let mouse_sensitivity = settings
        .get("v1161mouseSensitivity")
        .and_then(|x| x.as_u64())
        .filter(|&x| x <= MOUSE_SETTING_MAX as u64)
        .map(|x| x as u8)
        .unwrap_or_else(|| {
            warn!("Using default mouse sensitivity");
            0
        });
    let display_mode = settings
        .get("v1161displayMode")
        .and_then(|x| x.as_u64())
        .and_then(|s| match s {
            0 => Some(DisplayMode::FullScreen),
            1 => Some(DisplayMode::BorderlessWindow),
            2 => Some(DisplayMode::Window),
            x => {
                warn!("Unknown display mode {}", x);
                None
            }
        })
        .unwrap_or_else(|| {
            warn!("Using default display mode");
            DisplayMode::FullScreen
        });
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

    let maintain_aspect_ratio = settings
        .get("v1161maintainAspectRatio")
        .and_then(|x| x.as_bool())
        .unwrap_or_else(|| {
            warn!("Using default value for maintainAspectRatio");
            true
        });
    let settings = Settings {
        mouse_sensitivity,
        display_mode,
        window_x,
        window_y,
        width: width as i32,
        height: height as i32,
        maintain_aspect_ratio,
    };
    *FORGE.lock().unwrap() = Some(Forge {
        settings,
        window: None,
        renderer: Renderer::new(),
        orig_wnd_proc: None,
        should_clip_cursor: false,
        real_cursor_pos: (0, 0),
        stored_cursor_rect: None,
        game_started: false,
        input_disabled: false,
        bw_window_active: false,
        window_active: false,
        real_create_sound_buffer: None,
        active_bitmap: None,
        captured_window: None,
        scr_window_class: None,
        display_change_request: None,
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
    let handle = with_forge(|forge| match forge.window {
        Some(ref s) => Some(s.handle),
        None => None,
    });
    if let Some(handle) = handle {
        unsafe {
            PostMessageA(handle, WM_GAME_STARTED, 0, 0);
        }
    }
}

pub fn hide_window() {
    let handle = with_forge(|forge| match forge.window {
        Some(ref s) => Some(s.handle),
        None => None,
    });
    if let Some(handle) = handle {
        unsafe {
            with_scr_hooks_disabled(|| {
                ShowWindow(handle, SW_HIDE);
            });
        }
    }
}

pub fn input_disabled() -> bool {
    with_forge(|forge| forge.input_disabled)
}
