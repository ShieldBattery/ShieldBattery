//! A benchmark of what the rollback engine ([`crate::rollback`]) costs, run off replay playback so
//! that every run simulates exactly the same frames.
//!
//! At each checkpoint frame of the replay the bench warms the snapshot ring up the way a live game
//! would have it, then runs ticks that roll back a fixed number of frames and re-simulate to the
//! same present, again and again, one per game loop tick so the game renders between them as it
//! would in play. Then it runs ticks that only step forward, snapshotting on the usual spacing,
//! and times bare snapshots and restores. Between checkpoints the replay is stepped through as
//! fast as it will go.
//!
//! Every re-simulation is checked against the first simulation of the same frame: the state hash
//! must match it, and the bytes of every snapshot range must match the first re-simulation's. An
//! optimization that changes what the simulation computes shows up as a failed check in the
//! results rather than as a speedup.
//!
//! With `profile` set, a thread samples the game thread's instruction pointer while the
//! rolling-back ticks run, and the results carry a histogram of where they spent their time by
//! module and offset (SC:R's offsets line up with its disassembly at its preferred image base).
//! Sampling slows the ticks down, so a profiling run's timings are not comparable to others.
//!
//! The results go to a JSON file, after which the process exits unless told not to.
//!
//! Compiled out of release DLLs along with the harness.

use std::collections::HashMap;
use std::fs::File;
use std::io::Write;
use std::path::PathBuf;
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use parking_lot::Mutex;
use serde_json::{Value, json};

use crate::bw_scr::BwScr;
use crate::game_thread;
use crate::rollback::copier;
use crate::rollback::snapshot::{SNAPSHOTS, Snapshots};
use crate::rollback::sounds;
use crate::rollback::tick::{self, TickPlan};

/// Environment variable that arms the bench, holding `key=value` settings separated by `;`, or
/// `1` for the defaults:
/// - `checkpoints=<frames>`: comma-separated frames to measure at (default every 3001 frames
///   from 1500 on, until the replay ends);
/// - `depths=<frames>`: rollback depths to measure (default `1,2,4,8`);
/// - `iters=<n>`: rolling-back ticks per depth per checkpoint (default 24);
/// - `advance=<n>`: forward-only ticks per checkpoint (default 48);
/// - `micro=<n>`: bare snapshots and restores timed per checkpoint, each hot and cold (default 8);
/// - `spacing=<frames>`: snapshot spacing (default the engine's);
/// - `copy_helpers=<n>`: helper threads snapshot and restore copies are split across (default
///   the engine's choice for the machine);
/// - `profile=1`: sample the game thread while rolling back;
/// - `affinity=<hex mask>|none`: the logical processors the game thread is pinned to while the
///   bench runs (default `4`, the third logical processor, a performance core on a hybrid CPU; on
///   the bench machine's i7-14700KF processors 16 and up are efficiency cores, so `10000` stands in
///   for a slower machine). The profiler's sampling thread is pinned to processor 4.
/// - `exit=0`: keep the game running once the results are written.
const ENV_VAR: &str = "SB_ROLLBACK_BENCH";

/// Environment variable naming the results file. Defaults to `rollback-bench-<secs>-<pid>.json`
/// in the logs directory.
const OUT_ENV_VAR: &str = "SB_ROLLBACK_BENCH_OUT";

/// Frames before a checkpoint at which the bench stops fast-forwarding and starts running ticks,
/// so the ring holds the snapshots it would hold in play by the time the checkpoint is reached.
/// Has to cover the deepest rollback plus the snapshot spacing.
const WARMUP_MARGIN: u32 = 4;

/// How far behind the present the confirmed frame sits while the bench runs ticks. Deeper than
/// any rollback it measures, so the ring keeps every snapshot those need.
const CONFIRMED_LAG: u32 = 12;

/// Plain steps run per game loop tick while fast-forwarding.
const FAST_FORWARD_STEPS_PER_TICK: u32 = 400;

/// Plain steps before each checkpoint whose times are kept.
const PLAIN_STEP_SAMPLES: usize = 256;

/// Bytes written to push the snapshot buffers and the simulation out of the CPU caches before a
/// cold measurement, standing in for the rendering that sits between ticks.
const CACHE_THRASH_BYTES: usize = 64 << 20;

/// Interval between profiler samples.
const SAMPLE_INTERVAL: Duration = Duration::from_micros(100);

/// Bytes of the game thread's stack copied per sample and scanned for return addresses.
const SAMPLE_STACK_BYTES: usize = 16 * 1024;

/// Frames walked per sample, innermost first.
const SAMPLE_FRAMES: usize = 48;

struct Config {
    checkpoints: Option<Vec<u32>>,
    depths: Vec<u32>,
    iters: u32,
    advance: u32,
    micro: u32,
    spacing: u32,
    profile: bool,
    exit: bool,
    affinity: Option<usize>,
}

static CONFIG: Mutex<Option<Config>> = Mutex::new(None);

/// Whether the bench was asked for, so replay-only work a live game never does can stay out of
/// what it measures.
static ARMED: AtomicBool = AtomicBool::new(false);

/// Whether the bench is armed.
pub fn armed() -> bool {
    ARMED.load(Ordering::Relaxed)
}
static BENCH: Mutex<Option<Bench>> = Mutex::new(None);

pub fn init_from_env() {
    let Ok(spec) = std::env::var(ENV_VAR) else {
        return;
    };
    let mut config = Config {
        checkpoints: None,
        depths: vec![1, 2, 4, 8],
        iters: 24,
        advance: 48,
        micro: 8,
        spacing: crate::rollback_harness::snapshot_spacing_from_env()
            .unwrap_or(tick::DEFAULT_SNAPSHOT_SPACING),
        profile: false,
        exit: true,
        affinity: Some(0x4),
    };
    let list = |value: &str| -> Option<Vec<u32>> {
        value
            .split(',')
            .map(|x| x.trim().parse::<u32>().ok())
            .collect()
    };
    for part in spec
        .split(';')
        .map(str::trim)
        .filter(|x| !x.is_empty() && *x != "1")
    {
        let Some((key, value)) = part.split_once('=') else {
            error!("{ENV_VAR}: ignoring {part:?}, which is not key=value");
            continue;
        };
        let ok = match key.trim() {
            "checkpoints" => list(value).map(|x| config.checkpoints = Some(x)).is_some(),
            "depths" => list(value).map(|x| config.depths = x).is_some(),
            "iters" => value.parse().map(|x| config.iters = x).is_ok(),
            "advance" => value.parse().map(|x| config.advance = x).is_ok(),
            "micro" => value.parse().map(|x| config.micro = x).is_ok(),
            "copy_helpers" => value
                .parse()
                .map(|x| copier::HELPERS_OVERRIDE.store(x, Ordering::Relaxed))
                .is_ok(),
            "spacing" => value
                .parse()
                .map(|x: u32| config.spacing = x.max(1))
                .is_ok(),
            "profile" => {
                config.profile = value == "1";
                true
            }
            "exit" => {
                config.exit = value != "0";
                true
            }
            "affinity" => match value {
                "none" => {
                    config.affinity = None;
                    true
                }
                _ => usize::from_str_radix(value.trim_start_matches("0x"), 16)
                    .map(|x| config.affinity = Some(x))
                    .is_ok(),
            },
            _ => false,
        };
        if !ok {
            error!("{ENV_VAR}: ignoring {part:?}");
        }
    }
    config.depths.retain(|&x| x > 0 && x < CONFIRMED_LAG);
    info!(
        "{ENV_VAR}: checkpoints {:?}, depths {:?}, {} iterations, {} forward ticks, spacing {}, \
         profile {}",
        config.checkpoints,
        config.depths,
        config.iters,
        config.advance,
        config.spacing,
        config.profile,
    );
    *CONFIG.lock() = Some(config);
    ARMED.store(true, Ordering::Relaxed);
}

/// Runs one game loop tick's worth of the bench during replay playback, or returns `None` when it
/// is not armed or has finished.
pub unsafe fn run_game_logic_step(
    bw: &'static BwScr,
    param: usize,
    orig: unsafe extern "C" fn(usize) -> usize,
) -> Option<usize> {
    unsafe {
        let mut bench = BENCH.lock();
        if bench.is_none() {
            let config = CONFIG.lock().take()?;
            if !game_thread::is_replay() {
                error!("{ENV_VAR} only runs during replay playback");
                return None;
            }
            if let Some(missing) = bw.rollback_missing_analysis() {
                error!("{ENV_VAR} can't roll back: analysis did not find {missing}");
                return None;
            }
            if let Some(mask) = config.affinity {
                use winapi::um::processthreadsapi::GetCurrentThread;
                use winapi::um::winbase::SetThreadAffinityMask;
                SetThreadAffinityMask(GetCurrentThread(), mask);
            }
            *bench = Some(Bench::new(config));
        }
        let state = bench.as_mut()?;
        if matches!(state.phase, Phase::Finished) {
            return None;
        }
        let mut guard = SNAPSHOTS.lock();
        if guard.is_none() {
            *guard = Snapshots::build(bw);
        }
        let snapshots = guard.as_mut()?;
        crate::rollback::count_turns(false);
        let ret = state.tick(bw, snapshots, param, orig);
        if matches!(state.phase, Phase::Finished) {
            drop(guard);
            state.finish(bw);
        }
        Some(ret)
    }
}

enum Phase {
    /// Stepping plainly towards the checkpoint's warmup.
    FastForward,
    /// Running forward-only ticks up to the checkpoint.
    Warmup,
    /// Rolling back `depths[depth]` frames, iteration `iter`.
    Rollback {
        iter: u32,
        depth: usize,
    },
    /// Forward-only ticks after the rolling-back ones.
    Advance {
        remaining: u32,
    },
    Finished,
}

#[derive(Default)]
struct Samples {
    values: Vec<f64>,
}

impl Samples {
    fn push(&mut self, value: f64) {
        self.values.push(value);
    }

    fn to_json(&self) -> Value {
        if self.values.is_empty() {
            return json!(null);
        }
        let mut sorted = self.values.clone();
        sorted.sort_by(|a, b| a.total_cmp(b));
        let at = |q: f64| sorted[((sorted.len() - 1) as f64 * q).round() as usize];
        let mean = sorted.iter().sum::<f64>() / sorted.len() as f64;
        let round = |x: f64| (x * 10.0).round() / 10.0;
        json!({
            "n": sorted.len(),
            "mean": round(mean),
            "median": round(at(0.5)),
            "p90": round(at(0.9)),
            "max": round(sorted[sorted.len() - 1]),
            "min": round(sorted[0]),
        })
    }

    fn median(&self) -> Option<f64> {
        if self.values.is_empty() {
            return None;
        }
        let mut sorted = self.values.clone();
        sorted.sort_by(|a, b| a.total_cmp(b));
        Some(sorted[sorted.len() / 2])
    }
}

/// Timings of the ticks that rolled back one depth at one checkpoint.
#[derive(Default)]
struct DepthResult {
    /// Thread CPU time of the whole tick, which excludes time the thread was descheduled.
    tick_cpu_us: Samples,
    tick_wall_us: Samples,
    restore_us: Samples,
    snapshot_us: Samples,
    steps_us: Samples,
    steps: Samples,
    /// Time the copy helper threads spent awake during the tick, on top of the tick's own.
    helper_us: Samples,
    hash_mismatches: u32,
    bytes_mismatches: u32,
}

#[derive(Default)]
struct CheckpointResult {
    frame: u32,
    units: u32,
    plain_step_cpu_us: Samples,
    depths: Vec<(u32, DepthResult)>,
    advance_cpu_us: Samples,
    advance_wall_us: Samples,
    advance_snapshot_us: Samples,
    advance_steps_us: Samples,
    advance_helper_us: Samples,
    take_hot_us: Samples,
    take_cold_us: Samples,
    restore_hot_us: Samples,
    restore_cold_us: Samples,
    /// Ranges whose bytes differed between the first simulation of the checkpoint and its first
    /// re-simulation: state the simulation writes from something outside the snapshot.
    first_pass_differs: Vec<String>,
    /// Ranges a later re-simulation left differently from the first one.
    resim_differs: Vec<String>,
    /// Per range: bytes, and the 64-byte lines and 4 KiB pages one and eight frames changed.
    dirt: Vec<Value>,
}

struct Bench {
    config: Config,
    phase: Phase,
    checkpoints: Vec<u32>,
    next: usize,
    current: CheckpointResult,
    results: Vec<CheckpointResult>,
    tsc_per_us: f64,
    started: Instant,
    reference_hash: Option<u64>,
    reference_bytes: Option<Vec<u8>>,
    first_pass_bytes: Option<Vec<u8>>,
    copies_before: Vec<(u32, Vec<u8>)>,
    snapshot_bytes: usize,
    /// Helper threads the snapshots' copies are split across.
    copy_helpers: usize,
    ranges: Vec<(String, usize)>,
    sampler: Option<Sampler>,
    thrash: Vec<u8>,
    replay_ended: bool,
}

impl Bench {
    fn new(config: Config) -> Bench {
        let checkpoints = config
            .checkpoints
            .clone()
            // Offset by one more frame each time, so the checkpoints sit at every position
            // relative to the snapshot spacing in turn.
            .unwrap_or_else(|| (0..64).map(|i| 1500 + i * 3001).collect());
        Bench {
            phase: Phase::FastForward,
            checkpoints,
            next: 0,
            current: CheckpointResult::default(),
            results: Vec::new(),
            tsc_per_us: measure_tsc_per_us(),
            started: Instant::now(),
            reference_hash: None,
            reference_bytes: None,
            first_pass_bytes: None,
            copies_before: Vec::new(),
            snapshot_bytes: 0,
            copy_helpers: 0,
            ranges: Vec::new(),
            sampler: config.profile.then(Sampler::start),
            thrash: Vec::new(),
            replay_ended: false,
            config,
        }
    }

    fn checkpoint(&self) -> Option<u32> {
        self.checkpoints.get(self.next).copied()
    }

    fn warmup_start(&self, checkpoint: u32) -> u32 {
        let deepest = self.config.depths.iter().copied().max().unwrap_or(0);
        checkpoint.saturating_sub(deepest.max(CONFIRMED_LAG) + self.config.spacing + WARMUP_MARGIN)
    }

    fn cpu_us(&self, cycles: u64) -> f64 {
        cycles as f64 / self.tsc_per_us
    }

    unsafe fn tick(
        &mut self,
        bw: &BwScr,
        snapshots: &mut Snapshots,
        param: usize,
        orig: unsafe extern "C" fn(usize) -> usize,
    ) -> usize {
        unsafe {
            if self.ranges.is_empty() {
                self.ranges = snapshots
                    .ranges()
                    .iter()
                    .map(|x| (x.name().to_owned(), x.len()))
                    .collect();
                self.snapshot_bytes = self.ranges.iter().map(|x| x.1).sum();
                self.copy_helpers = snapshots.copy_helpers();
            }
            let Some(frame) = bw.rollback_frame_count() else {
                return orig(param);
            };
            let Some(checkpoint) = self.checkpoint() else {
                self.phase = Phase::Finished;
                return orig(param);
            };
            match self.phase {
                Phase::FastForward => {
                    let target = self.warmup_start(checkpoint);
                    if frame >= target {
                        if frame > checkpoint {
                            // Checkpoints out of order or too close together.
                            self.next += 1;
                            return orig(param);
                        }
                        self.begin_checkpoint(checkpoint, snapshots);
                        return self.tick(bw, snapshots, param, orig);
                    }
                    // Each step pushes the tick the game loop paces itself against a frame
                    // further on, so put it back once the batch has run.
                    let paced_tick = bw.rollback_next_game_step_tick();
                    let mut ret = 0;
                    let mut at = frame;
                    let mut ran = 0;
                    while at < target && ran < FAST_FORWARD_STEPS_PER_TICK {
                        let start = thread_cycles();
                        ret = orig(param);
                        let cycles = thread_cycles().wrapping_sub(start);
                        sounds::forget_requested();
                        ran += 1;
                        match bw.rollback_frame_count() {
                            Some(after) if after > at => at = after,
                            _ => {
                                self.replay_ended = true;
                                self.phase = Phase::Finished;
                                break;
                            }
                        }
                        if target - at <= PLAIN_STEP_SAMPLES as u32 {
                            self.current.plain_step_cpu_us.push(self.cpu_us(cycles));
                        }
                    }
                    bw.rollback_set_next_game_step_tick(paced_tick);
                    ret
                }
                Phase::Warmup => {
                    if frame >= checkpoint {
                        self.reach_checkpoint(bw, snapshots);
                        return self.tick(bw, snapshots, param, orig);
                    }
                    if frame + 1 == checkpoint || frame + 8 == checkpoint {
                        self.copies_before
                            .push((checkpoint - frame, copy_ranges(snapshots)));
                    }
                    let (ret, _) =
                        self.run_tick(bw, snapshots, frame, None, frame + 1, || orig(param));
                    if bw.rollback_frame_count() == Some(frame) {
                        self.replay_ended = true;
                        self.phase = Phase::Finished;
                    }
                    ret
                }
                Phase::Rollback { iter, depth } => {
                    let depth_frames = self.config.depths[depth];
                    let sampling = self.sampler.as_ref().map(|x| x.active.clone());
                    if let Some(active) = &sampling {
                        active.store(true, Ordering::Release);
                    }
                    let helper_busy = snapshots.copy_helper_busy();
                    let start_cycles = thread_cycles();
                    let start = Instant::now();
                    let (ret, report) = self.run_tick(
                        bw,
                        snapshots,
                        frame,
                        Some(frame - depth_frames),
                        frame,
                        || orig(param),
                    );
                    let wall = start.elapsed();
                    let cycles = thread_cycles().wrapping_sub(start_cycles);
                    if let Some(active) = &sampling {
                        active.store(false, Ordering::Release);
                    }
                    let cpu_us = self.cpu_us(cycles);
                    let result = &mut self.current.depths[depth].1;
                    result.tick_cpu_us.push(cpu_us);
                    result.tick_wall_us.push(wall.as_secs_f64() * 1e6);
                    result
                        .restore_us
                        .push(report.restore_time.as_secs_f64() * 1e6);
                    result
                        .snapshot_us
                        .push(report.snapshot_time.as_secs_f64() * 1e6);
                    result.steps_us.push(report.step_time.as_secs_f64() * 1e6);
                    result.steps.push(report.steps as f64);
                    result
                        .helper_us
                        .push((snapshots.copy_helper_busy() - helper_busy).as_secs_f64() * 1e6);
                    if bw.rollback_state_hash() != self.reference_hash {
                        result.hash_mismatches += 1;
                    }
                    if iter == 0 || iter + 1 == self.config.iters {
                        let bytes = copy_ranges(snapshots);
                        match &self.reference_bytes {
                            None => {
                                if let Some(first) = &self.first_pass_bytes {
                                    self.current.first_pass_differs =
                                        differing_ranges(&self.ranges, first, &bytes);
                                }
                                self.reference_bytes = Some(bytes);
                            }
                            Some(reference) => {
                                let differs = differing_ranges(&self.ranges, reference, &bytes);
                                if !differs.is_empty() {
                                    self.current.depths[depth].1.bytes_mismatches += 1;
                                    for name in differs {
                                        if !self.current.resim_differs.contains(&name) {
                                            self.current.resim_differs.push(name);
                                        }
                                    }
                                }
                            }
                        }
                    }
                    self.phase = match (depth + 1 < self.config.depths.len(), iter + 1) {
                        (true, _) => Phase::Rollback {
                            iter,
                            depth: depth + 1,
                        },
                        (false, next) if next < self.config.iters => Phase::Rollback {
                            iter: next,
                            depth: 0,
                        },
                        _ => Phase::Advance {
                            remaining: self.config.advance,
                        },
                    };
                    ret
                }
                Phase::Advance { remaining } => {
                    let helper_busy = snapshots.copy_helper_busy();
                    let start_cycles = thread_cycles();
                    let start = Instant::now();
                    let (ret, report) =
                        self.run_tick(bw, snapshots, frame, None, frame + 1, || orig(param));
                    let wall = start.elapsed();
                    let cycles = thread_cycles().wrapping_sub(start_cycles);
                    self.current.advance_cpu_us.push(self.cpu_us(cycles));
                    self.current.advance_wall_us.push(wall.as_secs_f64() * 1e6);
                    self.current
                        .advance_snapshot_us
                        .push(report.snapshot_time.as_secs_f64() * 1e6);
                    self.current
                        .advance_steps_us
                        .push(report.step_time.as_secs_f64() * 1e6);
                    self.current
                        .advance_helper_us
                        .push((snapshots.copy_helper_busy() - helper_busy).as_secs_f64() * 1e6);
                    let ended = bw.rollback_frame_count() == Some(frame);
                    if remaining <= 1 || ended {
                        self.micro(bw, snapshots);
                        self.end_checkpoint(snapshots);
                        if ended {
                            self.replay_ended = true;
                            self.phase = Phase::Finished;
                        }
                    } else {
                        self.phase = Phase::Advance {
                            remaining: remaining - 1,
                        };
                    }
                    ret
                }
                Phase::Finished => orig(param),
            }
        }
    }

    /// Runs one engine tick from `current` the way the live driver does, sounds included, with
    /// `step` running BW's logic step.
    unsafe fn run_tick(
        &self,
        bw: &BwScr,
        snapshots: &mut Snapshots,
        current: u32,
        rollback_to: Option<u32>,
        present: u32,
        step: impl FnMut() -> usize,
    ) -> (usize, tick::TickReport) {
        unsafe {
            let plan = TickPlan {
                rollback_to,
                present,
                confirmed: present.saturating_sub(CONFIRMED_LAG),
                spacing: self.config.spacing,
            };
            let mut step = step;
            let (ret, report) = tick::run_tick(bw, snapshots, current, &plan, |_| step());
            sounds::reconcile_sounds(bw, report.window_start, report.settled_through, present);
            (ret, report)
        }
    }

    fn begin_checkpoint(&mut self, checkpoint: u32, snapshots: &mut Snapshots) {
        info!("Rollback bench warming up for checkpoint {checkpoint}");
        let plain = std::mem::take(&mut self.current.plain_step_cpu_us);
        self.current = CheckpointResult {
            frame: checkpoint,
            plain_step_cpu_us: plain,
            depths: self
                .config
                .depths
                .iter()
                .map(|&x| (x, DepthResult::default()))
                .collect(),
            ..CheckpointResult::default()
        };
        self.reference_hash = None;
        self.reference_bytes = None;
        self.first_pass_bytes = None;
        self.copies_before.clear();
        snapshots.forget_all();
        self.phase = Phase::Warmup;
    }

    unsafe fn reach_checkpoint(&mut self, bw: &BwScr, snapshots: &Snapshots) {
        unsafe {
            self.current.units = count_units(bw);
            self.reference_hash = bw.rollback_state_hash();
            let bytes = copy_ranges(snapshots);
            let ranges = snapshots.ranges();
            let mut dirt = Vec::with_capacity(ranges.len());
            let mut offset = 0;
            for (i, (name, len)) in self.ranges.iter().enumerate() {
                let now = &bytes[offset..offset + len];
                let mut entry = json!({ "name": name, "index": i, "bytes": len });
                for (frames, before) in &self.copies_before {
                    let before = &before[offset..offset + len];
                    let (lines, pages) = changed_lines_and_pages(ranges[i].start(), before, now);
                    entry[format!("lines_{frames}f")] = json!(lines);
                    entry[format!("pages_{frames}f")] = json!(pages);
                }
                dirt.push(entry);
                offset += len;
            }
            self.current.dirt = dirt;
            self.first_pass_bytes = Some(bytes);
            self.copies_before.clear();
            info!(
                "Rollback bench at checkpoint {}: {} units",
                self.current.frame, self.current.units
            );
            self.phase = match self.config.depths.is_empty() || self.config.iters == 0 {
                true => Phase::Advance {
                    remaining: self.config.advance.max(1),
                },
                false => Phase::Rollback { iter: 0, depth: 0 },
            };
        }
    }

    /// Times bare snapshots and restores of the frame the simulation is on, with the caches as
    /// the last tick left them and again after pushing everything out of them.
    unsafe fn micro(&mut self, bw: &BwScr, snapshots: &mut Snapshots) {
        unsafe {
            let Some(frame) = bw.rollback_frame_count() else {
                return;
            };
            if self.thrash.is_empty() {
                self.thrash = vec![0u8; CACHE_THRASH_BYTES];
            }
            for i in 0..self.config.micro {
                for cold in [false, true] {
                    if cold {
                        thrash_caches(&mut self.thrash, i);
                    }
                    let start = Instant::now();
                    snapshots.take(frame);
                    let take = start.elapsed().as_secs_f64() * 1e6;
                    if cold {
                        thrash_caches(&mut self.thrash, i);
                    }
                    let start = Instant::now();
                    snapshots.restore_at_or_before(frame, bw);
                    let restore = start.elapsed().as_secs_f64() * 1e6;
                    match cold {
                        false => {
                            self.current.take_hot_us.push(take);
                            self.current.restore_hot_us.push(restore);
                        }
                        true => {
                            self.current.take_cold_us.push(take);
                            self.current.restore_cold_us.push(restore);
                        }
                    }
                }
            }
        }
    }

    fn end_checkpoint(&mut self, snapshots: &mut Snapshots) {
        info!("Rollback bench finished checkpoint {}", self.current.frame);
        snapshots.forget_all();
        self.reference_bytes = None;
        self.first_pass_bytes = None;
        self.results.push(std::mem::take(&mut self.current));
        self.next += 1;
        self.phase = match self.checkpoint() {
            Some(_) => Phase::FastForward,
            None => Phase::Finished,
        };
    }

    unsafe fn finish(&mut self, bw: &BwScr) {
        unsafe {
            let profile = self.sampler.take().map(|x| x.finish());
            let checkpoints = self.results.iter().map(checkpoint_json).collect::<Vec<_>>();
            let summary = self.summary();
            let out = json!({
                "version": 1,
                "arch": std::env::consts::ARCH,
                "build": env!("SHIELDBATTERY_VERSION"),
                "elapsed_s": self.started.elapsed().as_secs_f64(),
                "replay_ended": self.replay_ended,
                "final_frame": bw.rollback_frame_count(),
                "tsc_mhz": self.tsc_per_us,
                "config": {
                    "depths": self.config.depths,
                    "iters": self.config.iters,
                    "advance": self.config.advance,
                    "micro": self.config.micro,
                    "spacing": self.config.spacing,
                    "profile": self.config.profile,
                    "affinity": self.config.affinity.map(|x| format!("{x:x}")),
                },
                "snapshot_bytes": self.snapshot_bytes,
                "copy_helpers": self.copy_helpers,
                "ranges": self.ranges.iter().map(|(name, len)| json!([name, len])).collect::<Vec<_>>(),
                "summary": summary,
                "checkpoints": checkpoints,
                "profile": profile,
            });
            let path = match std::env::var(OUT_ENV_VAR) {
                Ok(path) => PathBuf::from(path),
                Err(_) => {
                    let seconds = SystemTime::now()
                        .duration_since(UNIX_EPOCH)
                        .unwrap_or(Duration::ZERO)
                        .as_secs();
                    crate::parse_args()
                        .user_data_path
                        .join("logs")
                        .join(format!(
                            "rollback-bench-{seconds}-{}.json",
                            std::process::id()
                        ))
                }
            };
            // Written under another name and renamed, so whoever waits for the file never reads
            // half of it.
            let partial = path.with_extension("partial");
            let written = File::create(&partial)
                .and_then(|mut file| {
                    file.write_all(
                        serde_json::to_string_pretty(&out)
                            .unwrap_or_default()
                            .as_bytes(),
                    )
                })
                .and_then(|()| std::fs::rename(&partial, &path));
            match written {
                Ok(()) => info!("Rollback bench results written to {}", path.display()),
                Err(e) => error!("Rollback bench could not write {}: {e}", path.display()),
            }
            if self.config.exit {
                info!("Rollback bench exiting the game");
                winapi::um::processthreadsapi::TerminateProcess(
                    winapi::um::processthreadsapi::GetCurrentProcess(),
                    0,
                );
            }
        }
    }

    /// Each measurement's median at every checkpoint, averaged over the checkpoints, and whether
    /// every re-simulation reproduced the first simulation.
    fn summary(&self) -> Value {
        let average = |f: &dyn Fn(&CheckpointResult) -> Option<f64>| -> Value {
            let values = self.results.iter().filter_map(f).collect::<Vec<_>>();
            match values.is_empty() {
                true => json!(null),
                false => {
                    let mean = values.iter().sum::<f64>() / values.len() as f64;
                    json!((mean * 10.0).round() / 10.0)
                }
            }
        };
        let mut by_depth = serde_json::Map::new();
        let mut by_depth_p90 = serde_json::Map::new();
        let mut wall_by_depth = serde_json::Map::new();
        let mut helper_by_depth = serde_json::Map::new();
        for (i, &depth) in self.config.depths.iter().enumerate() {
            wall_by_depth.insert(
                depth.to_string(),
                average(&|c| c.depths.get(i).and_then(|x| x.1.tick_wall_us.median())),
            );
            helper_by_depth.insert(
                depth.to_string(),
                average(&|c| c.depths.get(i).and_then(|x| x.1.helper_us.median())),
            );
            by_depth.insert(
                depth.to_string(),
                average(&|c| c.depths.get(i).and_then(|x| x.1.tick_cpu_us.median())),
            );
            by_depth_p90.insert(
                depth.to_string(),
                average(&|c| {
                    let values = &c.depths.get(i)?.1.tick_cpu_us.values;
                    let mut sorted = values.clone();
                    sorted.sort_by(|a, b| a.total_cmp(b));
                    sorted
                        .get(((sorted.len().max(1) - 1) as f64 * 0.9).round() as usize)
                        .copied()
                }),
            );
        }
        let hash_mismatches = self
            .results
            .iter()
            .flat_map(|c| c.depths.iter().map(|x| x.1.hash_mismatches))
            .sum::<u32>();
        let bytes_mismatches = self
            .results
            .iter()
            .flat_map(|c| c.depths.iter().map(|x| x.1.bytes_mismatches))
            .sum::<u32>();
        let mut resim_differs = self
            .results
            .iter()
            .flat_map(|c| c.resim_differs.iter())
            .map(|x| x.split('#').next().unwrap_or(x).to_owned())
            .collect::<Vec<_>>();
        resim_differs.sort();
        resim_differs.dedup();
        json!({
            "checkpoints_measured": self.results.len(),
            "rollback_tick_cpu_us_median": by_depth,
            "rollback_tick_cpu_us_p90": by_depth_p90,
            "rollback_tick_wall_us_median": wall_by_depth,
            "rollback_tick_helper_us_median": helper_by_depth,
            "advance_tick_helper_us_mean": average(&|c| {
                let v = &c.advance_helper_us.values;
                (!v.is_empty()).then(|| v.iter().sum::<f64>() / v.len() as f64)
            }),
            "advance_tick_cpu_us_median": average(&|c| c.advance_cpu_us.median()),
            "advance_tick_cpu_us_mean": average(&|c| {
                let v = &c.advance_cpu_us.values;
                (!v.is_empty()).then(|| v.iter().sum::<f64>() / v.len() as f64)
            }),
            "plain_step_cpu_us_median": average(&|c| c.plain_step_cpu_us.median()),
            "take_hot_us_median": average(&|c| c.take_hot_us.median()),
            "take_cold_us_median": average(&|c| c.take_cold_us.median()),
            "restore_hot_us_median": average(&|c| c.restore_hot_us.median()),
            "restore_cold_us_median": average(&|c| c.restore_cold_us.median()),
            "hash_mismatches": hash_mismatches,
            "bytes_mismatches": bytes_mismatches,
            // Ranges some re-simulation left differently from the first one at the same
            // checkpoint. Rendering between ticks writes some ranges (image and draw-order state,
            // display creep in the map tiles, the sync ring's camera bytes) and query scratch
            // carries over, so a baseline run already lists those; a range that appears only
            // after a change is state the change made the simulation compute differently.
            "resim_differs_ranges": resim_differs,
            "deterministic": hash_mismatches == 0,
        })
    }
}

fn checkpoint_json(c: &CheckpointResult) -> Value {
    let depths = c
        .depths
        .iter()
        .map(|(depth, x)| {
            json!({
                "depth": depth,
                "tick_cpu_us": x.tick_cpu_us.to_json(),
                "tick_wall_us": x.tick_wall_us.to_json(),
                "restore_us": x.restore_us.to_json(),
                "snapshot_us": x.snapshot_us.to_json(),
                "steps_us": x.steps_us.to_json(),
                "steps": x.steps.to_json(),
                "helper_us": x.helper_us.to_json(),
                "hash_mismatches": x.hash_mismatches,
                "bytes_mismatches": x.bytes_mismatches,
            })
        })
        .collect::<Vec<_>>();
    json!({
        "frame": c.frame,
        "units": c.units,
        "plain_step_cpu_us": c.plain_step_cpu_us.to_json(),
        "rollback": depths,
        "advance_tick_cpu_us": c.advance_cpu_us.to_json(),
        "advance_tick_wall_us": c.advance_wall_us.to_json(),
        "advance_snapshot_us": c.advance_snapshot_us.to_json(),
        "advance_steps_us": c.advance_steps_us.to_json(),
        "advance_helper_us": c.advance_helper_us.to_json(),
        "take_hot_us": c.take_hot_us.to_json(),
        "take_cold_us": c.take_cold_us.to_json(),
        "restore_hot_us": c.restore_hot_us.to_json(),
        "restore_cold_us": c.restore_cold_us.to_json(),
        "first_pass_differs": c.first_pass_differs,
        "resim_differs": c.resim_differs,
        "dirt": c.dirt,
    })
}

/// The bytes of every snapshot range, concatenated in range order.
unsafe fn copy_ranges(snapshots: &Snapshots) -> Vec<u8> {
    unsafe {
        let ranges = snapshots.ranges();
        let mut out = Vec::with_capacity(ranges.iter().map(|x| x.len()).sum());
        for range in ranges {
            out.extend_from_slice(std::slice::from_raw_parts(
                range.start() as *const u8,
                range.len(),
            ));
        }
        out
    }
}

/// The names (and indices) of the ranges whose bytes differ between two [`copy_ranges`] copies.
fn differing_ranges(ranges: &[(String, usize)], a: &[u8], b: &[u8]) -> Vec<String> {
    let mut out = Vec::new();
    let mut offset = 0;
    for (i, (name, len)) in ranges.iter().enumerate() {
        let (x, y) = (&a[offset..offset + len], &b[offset..offset + len]);
        if x != y {
            let first = x.iter().zip(y).position(|(p, q)| p != q).unwrap_or(0);
            let count = x.iter().zip(y).filter(|(p, q)| p != q).count();
            out.push(format!("{name}#{i}+{first:x} ({count} bytes)"));
        }
        offset += len;
    }
    out
}

/// How many 64-byte cache lines and 4 KiB pages, aligned as they are in memory at `start`,
/// hold a byte that differs between `before` and `now`.
fn changed_lines_and_pages(start: usize, before: &[u8], now: &[u8]) -> (usize, usize) {
    let mut lines = 0;
    let mut pages = 0;
    let mut last_line = usize::MAX;
    let mut last_page = usize::MAX;
    let mut i = 0;
    while i < before.len() {
        let line = (start + i) / 64;
        let line_end = ((line + 1) * 64 - start).min(before.len());
        if before[i..line_end] != now[i..line_end] {
            if line != last_line {
                lines += 1;
                last_line = line;
            }
            let page = (start + i) / 4096;
            if page != last_page {
                pages += 1;
                last_page = page;
            }
        }
        i = line_end;
    }
    (lines, pages)
}

unsafe fn count_units(bw: &BwScr) -> u32 {
    unsafe {
        let mut count = 0;
        for name in ["first_active_unit", "first_hidden_unit"] {
            let mut unit = bw.rollback_list_head(name) as *const crate::bw::Unit;
            while !unit.is_null() && count < 0x10000 {
                count += 1;
                unit = (*unit).flingy.next as *const crate::bw::Unit;
            }
        }
        count
    }
}

/// Writes through a buffer larger than the CPU caches, varying the values so nothing can skip it.
fn thrash_caches(buffer: &mut [u8], salt: u32) {
    for (i, chunk) in buffer.chunks_mut(64).enumerate() {
        chunk[0] = (i as u32 ^ salt) as u8;
    }
    std::hint::black_box(&buffer);
}

fn thread_cycles() -> u64 {
    use winapi::um::processthreadsapi::GetCurrentThread;
    use winapi::um::realtimeapiset::QueryThreadCycleTime;
    let mut cycles = 0;
    unsafe {
        QueryThreadCycleTime(GetCurrentThread(), &mut cycles);
    }
    cycles
}

/// The rate thread cycle counts advance at, in cycles per microsecond: they count the time-stamp
/// counter, which runs at a fixed rate regardless of the core's clock.
fn measure_tsc_per_us() -> f64 {
    let start = Instant::now();
    let cycles = rdtsc();
    while start.elapsed() < Duration::from_millis(50) {
        std::hint::spin_loop();
    }
    let elapsed = start.elapsed();
    (rdtsc() - cycles) as f64 / (elapsed.as_secs_f64() * 1e6)
}

fn rdtsc() -> u64 {
    #[cfg(target_arch = "x86_64")]
    unsafe {
        std::arch::x86_64::_rdtsc()
    }
    #[cfg(target_arch = "x86")]
    unsafe {
        std::arch::x86::_rdtsc()
    }
}

/// Samples the game thread's instruction pointer, and a guess at its callers, while `active`.
struct Sampler {
    active: Arc<AtomicBool>,
    stop: Arc<AtomicBool>,
    thread: Option<std::thread::JoinHandle<SamplerOutput>>,
}

#[derive(Default)]
struct SamplerOutput {
    samples: u64,
    /// Samples by the function the thread was in (on x86, by instruction pointer).
    leaf: HashMap<usize, u32>,
    /// Samples by every function on the call stack, counted once per sample. On x86, which has no
    /// unwind data to walk, the callers are a guess: stack words that look like return addresses.
    inclusive: HashMap<usize, u32>,
    /// Samples by caller and callee function.
    edges: HashMap<(usize, usize), u32>,
}

struct SendHandle(winapi::um::winnt::HANDLE);
unsafe impl Send for SendHandle {}

impl Sampler {
    /// Starts sampling the calling thread.
    fn start() -> Sampler {
        use winapi::um::processthreadsapi::{GetCurrentThreadId, OpenThread};
        use winapi::um::winnt::{
            THREAD_GET_CONTEXT, THREAD_QUERY_INFORMATION, THREAD_SUSPEND_RESUME,
        };
        let active = Arc::new(AtomicBool::new(false));
        let stop = Arc::new(AtomicBool::new(false));
        let (low, high) = current_stack_limits();
        let handle = unsafe {
            OpenThread(
                THREAD_GET_CONTEXT | THREAD_SUSPEND_RESUME | THREAD_QUERY_INFORMATION,
                0,
                GetCurrentThreadId(),
            )
        };
        let handle = SendHandle(handle);
        let code = code_ranges();
        let thread = {
            let active = active.clone();
            let stop = stop.clone();
            std::thread::spawn(move || {
                use winapi::um::processthreadsapi::GetCurrentThread;
                use winapi::um::winbase::SetThreadAffinityMask;
                unsafe { SetThreadAffinityMask(GetCurrentThread(), 0x10) };
                let handle = handle;
                sample_loop(handle.0, &active, &stop, (low, high), &code)
            })
        };
        Sampler {
            active,
            stop,
            thread: Some(thread),
        }
    }

    fn finish(mut self) -> Value {
        self.stop.store(true, Ordering::Release);
        let Some(output) = self.thread.take().and_then(|x| x.join().ok()) else {
            return json!(null);
        };
        let modules = modules();
        let describe = |address: usize| -> (String, usize) {
            modules
                .iter()
                .find(|(base, size, _)| address >= *base && address < base + size)
                .map(|(base, _, name)| (name.clone(), address - base))
                .unwrap_or_else(|| ("?".to_owned(), address))
        };
        let table = |counts: &HashMap<usize, u32>, limit: usize| -> Vec<Value> {
            let mut entries = counts.iter().map(|(&a, &n)| (a, n)).collect::<Vec<_>>();
            entries.sort_by_key(|x| std::cmp::Reverse(x.1));
            entries
                .into_iter()
                .take(limit)
                .map(|(address, samples)| {
                    let (module, offset) = describe(address);
                    json!({ "module": module, "rva": format!("{offset:x}"), "samples": samples })
                })
                .collect()
        };
        let mut by_module: HashMap<String, u32> = HashMap::new();
        for (&address, &samples) in &output.leaf {
            *by_module.entry(describe(address).0).or_default() += samples;
        }
        let mut edges = output.edges.iter().collect::<Vec<_>>();
        edges.sort_by_key(|x| std::cmp::Reverse(*x.1));
        let edges = edges
            .into_iter()
            .take(6000)
            .map(|(&(caller, callee), &samples)| {
                let (caller_module, caller) = describe(caller);
                let (callee_module, callee) = describe(callee);
                json!({
                    "caller_module": caller_module,
                    "caller": format!("{caller:x}"),
                    "callee_module": callee_module,
                    "callee": format!("{callee:x}"),
                    "samples": samples,
                })
            })
            .collect::<Vec<_>>();
        json!({
            "samples": output.samples,
            "by_module": by_module,
            "leaf": table(&output.leaf, 4000),
            "inclusive": table(&output.inclusive, 4000),
            "edges": edges,
        })
    }
}

fn current_stack_limits() -> (usize, usize) {
    unsafe extern "system" {
        fn GetCurrentThreadStackLimits(low: *mut usize, high: *mut usize);
    }
    let (mut low, mut high) = (0, 0);
    unsafe { GetCurrentThreadStackLimits(&mut low, &mut high) };
    (low, high)
}

/// The code sections of the executable and of this DLL, which return addresses worth counting
/// point into. Only those are read from, since other parts of an image need not be readable.
fn code_ranges() -> Vec<(usize, usize)> {
    use winapi::um::libloaderapi::{
        GET_MODULE_HANDLE_EX_FLAG_FROM_ADDRESS, GET_MODULE_HANDLE_EX_FLAG_UNCHANGED_REFCOUNT,
        GetModuleHandleExW, GetModuleHandleW,
    };
    unsafe {
        let mut this = std::ptr::null_mut();
        GetModuleHandleExW(
            GET_MODULE_HANDLE_EX_FLAG_FROM_ADDRESS | GET_MODULE_HANDLE_EX_FLAG_UNCHANGED_REFCOUNT,
            code_ranges as *const u16,
            &mut this,
        );
        let mut out = image_code_ranges(GetModuleHandleW(std::ptr::null()) as usize);
        if !this.is_null() {
            out.extend(image_code_ranges(this as usize));
        }
        out
    }
}

/// The executable sections of the image loaded at `base`.
unsafe fn image_code_ranges(base: usize) -> Vec<(usize, usize)> {
    use winapi::um::winnt::{
        IMAGE_DOS_HEADER, IMAGE_FILE_HEADER, IMAGE_NT_HEADERS, IMAGE_SCN_MEM_EXECUTE,
        IMAGE_SECTION_HEADER,
    };
    unsafe {
        let dos = base as *const IMAGE_DOS_HEADER;
        let nt = (base + (*dos).e_lfanew as usize) as *const IMAGE_NT_HEADERS;
        let first = (nt as usize
            + 4
            + size_of::<IMAGE_FILE_HEADER>()
            + (*nt).FileHeader.SizeOfOptionalHeader as usize)
            as *const IMAGE_SECTION_HEADER;
        (0..(*nt).FileHeader.NumberOfSections as usize)
            .map(|i| &*first.add(i))
            .filter(|x| x.Characteristics & IMAGE_SCN_MEM_EXECUTE != 0)
            .map(|x| {
                let start = base + x.VirtualAddress as usize;
                (start, start + *x.Misc.VirtualSize() as usize)
            })
            .collect()
    }
}

fn sample_loop(
    thread: winapi::um::winnt::HANDLE,
    active: &AtomicBool,
    stop: &AtomicBool,
    (stack_low, stack_high): (usize, usize),
    code: &[(usize, usize)],
) -> SamplerOutput {
    use winapi::um::processthreadsapi::{GetThreadContext, ResumeThread, SuspendThread};
    use winapi::um::winnt::{CONTEXT, CONTEXT_CONTROL, CONTEXT_INTEGER};
    // GetThreadContext wants the context 16-byte aligned on x86_64.
    #[repr(C, align(16))]
    struct Aligned(CONTEXT);
    let mut output = SamplerOutput::default();
    // Zeroed past the copied part, so an unwind that runs off the end reads zeros.
    let mut stack = vec![0usize; (SAMPLE_STACK_BYTES + 4096) / size_of::<usize>()];
    let mut frames = Vec::with_capacity(SAMPLE_FRAMES);
    let mut next = Instant::now();
    while !stop.load(Ordering::Acquire) {
        // The ticks it samples last a few milliseconds, shorter than a sleep can be relied on to
        // wake up in, so the thread spins on its own core instead.
        if !active.load(Ordering::Acquire) {
            std::hint::spin_loop();
            next = Instant::now();
            continue;
        }
        while Instant::now() < next {
            std::hint::spin_loop();
        }
        next += SAMPLE_INTERVAL;
        // Nothing between the suspend and the resume may allocate or take a lock: the game
        // thread could be holding the one it would need.
        let mut words = 0;
        let mut aligned: Aligned = unsafe { std::mem::zeroed() };
        let sp;
        unsafe {
            if SuspendThread(thread) == u32::MAX {
                continue;
            }
            let context = &mut aligned.0;
            context.ContextFlags = CONTEXT_CONTROL | CONTEXT_INTEGER;
            let ok = GetThreadContext(thread, context) != 0;
            #[cfg(target_arch = "x86_64")]
            {
                sp = context.Rsp as usize;
            }
            #[cfg(target_arch = "x86")]
            {
                sp = context.Esp as usize;
            }
            if ok && sp >= stack_low && sp < stack_high {
                let bytes = (stack_high - sp).min(SAMPLE_STACK_BYTES);
                words = bytes / size_of::<usize>();
                std::ptr::copy_nonoverlapping(sp as *const usize, stack.as_mut_ptr(), words);
            }
            ResumeThread(thread);
            if !ok {
                continue;
            }
        }
        stack[words..].fill(0);
        frames.clear();
        #[cfg(target_arch = "x86_64")]
        unsafe {
            let _ = code;
            unwind(&mut aligned.0, sp, &stack, words, &mut frames);
        }
        #[cfg(target_arch = "x86")]
        {
            let _ = sp;
            frames.push(aligned.0.Eip as usize);
            for &word in &stack[..words] {
                if frames.len() >= SAMPLE_FRAMES {
                    break;
                }
                if code
                    .iter()
                    .any(|&(low, high)| word >= low + 8 && word < high)
                    && looks_like_return_address(word)
                {
                    frames.push(word);
                }
            }
        }
        output.record(&frames);
    }
    output
}

impl SamplerOutput {
    /// Counts one sample's frames, innermost first: each is a function's start where the
    /// function could be found, or else the address itself.
    fn record(&mut self, frames: &[usize]) {
        let Some(&leaf) = frames.first() else {
            return;
        };
        self.samples += 1;
        *self.leaf.entry(leaf).or_default() += 1;
        for (i, &frame) in frames.iter().enumerate() {
            // Recursion counts a function once per sample.
            if frames[..i].contains(&frame) {
                continue;
            }
            *self.inclusive.entry(frame).or_default() += 1;
            if let Some(&caller) = frames.get(i + 1) {
                *self.edges.entry((caller, frame)).or_default() += 1;
            }
        }
    }
}

#[cfg(target_arch = "x86_64")]
#[repr(C)]
struct RuntimeFunction {
    begin: u32,
    end: u32,
    unwind: u32,
}

#[cfg(target_arch = "x86_64")]
unsafe extern "system" {
    fn RtlLookupFunctionEntry(
        pc: u64,
        image_base: *mut u64,
        history: *mut std::ffi::c_void,
    ) -> *mut RuntimeFunction;
    fn RtlVirtualUnwind(
        handler_type: u32,
        image_base: u64,
        pc: u64,
        function: *mut RuntimeFunction,
        context: *mut winapi::um::winnt::CONTEXT,
        handler_data: *mut *mut std::ffi::c_void,
        establisher_frame: *mut u64,
        context_pointers: *mut std::ffi::c_void,
    ) -> *mut std::ffi::c_void;
}

/// Walks a sample's call stack with the images' unwind data, pushing each frame's function start
/// (or its address, for code without unwind data) innermost first. The walk reads the copy of the
/// stack taken while the thread was suspended: every register pointing into the copied part of the
/// stack is moved to point into the copy first.
#[cfg(target_arch = "x86_64")]
unsafe fn unwind(
    context: &mut winapi::um::winnt::CONTEXT,
    sp: usize,
    stack: &[usize],
    words: usize,
    frames: &mut Vec<usize>,
) {
    unsafe {
        let copy = stack.as_ptr() as u64;
        let copied = (words * size_of::<usize>()) as u64;
        let original = sp as u64;
        let translate = |reg: &mut u64| {
            if *reg >= original && *reg < original + copied {
                *reg = *reg - original + copy;
            }
        };
        translate(&mut context.Rsp);
        translate(&mut context.Rbp);
        translate(&mut context.Rbx);
        translate(&mut context.Rsi);
        translate(&mut context.Rdi);
        translate(&mut context.R12);
        translate(&mut context.R13);
        translate(&mut context.R14);
        translate(&mut context.R15);
        while frames.len() < SAMPLE_FRAMES {
            let pc = context.Rip;
            if pc == 0 || context.Rsp < copy || context.Rsp + 8 > copy + copied {
                break;
            }
            let mut image_base = 0u64;
            let function = RtlLookupFunctionEntry(pc, &mut image_base, std::ptr::null_mut());
            if function.is_null() {
                frames.push(pc as usize);
                context.Rip = (context.Rsp as *const u64).read();
                context.Rsp += 8;
            } else {
                frames.push((image_base + (*function).begin as u64) as usize);
                let mut handler_data = std::ptr::null_mut();
                let mut establisher = 0u64;
                RtlVirtualUnwind(
                    0,
                    image_base,
                    pc,
                    function,
                    context,
                    &mut handler_data,
                    &mut establisher,
                    std::ptr::null_mut(),
                );
            }
        }
    }
}

/// Whether the instruction before `address` is a call, as it is for a return address.
#[cfg(target_arch = "x86")]
fn looks_like_return_address(address: usize) -> bool {
    unsafe {
        let before = |n: usize| ((address - n) as *const u8).read();
        // call rel32
        before(5) == 0xe8
            // call r/m: ff /2 with the register and memory forms of various lengths
            || (before(2) == 0xff && before(1) & 0x38 == 0x10)
            || (before(3) == 0xff && before(2) & 0x38 == 0x10)
            || (before(6) == 0xff && before(5) & 0x38 == 0x10)
            || (before(7) == 0xff && before(6) & 0x38 == 0x10)
    }
}

/// Every loaded module's base, size and name.
fn modules() -> Vec<(usize, usize, String)> {
    use winapi::um::handleapi::CloseHandle;
    use winapi::um::tlhelp32::{
        CreateToolhelp32Snapshot, MODULEENTRY32W, Module32FirstW, Module32NextW, TH32CS_SNAPMODULE,
        TH32CS_SNAPMODULE32,
    };
    let mut out = Vec::new();
    unsafe {
        let snapshot = CreateToolhelp32Snapshot(TH32CS_SNAPMODULE | TH32CS_SNAPMODULE32, 0);
        if snapshot.is_null() || snapshot == winapi::um::handleapi::INVALID_HANDLE_VALUE {
            return out;
        }
        let mut entry: MODULEENTRY32W = std::mem::zeroed();
        entry.dwSize = size_of::<MODULEENTRY32W>() as u32;
        let mut ok = Module32FirstW(snapshot, &mut entry) != 0;
        while ok {
            let len = entry.szModule.iter().position(|&c| c == 0).unwrap_or(0);
            out.push((
                entry.modBaseAddr as usize,
                entry.modBaseSize as usize,
                String::from_utf16_lossy(&entry.szModule[..len]),
            ));
            ok = Module32NextW(snapshot, &mut entry) != 0;
        }
        CloseHandle(snapshot);
    }
    out
}
