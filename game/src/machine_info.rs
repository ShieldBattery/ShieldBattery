//! Logs facts about the machine the game runs on: the Windows version, CPU, memory, GPUs,
//! monitors, and the third-party modules loaded into the process (antivirus hooks, overlays and
//! the like).
//!
//! Every line starts with `Machine:` so the whole set can be found with one search. The module
//! lists only carry file names, as full paths contain the Windows user name.
//!
//! Everything here makes calls that take the loader lock or load driver DLLs, so none of it may run
//! while the DLL is being injected. It runs on Tokio's blocking pool once the async runtime is up,
//! which also keeps the DXGI and registry calls off the game's main thread.

use std::collections::BTreeMap;
use std::ffi::CStr;
use std::mem;
use std::path::Path;
use std::ptr::{null, null_mut};

use parking_lot::Mutex;
use winapi::Interface;
use winapi::shared::dxgi::{
    CreateDXGIFactory1, DXGI_ADAPTER_DESC1, DXGI_ADAPTER_FLAG_SOFTWARE, IDXGIDevice, IDXGIFactory1,
};
use winapi::shared::minwindef::{BOOL, LPARAM, TRUE};
use winapi::shared::ntdef::LARGE_INTEGER;
use winapi::shared::windef::{HDC, HMONITOR, LPRECT};
use winapi::um::handleapi::{CloseHandle, INVALID_HANDLE_VALUE};
use winapi::um::processthreadsapi::GetCurrentProcessId;
use winapi::um::sysinfoapi::{
    GetSystemDirectoryW, GetSystemInfo, GetWindowsDirectoryW, GlobalMemoryStatusEx, MEMORYSTATUSEX,
    SYSTEM_INFO,
};
use winapi::um::tlhelp32::{
    CreateToolhelp32Snapshot, MODULEENTRY32W, Module32FirstW, Module32NextW, TH32CS_SNAPMODULE,
};
use winapi::um::wingdi::DEVMODEW;
use winapi::um::winnt::OSVERSIONINFOW;
use winapi::um::winuser::{
    ENUM_CURRENT_SETTINGS, EnumDisplayMonitors, EnumDisplaySettingsW, GetMonitorInfoW,
    MONITORINFOEXW, MONITORINFOF_PRIMARY,
};

use crate::windows::{self, load_library, module_name, os_string_from_winapi_with_nul, registry};

#[cfg(target_arch = "x86")]
use std::arch::x86::__cpuid;
#[cfg(target_arch = "x86_64")]
use std::arch::x86_64::__cpuid;

/// More adapters than any real machine has; bounds the enumeration loop.
const MAX_ADAPTERS: u32 = 32;

/// Third-party modules seen by the first listing, keyed by lowercased file name. `None` until the
/// first listing has been taken.
static LISTED_MODULES: Mutex<Option<BTreeMap<String, String>>> = Mutex::new(None);

/// Logs the machine description and the modules loaded so far. Needs the async runtime.
pub fn log_at_startup() {
    crate::async_handle().spawn_blocking(|| {
        log_system();
        let modules = third_party_modules();
        info!(
            "Machine: {}",
            describe_modules("Modules loaded", modules.values())
        );
        *LISTED_MODULES.lock() = Some(modules);
    });
}

/// Logs the third-party modules that were not loaded when [`log_at_startup`] listed them, for
/// injectors that wait until the game is running. Needs the async runtime.
pub fn log_modules_loaded_since_startup() {
    crate::async_handle().spawn_blocking(|| {
        let mut listed = LISTED_MODULES.lock();
        let Some(listed) = listed.as_mut() else {
            return;
        };
        let current = third_party_modules();
        let added = new_modules(listed, current);
        info!(
            "Machine: {}",
            describe_modules("Modules loaded after game start", added.values())
        );
        listed.extend(added);
    });
}

fn log_system() {
    info!("Machine: {}", describe_windows());
    info!("Machine: {}", describe_cpu_and_memory());
    log_gpus();
    log_monitors();
}

fn describe_windows() -> String {
    let version = windows_version();
    let wine = wine_version();
    match (version, wine) {
        (Some((major, minor, build)), Some(wine)) => {
            format!("Wine {wine}, reporting Windows {major}.{minor}.{build}")
        }
        (None, Some(wine)) => format!("Wine {wine}"),
        (Some((major, minor, build)), None) => {
            let revision = registry::local_machine_dword(
                r"SOFTWARE\Microsoft\Windows NT\CurrentVersion",
                "UBR",
            );
            match revision {
                Some(revision) => format!("Windows {major}.{minor}.{build}.{revision}"),
                None => format!("Windows {major}.{minor}.{build}"),
            }
        }
        (None, None) => "Windows version unknown".into(),
    }
}

/// `RtlGetVersion` reports the real version, where `GetVersionEx` reports whatever the process's
/// compatibility shims say it is.
fn windows_version() -> Option<(u32, u32, u32)> {
    type RtlGetVersion = unsafe extern "system" fn(*mut OSVERSIONINFOW) -> i32;
    unsafe {
        let ntdll = load_library("ntdll").ok()?;
        let function = ntdll.proc_address("RtlGetVersion").ok()?;
        let function: RtlGetVersion = mem::transmute(function);
        let mut info: OSVERSIONINFOW = mem::zeroed();
        info.dwOSVersionInfoSize = size_of::<OSVERSIONINFOW>() as u32;
        if function(&mut info) < 0 {
            return None;
        }
        Some((info.dwMajorVersion, info.dwMinorVersion, info.dwBuildNumber))
    }
}

/// The Wine version, if running under Wine (or Proton), which exports it from its ntdll.
fn wine_version() -> Option<String> {
    type WineGetVersion = unsafe extern "C" fn() -> *const std::ffi::c_char;
    unsafe {
        let ntdll = load_library("ntdll").ok()?;
        let function = ntdll.proc_address("wine_get_version").ok()?;
        let function: WineGetVersion = mem::transmute(function);
        let version = function();
        if version.is_null() {
            return Some("(unknown version)".into());
        }
        Some(CStr::from_ptr(version).to_string_lossy().into_owned())
    }
}

fn describe_cpu_and_memory() -> String {
    let brand = cpu_brand().unwrap_or_else(|| "unknown CPU".into());
    let logical_processors = unsafe {
        let mut info: SYSTEM_INFO = mem::zeroed();
        GetSystemInfo(&mut info);
        info.dwNumberOfProcessors
    };
    let memory = unsafe {
        let mut status: MEMORYSTATUSEX = mem::zeroed();
        status.dwLength = size_of::<MEMORYSTATUSEX>() as u32;
        (GlobalMemoryStatusEx(&mut status) != 0).then_some(status.ullTotalPhys)
    };
    match memory {
        Some(bytes) => format!(
            "CPU {brand}, {logical_processors} logical processors, {} RAM",
            format_gibibytes(bytes)
        ),
        None => format!("CPU {brand}, {logical_processors} logical processors, RAM unknown"),
    }
}

fn cpu_brand() -> Option<String> {
    // Leaves 0x80000002 to 0x80000004 hold the brand string, 16 bytes each, if the CPU reports
    // extended leaves that far.
    let highest_extended_leaf = __cpuid(0x8000_0000).eax;
    if highest_extended_leaf < 0x8000_0004 {
        return None;
    }
    let mut raw = Vec::with_capacity(48);
    for leaf in 0x8000_0002..=0x8000_0004 {
        let regs = __cpuid(leaf);
        for reg in [regs.eax, regs.ebx, regs.ecx, regs.edx] {
            raw.extend_from_slice(&reg.to_le_bytes());
        }
    }
    let brand = clean_cpu_brand(&raw);
    (!brand.is_empty()).then_some(brand)
}

/// Brand strings are null padded and often have runs of spaces for alignment.
fn clean_cpu_brand(raw: &[u8]) -> String {
    let end = raw.iter().position(|&b| b == 0).unwrap_or(raw.len());
    String::from_utf8_lossy(&raw[..end])
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
}

fn format_gibibytes(bytes: u64) -> String {
    format!("{:.1} GiB", bytes as f64 / (1u64 << 30) as f64)
}

/// Formats the version `IDXGIAdapter::CheckInterfaceSupport` returns, which packs four 16-bit
/// parts, most significant first.
fn format_driver_version(packed: i64) -> String {
    let packed = packed as u64;
    format!(
        "{}.{}.{}.{}",
        (packed >> 48) & 0xffff,
        (packed >> 32) & 0xffff,
        (packed >> 16) & 0xffff,
        packed & 0xffff,
    )
}

fn log_gpus() {
    unsafe {
        let mut factory = null_mut();
        if CreateDXGIFactory1(&IDXGIFactory1::uuidof(), &mut factory) < 0 || factory.is_null() {
            info!("Machine: GPUs unknown, no DXGI factory");
            return;
        }
        let factory = factory as *mut IDXGIFactory1;
        for index in 0..MAX_ADAPTERS {
            let mut adapter = null_mut();
            if (*factory).EnumAdapters1(index, &mut adapter) < 0 || adapter.is_null() {
                break;
            }
            let mut desc: DXGI_ADAPTER_DESC1 = mem::zeroed();
            if (*adapter).GetDesc1(&mut desc) < 0 {
                info!("Machine: GPU {index}: description unavailable");
                (*adapter).Release();
                continue;
            }
            let mut driver_version: LARGE_INTEGER = mem::zeroed();
            let driver = if (*adapter)
                .CheckInterfaceSupport(&IDXGIDevice::uuidof(), &mut driver_version)
                >= 0
            {
                format_driver_version(*driver_version.QuadPart())
            } else {
                "unknown".into()
            };
            let software = if desc.Flags & DXGI_ADAPTER_FLAG_SOFTWARE != 0 {
                ", software adapter"
            } else {
                ""
            };
            info!(
                "Machine: GPU {index}: {}, vendor 0x{:04x} device 0x{:04x}, {} dedicated, \
                 driver {driver}{software}",
                os_string_from_winapi_with_nul(&desc.Description).to_string_lossy(),
                desc.VendorId,
                desc.DeviceId,
                format_gibibytes(desc.DedicatedVideoMemory as u64),
            );
            (*adapter).Release();
        }
        (*factory).Release();
    }
}

struct MonitorMode {
    width: u32,
    height: u32,
    refresh_rate: u32,
    primary: bool,
}

fn log_monitors() {
    let mut monitors: Vec<MonitorMode> = Vec::new();
    unsafe {
        EnumDisplayMonitors(
            null_mut(),
            null(),
            Some(collect_monitor),
            &mut monitors as *mut Vec<MonitorMode> as LPARAM,
        );
    }
    if monitors.is_empty() {
        info!("Machine: Monitors unknown");
    }
    for (index, monitor) in monitors.iter().enumerate() {
        info!(
            "Machine: Monitor {index}{}: {}x{} @ {} Hz",
            if monitor.primary { " (primary)" } else { "" },
            monitor.width,
            monitor.height,
            monitor.refresh_rate,
        );
    }
}

unsafe extern "system" fn collect_monitor(
    monitor: HMONITOR,
    _dc: HDC,
    _rect: LPRECT,
    monitors: LPARAM,
) -> BOOL {
    unsafe {
        let monitors = &mut *(monitors as *mut Vec<MonitorMode>);
        let mut info: MONITORINFOEXW = mem::zeroed();
        info.cbSize = size_of::<MONITORINFOEXW>() as u32;
        if GetMonitorInfoW(monitor, (&raw mut info).cast()) == 0 {
            return TRUE;
        }
        let mut mode: DEVMODEW = mem::zeroed();
        mode.dmSize = size_of::<DEVMODEW>() as u16;
        if EnumDisplaySettingsW(info.szDevice.as_ptr(), ENUM_CURRENT_SETTINGS, &mut mode) == 0 {
            return TRUE;
        }
        monitors.push(MonitorMode {
            width: mode.dmPelsWidth,
            height: mode.dmPelsHeight,
            refresh_rate: mode.dmDisplayFrequency,
            primary: info.dwFlags & MONITORINFOF_PRIMARY != 0,
        });
    }
    TRUE
}

/// Excludes modules that are expected to be in the process: Windows' own, StarCraft's, and this
/// DLL's.
struct ModuleFilter {
    /// Lowercased with a trailing backslash, so a prefix match can't stop partway through a
    /// directory name.
    excluded_dirs: Vec<String>,
}

impl ModuleFilter {
    fn new(dirs: impl IntoIterator<Item = String>) -> ModuleFilter {
        ModuleFilter {
            excluded_dirs: dirs
                .into_iter()
                .filter(|dir| !dir.is_empty())
                .map(|dir| {
                    let mut dir = normalize_path(&dir);
                    if !dir.ends_with('\\') {
                        dir.push('\\');
                    }
                    dir
                })
                .collect(),
        }
    }

    fn for_this_process() -> ModuleFilter {
        let windows_dir = windows_directory();
        let mut dirs = Vec::new();
        if let Some(windows_dir) = &windows_dir {
            for subdirectory in ["System32", "SysWOW64", "WinSxS"] {
                dirs.push(format!("{windows_dir}\\{subdirectory}"));
            }
        }
        dirs.extend(system_directory());
        let parent_of = |handle| {
            module_name(handle).and_then(|path| {
                Path::new(&path)
                    .parent()
                    .map(|p| p.to_string_lossy().into())
            })
        };
        // The executable's directory is StarCraft's install; this DLL's is the app's.
        dirs.extend(parent_of(null_mut()));
        let self_handle = crate::SELF_HANDLE.load(std::sync::atomic::Ordering::Relaxed);
        if self_handle != 0 {
            dirs.extend(parent_of(self_handle as *mut _));
        }
        ModuleFilter::new(dirs)
    }

    fn excludes(&self, module_path: &str) -> bool {
        let path = normalize_path(module_path);
        self.excluded_dirs.iter().any(|dir| path.starts_with(dir))
    }
}

/// Lowercases a path and drops the `\\?\` prefix some APIs add, so paths from different sources
/// compare equal.
fn normalize_path(path: &str) -> String {
    let path = path.strip_prefix(r"\\?\").unwrap_or(path);
    path.replace('/', "\\").to_lowercase()
}

fn windows_directory() -> Option<String> {
    wide_path_query(|buffer, len| unsafe { GetWindowsDirectoryW(buffer, len) })
}

fn system_directory() -> Option<String> {
    wide_path_query(|buffer, len| unsafe { GetSystemDirectoryW(buffer, len) })
}

fn wide_path_query(query: impl Fn(*mut u16, u32) -> u32) -> Option<String> {
    let mut buffer = vec![0u16; 260];
    let mut written = query(buffer.as_mut_ptr(), buffer.len() as u32) as usize;
    if written > buffer.len() {
        // Too small: the return value is the size needed, including the terminator.
        buffer.resize(written, 0);
        written = query(buffer.as_mut_ptr(), buffer.len() as u32) as usize;
    }
    if written == 0 || written > buffer.len() {
        return None;
    }
    Some(
        os_string_from_winapi_with_nul(&buffer)
            .to_string_lossy()
            .into_owned(),
    )
}

/// The file names of loaded modules outside the expected directories, keyed by lowercased name.
fn third_party_modules() -> BTreeMap<String, String> {
    let filter = ModuleFilter::for_this_process();
    let mut modules = BTreeMap::new();
    for (name, path) in loaded_modules() {
        if !filter.excludes(&path) {
            modules.insert(name.to_lowercase(), name);
        }
    }
    modules
}

/// File name and full path of every module loaded in the process.
fn loaded_modules() -> Vec<(String, String)> {
    let mut modules = Vec::new();
    unsafe {
        let snapshot = CreateToolhelp32Snapshot(TH32CS_SNAPMODULE, GetCurrentProcessId());
        if snapshot == INVALID_HANDLE_VALUE {
            return modules;
        }
        let mut entry: MODULEENTRY32W = mem::zeroed();
        entry.dwSize = size_of::<MODULEENTRY32W>() as u32;
        let mut more = Module32FirstW(snapshot, &mut entry) != 0;
        while more {
            modules.push((
                windows::os_string_from_winapi_with_nul(&entry.szModule)
                    .to_string_lossy()
                    .into_owned(),
                windows::os_string_from_winapi_with_nul(&entry.szExePath)
                    .to_string_lossy()
                    .into_owned(),
            ));
            more = Module32NextW(snapshot, &mut entry) != 0;
        }
        CloseHandle(snapshot);
    }
    modules
}

/// The entries of `current` that `listed` doesn't have.
fn new_modules(
    listed: &BTreeMap<String, String>,
    current: BTreeMap<String, String>,
) -> BTreeMap<String, String> {
    current
        .into_iter()
        .filter(|(key, _)| !listed.contains_key(key))
        .collect()
}

fn describe_modules<'a>(label: &str, names: impl ExactSizeIterator<Item = &'a String>) -> String {
    let count = names.len();
    if count == 0 {
        return format!("{label}: none outside Windows, StarCraft and ShieldBattery");
    }
    let names = names.map(String::as_str).collect::<Vec<_>>().join(", ");
    format!("{label} ({count}): {names}")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn driver_version_unpacks_four_parts() {
        let packed = (32i64 << 48) | (15i64 << 16) | 6094;
        assert_eq!(format_driver_version(packed), "32.0.15.6094");
    }

    #[test]
    fn cpu_brand_collapses_padding() {
        let mut raw = b"  AMD Ryzen 9   7950X 16-Core Processor ".to_vec();
        raw.extend_from_slice(&[0; 8]);
        raw.extend_from_slice(b"garbage after the terminator");
        assert_eq!(clean_cpu_brand(&raw), "AMD Ryzen 9 7950X 16-Core Processor");
    }

    #[test]
    fn gibibytes_have_one_decimal() {
        assert_eq!(format_gibibytes(16 << 30), "16.0 GiB");
        assert_eq!(format_gibibytes(17_000_000_000), "15.8 GiB");
    }

    #[test]
    fn filter_excludes_directories_case_insensitively() {
        let filter = ModuleFilter::new([
            r"C:\Windows\System32".to_string(),
            r"C:\Program Files (x86)\StarCraft\".to_string(),
            String::new(),
        ]);
        assert!(filter.excludes(r"c:\windows\system32\kernel32.dll"));
        assert!(filter.excludes(r"\\?\C:\Windows\System32\drivers\x.dll"));
        assert!(filter.excludes(r"C:\Program Files (x86)\StarCraft\Starcraft.exe"));
        assert!(!filter.excludes(r"C:\Windows\System32Evil\hook.dll"));
        assert!(!filter.excludes(r"C:\Program Files\Avast\aswhook.dll"));
    }

    #[test]
    fn new_modules_ignores_case_and_known_entries() {
        let listed = BTreeMap::from([("a.dll".to_string(), "A.dll".to_string())]);
        let current = BTreeMap::from([
            ("a.dll".to_string(), "a.dll".to_string()),
            ("b.dll".to_string(), "B.dll".to_string()),
        ]);
        let added = new_modules(&listed, current);
        assert_eq!(added.values().collect::<Vec<_>>(), ["B.dll"]);
    }

    #[test]
    fn module_descriptions() {
        let names = ["a.dll".to_string(), "B.dll".to_string()];
        assert_eq!(
            describe_modules("Modules", names.iter()),
            "Modules (2): a.dll, B.dll"
        );
        assert_eq!(
            describe_modules("Modules", [].iter()),
            "Modules: none outside Windows, StarCraft and ShieldBattery"
        );
    }

    #[test]
    fn describes_this_machine_without_crashing() {
        assert!(describe_windows().contains("Windows") || describe_windows().contains("Wine"));
        assert!(!third_party_modules().contains_key("kernel32.dll"));
    }
}
