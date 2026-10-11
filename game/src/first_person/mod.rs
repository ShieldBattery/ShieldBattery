//! First-person replays: each player's cursor and camera, recorded during a live game and shown
//! from that player's perspective when watching the replay.
//!
//! Recording and playback state are process globals: one game runs per process, and both are only
//! touched from the game thread's draw and window procedure hooks.

pub mod track;

use std::sync::OnceLock;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::{Duration, Instant};

use parking_lot::Mutex;

use self::track::{
    CursorRegion, Event, EventKind, MouseButton, Sample, Track, TrackOwner, TrackRecorder, Viewport,
};

/// Milliseconds a game frame lasts at each game speed, slowest to fastest.
const FRAME_MS: [f64; 7] = [167.0, 111.0, 83.0, 67.0, 56.0, 48.0, 42.0];

/// Milliseconds a game frame lasts at `game_speed`, or at the fastest speed if it is out of range.
pub fn frame_ms(game_speed: u8) -> f64 {
    FRAME_MS.get(game_speed as usize).copied().unwrap_or(42.0)
}

/// A frame that has been on screen for longer than this many frame lengths is stalled (waiting on
/// the network or paused). Cursor movement during a stall happens at no point of the replay's
/// timeline, so it isn't recorded.
const STALLED_FRAME_LENGTHS: f64 = 2.0;

/// Shortest time between recorded samples. Drawing faster than this adds samples that playback's
/// interpolation would produce anyway.
const MIN_SAMPLE_INTERVAL: Duration = Duration::from_millis(15);

static RECORDING: Mutex<Option<Recording>> = Mutex::new(None);

struct Recording {
    recorder: TrackRecorder,
    /// The last game frame drawn, and when it was first drawn.
    frame: u32,
    frame_shown_at: Instant,
    frame_ms: f64,
    viewport: Option<Viewport>,
    drag_start: Option<(i16, i16)>,
    last_sample_at: Option<Instant>,
}

impl Recording {
    /// How far into the current frame `now` is, in eighths of a frame (0..=7), or `None` while the
    /// frame is stalled.
    fn sub_into_frame(&self, now: Instant) -> Option<u8> {
        let ms = now.duration_since(self.frame_shown_at).as_secs_f64() * 1000.0;
        if ms > self.frame_ms * STALLED_FRAME_LENGTHS {
            None
        } else {
            Some(((ms / self.frame_ms) * 8.0).floor().clamp(0.0, 7.0) as u8)
        }
    }
}

/// What the local player sees on one drawn frame of a live game.
pub struct LiveView {
    pub frame: u32,
    pub cursor: (i16, i16),
    pub screen: (u16, u16),
    pub region: CursorRegion,
    pub cursor_type: u8,
    pub viewport: Viewport,
    /// Where the selection box being dragged started, if one is.
    pub drag_start: Option<(i16, i16)>,
}

/// Starts recording the local player's perspective, discarding any earlier recording.
pub fn start_recording(owner: TrackOwner, game_speed: u8) {
    *RECORDING.lock() = Some(Recording {
        recorder: TrackRecorder::new(owner),
        frame: 0,
        frame_shown_at: Instant::now(),
        frame_ms: frame_ms(game_speed),
        viewport: None,
        drag_start: None,
        last_sample_at: None,
    });
}

pub fn is_recording() -> bool {
    RECORDING.lock().is_some()
}

/// Records what the local player sees this drawn frame.
pub fn record(view: LiveView) {
    let mut guard = RECORDING.lock();
    let Some(recording) = guard.as_mut() else {
        return;
    };
    let now = Instant::now();
    if view.frame != recording.frame {
        recording.frame = view.frame;
        recording.frame_shown_at = now;
    }
    let Some(sub) = recording.sub_into_frame(now) else {
        return;
    };
    let frame = view.frame;
    let too_soon = recording
        .last_sample_at
        .is_some_and(|last| now.duration_since(last) < MIN_SAMPLE_INTERVAL);
    if too_soon {
        return;
    }
    recording.last_sample_at = Some(now);
    if recording.viewport != Some(view.viewport) {
        recording.viewport = Some(view.viewport);
        recording.recorder.push_event(Event {
            frame,
            sub,
            kind: EventKind::Viewport(view.viewport),
        });
    }
    if recording.drag_start != view.drag_start {
        recording.drag_start = view.drag_start;
        recording.recorder.push_event(Event {
            frame,
            sub,
            kind: EventKind::Drag(view.drag_start),
        });
    }
    recording.recorder.push_sample(Sample {
        frame,
        sub,
        cursor: view.cursor,
        screen: view.screen,
        region: view.region,
        cursor_type: view.cursor_type,
    });
}

/// Records a mouse button the local player pressed or released over the game window.
pub fn record_button(button: MouseButton, down: bool) {
    record_event(EventKind::Button { button, down });
}

/// Records the game window gaining or losing input focus.
pub fn record_focus(focused: bool) {
    record_event(EventKind::Focus(focused));
}

fn record_event(kind: EventKind) {
    let mut guard = RECORDING.lock();
    let Some(recording) = guard.as_mut() else {
        return;
    };
    // Button and focus changes are kept even while stalled, stamped at the end of the stalled
    // frame, so a press is never recorded without its release.
    let sub = recording.sub_into_frame(Instant::now()).unwrap_or(7);
    let frame = recording.frame;
    recording.recorder.push_event(Event { frame, sub, kind });
}

/// The local player's perspective recorded so far, for a replay being saved.
pub fn recorded_track() -> Option<Track> {
    let guard = RECORDING.lock();
    let recording = guard.as_ref()?;
    let track = recording.recorder.snapshot(false);
    if track.samples.is_empty() {
        None
    } else {
        Some(track)
    }
}

static REPLAY_TRACKS: OnceLock<Vec<Track>> = OnceLock::new();

/// Sets the perspectives the replay being watched recorded. Only the first call has an effect.
pub fn set_replay_tracks(tracks: Vec<Track>) {
    if REPLAY_TRACKS.set(tracks).is_err() {
        warn!("Tried to set first-person replay tracks twice");
    }
}

/// The perspectives the replay being watched recorded.
pub fn replay_tracks() -> &'static [Track] {
    REPLAY_TRACKS.get().map(|x| &x[..]).unwrap_or(&[])
}

/// How long the viewer's mouse has to stay still before their own cursor hides while a player's
/// camera and cursor are shown, leaving only the player's cursor on screen.
const VIEWER_CURSOR_IDLE: Duration = Duration::from_secs(2);

/// When the viewer last moved their mouse or pressed a button over the game window.
static VIEWER_INPUT_AT: Mutex<Option<Instant>> = Mutex::new(None);

/// Whether the viewer is holding the middle mouse button, grab panning. The game hides their cursor
/// for that and shows it again on release, so the cursor mustn't be shown in between.
static VIEWER_MIDDLE_DOWN: AtomicBool = AtomicBool::new(false);

pub fn set_viewer_middle_down(down: bool) {
    VIEWER_MIDDLE_DOWN.store(down, Ordering::Relaxed);
}

pub fn viewer_middle_down() -> bool {
    VIEWER_MIDDLE_DOWN.load(Ordering::Relaxed)
}

/// Notes that the viewer moved their mouse or pressed a button, showing their cursor again.
pub fn viewer_used_mouse() {
    *VIEWER_INPUT_AT.lock() = Some(Instant::now());
}

/// Whether the viewer's own cursor should be hidden: a player's camera and cursor are shown and the
/// viewer hasn't used their mouse for a while.
pub fn hide_viewer_cursor() -> bool {
    {
        let playback = PLAYBACK.lock();
        if playback.track.is_none() || !playback.show_camera {
            return false;
        }
    }
    let now = Instant::now();
    let input_at = *VIEWER_INPUT_AT.lock().get_or_insert(now);
    now.duration_since(input_at) >= VIEWER_CURSOR_IDLE
}

/// How long the viewer's camera stays where they moved it before following the shown player's
/// camera again.
const CAMERA_OVERRIDE: Duration = Duration::from_secs(3);

static PLAYBACK: Mutex<Playback> = Mutex::new(Playback {
    track: None,
    show_camera: true,
    show_actions: true,
    attached: true,
    camera_set_to: None,
    viewer_camera: None,
    clock: None,
});

struct Playback {
    /// Index into [`replay_tracks`] of the perspective shown, if any.
    track: Option<usize>,
    /// Whether the player's camera and cursor are shown.
    show_camera: bool,
    /// Whether the player's selection and clicks are shown.
    show_actions: bool,
    /// Whether the viewer's camera follows the player's. The viewer moving the camera themselves
    /// detaches it, leaving everything else shown.
    attached: bool,
    /// The camera position the last follow move left the camera at, read back after the move.
    /// Anything else moving the camera away from it means the viewer took control.
    camera_set_to: Option<(u32, u32)>,
    /// While detached: where the viewer last had the camera, and when they last moved it.
    viewer_camera: Option<((u32, u32), Instant)>,
    clock: Option<FrameClock>,
}

impl Playback {
    fn attach(&mut self) {
        self.attached = true;
        self.camera_set_to = None;
        self.viewer_camera = None;
    }

    /// How much of the camera override is left (1.0 just after the viewer moved the camera, 0.0
    /// when the camera is about to follow again), or `None` when the camera isn't overridden.
    fn override_remaining(&self, now: Instant) -> Option<f32> {
        if !self.show_camera || self.attached {
            return None;
        }
        let (_, moved_at) = self.viewer_camera?;
        let left = CAMERA_OVERRIDE.saturating_sub(now.duration_since(moved_at));
        Some(left.as_secs_f32() / CAMERA_OVERRIDE.as_secs_f32())
    }
}

/// Turns the replay's frame count into a continuous time, so the player's cursor moves smoothly
/// between the frames it was recorded on.
struct FrameClock {
    frame: u32,
    frame_shown_at: Instant,
    /// Seconds per frame, measured from how fast frames have been advancing.
    frame_secs: f64,
}

/// What of a recorded perspective is shown, as seen by the replay UI.
#[derive(Copy, Clone, Debug, PartialEq)]
pub struct PerspectiveStatus {
    /// Index into [`replay_tracks`] of the perspective shown, if any.
    pub track: Option<usize>,
    pub show_camera: bool,
    pub show_actions: bool,
    /// Whether the viewer's camera follows the player's camera.
    pub following: bool,
    /// While the viewer has moved the camera away, how much of the override is left before it
    /// follows the player again, from 1.0 down to 0.0.
    pub override_remaining: Option<f32>,
}

pub fn perspective_status() -> PerspectiveStatus {
    let playback = PLAYBACK.lock();
    PerspectiveStatus {
        track: playback.track,
        show_camera: playback.show_camera,
        show_actions: playback.show_actions,
        following: playback.show_camera && playback.attached,
        override_remaining: playback.override_remaining(Instant::now()),
    }
}

/// Shows `track`'s perspective, or none with `None`. A newly shown perspective's camera is
/// followed.
pub fn show_perspective(track: Option<usize>) {
    let mut playback = PLAYBACK.lock();
    playback.track = track.filter(|&t| t < replay_tracks().len());
    playback.attach();
}

pub fn set_show_camera(show: bool) {
    let mut playback = PLAYBACK.lock();
    playback.show_camera = show;
    playback.attach();
}

pub fn set_show_actions(show: bool) {
    PLAYBACK.lock().show_actions = show;
}

/// Follows the shown player's camera again if the viewer had moved away from it. Otherwise shows
/// the next recorded perspective (`forward`) or the previous one, going through no perspective
/// between the last and the first.
pub fn next_perspective(forward: bool) {
    let mut playback = PLAYBACK.lock();
    let count = replay_tracks().len();
    if count == 0 {
        return;
    }
    if playback.track.is_some() && playback.show_camera && !playback.attached {
        playback.attach();
        return;
    }
    // Positions 0..count are the tracks, `count` is no perspective.
    let position = playback.track.unwrap_or(count);
    let next = if forward {
        (position + 1) % (count + 1)
    } else {
        (position + count) % (count + 1)
    };
    playback.track = (next < count).then_some(next);
    playback.attach();
}

/// Whether the shown perspective's selection and clicks are shown and it belongs to `storm_id`.
pub fn shows_actions_of(storm_id: u8) -> bool {
    let playback = PLAYBACK.lock();
    playback.show_actions
        && playback
            .track
            .and_then(|t| replay_tracks().get(t))
            .is_some_and(|track| track.owner.storm_id == storm_id)
}

/// The perspective shown on one drawn frame of a replay.
pub struct PlaybackFrame {
    /// Index into [`replay_tracks`].
    pub track_index: usize,
    pub track: &'static Track,
    /// Replay time to show the track at, in frames.
    pub time: f64,
    /// Whether the camera should be moved to the player's camera this frame.
    pub follow_camera: bool,
    pub show_cursor: bool,
    pub show_actions: bool,
}

/// The perspective shown on a drawn frame at `frame`, or `None` when none is. `camera` is where
/// the viewer's camera currently is: when the viewer has moved it away from where the last follow
/// move left it, the follow detaches.
pub fn playback_frame(frame: u32, frame_ms: f64, camera: (u32, u32)) -> Option<PlaybackFrame> {
    let mut playback = PLAYBACK.lock();
    let now = Instant::now();
    let time = advance_clock(&mut playback.clock, frame, frame_ms, now);
    let track_index = playback.track?;
    let track = replay_tracks().get(track_index)?;
    if playback.attached && playback.camera_set_to.is_some_and(|set| set != camera) {
        playback.attached = false;
        playback.camera_set_to = None;
    }
    if !playback.attached {
        match playback.viewer_camera {
            Some((last, _)) if last == camera => {
                if playback.override_remaining(now) == Some(0.0) {
                    playback.attach();
                }
            }
            _ => playback.viewer_camera = Some((camera, now)),
        }
    }
    Some(PlaybackFrame {
        track_index,
        track,
        time,
        follow_camera: playback.show_camera && playback.attached,
        show_cursor: playback.show_camera,
        show_actions: playback.show_actions,
    })
}

/// Remembers where a follow move left the camera (as read back after the move, since moves are
/// clamped to the map).
pub fn camera_moved_to(camera: (u32, u32)) {
    let mut playback = PLAYBACK.lock();
    if playback.attached {
        playback.camera_set_to = Some(camera);
    }
}

fn advance_clock(clock: &mut Option<FrameClock>, frame: u32, frame_ms: f64, now: Instant) -> f64 {
    let clock = clock.get_or_insert_with(|| FrameClock {
        frame,
        frame_shown_at: now,
        frame_secs: frame_ms / 1000.0,
    });
    if frame != clock.frame {
        let elapsed = now.duration_since(clock.frame_shown_at).as_secs_f64();
        if frame > clock.frame && frame - clock.frame < 64 {
            // Smooth out render timing jitter; replay speed changes settle within a few frames.
            let measured = elapsed / (frame - clock.frame) as f64;
            clock.frame_secs = clock.frame_secs * 0.75 + measured * 0.25;
        }
        clock.frame = frame;
        clock.frame_shown_at = now;
    }
    let elapsed = now.duration_since(clock.frame_shown_at).as_secs_f64();
    let fraction = if clock.frame_secs > 0.0 {
        (elapsed / clock.frame_secs).min(0.999)
    } else {
        0.0
    };
    frame as f64 + fraction
}
