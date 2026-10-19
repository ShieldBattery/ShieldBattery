//! Keeps SC:R's mouse sensitivity setting from outliving the game.
//!
//! SC:R implements mouse sensitivity by changing the system-wide Windows mouse speed
//! (`SPI_SETMOUSESPEED`) while its window is active. It puts the user's own speed back when the
//! window deactivates, or from its input shutdown if the window is still active then. Our exits
//! end the process without running SC:R's shutdown, so quitting while the window is still focused
//! (a game that fails to load, a panic) would leave the user's whole desktop on SC:R's speed until
//! they sign out. The speed is captured here before SC:R can change it and restored on those
//! exits.

use std::sync::atomic::{AtomicU32, Ordering};

use winapi::ctypes::c_void;
use winapi::um::winuser::{SPI_GETMOUSESPEED, SPI_SETMOUSESPEED, SystemParametersInfoW};

/// The user's mouse speed from before SC:R started, or 0 if it couldn't be read. Valid speeds are
/// 1..=20.
static USER_SPEED: AtomicU32 = AtomicU32::new(0);

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

/// Records the user's mouse speed. Must run before SC:R's input initialization, which is the
/// earliest point it can change the speed.
pub fn capture() {
    match current_speed() {
        Some(speed) => {
            USER_SPEED.store(speed, Ordering::Relaxed);
            debug!("Windows mouse speed at launch: {speed}");
        }
        None => warn!("Couldn't read the Windows mouse speed; it won't be restored at exit"),
    }
}

/// Puts the user's mouse speed back if SC:R left its own in place. Call right before ending the
/// process by any path that skips SC:R's shutdown. Doesn't log, so it's safe right before exit.
pub fn restore() {
    let speed = USER_SPEED.load(Ordering::Relaxed);
    if speed == 0 || current_speed() == Some(speed) {
        return;
    }
    // SC:R changes the speed without updating the user profile (fWinIni = 0), so the user's
    // persisted setting never changed and this mustn't write one either.
    unsafe {
        SystemParametersInfoW(SPI_SETMOUSESPEED, 0, speed as usize as *mut c_void, 0);
    }
}
