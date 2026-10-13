//! Local playback of a replay watched in a replay session.
//!
//! Every viewer in a session plays the same replay locally, and the session (through the app)
//! decides when that playback runs. A session replay holds itself paused at its first frame and
//! tells the app it is ready; it starts playing once the session says every viewer is ready.
//!
//! Pausing and resuming go through the replay UI's own speed command, which carries the speed
//! alongside the pause flag. Every speed command the replay processes is noted here, so the ones
//! sent from here keep whatever speed the viewer last had.

use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};

use crate::app_messages::{MapInfo, ReplaySessionPlaybackControl};
use crate::bw_scr::BwScr;
use crate::game_thread::{self, GameThreadMessage};

/// The speed and multiplier SC:R starts replays at: fastest, unmultiplied.
const INITIAL_SPEED: u32 = 6;
const INITIAL_MULTIPLIER: u32 = 1;

/// Whether the session currently wants playback paused.
static WANT_PAUSED: AtomicBool = AtomicBool::new(true);
/// Set when the session's playback state arrives, until the game thread applies it. Applying it
/// only then, rather than enforcing it every frame, leaves the replay's own controls working in
/// between.
static PENDING: AtomicBool = AtomicBool::new(false);
/// Whether the most recent speed command the replay processed paused it.
static PAUSED: AtomicBool = AtomicBool::new(false);
static SPEED: AtomicU32 = AtomicU32::new(INITIAL_SPEED);
static MULTIPLIER: AtomicU32 = AtomicU32::new(INITIAL_MULTIPLIER);
/// Set once the replay has been held at its start and reported ready, after which the session's
/// pause state is applied.
static HELD: AtomicBool = AtomicBool::new(false);

/// Whether this game is a replay watched in a replay session.
pub fn is_active() -> bool {
    game_thread::setup_info()
        .is_some_and(|info| matches!(&info.map, MapInfo::Replay(r) if r.session.is_some()))
}

/// Takes on the session's latest playback state, which the game thread applies on its next frame.
pub fn set_playback(control: ReplaySessionPlaybackControl) {
    WANT_PAUSED.store(control.paused, Ordering::Relaxed);
    PENDING.store(true, Ordering::Release);
}

/// Notes a replay speed command (`[paused][speed: u32][multiplier: u32]`) the replay processed.
pub fn note_speed_command(paused: bool, speed: u32, multiplier: u32) {
    PAUSED.store(paused, Ordering::Relaxed);
    SPEED.store(speed, Ordering::Relaxed);
    MULTIPLIER.store(multiplier, Ordering::Relaxed);
}

/// Pauses a session replay on its first frame and reports that it is ready to play. Must be called
/// on the game thread once the replay's first logic frame has run.
pub unsafe fn hold_at_start(bw: &BwScr) {
    if !is_active() || HELD.load(Ordering::Relaxed) {
        return;
    }
    unsafe { send_paused(bw, true) };
    HELD.store(true, Ordering::Relaxed);
    debug!("Holding replay session playback at its start");
    game_thread::send_game_msg_to_async(GameThreadMessage::ReplaySessionReady);
}

/// Applies playback state the session sent since the last call. Must be called on the game thread
/// regularly, including while the replay is paused.
pub unsafe fn apply_playback(bw: &BwScr) {
    if !HELD.load(Ordering::Relaxed) || !PENDING.swap(false, Ordering::Acquire) {
        return;
    }
    let want_paused = WANT_PAUSED.load(Ordering::Relaxed);
    if want_paused != PAUSED.load(Ordering::Relaxed) {
        unsafe { send_paused(bw, want_paused) };
    }
}

/// Sends a speed command that changes only whether the replay is paused. The pause flag is noted
/// right away, so that the command isn't sent again while it waits to be processed.
unsafe fn send_paused(bw: &BwScr, paused: bool) {
    PAUSED.store(paused, Ordering::Relaxed);
    unsafe {
        bw.send_replay_speed(
            paused,
            SPEED.load(Ordering::Relaxed),
            MULTIPLIER.load(Ordering::Relaxed),
        )
    };
}
