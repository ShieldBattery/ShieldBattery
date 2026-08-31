use std::collections::{HashMap, HashSet};
use std::future::Future;
use std::ptr::null_mut;
use std::slice;
use std::sync::mpsc::{self, RecvTimeoutError};
use std::time::Duration;

use winapi::shared::guiddef::GUID;
use winapi::shared::minwindef::{BOOL, DWORD, FALSE, TRUE};
use winapi::shared::winerror::ERROR_SUCCESS;
use winapi::um::winnt::HANDLE;
use winapi::um::wlanapi::{
    PWLAN_INTERFACE_INFO_LIST, WLAN_API_VERSION_2_0, WlanCloseHandle, WlanEnumInterfaces,
    WlanFreeMemory, WlanOpenHandle, WlanSetInterface, wlan_interface_state_connected,
    wlan_intf_opcode_background_scan_enabled, wlan_intf_opcode_media_streaming_mode,
};

use super::os_string_from_winapi_with_nul;

const REFRESH_INTERVAL: Duration = Duration::from_secs(15);

/// Keeps connected Wi-Fi interfaces in their low-latency modes for a relay session's lifetime.
///
/// Both modes are aggregate requests tied to a Native Wi-Fi client. Retaining the client handle
/// allows Windows to combine this request with other applications' requests, and closing it releases
/// only this client's contribution. Windows resets the modes when an interface disconnects, so the
/// lease reapplies them periodically while the relay driver is still active.
pub struct WifiLowLatencyLease {
    client: WlanClientHandle,
    interface_results: HashMap<InterfaceKey, ApplyResult>,
    last_enum_error: Option<DWORD>,
}

impl WifiLowLatencyLease {
    /// Opens a Native Wi-Fi client and applies low-latency settings to connected interfaces.
    ///
    /// Failure is intentionally best-effort: network games must continue on adapters or Windows
    /// configurations that do not support these controls.
    pub fn acquire() -> Option<Self> {
        let mut negotiated_version = 0;
        let mut handle = null_mut();
        let result = unsafe {
            WlanOpenHandle(
                WLAN_API_VERSION_2_0,
                null_mut(),
                &mut negotiated_version,
                &mut handle,
            )
        };
        if result != ERROR_SUCCESS {
            warn!("Wi-Fi low-latency lease unavailable: WlanOpenHandle failed with {result}");
            return None;
        }
        if handle.is_null() {
            warn!("Wi-Fi low-latency lease unavailable: WlanOpenHandle returned a null handle");
            return None;
        }

        info!(
            "Wi-Fi low-latency lease acquired (Native Wi-Fi API version {negotiated_version:#x})"
        );
        let mut lease = Self {
            client: WlanClientHandle(handle as usize),
            interface_results: HashMap::new(),
            last_enum_error: None,
        };
        lease.refresh();
        Some(lease)
    }

    /// Drives the future while periodically reapplying interface settings after reconnect or resume.
    pub async fn maintain_while<F: Future>(self, future: F) -> F::Output {
        let (stop_tx, stop_rx) = mpsc::channel();
        // Native Wi-Fi calls are synchronous RPCs. Keep them off the async runtime so a slow WLAN
        // service or driver cannot pause the real-time relay driver this lease is protecting.
        let maintenance = tokio::task::spawn_blocking(move || {
            let mut lease = self;
            while let Err(RecvTimeoutError::Timeout) = stop_rx.recv_timeout(REFRESH_INTERVAL) {
                lease.refresh();
            }
        });

        let output = future.await;
        let _ = stop_tx.send(());
        if let Err(e) = maintenance.await {
            warn!("Wi-Fi low-latency maintenance task failed: {e}");
        }
        output
    }

    fn refresh(&mut self) {
        let mut interfaces = null_mut();
        let result = unsafe { WlanEnumInterfaces(self.client.raw(), null_mut(), &mut interfaces) };
        if result != ERROR_SUCCESS {
            if self.last_enum_error != Some(result) {
                warn!("Wi-Fi low-latency refresh failed: WlanEnumInterfaces returned {result}");
            }
            self.last_enum_error = Some(result);
            return;
        }
        if interfaces.is_null() {
            if self.last_enum_error != Some(ERROR_SUCCESS) {
                warn!("Wi-Fi low-latency refresh failed: WlanEnumInterfaces returned no list");
            }
            self.last_enum_error = Some(ERROR_SUCCESS);
            return;
        }

        if self.last_enum_error.take().is_some() {
            info!("Wi-Fi low-latency interface enumeration recovered");
        }

        let interfaces = WlanInterfaceList(interfaces);
        let list = unsafe { &*interfaces.0 };
        let entries = unsafe {
            slice::from_raw_parts(list.InterfaceInfo.as_ptr(), list.dwNumberOfItems as usize)
        };
        let mut connected = HashSet::with_capacity(entries.len());

        for interface in entries {
            if interface.isState != wlan_interface_state_connected {
                continue;
            }

            let key = InterfaceKey::from(&interface.InterfaceGuid);
            connected.insert(key);
            let result = self.apply(&interface.InterfaceGuid);
            let previous = self.interface_results.insert(key, result);
            if previous == Some(result) {
                continue;
            }

            let description = os_string_from_winapi_with_nul(&interface.strInterfaceDescription);
            if result.succeeded() {
                info!(
                    "Wi-Fi low-latency modes active on '{}'",
                    description.to_string_lossy()
                );
            } else {
                warn!(
                    "Wi-Fi low-latency modes failed on '{}': media streaming={}, background scan={}",
                    description.to_string_lossy(),
                    result.media_streaming,
                    result.background_scan,
                );
            }
        }

        self.interface_results
            .retain(|interface, _| connected.contains(interface));
    }

    fn apply(&self, interface: &GUID) -> ApplyResult {
        let mut media_streaming: BOOL = TRUE;
        let media_streaming = unsafe {
            WlanSetInterface(
                self.client.raw(),
                interface,
                wlan_intf_opcode_media_streaming_mode,
                size_of::<BOOL>() as DWORD,
                &mut media_streaming as *mut _ as *mut _,
                null_mut(),
            )
        };

        let mut background_scan: BOOL = FALSE;
        let background_scan = unsafe {
            WlanSetInterface(
                self.client.raw(),
                interface,
                wlan_intf_opcode_background_scan_enabled,
                size_of::<BOOL>() as DWORD,
                &mut background_scan as *mut _ as *mut _,
                null_mut(),
            )
        };

        ApplyResult {
            media_streaming,
            background_scan,
        }
    }
}

/// Native Wi-Fi handles are pointer-sized opaque values. The lease has exclusive ownership and
/// stores the value as usize so it can follow its single Tokio task across worker threads.
struct WlanClientHandle(usize);

impl WlanClientHandle {
    fn raw(&self) -> HANDLE {
        self.0 as HANDLE
    }
}

impl Drop for WlanClientHandle {
    fn drop(&mut self) {
        let result = unsafe { WlanCloseHandle(self.raw(), null_mut()) };
        if result == ERROR_SUCCESS {
            info!("Wi-Fi low-latency lease released");
        } else {
            warn!("Wi-Fi low-latency lease release failed: WlanCloseHandle returned {result}");
        }
    }
}

struct WlanInterfaceList(PWLAN_INTERFACE_INFO_LIST);

impl Drop for WlanInterfaceList {
    fn drop(&mut self) {
        unsafe {
            WlanFreeMemory(self.0 as *mut _);
        }
    }
}

#[derive(Clone, Copy, Eq, Hash, PartialEq)]
struct InterfaceKey {
    data1: u32,
    data2: u16,
    data3: u16,
    data4: [u8; 8],
}

impl From<&GUID> for InterfaceKey {
    fn from(value: &GUID) -> Self {
        Self {
            data1: value.Data1,
            data2: value.Data2,
            data3: value.Data3,
            data4: value.Data4,
        }
    }
}

#[derive(Clone, Copy, Eq, PartialEq)]
struct ApplyResult {
    media_streaming: DWORD,
    background_scan: DWORD,
}

impl ApplyResult {
    fn succeeded(self) -> bool {
        self.media_streaming == ERROR_SUCCESS && self.background_scan == ERROR_SUCCESS
    }
}
