mod renderer;

use std::ffi::CStr;
use std::mem;
use std::ptr::null_mut;
use std::sync::Mutex;

use lazy_static::lazy_static;
use libc::c_void;

use winapi::shared::minwindef::{ATOM, HINSTANCE};
use winapi::shared::windef::{HMENU, HWND, POINT, RECT};
use winapi::um::winuser::{
    AdjustWindowRect, ClipCursor, DispatchMessageA, GetMessageA, TranslateMessage, PostMessageA,
    SetWindowPos, ShowWindow, PtInRect, GetCursorPos, GetClientRect, ClientToScreen,
    MSG, CS_OWNDC, HWND_BOTTOM, SW_HIDE, SWP_NOACTIVATE, SWP_HIDEWINDOW, WNDCLASSEXA, WS_CAPTION,
    WS_POPUP, WS_VISIBLE, WS_SYSMENU, WM_USER,
};

use crate::{game_thread_message, GameThreadMessage};

use self::renderer::Renderer;

whack_export!(pub extern "system" CreateWindowExA(
    u32, *const i8, *const i8, u32, i32, i32, i32, i32, HWND, HMENU, HINSTANCE, *mut c_void,
) -> HWND);
whack_export!(pub extern "system" RegisterClassExA(*const WNDCLASSEXA) -> ATOM);

whack_hooks!(stdcall, 0x00400000,
    0x004E0660 => CrashBeforeWindowCreation();
);

unsafe fn c_str_opt<'a>(val: *const i8) -> Option<&'a CStr> {
    if val.is_null() {
        None
    } else {
        Some(CStr::from_ptr(val))
    }
}

unsafe extern "system" fn wnd_proc(window: HWND, msg: u32, wparam: usize, lparam: isize) -> isize {
    use winapi::um::winuser::*;
    const FOREGROUND_HOTKEY_ID: i32 = 1337;
    const FOREGROUND_HOTKEY_TIMEOUT: u32 = 1000;

    let mut lparam = lparam;
    match msg {
        WM_NCHITTEST => {
            let display_mode = with_forge(|forge| forge.settings.display_mode);
            if display_mode != DisplayMode::Window {
                return HTCLIENT;
            }
        }
        WM_NCLBUTTONDOWN | WM_NCLBUTTONUP | WM_NCMOUSEMOVE | WM_NCPAINT | WM_ACTIVATE |
            WM_CAPTURECHANGED | WM_KILLFOCUS | WM_PAINT | WM_SETFOCUS | WM_SHOWWINDOW |
            WM_SIZE | WM_WINDOWPOSCHANGED | WM_WINDOWPOSCHANGING =>
        {
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
                game_thread_message(GameThreadMessage::WindowMove(pos.0, pos.1));
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
        WM_LBUTTONDBLCLK | WM_LBUTTONDOWN | WM_LBUTTONUP | WM_MBUTTONDBLCLK |
            WM_MBUTTONDOWN | WM_MBUTTONUP | WM_RBUTTONDBLCLK | WM_RBUTTONDOWN | WM_RBUTTONUP |
            WM_XBUTTONDBLCLK | WM_XBUTTONDOWN | WM_XBUTTONUP | WM_MOUSEMOVE =>
        {
            let x = (lparam & 0xffff) as i16;
            let y = (lparam >> 16) as i16;
            let (fake_x, fake_y) = with_forge(|forge| {
                // cache the actual mouse position for GetCursorPos
                forge.real_cursor_pos = (x, y);
                if forge.should_clip_cursor {
                    let clip_rect = forge.stored_cursor_rect
                        .unwrap_or_else(|| RECT {
                            left: 0,
                            top: 0,
                            right: 640,
                            bottom: 480,
                        });
                    forge.perform_scaled_clip_cursor(&clip_rect);
                    forge.should_clip_cursor = false;
                }
                forge.screen_to_game_pos(x, y)
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
            with_forge(|forge| {
                let settings = &forge.settings;
                let activate = wparam != 0;
                if forge.game_started && forge.renderer.uses_swap_buffers() &&
                    settings.display_mode == DisplayMode::FullScreen
                {
                    // Since we avoid Windows' SwapBuffer full-screen heuristics, it doesn't keep
                    // the task bar from appearing over our app, so we have to try to solve this
                    // ourselves. This is non-ideal, as it can make it hard to get out of the game
                    // (e.g. it breaks Win+D), so if we can find some other, better solution to
                    // this that would be great =/
                    if let Some(ref window) = forge.window {
                        let topmost = if activate {
                            HWND_TOPMOST
                        } else {
                            HWND_NOTOPMOST
                        };
                        let flags = SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE;
                        SetWindowPos(window.handle, topmost, 0, 0, 0, 0, flags);
                    }
                }
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
                        forge.release_held_key(key);
                    }
                }
            });
            return DefWindowProcA(window, msg, wparam, lparam);
        }
        WM_GAME_STARTED => {
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
                SetTimer(window, FOREGROUND_HOTKEY_ID as usize, FOREGROUND_HOTKEY_TIMEOUT, None);
            }
            return 0;
        }
        WM_HOTKEY | WM_TIMER => {
            if wparam as i32 == FOREGROUND_HOTKEY_ID {
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
                    let fullscreen_gl = forge.renderer.uses_swap_buffers() &&
                        forge.settings.display_mode == DisplayMode::FullScreen;
                    if fullscreen_gl {
                        // Since we avoid Windows' SwapBuffer full-screen heuristics, it doesn't
                        // keep the task bar from appearing over our app, so we have to try to
                        // solve this ourselves. This is non-ideal, as it can make it hard to get
                        // out of the game (e.g. it breaks Win+D), so if we can find some other,
                        // better solution to this that would be great =/
                        let flags = SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE;
                        SetWindowPos(window, HWND_TOPMOST, 0, 0, 0, 0, flags);
                    }
                    // Clip the cursor
                    forge.perform_scaled_clip_cursor(&RECT {
                        left: 0,
                        top: 0,
                        right: 640,
                        bottom: 480,
                    });
                    if let Some(ref window) = forge.window {
                        // Move the cursor to the middle of the window
                        SetCursorPos(window.width / 2, window.height / 2);
                    }
                });
                ShowCursor(1);
            }
        }
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

fn register_class(class: *const WNDCLASSEXA, orig: &Fn(*const WNDCLASSEXA) -> ATOM) -> ATOM {
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

fn create_window(
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
    orig: &Fn(
        u32, *const i8, *const i8, u32, i32, i32, i32, i32, HWND, HMENU, HINSTANCE, *mut c_void,
    ) -> HWND,
) -> HWND {
    unsafe {
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
                ex_style, class_name, window_name, style, x, y, width, height,
                parent, menu, instance, param,
            );
        }
        with_forge(|forge| {
            assert!(forge.window.is_none());
            set_dpi_aware();
            let settings = &forge.settings;
            let (left, top, width, height) = match settings.display_mode {
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
                    let left = settings.window_x
                        .unwrap_or_else(|| ((work_area.right - work_area.left) - width) / 2);
                    let top = settings.window_y
                        .unwrap_or_else(|| ((work_area.bottom - work_area.top) - height) / 2);
                    (left, top, width, height)
                }
            };
            let style = match settings.display_mode {
                DisplayMode::FullScreen | DisplayMode::BorderlessWindow => {
                    if forge.renderer.uses_swap_buffers() {
                        WS_CAPTION | WS_VISIBLE
                    } else {
                        WS_POPUP | WS_VISIBLE
                    }
                }
                DisplayMode::Window => WS_POPUP | WS_VISIBLE | WS_CAPTION | WS_SYSMENU,
            };

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
                window_rect.left, window_rect.top,
                window_width, window_height,
                SWP_NOACTIVATE | SWP_HIDEWINDOW,
            );
            ShowWindow(window, SW_HIDE);
            let is_borderless = match settings.display_mode {
                DisplayMode::FullScreen | DisplayMode::BorderlessWindow => true,
                DisplayMode::Window => false,
            };
            if forge.renderer.uses_swap_buffers() && is_borderless {
                unimplemented!("set opengl window region");
            }
            forge.window = Some(Window::new(window, left, top, width, height, &forge.settings));
            window
        })
    }
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
}

fn with_forge<F: FnOnce(&mut Forge) -> R, R>(func: F) -> R {
    let mut forge = FORGE.lock().unwrap();
    let forge = forge.as_mut().expect("Forge was never initialized");
    func(forge)
}

impl Forge {
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
        unsafe {
            ClipCursor(&actual_rect)
        }
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

    fn release_held_key(&self, key: i32) {
        use winapi::um::winuser::*;
        let window = match self.window {
            Some(ref w) => w,
            None => return,
        };
        let wnd_proc = match self.orig_wnd_proc {
            Some(w) => w,
            None => return,
        };
        let (x, y) = self.screen_to_game_pos(self.real_cursor_pos.0, self.real_cursor_pos.1);
        let mouse_lparam = (x as u16 as isize) | ((y as u16 as isize) << 16);
        unsafe {
            if GetAsyncKeyState(key) as u16 & 0x8000 != 0 {
                match key {
                    VK_LBUTTON => wnd_proc(window.handle, WM_LBUTTONUP, 0, mouse_lparam),
                    VK_RBUTTON => wnd_proc(window.handle, WM_RBUTTONUP, 0, mouse_lparam),
                    VK_MBUTTON => wnd_proc(window.handle, WM_MBUTTONUP, 0, mouse_lparam),
                    // lparam could be better, but bw shouldn't even look at it..
                    other => {
                        wnd_proc(window.handle, WM_KEYUP, other as usize, 0xc0000001u32 as isize)
                    }
                };
            }
        }
    }

    fn screen_to_game_pos(&self, x: i16, y: i16) -> (i16, i16) {
        match self.window {
            Some(ref w) => {
                let x = ((x as f64 * 640.0 / w.mouse_resolution_width as f64) + 0.5) as i16;
                let y = ((y as f64 * 480.0 / w.mouse_resolution_height as f64) + 0.5) as i16;
                (x, y)
            }
            None => (0, 0),
        }
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
struct Settings {
    mouse_sensitivity: u8,
    display_mode: DisplayMode,
    window_x: Option<i32>,
    window_y: Option<i32>,
    width: i32,
    height: i32,
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
    // Client area width/height
    width: i32,
    height: i32,
    mouse_resolution_width: i32,
    mouse_resolution_height: i32,
}

unsafe impl Send for Window { }

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
            width,
            height,
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
        debug!("Mouse Resolution: {}x{}", mouse_width as i32, mouse_height as i32);
        (mouse_width as i32, mouse_height as i32)
    }
}

fn windows_work_area() -> RECT {
    // TODO
    // SystemParametersInfo(SPI_GETWORKAREA, 0, &work_area, 0);
    unimplemented!()
}

fn get_monitor_size() -> (i32, i32) {
    // TODO
    // GetSystemMetrics(SM_CXSCREEN);
    // GetSystemMetrics(SM_CYSCREEN);
    unimplemented!()
}

fn set_dpi_aware() {
    // TODO
}

pub unsafe fn init_hooks(patcher: &mut whack::ActivePatcher) {
    let mut starcraft = patcher.patch_exe(0x0040_0000);
    starcraft.import_hook_opt(&b"user32"[..], CreateWindowExA, create_window);
    starcraft.import_hook_opt(&b"user32"[..], RegisterClassExA, register_class);
    starcraft.hook_closure(CrashBeforeWindowCreation, |_: &Fn()| panic!("todo"));
}

pub fn init(settings: &serde_json::Map<String, serde_json::Value>) {
    let mouse_sensitivity = settings.get("mouseSensitivity")
        .and_then(|x| x.as_u64())
        .filter(|&x| x < MOUSE_SETTING_MAX as u64)
        .map(|x| x as u8)
        .unwrap_or_else(|| {
            warn!("Using default mouse sensitivity");
            0
        });
    let display_mode = settings.get("displayMode")
        .and_then(|x| x.as_u64())
        .and_then(|s| match s {
            0 => Some(DisplayMode::FullScreen),
            1 => Some(DisplayMode::BorderlessWindow),
            2 => Some(DisplayMode::Window),
            x => {
                warn!("Unknown display mode {}", x);
                None
            }
        }).unwrap_or_else(|| {
            warn!("Using default display mode");
            DisplayMode::FullScreen
        });
    let window_x = settings.get("gameWinX").and_then(|x| x.as_i64()).map(|x| x as i32);
    let window_y = settings.get("gameWinY").and_then(|x| x.as_i64()).map(|x| x as i32);
    let width = settings.get("width").and_then(|x| x.as_i64()).filter(|&x| x > 0 && x < 100_000)
        .unwrap_or_else(|| {
            warn!("Using default window width");
            640
        });
    let height = settings.get("height").and_then(|x| x.as_i64()).filter(|&x| x > 0 && x < 100_000)
        .unwrap_or_else(|| {
            warn!("Using default window height");
            480
        });
    let settings = Settings {
        mouse_sensitivity,
        display_mode,
        window_x,
        window_y,
        width: width as i32,
        height: height as i32,
    };
    *FORGE.lock().unwrap() = Some(Forge {
        settings,
        window: None,
        renderer: Renderer::new_directx(),
        orig_wnd_proc: None,
        should_clip_cursor: false,
        real_cursor_pos: (0, 0),
        stored_cursor_rect: None,
        game_started: false,
        input_disabled: false,
        bw_window_active: false,
        window_active: false,
    });
}

const WM_END_WND_PROC_WORKER: u32 = WM_USER + 27;
const WM_GAME_STARTED: u32 = WM_USER + 7;

/// Starts running the windows event loop -- we'll need that to run in order to get
/// lobby properly set up. The ingame message loop is run by BW, this doesn't have to be called
/// here.
///
/// Returns once `end_wnd_proc` is called.
pub unsafe fn run_wnd_proc() {
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

pub unsafe fn end_wnd_proc() {
    let handle = with_forge(|forge| {
        match forge.window {
            Some(ref s) => s.handle,
            None => panic!("Cannot stop running window procedure without a window"),
        }
    });
    PostMessageA(handle, WM_END_WND_PROC_WORKER, 0, 0);
}
