//! Keeps the game window responsive while SC:R loads its images.
//!
//! SC:R loads every image's graphics (`init_sprites`) on the main thread, after the window is up
//! and before ShieldBattery's own message loop starts. That takes a few seconds from a warm disk
//! cache and can take most of a minute from a cold one. Windows treats a window whose thread hasn't
//! checked its message queue for five seconds as not responding: it ghosts the window and offers to
//! close the program, and players take it up on that.
//!
//! The load opens a file for nearly every image, so the `open_file` hook gives it a place to check
//! the queue every [`QUEUE_CHECK_INTERVAL`]. A load that runs past [`REDRAW_AFTER`] also redraws the
//! loading screen every [`REDRAW_INTERVAL`], showing how far it has gotten. A shorter load pays for
//! no redraws. Each image's texture records its upload into the renderer's current frame, and a
//! redraw submits the uploads recorded since the last one, so a redraw moves that work earlier
//! rather than adding it.

use std::cell::Cell;
use std::sync::atomic::{AtomicU32, Ordering};
use std::time::{Duration, Instant};

use winapi::um::winuser::{MSG, PM_NOREMOVE, PM_QS_INPUT, PM_QS_SENDMESSAGE, PeekMessageW};

use super::BwScr;

const QUEUE_CHECK_INTERVAL: Duration = Duration::from_millis(100);
const REDRAW_AFTER: Duration = Duration::from_secs(1);
const REDRAW_INTERVAL: Duration = Duration::from_millis(250);
/// How many redraws of a load are logged one by one.
const LOGGED_REDRAWS: u32 = 8;
/// The load opens one file per image, `anim/main_000.anim` through `anim/main_998.anim`, in order.
const IMAGE_COUNT: u32 = 999;
const IMAGE_PATH_PREFIX: &[u8] = b"anim/main_";
/// [`IMAGES_REACHED`] outside of a load.
const NOT_LOADING: u32 = u32::MAX;

thread_local! {
    /// The image load running on this thread. Taken out while a queue check or redraw runs, so the
    /// file opens those cause don't start another.
    static PUMP: Cell<Option<ImageLoadPump>> = const { Cell::new(None) };
}

/// The image file the running load opened last, for the loading screen to show progress with.
static IMAGES_REACHED: AtomicU32 = AtomicU32::new(NOT_LOADING);

#[derive(Clone, Copy)]
struct ImageLoadPump {
    start: Instant,
    next_queue_check: Instant,
    next_redraw: Instant,
    last_open: Instant,
    opens: u32,
    queue_checks: u32,
    first_image_at: Option<Duration>,
    longest_gap: Duration,
    /// How many files had been opened when [`Self::longest_gap`] began.
    longest_gap_after: u32,
    redraws: u32,
    redraw_time: Duration,
    longest_redraw: Duration,
    #[cfg(debug_assertions)]
    debug: DebugKnobs,
}

/// Runs `load`, SC:R's image load, checking the message queue and redrawing the loading screen from
/// the file opens it makes on this thread.
pub fn run<R>(load: impl FnOnce() -> R) -> R {
    let start = Instant::now();
    PUMP.set(Some(ImageLoadPump {
        start,
        next_queue_check: start + QUEUE_CHECK_INTERVAL,
        next_redraw: start + REDRAW_AFTER,
        last_open: start,
        opens: 0,
        queue_checks: 0,
        first_image_at: None,
        longest_gap: Duration::ZERO,
        longest_gap_after: 0,
        redraws: 0,
        redraw_time: Duration::ZERO,
        longest_redraw: Duration::ZERO,
        #[cfg(debug_assertions)]
        debug: DebugKnobs::from_env(),
    }));
    IMAGES_REACHED.store(0, Ordering::Relaxed);
    let result = load();
    IMAGES_REACHED.store(NOT_LOADING, Ordering::Relaxed);
    if let Some(mut pump) = PUMP.take() {
        pump.track_gap(Instant::now());
        debug!(
            "Image load: {} file opens (first image at {:?}), {} queue checks, {} redraws taking \
             {:?} (longest {:?}), longest gap between file opens {:?} after {} opens",
            pump.opens,
            pump.first_image_at,
            pump.queue_checks,
            pump.redraws,
            pump.redraw_time,
            pump.longest_redraw,
            pump.longest_gap,
            pump.longest_gap_after,
        );
    }
    result
}

/// How far the running image load has gotten, from 0.0 to 1.0, or `None` outside of one.
pub fn progress() -> Option<f32> {
    match IMAGES_REACHED.load(Ordering::Relaxed) {
        NOT_LOADING => None,
        reached => Some(reached as f32 / IMAGE_COUNT as f32),
    }
}

/// Called from SC:R's `open_file` with the normalized path (if it could be normalized), before the
/// file is opened. Does nothing outside of an image load on this thread.
pub fn on_file_open(bw: &BwScr, path: Option<&[u8]>) {
    let Some(mut pump) = PUMP.take() else {
        return;
    };
    let now = Instant::now();
    pump.track_gap(now);
    pump.opens += 1;
    if let Some(image) = path.and_then(image_number) {
        IMAGES_REACHED.store(image, Ordering::Relaxed);
        if pump.first_image_at.is_none() {
            pump.first_image_at = Some(now - pump.start);
        }
    }

    #[cfg(debug_assertions)]
    let pumping = !pump.debug.pump_off;
    #[cfg(not(debug_assertions))]
    let pumping = true;
    if pumping && now >= pump.next_queue_check {
        pump.queue_checks += 1;
        check_message_queue();
        pump.next_queue_check = Instant::now() + QUEUE_CHECK_INTERVAL;
    }
    if pumping && now >= pump.next_redraw {
        let redraw_start = Instant::now();
        unsafe { bw.force_redraw_during_init() };
        let redraw_end = Instant::now();
        let took = redraw_end - redraw_start;
        pump.redraws += 1;
        pump.redraw_time += took;
        pump.longest_redraw = pump.longest_redraw.max(took);
        if pump.redraws <= LOGGED_REDRAWS {
            debug!(
                "Image load redraw {} at {:?} took {took:?}",
                pump.redraws,
                redraw_start - pump.start,
            );
        }
        pump.next_redraw = redraw_end + REDRAW_INTERVAL;
    }

    #[cfg(debug_assertions)]
    if let Some(delay) = pump.debug.file_open_delay {
        std::thread::sleep(delay);
    }
    pump.last_open = Instant::now();
    PUMP.set(Some(pump));
}

impl ImageLoadPump {
    fn track_gap(&mut self, now: Instant) {
        let gap = now - self.last_open;
        if gap > self.longest_gap {
            self.longest_gap = gap;
            self.longest_gap_after = self.opens;
        }
    }
}

/// Lets Windows see the window's thread checking its message queue, without removing anything from
/// it: input and posted messages wait for the load to finish.
///
/// Windows only counts a check that looks at input, and every check dispatches the messages other
/// threads have sent the window, so SC:R's window procedure can run here, between two of the load's
/// file opens. Of those messages, a close request would re-enter SC:R's state machine, but `forge`
/// drops close requests until the game starts. Activation and DPI changes can change the display
/// mode and resize render targets, which leaves the textures being loaded alone.
///
/// `PeekMessageW` is hooked (see `forge`), but the hook passes calls that don't remove a message
/// through unchanged.
fn check_message_queue() {
    unsafe {
        let mut msg: MSG = std::mem::zeroed();
        PeekMessageW(
            &mut msg,
            std::ptr::null_mut(),
            0,
            0,
            PM_NOREMOVE | PM_QS_INPUT | PM_QS_SENDMESSAGE,
        );
    }
}

/// The image number in a path the image load opens, `anim/main_NNN.anim`.
fn image_number(path: &[u8]) -> Option<u32> {
    let digits = path
        .strip_prefix(IMAGE_PATH_PREFIX)?
        .strip_suffix(b".anim")?;
    if digits.len() != 3 {
        return None;
    }
    std::str::from_utf8(digits).ok()?.parse().ok()
}

/// Debug build knobs for testing the pump against a slow load.
#[cfg(debug_assertions)]
#[derive(Clone, Copy)]
struct DebugKnobs {
    /// `SB_IMAGE_LOAD_FILE_DELAY_MS`: sleeps this long in every file open of the image load, to
    /// stretch it out the way a cold disk cache does.
    file_open_delay: Option<Duration>,
    /// `SB_NO_IMAGE_LOAD_PUMP=1`: neither checks the message queue nor redraws during the load.
    pump_off: bool,
}

#[cfg(debug_assertions)]
impl DebugKnobs {
    fn from_env() -> DebugKnobs {
        let file_open_delay = std::env::var("SB_IMAGE_LOAD_FILE_DELAY_MS")
            .ok()
            .and_then(|ms| ms.parse().ok())
            .map(Duration::from_millis);
        let pump_off = std::env::var("SB_NO_IMAGE_LOAD_PUMP").is_ok_and(|x| x == "1");
        if file_open_delay.is_some() || pump_off {
            debug!(
                "Image load debug knobs: file open delay {file_open_delay:?}, pump off {pump_off}"
            );
        }
        DebugKnobs {
            file_open_delay,
            pump_off,
        }
    }
}

#[cfg(test)]
mod test {
    use super::*;

    #[test]
    fn image_numbers() {
        assert_eq!(image_number(b"anim/main_000.anim"), Some(0));
        assert_eq!(image_number(b"anim/main_998.anim"), Some(998));
        assert_eq!(image_number(b"anim/main_12.anim"), None);
        assert_eq!(image_number(b"anim/main_0123.anim"), None);
        assert_eq!(image_number(b"anim/main_abc.anim"), None);
        assert_eq!(image_number(b"anim/main_001.lo"), None);
        assert_eq!(image_number(b"sd/mainsd.anim"), None);
    }
}
