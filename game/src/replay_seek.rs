//! Seeking in a replay by keyframe.
//!
//! SC:R seeks a replay by simulating up to the target frame: forward from where the replay is, or,
//! for a target behind it, from the very start, after restarting the whole game. As a replay plays,
//! this keeps a compressed copy of the simulation (a keyframe) every [`KEYFRAME_SPACING`] frames,
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
//! A game whose build doesn't give the analysis this needs leaves seeking to SC:R.

use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};
use std::time::{Duration, Instant};

use parking_lot::Mutex;

use crate::bw::Bw;
use crate::bw::apm_stats::ApmStats;
use crate::bw_scr::BwScr;
use crate::game_thread;
use crate::rollback::snapshot::{SnapshotExtras, Snapshots};
use crate::rollback::tick::with_ui_images_off;

/// Frames between keyframes (20 seconds of game time). A seek simulates at most this many frames
/// past the keyframe it restores, which takes up to about a quarter of a second late in a large
/// team game.
const KEYFRAME_SPACING: u32 = 480;

/// zstd's fastest level: the ones above it barely shrink a keyframe and take longer.
const COMPRESSION_LEVEL: i32 = 1;

/// Compressed keyframe bytes one replay may keep. Past this, no more keyframes are taken, and
/// seeks into the rest of the replay simulate from the newest one before them.
const MAX_KEYFRAME_BYTES: usize = 256 * 1024 * 1024;

/// How long one call of `step_game_logic` may spend fast-forwarding before the game loop gets to
/// draw a frame and handle input again.
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
    /// Sorted by frame.
    keyframes: Vec<Keyframe>,
    keyframe_bytes: usize,
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

impl Seeker {
    const fn new() -> Seeker {
        Seeker {
            layout: None,
            keyframes: Vec::new(),
            keyframe_bytes: 0,
            target: None,
            started: None,
            unavailable: false,
        }
    }

    /// Takes a keyframe of the simulation at frame count `frame` if none has been taken in its
    /// stretch of [`KEYFRAME_SPACING`] frames yet.
    unsafe fn keyframe_if_due(&mut self, bw: &BwScr, frame: u32) {
        unsafe {
            let stretch = frame / KEYFRAME_SPACING;
            let index = self.keyframes.partition_point(|x| x.frame < frame);
            let taken = |x: &Keyframe| x.frame / KEYFRAME_SPACING == stretch;
            if index
                .checked_sub(1)
                .is_some_and(|i| taken(&self.keyframes[i]))
                || self.keyframes.get(index).is_some_and(taken)
                || self.keyframe_bytes >= MAX_KEYFRAME_BYTES
            {
                return;
            }
            let Some(layout) = &mut self.layout else {
                return;
            };
            with_ui_images_off(bw, || layout.take(frame));
            let (Some(bytes), Some(extras)) = (layout.bytes_of(frame), layout.extras_of(frame))
            else {
                return;
            };
            let data = match zstd::bulk::compress(bytes, COMPRESSION_LEVEL) {
                Ok(data) => data.into_boxed_slice(),
                Err(e) => {
                    error!("Couldn't compress the replay keyframe at frame {frame}: {e}");
                    return;
                }
            };
            layout.forget_all();
            self.keyframe_bytes += data.len();
            if self.keyframe_bytes >= MAX_KEYFRAME_BYTES {
                warn!("Replay keyframes reached {MAX_KEYFRAME_BYTES} bytes; taking no more");
            }
            self.keyframes.insert(
                index,
                Keyframe {
                    frame,
                    data,
                    extras,
                    apm: bw.apm_stats(),
                },
            );
        }
    }

    /// Starts a seek from frame count `frame` to `target`, restoring a keyframe first when one is
    /// closer to the target than `frame` is.
    unsafe fn start_seek(&mut self, bw: &BwScr, frame: u32, target: u32) {
        unsafe {
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
            self.started = Some(Instant::now());
        }
    }

    unsafe fn restore(&mut self, bw: &BwScr, index: usize) -> std::io::Result<()> {
        unsafe {
            let layout = self.layout.as_mut().expect("keyframes need the layout");
            let keyframe = &mut self.keyframes[index];
            let frame = keyframe.frame;
            layout.load(frame, keyframe.extras.clone(), |bytes| {
                let len = zstd::bulk::decompress_to_buffer(&keyframe.data, bytes)?;
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
        if !game_thread::is_replay() {
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
                seeker.layout = Snapshots::build(bw);
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
            let stretch_end = (frame / KEYFRAME_SPACING + 1) * KEYFRAME_SPACING;
            bw.set_replay_seek_frame(stretch_end.min(target));
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
