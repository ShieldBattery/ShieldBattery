//! Tracks when the display the game window is on starts each refresh (its vertical blanks).
//!
//! A thread waits for each vertical blank of the window's output (`IDXGIOutput::WaitForVBlank`)
//! and timestamps it. The thread wakes some time after each blank, never before, so the clock
//! takes the period from a least squares fit over recent blanks and the phase from the earliest
//! of them relative to that fit, which is the least delayed.

use std::collections::VecDeque;
use std::ptr::{NonNull, null_mut};
use std::sync::Arc;
use std::time::{Duration, Instant};

use parking_lot::Mutex;
use winapi::Interface;
use winapi::shared::dxgi::{
    CreateDXGIFactory1, DXGI_OUTPUT_DESC, IDXGIAdapter1, IDXGIFactory1, IDXGIOutput,
};
use winapi::shared::windef::{HMONITOR, HWND};
use winapi::um::unknwnbase::IUnknown;
use winapi::um::winuser::{MONITOR_DEFAULTTONEAREST, MonitorFromWindow};

/// Blanks the fit covers: a couple of seconds at common refresh rates.
const SAMPLES: usize = 256;
/// Blanks the clock needs before it gives times out.
const MIN_SAMPLES: usize = 32;
/// The clock stops giving times out when its newest blank is older than this, as when the thread
/// can't wait on the display.
const STALE: Duration = Duration::from_millis(250);
/// How often the thread checks that the window is still on the monitor it is waiting on.
const MONITOR_CHECK: Duration = Duration::from_secs(1);

/// A fitted line through the display's vertical blanks.
#[derive(Clone, Copy, Debug)]
pub struct Fit {
    /// A vertical blank.
    pub anchor: Instant,
    pub period: Duration,
    /// When the newest blank was seen.
    newest: Instant,
}

impl Fit {
    /// The first vertical blank after `at`.
    pub fn next_after(&self, at: Instant) -> Instant {
        let period = self.period.as_secs_f64();
        let since = match at.checked_duration_since(self.anchor) {
            Some(since) => since.as_secs_f64(),
            None => -(self.anchor - at).as_secs_f64(),
        };
        let blanks = (since / period).floor() + 1.0;
        let offset = blanks * period;
        if offset >= 0.0 {
            self.anchor + Duration::from_secs_f64(offset)
        } else {
            self.anchor - Duration::from_secs_f64(-offset)
        }
    }
}

/// The vertical blank clock of the display a window is on. The thread measuring it runs as long
/// as the process; there is at most one game window per process.
pub struct VblankClock {
    fit: Arc<Mutex<Option<Fit>>>,
}

impl VblankClock {
    /// Starts measuring the blanks of the display `window` is on, assuming at first it refreshes
    /// every `nominal`.
    pub fn start(window: HWND, nominal: Duration) -> VblankClock {
        let fit = Arc::new(Mutex::new(None));
        let thread_fit = fit.clone();
        let window = window as usize;
        let spawned = std::thread::Builder::new()
            .name("vblank clock".into())
            .spawn(move || measure(window as HWND, nominal, &thread_fit));
        if let Err(e) = spawned {
            error!("Couldn't start the vertical blank clock: {e}");
        }
        VblankClock { fit }
    }

    /// The current fit, if the clock has a recent one.
    pub fn fit(&self, now: Instant) -> Option<Fit> {
        let fit = (*self.fit.lock())?;
        (now.saturating_duration_since(fit.newest) < STALE).then_some(fit)
    }
}

fn measure(window: HWND, nominal: Duration, fit: &Mutex<Option<Fit>>) {
    let mut nominal = nominal;
    let mut warned = false;
    loop {
        *fit.lock() = None;
        let monitor = unsafe { MonitorFromWindow(window, MONITOR_DEFAULTTONEAREST) };
        let Some(output) = (unsafe { output_for_monitor(monitor) }) else {
            if !warned {
                warn!("Vertical blank clock: no DXGI output for the game's monitor");
                warned = true;
            }
            std::thread::sleep(MONITOR_CHECK);
            continue;
        };
        let mut samples = VecDeque::with_capacity(SAMPLES);
        let mut checked = Instant::now();
        loop {
            if checked.elapsed() >= MONITOR_CHECK {
                if unsafe { MonitorFromWindow(window, MONITOR_DEFAULTTONEAREST) } != monitor {
                    break;
                }
                checked = Instant::now();
            }
            let result = unsafe { output.as_ref().WaitForVBlank() };
            let at = Instant::now();
            if result < 0 {
                if !warned {
                    warn!("Vertical blank clock: WaitForVBlank failed: {result:x}");
                    warned = true;
                }
                std::thread::sleep(MONITOR_CHECK);
                break;
            }
            if samples.len() == SAMPLES {
                samples.pop_front();
            }
            samples.push_back(at);
            if samples.len() >= MIN_SAMPLES
                && let Some(new_fit) = fit_blanks(&samples, nominal)
            {
                nominal = new_fit.period;
                *fit.lock() = Some(new_fit);
            }
        }
    }
}

/// Fits a line through `samples`, timestamps taken some time after vertical blanks about
/// `nominal` apart, some of which may have been missed.
fn fit_blanks(samples: &VecDeque<Instant>, nominal: Duration) -> Option<Fit> {
    let first = *samples.front()?;
    let newest = *samples.back()?;
    let nominal = nominal.as_secs_f64();
    let points: Vec<(f64, f64)> = samples
        .iter()
        .map(|&at| {
            let t = (at - first).as_secs_f64();
            ((t / nominal).round(), t)
        })
        .collect();
    let n = points.len() as f64;
    let mean_k = points.iter().map(|p| p.0).sum::<f64>() / n;
    let mean_t = points.iter().map(|p| p.1).sum::<f64>() / n;
    let (mut covariance, mut variance) = (0.0, 0.0);
    for &(k, t) in &points {
        covariance += (k - mean_k) * (t - mean_t);
        variance += (k - mean_k) * (k - mean_k);
    }
    if variance == 0.0 {
        return None;
    }
    let period = covariance / variance;
    // A fit far off the nominal period means the blanks were counted wrong (the refresh rate
    // changed, or most blanks were missed), so it starts over from the fitted period next time.
    if !(nominal * 0.9..nominal * 1.1).contains(&period) {
        return None;
    }
    let phase = points
        .iter()
        .map(|&(k, t)| t - k * period)
        .fold(f64::INFINITY, f64::min);
    let anchor = if phase >= 0.0 {
        first + Duration::from_secs_f64(phase)
    } else {
        first - Duration::from_secs_f64(-phase)
    };
    Some(Fit {
        anchor,
        period: Duration::from_secs_f64(period),
        newest,
    })
}

/// The DXGI output showing `monitor`.
unsafe fn output_for_monitor(monitor: HMONITOR) -> Option<Com<IDXGIOutput>> {
    unsafe {
        let mut factory = null_mut();
        if CreateDXGIFactory1(&IDXGIFactory1::uuidof(), &mut factory) < 0 {
            return None;
        }
        let factory = Com::new(factory as *mut IDXGIFactory1)?;
        for adapter_index in 0.. {
            let mut adapter = null_mut();
            if factory.as_ref().EnumAdapters1(adapter_index, &mut adapter) < 0 {
                return None;
            }
            let adapter = Com::<IDXGIAdapter1>::new(adapter)?;
            for output_index in 0.. {
                let mut output = null_mut();
                if adapter.as_ref().EnumOutputs(output_index, &mut output) < 0 {
                    break;
                }
                let output = Com::new(output)?;
                let mut desc: DXGI_OUTPUT_DESC = std::mem::zeroed();
                if output.as_ref().GetDesc(&mut desc) >= 0 && desc.Monitor == monitor {
                    return Some(output);
                }
            }
        }
        None
    }
}

/// An owned reference to a COM object.
struct Com<T>(NonNull<T>);

// The thread that made the objects is the only one using them, but the box crosses into it.
unsafe impl<T> Send for Com<T> {}

impl<T> Com<T> {
    fn new(ptr: *mut T) -> Option<Com<T>> {
        NonNull::new(ptr).map(Com)
    }

    unsafe fn as_ref(&self) -> &T {
        unsafe { self.0.as_ref() }
    }
}

impl<T> Drop for Com<T> {
    fn drop(&mut self) {
        unsafe {
            (*(self.0.as_ptr() as *mut IUnknown)).Release();
        }
    }
}
