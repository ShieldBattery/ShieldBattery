//! Owns the Windows mouse speed while the game runs.
//!
//! SC:R implements its mouse sensitivity setting by changing the system-wide Windows mouse speed
//! (`SPI_SETMOUSESPEED`): its own speed while its window is active and the cursor hasn't left it,
//! the user's otherwise. It decides "active" from `WM_ACTIVATE` alone and counts an activation that
//! arrives while the window is still minimized as inactive, so a focus change it reads wrong leaves
//! the game running at the desktop speed until the next one. It also takes the user's speed from
//! the live value once at startup, so a speed some other program left behind becomes the one it
//! puts back.
//!
//! Here SC:R's speed changes are swallowed and only taken as a cue to look again. The speed follows
//! the window's actual state instead: the game's speed while the window is in front, not minimized,
//! and SC:R hasn't seen the cursor leave it; the user's otherwise. The user's speed is the one saved
//! in their profile, which changes made in Windows' settings write and SC:R's changes never touch
//! (it changes the speed without updating the profile), so a speed left behind by anything else is
//! undone as well. Our exits end the process without running SC:R's shutdown, so they put the
//! user's speed back themselves.

use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};

use libc::c_void;
use winapi::um::winuser::{
    GetForegroundWindow, IsIconic, SPI_GETMOUSESPEED, SPI_SETMOUSESPEED, SystemParametersInfoW,
    WM_MOUSELEAVE, WM_MOUSEMOVE,
};

use super::{game_window_handle, scr_hooks_disabled, with_scr_hooks_disabled};
use crate::windows::registry;

pub(super) type SystemParametersInfoFn = unsafe extern "C" fn(u32, u32, *mut c_void, u32) -> i32;

/// Stands for "no sensitivity setting" in [`SENSITIVITY`]; SC:R then uses the user's speed.
const NO_SENSITIVITY: u32 = u32::MAX;

/// The user's mouse speed as last read, or 0 if it couldn't be read. Valid speeds are 1..=20.
static USER_SPEED: AtomicU32 = AtomicU32::new(0);
/// The live mouse speed as last set or read here, or 0 if unknown.
static APPLIED_SPEED: AtomicU32 = AtomicU32::new(0);
/// SC:R's `MouseUseSensitivity` setting.
static SENSITIVITY_ON: AtomicBool = AtomicBool::new(false);
/// SC:R's `MouseSensitivity` setting (0..=100), or [`NO_SENSITIVITY`].
static SENSITIVITY: AtomicU32 = AtomicU32::new(NO_SENSITIVITY);
/// Whether SC:R's window procedure has seen the cursor leave the window and not come back, which
/// is when SC:R itself switches to the user's speed.
static CURSOR_LEFT: AtomicBool = AtomicBool::new(false);
/// Whether the game window was in front when last checked.
static IN_FRONT: AtomicBool = AtomicBool::new(false);
/// Set once the process is exiting, after which only the user's speed is applied.
static EXITING: AtomicBool = AtomicBool::new(false);

fn valid_speed(speed: u32) -> Option<u32> {
    (1..=20).contains(&speed).then_some(speed)
}

fn live_speed() -> Option<u32> {
    let mut speed = 0u32;
    let ok = with_scr_hooks_disabled(|| unsafe {
        SystemParametersInfoW(SPI_GETMOUSESPEED, 0, (&mut speed as *mut u32).cast(), 0)
    });
    if ok == 0 { None } else { valid_speed(speed) }
}

/// Sets the live speed without updating the user's profile (`fWinIni` = 0), as SC:R does, so the
/// user's saved setting is never touched.
fn set_live_speed(speed: u32) {
    with_scr_hooks_disabled(|| unsafe {
        SystemParametersInfoW(SPI_SETMOUSESPEED, 0, speed as usize as *mut _, 0);
    });
}

/// The speed saved in the user's profile, which is what Windows' mouse settings show and change.
fn profile_speed() -> Option<u32> {
    registry::current_user_string("Control Panel\\Mouse", "MouseSensitivity")?
        .trim()
        .parse()
        .ok()
        .and_then(valid_speed)
}

/// Re-reads the user's speed, keeping the last one known if it can't be read.
fn refresh_user_speed() -> Option<u32> {
    match profile_speed() {
        Some(speed) => {
            USER_SPEED.store(speed, Ordering::Relaxed);
            Some(speed)
        }
        None => valid_speed(USER_SPEED.load(Ordering::Relaxed)),
    }
}

/// Records the user's mouse speed and the live one. Must run before SC:R's input initialization,
/// the earliest point it can change the speed.
pub fn capture() {
    let live = live_speed();
    let profile = profile_speed();
    if let Some(live) = live {
        APPLIED_SPEED.store(live, Ordering::Relaxed);
    }
    match profile.or(live) {
        Some(user) => USER_SPEED.store(user, Ordering::Relaxed),
        None => {
            warn!("Couldn't read the Windows mouse speed; it won't be managed");
            return;
        }
    }
    match (live, profile) {
        (Some(live), Some(profile)) if live != profile => {
            debug!("Windows mouse speed at launch: {live} (user setting {profile})")
        }
        (Some(speed), _) | (None, Some(speed)) => {
            debug!("Windows mouse speed at launch: {speed}")
        }
        (None, None) => (),
    }
}

/// Takes SC:R's mouse sensitivity settings from the ones the app launched the game with.
pub fn init_settings(scr_settings: &serde_json::Map<String, serde_json::Value>) {
    let on = scr_settings
        .get("mouseSensitivityOn")
        .and_then(|value| value.as_bool())
        .unwrap_or(false);
    let sensitivity = scr_settings
        .get("mouseSensitivity")
        .and_then(|value| value.as_f64())
        .map_or(NO_SENSITIVITY, |value| value.clamp(0.0, 100.0) as u32);
    SENSITIVITY_ON.store(on, Ordering::Relaxed);
    SENSITIVITY.store(sensitivity, Ordering::Relaxed);
}

pub fn set_sensitivity_on(on: bool) {
    SENSITIVITY_ON.store(on, Ordering::Relaxed);
    update();
}

pub fn set_sensitivity(sensitivity: u32) {
    SENSITIVITY.store(sensitivity.min(100), Ordering::Relaxed);
    update();
}

/// The speed SC:R uses for a `MouseSensitivity` value: the setting's 0..=100 scales the default
/// speed of 10 by 0.1..=2, truncated, in its float math.
fn game_speed(sensitivity: u32) -> u32 {
    let factor = (sensitivity as f32 / 100.0 * 2.0).clamp(0.1, 2.0);
    (factor * 10.0) as u32
}

fn window_in_front() -> bool {
    game_window_handle()
        .is_some_and(|window| unsafe { GetForegroundWindow() == window && IsIconic(window) == 0 })
}

/// Why the live speed is what it is.
#[derive(Clone, Copy, Eq, PartialEq)]
enum Reason {
    InFront,
    NotInFront,
    CursorLeft,
    SensitivityOff,
    Exiting,
}

impl Reason {
    fn describe(self) -> &'static str {
        match self {
            Reason::InFront => "the game's, window in front",
            Reason::NotInFront => "the user's, window not in front",
            Reason::CursorLeft => "the user's, cursor outside the window",
            Reason::SensitivityOff => "the user's, sensitivity off",
            Reason::Exiting => "the user's, exiting",
        }
    }
}

/// Puts the live speed where the window's state says it belongs, if it isn't already there.
fn update() {
    let in_front = window_in_front();
    IN_FRONT.store(in_front, Ordering::Relaxed);
    let sensitivity = SENSITIVITY.load(Ordering::Relaxed);
    let reason = if EXITING.load(Ordering::Relaxed) {
        Reason::Exiting
    } else if !SENSITIVITY_ON.load(Ordering::Relaxed) || sensitivity == NO_SENSITIVITY {
        Reason::SensitivityOff
    } else if !in_front {
        Reason::NotInFront
    } else if CURSOR_LEFT.load(Ordering::Relaxed) {
        Reason::CursorLeft
    } else {
        Reason::InFront
    };
    let speed = match reason {
        Reason::InFront => game_speed(sensitivity),
        _ => match refresh_user_speed() {
            Some(speed) => speed,
            None => return,
        },
    };
    if APPLIED_SPEED.swap(speed, Ordering::Relaxed) != speed {
        set_live_speed(speed);
        debug!("Mouse speed {speed}: {}", reason.describe());
    }
}

/// Re-checks whether the window is in front, applying the matching speed if that changed. Cheap
/// enough to call on every message pump.
pub(super) fn check_window() {
    if window_in_front() != IN_FRONT.load(Ordering::Relaxed) {
        update();
    }
}

/// Follows the cursor leaving and re-entering the window for a message SC:R's window procedure is
/// about to handle, the way SC:R does (a leave notification, then the next mouse move).
pub(super) fn window_message(msg: u32) {
    let left = match msg {
        WM_MOUSEMOVE => false,
        WM_MOUSELEAVE => true,
        _ => return,
    };
    if CURSOR_LEFT.swap(left, Ordering::Relaxed) != left {
        update();
    }
}

/// Answers SC:R's mouse speed reads with the user's speed and swallows its writes, re-checking the
/// speed instead: SC:R writes when focus, the cursor or its sensitivity settings change.
pub(super) fn system_parameters_info_w(
    action: u32,
    param: u32,
    value: *mut c_void,
    win_ini: u32,
    orig: SystemParametersInfoFn,
) -> i32 {
    if scr_hooks_disabled() {
        return unsafe { orig(action, param, value, win_ini) };
    }
    let Some(user) = valid_speed(USER_SPEED.load(Ordering::Relaxed)) else {
        return unsafe { orig(action, param, value, win_ini) };
    };
    match action {
        SPI_GETMOUSESPEED if !value.is_null() => {
            unsafe { value.cast::<u32>().write(user) };
            1
        }
        SPI_SETMOUSESPEED => {
            update();
            1
        }
        _ => unsafe { orig(action, param, value, win_ini) },
    }
}

/// Puts the user's mouse speed back and stops applying the game's. Call right before ending the
/// process by any path that skips SC:R's shutdown. Doesn't log, so it's safe right before exit.
pub fn restore() {
    EXITING.store(true, Ordering::Relaxed);
    let Some(user) = refresh_user_speed() else {
        return;
    };
    if live_speed() != Some(user) {
        set_live_speed(user);
    }
    APPLIED_SPEED.store(user, Ordering::Relaxed);
}

#[cfg(test)]
mod test {
    use super::*;

    #[test]
    fn game_speed_is_a_fifth_of_the_setting() {
        for sensitivity in 0..=100 {
            assert_eq!(
                game_speed(sensitivity),
                (sensitivity / 5).max(1),
                "sensitivity {sensitivity}"
            );
        }
    }
}
