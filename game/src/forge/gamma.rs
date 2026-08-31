use std::mem;
use std::ptr::{self, null};
use std::sync::Mutex;

use lazy_static::lazy_static;
use libc::c_void;
use winapi::shared::windef::{HDC, HWND};
use winapi::um::wingdi::{CreateDCW, DeleteDC, SetDeviceGammaRamp};
use winapi::um::winuser::{
    CCHDEVICENAME, GetForegroundWindow, GetMonitorInfoW, IsIconic, KillTimer,
    MONITOR_DEFAULTTONEAREST, MONITORINFO, MONITORINFOEXW, MonitorFromWindow, SIZE_MINIMIZED,
    SetTimer, WA_INACTIVE, WM_ACTIVATE, WM_ACTIVATEAPP, WM_DISPLAYCHANGE, WM_SIZE, WM_TIMER,
    WindowFromDC,
};

use super::{game_window_handle, is_forge_window, scr_hooks_disabled, with_scr_hooks_disabled};

const GAMMA_RAMP_WORDS: usize = 3 * 256;
const GAMMA_MIN: f32 = 0.6;
const GAMMA_MAX: f32 = 1.4;
const GAMMA_NEUTRAL_SUM: f32 = 2.0;
const GAMMA_REAPPLY_TIMER_ID: usize = 1340;
const GAMMA_REAPPLY_TIMEOUT_MILLIS: u32 = 150;
const DISPLAY_DRIVER: [u16; 8] = [
    b'D' as u16,
    b'I' as u16,
    b'S' as u16,
    b'P' as u16,
    b'L' as u16,
    b'A' as u16,
    b'Y' as u16,
    0,
];

type GammaRampFn = unsafe extern "C" fn(HDC, *mut c_void) -> i32;

#[derive(Clone, Copy, Eq, PartialEq)]
#[repr(transparent)]
struct GammaRamp([u16; GAMMA_RAMP_WORDS]);

impl GammaRamp {
    unsafe fn read(ramp: *const c_void) -> GammaRamp {
        unsafe { ptr::read_unaligned(ramp.cast::<GammaRamp>()) }
    }

    fn as_api_ptr(&self) -> *mut c_void {
        (self as *const GammaRamp).cast_mut().cast::<c_void>()
    }

    fn from_setting(value: u32) -> GammaRamp {
        let gamma = (value as f32 / 100.0).clamp(GAMMA_MIN, GAMMA_MAX);
        let exponent = GAMMA_NEUTRAL_SUM - gamma;
        let mut ramp = [0; GAMMA_RAMP_WORDS];
        for i in 0..256 {
            let input = i as f32 / 255.0;
            let output = (input.powf(exponent) * u16::MAX as f32) as u16;
            ramp[i] = output;
            ramp[i + 256] = output;
            ramp[i + 512] = output;
        }
        GammaRamp(ramp)
    }
}

#[derive(Clone, Copy, Eq, PartialEq)]
struct DisplayDevice([u16; CCHDEVICENAME]);

#[derive(Debug, Eq, PartialEq)]
enum RampObservation {
    DesiredChanged,
    DesiredCleared,
    Unchanged,
}

#[derive(Default)]
struct GammaState {
    desktop: Option<GammaRamp>,
    desired: Option<GammaRamp>,
    configured: Option<GammaRamp>,
    device: Option<DisplayDevice>,
    app_active: bool,
    restore_pending: bool,
}

impl GammaState {
    fn record_desktop(&mut self, ramp: GammaRamp, device: Option<DisplayDevice>) {
        self.desktop = Some(ramp);
        self.desired = self.configured.filter(|&desired| desired != ramp);
        if device.is_some() {
            self.device = device;
        }
    }

    fn observe_set(&mut self, ramp: GammaRamp) -> RampObservation {
        if self.desktop == Some(ramp) {
            if self.app_active && !self.restore_pending && self.desired.take().is_some() {
                self.configured = None;
                RampObservation::DesiredCleared
            } else {
                RampObservation::Unchanged
            }
        } else if self.desktop.is_some() || self.app_active {
            if self.desired == Some(ramp) {
                RampObservation::Unchanged
            } else {
                self.desired = Some(ramp);
                self.configured = Some(ramp);
                RampObservation::DesiredChanged
            }
        } else {
            RampObservation::Unchanged
        }
    }

    fn set_app_active(&mut self, active: bool) {
        if active && !self.app_active {
            self.restore_pending = true;
        } else if !active {
            self.restore_pending = false;
        }
        self.app_active = active;
    }

    fn finish_restore(&mut self) {
        self.restore_pending = false;
    }
}

lazy_static! {
    static ref GAMMA_STATE: Mutex<GammaState> = Mutex::new(GammaState::default());
}

pub(super) fn configure(value: Option<u32>) {
    let configured = value.map(GammaRamp::from_setting);
    *GAMMA_STATE.lock().unwrap() = GammaState {
        desired: configured,
        configured,
        ..GammaState::default()
    };
}

struct DisplayDc {
    handle: HDC,
    device: DisplayDevice,
}

impl Drop for DisplayDc {
    fn drop(&mut self) {
        unsafe {
            DeleteDC(self.handle);
        }
    }
}

unsafe fn monitor_device(window: HWND) -> Option<DisplayDevice> {
    unsafe {
        let monitor = MonitorFromWindow(window, MONITOR_DEFAULTTONEAREST);
        if monitor.is_null() {
            return None;
        }

        let mut info: MONITORINFOEXW = mem::zeroed();
        info.cbSize = mem::size_of::<MONITORINFOEXW>() as u32;
        if GetMonitorInfoW(
            monitor,
            (&mut info as *mut MONITORINFOEXW).cast::<MONITORINFO>(),
        ) == 0
        {
            return None;
        }

        // MONITORINFOEXW reserves space for a terminated device name. Keep the final word zeroed
        // even if a driver fills the entire fixed-size buffer.
        info.szDevice[CCHDEVICENAME - 1] = 0;
        Some(DisplayDevice(info.szDevice))
    }
}

unsafe fn create_display_dc_for_device(device: DisplayDevice) -> Option<DisplayDc> {
    unsafe {
        let handle = CreateDCW(DISPLAY_DRIVER.as_ptr(), device.0.as_ptr(), null(), null());
        if handle.is_null() {
            None
        } else {
            Some(DisplayDc { handle, device })
        }
    }
}

unsafe fn create_display_dc(window: HWND, cached: Option<DisplayDevice>) -> Option<DisplayDc> {
    unsafe {
        if let Some(device) = cached
            && let Some(dc) = create_display_dc_for_device(device)
        {
            return Some(dc);
        }

        let device = monitor_device(window)?;
        create_display_dc_for_device(device)
    }
}

unsafe fn game_window_for_dc(hdc: HDC) -> Option<HWND> {
    unsafe {
        if scr_hooks_disabled() {
            return None;
        }
        let window = WindowFromDC(hdc);
        if window.is_null() || game_window_handle() != Some(window) {
            None
        } else {
            Some(window)
        }
    }
}

pub(super) fn get_device_gamma_ramp(hdc: HDC, ramp: *mut c_void, orig: GammaRampFn) -> i32 {
    unsafe {
        let Some(window) = game_window_for_dc(hdc) else {
            return orig(hdc, ramp);
        };
        if ramp.is_null() {
            return orig(hdc, ramp);
        }

        let cached_device = GAMMA_STATE.lock().unwrap().device;
        let display_dc = create_display_dc(window, cached_device);
        let (result, device) = if let Some(ref dc) = display_dc {
            (orig(dc.handle, ramp), Some(dc.device))
        } else {
            warn!("Could not create a DC for the SC:R monitor while reading its gamma ramp");
            (orig(hdc, ramp), None)
        };

        if result != 0 {
            let should_reapply = {
                let mut state = GAMMA_STATE.lock().unwrap();
                state.record_desktop(GammaRamp::read(ramp), device);
                state.desired.is_some()
            };
            if should_reapply {
                schedule_reapply(window);
            }
            debug!("Captured the desktop gamma ramp used by SC:R");
        }
        result
    }
}

pub(super) fn set_device_gamma_ramp(hdc: HDC, ramp: *mut c_void, orig: GammaRampFn) -> i32 {
    unsafe {
        let Some(window) = game_window_for_dc(hdc) else {
            return orig(hdc, ramp);
        };
        if ramp.is_null() {
            return orig(hdc, ramp);
        }

        let ramp = GammaRamp::read(ramp);
        let (cached_device, observation) = {
            let mut state = GAMMA_STATE.lock().unwrap();
            let observation = state.observe_set(ramp);
            (state.device, observation)
        };
        match observation {
            RampObservation::DesiredChanged => debug!("Captured SC:R's desired gamma ramp"),
            RampObservation::DesiredCleared => {
                debug!("SC:R restored desktop gamma while active; clearing the desired ramp")
            }
            RampObservation::Unchanged => (),
        }

        let display_dc = create_display_dc(window, cached_device);
        if let Some(ref dc) = display_dc {
            GAMMA_STATE.lock().unwrap().device = Some(dc.device);
            orig(dc.handle, ramp.as_api_ptr())
        } else {
            warn!("Could not create a DC for the SC:R monitor while setting its gamma ramp");
            orig(hdc, ramp.as_api_ptr())
        }
    }
}

fn set_app_active(active: bool) {
    GAMMA_STATE.lock().unwrap().set_app_active(active);
}

fn app_active() -> bool {
    GAMMA_STATE.lock().unwrap().app_active
}

unsafe fn schedule_reapply(window: HWND) {
    unsafe {
        SetTimer(
            window,
            GAMMA_REAPPLY_TIMER_ID,
            GAMMA_REAPPLY_TIMEOUT_MILLIS,
            None,
        );
    }
}

unsafe fn cancel_reapply(window: HWND) {
    unsafe {
        KillTimer(window, GAMMA_REAPPLY_TIMER_ID);
    }
}

unsafe fn reapply_desired_ramp(window: HWND) {
    unsafe {
        if IsIconic(window) != 0 || GetForegroundWindow() != window {
            return;
        }

        let (desired, device) = {
            let mut state = GAMMA_STATE.lock().unwrap();
            if !state.app_active {
                state.set_app_active(true);
            }
            state.finish_restore();
            (state.desired, state.device)
        };
        let Some(desired) = desired else {
            return;
        };
        let Some(dc) = create_display_dc(window, device) else {
            warn!("Could not create a DC to restore SC:R's gamma ramp after activation");
            return;
        };

        GAMMA_STATE.lock().unwrap().device = Some(dc.device);
        debug!("Reapplying SC:R's gamma ramp after display activation");
        let result = with_scr_hooks_disabled(|| {
            SetDeviceGammaRamp(
                dc.handle,
                desired.as_api_ptr().cast::<winapi::ctypes::c_void>(),
            )
        });
        if result == 0 {
            warn!("Failed to reapply SC:R's gamma ramp after display activation");
        }
    }
}

pub(super) unsafe fn handle_window_message(window: HWND, msg: u32, wparam: usize) {
    unsafe {
        if !is_forge_window(window) {
            return;
        }

        match msg {
            WM_ACTIVATEAPP => {
                let active = wparam != 0;
                set_app_active(active);
                if active {
                    schedule_reapply(window);
                } else {
                    cancel_reapply(window);
                }
            }
            WM_ACTIVATE => {
                // SC:R can receive an active WM_ACTIVATE while the high word still says the window
                // is minimized. Treat the non-inactive low word as authoritative and let the timer
                // verify IsIconic after the restore sequence has settled.
                let active = (wparam & 0xffff) != WA_INACTIVE as usize;
                set_app_active(active);
                if active {
                    schedule_reapply(window);
                } else {
                    cancel_reapply(window);
                }
            }
            WM_SIZE if wparam == SIZE_MINIMIZED => {
                set_app_active(false);
                cancel_reapply(window);
            }
            WM_SIZE => {
                if GetForegroundWindow() == window {
                    set_app_active(true);
                    schedule_reapply(window);
                }
            }
            WM_DISPLAYCHANGE if app_active() => schedule_reapply(window),
            WM_TIMER if wparam == GAMMA_REAPPLY_TIMER_ID => {
                cancel_reapply(window);
                reapply_desired_ramp(window);
            }
            _ => (),
        }
    }
}

pub(super) fn window_created() {
    let mut state = GAMMA_STATE.lock().unwrap();
    let configured = state.configured;
    *state = GammaState {
        desired: configured,
        configured,
        ..GammaState::default()
    };
}

#[cfg(test)]
mod tests {
    use super::{GammaRamp, GammaState, RampObservation};

    fn ramp(value: u16) -> GammaRamp {
        GammaRamp([value; super::GAMMA_RAMP_WORDS])
    }

    #[test]
    fn inactive_desktop_restore_retains_desired_ramp() {
        let desktop = ramp(1);
        let desired = ramp(2);
        let mut state = GammaState::default();
        state.record_desktop(desktop, None);
        state.set_app_active(true);
        state.finish_restore();
        assert_eq!(state.observe_set(desired), RampObservation::DesiredChanged);

        state.set_app_active(false);
        assert_eq!(state.observe_set(desktop), RampObservation::Unchanged);
        assert!(state.desired == Some(desired));
    }

    #[test]
    fn active_desktop_restore_clears_stale_desired_ramp() {
        let desktop = ramp(1);
        let desired = ramp(2);
        let mut state = GammaState::default();
        state.record_desktop(desktop, None);
        state.set_app_active(true);
        state.finish_restore();
        state.observe_set(desired);

        assert_eq!(state.observe_set(desktop), RampObservation::DesiredCleared);
        assert!(state.desired.is_none());
    }

    #[test]
    fn desktop_restore_during_reactivation_retains_desired_ramp() {
        let desktop = ramp(1);
        let desired = ramp(2);
        let mut state = GammaState::default();
        state.record_desktop(desktop, None);
        state.set_app_active(true);
        state.finish_restore();
        state.observe_set(desired);

        state.set_app_active(false);
        state.set_app_active(true);
        assert_eq!(state.observe_set(desktop), RampObservation::Unchanged);
        assert!(state.desired == Some(desired));
    }

    #[test]
    fn non_desktop_ramp_is_captured_after_desktop_read() {
        let desktop = ramp(1);
        let desired = ramp(2);
        let mut state = GammaState::default();
        state.record_desktop(desktop, None);

        assert_eq!(state.observe_set(desired), RampObservation::DesiredChanged);
        assert!(state.desired == Some(desired));
    }

    #[test]
    fn inactive_ramp_without_desktop_sample_is_ignored() {
        let mut state = GammaState::default();
        assert_eq!(state.observe_set(ramp(2)), RampObservation::Unchanged);
        assert!(state.desired.is_none());
    }

    #[test]
    fn gamma_setting_uses_scr_range_and_equal_rgb_channels() {
        let darker = GammaRamp::from_setting(60);
        let neutral = GammaRamp::from_setting(100);
        let brighter = GammaRamp::from_setting(140);

        assert_eq!(darker.0[0], 0);
        assert_eq!(neutral.0[0], 0);
        assert_eq!(brighter.0[0], 0);
        assert_eq!(darker.0[255], u16::MAX);
        assert_eq!(neutral.0[255], u16::MAX);
        assert_eq!(brighter.0[255], u16::MAX);
        assert!(darker.0[128] < neutral.0[128]);
        assert!(neutral.0[128] < brighter.0[128]);
        assert_eq!(darker.0[..256], darker.0[256..512]);
        assert_eq!(darker.0[..256], darker.0[512..]);
    }

    #[test]
    fn gamma_setting_clamps_to_scr_range() {
        assert!(GammaRamp::from_setting(0) == GammaRamp::from_setting(60));
        assert!(GammaRamp::from_setting(u32::MAX) == GammaRamp::from_setting(140));
    }

    #[test]
    fn desktop_capture_keeps_configured_startup_ramp() {
        let configured = GammaRamp::from_setting(120);
        let mut state = GammaState {
            desired: Some(configured),
            configured: Some(configured),
            ..GammaState::default()
        };

        state.record_desktop(ramp(1), None);

        assert!(state.desired == Some(configured));
    }
}
