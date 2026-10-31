//! Takes the mouse as raw input while a game is played in one of the fullscreen modes, and turns it
//! into the mouse messages SC:R's window procedure expects as its message pump removes it.
//!
//! Every legacy mouse message a thread removes from its queue makes Windows raise a cursor
//! location-change WinEvent on that thread, waking each out-of-context hook listening to its
//! process. Chromium-based apps (browsers, Discord, Steam, ShieldBattery's own app) hook every
//! process that shows a window, to track which of their windows are covered, so each mouse move
//! SC:R takes wakes all of them, and they contend with the game for the window manager's lock.
//! With the mouse registered as `RIDEV_NOLEGACY`, Windows makes no legacy mouse messages, so none
//! of those events are raised. The cursor still moves as usual.
//!
//! Each `WM_INPUT` carries the cursor position as of its report (`MSG.pt`), so the messages made
//! from it carry the position the input happened at, as legacy ones do. Motion between reports
//! with buttons or the wheel becomes one `WM_MOUSEMOVE` at the newest position, as Windows
//! coalesces legacy moves.
//!
//! Raw input is only taken while the game loop runs and the window is in the foreground without a
//! title bar: under `RIDEV_NOLEGACY`, nothing outside the client area can be clicked, and clicking
//! the window doesn't activate it. Whether to take it is decided each time the game loop's pump
//! empties the queue, so it follows focus and display mode changes within a frame.
//!
//! Windows also can't tell the cursor is over the window then, so every `TrackMouseEvent` leave
//! request ends straight away with a `WM_MOUSELEAVE`. SC:R arms one on the first move after a
//! leave, and its leave handling hides the game's cursor, so the requests are held while raw input
//! is taken and made for real once it stops, when the cursor may really have left.

use std::cell::{Cell, RefCell};
use std::collections::VecDeque;
use std::mem;
use std::ptr::null_mut;
use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};

use winapi::shared::minwindef::FALSE;
use winapi::shared::windef::{HWND, POINT};
use winapi::um::winuser::*;

/// Set to `0` to keep the mouse on legacy messages, for comparing the two.
const DISABLE_ENV_VAR: &str = "SB_RAW_MOUSE";

const HID_USAGE_PAGE_GENERIC: u16 = 0x01;
const HID_USAGE_GENERIC_MOUSE: u16 = 0x02;
/// A horizontal wheel turn, in `RAWMOUSE::usButtonFlags`; the winapi crate predates it.
const RI_MOUSE_HWHEEL: u16 = 0x0800;

static ENABLED: AtomicBool = AtomicBool::new(true);
/// The thread the game window belongs to, which is the only one raw input goes to.
static WINDOW_THREAD: AtomicU32 = AtomicU32::new(0);

thread_local! {
    /// Whether this thread has the mouse registered for raw input.
    static TAKING_INPUT: Cell<bool> = const { Cell::new(false) };
    /// Messages made from a report, waiting their turn behind the one already handed over.
    static PENDING: RefCell<VecDeque<MSG>> = const { RefCell::new(VecDeque::new()) };
    /// The newest motion not yet handed over as a `WM_MOUSEMOVE`.
    static MOTION: Cell<Option<Motion>> = const { Cell::new(None) };
    /// Where the last `WM_MOUSEMOVE` handed over put the cursor.
    static LAST_MOVE: Cell<Option<POINT>> = const { Cell::new(None) };
    /// The `MK_*` flags of the mouse buttons held, as the messages made so far have them.
    static BUTTONS: Cell<usize> = const { Cell::new(0) };
    /// The leave request SC:R is waiting on while raw input is taken, to make for real once it
    /// stops: one it made then, or one Windows answered falsely as raw input started.
    static HELD_LEAVE_REQUEST: Cell<Option<TRACKMOUSEEVENT>> = const { Cell::new(None) };
}

#[derive(Clone, Copy)]
struct Motion {
    window: HWND,
    point: POINT,
    time: u32,
    /// The `MK_*` flags as they were when the motion happened, before any button change in the
    /// report that ended it.
    flags: usize,
}

/// Reads [`DISABLE_ENV_VAR`].
pub fn init_from_env() {
    if std::env::var(DISABLE_ENV_VAR).as_deref() == Ok("0") {
        info!("Raw mouse input: off ({DISABLE_ENV_VAR}=0)");
        ENABLED.store(false, Ordering::Release);
    }
}

/// Notes that the game window was just created on this thread.
pub fn window_created() {
    WINDOW_THREAD.store(
        unsafe { winapi::um::processthreadsapi::GetCurrentThreadId() },
        Ordering::Release,
    );
}

/// Whether this thread has the mouse registered for raw input.
pub fn taking_input() -> bool {
    TAKING_INPUT.get()
}

/// Whether a `PeekMessageW` removing messages in `filter_min..=filter_max` for `window` is the game
/// loop's pump, which [`remove_next_message`] stands in for.
pub fn converts(window: HWND, filter_min: u32, filter_max: u32) -> bool {
    filter_min == 0
        && filter_max == 0
        && (window.is_null() || super::is_forge_window(window))
        && super::GAME_LOOP_PUMPING.load(Ordering::Relaxed)
        && WINDOW_THREAD.load(Ordering::Relaxed)
            == unsafe { winapi::um::processthreadsapi::GetCurrentThreadId() }
}

/// Takes or gives back the mouse as the game window's state calls for.
fn update(window: HWND) {
    let want = ENABLED.load(Ordering::Acquire)
        && super::GAME_LOOP_PUMPING.load(Ordering::Acquire)
        && !super::IN_SIZE_MOVE_MENU_LOOP.load(Ordering::Acquire)
        && super::is_forge_window(window)
        && unsafe {
            GetForegroundWindow() == window
                && IsIconic(window) == 0
                && (GetWindowLongW(window, GWL_STYLE) as u32 & WS_CAPTION) == 0
        };
    if want == TAKING_INPUT.get() {
        return;
    }
    if want {
        take_input(window);
    } else {
        give_back_input();
    }
}

fn take_input(window: HWND) {
    let device = RAWINPUTDEVICE {
        usUsagePage: HID_USAGE_PAGE_GENERIC,
        usUsage: HID_USAGE_GENERIC_MOUSE,
        dwFlags: RIDEV_NOLEGACY,
        hwndTarget: window,
    };
    let registered = unsafe {
        RegisterRawInputDevices(&device, 1, mem::size_of::<RAWINPUTDEVICE>() as u32) != FALSE
    };
    if !registered {
        warn!(
            "Raw mouse input: couldn't register the mouse: {}",
            std::io::Error::last_os_error()
        );
        return;
    }
    info!("Raw mouse input: on");
    TAKING_INPUT.set(true);
    BUTTONS.set(held_buttons());
    LAST_MOVE.set(None);
    unsafe {
        // Windows no longer asks the window for its cursor, and a cursor another window set while
        // this one was in the background stays until SC:R sets its own.
        let mut cursor = mem::zeroed();
        if GetCursorPos(&mut cursor) != 0 && WindowFromPoint(cursor) == window {
            SendMessageW(
                window,
                WM_SETCURSOR,
                window as usize,
                make_lparam(HTCLIENT as i32, WM_MOUSEMOVE as i32),
            );
        }
    }
}

fn give_back_input() {
    let device = RAWINPUTDEVICE {
        usUsagePage: HID_USAGE_PAGE_GENERIC,
        usUsage: HID_USAGE_GENERIC_MOUSE,
        dwFlags: RIDEV_REMOVE,
        hwndTarget: null_mut(),
    };
    let removed = unsafe {
        RegisterRawInputDevices(&device, 1, mem::size_of::<RAWINPUTDEVICE>() as u32) != FALSE
    };
    if !removed {
        warn!(
            "Raw mouse input: couldn't unregister the mouse: {}",
            std::io::Error::last_os_error()
        );
    }
    info!("Raw mouse input: off");
    TAKING_INPUT.set(false);
    if let Some(mut request) = HELD_LEAVE_REQUEST.take() {
        // Made with the hooks disabled, so `track_mouse_event` passes it on.
        super::with_scr_hooks_disabled(|| unsafe {
            TrackMouseEvent(&mut request);
        });
    }
}

/// Holds SC:R's requests to be told when the cursor leaves its window while raw input is taken,
/// which Windows would answer straight away.
pub fn track_mouse_event(
    request: *mut TRACKMOUSEEVENT,
    orig: unsafe extern "C" fn(*mut TRACKMOUSEEVENT) -> i32,
) -> i32 {
    unsafe {
        if request.is_null() || super::scr_hooks_disabled() || !TAKING_INPUT.get() {
            return orig(request);
        }
        let flags = (*request).dwFlags;
        if flags & TME_QUERY != 0 || flags & TME_LEAVE == 0 {
            return orig(request);
        }
        if flags & TME_CANCEL != 0 {
            HELD_LEAVE_REQUEST.set(None);
            return orig(request);
        }
        HELD_LEAVE_REQUEST.set(Some(*request));
        1
    }
}

/// Whether the game window's procedure should drop `msg` rather than handle it: a leave Windows
/// reported while raw input was taken, when the cursor can't have left. SC:R still waits for the
/// leave it asked for, so it's asked for again once raw input stops.
pub fn drops_message(window: HWND, msg: u32) -> bool {
    if msg != WM_MOUSELEAVE || !TAKING_INPUT.get() {
        return false;
    }
    if HELD_LEAVE_REQUEST.get().is_none() {
        HELD_LEAVE_REQUEST.set(Some(TRACKMOUSEEVENT {
            cbSize: mem::size_of::<TRACKMOUSEEVENT>() as u32,
            dwFlags: TME_LEAVE,
            hwndTrack: window,
            dwHoverTime: 0,
        }));
    }
    true
}

/// Removes the next message for a message pump draining every message, as `remove_next` (the
/// original `PeekMessageW` with `PM_REMOVE`) would, except that mouse `WM_INPUT`s come out as the
/// legacy mouse messages they stand for.
///
/// Reports only showing motion are folded into the next `WM_MOUSEMOVE` without a limit on how many.
/// Removing one takes microseconds, a small fraction of the time between reports even from the
/// fastest mice, so a drain can't fall behind the input it's taking. Clicks queued behind a backlog
/// of motion are still handled in this drain rather than held back a frame.
pub fn remove_next_message(msg: *mut MSG, remove_next: impl Fn(*mut MSG) -> i32) -> i32 {
    unsafe {
        if let Some(pending) = PENDING.with_borrow_mut(|pending| pending.pop_front()) {
            *msg = pending;
            return 1;
        }
        loop {
            if remove_next(msg) == 0 {
                if let Some(motion) = take_motion() {
                    *msg = motion;
                    return 1;
                }
                if let Some(window) = super::game_window_handle() {
                    update(window);
                }
                return 0;
            }
            let made = match (*msg).message {
                WM_INPUT => match read_raw_mouse((*msg).lParam as HRAWINPUT) {
                    Some(mouse) => {
                        let removed = *msg;
                        // Ends the report's life the way dispatching it would have.
                        DefWindowProcW(removed.hwnd, WM_INPUT, removed.wParam, removed.lParam);
                        Some(messages_for_report(&removed, &mouse))
                    }
                    None => None,
                },
                _ => None,
            };
            let made = match made {
                // Anything else goes out as it is, after any motion before it.
                None => {
                    if let Some(motion) = take_motion() {
                        PENDING.with_borrow_mut(|pending| pending.push_back(*msg));
                        *msg = motion;
                    }
                    return 1;
                }
                Some(made) if made.is_empty() => continue,
                Some(made) => made,
            };
            let mut made = take_motion().into_iter().chain(made);
            let Some(first) = made.next() else {
                continue;
            };
            *msg = first;
            PENDING.with_borrow_mut(|pending| pending.extend(made));
            return 1;
        }
    }
}

/// The messages a mouse report stands for, other than its motion, which is noted for the next
/// `WM_MOUSEMOVE` instead.
fn messages_for_report(removed: &MSG, mouse: &RAWMOUSE) -> Vec<MSG> {
    let window = removed.hwnd;
    let point = removed.pt;
    let time = removed.time;
    let moved =
        mouse.lLastX != 0 || mouse.lLastY != 0 || (mouse.usFlags & MOUSE_MOVE_ABSOLUTE) != 0;
    if moved {
        MOTION.set(Some(Motion {
            window,
            point,
            time,
            flags: modifier_flags(),
        }));
    }
    let flags = mouse.usButtonFlags;
    let (left, right) = physical_left_and_right();
    let transitions = [
        (RI_MOUSE_LEFT_BUTTON_DOWN, left, true),
        (RI_MOUSE_LEFT_BUTTON_UP, left, false),
        (RI_MOUSE_RIGHT_BUTTON_DOWN, right, true),
        (RI_MOUSE_RIGHT_BUTTON_UP, right, false),
        (RI_MOUSE_MIDDLE_BUTTON_DOWN, MK_MBUTTON, true),
        (RI_MOUSE_MIDDLE_BUTTON_UP, MK_MBUTTON, false),
        (RI_MOUSE_BUTTON_4_DOWN, MK_XBUTTON1, true),
        (RI_MOUSE_BUTTON_4_UP, MK_XBUTTON1, false),
        (RI_MOUSE_BUTTON_5_DOWN, MK_XBUTTON2, true),
        (RI_MOUSE_BUTTON_5_UP, MK_XBUTTON2, false),
    ];
    let mut made = Vec::new();
    for (flag, button, down) in transitions {
        if flags & flag == 0 {
            continue;
        }
        let held = match down {
            true => BUTTONS.get() | button,
            false => BUTTONS.get() & !button,
        };
        BUTTONS.set(held);
        let (message, xbutton) = match (button, down) {
            (MK_LBUTTON, true) => (WM_LBUTTONDOWN, 0),
            (MK_LBUTTON, false) => (WM_LBUTTONUP, 0),
            (MK_RBUTTON, true) => (WM_RBUTTONDOWN, 0),
            (MK_RBUTTON, false) => (WM_RBUTTONUP, 0),
            (MK_MBUTTON, true) => (WM_MBUTTONDOWN, 0),
            (MK_MBUTTON, false) => (WM_MBUTTONUP, 0),
            (MK_XBUTTON1, true) => (WM_XBUTTONDOWN, XBUTTON1),
            (MK_XBUTTON1, false) => (WM_XBUTTONUP, XBUTTON1),
            (_, true) => (WM_XBUTTONDOWN, XBUTTON2),
            (_, false) => (WM_XBUTTONUP, XBUTTON2),
        };
        made.push(MSG {
            hwnd: window,
            message,
            wParam: modifier_flags() | ((xbutton as usize) << 16),
            lParam: client_lparam(window, point),
            time,
            pt: point,
        });
    }
    for (flag, message) in [
        (RI_MOUSE_WHEEL, WM_MOUSEWHEEL),
        (RI_MOUSE_HWHEEL, WM_MOUSEHWHEEL),
    ] {
        if flags & flag == 0 {
            continue;
        }
        made.push(MSG {
            hwnd: window,
            message,
            wParam: modifier_flags() | ((mouse.usButtonData as usize) << 16),
            // Wheel messages carry screen coordinates.
            lParam: make_lparam(point.x, point.y),
            time,
            pt: point,
        });
    }
    made
}

/// The `WM_MOUSEMOVE` for the motion not yet handed over, unless it ended where the last one did.
fn take_motion() -> Option<MSG> {
    let motion = MOTION.take()?;
    let last = LAST_MOVE.replace(Some(motion.point));
    if last.is_some_and(|last| last.x == motion.point.x && last.y == motion.point.y) {
        return None;
    }
    Some(MSG {
        hwnd: motion.window,
        message: WM_MOUSEMOVE,
        wParam: motion.flags,
        lParam: client_lparam(motion.window, motion.point),
        time: motion.time,
        pt: motion.point,
    })
}

/// The `MK_*` flags of a mouse message made now: the buttons held, and the modifier keys as this
/// thread's keyboard state has them.
fn modifier_flags() -> usize {
    let mut flags = BUTTONS.get();
    unsafe {
        if GetKeyState(VK_SHIFT) < 0 {
            flags |= MK_SHIFT;
        }
        if GetKeyState(VK_CONTROL) < 0 {
            flags |= MK_CONTROL;
        }
    }
    flags
}

/// The `MK_*` flags of the mouse buttons held down right now.
fn held_buttons() -> usize {
    logical_buttons(
        |key| unsafe { GetAsyncKeyState(key) } < 0,
        physical_left_and_right(),
    )
}

/// The `MK_*` flags of the buttons `is_down` reports held, given the physical button keys (as
/// `GetAsyncKeyState` and raw input see them) and the flags the physical left and right act as.
fn logical_buttons(is_down: impl Fn(i32) -> bool, (left, right): (usize, usize)) -> usize {
    [
        (VK_LBUTTON, left),
        (VK_RBUTTON, right),
        (VK_MBUTTON, MK_MBUTTON),
        (VK_XBUTTON1, MK_XBUTTON1),
        (VK_XBUTTON2, MK_XBUTTON2),
    ]
    .into_iter()
    .filter(|&(key, _)| is_down(key))
    .fold(0, |held, (_, button)| held | button)
}

/// The `MK_*` flags of the buttons the physical left and right buttons act as, which the user may
/// have swapped.
fn physical_left_and_right() -> (usize, usize) {
    match unsafe { GetSystemMetrics(SM_SWAPBUTTON) } != 0 {
        false => (MK_LBUTTON, MK_RBUTTON),
        true => (MK_RBUTTON, MK_LBUTTON),
    }
}

/// `point`, in screen coordinates, as a mouse message's client-coordinate `lParam`.
fn client_lparam(window: HWND, point: POINT) -> isize {
    let mut client = point;
    unsafe {
        ScreenToClient(window, &mut client);
    }
    make_lparam(client.x, client.y)
}

fn make_lparam(low: i32, high: i32) -> isize {
    ((low as u16 as u32) | ((high as u16 as u32) << 16)) as i32 as isize
}

/// The mouse part of a `WM_INPUT`'s report, if it is a mouse report.
fn read_raw_mouse(handle: HRAWINPUT) -> Option<RAWMOUSE> {
    // Comfortably larger than a mouse report on either architecture, and aligned for one.
    let mut buffer = [0u64; 8];
    let mut size = mem::size_of_val(&buffer) as u32;
    unsafe {
        let read = GetRawInputData(
            handle,
            RID_INPUT,
            buffer.as_mut_ptr().cast(),
            &mut size,
            mem::size_of::<RAWINPUTHEADER>() as u32,
        );
        if read == u32::MAX || (read as usize) < mem::size_of::<RAWINPUTHEADER>() {
            return None;
        }
        let input = &*(buffer.as_ptr() as *const RAWINPUT);
        (input.header.dwType == RIM_TYPEMOUSE).then(|| *input.data.mouse())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn lparam_keeps_negative_coordinates() {
        let lparam = make_lparam(-5, 1080);
        assert_eq!((lparam & 0xffff) as u16 as i16, -5);
        assert_eq!(((lparam >> 16) & 0xffff) as u16 as i16, 1080);
    }

    /// The physical left button held while buttons are swapped is the logical right one, so its
    /// release (a `WM_RBUTTONUP`) clears what was held.
    #[test]
    fn held_buttons_follow_a_swap() {
        let left_down = |key| key == VK_LBUTTON;
        assert_eq!(
            logical_buttons(left_down, (MK_LBUTTON, MK_RBUTTON)),
            MK_LBUTTON
        );
        assert_eq!(
            logical_buttons(left_down, (MK_RBUTTON, MK_LBUTTON)),
            MK_RBUTTON
        );
    }

    /// A report that moves and presses a button stands for a move made before the press, as
    /// legacy messages have it: the move's flags don't include the button yet.
    #[test]
    fn motion_carries_the_flags_from_before_its_reports_press() {
        BUTTONS.set(0);
        let removed = MSG {
            hwnd: null_mut(),
            message: WM_INPUT,
            wParam: 0,
            lParam: 0,
            time: 0,
            pt: POINT { x: 10, y: 20 },
        };
        let mut mouse: RAWMOUSE = unsafe { mem::zeroed() };
        mouse.lLastX = 5;
        mouse.usButtonFlags = RI_MOUSE_LEFT_BUTTON_DOWN;
        let made = messages_for_report(&removed, &mouse);
        let (left, _) = physical_left_and_right();
        assert_eq!(made.len(), 1);
        assert_eq!(made[0].wParam & left, left);
        let motion = take_motion().expect("the report's motion");
        assert_eq!(motion.message, WM_MOUSEMOVE);
        assert_eq!(motion.wParam & left, 0);
    }
}
