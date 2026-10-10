//! Plays a replay through to its end as fast as the game loop will go and then exits, so a script
//! can run the rollback harness and the rollback probe over many replays back to back and compare
//! their per-frame fingerprint files.
//!
//! Armed by `SB_ROLLBACK_SOAK=<path>`. Every logic step leaves the tick the game loop paces itself
//! against where it was before the step, so the loop runs a step on every pass while still drawing
//! between them, which keeps the render-side state the rollback engine has to work around
//! exercised the way it is in play. Once the replay stops advancing, the path gets a JSON object
//! naming the final frame and the fingerprint files written, and the process exits. A run that
//! never writes the file crashed or hung.
//!
//! `SB_ROLLBACK_SOAK_UNTIL=<frame>` ends the run once the simulation reaches that frame instead, for
//! reproducing a divergence in a long replay without playing out the rest of it.
//!
//! Compiled out of release DLLs along with the harness and the probe it drives.

use std::fs::File;
use std::io::Write;
use std::path::PathBuf;
use std::sync::OnceLock;
use std::sync::atomic::{AtomicU32, Ordering};

use serde_json::json;

use crate::bw_scr::BwScr;
use crate::game_thread;

const ENV_VAR: &str = "SB_ROLLBACK_SOAK";
const UNTIL_ENV_VAR: &str = "SB_ROLLBACK_SOAK_UNTIL";

/// Consecutive logic steps that leave the frame count where it was before the replay counts as
/// ended. One would do for BW's own end of playback; a few keep a single odd step from ending the
/// run early.
const STALLED_STEPS_TO_END: u32 = 8;

static DONE_PATH: OnceLock<PathBuf> = OnceLock::new();
static STALLED_STEPS: AtomicU32 = AtomicU32::new(0);
/// The frame [`UNTIL_ENV_VAR`] ends the run at, or `u32::MAX` to play the replay out.
static UNTIL_FRAME: AtomicU32 = AtomicU32::new(u32::MAX);

pub fn init_from_env() {
    let Ok(path) = std::env::var(ENV_VAR) else {
        return;
    };
    if path.is_empty() {
        error!("{ENV_VAR} is empty; it needs the path to write the run's result to");
        return;
    }
    info!("{ENV_VAR} armed: playing unpaced, result goes to {path}");
    if let Ok(spec) = std::env::var(UNTIL_ENV_VAR) {
        match spec.parse::<u32>() {
            Ok(frame) => {
                info!("{UNTIL_ENV_VAR}: ending the run at frame {frame}");
                UNTIL_FRAME.store(frame, Ordering::Relaxed);
            }
            Err(_) => error!("{UNTIL_ENV_VAR}={spec:?} is not a frame; ignoring it"),
        }
    }
    let _ = DONE_PATH.set(PathBuf::from(path));
}

/// Runs one logic step through `step`, unpaced when armed, and ends the process once the replay
/// has stopped advancing.
pub unsafe fn run_game_logic_step(bw: &'static BwScr, step: impl FnOnce() -> usize) -> usize {
    unsafe {
        let Some(done_path) = DONE_PATH.get().filter(|_| game_thread::is_replay()) else {
            return step();
        };
        let due_tick = bw.rollback_next_game_step_tick();
        let before = bw.rollback_frame_count();
        let ret = step();
        bw.rollback_set_next_game_step_tick(due_tick);
        let after = bw.rollback_frame_count();
        if let Some(frame) = after
            && frame >= UNTIL_FRAME.load(Ordering::Relaxed)
        {
            finish(done_path, frame);
        }
        if after.is_some() && after == before {
            if STALLED_STEPS.fetch_add(1, Ordering::Relaxed) + 1 >= STALLED_STEPS_TO_END {
                finish(done_path, after.unwrap_or(0));
            }
        } else {
            STALLED_STEPS.store(0, Ordering::Relaxed);
        }
        ret
    }
}

/// Notes that the replay just seeked, which moves it on however long it had been stalled at its end
/// before the seek.
pub fn note_seek() {
    STALLED_STEPS.store(0, Ordering::Relaxed);
}

fn finish(done_path: &PathBuf, frame: u32) -> ! {
    let result = json!({
        "frame": frame,
        "harness_csv": crate::rollback_harness::log_path(),
        "probe_csv": crate::rollback_probe::status().path,
    });
    // Written aside and renamed into place, so the script never reads a partial file.
    let partial = done_path.with_extension("partial");
    let written = File::create(&partial)
        .and_then(|mut file| file.write_all(result.to_string().as_bytes()))
        .and_then(|()| std::fs::rename(&partial, done_path));
    match written {
        Ok(()) => info!("{ENV_VAR}: replay ended at frame {frame}, exiting"),
        Err(e) => error!("{ENV_VAR}: could not write {}: {e}", done_path.display()),
    }
    unsafe {
        winapi::um::processthreadsapi::TerminateProcess(
            winapi::um::processthreadsapi::GetCurrentProcess(),
            0,
        );
    }
    std::process::exit(0)
}
