use std::mem;
use std::ptr::null_mut;

use serde::Deserialize;
use serde_repr::Deserialize_repr;
use winapi::shared::windef::{HMONITOR, HWND, RECT};
use winapi::um::winuser::*;

#[derive(Debug, Copy, Clone, PartialEq, Eq, Default, Deserialize_repr)]
#[repr(u8)]
pub(super) enum DisplayMode {
    Windowed = 0,
    #[default]
    WindowedFullscreen = 1,
    Fullscreen = 2,
}

/// How a windowed game places its window when it opens. Matches `GameWindowPlacement` in
/// `common/settings/local-settings.ts`.
#[derive(Debug, Copy, Clone, PartialEq, Eq, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
enum WindowPlacement {
    /// Where the window was last, at the size it was last.
    #[default]
    Remember,
    /// At the size the window was last, centered on its monitor.
    RememberSize,
    /// With a play area of [`Settings::set_size`], centered on its monitor.
    SetSize,
}

/// The size of the game's play area, not counting the window's title bar and borders.
#[derive(Debug, Copy, Clone, PartialEq, Eq, Deserialize)]
struct ClientSize {
    width: i32,
    height: i32,
}

#[derive(Debug, Copy, Clone, Default)]
pub(super) struct Settings {
    window_x: Option<i32>,
    window_y: Option<i32>,
    width: Option<i32>,
    height: Option<i32>,
    window_placement: WindowPlacement,
    set_size: Option<ClientSize>,

    display_mode: DisplayMode,

    /// If set, the bounds of the monitor that the user wants to launch on (in fullscreen modes).
    monitor_bounds: Option<(i32, i32, u32, u32)>,
}

impl Settings {
    pub(super) fn from_config(
        local_settings: &serde_json::Map<String, serde_json::Value>,
        scr_settings: &serde_json::Map<String, serde_json::Value>,
        monitor_bounds: Option<(i32, i32, u32, u32)>,
    ) -> Self {
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
        let window_placement = local_settings
            .get("gameWinPlacement")
            .and_then(|v| serde_json::from_value(v.clone()).ok())
            .unwrap_or_default();
        let set_size = local_settings
            .get("gameWinSetSize")
            .and_then(|v| serde_json::from_value::<ClientSize>(v.clone()).ok())
            .filter(|s| (1..100_000).contains(&s.width) && (1..100_000).contains(&s.height));

        let display_mode = scr_settings
            .get("displayMode")
            .and_then(|v| serde_json::from_value::<DisplayMode>(v.clone()).ok())
            .unwrap_or_default();
        Self {
            window_x,
            window_y,
            width,
            height,
            window_placement,
            set_size,

            display_mode,

            monitor_bounds,
        }
    }

    pub(super) fn display_mode(self) -> DisplayMode {
        self.display_mode
    }

    pub(super) fn monitor_bounds(self) -> Option<(i32, i32, u32, u32)> {
        self.monitor_bounds
    }

    pub(super) fn restore(self, handle: HWND) {
        let display_mode = self.display_mode;
        // Only use the saved position if all the values are set
        let saved = match (self.window_x, self.window_y, self.width, self.height) {
            (Some(x), Some(y), Some(width), Some(height)) => Some(WindowBounds {
                x,
                y,
                width,
                height,
            }),
            _ => None,
        };
        if let Some(saved) = &saved {
            move_to_monitor_of(handle, saved);
        }

        let bounds = match self.window_placement {
            WindowPlacement::Remember => {
                let Some(WindowBounds {
                    x,
                    y,
                    width,
                    height,
                }) = saved
                else {
                    return;
                };
                debug!(
                    "Restoring window position to ({x},{y}) {width}x{height} [{display_mode:?}]"
                );
                Some(ensure_window_is_visible(x, y, width, height, display_mode))
            }
            WindowPlacement::RememberSize => {
                let Some(WindowBounds { width, height, .. }) = saved else {
                    return;
                };
                debug!("Restoring window size to {width}x{height}, centered");
                // The saved size includes the title bar and borders
                window_borders(handle).and_then(|(border_width, border_height)| {
                    let play_area = ClientSize {
                        width: width - border_width,
                        height: height - border_height,
                    };
                    centered_bounds(handle, play_area, (border_width, border_height))
                })
            }
            WindowPlacement::SetSize => {
                let Some(size) = self.set_size else {
                    return;
                };
                debug!(
                    "Setting play area to {}x{}, centered",
                    size.width, size.height
                );
                window_borders(handle).and_then(|borders| centered_bounds(handle, size, borders))
            }
        };
        let Some(WindowBounds {
            x,
            y,
            width,
            height,
        }) = bounds
        else {
            error!("Couldn't measure the window or its monitor, leaving the window where it is");
            return;
        };
        debug!("Placing window at ({x},{y}) {width}x{height}");

        unsafe {
            super::with_scr_hooks_disabled(|| {
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

/// The total width and height that `window`'s title bar and borders add around its play area.
fn window_borders(window: HWND) -> Option<(i32, i32)> {
    unsafe {
        let mut outer = mem::zeroed::<RECT>();
        let mut client = mem::zeroed::<RECT>();
        if GetWindowRect(window, &mut outer) == 0 || GetClientRect(window, &mut client) == 0 {
            return None;
        }
        Some((
            (outer.right - outer.left) - (client.right - client.left),
            (outer.bottom - outer.top) - (client.bottom - client.top),
        ))
    }
}

/// Where to put `window` so its play area is `play_area`, with `borders` around it, centered on its
/// monitor. A play area that doesn't fit is shrunk, keeping its shape.
fn centered_bounds(
    window: HWND,
    play_area: ClientSize,
    (border_width, border_height): (i32, i32),
) -> Option<WindowBounds> {
    let area = unsafe { monitor_work_area(MonitorFromWindow(window, MONITOR_DEFAULTTONEAREST))? };
    let size = fit_within(
        play_area,
        area.right - area.left - border_width,
        area.bottom - area.top - border_height,
    );
    Some(center_in(
        &area,
        size.width + border_width,
        size.height + border_height,
    ))
}

/// Moves `window` onto the monitor `bounds` are on, if it's somewhere else. SC:R resizes the window
/// when that changes its DPI, so this has to happen before the window is measured and placed, or
/// the resize would undo the placement.
fn move_to_monitor_of(window: HWND, bounds: &WindowBounds) {
    unsafe {
        let rect = RECT {
            left: bounds.x,
            top: bounds.y,
            right: bounds.x + bounds.width,
            bottom: bounds.y + bounds.height,
        };
        let monitor = MonitorFromRect(&rect, MONITOR_DEFAULTTONEAREST);
        if monitor == MonitorFromWindow(window, MONITOR_DEFAULTTONEAREST) {
            return;
        }
        let Some(area) = monitor_work_area(monitor) else {
            return;
        };
        debug!(
            "Moving window to the monitor at ({},{})",
            area.left, area.top
        );
        super::with_scr_hooks_disabled(|| {
            SetWindowPos(
                window,
                null_mut(),
                area.left,
                area.top,
                0,
                0,
                SWP_NOSIZE | SWP_NOZORDER | SWP_NOACTIVATE,
            );
        });
    }
}

/// The work area of `monitor`: the monitor minus the taskbar and docked toolbars.
fn monitor_work_area(monitor: HMONITOR) -> Option<RECT> {
    unsafe {
        let mut monitor_info = mem::zeroed::<MONITORINFO>();
        monitor_info.cbSize = mem::size_of::<MONITORINFO>() as u32;
        if GetMonitorInfoA(monitor, &mut monitor_info) == 0 {
            return None;
        }
        Some(monitor_info.rcWork)
    }
}

/// Scales `size` down to fit within `max_width` by `max_height`, keeping its shape.
fn fit_within(size: ClientSize, max_width: i32, max_height: i32) -> ClientSize {
    if size.width <= max_width && size.height <= max_height {
        return size;
    }

    let (width, height) = (i64::from(size.width), i64::from(size.height));
    let (max_width, max_height) = (i64::from(max_width), i64::from(max_height));
    let scale_rounded = |value: i64, to: i64, from: i64| ((value * to + from / 2) / from) as i32;
    // Compares max_width / width against max_height / height without dividing
    if max_width * height <= max_height * width {
        ClientSize {
            width: max_width as i32,
            height: scale_rounded(height, max_width, width),
        }
    } else {
        ClientSize {
            width: scale_rounded(width, max_height, height),
            height: max_height as i32,
        }
    }
}

/// Centers a `width` by `height` rect in `area`, shrinking it to fit if it's larger.
fn center_in(area: &RECT, width: i32, height: i32) -> WindowBounds {
    let area_width = area.right - area.left;
    let area_height = area.bottom - area.top;
    let width = width.min(area_width);
    let height = height.min(area_height);
    WindowBounds {
        x: area.left + (area_width - width) / 2,
        y: area.top + (area_height - height) / 2,
        width,
        height,
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

#[cfg(test)]
mod tests {
    use super::*;

    fn rect(left: i32, top: i32, right: i32, bottom: i32) -> RECT {
        RECT {
            left,
            top,
            right,
            bottom,
        }
    }

    #[test]
    fn center_in_centers_a_smaller_window() {
        let bounds = center_in(&rect(0, 0, 1920, 1040), 1296, 1000);
        assert_eq!(
            bounds,
            WindowBounds {
                x: 312,
                y: 20,
                width: 1296,
                height: 1000,
            }
        );
    }

    #[test]
    fn center_in_accounts_for_the_area_offset() {
        let bounds = center_in(&rect(-1920, 100, 0, 1180), 1000, 800);
        assert_eq!(
            bounds,
            WindowBounds {
                x: -1460,
                y: 240,
                width: 1000,
                height: 800,
            }
        );
    }

    #[test]
    fn center_in_shrinks_a_window_larger_than_the_area() {
        let bounds = center_in(&rect(0, 0, 1280, 720), 1936, 1119);
        assert_eq!(
            bounds,
            WindowBounds {
                x: 0,
                y: 0,
                width: 1280,
                height: 720,
            }
        );
    }

    fn size(width: i32, height: i32) -> ClientSize {
        ClientSize { width, height }
    }

    #[test]
    fn fit_within_leaves_a_size_that_fits() {
        assert_eq!(fit_within(size(1280, 960), 2540, 1349), size(1280, 960));
    }

    #[test]
    fn fit_within_keeps_4_3_when_limited_by_height() {
        assert_eq!(fit_within(size(2880, 2160), 2540, 1349), size(1799, 1349));
    }

    #[test]
    fn fit_within_keeps_16_9_when_limited_by_height() {
        assert_eq!(fit_within(size(3840, 2160), 2540, 1349), size(2398, 1349));
    }

    #[test]
    fn fit_within_keeps_16_9_when_limited_by_width() {
        assert_eq!(fit_within(size(3840, 2160), 1900, 2000), size(1900, 1069));
    }
}
