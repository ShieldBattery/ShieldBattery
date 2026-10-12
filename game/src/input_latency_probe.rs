//! Measures how long a keypress takes to reach the simulation and the screen, in a debug build
//! with `SB_INPUT_LATENCY_PROBE=<samples>` set.
//!
//! A few seconds into a game the probe selects one of the local player's workers and then posts a
//! Stop hotkey (`S`) to the game window every half a second or so, from a thread of its own, the
//! way a key press arrives. Each press is followed through the game:
//!
//! - **seen**: the window procedure receives the key,
//! - **issued**: the game's UI issues the Stop command (`send_command`),
//! - **sent**: a local turn carrying the Stop command is handed to the turn transport,
//! - **executed**: a step (first simulation only) runs the Stop command,
//! - **rendered**: the renderer finishes the first frame drawn after that step.
//!
//! Each sample logs those times relative to the post, with the game frame at each, and every
//! [`SUMMARY_SAMPLES`] samples and at the end a summary logs medians and the distribution of
//! frames between the key being seen and the command executing.

use std::collections::VecDeque;
use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};
use std::time::{Duration, Instant};

use parking_lot::Mutex;

use crate::bw::commands;

const ENV_VAR: &str = "SB_INPUT_LATENCY_PROBE";

/// The game frame the probe selects its worker at, after the start's lockstep second.
const ARM_FRAME: u32 = 24 * 6;

const STOP_COMMAND: u8 = 0x1a;

const SUMMARY_SAMPLES: usize = 50;

static ENABLED: AtomicBool = AtomicBool::new(false);
static ARMED: AtomicBool = AtomicBool::new(false);
static SAMPLES_WANTED: AtomicU32 = AtomicU32::new(0);
static STATE: Mutex<State> = Mutex::new(State {
    pending: VecDeque::new(),
    done: Vec::new(),
});

struct State {
    pending: VecDeque<Sample>,
    done: Vec<Sample>,
}

#[derive(Clone, Copy)]
struct Sample {
    posted: Instant,
    seen: Option<(Instant, u32)>,
    issued: Option<(Instant, u32)>,
    sent: Option<(Instant, u32)>,
    executed: Option<(Instant, u32)>,
    rendered: Option<Instant>,
}

pub fn init_from_env() {
    let Ok(value) = std::env::var(ENV_VAR) else {
        return;
    };
    let samples = value.trim().parse::<u32>().unwrap_or(200).max(1);
    SAMPLES_WANTED.store(samples, Ordering::Relaxed);
    ENABLED.store(true, Ordering::Relaxed);
    info!("Input latency probe: on, {samples} samples");
}

pub fn enabled() -> bool {
    ENABLED.load(Ordering::Relaxed)
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
    info!("Input latency probe: worker selected at frame {frame}, posting key presses");
    std::thread::spawn(post_key_presses);
}

fn post_key_presses() {
    use winapi::um::winuser::{MapVirtualKeyW, PostMessageW, WM_KEYDOWN, WM_KEYUP};
    // Let the selection command execute first.
    std::thread::sleep(Duration::from_millis(500));
    let Some(window) = crate::forge::game_window_handle() else {
        warn!("Input latency probe: no game window");
        return;
    };
    let vk = b'S' as u32;
    let scan = unsafe { MapVirtualKeyW(vk, 0) };
    let down_lparam = 1 | (scan << 16);
    let up_lparam = down_lparam | (1 << 30) | (1 << 31);
    let mut random = 0x1234_5678u32;
    let wanted = SAMPLES_WANTED.load(Ordering::Relaxed) as usize;
    let mut posted = 0;
    while posted < wanted {
        random ^= random << 13;
        random ^= random >> 17;
        random ^= random << 5;
        // Spread presses over whole frames so they land at every point of the game loop.
        std::thread::sleep(Duration::from_millis(350 + (random % 300) as u64));
        {
            let mut state = STATE.lock();
            state.pending.push_back(Sample {
                posted: Instant::now(),
                seen: None,
                issued: None,
                sent: None,
                executed: None,
                rendered: None,
            });
        }
        unsafe {
            PostMessageW(window, WM_KEYDOWN, vk as usize, down_lparam as isize);
        }
        std::thread::sleep(Duration::from_millis(40));
        unsafe {
            PostMessageW(window, WM_KEYUP, vk as usize, up_lparam as isize);
        }
        posted += 1;
    }
    std::thread::sleep(Duration::from_secs(1));
    let state = STATE.lock();
    summarize(&state.done, "final");
    if !state.pending.is_empty() {
        warn!(
            "Input latency probe: {} presses never completed (seen {}, sent {}, executed {})",
            state.pending.len(),
            state.pending.iter().filter(|x| x.seen.is_some()).count(),
            state.pending.iter().filter(|x| x.sent.is_some()).count(),
            state
                .pending
                .iter()
                .filter(|x| x.executed.is_some())
                .count(),
        );
    }
}

/// The window procedure received `msg`.
pub fn on_window_message(msg: u32, wparam: usize, frame: u32) {
    if !enabled() || msg != winapi::um::winuser::WM_KEYDOWN || wparam != b'S' as usize {
        return;
    }
    let mut state = STATE.lock();
    if let Some(sample) = state.pending.iter_mut().find(|x| x.seen.is_none()) {
        sample.seen = Some((Instant::now(), frame));
    }
}

/// The game's UI issued `command` at `frame`.
pub fn on_send_command(command: &[u8], frame: u32) {
    if !enabled() || command.first() != Some(&STOP_COMMAND) {
        return;
    }
    let mut state = STATE.lock();
    if let Some(sample) = state
        .pending
        .iter_mut()
        .find(|x| x.seen.is_some() && x.issued.is_none())
    {
        sample.issued = Some((Instant::now(), frame));
    }
}

/// A local turn is being handed to the turn transport during the step producing `frame`.
pub fn on_local_turn(turn: &[u8], frame: u32, command_lengths: &[u32]) {
    if !enabled() || !has_stop(turn, command_lengths) {
        return;
    }
    let mut state = STATE.lock();
    if let Some(sample) = state
        .pending
        .iter_mut()
        .find(|x| x.issued.is_some() && x.sent.is_none())
    {
        sample.sent = Some((Instant::now(), frame));
    }
}

/// A step simulating `frame` for the first time is running the local player's commands.
pub fn on_local_commands(data: &[u8], frame: u32, command_lengths: &[u32]) {
    if !enabled() || !has_stop(data, command_lengths) {
        return;
    }
    let mut state = STATE.lock();
    if let Some(sample) = state
        .pending
        .iter_mut()
        .find(|x| x.sent.is_some() && x.executed.is_none())
    {
        sample.executed = Some((Instant::now(), frame));
    }
}

/// The renderer finished a frame.
pub fn on_rendered() {
    if !enabled() {
        return;
    }
    let now = Instant::now();
    let mut state = STATE.lock();
    while state
        .pending
        .front()
        .is_some_and(|x| x.executed.is_some_and(|(at, _)| at < now))
    {
        let Some(mut sample) = state.pending.pop_front() else {
            break;
        };
        sample.rendered = Some(now);
        log_sample(&sample, state.done.len());
        state.done.push(sample);
        if state.done.len().is_multiple_of(SUMMARY_SAMPLES) {
            summarize(&state.done, "running");
        }
    }
}

fn has_stop(data: &[u8], command_lengths: &[u32]) -> bool {
    commands::iter_commands(data, command_lengths).any(|x| x.first() == Some(&STOP_COMMAND))
}

fn ms(from: Instant, to: Instant) -> f64 {
    to.saturating_duration_since(from).as_secs_f64() * 1000.0
}

fn log_sample(sample: &Sample, index: usize) {
    let (Some(seen), Some(issued), Some(sent), Some(executed), Some(rendered)) = (
        sample.seen,
        sample.issued,
        sample.sent,
        sample.executed,
        sample.rendered,
    ) else {
        return;
    };
    info!(
        "Input latency probe sample {index}: seen {:.2} ms (frame {}), issued {:.2} ms (frame {}), \
        sent {:.2} ms (frame {}), executed {:.2} ms (frame {}), rendered {:.2} ms",
        ms(sample.posted, seen.0),
        seen.1,
        ms(sample.posted, issued.0),
        issued.1,
        ms(sample.posted, sent.0),
        sent.1,
        ms(sample.posted, executed.0),
        executed.1,
        ms(sample.posted, rendered),
    );
}

fn summarize(samples: &[Sample], label: &str) {
    let complete: Vec<_> = samples
        .iter()
        .filter_map(|x| {
            Some((
                x.posted,
                x.seen?,
                x.issued?,
                x.sent?,
                x.executed?,
                x.rendered?,
            ))
        })
        .collect();
    if complete.is_empty() {
        info!("Input latency probe {label}: no complete samples");
        return;
    }
    let stat = |values: Vec<f64>| -> String {
        let mut values = values;
        values.sort_by(f64::total_cmp);
        let mean = values.iter().sum::<f64>() / values.len() as f64;
        let at = |q: f64| values[((values.len() - 1) as f64 * q).round() as usize];
        format!(
            "mean {mean:.1} p10 {:.1} p50 {:.1} p90 {:.1}",
            at(0.1),
            at(0.5),
            at(0.9)
        )
    };
    let mut seen_frames = std::collections::BTreeMap::<i64, u32>::new();
    let mut issued_frames = std::collections::BTreeMap::<i64, u32>::new();
    for &(_, seen, issued, _, executed, _) in &complete {
        *seen_frames
            .entry(executed.1 as i64 - seen.1 as i64)
            .or_default() += 1;
        *issued_frames
            .entry(executed.1 as i64 - issued.1 as i64)
            .or_default() += 1;
    }
    info!(
        "Input latency probe {label} ({} samples): post->seen {}; seen->issued {}; \
        issued->sent {}; sent->executed {}; executed->rendered {}; seen->rendered {}; \
        frames seen->executed {:?}; frames issued->executed {:?}",
        complete.len(),
        stat(complete.iter().map(|x| ms(x.0, x.1.0)).collect()),
        stat(complete.iter().map(|x| ms(x.1.0, x.2.0)).collect()),
        stat(complete.iter().map(|x| ms(x.2.0, x.3.0)).collect()),
        stat(complete.iter().map(|x| ms(x.3.0, x.4.0)).collect()),
        stat(complete.iter().map(|x| ms(x.4.0, x.5)).collect()),
        stat(complete.iter().map(|x| ms(x.1.0, x.5)).collect()),
        seen_frames,
        issued_frames,
    );
}
