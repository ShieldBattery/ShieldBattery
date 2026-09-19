//! The displays the game can be put on, as the options screen lists them.
//!
//! Two sources, because neither alone says everything the screen needs. `EnumDisplayMonitors` gives
//! every display, where each one sits on the desktop, and which of them the desktop treats as the
//! main one. The display configuration tables give the name a monitor's own hardware reports
//! ("AORUS FO27Q2"), which is what the game's own video options show, in place of the system's name
//! for the output it is plugged into ("\\.\DISPLAY1"). The two are joined on that output name, and
//! a display whose hardware names itself nothing is listed by its output instead.

use std::ffi::OsString;
use std::mem;
use std::os::windows::ffi::OsStringExt;
use std::ptr::{null, null_mut};

use hashbrown::HashMap;
use overlay_ui::options::{MonitorView, OptionsLists};
use winapi::shared::basetsd::UINT32;
use winapi::shared::minwindef::{BOOL, DWORD, LPARAM, TRUE};
use winapi::shared::windef::{HDC, HMONITOR, LPRECT};
use winapi::shared::winerror::ERROR_SUCCESS;
use winapi::um::wingdi::{
    DISPLAYCONFIG_DEVICE_INFO_GET_SOURCE_NAME, DISPLAYCONFIG_DEVICE_INFO_GET_TARGET_NAME,
    DISPLAYCONFIG_DEVICE_INFO_HEADER, DISPLAYCONFIG_MODE_INFO, DISPLAYCONFIG_PATH_INFO,
    DISPLAYCONFIG_SOURCE_DEVICE_NAME, DISPLAYCONFIG_TARGET_DEVICE_NAME, DISPLAYCONFIG_TOPOLOGY_ID,
    QDC_ONLY_ACTIVE_PATHS,
};
use winapi::um::winnt::LONG;
use winapi::um::winuser::{
    EnumDisplayMonitors, GetMonitorInfoW, LPMONITORINFO, MONITORINFOEXW, MONITORINFOF_PRIMARY,
};

// user32 exports these, but the winapi crate declares only the structures they work on, so the
// functions themselves are declared here. Both architectures call user32 with the `system` ABI, and
// the import library decorates the names for whichever one is being built.
#[link(name = "user32")]
unsafe extern "system" {
    fn GetDisplayConfigBufferSizes(
        flags: UINT32,
        num_paths: *mut UINT32,
        num_modes: *mut UINT32,
    ) -> LONG;
    fn QueryDisplayConfig(
        flags: UINT32,
        num_paths: *mut UINT32,
        paths: *mut DISPLAYCONFIG_PATH_INFO,
        num_modes: *mut UINT32,
        modes: *mut DISPLAYCONFIG_MODE_INFO,
        current_topology: *mut DISPLAYCONFIG_TOPOLOGY_ID,
    ) -> LONG;
    fn DisplayConfigGetDeviceInfo(packet: *mut DISPLAYCONFIG_DEVICE_INFO_HEADER) -> LONG;
}

/// One display, as the system describes it.
#[derive(Clone, PartialEq, Eq, Debug)]
pub struct Monitor {
    /// What to call the display on screen.
    pub name: String,
    /// Whether the desktop treats this as the main display.
    pub primary: bool,
    /// Where the display sits on the desktop, as `(x, y, width, height)`: the same rectangle, in
    /// the same shape, that a launch names the display it wants by.
    pub bounds: (i32, i32, u32, u32),
}

/// Every display this machine has, and which of them a game launched with `monitor_bounds` is being
/// put on.
pub fn displays(monitor_bounds: Option<(i32, i32, u32, u32)>) -> (OptionsLists, usize) {
    let monitors = enumerate();
    let selected = index_for_bounds(&monitors, monitor_bounds);
    let lists = OptionsLists {
        monitors: monitors
            .into_iter()
            .map(|monitor| MonitorView {
                name: monitor.name,
                primary: monitor.primary,
            })
            .collect(),
    };
    (lists, selected)
}

/// Which display `wanted` is, or the main one when nothing was asked for and when what was asked
/// for is not on this machine.
///
/// A launch names a display by the desktop rectangle it covers. That rectangle is measured on the
/// asking side, which counts the desktop in its own scaled units, so on a machine whose displays
/// are not all at the same scale the numbers can differ from the ones read here. The corner a
/// display starts at survives that difference more often than its size does, and a point inside it
/// survives both, so a rectangle that matches nothing exactly is still placed rather than dropped.
pub fn index_for_bounds(monitors: &[Monitor], wanted: Option<(i32, i32, u32, u32)>) -> usize {
    let primary = monitors.iter().position(|m| m.primary).unwrap_or(0);
    let Some(wanted) = wanted else {
        return primary;
    };
    if let Some(index) = monitors.iter().position(|m| m.bounds == wanted) {
        return index;
    }
    if let Some(index) = monitors
        .iter()
        .position(|m| (m.bounds.0, m.bounds.1) == (wanted.0, wanted.1))
    {
        return index;
    }
    let centre = (
        wanted.0.saturating_add(wanted.2 as i32 / 2),
        wanted.1.saturating_add(wanted.3 as i32 / 2),
    );
    monitors
        .iter()
        .position(|m| contains(m.bounds, centre))
        .unwrap_or(primary)
}

/// Whether `point` falls inside `bounds`, whose right and bottom edges are the first row and column
/// of the display beside it rather than the last of this one.
fn contains(bounds: (i32, i32, u32, u32), point: (i32, i32)) -> bool {
    let right = bounds.0.saturating_add(bounds.2 as i32);
    let bottom = bounds.1.saturating_add(bounds.3 as i32);
    point.0 >= bounds.0 && point.0 < right && point.1 >= bounds.1 && point.1 < bottom
}

/// Every display attached to this machine, in the order the system enumerates them.
fn enumerate() -> Vec<Monitor> {
    let mut found: Vec<Enumerated> = Vec::new();
    let enumerated = unsafe {
        EnumDisplayMonitors(
            null_mut(),
            null(),
            Some(collect_monitor),
            &mut found as *mut Vec<Enumerated> as LPARAM,
        )
    };
    if enumerated == 0 {
        warn!("Could not enumerate the machine's displays");
        return Vec::new();
    }
    let names = friendly_names();
    found
        .into_iter()
        .map(|monitor| Monitor {
            name: names
                .get(&monitor.device)
                .cloned()
                .unwrap_or(monitor.device),
            primary: monitor.primary,
            bounds: monitor.bounds,
        })
        .collect()
}

/// One display as [`collect_monitor`] read it, named by the output it is plugged into.
struct Enumerated {
    device: String,
    primary: bool,
    bounds: (i32, i32, u32, u32),
}

unsafe extern "system" fn collect_monitor(
    monitor: HMONITOR,
    _hdc: HDC,
    _clip: LPRECT,
    data: LPARAM,
) -> BOOL {
    unsafe {
        let found = &mut *(data as *mut Vec<Enumerated>);
        let mut info: MONITORINFOEXW = mem::zeroed();
        info.cbSize = mem::size_of::<MONITORINFOEXW>() as DWORD;
        if GetMonitorInfoW(monitor, &mut info as *mut MONITORINFOEXW as LPMONITORINFO) != 0 {
            let rect = info.rcMonitor;
            found.push(Enumerated {
                device: wide_string(&info.szDevice),
                primary: info.dwFlags & MONITORINFOF_PRIMARY != 0,
                bounds: (
                    rect.left,
                    rect.top,
                    rect.right.saturating_sub(rect.left).max(0) as u32,
                    rect.bottom.saturating_sub(rect.top).max(0) as u32,
                ),
            });
        }
        // Enumeration carries on either way: one display that cannot be read must not cost the
        // list the others.
        TRUE
    }
}

/// The name each output's monitor reports for itself, keyed by the output's own name.
///
/// Empty when the display configuration cannot be read, which leaves every display listed by its
/// output: a list of plain names is worth more than no list at all.
fn friendly_names() -> HashMap<String, String> {
    let mut names = HashMap::new();
    let mut path_count: UINT32 = 0;
    let mut mode_count: UINT32 = 0;
    unsafe {
        if GetDisplayConfigBufferSizes(QDC_ONLY_ACTIVE_PATHS, &mut path_count, &mut mode_count)
            != ERROR_SUCCESS as LONG
        {
            return names;
        }
        let mut paths: Vec<DISPLAYCONFIG_PATH_INFO> = vec![mem::zeroed(); path_count as usize];
        let mut modes: Vec<DISPLAYCONFIG_MODE_INFO> = vec![mem::zeroed(); mode_count as usize];
        if QueryDisplayConfig(
            QDC_ONLY_ACTIVE_PATHS,
            &mut path_count,
            paths.as_mut_ptr(),
            &mut mode_count,
            modes.as_mut_ptr(),
            null_mut(),
        ) != ERROR_SUCCESS as LONG
        {
            return names;
        }
        for path in paths.iter().take(path_count as usize) {
            let mut source: DISPLAYCONFIG_SOURCE_DEVICE_NAME = mem::zeroed();
            source.header._type = DISPLAYCONFIG_DEVICE_INFO_GET_SOURCE_NAME;
            source.header.size = mem::size_of::<DISPLAYCONFIG_SOURCE_DEVICE_NAME>() as UINT32;
            source.header.adapterId = path.sourceInfo.adapterId;
            source.header.id = path.sourceInfo.id;
            if DisplayConfigGetDeviceInfo(&mut source.header) != ERROR_SUCCESS as LONG {
                continue;
            }
            let mut target: DISPLAYCONFIG_TARGET_DEVICE_NAME = mem::zeroed();
            target.header._type = DISPLAYCONFIG_DEVICE_INFO_GET_TARGET_NAME;
            target.header.size = mem::size_of::<DISPLAYCONFIG_TARGET_DEVICE_NAME>() as UINT32;
            target.header.adapterId = path.targetInfo.adapterId;
            target.header.id = path.targetInfo.id;
            if DisplayConfigGetDeviceInfo(&mut target.header) != ERROR_SUCCESS as LONG {
                continue;
            }
            let name = wide_string(&target.monitorFriendlyDeviceName);
            if name.is_empty() {
                continue;
            }
            // Several monitors can be shown the same output's picture, and the list has one entry
            // per output, so the first of them is the one it is named after.
            names
                .entry(wide_string(&source.viewGdiDeviceName))
                .or_insert(name);
        }
    }
    names
}

/// A fixed-size UTF-16 field as a string, ending where the field's own terminator does.
fn wide_string(wide: &[u16]) -> String {
    let end = wide.iter().position(|&c| c == 0).unwrap_or(wide.len());
    OsString::from_wide(&wide[..end])
        .to_string_lossy()
        .into_owned()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn monitors() -> Vec<Monitor> {
        vec![
            Monitor {
                name: "DELL U2415".to_string(),
                primary: false,
                bounds: (-1200, 0, 1200, 1920),
            },
            Monitor {
                name: "AORUS FO27Q2".to_string(),
                primary: true,
                bounds: (0, 0, 2560, 1440),
            },
            Monitor {
                name: "LG TV".to_string(),
                primary: false,
                bounds: (2560, 0, 3840, 2160),
            },
        ]
    }

    /// The rectangle a launch names its display by is the one that display covers, so it is found
    /// wherever on the desktop it sits.
    #[test]
    fn a_displays_own_rectangle_finds_it() {
        let monitors = monitors();
        assert_eq!(index_for_bounds(&monitors, Some((-1200, 0, 1200, 1920))), 0);
        assert_eq!(index_for_bounds(&monitors, Some((0, 0, 2560, 1440))), 1);
        assert_eq!(index_for_bounds(&monitors, Some((2560, 0, 3840, 2160))), 2);
    }

    /// A rectangle measured in units this side does not share still places the display it covers:
    /// by the corner it starts at, or failing that by a point inside it.
    #[test]
    fn a_rectangle_measured_differently_still_places_its_display() {
        let monitors = monitors();
        assert_eq!(index_for_bounds(&monitors, Some((2560, 0, 1920, 1080))), 2);
        assert_eq!(index_for_bounds(&monitors, Some((3000, 100, 800, 600))), 2);
    }

    /// Nothing asked for, and something asked for that is not on this machine, both leave the game
    /// on the display the desktop treats as the main one.
    #[test]
    fn an_unknown_display_falls_back_to_the_primary() {
        let monitors = monitors();
        assert_eq!(index_for_bounds(&monitors, None), 1);
        assert_eq!(
            index_for_bounds(&monitors, Some((-9000, -9000, 1024, 768))),
            1
        );
        // A machine whose displays say none of them is the main one still has a first one.
        let no_primary: Vec<Monitor> = monitors
            .into_iter()
            .map(|monitor| Monitor {
                primary: false,
                ..monitor
            })
            .collect();
        assert_eq!(index_for_bounds(&no_primary, None), 0);
        assert_eq!(index_for_bounds(&[], Some((0, 0, 640, 480))), 0);
    }
}
