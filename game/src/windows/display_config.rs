//! The display configuration tables: which outputs are active, what the monitor shown each one's
//! picture calls itself, and which GPU that monitor is plugged into.
//!
//! The GPU a monitor is plugged into is the one that scans its picture out, so a game rendering on
//! any other GPU has every frame copied over to it. DXGI can't be asked this reliably: an output is
//! listed under whichever adapter enumerated it, and on hybrid-graphics laptops the discrete GPU can
//! list the built-in panel that the integrated GPU drives.

use std::mem;
use std::ptr::null_mut;

use winapi::Interface;
use winapi::shared::basetsd::UINT32;
use winapi::shared::dxgi::{CreateDXGIFactory1, DXGI_ADAPTER_DESC, IDXGIFactory1};
use winapi::shared::ntdef::LUID;
use winapi::shared::winerror::ERROR_SUCCESS;
use winapi::um::wingdi::{
    DISPLAYCONFIG_DEVICE_INFO_GET_SOURCE_NAME, DISPLAYCONFIG_DEVICE_INFO_GET_TARGET_NAME,
    DISPLAYCONFIG_DEVICE_INFO_HEADER, DISPLAYCONFIG_MODE_INFO, DISPLAYCONFIG_PATH_INFO,
    DISPLAYCONFIG_SOURCE_DEVICE_NAME, DISPLAYCONFIG_TARGET_DEVICE_NAME, DISPLAYCONFIG_TOPOLOGY_ID,
    QDC_ONLY_ACTIVE_PATHS,
};
use winapi::um::winnt::LONG;

use super::os_string_from_winapi_with_nul;

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

/// More adapters than any real machine has; bounds the enumeration loop.
const MAX_ADAPTERS: u32 = 32;

/// One monitor being shown an output's picture.
pub struct ActivePath {
    /// The system's name for the output ("\\.\DISPLAY1").
    pub output: String,
    /// The name the monitor's own hardware reports ("AORUS FO27Q2"), empty if it reports none.
    pub monitor_name: String,
    /// The GPU the monitor is plugged into.
    pub adapter: LUID,
}

/// Every monitor currently shown a picture. Several can be shown the same output's, so an output
/// can appear more than once. Empty when the display configuration can't be read (as under Wine
/// builds that don't implement it).
pub fn active_paths() -> Vec<ActivePath> {
    let mut path_count: UINT32 = 0;
    let mut mode_count: UINT32 = 0;
    unsafe {
        if GetDisplayConfigBufferSizes(QDC_ONLY_ACTIVE_PATHS, &mut path_count, &mut mode_count)
            != ERROR_SUCCESS as LONG
        {
            return Vec::new();
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
            return Vec::new();
        }
        let mut active = Vec::with_capacity(path_count as usize);
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
            let monitor_name = match DisplayConfigGetDeviceInfo(&mut target.header) {
                result if result == ERROR_SUCCESS as LONG => {
                    wide_string(&target.monitorFriendlyDeviceName)
                }
                _ => String::new(),
            };
            active.push(ActivePath {
                output: wide_string(&source.viewGdiDeviceName),
                monitor_name,
                adapter: path.targetInfo.adapterId,
            });
        }
        active
    }
}

/// The GPU the monitor shown `output`'s picture is plugged into, or the first such monitor's when
/// several are.
pub fn output_adapter(output: &str) -> Option<LUID> {
    active_paths()
        .into_iter()
        .find(|path| path.output == output)
        .map(|path| path.adapter)
}

/// DXGI's description of the adapter with `luid`.
pub fn adapter_desc(luid: LUID) -> Option<DXGI_ADAPTER_DESC> {
    unsafe {
        let mut factory = null_mut();
        if CreateDXGIFactory1(&IDXGIFactory1::uuidof(), &mut factory) < 0 || factory.is_null() {
            return None;
        }
        let factory = factory as *mut IDXGIFactory1;
        let mut found = None;
        for index in 0..MAX_ADAPTERS {
            let mut adapter = null_mut();
            if (*factory).EnumAdapters(index, &mut adapter) < 0 || adapter.is_null() {
                break;
            }
            let mut desc: DXGI_ADAPTER_DESC = mem::zeroed();
            let described = (*adapter).GetDesc(&mut desc) >= 0;
            (*adapter).Release();
            if described && same_luid(desc.AdapterLuid, luid) {
                found = Some(desc);
                break;
            }
        }
        (*factory).Release();
        found
    }
}

pub fn same_luid(a: LUID, b: LUID) -> bool {
    a.LowPart == b.LowPart && a.HighPart == b.HighPart
}

/// A fixed-size UTF-16 field as a string, ending where the field's own terminator does.
fn wide_string(wide: &[u16]) -> String {
    os_string_from_winapi_with_nul(wide)
        .to_string_lossy()
        .into_owned()
}
