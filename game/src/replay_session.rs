//! Local playback of a replay watched in a replay session.
//!
//! Every viewer in a session plays the same replay locally, and the session (through the app)
//! decides when that playback runs. A session replay holds itself paused at its first frame and
//! tells the app it is ready; it starts playing once the session says every viewer is ready.
//!
//! Pausing and resuming go through the replay UI's own speed command, which carries the speed
//! alongside the pause flag. Every speed command the replay processes is noted here, so the ones
//! sent from here keep whatever speed the viewer last had.

use std::borrow::Cow;
use std::collections::VecDeque;
use std::ffi::CString;
use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};
use std::time::{Duration, Instant};

use byteorder::{ByteOrder, LittleEndian};
use parking_lot::Mutex;

use crate::app_messages::{
    MapInfo, ReplaySessionChatLine, ReplaySessionPlaybackControl, ReplaySessionSeek,
};
use crate::bw::commands;
use crate::bw_scr::BwScr;
use crate::game_thread::{self, GameThreadMessage};

/// The speed and multiplier SC:R starts replays at: fastest, unmultiplied.
const INITIAL_SPEED: u32 = 6;
const INITIAL_MULTIPLIER: u32 = 1;

/// Whether the session currently wants playback paused.
static WANT_PAUSED: AtomicBool = AtomicBool::new(true);
static WANT_SPEED: AtomicU32 = AtomicU32::new(INITIAL_SPEED);
static WANT_MULTIPLIER: AtomicU32 = AtomicU32::new(INITIAL_MULTIPLIER);
static CONTROLLER: AtomicBool = AtomicBool::new(false);
/// Native controls stay locked until the lobby has released the all-viewers-ready barrier.
static STARTED: AtomicBool = AtomicBool::new(false);
/// The next command sent by this module must pass through the native processor on a follower.
static EXPECTED_SPEED: Mutex<VecDeque<(bool, u32, u32)>> = Mutex::new(VecDeque::new());
static EXPECTED_SEEK: Mutex<VecDeque<u32>> = Mutex::new(VecDeque::new());
/// Set when the session's playback state arrives, until the game thread applies it. Applying it
/// only then, rather than enforcing it every frame, leaves the replay's own controls working in
/// between.
static PENDING: AtomicBool = AtomicBool::new(false);
/// Whether the most recent speed command the replay processed paused it.
static PAUSED: AtomicBool = AtomicBool::new(false);
static SPEED: AtomicU32 = AtomicU32::new(INITIAL_SPEED);
static MULTIPLIER: AtomicU32 = AtomicU32::new(INITIAL_MULTIPLIER);
static NATIVE_PAUSED: AtomicBool = AtomicBool::new(false);
static WAITING_FOR_PAUSE: AtomicBool = AtomicBool::new(false);
/// Set once the replay has been held at its start and reported ready, after which the session's
/// pause state is applied.
static HELD: AtomicBool = AtomicBool::new(false);
static READY_REPORTED: AtomicBool = AtomicBool::new(false);
static LAST_SEEK_EPOCH: AtomicU32 = AtomicU32::new(0);

struct PendingSeek {
    seek: ReplaySessionSeek,
    command_sent: bool,
    command_accepted: bool,
    last_ack: Option<Instant>,
}

static SEEK: Mutex<Option<PendingSeek>> = Mutex::new(None);
static LAST_FRAME_REPORT: Mutex<Option<Instant>> = Mutex::new(None);
static CHAT: Mutex<VecDeque<ReplaySessionChatLine>> = Mutex::new(VecDeque::new());
const FRAME_REPORT_INTERVAL: Duration = Duration::from_secs(2);

/// Whether this game is a replay watched in a replay session.
pub fn is_active() -> bool {
    game_thread::setup_info()
        .is_some_and(|info| matches!(&info.map, MapInfo::Replay(r) if r.session.is_some()))
}

pub fn send_chat(text: &str) {
    if is_active() {
        game_thread::send_game_msg_to_async(GameThreadMessage::ReplaySessionChat {
            text: text.to_string(),
        });
    }
}

pub fn queue_chat(line: ReplaySessionChatLine) {
    if is_active() {
        CHAT.lock().push_back(line);
    }
}

/// Takes on the session's latest playback state, which the game thread applies on its next frame.
pub fn set_playback(control: ReplaySessionPlaybackControl) {
    CONTROLLER.store(control.controller, Ordering::Relaxed);
    if !control.paused {
        STARTED.store(true, Ordering::Relaxed);
    }
    WANT_PAUSED.store(control.paused, Ordering::Relaxed);
    if let (Some(speed), Some(multiplier)) = (control.speed, control.multiplier) {
        WANT_SPEED.store(speed, Ordering::Relaxed);
        WANT_MULTIPLIER.store(multiplier, Ordering::Relaxed);
    }
    match control.seek {
        Some(seek) if LAST_SEEK_EPOCH.load(Ordering::Relaxed) != seek.epoch => {
            LAST_SEEK_EPOCH.store(seek.epoch, Ordering::Relaxed);
            EXPECTED_SEEK.lock().clear();
            *SEEK.lock() = Some(PendingSeek {
                seek,
                command_sent: false,
                command_accepted: false,
                last_ack: None,
            });
        }
        None => *SEEK.lock() = None,
        _ => (),
    }
    PENDING.store(true, Ordering::Release);
}

/// Discards direct timeline commands from followers and from every viewer before the room starts.
/// Commands sent by this module are allowed through even on followers.
pub fn filter_local_commands<'a>(input: &'a [u8], lengths: &[u32]) -> Cow<'a, [u8]> {
    commands::filter_replay_timeline_commands(input, lengths, |command| match command {
        [commands::id::REPLAY_SPEED, paused, rest @ ..] if rest.len() == 8 => {
            let speed = LittleEndian::read_u32(rest);
            let multiplier = LittleEndian::read_u32(&rest[4..]);
            let value = (*paused != 0, speed, multiplier);
            let mut expected = EXPECTED_SPEED.lock();
            if let Some(index) = expected.iter().position(|&sent| sent == value) {
                expected.remove(index);
                return true;
            }
            drop(expected);
            if !STARTED.load(Ordering::Relaxed)
                || !CONTROLLER.load(Ordering::Relaxed)
                || SEEK.lock().is_some()
            {
                return false;
            }
            game_thread::send_game_msg_to_async(GameThreadMessage::ReplaySessionSpeed {
                paused: value.0,
                speed,
                multiplier,
            });
            true
        }
        [commands::id::REPLAY_SEEK, rest @ ..] if rest.len() == 4 => {
            let frame = LittleEndian::read_u32(rest);
            let mut expected = EXPECTED_SEEK.lock();
            if let Some(index) = expected.iter().position(|&sent| sent == frame) {
                expected.remove(index);
                drop(expected);
                if let Some(pending) = SEEK.lock().as_mut()
                    && pending.seek.frame == frame
                {
                    pending.command_accepted = true;
                }
                return true;
            }
            drop(expected);
            if STARTED.load(Ordering::Relaxed)
                && CONTROLLER.load(Ordering::Relaxed)
                && SEEK.lock().is_none()
            {
                game_thread::send_game_msg_to_async(GameThreadMessage::ReplaySessionSeek { frame });
            }
            false
        }
        _ => true,
    })
}

/// Notes a replay speed command (`[paused][speed: u32][multiplier: u32]`) the replay processed.
pub fn note_speed_command(paused: bool, speed: u32, multiplier: u32) {
    PAUSED.store(paused, Ordering::Relaxed);
    SPEED.store(speed, Ordering::Relaxed);
    MULTIPLIER.store(multiplier, Ordering::Relaxed);
    NATIVE_PAUSED.store(paused, Ordering::Relaxed);
    if paused {
        WAITING_FOR_PAUSE.store(false, Ordering::Relaxed);
    }
    if paused && HELD.load(Ordering::Relaxed) && !READY_REPORTED.swap(true, Ordering::Relaxed) {
        game_thread::send_game_msg_to_async(GameThreadMessage::ReplaySessionReady);
    }
}

/// Pauses a session replay on its first frame. Readiness is reported once the native processor has
/// accepted that pause command, so the room cannot send resume ahead of the initial pause.
pub unsafe fn hold_at_start(bw: &BwScr) {
    if !is_active() || HELD.load(Ordering::Relaxed) {
        return;
    }
    unsafe { send_paused(bw, true) };
    HELD.store(true, Ordering::Relaxed);
    debug!("Holding replay session playback at its start");
}

/// Applies playback state the session sent since the last call. Must be called on the game thread
/// regularly, including while the replay is paused.
pub unsafe fn apply_playback(bw: &BwScr) {
    if !HELD.load(Ordering::Relaxed) {
        return;
    }
    bw.set_replay_timeline_buttons_visible(CONTROLLER.load(Ordering::Relaxed));
    let chat = std::mem::take(&mut *CHAT.lock());
    for line in chat {
        if let Ok(text) = CString::new(format!("{}: {}", line.from, line.text)) {
            bw.print_text(&text);
        }
    }
    if PENDING.swap(false, Ordering::Acquire) {
        let want_paused = WANT_PAUSED.load(Ordering::Relaxed);
        let speed = WANT_SPEED.load(Ordering::Relaxed);
        let multiplier = WANT_MULTIPLIER.load(Ordering::Relaxed);
        if want_paused != PAUSED.load(Ordering::Relaxed)
            || speed != SPEED.load(Ordering::Relaxed)
            || multiplier != MULTIPLIER.load(Ordering::Relaxed)
        {
            unsafe { send_speed(bw, want_paused, speed, multiplier) };
        }
    }

    let mut pending = SEEK.lock();
    let Some(seek) = pending.as_mut() else {
        drop(pending);
        if STARTED.load(Ordering::Relaxed) {
            let now = Instant::now();
            let mut last = LAST_FRAME_REPORT.lock();
            if last.is_none_or(|at| now.duration_since(at) >= FRAME_REPORT_INTERVAL)
                && let Some(frame) = unsafe { bw.rollback_frame_count() }
            {
                *last = Some(now);
                drop(last);
                game_thread::send_game_msg_to_async(GameThreadMessage::ReplaySessionFrame {
                    frame,
                });
            }
        }
        return;
    };
    if !seek.command_sent {
        if !NATIVE_PAUSED.load(Ordering::Relaxed) {
            if !WAITING_FOR_PAUSE.load(Ordering::Relaxed) {
                drop(pending);
                unsafe { send_paused(bw, true) };
            }
            return;
        }
        if WAITING_FOR_PAUSE.load(Ordering::Relaxed) {
            return;
        }
        let frame = seek.seek.frame;
        seek.command_sent = true;
        drop(pending);
        let mut expected = EXPECTED_SEEK.lock();
        if expected.len() == 8 {
            expected.pop_front();
        }
        expected.push_back(frame);
        drop(expected);
        unsafe { bw.send_replay_seek(frame) };
        return;
    }
    if seek.command_accepted {
        let frame = seek.seek.frame;
        let now = Instant::now();
        if unsafe { bw.rollback_frame_count() } == Some(frame)
            && seek
                .last_ack
                .is_none_or(|at| now.duration_since(at) >= FRAME_REPORT_INTERVAL)
        {
            let epoch = seek.seek.epoch;
            seek.last_ack = Some(now);
            drop(pending);
            game_thread::send_game_msg_to_async(GameThreadMessage::ReplaySessionSeekReached {
                epoch,
                frame,
            });
        }
    }
}

/// Sends a speed command that changes only whether the replay is paused. The pause flag is noted
/// right away, so that the command isn't sent again while it waits to be processed.
unsafe fn send_paused(bw: &BwScr, paused: bool) {
    unsafe {
        send_speed(
            bw,
            paused,
            SPEED.load(Ordering::Relaxed),
            MULTIPLIER.load(Ordering::Relaxed),
        )
    };
}

unsafe fn send_speed(bw: &BwScr, paused: bool, speed: u32, multiplier: u32) {
    let mut expected = EXPECTED_SPEED.lock();
    if expected.len() == 8 {
        expected.pop_front();
    }
    expected.push_back((paused, speed, multiplier));
    drop(expected);
    PAUSED.store(paused, Ordering::Relaxed);
    SPEED.store(speed, Ordering::Relaxed);
    MULTIPLIER.store(multiplier, Ordering::Relaxed);
    if paused {
        WAITING_FOR_PAUSE.store(true, Ordering::Relaxed);
    }
    unsafe { bw.send_replay_speed(paused, speed, multiplier) };
}
