//! Seeking in a replay by keyframe.
//!
//! SC:R seeks a replay by simulating up to the target frame: forward from where the replay is, or,
//! for a target behind it, from the very start, after restarting the whole game. As a replay plays,
//! this keeps a compressed copy of the simulation (a keyframe) every [`KEYFRAME_SPACING`] frames,
//! widening that spacing when the cache fills,
//! taken with the rollback engine's snapshot layout, and handles every seek the replay UI asks for
//! itself: it restores the newest keyframe at or before the target when that is closer than where
//! the replay is, and has BW's own fast-forward simulate the rest. A seek forward past every
//! keyframe still simulates all the way there, keeping keyframes as it goes, so a later seek back
//! over that stretch is quick.
//!
//! Keyframes live in memory for as long as the replay is open; nothing about them is written to
//! the replay file. A compressed keyframe of a large team game is about 300 KB.
//!
//! A seek made once the replay has played to its end is left to SC:R: playback stops reading the
//! replay's commands there, in state no keyframe holds, and SC:R's seek starts the game over, which
//! leaves that state behind. Whenever SC:R fast-forwards on its own, as it does after starting over,
//! the fast-forward is taken over here so that it keeps keyframes too.
//!
//! Use Map Settings replays, and builds without the analysis this needs, leave seeking to SC:R.
//! UMS triggers can change state outside the snapshot, including EUD memory.

use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};
use std::time::{Duration, Instant};

use parking_lot::Mutex;

use crate::bw::Bw;
use crate::bw::apm_stats::ApmStats;
use crate::bw_scr::BwScr;
use crate::game_thread;
use crate::rollback::snapshot::{SnapshotExtras, Snapshots};
use crate::rollback::tick::with_ui_images_off;

/// Initial frames between keyframes (20 seconds of game time). Cache pressure doubles the spacing
/// and thins existing keyframes, keeping the first and latest so the whole replay stays reachable.
const KEYFRAME_SPACING: u32 = 480;

/// zstd's fastest level: the ones above it barely shrink a keyframe and take longer.
const COMPRESSION_LEVEL: i32 = 1;

/// Retained keyframe allocations, including trigger lists, APM statistics and vector capacity.
const MAX_KEYFRAME_BYTES: usize = 32 * 1024 * 1024;

/// Bounds the raw slot and compressor scratch separately from the retained cache. A capture also
/// temporarily owns its compressed output before cache eviction. Larger layouts use native seeking.
const MAX_SNAPSHOT_BYTES: usize = 8 * 1024 * 1024;

/// Non-UMS trigger lists are small, but are still copied during capture and restore. Do not retain
/// a layout with unexpectedly large extras alongside the raw buffers.
const MAX_EXTRA_BYTES: usize = 512 * 1024;

/// Simulation batches are independent of keyframe spacing so expensive stretches can yield before
/// reaching the next keyframe. A single native batch and capture can still overrun the time budget.
const FAST_FORWARD_BATCH: u32 = 24;

/// Time budget checked after each native simulation batch, before the game loop draws and handles
/// input again. Snapshot capture and restoration are synchronous.
const FAST_FORWARD_BUDGET: Duration = Duration::from_millis(100);

/// [`REQUESTED`] with no seek waiting.
const NO_REQUEST: u32 = u32::MAX;

/// Whether seeks in the replay being played are handled here rather than by SC:R. Only true once
/// the first keyframe has been taken.
static ACTIVE: AtomicBool = AtomicBool::new(false);

/// Whether this replay has restored a keyframe since its game init, so state outside the snapshot
/// (the observer UI's records) may describe a different point of the replay than the simulation.
static RESTORED: AtomicBool = AtomicBool::new(false);

/// The frame the replay UI most recently asked to seek to, or [`NO_REQUEST`]. A separate atomic
/// from [`SEEKER`], since the command carrying it arrives in the middle of BW's logic step, which
/// fast-forwarding calls with the seeker in use.
static REQUESTED: AtomicU32 = AtomicU32::new(NO_REQUEST);

static SEEKER: Mutex<Seeker> = Mutex::new(Seeker::new());

struct Seeker {
    /// The snapshot layout, found once a game's state exists, with at most one slot in use: the
    /// keyframe being taken or restored.
    layout: Option<Snapshots>,
    codec: Option<Codec>,
    /// Sorted by frame.
    keyframes: Vec<Keyframe>,
    keyframe_bytes: usize,
    spacing: u32,
    /// The frame a seek in progress is fast-forwarding to.
    target: Option<u32>,
    /// When the seek in progress started, for logging how long it took.
    started: Option<Instant>,
    /// Whether this game can't seek by keyframe, so it leaves seeking to SC:R.
    unavailable: bool,
}

struct Keyframe {
    frame: u32,
    /// The snapshot's bytes, compressed.
    data: Box<[u8]>,
    extras: SnapshotExtras,
    apm: Option<ApmStats>,
}

impl Keyframe {
    fn heap_bytes(&self) -> usize {
        self.data.len()
            + self.extras.heap_bytes()
            + self.apm.as_ref().map_or(0, ApmStats::heap_bytes)
    }
}

/// Compression state and worst-case output storage reused across captures and restores.
struct Codec {
    compressor: zstd::bulk::Compressor<'static>,
    decompressor: zstd::bulk::Decompressor<'static>,
    scratch: Vec<u8>,
}

impl Codec {
    fn new(bytes: usize) -> std::io::Result<Self> {
        Ok(Self {
            compressor: zstd::bulk::Compressor::new(COMPRESSION_LEVEL)?,
            decompressor: zstd::bulk::Decompressor::new()?,
            scratch: vec![0; zstd::zstd_safe::compress_bound(bytes)],
        })
    }

    fn compress(&mut self, bytes: &[u8]) -> std::io::Result<Box<[u8]>> {
        let len = self
            .compressor
            .compress_to_buffer(bytes, &mut self.scratch[..])?;
        Ok(self.scratch[..len].into())
    }
}

impl Seeker {
    const fn new() -> Seeker {
        Seeker {
            layout: None,
            codec: None,
            keyframes: Vec::new(),
            keyframe_bytes: 0,
            spacing: KEYFRAME_SPACING,
            target: None,
            started: None,
            unavailable: false,
        }
    }

    /// Takes a keyframe of the simulation at frame count `frame` if none has been taken in its
    /// stretch of the current cache spacing yet.
    unsafe fn keyframe_if_due(&mut self, bw: &BwScr, frame: u32) {
        unsafe {
            let stretch = frame / self.spacing;
            let index = self.keyframes.partition_point(|x| x.frame < frame);
            let taken = |x: &Keyframe| x.frame / self.spacing == stretch;
            if index
                .checked_sub(1)
                .is_some_and(|i| taken(&self.keyframes[i]))
                || self.keyframes.get(index).is_some_and(taken)
            {
                return;
            }
            let Some(layout) = &mut self.layout else {
                return;
            };
            let started = Instant::now();
            with_ui_images_off(bw, || layout.take(frame));
            let (Some(bytes), Some(extras)) = (layout.bytes_of(frame), layout.extras_of(frame))
            else {
                return;
            };
            if extras.heap_bytes() > MAX_EXTRA_BYTES {
                warn!(
                    "Leaving replay seeking to SC:R: snapshot extras exceed {MAX_EXTRA_BYTES} bytes"
                );
                self.disable();
                return;
            }
            let compressed = self
                .codec
                .as_mut()
                .expect("snapshots need a codec")
                .compress(bytes);
            layout.forget_all();
            let data = match compressed {
                Ok(data) => data,
                Err(e) => {
                    error!("Couldn't compress the replay keyframe at frame {frame}: {e}");
                    return;
                }
            };
            self.insert_keyframe(
                Keyframe {
                    frame,
                    data,
                    extras,
                    apm: bw.apm_stats(),
                },
                MAX_KEYFRAME_BYTES,
            );
            debug!(
                "Replay keyframe capture at {frame}: {:?}, {} retained bytes, spacing {}",
                started.elapsed(),
                self.keyframe_bytes,
                self.spacing
            );
        }
    }

    /// Keeps the first keyframe in each increasingly wide frame bucket, plus the latest keyframe.
    /// Both ends stay available while later parts of a long replay keep acquiring keyframes.
    fn insert_keyframe(&mut self, keyframe: Keyframe, budget: usize) {
        let frame = keyframe.frame;
        let heap_bytes = keyframe.heap_bytes();
        let first_bytes = self.keyframes.first().map_or(0, Keyframe::heap_bytes);
        if heap_bytes + first_bytes + 2 * size_of::<Keyframe>() > budget {
            return;
        }
        let index = self.keyframes.partition_point(|x| x.frame < frame);
        self.keyframes.insert(index, keyframe);
        self.update_keyframe_bytes();
        while self.keyframe_bytes > budget && self.keyframes.len() > 2 {
            self.spacing = self.spacing.saturating_mul(2);
            let last = self.keyframes.last().unwrap().frame;
            let mut previous_bucket = None;
            self.keyframes.retain(|keyframe| {
                let bucket = keyframe.frame / self.spacing;
                let keep = previous_bucket != Some(bucket) || keyframe.frame == last;
                previous_bucket = Some(bucket);
                keep
            });
            self.keyframes.shrink_to_fit();
            self.update_keyframe_bytes();
        }
        if self.keyframe_bytes > budget {
            self.keyframes.shrink_to_fit();
            self.update_keyframe_bytes();
        }
        // A keyframe inserted between existing ones can be larger than the latest one. If the
        // retained endpoints still do not fit, keep the existing cache and drop that capture.
        if self.keyframe_bytes > budget {
            if let Ok(index) = self.keyframes.binary_search_by_key(&frame, |x| x.frame) {
                self.keyframes.remove(index);
            }
            self.update_keyframe_bytes();
        }
    }

    fn update_keyframe_bytes(&mut self) {
        self.keyframe_bytes = self.keyframes.capacity() * size_of::<Keyframe>()
            + self
                .keyframes
                .iter()
                .map(Keyframe::heap_bytes)
                .sum::<usize>();
    }

    fn disable(&mut self) {
        *self = Self::new();
        self.unavailable = true;
        ACTIVE.store(false, Ordering::Relaxed);
    }

    /// Starts a seek from frame count `frame` to `target`, restoring a keyframe first when one is
    /// closer to the target than `frame` is.
    unsafe fn start_seek(&mut self, bw: &BwScr, frame: u32, target: u32) {
        unsafe {
            let started = Instant::now();
            // Seeking to the replay's last frame or past it would end the replay.
            let header = bw.replay_header();
            let target = match header.is_null() {
                true => target,
                false => target.min((*header).replay_end_frame.saturating_sub(1)),
            };
            let index = self.keyframes.partition_point(|x| x.frame <= target);
            let restored = match index.checked_sub(1) {
                Some(i) if target < frame || self.keyframes[i].frame > frame => {
                    match self.restore(bw, i) {
                        Ok(()) => Some(self.keyframes[i].frame),
                        Err(e) => {
                            error!(
                                "Couldn't restore the replay keyframe at frame {}: {e}",
                                self.keyframes[i].frame
                            );
                            None
                        }
                    }
                }
                _ => None,
            };
            info!("Seeking replay from frame {frame} to {target}, restoring keyframe {restored:?}");
            if restored.is_none() && target < frame {
                // There is no keyframe to go back to, which only happens when one couldn't be
                // restored: the replay stays where it is.
                return;
            }
            self.target = Some(target);
            self.started = Some(started);
        }
    }

    unsafe fn restore(&mut self, bw: &BwScr, index: usize) -> std::io::Result<()> {
        unsafe {
            let layout = self.layout.as_mut().expect("keyframes need the layout");
            let keyframe = &mut self.keyframes[index];
            let frame = keyframe.frame;
            let codec = self.codec.as_mut().expect("snapshots need a codec");
            layout.load(frame, keyframe.extras.clone(), |bytes| {
                let len = codec
                    .decompressor
                    .decompress_to_buffer(&keyframe.data, bytes)?;
                match len == bytes.len() {
                    true => Ok(()),
                    false => Err(std::io::Error::other("keyframe has the wrong length")),
                }
            })?;
            // The selection and the power fields being shown are the person's, not the
            // simulation's, so they stay as they were wherever they still can.
            let selection = bw.rollback_local_selection();
            let pylon_auras_shown = bw.rollback_pylon_auras_shown();
            RESTORED.store(true, Ordering::Relaxed);
            crate::rollback::observer_ui::reset_for_replay_seek();
            with_ui_images_off(bw, || layout.restore_at_or_before(frame, bw));
            bw.rollback_set_pylon_auras_shown(pylon_auras_shown);
            bw.rollback_settle_local_selection(&selection);
            // Restoring a trigger list that had been freed since the keyframe allocates its nodes
            // anew, and the keyframe has to name the new ones for the next time it is restored.
            if let Some(extras) = layout.extras_of(frame) {
                keyframe.extras = extras;
            }
            layout.forget_all();
            if let Some(apm) = &keyframe.apm {
                bw.set_apm_stats(apm.clone());
            }
            self.update_keyframe_bytes();
            Ok(())
        }
    }
}

/// Clears everything kept for the previous game, whose addresses the next game init finds again.
pub fn reset_for_game_init() {
    ACTIVE.store(false, Ordering::Relaxed);
    RESTORED.store(false, Ordering::Relaxed);
    REQUESTED.store(NO_REQUEST, Ordering::Relaxed);
    *SEEKER.lock() = Seeker::new();
}

/// Whether seeks in the replay being played are handled here.
pub fn active() -> bool {
    ACTIVE.load(Ordering::Relaxed)
}

/// Whether the replay has restored a keyframe since its game init.
pub fn has_restored() -> bool {
    RESTORED.load(Ordering::Relaxed)
}

/// Called with the target of a seek command the replay UI sent. Returns whether the seek is handled
/// here, in which case the command must not reach BW.
pub fn take_seek_request(bw: &BwScr, target: u32) -> bool {
    if !ACTIVE.load(Ordering::Relaxed) || unsafe { replay_ended(bw) } {
        return false;
    }
    REQUESTED.store(target, Ordering::Relaxed);
    true
}

/// Runs `step_game_logic` for a replay that seeks by keyframe: takes a keyframe when one is due,
/// starts a seek the UI asked for, and fast-forwards a seek in progress. Returns `None` when the
/// step is an ordinary one, for the caller to run.
pub unsafe fn run_game_logic_step(
    bw: &BwScr,
    param: usize,
    orig: unsafe extern "C" fn(usize) -> usize,
) -> Option<usize> {
    unsafe {
        if !game_thread::is_replay() || game_thread::is_ums() {
            return None;
        }
        let frame = bw.rollback_frame_count()?;
        {
            let mut seeker = SEEKER.lock();
            if seeker.unavailable {
                return None;
            }
            // The rollback harness and bench restore the replay's simulation themselves.
            #[cfg(debug_assertions)]
            if crate::rollback_harness::armed() || crate::rollback_bench::armed() {
                return None;
            }
            if seeker.layout.is_none() {
                if let Some(missing) = bw
                    .rollback_missing_analysis()
                    .or_else(|| (!bw.can_set_replay_seek_frame()).then_some("replay_seek_frame"))
                {
                    info!("Leaving replay seeking to SC:R: analysis did not find {missing}");
                    seeker.unavailable = true;
                    return None;
                }
                if let Some(layout) = Snapshots::build(bw) {
                    if layout.byte_len() > MAX_SNAPSHOT_BYTES {
                        info!(
                            "Leaving replay seeking to SC:R: snapshot needs {} bytes",
                            layout.byte_len()
                        );
                        seeker.disable();
                        return None;
                    }
                    match Codec::new(layout.byte_len()) {
                        Ok(codec) => {
                            info!(
                                "Replay seeking buffers: {} raw bytes, {} compression scratch bytes, {MAX_KEYFRAME_BYTES} cache budget",
                                layout.byte_len(),
                                codec.scratch.len()
                            );
                            seeker.codec = Some(codec);
                            seeker.layout = Some(layout);
                        }
                        Err(e) => {
                            error!(
                                "Leaving replay seeking to SC:R: could not initialize compression: {e}"
                            );
                            seeker.disable();
                            return None;
                        }
                    }
                }
            }
            seeker.layout.as_ref()?;
            seeker.keyframe_if_due(bw, frame);
            if !seeker.keyframes.is_empty() {
                ACTIVE.store(true, Ordering::Relaxed);
            }
            #[cfg(debug_assertions)]
            run_script(bw, frame);
            let requested = REQUESTED.swap(NO_REQUEST, Ordering::Relaxed);
            if requested != NO_REQUEST {
                #[cfg(debug_assertions)]
                SCRIPT_AWAITING.store(false, Ordering::Relaxed);
                seeker.start_seek(bw, frame, requested);
            }
            let native_target = bw.replay_seek_frame();
            if seeker.target.is_none() && native_target > frame {
                // A seek the script sent can be SC:R's to make.
                #[cfg(debug_assertions)]
                SCRIPT_AWAITING.store(false, Ordering::Relaxed);
                info!("Taking over SC:R's fast-forward from frame {frame} to {native_target}");
                seeker.target = Some(native_target);
                seeker.started = Some(Instant::now());
            }
            seeker.target?;
        }
        Some(fast_forward(bw, param, orig))
    }
}

/// Has BW's own fast-forward simulate toward the target of the seek in progress, a stretch between
/// keyframes at a time so they are kept as it goes, until it gets there or the time budget for this
/// call runs out.
unsafe fn fast_forward(
    bw: &BwScr,
    param: usize,
    orig: unsafe extern "C" fn(usize) -> usize,
) -> usize {
    unsafe {
        // Every frame simulated pushes the tick the game loop paces itself against a frame further
        // on, so it goes back to where it was once this call is done, and the loop calls again
        // right after drawing.
        let paced_tick = bw.rollback_next_game_step_tick();
        let deadline = Instant::now() + FAST_FORWARD_BUDGET;
        let mut ret = 0;
        while let Some(frame) = bw.rollback_frame_count() {
            let target = SEEKER.lock().target;
            let Some(target) = target else {
                break;
            };
            if frame >= target || REQUESTED.load(Ordering::Relaxed) != NO_REQUEST {
                finish_seek(bw, frame);
                break;
            }
            let spacing = SEEKER.lock().spacing;
            bw.set_replay_seek_frame(batch_end(frame, target, spacing));
            ret = orig(param);
            let after = bw.rollback_frame_count().unwrap_or(frame);
            if after <= frame {
                // The replay has ended, or BW won't simulate right now.
                warn!("Replay seek to {target} stopped at frame {after}");
                finish_seek(bw, after);
                break;
            }
            SEEKER.lock().keyframe_if_due(bw, after);
            if Instant::now() >= deadline {
                break;
            }
        }
        bw.rollback_set_next_game_step_tick(paced_tick);
        ret
    }
}

fn batch_end(frame: u32, target: u32, spacing: u32) -> u32 {
    let stretch_end = frame.saturating_add(spacing - frame % spacing);
    target
        .min(stretch_end)
        .min(frame.saturating_add(FAST_FORWARD_BATCH))
}

/// Whether the replay has played to its end.
unsafe fn replay_ended(bw: &BwScr) -> bool {
    unsafe {
        let header = bw.replay_header();
        !header.is_null()
            && bw
                .rollback_frame_count()
                .is_some_and(|frame| frame >= (*header).replay_end_frame)
    }
}

/// Ends the seek in progress at frame count `frame`.
unsafe fn finish_seek(bw: &BwScr, frame: u32) {
    // BW's own fast-forward stops where this one did, rather than carrying on toward a stretch's
    // end, or toward a target the replay couldn't reach.
    unsafe { bw.set_replay_seek_frame(frame) };
    #[cfg(debug_assertions)]
    crate::rollback_soak::note_seek();
    let mut seeker = SEEKER.lock();
    if let Some(target) = seeker.target.take() {
        let elapsed = seeker
            .started
            .take()
            .map(|x| x.elapsed())
            .unwrap_or_default();
        info!(
            "Replay seek to {target} reached frame {frame} in {elapsed:?}, with {} keyframes kept \
             ({} bytes)",
            seeker.keyframes.len(),
            seeker.keyframe_bytes,
        );
    }
}

/// Environment variable holding seeks to make as a replay plays, for checking that seeking
/// reproduces plain playback: `SB_REPLAY_SEEK_SCRIPT=12000:3000,20000:30000` seeks to frame 3000 once
/// the replay reaches frame 12000, and then to frame 30000 once it reaches frame 20000 again. Each
/// seek is sent as the replay UI's own seek command. `12000:3000:paused` pauses the replay first,
/// and resumes it [`SCRIPT_RESUME_STEPS`] logic steps later.
#[cfg(debug_assertions)]
const SCRIPT_ENV_VAR: &str = "SB_REPLAY_SEEK_SCRIPT";

#[cfg(debug_assertions)]
static SCRIPT: std::sync::OnceLock<Vec<(u32, u32, bool)>> = std::sync::OnceLock::new();

/// Logic steps a seek the script made while paused waits before resuming playback. Fewer than the
/// rollback soak's steps without progress that end its run.
#[cfg(debug_assertions)]
const SCRIPT_RESUME_STEPS: u32 = 4;

/// Logic steps left until the script resumes playback it paused, or 0.
#[cfg(debug_assertions)]
static SCRIPT_RESUME_IN: AtomicU32 = AtomicU32::new(0);

/// Whether the script has sent a seek command that hasn't arrived yet. The command goes through
/// the replay's command queue, so the replay may still be past the next seek's frame until it does.
#[cfg(debug_assertions)]
static SCRIPT_AWAITING: AtomicBool = AtomicBool::new(false);

/// How many of [`SCRIPT`]'s seeks have been made. The script's state lasts across the game
/// starting over for a seek, which is part of the same playback.
#[cfg(debug_assertions)]
static SCRIPT_POSITION: AtomicU32 = AtomicU32::new(0);

#[cfg(debug_assertions)]
pub fn init_from_env() {
    let Ok(spec) = std::env::var(SCRIPT_ENV_VAR) else {
        return;
    };
    let script = spec
        .split(',')
        .map(|x| {
            let mut parts = x.split(':').map(|x| x.trim());
            let at = parts.next()?.parse().ok()?;
            let to = parts.next()?.parse().ok()?;
            let paused = match parts.next() {
                None => false,
                Some("paused") => true,
                Some(_) => return None,
            };
            Some((at, to, paused))
        })
        .collect::<Option<Vec<(u32, u32, bool)>>>();
    match script {
        Some(script) => {
            info!("{SCRIPT_ENV_VAR}: seeking {script:?}");
            let _ = SCRIPT.set(script);
        }
        None => error!(
            "{SCRIPT_ENV_VAR}={spec:?} is not a list of <at>:<to>[:paused] seeks; ignoring it"
        ),
    }
}

/// Sends the script's next seek once the replay has reached its frame.
#[cfg(debug_assertions)]
unsafe fn run_script(bw: &BwScr, frame: u32) {
    let Some(script) = SCRIPT.get() else {
        return;
    };
    if SCRIPT_AWAITING.load(Ordering::Relaxed) {
        return;
    }
    let resume_in = SCRIPT_RESUME_IN.load(Ordering::Relaxed);
    if resume_in != 0 {
        SCRIPT_RESUME_IN.store(resume_in - 1, Ordering::Relaxed);
        if resume_in == 1 {
            unsafe { bw.send_replay_pause(false) };
        }
        return;
    }
    let position = SCRIPT_POSITION.load(Ordering::Relaxed) as usize;
    if let Some(&(at, to, paused)) = script.get(position)
        && frame >= at
    {
        SCRIPT_POSITION.store(position as u32 + 1, Ordering::Relaxed);
        if paused {
            unsafe { bw.send_replay_pause(true) };
            SCRIPT_RESUME_IN.store(SCRIPT_RESUME_STEPS, Ordering::Relaxed);
        }
        SCRIPT_AWAITING.store(true, Ordering::Relaxed);
        unsafe { bw.send_replay_seek(to) };
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn keyframe(frame: u32, bytes: usize) -> Keyframe {
        Keyframe {
            frame,
            data: vec![0; bytes].into_boxed_slice(),
            extras: SnapshotExtras::default(),
            apm: None,
        }
    }

    #[test]
    fn long_replay_cache_keeps_both_ends_under_budget() {
        let mut seeker = Seeker::new();
        let budget = 12 * (size_of::<Keyframe>() + 1024);
        for i in 0..1000 {
            let frame = i * KEYFRAME_SPACING;
            // Variable sizes exercise budget enforcement across multiple thinning passes.
            seeker.insert_keyframe(keyframe(frame, 256 + i as usize % 5 * 256), budget);
            assert!(seeker.keyframe_bytes <= budget);
            assert_eq!(seeker.keyframes.first().unwrap().frame, 0);
            assert_eq!(seeker.keyframes.last().unwrap().frame, frame);
            assert!(
                seeker
                    .keyframes
                    .windows(2)
                    .all(|pair| pair[0].frame < pair[1].frame)
            );
        }
        assert!(seeker.spacing > KEYFRAME_SPACING);
        assert!(
            seeker
                .keyframes
                .iter()
                .any(|x| x.frame > 500 * KEYFRAME_SPACING)
        );
    }

    #[test]
    fn filling_earlier_gaps_preserves_later_keyframes() {
        let mut seeker = Seeker::new();
        let budget = 8 * (size_of::<Keyframe>() + 1024);
        seeker.insert_keyframe(keyframe(0, 1024), budget);
        seeker.insert_keyframe(keyframe(100_000, 1024), budget);
        for frame in (1..100).rev().map(|i| i * KEYFRAME_SPACING) {
            seeker.insert_keyframe(keyframe(frame, 1024), budget);
            assert!(seeker.keyframe_bytes <= budget);
            assert_eq!(seeker.keyframes.first().unwrap().frame, 0);
            assert_eq!(seeker.keyframes.last().unwrap().frame, 100_000);
        }
    }

    #[test]
    fn oversize_capture_does_not_displace_the_restart_keyframe() {
        let mut seeker = Seeker::new();
        let budget = 4 * (size_of::<Keyframe>() + 1024);
        seeker.insert_keyframe(keyframe(0, 1024), budget);
        seeker.insert_keyframe(keyframe(480, budget), budget);
        assert_eq!(seeker.keyframes.len(), 1);
        assert_eq!(seeker.keyframes[0].frame, 0);
        assert!(seeker.keyframe_bytes <= budget);
    }

    #[test]
    fn cache_accounts_for_apm_allocations_and_unused_vector_capacity() {
        let mut seeker = Seeker::new();
        let mut frame = keyframe(0, 1024);
        let mut apm = ApmStats::new();
        for player in 0..8 {
            for step in 0..64 {
                apm.counted_turn(player, step);
            }
        }
        let apm_bytes = apm.heap_bytes();
        assert!(apm_bytes >= 8 * 64 * size_of::<u32>());
        frame.apm = Some(apm);
        seeker.insert_keyframe(frame, MAX_KEYFRAME_BYTES);
        assert_eq!(
            seeker.keyframe_bytes,
            seeker.keyframes.capacity() * size_of::<Keyframe>() + 1024 + apm_bytes
        );
    }

    #[test]
    fn batches_stop_at_targets_and_keyframe_boundaries() {
        assert_eq!(batch_end(0, 10_000, 480), 24);
        assert_eq!(batch_end(470, 10_000, 480), 480);
        assert_eq!(batch_end(480, 10_000, 480), 504);
        assert_eq!(batch_end(500, 510, 480), 510);
        assert_eq!(batch_end(500, 10_000, 3840), 524);
        assert_eq!(batch_end(u32::MAX - 5, u32::MAX, 480), u32::MAX);
    }

    #[test]
    fn codec_reuses_scratch_and_round_trips_distinct_snapshots() {
        let mut codec = Codec::new(64 * 1024).unwrap();
        let scratch = codec.scratch.as_ptr();
        let first = vec![7; 64 * 1024];
        let second: Vec<_> = (0..64 * 1024).map(|i| (i % 251) as u8).collect();
        let compressed_first = codec.compress(&first).unwrap();
        let compressed_second = codec.compress(&second).unwrap();
        let mut restored = vec![0; first.len()];
        for (compressed, expected) in [(compressed_first, first), (compressed_second, second)] {
            let len = codec
                .decompressor
                .decompress_to_buffer(&compressed, &mut restored[..])
                .unwrap();
            assert_eq!(len, expected.len());
            assert_eq!(restored, expected);
        }
        assert_eq!(codec.scratch.as_ptr(), scratch);
    }
}
