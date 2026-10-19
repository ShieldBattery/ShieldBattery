//! Measures whether a command card hotkey pressed right after another one is handled on the card
//! the first one opens, in a debug build with `SB_HOTKEY_ORDER_PROBE=<trials>` set.
//!
//! A few seconds into a game the probe selects one of the local player's workers. Each trial opens
//! the worker's basic build card with B and waits for it, then posts Escape (the build card's
//! Cancel, which returns to the worker's card) and, a few milliseconds later, S, which is Stop on
//! the worker's card. A trial whose S issues no Stop command had S handled while the build card
//! was still up.
//!
//! SC:R activates a hotkey's button a while after handling the key, unless ShieldBattery makes the
//! press due first (see [`crate::bw_scr::hotkey_presses`]). With
//! `SB_HOTKEY_ORDER_PROBE_KEEP_WAITING=1` set, presses keep SC:R's own timing, and each trial
//! checks its outcome against the deadline Escape's press was waiting for when S arrived.

use std::collections::BTreeMap;
use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};
use std::time::{Duration, Instant};

use parking_lot::Mutex;

const ENV_VAR: &str = "SB_HOTKEY_ORDER_PROBE";
const KEEP_WAITING_ENV_VAR: &str = "SB_HOTKEY_ORDER_PROBE_KEEP_WAITING";

/// The game frame the probe selects its worker at, after the start's lockstep second.
const ARM_FRAME: u32 = 24 * 6;

const STOP_COMMAND: u8 = 0x1a;

/// Milliseconds between posting Escape and posting S, cycled through trial by trial.
const GAPS_MS: [u64; 9] = [0, 5, 10, 15, 20, 25, 30, 35, 40];

static ENABLED: AtomicBool = AtomicBool::new(false);
static KEEP_WAITING: AtomicBool = AtomicBool::new(false);
static ARMED: AtomicBool = AtomicBool::new(false);
static TRIALS_WANTED: AtomicU32 = AtomicU32::new(0);
/// Set while a trial waits to see whether its S issued a Stop.
static WATCHING: AtomicBool = AtomicBool::new(false);
static STOP_ISSUED: AtomicBool = AtomicBool::new(false);
static SEEN: Mutex<Seen> = Mutex::new(Seen {
    escape_tick: None,
    s_tick: None,
    waiting_deadline: None,
});

/// What the window procedure saw of the current trial's key presses.
#[derive(Default)]
struct Seen {
    escape_tick: Option<u32>,
    s_tick: Option<u32>,
    /// The deadline of the press waiting when S arrived, if one was.
    waiting_deadline: Option<u32>,
}

struct Trial {
    gap_ms: u64,
    posted_gap: Duration,
    seen: Seen,
    stop_issued: bool,
}

impl Trial {
    fn lost(&self) -> bool {
        !self.stop_issued
    }

    /// Whether Escape's press was still waiting for its deadline when S arrived, so S met the
    /// build card. `None` if S wasn't seen.
    fn predicted_lost(&self) -> Option<bool> {
        let now = self.seen.s_tick?;
        Some(
            self.seen
                .waiting_deadline
                .is_some_and(|deadline| deadline.wrapping_sub(now) as i32 >= 0),
        )
    }
}

pub fn init_from_env() {
    let Ok(value) = std::env::var(ENV_VAR) else {
        return;
    };
    let trials = value.trim().parse::<u32>().unwrap_or(180).max(1);
    let keep_waiting = std::env::var(KEEP_WAITING_ENV_VAR).is_ok_and(|x| x == "1");
    TRIALS_WANTED.store(trials, Ordering::Relaxed);
    KEEP_WAITING.store(keep_waiting, Ordering::Relaxed);
    ENABLED.store(true, Ordering::Relaxed);
    info!("Hotkey order probe: on, {trials} trials, presses keep SC:R's timing: {keep_waiting}");
}

pub fn enabled() -> bool {
    ENABLED.load(Ordering::Relaxed)
}

/// Whether hotkey presses keep SC:R's own timing instead of being made due by later input.
pub fn keeps_presses_waiting() -> bool {
    KEEP_WAITING.load(Ordering::Relaxed)
}

/// Called at each game loop logic step with the current frame; selects the worker once the game
/// is far enough in and starts posting key presses. `select_worker` returns whether it selected
/// one.
pub fn on_step(frame: u32, select_worker: impl FnOnce() -> bool) {
    if !enabled() || ARMED.load(Ordering::Relaxed) || frame < ARM_FRAME {
        return;
    }
    if !select_worker() {
        return;
    }
    ARMED.store(true, Ordering::Relaxed);
    info!("Hotkey order probe: worker selected at frame {frame}, posting key presses");
    std::thread::spawn(run_trials);
}

/// Waits until `until`, spinning for the last stretch: `Sleep` can overshoot by a whole system
/// timer interval, which is coarser than the gaps being measured.
fn wait_until(until: Instant) {
    loop {
        let now = Instant::now();
        if now >= until {
            return;
        }
        if until - now > Duration::from_millis(3) {
            std::thread::sleep(Duration::from_millis(1));
        } else {
            std::hint::spin_loop();
        }
    }
}

fn run_trials() {
    use winapi::um::winuser::{MapVirtualKeyW, PostMessageW, VK_ESCAPE, WM_KEYDOWN, WM_KEYUP};
    // Let the selection command execute first.
    std::thread::sleep(Duration::from_millis(500));
    let Some(window) = crate::forge::game_window_handle() else {
        warn!("Hotkey order probe: no game window");
        return;
    };
    let post_key = |vk: u32, down: bool| {
        let scan = unsafe { MapVirtualKeyW(vk, 0) };
        let lparam = if down {
            1 | (scan << 16)
        } else {
            1 | (scan << 16) | (1 << 30) | (1 << 31)
        };
        let msg = if down { WM_KEYDOWN } else { WM_KEYUP };
        unsafe {
            PostMessageW(window, msg, vk as usize, lparam as isize);
        }
    };
    let (b, s, escape) = (b'B' as u32, b'S' as u32, VK_ESCAPE as u32);
    let wanted = TRIALS_WANTED.load(Ordering::Relaxed) as usize;
    let mut trials = Vec::with_capacity(wanted);
    for index in 0..wanted {
        let gap_ms = GAPS_MS[index % GAPS_MS.len()];
        post_key(b, true);
        std::thread::sleep(Duration::from_millis(30));
        post_key(b, false);
        std::thread::sleep(Duration::from_millis(300));
        *SEEN.lock() = Seen::default();
        STOP_ISSUED.store(false, Ordering::Relaxed);
        WATCHING.store(true, Ordering::Relaxed);
        let escape_posted = Instant::now();
        post_key(escape, true);
        wait_until(escape_posted + Duration::from_millis(gap_ms));
        let s_posted = Instant::now();
        post_key(s, true);
        std::thread::sleep(Duration::from_millis(40));
        post_key(escape, false);
        post_key(s, false);
        std::thread::sleep(Duration::from_millis(300));
        WATCHING.store(false, Ordering::Relaxed);
        let trial = Trial {
            gap_ms,
            posted_gap: s_posted - escape_posted,
            seen: std::mem::take(&mut *SEEN.lock()),
            stop_issued: STOP_ISSUED.load(Ordering::Relaxed),
        };
        info!(
            "Hotkey order probe trial {index}: gap {gap_ms} ms (posted {:.2} ms), Escape tick \
            {:?}, S tick {:?}, waiting deadline {:?}, predicted lost {:?}, S lost {}",
            trial.posted_gap.as_secs_f64() * 1000.0,
            trial.seen.escape_tick,
            trial.seen.s_tick,
            trial.seen.waiting_deadline,
            trial.predicted_lost(),
            trial.lost(),
        );
        trials.push(trial);
    }
    summarize(&trials);
}

fn summarize(trials: &[Trial]) {
    let mut by_gap = BTreeMap::<u64, (u32, u32)>::new();
    for trial in trials {
        let entry = by_gap.entry(trial.gap_ms).or_default();
        entry.0 += trial.lost() as u32;
        entry.1 += 1;
    }
    let lost = trials.iter().filter(|x| x.lost()).count();
    let mispredicted = trials
        .iter()
        .filter(|x| x.predicted_lost().is_some_and(|p| p != x.lost()))
        .count();
    let unseen = trials
        .iter()
        .filter(|x| x.predicted_lost().is_none())
        .count();
    let by_gap = by_gap
        .iter()
        .map(|(gap, (lost, total))| format!("{gap} ms {lost}/{total}"))
        .collect::<Vec<_>>()
        .join(", ");
    info!(
        "Hotkey order probe summary: {lost}/{} S presses lost ({by_gap}); outcome differs from the \
        waiting deadline in {mispredicted}, S not seen in {unseen}; presses keep SC:R's timing: {}",
        trials.len(),
        keeps_presses_waiting(),
    );
}

/// The window procedure received `msg`, with `waiting_deadline` the deadline of the first hotkey
/// press waiting to activate.
pub fn on_window_message(msg: u32, wparam: usize, waiting_deadline: Option<u32>) {
    use winapi::um::winuser::{VK_ESCAPE, WM_KEYDOWN};
    if !enabled() || msg != WM_KEYDOWN || !WATCHING.load(Ordering::Relaxed) {
        return;
    }
    let tick = Some(crate::frame_pacing::tick_count());
    let mut seen = SEEN.lock();
    if wparam == VK_ESCAPE as usize {
        seen.escape_tick = tick;
    } else if wparam == b'S' as usize {
        seen.s_tick = tick;
        seen.waiting_deadline = waiting_deadline;
    }
}

/// The game's UI issued `command`.
pub fn on_send_command(command: &[u8]) {
    if enabled() && WATCHING.load(Ordering::Relaxed) && command.first() == Some(&STOP_COMMAND) {
        STOP_ISSUED.store(true, Ordering::Relaxed);
    }
}
