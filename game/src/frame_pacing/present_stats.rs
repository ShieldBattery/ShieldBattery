//! Learns when the frames SC:R presents reach the display, from its swap chain's frame statistics.
//!
//! SC:R's renderer keeps its swap chain to itself, but makes it from a DXGI factory, and the
//! factories DXGI hands out share one table of methods. Replacing the table's swap chain creation
//! methods with ones that note what they made catches the swap chain as SC:R creates it, on any
//! DXGI implementation (Wine's and DXVK's included), without rewriting any code. Statistics are
//! only read on the game thread right after SC:R presents, when the swap chain is known to be
//! alive, so no reference to it is kept and SC:R stays free to release and recreate it.
//!
//! The swap chain's own `Present` is replaced the same way, so pacing can have a frame it timed
//! for a blank flip at the blank instead of tearing in just before it (see
//! [`crate::frame_pacing::presents_without_tearing`]).
//!
//! Anything missing (no factory, or statistics an implementation doesn't keep) leaves pacing on
//! its own timing.

use std::collections::VecDeque;
use std::ptr::null_mut;
use std::sync::OnceLock;
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::time::{Duration, Instant};

use parking_lot::Mutex;
use winapi::Interface;
use winapi::shared::dxgi::{
    CreateDXGIFactory1, DXGI_ADAPTER_DESC, DXGI_FRAME_STATISTICS, DXGI_OUTPUT_DESC,
    DXGI_SWAP_CHAIN_DESC, IDXGIAdapter, IDXGIDevice, IDXGIFactory, IDXGIFactory1, IDXGIOutput,
    IDXGISwapChain,
};
use winapi::shared::dxgi1_2::{
    DXGI_SWAP_CHAIN_DESC1, DXGI_SWAP_CHAIN_FULLSCREEN_DESC, IDXGIFactory2, IDXGISwapChain1,
};
use winapi::shared::ntdef::LARGE_INTEGER;
use winapi::shared::windef::HWND;
use winapi::shared::winerror::HRESULT;
use winapi::um::memoryapi::VirtualProtect;
use winapi::um::profileapi::{QueryPerformanceCounter, QueryPerformanceFrequency};
use winapi::um::unknwnbase::IUnknown;
use winapi::um::winnt::PAGE_READWRITE;

use crate::windows::{display_config, jump_to, os_string_from_winapi_with_nul};

/// The swap chain SC:R presents the game window with, once it has made one.
static SWAP_CHAIN: AtomicUsize = AtomicUsize::new(0);
/// The methods the factory's table had before they were replaced.
static CREATE_FOR_HWND: AtomicUsize = AtomicUsize::new(0);
static CREATE: AtomicUsize = AtomicUsize::new(0);
static PRESENT: AtomicUsize = AtomicUsize::new(0);
static INSTALLED: OnceLock<()> = OnceLock::new();
static WARNED_UNAVAILABLE: AtomicBool = AtomicBool::new(false);

/// What reading statistics after each present came to, for the pacing statistics line.
#[derive(Clone, Copy, Debug, Default)]
pub struct Reads {
    pub ok: u32,
    pub disjoint: u32,
    pub failed: u32,
    /// Statistics naming a present already matched, or no longer kept.
    pub unmatched: u32,
}

static READS: Mutex<Reads> = Mutex::new(Reads {
    ok: 0,
    disjoint: 0,
    failed: 0,
    unmatched: 0,
});

/// Takes the counts of statistics reads since they were last taken.
pub fn take_reads() -> Reads {
    std::mem::take(&mut READS.lock())
}

/// Presents not yet known to be shown, kept in case statistics come back for one of them.
const PENDING: usize = 16;

type CreateForHwnd = unsafe extern "system" fn(
    *mut IDXGIFactory2,
    *mut IUnknown,
    HWND,
    *const DXGI_SWAP_CHAIN_DESC1,
    *const DXGI_SWAP_CHAIN_FULLSCREEN_DESC,
    *mut IDXGIOutput,
    *mut *mut IDXGISwapChain1,
) -> HRESULT;

type Present = unsafe extern "system" fn(*mut IDXGISwapChain, u32, u32) -> HRESULT;

type Create = unsafe extern "system" fn(
    *mut IDXGIFactory,
    *mut IUnknown,
    *mut DXGI_SWAP_CHAIN_DESC,
    *mut *mut IDXGISwapChain,
) -> HRESULT;

/// Starts watching for the swap chain SC:R makes. Called while the DLL patches the game, before
/// SC:R sets up its renderer.
pub fn install() {
    INSTALLED.get_or_init(|| unsafe { replace_creation_methods() });
}

unsafe fn replace_creation_methods() {
    unsafe {
        let mut factory = null_mut();
        if CreateDXGIFactory1(&IDXGIFactory1::uuidof(), &mut factory) < 0 || factory.is_null() {
            warn!("Frame statistics: no DXGI factory, not tracking when frames are shown");
            return;
        }
        let factory = factory as *mut IDXGIFactory1;
        let vtable = (*factory).lpVtbl as *mut winapi::shared::dxgi::IDXGIFactory1Vtbl;
        replace(
            (&raw mut (*vtable).parent.CreateSwapChain).cast(),
            create_swap_chain as Create as usize,
            &CREATE,
        );
        let mut factory2 = null_mut();
        if (*factory).QueryInterface(&IDXGIFactory2::uuidof(), &mut factory2) >= 0
            && !factory2.is_null()
        {
            let factory2 = factory2 as *mut IDXGIFactory2;
            let vtable = (*factory2).lpVtbl as *mut winapi::shared::dxgi1_2::IDXGIFactory2Vtbl;
            replace(
                (&raw mut (*vtable).CreateSwapChainForHwnd).cast(),
                create_swap_chain_for_hwnd as CreateForHwnd as usize,
                &CREATE_FOR_HWND,
            );
            (*factory2).Release();
        }
        (*factory).Release();
    }
}

/// Points the method table entry at `slot` to `function`, keeping what it pointed to in `original`.
unsafe fn replace(slot: *mut usize, function: usize, original: &AtomicUsize) {
    unsafe {
        let function = jump_to(function);
        let current = slot.read();
        // Another DXGI interface sharing the table may already have had it replaced.
        if current == function {
            return;
        }
        let mut old_protection = 0;
        if VirtualProtect(
            slot.cast(),
            size_of::<usize>(),
            PAGE_READWRITE,
            &mut old_protection,
        ) == 0
        {
            warn!("Frame statistics: couldn't make the DXGI factory's method table writable");
            return;
        }
        original.store(current, Ordering::Release);
        slot.write(function);
        VirtualProtect(
            slot.cast(),
            size_of::<usize>(),
            old_protection,
            &mut old_protection,
        );
    }
}

unsafe extern "system" fn create_swap_chain_for_hwnd(
    factory: *mut IDXGIFactory2,
    device: *mut IUnknown,
    window: HWND,
    desc: *const DXGI_SWAP_CHAIN_DESC1,
    fullscreen_desc: *const DXGI_SWAP_CHAIN_FULLSCREEN_DESC,
    output: *mut IDXGIOutput,
    swap_chain: *mut *mut IDXGISwapChain1,
) -> HRESULT {
    unsafe {
        let original: CreateForHwnd = std::mem::transmute(CREATE_FOR_HWND.load(Ordering::Acquire));
        let result = original(
            factory,
            device,
            window,
            desc,
            fullscreen_desc,
            output,
            swap_chain,
        );
        if result >= 0 && !swap_chain.is_null() {
            note_swap_chain(window, device, *swap_chain as usize);
        }
        result
    }
}

unsafe extern "system" fn create_swap_chain(
    factory: *mut IDXGIFactory,
    device: *mut IUnknown,
    desc: *mut DXGI_SWAP_CHAIN_DESC,
    swap_chain: *mut *mut IDXGISwapChain,
) -> HRESULT {
    unsafe {
        let original: Create = std::mem::transmute(CREATE.load(Ordering::Acquire));
        let result = original(factory, device, desc, swap_chain);
        if result >= 0 && !swap_chain.is_null() && !desc.is_null() {
            note_swap_chain((*desc).OutputWindow, device, *swap_chain as usize);
        }
        result
    }
}

fn note_swap_chain(window: HWND, device: *mut IUnknown, swap_chain: usize) {
    let game_window = crate::forge::game_window_handle();
    if game_window.is_none_or(|game| game == window) {
        info!("Frame statistics: tracking the game's swap chain");
        unsafe {
            let swap_chain = swap_chain as *mut IDXGISwapChain;
            log_swap_chain(device, swap_chain);
            let vtable = (*swap_chain).lpVtbl as *mut winapi::shared::dxgi::IDXGISwapChainVtbl;
            replace(
                (&raw mut (*vtable).Present).cast(),
                present as Present as usize,
                &PRESENT,
            );
        }
        SWAP_CHAIN.store(swap_chain, Ordering::Release);
        *TRACKER.lock() = Tracker::new();
        super::swap_chain_replaced();
    }
}

/// Logs which GPU SC:R renders the game on, which GPU the monitor showing it is plugged into, and
/// how its swap chain presents. When the two GPUs differ (as on hybrid-graphics laptops), every
/// frame is copied over to the monitor's GPU, which adds latency.
unsafe fn log_swap_chain(device: *mut IUnknown, swap_chain: *mut IDXGISwapChain) {
    unsafe {
        let rendering = device_adapter(device);
        let output = containing_output(swap_chain);
        let display = output.as_ref().map(|(output, dxgi_parent)| {
            let name = os_string_from_winapi_with_nul(&output.DeviceName)
                .to_string_lossy()
                .into_owned();
            let plugged_into =
                display_config::output_adapter(&name).and_then(display_config::adapter_desc);
            match plugged_into {
                Some(adapter) => (name, adapter, "plugged into"),
                // Without the display configuration, DXGI's parent is the best guess there is,
                // and the line says that's where it came from.
                None => (name, *dxgi_parent, "listed by DXGI under"),
            }
        });
        let gpus = match (&rendering, &display) {
            (Some(rendering), Some((_, display, _))) => {
                match display_config::same_luid(rendering.AdapterLuid, display.AdapterLuid) {
                    true => "same GPU",
                    false => "different GPUs, frames are copied",
                }
            }
            _ => "GPUs unknown",
        };
        let mut desc: DXGI_SWAP_CHAIN_DESC = std::mem::zeroed();
        let presenting = match (*swap_chain).GetDesc(&mut desc) >= 0 {
            true => format!(
                "{}x{}, {} swap effect, {} buffers, {}, flags {:#x}",
                desc.BufferDesc.Width,
                desc.BufferDesc.Height,
                match desc.SwapEffect {
                    0 => "discard",
                    1 => "sequential",
                    3 => "flip sequential",
                    4 => "flip discard",
                    _ => "unknown",
                },
                desc.BufferCount,
                if desc.Windowed != 0 {
                    "windowed"
                } else {
                    "fullscreen"
                },
                desc.Flags,
            ),
            false => "swap chain description unavailable".into(),
        };
        info!(
            "Game swap chain: rendering on {}, display {} ({gpus}); {presenting}",
            rendering
                .as_ref()
                .map_or("unknown".into(), describe_adapter),
            display
                .as_ref()
                .map_or("unknown".into(), |(name, adapter, how)| format!(
                    "{name} {how} {}",
                    describe_adapter(adapter)
                )),
        );
    }
}

fn describe_adapter(desc: &DXGI_ADAPTER_DESC) -> String {
    format!(
        "{} ({:04x}:{:04x})",
        os_string_from_winapi_with_nul(&desc.Description).to_string_lossy(),
        desc.VendorId,
        desc.DeviceId,
    )
}

/// The adapter a D3D10/11 device was made on. Other devices (a D3D12 command queue) give `None`.
unsafe fn device_adapter(device: *mut IUnknown) -> Option<DXGI_ADAPTER_DESC> {
    unsafe {
        if device.is_null() {
            return None;
        }
        let mut dxgi_device = null_mut();
        if (*device).QueryInterface(&IDXGIDevice::uuidof(), &mut dxgi_device) < 0
            || dxgi_device.is_null()
        {
            return None;
        }
        let dxgi_device = dxgi_device as *mut IDXGIDevice;
        let mut adapter = null_mut();
        let result = (*dxgi_device).GetAdapter(&mut adapter);
        (*dxgi_device).Release();
        if result < 0 || adapter.is_null() {
            return None;
        }
        let desc = adapter_desc(adapter);
        (*adapter).Release();
        desc
    }
}

/// The output showing most of the swap chain's window, and the adapter DXGI lists it under.
unsafe fn containing_output(
    swap_chain: *mut IDXGISwapChain,
) -> Option<(DXGI_OUTPUT_DESC, DXGI_ADAPTER_DESC)> {
    unsafe {
        let mut output = null_mut();
        if (*swap_chain).GetContainingOutput(&mut output) < 0 || output.is_null() {
            return None;
        }
        let mut output_desc: DXGI_OUTPUT_DESC = std::mem::zeroed();
        let described = (*output).GetDesc(&mut output_desc) >= 0;
        let mut adapter = null_mut();
        let result = (*output).GetParent(&IDXGIAdapter::uuidof(), &mut adapter);
        (*output).Release();
        if result < 0 || adapter.is_null() {
            return None;
        }
        let adapter = adapter as *mut IDXGIAdapter;
        let desc = adapter_desc(adapter);
        (*adapter).Release();
        match (described, desc) {
            (true, Some(desc)) => Some((output_desc, desc)),
            _ => None,
        }
    }
}

unsafe fn adapter_desc(adapter: *mut IDXGIAdapter) -> Option<DXGI_ADAPTER_DESC> {
    unsafe {
        let mut desc: DXGI_ADAPTER_DESC = std::mem::zeroed();
        ((*adapter).GetDesc(&mut desc) >= 0).then_some(desc)
    }
}

unsafe extern "system" fn present(
    swap_chain: *mut IDXGISwapChain,
    sync_interval: u32,
    flags: u32,
) -> HRESULT {
    use winapi::shared::dxgi::DXGI_PRESENT_ALLOW_TEARING;
    unsafe {
        let original: Present = std::mem::transmute(PRESENT.load(Ordering::Acquire));
        let flags = match crate::frame_pacing::presents_without_tearing() {
            true => flags & !DXGI_PRESENT_ALLOW_TEARING,
            false => flags,
        };
        original(swap_chain, sync_interval, flags)
    }
}

/// A frame SC:R presented, and when the display showed it.
#[derive(Clone, Copy, Debug)]
pub struct Shown {
    /// When SC:R started presenting it.
    pub presented: Instant,
    /// The vertical blank pacing timed it for.
    pub timed_for: Option<Instant>,
    /// The vertical blank it was shown from.
    pub shown: Instant,
}

struct Tracker {
    /// Present count, when it started, and the blank it was timed for.
    pending: VecDeque<(u32, Instant, Option<Instant>)>,
    /// The vertical blank count and QPC time of the last statistics.
    last_sync: Option<(u32, i64)>,
    /// Ticks per refresh, measured from the statistics.
    refresh_ticks: Option<f64>,
}

impl Tracker {
    const fn new() -> Tracker {
        Tracker {
            pending: VecDeque::new(),
            last_sync: None,
            refresh_ticks: None,
        }
    }
}

static TRACKER: Mutex<Tracker> = Mutex::new(Tracker::new());

/// Notes the frame SC:R just presented, started at `presented` and timed for `timed_for`, and
/// returns the newest frame the display is known to have shown, if that's news. Call on the game
/// thread right after SC:R presents.
pub fn after_present(presented: Instant, timed_for: Option<Instant>) -> Option<Shown> {
    let swap_chain = SWAP_CHAIN.load(Ordering::Acquire) as *mut IDXGISwapChain;
    if swap_chain.is_null() {
        return None;
    }
    unsafe {
        let mut count = 0;
        if (*swap_chain).GetLastPresentCount(&mut count) < 0 {
            return None;
        }
        let mut tracker = TRACKER.lock();
        if tracker.pending.len() == PENDING {
            tracker.pending.pop_front();
        }
        tracker.pending.push_back((count, presented, timed_for));
        let mut stats: DXGI_FRAME_STATISTICS = std::mem::zeroed();
        let result = (*swap_chain).GetFrameStatistics(&mut stats);
        if result < 0 {
            // DXGI_ERROR_FRAME_STATISTICS_DISJOINT comes and goes (a mode change, the window
            // losing its own flip); anything else means this swap chain won't have them.
            const DISJOINT: HRESULT = 0x887A000Bu32 as HRESULT;
            let mut reads = READS.lock();
            match result == DISJOINT {
                true => reads.disjoint += 1,
                false => reads.failed += 1,
            }
            if result != DISJOINT && !WARNED_UNAVAILABLE.swap(true, Ordering::Relaxed) {
                warn!(
                    "Frame statistics unavailable ({result:x}), not tracking when frames are shown"
                );
            }
            return None;
        }
        let sync_qpc = *stats.SyncQPCTime.QuadPart();
        if let Some((last_refresh, last_qpc)) = tracker.last_sync {
            let refreshes = stats.SyncRefreshCount.wrapping_sub(last_refresh);
            if refreshes > 0 && refreshes < 1000 && sync_qpc > last_qpc {
                let ticks = (sync_qpc - last_qpc) as f64 / f64::from(refreshes);
                tracker.refresh_ticks = Some(match tracker.refresh_ticks {
                    Some(old) => old + (ticks - old) / 16.0,
                    None => ticks,
                });
            }
        }
        tracker.last_sync = Some((stats.SyncRefreshCount, sync_qpc));
        READS.lock().ok += 1;
        let Some(index) = tracker
            .pending
            .iter()
            .position(|&(count, _, _)| count == stats.PresentCount)
        else {
            READS.lock().unmatched += 1;
            return None;
        };
        let (_, presented, timed_for) = tracker.pending[index];
        tracker.pending.drain(..=index);
        let refreshes_since = stats
            .SyncRefreshCount
            .wrapping_sub(stats.PresentRefreshCount);
        let offset = match refreshes_since {
            0 => 0.0,
            n if n < 1000 => f64::from(n) * tracker.refresh_ticks?,
            _ => return None,
        };
        let shown = instant_of_qpc(sync_qpc - offset as i64)?;
        Some(Shown {
            presented,
            timed_for,
            shown,
        })
    }
}

/// The `Instant` a QPC reading was taken at.
fn instant_of_qpc(qpc: i64) -> Option<Instant> {
    static FREQUENCY: OnceLock<i64> = OnceLock::new();
    let frequency = *FREQUENCY.get_or_init(|| unsafe {
        let mut frequency: LARGE_INTEGER = std::mem::zeroed();
        QueryPerformanceFrequency(&mut frequency);
        *frequency.QuadPart()
    });
    if frequency <= 0 {
        return None;
    }
    let (now_qpc, now) = unsafe {
        let mut counter: LARGE_INTEGER = std::mem::zeroed();
        QueryPerformanceCounter(&mut counter);
        (*counter.QuadPart(), Instant::now())
    };
    let ticks = now_qpc - qpc;
    let since = Duration::from_secs_f64(ticks.unsigned_abs() as f64 / frequency as f64);
    match ticks >= 0 {
        true => now.checked_sub(since),
        false => now.checked_add(since),
    }
}
