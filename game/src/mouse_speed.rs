//! Keeps SC:R's mouse sensitivity setting from outliving the game.
//!
//! SC:R implements mouse sensitivity by changing the system-wide Windows mouse speed
//! (`SPI_SETMOUSESPEED`) while its window is active. It puts the user's own speed back when the
//! window deactivates, or from its input shutdown if the window is still active then. Our exits
//! end the process without running SC:R's shutdown, so quitting while the window is still focused
//! (a game that fails to load, a panic) would leave the user's whole desktop on SC:R's speed until
//! they sign out. The speed is captured here before SC:R can change it and restored on those
//! exits, and once restored, SC:R can't change it again.
//!
//! SC:R never saves its speed to the user profile (fWinIni = 0), so a live speed that differs from
//! the saved one is most likely a speed some earlier game left behind. Capturing that as the
//! user's speed would make every later game restore it too, so the saved speed wins.

use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};

use winapi::ctypes::c_void;
use winapi::um::winuser::{SPI_GETMOUSESPEED, SPI_SETMOUSESPEED, SystemParametersInfoW};

use crate::windows::registry;

/// The user's mouse speed from before SC:R started, or 0 if it couldn't be read. Valid speeds are
/// 1..=20.
static USER_SPEED: AtomicU32 = AtomicU32::new(0);
/// Set once the process has started exiting and the user's speed is going back in place.
static RESTORED: AtomicBool = AtomicBool::new(false);

fn current_speed() -> Option<u32> {
    let mut speed = 0u32;
    let ok = unsafe {
        SystemParametersInfoW(
            SPI_GETMOUSESPEED,
            0,
            (&mut speed as *mut u32).cast::<c_void>(),
            0,
        )
    };
    (ok != 0 && (1..=20).contains(&speed)).then_some(speed)
}

/// The speed saved in the user's profile, which Windows applies at sign-in.
fn saved_speed() -> Option<u32> {
    registry::current_user_string("Control Panel\\Mouse", "MouseSensitivity")?
        .trim()
        .parse()
        .ok()
        .filter(|speed| (1..=20).contains(speed))
}

/// Sets the live speed without saving it to the user profile, which still holds the user's own.
fn set_speed(speed: u32) -> bool {
    unsafe { SystemParametersInfoW(SPI_SETMOUSESPEED, 0, speed as usize as *mut c_void, 0) != 0 }
}

/// Records the user's mouse speed. Must run before SC:R's input initialization, which is the
/// earliest point it can change the speed, and before SC:R reads the speed it will restore on
/// deactivation.
pub fn capture() {
    let Some(current) = current_speed() else {
        warn!("Couldn't read the Windows mouse speed; it won't be restored at exit");
        return;
    };
    let speed = match saved_speed() {
        Some(saved) if saved != current => {
            warn!(
                "Windows mouse speed at launch is {current}, but the user's saved speed is \
                {saved}; putting the saved speed back"
            );
            if !set_speed(saved) {
                warn!("Couldn't put the saved Windows mouse speed back");
            }
            saved
        }
        _ => current,
    };
    USER_SPEED.store(speed, Ordering::Relaxed);
    debug!("Windows mouse speed at launch: {speed}");
}

/// Puts the user's mouse speed back if SC:R left its own in place, and keeps SC:R from changing it
/// again. Call right before ending the process by any path that skips SC:R's shutdown. Doesn't
/// log, so it's safe right before exit.
pub fn restore() {
    RESTORED.store(true, Ordering::Release);
    let speed = USER_SPEED.load(Ordering::Relaxed);
    if speed == 0 || current_speed() == Some(speed) {
        return;
    }
    set_speed(speed);
}

/// Hook for `SystemParametersInfoW`/`A`, which SC:R uses to apply its mouse sensitivity. Logs the
/// speeds SC:R sets, and once [`restore`] has run, drops any speed other than the user's so SC:R's
/// threads can't put their own back while the process ends.
pub fn system_parameters_info(
    action: u32,
    param: u32,
    data: *mut libc::c_void,
    win_ini: u32,
    orig: unsafe extern "C" fn(u32, u32, *mut libc::c_void, u32) -> i32,
) -> i32 {
    if action == SPI_SETMOUSESPEED {
        let speed = data as usize as u32;
        if RESTORED.load(Ordering::Acquire) {
            if speed != USER_SPEED.load(Ordering::Relaxed) {
                return 1;
            }
        } else {
            debug!("Windows mouse speed set to {speed}");
        }
    }
    unsafe { orig(action, param, data, win_ini) }
}
