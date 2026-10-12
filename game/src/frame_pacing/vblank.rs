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
use winapi::um::processthreadsapi::{GetCurrentThread, SetThreadPriority};
use winapi::um::unknwnbase::IUnknown;
use winapi::um::winbase::THREAD_PRIORITY_HIGHEST;
use winapi::um::wingdi::DEVMODEW;
use winapi::um::winuser::{
    ENUM_CURRENT_SETTINGS, EnumDisplaySettingsW, MONITOR_DEFAULTTONEAREST, MonitorFromWindow,
};

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
    /// How long after its blank the thread saw most of them (the 90th percentile).
    pub spread: Duration,
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
    /// Starts measuring the blanks of the display `window` is on, assuming it refreshes every
    /// `fallback` if its display mode doesn't say.
    pub fn start(window: HWND, fallback: Duration) -> VblankClock {
        let fit = Arc::new(Mutex::new(None));
        let thread_fit = fit.clone();
        let window = window as usize;
        let spawned = std::thread::Builder::new()
            .name("vblank clock".into())
            .spawn(move || measure(window as HWND, fallback, &thread_fit));
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

fn measure(window: HWND, fallback: Duration, fit: &Mutex<Option<Fit>>) {
    // The thread does next to nothing once per refresh; running it ahead of the game's own
    // threads keeps the delay before it sees each blank short and steady.
    unsafe {
        SetThreadPriority(GetCurrentThread(), THREAD_PRIORITY_HIGHEST as i32);
    }
    let mut warned = false;
    loop {
        *fit.lock() = None;
        let monitor = unsafe { MonitorFromWindow(window, MONITOR_DEFAULTTONEAREST) };
        let Some((output, refresh)) = (unsafe { output_for_monitor(monitor) }) else {
            if !warned {
                warn!("Vertical blank clock: no DXGI output for the game's monitor");
                warned = true;
            }
            std::thread::sleep(MONITOR_CHECK);
            continue;
        };
        let mut nominal = refresh.unwrap_or(fallback);
        let mut samples = VecDeque::with_capacity(SAMPLES);
        let mut unfit = 0;
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
            if samples.len() < MIN_SAMPLES {
                continue;
            }
            match fit_blanks(&samples, nominal) {
                Some(new_fit) => {
                    unfit = 0;
                    nominal = new_fit.period;
                    *fit.lock() = Some(new_fit);
                }
                None => {
                    *fit.lock() = None;
                    unfit += 1;
                    // Blanks that haven't fit for a whole window of samples aren't at the rate the
                    // clock expects (the display's mode changed), so it starts over from the
                    // output's current mode.
                    if unfit >= SAMPLES {
                        break;
                    }
                }
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
    let mut offsets: Vec<f64> = points.iter().map(|&(k, t)| t - k * period).collect();
    offsets.sort_unstable_by(f64::total_cmp);
    let phase = offsets[0];
    // Counting blanks by the nominal period fits any spacing of samples with some line, so the
    // fit only stands when the samples sit close to it, seen shortly after their blank. Blanks at
    // another rate scatter across the whole period.
    let spread = offsets[(offsets.len() - 1) * 9 / 10] - phase;
    if spread > period / 2.0 || !(nominal * 0.9..nominal * 1.1).contains(&period) {
        return None;
    }
    let anchor = if phase >= 0.0 {
        first + Duration::from_secs_f64(phase)
    } else {
        first - Duration::from_secs_f64(-phase)
    };
    Some(Fit {
        anchor,
        period: Duration::from_secs_f64(period),
        spread: Duration::from_secs_f64(spread),
        newest,
    })
}

/// The DXGI output showing `monitor`, and the refresh period of its current display mode.
unsafe fn output_for_monitor(monitor: HMONITOR) -> Option<(Com<IDXGIOutput>, Option<Duration>)> {
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
                    let mut mode: DEVMODEW = std::mem::zeroed();
                    mode.dmSize = size_of::<DEVMODEW>() as u16;
                    let found = EnumDisplaySettingsW(
                        desc.DeviceName.as_ptr(),
                        ENUM_CURRENT_SETTINGS,
                        &mut mode,
                    ) != 0;
                    // 0 and 1 stand for the hardware's default rate rather than a rate.
                    let refresh = (found && mode.dmDisplayFrequency > 1)
                        .then(|| Duration::from_secs_f64(1.0 / f64::from(mode.dmDisplayFrequency)));
                    return Some((output, refresh));
                }
            }
        }
        None
    }
}

/// An owned reference to a COM object.
struct Com<T>(NonNull<T>);

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

#[cfg(test)]
mod tests {
    use super::*;

    const PERIOD_NS: u64 = 4_166_667;

    /// Timestamps for blanks `PERIOD_NS` apart starting at `start`, each seen a pseudo-random
    /// 50-400 us late, with every blank in `missed` not seen at all.
    fn samples(start: Instant, count: u64, missed: &[u64]) -> VecDeque<Instant> {
        let mut random = 0x2545_f491u32;
        (0..count)
            .filter(|i| !missed.contains(i))
            .map(|i| {
                random ^= random << 13;
                random ^= random >> 17;
                random ^= random << 5;
                let delay = 50_000 + u64::from(random % 350_000);
                start + Duration::from_nanos(i * PERIOD_NS + delay)
            })
            .collect()
    }

    fn assert_close(actual: Duration, expected: Duration, tolerance: Duration) {
        let diff = actual.abs_diff(expected);
        assert!(
            diff <= tolerance,
            "{actual:?} not within {tolerance:?} of {expected:?}"
        );
    }

    #[test]
    fn fits_period_and_earliest_phase() {
        let start = Instant::now();
        let blanks = samples(start, 200, &[]);
        // Starting from a nominal rate that's a little off, as a monitor's whole-Hz rate is.
        let fit = fit_blanks(&blanks, Duration::from_secs_f64(1.0 / 240.0)).unwrap();
        assert_close(
            fit.period,
            Duration::from_nanos(PERIOD_NS),
            Duration::from_nanos(500),
        );
        // The phase is that of the least delayed blank, so it's late by at most a little over
        // the smallest delay.
        let blank = fit.next_after(start + Duration::from_nanos(100 * PERIOD_NS - 1000));
        let truth = start + Duration::from_nanos(100 * PERIOD_NS);
        assert!(blank >= truth, "{:?} before the true blank", truth - blank);
        assert!(
            blank - truth <= Duration::from_micros(120),
            "{:?} late",
            blank - truth
        );
    }

    #[test]
    fn counts_missed_blanks() {
        let start = Instant::now();
        let blanks = samples(start, 200, &[5, 6, 50, 120, 121, 122]);
        let fit = fit_blanks(&blanks, Duration::from_nanos(PERIOD_NS)).unwrap();
        assert_close(
            fit.period,
            Duration::from_nanos(PERIOD_NS),
            Duration::from_nanos(500),
        );
    }

    #[test]
    fn rejects_a_different_rate() {
        let start = Instant::now();
        // Blanks at 144 Hz expected at 240 Hz, as when the window moves to another monitor, and
        // the other way around.
        let at = |period: u64| -> VecDeque<Instant> {
            (0..200)
                .map(|i| start + Duration::from_nanos(i * period))
                .collect()
        };
        assert!(fit_blanks(&at(6_944_444), Duration::from_nanos(PERIOD_NS)).is_none());
        assert!(fit_blanks(&at(PERIOD_NS), Duration::from_nanos(6_944_444)).is_none());
    }

    #[test]
    fn next_after_either_side_of_anchor() {
        let anchor = Instant::now() + Duration::from_secs(1);
        let fit = Fit {
            anchor,
            period: Duration::from_millis(10),
            spread: Duration::ZERO,
            newest: anchor,
        };
        assert_eq!(fit.next_after(anchor), anchor + Duration::from_millis(10));
        assert_eq!(
            fit.next_after(anchor + Duration::from_millis(25)),
            anchor + Duration::from_millis(30)
        );
        assert_eq!(
            fit.next_after(anchor - Duration::from_millis(25)),
            anchor - Duration::from_millis(20)
        );
        assert_eq!(
            fit.next_after(anchor - Duration::from_millis(20)),
            anchor - Duration::from_millis(10)
        );
    }
}
