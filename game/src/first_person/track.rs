//! First-person tracks: one player's cursor and camera over a game, recorded at render rate during
//! a live game, resampled onto a fixed grid of ticks, stored in the `SbFp` replay section, and
//! interpolated between ticks on playback.

use std::io;

use byteorder::{LE, ReadBytesExt, WriteBytesExt};

/// Replay section id of first-person tracks.
pub const SECTION_ID: u32 = 0x70466253; // SbFp

/// The track ends before the game did, or lost data while recording or decoding.
pub const TRACK_FLAG_TRUNCATED: u8 = 0x4;

/// `TrackOwner::storm_id` / `bw_player_id` of a player that has no such id (e.g. an observer has
/// no BW player id).
pub const UNKNOWN_PLAYER: u8 = 0xff;

const FORMAT_MAJOR: u8 = 1;
const FORMAT_MINOR: u8 = 0;
const SECTION_HEADER_LENGTH: u16 = 0x16;
const ENTRY_HEADER_LENGTH: u16 = 0x1c;
/// Codec of payloads holding a track's ticks (see `encode_payload`).
const CODEC_TICKS: u8 = 2;

/// Largest decompressed payload a single track may have.
const MAX_TRACK_UNCOMPRESSED: u32 = 64 * 1024 * 1024;
/// Largest total of decompressed payloads one section may have, so a section full of maximum-size
/// tracks can't exhaust memory.
const MAX_SECTION_UNCOMPRESSED: u64 = 256 * 1024 * 1024;
/// Most ticks a track may have: over 23 hours at the Fastest game speed's 2 ticks per frame. Each
/// tick takes 10 bytes in memory.
const MAX_TRACK_TICKS: u32 = 1 << 22;
/// Most ticks the tracks of one section may have together, so that many tracks can't multiply
/// [`MAX_TRACK_TICKS`].
const MAX_SECTION_TICKS: u32 = 1 << 23;
/// Most events a track may have; a player makes a few per second.
const MAX_TRACK_EVENTS: u32 = 1 << 20;
/// Most events the tracks of one section may have together.
const MAX_SECTION_EVENTS: u32 = 1 << 21;

/// Most ticks a track may have per game frame.
const MAX_TICKS_PER_FRAME: u8 = 8;
/// Most levels a cursor quantization table may have.
const MAX_QUANTIZATION_LEVELS: usize = 8;
/// Largest cursor quantization step, in UI pixels.
const MAX_QUANTIZATION_STEP: u32 = 4096;
/// The cursor quantization table tracks are written with, as `(speed_over, step)` levels (see
/// `encode_payload`): moving over 8 UI pixels a tick, the cursor is stored in steps of 2 pixels,
/// and over 24 in steps of 4. At 2 ticks per frame that is over about 380 and 1140 pixels a
/// second, where an error of a pixel or two isn't visible.
const DEFAULT_QUANTIZATION: [(u32, u32); 2] = [(8, 2), (24, 4)];
/// zstd level track payloads are compressed with. Payloads are compressed once, when the replay
/// is saved, so a slow level costs little.
const COMPRESSION_LEVEL: i32 = 19;

/// Largest cursor type a track stores; larger types are stored as this.
const MAX_CURSOR_TYPE: u8 = 0x7f;
/// Position of the region bit in a stored state byte, above the cursor type.
const STATE_REGION_SHIFT: u8 = 7;

const EVENT_VIEWPORT: u8 = 1;
const EVENT_BUTTON: u8 = 2;
const EVENT_FOCUS: u8 = 3;
const EVENT_DRAG: u8 = 4;

/// Raw stamps divide each frame into this many parts.
const SUBFRAMES: u8 = 8;
/// The last part of a frame a raw stamp can be in.
const MAX_SUB: u8 = SUBFRAMES - 1;
/// Number of byte columns in a track payload.
const COLUMN_COUNT: usize = 9;

/// Raw samples further apart than this many frames are not interpolated between: recording is
/// change-gated at render rate, so a longer gap means nothing moved until just before the later
/// sample.
const MAX_INTERPOLATION_GAP_FRAMES: f64 = 4.0;
/// A camera move larger than this (in map pixels, either axis) between two samples or ticks is a
/// hotkey or minimap jump rather than a scroll, and is shown as a cut.
const MAX_SCROLL_STEP: i32 = 256;

/// Where the cursor was: over the game view, or over UI (console, minimap, a menu).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum CursorRegion {
    #[default]
    Game = 0,
    Ui = 1,
}

impl CursorRegion {
    /// Values other than `Game` are all some kind of UI.
    fn from_u8(value: u8) -> CursorRegion {
        match value {
            0 => CursorRegion::Game,
            _ => CursorRegion::Ui,
        }
    }
}

/// The recording player's view: render target size in pixels and zoom (render target pixels per
/// map pixel; the game view spans the whole render target).
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Viewport {
    pub render_width: u16,
    pub render_height: u16,
    pub zoom: f32,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum MouseButton {
    Left = 0,
    Right = 1,
    Middle = 2,
}

impl MouseButton {
    fn from_u8(value: u8) -> Option<MouseButton> {
        match value {
            0 => Some(MouseButton::Left),
            1 => Some(MouseButton::Right),
            2 => Some(MouseButton::Middle),
            _ => None,
        }
    }
}

/// One raw snapshot of the player's cursor and camera, as recorded.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Sample {
    pub frame: u32,
    /// How far into `frame` the sample was taken, in eighths of a frame (0..=7; larger values
    /// count as 7). The sample's time is `frame + sub / 8`.
    pub sub: u8,
    /// Cursor in BW's UI coordinates: 480 tall and `480 * aspect ratio` wide, whatever the
    /// resolution.
    pub cursor: (i16, i16),
    /// Top-left of the camera in map pixels.
    pub screen: (u16, u16),
    pub region: CursorRegion,
    /// SC:R cursor graphic index (0..=18; arrow, illegal, target y/r/g/n, mag g/r/y, drag, time,
    /// scroll x8). Tracks store types above 0x7f as 0x7f.
    pub cursor_type: u8,
}

impl Sample {
    fn key(&self) -> (u32, u8) {
        (self.frame, self.sub.min(MAX_SUB))
    }

    fn time(&self) -> f64 {
        stamp_time(self.key())
    }

    fn fields(&self) -> SampleFields {
        SampleFields {
            cursor: self.cursor,
            screen: self.screen,
            region: self.region,
            cursor_type: self.cursor_type,
        }
    }
}

/// A cursor and camera state: what change-gating compares raw samples on, and what each tick of a
/// track holds.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct SampleFields {
    cursor: (i16, i16),
    screen: (u16, u16),
    region: CursorRegion,
    cursor_type: u8,
}

impl SampleFields {
    /// The state before a track's first tick, which its first tick is coded against.
    const INITIAL: SampleFields = SampleFields {
        cursor: (0, 0),
        screen: (0, 0),
        region: CursorRegion::Game,
        cursor_type: 0,
    };
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub enum EventKind {
    Viewport(Viewport),
    Button {
        button: MouseButton,
        down: bool,
    },
    /// Whether the game window had input focus (alt-tab etc.).
    Focus(bool),
    /// Box selection began at this render-px point (`Some`) or ended (`None`).
    Drag(Option<(i16, i16)>),
}

/// One raw event, as recorded.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Event {
    pub frame: u32,
    /// How far into `frame` the event happened, in eighths of a frame (0..=7; larger values count
    /// as 7).
    pub sub: u8,
    pub kind: EventKind,
}

impl Event {
    fn key(&self) -> (u32, u8) {
        (self.frame, self.sub.min(MAX_SUB))
    }
}

/// An event of a track, on the tick at or before the time it happened.
#[derive(Debug, Clone, Copy, PartialEq)]
struct TrackEvent {
    tick: u32,
    kind: EventKind,
}

/// Who a track belongs to.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct TrackOwner {
    pub sb_user_id: u32,
    /// [`UNKNOWN_PLAYER`] if not known.
    pub storm_id: u8,
    /// [`UNKNOWN_PLAYER`] if not known or an observer.
    pub bw_player_id: u8,
}

/// One player's cursor and camera over a game, on a grid of ticks: tick `k` is at time
/// `k / ticks_per_frame` frames.
#[derive(Debug, Clone, PartialEq)]
pub struct Track {
    pub owner: TrackOwner,
    /// `TRACK_FLAG_*` bits.
    pub flags: u8,
    /// 1..=[`MAX_TICKS_PER_FRAME`].
    ticks_per_frame: u8,
    /// The tick `ticks[0]` is at. The last tick, `first_tick + ticks.len() - 1`, fits a u32, and
    /// `ticks.len()` is at most [`MAX_TRACK_TICKS`].
    first_tick: u32,
    /// The cursor and camera at each tick from `first_tick` on, with cursor types at most
    /// [`MAX_CURSOR_TYPE`].
    ticks: Vec<SampleFields>,
    /// Ordered by tick, which may be outside the ticks `ticks` covers. At most
    /// [`MAX_TRACK_EVENTS`].
    events: Vec<TrackEvent>,
}

/// What a track shows at one point in time.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct View {
    /// Cursor in BW's UI coordinates (see [`Sample::cursor`]).
    pub cursor: (f32, f32),
    /// Top-left of the camera in map pixels.
    pub screen: (f32, f32),
    pub region: CursorRegion,
    /// SC:R cursor graphic index (see [`Sample::cursor_type`]). Decoded tracks may hold any value
    /// up to 0x7f; users must range check it.
    pub cursor_type: u8,
    /// The latest viewport event at or before this time.
    pub viewport: Option<Viewport>,
    /// The latest focus event at or before this time; focused if there was none.
    pub focused: bool,
    /// Where the box selection in progress began, if one is.
    pub drag_start: Option<(i16, i16)>,
    /// Whether the middle mouse button is held, which pans the camera by dragging and hides the
    /// cursor while it does.
    pub grab_panning: bool,
}

impl Track {
    /// A track with no ticks or events.
    fn empty(owner: TrackOwner, flags: u8) -> Track {
        Track {
            owner,
            flags,
            ticks_per_frame: 1,
            first_tick: 0,
            ticks: Vec::new(),
            events: Vec::new(),
        }
    }

    /// Resamples raw `samples` and `events`, each ordered by `(frame, sub)` as [`TrackRecorder`]
    /// keeps them, onto `ticks_per_frame` ticks a frame (clamped to 1..=8).
    ///
    /// The ticks run from the first sample's time to the last sample's, each rounded up to a
    /// tick so the last sample's state is reached. Each tick holds what [`raw_view`] shows at its
    /// time, rounded to whole pixels. Each event goes on the tick at or before its time, keeping
    /// their order. Ticks and events past what a reader accepts (ticks beyond the u32 range or
    /// [`MAX_TRACK_TICKS`], events beyond [`MAX_TRACK_EVENTS`]) are dropped, flagging the track
    /// truncated.
    fn resample(
        owner: TrackOwner,
        flags: u8,
        ticks_per_frame: u8,
        samples: &[Sample],
        events: &[Event],
    ) -> Track {
        let ticks_per_frame = ticks_per_frame.clamp(1, MAX_TICKS_PER_FRAME);
        // A stamp's time in eighths of a tick.
        let eighth_ticks = |(frame, sub): (u32, u8)| {
            (frame as u64 * SUBFRAMES as u64 + sub as u64) * ticks_per_frame as u64
        };
        let mut truncated = false;
        let mut track = Track::empty(owner, flags);
        track.ticks_per_frame = ticks_per_frame;

        if let (Some(first), Some(last)) = (samples.first(), samples.last()) {
            let start = eighth_ticks(first.key()).div_ceil(SUBFRAMES as u64);
            let end = eighth_ticks(last.key()).div_ceil(SUBFRAMES as u64);
            let limit = (start + MAX_TRACK_TICKS as u64 - 1).min(u32::MAX as u64);
            truncated |= end > limit;
            if let Ok(first_tick) = u32::try_from(start) {
                track.first_tick = first_tick;
                track.ticks = (start..=end.min(limit))
                    .map_while(|tick| raw_view(samples, tick as f64 / ticks_per_frame as f64))
                    .map(|view| view.rounded())
                    .collect();
            }
        }

        track.events = Vec::with_capacity(events.len().min(MAX_TRACK_EVENTS as usize));
        let mut previous = 0;
        for event in events {
            let tick = u32::try_from(eighth_ticks(event.key()) / SUBFRAMES as u64);
            let Ok(tick) = tick else {
                truncated = true;
                break;
            };
            if track.events.len() >= MAX_TRACK_EVENTS as usize {
                truncated = true;
                break;
            }
            previous = tick.max(previous);
            track.events.push(TrackEvent {
                tick: previous,
                kind: event.kind,
            });
        }
        track.flags |= truncated_flags(truncated);
        track
    }

    /// Whether the track has no ticks, so shows nothing at any time.
    pub fn is_empty(&self) -> bool {
        self.ticks.is_empty()
    }

    /// The frame a tick is in.
    fn tick_frame(&self, tick: u32) -> u32 {
        tick / self.ticks_per_frame as u32
    }

    /// The tick the last of `ticks` is at.
    fn last_tick(&self) -> Option<u32> {
        // Fits by the invariant on `first_tick`.
        let count = self.ticks.len().checked_sub(1)?;
        Some(self.first_tick + count as u32)
    }

    /// The earliest frame of any tick or event.
    pub fn first_frame(&self) -> Option<u32> {
        let tick = (!self.ticks.is_empty()).then_some(self.first_tick);
        let event = self.events.first().map(|e| e.tick);
        let first = [tick, event].into_iter().flatten().min()?;
        Some(self.tick_frame(first))
    }

    /// The latest frame of any tick or event.
    pub fn last_frame(&self) -> Option<u32> {
        let tick = self.last_tick();
        let event = self.events.last().map(|e| e.tick);
        let last = [tick, event].into_iter().flatten().max()?;
        Some(self.tick_frame(last))
    }

    /// The view at `time`, in frames (`frame as f64 + fraction`). `None` before the first tick;
    /// the last tick holds after the track ends.
    ///
    /// Between ticks `k` and `k + 1` the cursor follows a cubic Hermite curve with Catmull-Rom
    /// tangents from ticks `k - 1` and `k + 2`, except that it rests at a tick whose neighbor
    /// outside the pair is at the same position (or missing), so it eases out of and into rest
    /// instead of drifting past a stop, and it stays put while ticks `k` and `k + 1` are at the
    /// same position. The camera moves linearly unless it moves more than [`MAX_SCROLL_STEP`],
    /// which is a cut at tick `k + 1`. Region and cursor type are tick `k`'s.
    pub fn view_at(&self, time: f64) -> Option<View> {
        let at = time * self.ticks_per_frame as f64;
        let offset = at - self.first_tick as f64;
        if offset.is_nan() || offset < 0.0 {
            return None;
        }
        let last = self.ticks.len().checked_sub(1)?;
        let (index, fraction) = if offset >= last as f64 {
            (last, 0.0)
        } else {
            (offset as usize, offset.fract())
        };
        let current = &self.ticks[index];
        let mut cursor = (current.cursor.0 as f64, current.cursor.1 as f64);
        let mut screen = (current.screen.0 as f64, current.screen.1 as f64);
        if let Some(next) = self.ticks.get(index + 1)
            && fraction > 0.0
        {
            cursor = self.cursor_between(index, fraction);
            let dx = next.screen.0 as i32 - current.screen.0 as i32;
            let dy = next.screen.1 as i32 - current.screen.1 as i32;
            if dx.abs() <= MAX_SCROLL_STEP && dy.abs() <= MAX_SCROLL_STEP {
                screen.0 += dx as f64 * fraction;
                screen.1 += dy as f64 * fraction;
            }
        }

        let end = self.events.partition_point(|e| e.tick as f64 <= at);
        let mut viewport = None;
        let mut focused = None;
        let mut drag = None;
        let mut middle = None;
        for event in self.events[..end].iter().rev() {
            match event.kind {
                EventKind::Viewport(v) if viewport.is_none() => viewport = Some(v),
                EventKind::Focus(f) if focused.is_none() => focused = Some(f),
                EventKind::Drag(d) if drag.is_none() => drag = Some(d),
                EventKind::Button {
                    button: MouseButton::Middle,
                    down,
                } if middle.is_none() => middle = Some(down),
                _ => (),
            }
            if viewport.is_some() && focused.is_some() && drag.is_some() && middle.is_some() {
                break;
            }
        }

        Some(View {
            cursor: (cursor.0 as f32, cursor.1 as f32),
            screen: (screen.0 as f32, screen.1 as f32),
            region: current.region,
            cursor_type: current.cursor_type,
            viewport,
            focused: focused.unwrap_or(true),
            drag_start: drag.flatten(),
            grab_panning: middle.unwrap_or(false),
        })
    }

    /// The cursor `fraction` (0..1) of the way from tick `index` to the tick after it, which must
    /// exist.
    fn cursor_between(&self, index: usize, fraction: f64) -> (f64, f64) {
        let ticks = &self.ticks;
        let p1 = ticks[index].cursor;
        let p2 = ticks[index + 1].cursor;
        if p1 == p2 {
            return (p1.0 as f64, p1.1 as f64);
        }
        // Half the difference between two points: a Catmull-Rom tangent.
        let half = |a: (i16, i16), b: (i16, i16)| {
            (
                (b.0 as f64 - a.0 as f64) / 2.0,
                (b.1 as f64 - a.1 as f64) / 2.0,
            )
        };
        let m1 = match index.checked_sub(1).map(|i| ticks[i].cursor) {
            Some(p0) if p0 != p1 => half(p0, p2),
            _ => (0.0, 0.0),
        };
        let m2 = match ticks.get(index + 2).map(|t| t.cursor) {
            Some(p3) if p3 != p2 => half(p1, p3),
            _ => (0.0, 0.0),
        };
        (
            hermite(p1.0 as f64, p2.0 as f64, m1.0, m2.0, fraction),
            hermite(p1.1 as f64, p2.1 as f64, m1.1, m2.1, fraction),
        )
    }
}

/// The time of a `(frame, sub)` stamp, in frames.
fn stamp_time((frame, sub): (u32, u8)) -> f64 {
    frame as f64 + sub as f64 / SUBFRAMES as f64
}

/// The cubic Hermite curve from `p1` (at `u` 0) to `p2` (at `u` 1) with tangents `m1` and `m2`,
/// at `u`.
fn hermite(p1: f64, p2: f64, m1: f64, m2: f64, u: f64) -> f64 {
    let u2 = u * u;
    let u3 = u2 * u;
    (2.0 * u3 - 3.0 * u2 + 1.0) * p1
        + (u3 - 2.0 * u2 + u) * m1
        + (-2.0 * u3 + 3.0 * u2) * p2
        + (u3 - u2) * m2
}

/// Catmull-Rom between the middle two of four `(time, value)` points, with tangents scaled by the
/// actual time between points so unevenly spaced samples don't overshoot. Requires
/// `t0 <= t1 < t2 <= t3`; passing an endpoint twice gives a one-sided tangent there.
fn catmull_rom(points: [(f64, f64); 4], time: f64) -> f64 {
    let [(t0, p0), (t1, p1), (t2, p2), (t3, p3)] = points;
    let slope = |ta: f64, pa: f64, tb: f64, pb: f64| {
        if tb > ta { (pb - pa) / (tb - ta) } else { 0.0 }
    };
    let h = t2 - t1;
    let m1 = slope(t0, p0, t2, p2) * h;
    let m2 = slope(t1, p1, t3, p3) * h;
    let u = ((time - t1) / h).clamp(0.0, 1.0);
    hermite(p1, p2, m1, m2, u)
}

/// What raw samples show at one point in time.
#[derive(Debug, Clone, Copy, PartialEq)]
struct RawView {
    cursor: (f64, f64),
    screen: (f64, f64),
    region: CursorRegion,
    cursor_type: u8,
}

impl RawView {
    /// The view in whole pixels, with the cursor type limited to what tracks store.
    fn rounded(&self) -> SampleFields {
        // Float to integer casts saturate, keeping each value in its field's range.
        SampleFields {
            cursor: (self.cursor.0.round() as i16, self.cursor.1.round() as i16),
            screen: (self.screen.0.round() as u16, self.screen.1.round() as u16),
            region: self.region,
            cursor_type: self.cursor_type.min(MAX_CURSOR_TYPE),
        }
    }
}

/// What raw `samples`, ordered by `(frame, sub)`, show at `time` in frames: the definition of what
/// was recorded, which tracks are resampled from. `None` before the first sample; the last sample
/// holds after the end.
///
/// The cursor follows Catmull-Rom between samples, and the camera moves linearly unless it moves
/// more than [`MAX_SCROLL_STEP`], which is a cut at the later sample. Samples more than
/// [`MAX_INTERPOLATION_GAP_FRAMES`] apart aren't interpolated between: the earlier one holds
/// until the later one. Region and cursor type are the latest sample's at or before `time`.
fn raw_view(samples: &[Sample], time: f64) -> Option<RawView> {
    let next = samples.partition_point(|s| s.time() <= time);
    let index = next.checked_sub(1)?;
    let current = &samples[index];
    let mut cursor = (current.cursor.0 as f64, current.cursor.1 as f64);
    let mut screen = (current.screen.0 as f64, current.screen.1 as f64);
    if let Some(after) = samples.get(next) {
        let max_gap = MAX_INTERPOLATION_GAP_FRAMES;
        let t1 = current.time();
        let t2 = after.time();
        // `t2 > time >= t1` by the partition, so the interval is never empty.
        if t2 - t1 < max_gap {
            let before = index
                .checked_sub(1)
                .map(|i| &samples[i])
                .filter(|s| t1 - s.time() < max_gap)
                .unwrap_or(current);
            let later = samples
                .get(next + 1)
                .filter(|s| s.time() - t2 < max_gap)
                .unwrap_or(after);
            let t0 = before.time();
            let t3 = later.time();
            let axis = |get: fn(&Sample) -> f64| {
                catmull_rom(
                    [
                        (t0, get(before)),
                        (t1, get(current)),
                        (t2, get(after)),
                        (t3, get(later)),
                    ],
                    time,
                )
            };
            cursor = (axis(|s| s.cursor.0 as f64), axis(|s| s.cursor.1 as f64));

            let dx = after.screen.0 as i32 - current.screen.0 as i32;
            let dy = after.screen.1 as i32 - current.screen.1 as i32;
            if dx.abs() <= MAX_SCROLL_STEP && dy.abs() <= MAX_SCROLL_STEP {
                let u = ((time - t1) / (t2 - t1)).clamp(0.0, 1.0);
                screen.0 += dx as f64 * u;
                screen.1 += dy as f64 * u;
            }
        }
    }
    Some(RawView {
        cursor,
        screen,
        region: current.region,
        cursor_type: current.cursor_type,
    })
}

/// Collects a track during a live game. Pushes are cheap (no allocation beyond `Vec` growth), as
/// they run on the render thread; the raw samples and events are resampled onto ticks when a
/// snapshot is taken.
#[derive(Debug, Clone)]
pub struct TrackRecorder {
    owner: TrackOwner,
    ticks_per_frame: u8,
    samples: Vec<Sample>,
    events: Vec<Event>,
}

impl TrackRecorder {
    /// A recorder for tracks of `ticks_per_frame` ticks a frame, clamped to 1..=8.
    pub fn new(owner: TrackOwner, ticks_per_frame: u8) -> TrackRecorder {
        TrackRecorder {
            owner,
            ticks_per_frame: ticks_per_frame.clamp(1, MAX_TICKS_PER_FRAME),
            samples: Vec::new(),
            events: Vec::new(),
        }
    }

    /// Records `sample` unless its cursor, screen, region and cursor type all equal the previous
    /// sample's. A stamp earlier than the previous sample's is raised to it, keeping the samples
    /// ordered, and `sub` is clamped to 7.
    pub fn push_sample(&mut self, mut sample: Sample) {
        let mut key = sample.key();
        if let Some(last) = self.samples.last() {
            if last.fields() == sample.fields() {
                return;
            }
            key = key.max(last.key());
        }
        (sample.frame, sample.sub) = key;
        self.samples.push(sample);
    }

    /// Records `event`. A stamp earlier than the previous event's is raised to it, keeping the
    /// events ordered, and `sub` is clamped to 7.
    pub fn push_event(&mut self, mut event: Event) {
        let mut key = event.key();
        if let Some(last) = self.events.last() {
            key = key.max(last.key());
        }
        (event.frame, event.sub) = key;
        self.events.push(event);
    }

    /// The track recorded so far, leaving the recorder to continue.
    pub fn snapshot(&self, truncated: bool) -> Track {
        Track::resample(
            self.owner,
            truncated_flags(truncated),
            self.ticks_per_frame,
            &self.samples,
            &self.events,
        )
    }
}

fn truncated_flags(truncated: bool) -> u8 {
    if truncated { TRACK_FLAG_TRUNCATED } else { 0 }
}

fn write_varint(out: &mut Vec<u8>, mut value: u32) {
    while value >= 0x80 {
        out.push(value as u8 | 0x80);
        value >>= 7;
    }
    out.push(value as u8);
}

fn write_zigzag(out: &mut Vec<u8>, value: i32) {
    write_varint(out, ((value << 1) ^ (value >> 31)) as u32);
}

fn too_large() -> io::Error {
    io::Error::new(io::ErrorKind::InvalidInput, "track is too large")
}

/// Whether `quantization` is a table readers accept: at most [`MAX_QUANTIZATION_LEVELS`] levels,
/// `speed_over` strictly ascending, and every step in 1..=[`MAX_QUANTIZATION_STEP`].
fn valid_quantization(quantization: &[(u32, u32)]) -> bool {
    quantization.len() <= MAX_QUANTIZATION_LEVELS
        && quantization.windows(2).all(|w| w[0].0 < w[1].0)
        && quantization
            .iter()
            .all(|&(_, step)| (1..=MAX_QUANTIZATION_STEP).contains(&step))
}

/// The cursor coding of a payload's cursor columns (see `encode_payload`), shared by writing and
/// reading so both follow the same decoded positions.
struct CursorCoder<'a> {
    quantization: &'a [(u32, u32)],
    position: (i32, i32),
    movement: (i32, i32),
}

impl CursorCoder<'_> {
    /// A coder for a `quantization` table that [`valid_quantization`] accepts.
    fn new(quantization: &[(u32, u32)]) -> CursorCoder<'_> {
        CursorCoder {
            quantization,
            position: (0, 0),
            movement: (0, 0),
        }
    }

    /// The step of the next tick's codes, from the last tick's decoded movement.
    fn step(&self) -> i32 {
        let speed = self
            .movement
            .0
            .unsigned_abs()
            .max(self.movement.1.unsigned_abs());
        self.quantization
            .iter()
            .rev()
            .find(|&&(speed_over, _)| speed_over < speed)
            .map_or(1, |&(_, step)| step as i32)
    }

    /// Advances one tick with `codes`, returning the tick's position.
    fn decode(&mut self, codes: (i32, i32)) -> (i16, i16) {
        let step = self.step();
        let x = decode_axis(self.position.0, self.movement.0, codes.0, step);
        let y = decode_axis(self.position.1, self.movement.1, codes.1, step);
        self.advance((x, y))
    }

    /// Advances one tick with the codes that decode nearest `target`, returning them.
    fn encode(&mut self, target: (i16, i16)) -> (i32, i32) {
        let step = self.step();
        let codes = (
            nearest_code(self.position.0, self.movement.0, step, target.0 as i32),
            nearest_code(self.position.1, self.movement.1, step, target.1 as i32),
        );
        let x = decode_axis(self.position.0, self.movement.0, codes.0, step);
        let y = decode_axis(self.position.1, self.movement.1, codes.1, step);
        self.advance((x, y));
        codes
    }

    /// Moves to `position`, which is in the i16 range.
    fn advance(&mut self, position: (i32, i32)) -> (i16, i16) {
        self.movement = (position.0 - self.position.0, position.1 - self.position.1);
        self.position = position;
        (position.0 as i16, position.1 as i16)
    }
}

/// One axis of a decoded cursor position: the last position moved on by the last movement, then
/// by `code` steps, clamped to the i16 range.
fn decode_axis(position: i32, movement: i32, code: i32, step: i32) -> i32 {
    position
        .saturating_add(movement)
        .saturating_add(code.saturating_mul(step))
        .clamp(i16::MIN as i32, i16::MAX as i32)
}

/// The code that [`decode_axis`] decodes nearest `target` with: the distance from the predicted
/// position in steps, rounded half away from zero, or a neighbor of that code if clamping to the
/// i16 range lands the neighbor nearer.
fn nearest_code(position: i32, movement: i32, step: i32, target: i32) -> i32 {
    let residual = target.saturating_sub(position.saturating_add(movement));
    let step_size = step.unsigned_abs();
    let steps = residual
        .unsigned_abs()
        .saturating_mul(2)
        .saturating_add(step_size)
        / (2 * step_size);
    let code = if residual < 0 {
        -(steps as i32)
    } else {
        steps as i32
    };
    let error = |code: i32| decode_axis(position, movement, code, step).abs_diff(target);
    [code - 1, code + 1].into_iter().fold(
        code,
        |best, c| if error(c) < error(best) { c } else { best },
    )
}

/// The byte a payload stores a tick's region and cursor type as.
fn state_byte(fields: &SampleFields) -> u8 {
    fields.cursor_type.min(MAX_CURSOR_TYPE) | (fields.region as u8) << STATE_REGION_SHIFT
}

/// A payload's columns, in payload order.
#[derive(Debug, Default)]
struct Columns {
    cursor_x: Vec<u8>,
    cursor_y: Vec<u8>,
    camera_ticks: Vec<u8>,
    camera_x: Vec<u8>,
    camera_y: Vec<u8>,
    state_ticks: Vec<u8>,
    states: Vec<u8>,
    event_ticks: Vec<u8>,
    events: Vec<u8>,
}

impl Columns {
    fn all(&self) -> [&[u8]; COLUMN_COUNT] {
        [
            &self.cursor_x,
            &self.cursor_y,
            &self.camera_ticks,
            &self.camera_x,
            &self.camera_y,
            &self.state_ticks,
            &self.states,
            &self.event_ticks,
            &self.events,
        ]
    }
}

/// Encodes a track as an uncompressed codec 2 payload, storing the cursor with the
/// `quantization` table of `(speed_over, step)` levels.
///
/// ```text
/// u8      ticks_per_frame (1..=8)
///     Tick k is at time k / ticks_per_frame frames. Readers don't decode a track with any other
///     value.
/// u8      level_count (0..=8), then level_count x { varint speed_over, varint step }
///     The cursor quantization table: speed_over strictly ascending, step 1..=4096. A tick's
///     step is that of the last level whose speed_over is below the previous tick's decoded
///     cursor movement, max(|dx|, |dy|) in UI pixels, or 1 if no level's is.
/// varint  first_tick
/// varint  tick_count (at most 2^22; the last tick, first_tick + tick_count - 1, fits a u32)
/// varint  column_length[9]  byte length of each column below, in order
/// column 1, cursor x: per tick, zigzag-varint code
/// column 2, cursor y: per tick, zigzag-varint code
///     Second-order deltas, decoded in i32 with saturating arithmetic:
///         position = (0, 0), movement = (0, 0)
///         per tick:
///             step = the table's step for movement
///             per axis: new = clamp_i16(position + movement + code * step)
///             movement = new - position, position = new
///     Steady motion codes as zeros. Writers pick the code decoding nearest the true position,
///     so a position is off by at most step / 2, and is exact while the step is 1.
/// column 3, camera ticks: per camera change, varint ticks from the previous change's tick (the
///     first change's from first_tick) to this change's
/// column 4, camera x: per camera change, zigzag-varint change of x
/// column 5, camera y: as column 4, for y
/// column 6, state ticks: per change of region or cursor type, varint ticks as column 3
/// column 7, states: per state change, u8 cursor_type | region << 7 (region 0 Game, 1 Ui)
/// column 8, event ticks: per event, varint ticks from the previous event's tick (the first
///     event's from tick 0) to this event's
/// column 9, events: per event { u8 type, varint length, u8 data[length] }
///     1 Viewport { u16 width, u16 height, f32 zoom }
///     2 Button { u8 button, u8 down }
///     3 Focus { u8 focused }
///     4 Drag { u8 active, i16 x, i16 y } (x, y are 0 when inactive)
///     Readers skip unknown types, and data past what they know of a type.
/// ```
/// Before the first tick the camera is at (0, 0), the region is Game and the cursor type 0, so
/// the first tick's codes and changes carry its starting state. A camera or state change holds
/// from its tick until the next change. Events may be on ticks before the first tick or after
/// the last. All values are little endian, and varints are LEB128 of at most 32 bits.
///
/// A reader stops reading a change or event column at a malformed entry or at a change tick past
/// the last tick, and treats the payload as malformed if any column isn't consumed exactly.
fn encode_payload(track: &Track, quantization: &[(u32, u32)]) -> io::Result<Vec<u8>> {
    let columns = encode_columns(track, quantization)?;
    let columns = columns.all();
    let total: usize = columns.iter().map(|c| c.len()).sum();
    let mut out = Vec::with_capacity(total + 64);
    out.push(track.ticks_per_frame);
    out.push(quantization.len() as u8);
    for &(speed_over, step) in quantization {
        write_varint(&mut out, speed_over);
        write_varint(&mut out, step);
    }
    write_varint(&mut out, track.first_tick);
    write_varint(&mut out, track.ticks.len() as u32);
    for column in columns {
        write_varint(
            &mut out,
            u32::try_from(column.len()).map_err(|_| too_large())?,
        );
    }
    for column in columns {
        out.extend_from_slice(column);
    }
    Ok(out)
}

/// Splits `track` into a payload's columns (see `encode_payload`).
///
/// Fails unless readers accept `quantization`, and unless each of its steps is at most its first
/// level's `speed_over`: a cursor coming to rest is then off by at most that much for a tick, so
/// it is coded with step 1 and exact two ticks after stopping, where a coarser step could keep
/// it oscillating around the true position.
fn encode_columns(track: &Track, quantization: &[(u32, u32)]) -> io::Result<Columns> {
    let settles = quantization
        .first()
        .is_none_or(|&(speed_over, _)| quantization.iter().all(|&(_, step)| step <= speed_over));
    if !valid_quantization(quantization) || !settles {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            "invalid cursor quantization",
        ));
    }
    let tick_count = track.ticks.len();
    let mut columns = Columns {
        cursor_x: Vec::with_capacity(tick_count),
        cursor_y: Vec::with_capacity(tick_count),
        ..Columns::default()
    };
    let mut coder = CursorCoder::new(quantization);
    let mut camera = SampleFields::INITIAL.screen;
    let mut camera_changed_at = 0u32;
    let mut state = state_byte(&SampleFields::INITIAL);
    let mut state_changed_at = 0u32;
    for (offset, fields) in (0u32..).zip(&track.ticks) {
        let (x, y) = coder.encode(fields.cursor);
        write_zigzag(&mut columns.cursor_x, x);
        write_zigzag(&mut columns.cursor_y, y);
        if fields.screen != camera {
            write_varint(&mut columns.camera_ticks, offset - camera_changed_at);
            write_zigzag(
                &mut columns.camera_x,
                fields.screen.0 as i32 - camera.0 as i32,
            );
            write_zigzag(
                &mut columns.camera_y,
                fields.screen.1 as i32 - camera.1 as i32,
            );
            camera = fields.screen;
            camera_changed_at = offset;
        }
        let fields_state = state_byte(fields);
        if fields_state != state {
            write_varint(&mut columns.state_ticks, offset - state_changed_at);
            columns.states.push(fields_state);
            state = fields_state;
            state_changed_at = offset;
        }
    }
    let mut previous = 0u32;
    for event in &track.events {
        let gap = event.tick.checked_sub(previous).ok_or_else(|| {
            io::Error::new(io::ErrorKind::InvalidInput, "track events are out of order")
        })?;
        write_varint(&mut columns.event_ticks, gap);
        write_event(&mut columns.events, &event.kind);
        previous = event.tick;
    }
    Ok(columns)
}

fn write_event(out: &mut Vec<u8>, kind: &EventKind) {
    match *kind {
        EventKind::Viewport(viewport) => {
            out.push(EVENT_VIEWPORT);
            write_varint(out, 8);
            out.extend_from_slice(&viewport.render_width.to_le_bytes());
            out.extend_from_slice(&viewport.render_height.to_le_bytes());
            out.extend_from_slice(&viewport.zoom.to_le_bytes());
        }
        EventKind::Button { button, down } => {
            out.push(EVENT_BUTTON);
            write_varint(out, 2);
            out.push(button as u8);
            out.push(down as u8);
        }
        EventKind::Focus(focused) => {
            out.push(EVENT_FOCUS);
            write_varint(out, 1);
            out.push(focused as u8);
        }
        EventKind::Drag(start) => {
            out.push(EVENT_DRAG);
            write_varint(out, 5);
            let (x, y) = start.unwrap_or((0, 0));
            out.push(start.is_some() as u8);
            out.extend_from_slice(&x.to_le_bytes());
            out.extend_from_slice(&y.to_le_bytes());
        }
    }
}

/// Encodes and zstd-compresses a track, returning the compressed payload and its uncompressed
/// length.
fn encode_track_payload(track: &Track, quantization: &[(u32, u32)]) -> io::Result<(Vec<u8>, u32)> {
    let payload = encode_payload(track, quantization)?;
    let uncompressed_length = u32::try_from(payload.len()).map_err(|_| too_large())?;
    Ok((
        zstd::bulk::compress(&payload, COMPRESSION_LEVEL)?,
        uncompressed_length,
    ))
}

/// Bounds-checked reads from a byte slice; every read returns `None` past the end.
struct Reader<'a> {
    data: &'a [u8],
}

impl<'a> Reader<'a> {
    fn is_empty(&self) -> bool {
        self.data.is_empty()
    }

    fn u8(&mut self) -> Option<u8> {
        let (&first, rest) = self.data.split_first()?;
        self.data = rest;
        Some(first)
    }

    fn varint(&mut self) -> Option<u32> {
        u32::try_from(self.varint_u64()?).ok()
    }

    fn varint_u64(&mut self) -> Option<u64> {
        let mut value = 0u64;
        for i in 0..10 {
            let byte = self.u8()?;
            // The tenth byte holds the top bit; anything above it doesn't fit a u64.
            if i == 9 && byte > 0x01 {
                return None;
            }
            value |= ((byte & 0x7f) as u64) << (i * 7);
            if byte & 0x80 == 0 {
                return Some(value);
            }
        }
        None
    }

    fn zigzag(&mut self) -> Option<i32> {
        let value = self.varint()?;
        Some((value >> 1) as i32 ^ -((value & 1) as i32))
    }

    fn bytes(&mut self, len: usize) -> Option<&'a [u8]> {
        let (bytes, rest) = self.data.split_at_checked(len)?;
        self.data = rest;
        Some(bytes)
    }
}

/// How many more ticks and events the tracks of a section may decode to.
struct DecodeBudget {
    ticks: u32,
    events: u32,
}

impl DecodeBudget {
    fn section() -> DecodeBudget {
        DecodeBudget {
            ticks: MAX_SECTION_TICKS,
            events: MAX_SECTION_EVENTS,
        }
    }
}

/// A decoded payload: a track's parts other than its owner and flags.
#[derive(Debug)]
struct DecodedTrack {
    ticks_per_frame: u8,
    first_tick: u32,
    ticks: Vec<SampleFields>,
    events: Vec<TrackEvent>,
    /// The payload was malformed; what decoded before the malformation was kept.
    truncated: bool,
}

impl DecodedTrack {
    fn into_track(self, owner: TrackOwner, flags: u8) -> Track {
        Track {
            owner,
            flags: flags | truncated_flags(self.truncated),
            ticks_per_frame: self.ticks_per_frame,
            first_tick: self.first_tick,
            ticks: self.ticks,
            events: self.events,
        }
    }
}

/// Readers over a payload's columns.
struct ColumnReaders<'a> {
    cursor_x: Reader<'a>,
    cursor_y: Reader<'a>,
    camera_ticks: Reader<'a>,
    camera_x: Reader<'a>,
    camera_y: Reader<'a>,
    state_ticks: Reader<'a>,
    states: Reader<'a>,
    event_ticks: Reader<'a>,
    events: Reader<'a>,
}

impl ColumnReaders<'_> {
    fn all_consumed(&self) -> bool {
        [
            &self.cursor_x,
            &self.cursor_y,
            &self.camera_ticks,
            &self.camera_x,
            &self.camera_y,
            &self.state_ticks,
            &self.states,
            &self.event_ticks,
            &self.events,
        ]
        .iter()
        .all(|column| column.is_empty())
    }
}

/// The values a payload starts with, before its columns.
struct PayloadHeader<'a> {
    ticks_per_frame: u8,
    quantization: Vec<(u32, u32)>,
    first_tick: u32,
    tick_count: u32,
    columns: ColumnReaders<'a>,
    /// Whether data follows the last column.
    trailing_data: bool,
}

/// Reads a payload's header and splits its columns. `None` if the header is malformed, out of
/// range, or states more ticks than `budget` allows or the cursor columns can hold (each tick
/// takes at least a byte of each).
fn read_header<'a>(data: &'a [u8], budget: &DecodeBudget) -> Option<PayloadHeader<'a>> {
    let mut reader = Reader { data };
    let ticks_per_frame = reader
        .u8()
        .filter(|tpf| (1..=MAX_TICKS_PER_FRAME).contains(tpf))?;
    let level_count = reader
        .u8()
        .filter(|&count| count as usize <= MAX_QUANTIZATION_LEVELS)?;
    let mut quantization = Vec::with_capacity(level_count as usize);
    for _ in 0..level_count {
        quantization.push((reader.varint()?, reader.varint()?));
    }
    if !valid_quantization(&quantization) {
        return None;
    }
    let first_tick = reader.varint()?;
    let tick_count = reader.varint()?;
    let mut lengths = [0u32; COLUMN_COUNT];
    for length in &mut lengths {
        *length = reader.varint()?;
    }
    let mut columns = lengths.map(|_| Reader { data: &[] });
    for (column, &length) in columns.iter_mut().zip(&lengths) {
        column.data = reader.bytes(length as usize)?;
    }
    let [
        cursor_x,
        cursor_y,
        camera_ticks,
        camera_x,
        camera_y,
        state_ticks,
        states,
        event_ticks,
        events,
    ] = columns;

    let fits = tick_count <= MAX_TRACK_TICKS.min(budget.ticks)
        && tick_count as usize <= cursor_x.data.len().min(cursor_y.data.len())
        && first_tick as u64 + tick_count as u64 <= 1 << 32;
    fits.then_some(PayloadHeader {
        ticks_per_frame,
        quantization,
        first_tick,
        tick_count,
        columns: ColumnReaders {
            cursor_x,
            cursor_y,
            camera_ticks,
            camera_x,
            camera_y,
            state_ticks,
            states,
            event_ticks,
            events,
        },
        trailing_data: !reader.is_empty(),
    })
}

/// Decodes an uncompressed codec 2 payload, taking the ticks and events it decodes from `budget`.
/// A malformed header gives no ticks or events. A column malformed partway keeps what decoded
/// before the malformation: ticks after a malformed cursor entry are dropped, and a malformed
/// change column leaves the value its last good change set for the rest of the ticks.
fn decode_payload(data: &[u8], budget: &mut DecodeBudget) -> DecodedTrack {
    let mut out = DecodedTrack {
        ticks_per_frame: 1,
        first_tick: 0,
        ticks: Vec::new(),
        events: Vec::new(),
        truncated: true,
    };
    let Some(header) = read_header(data, budget) else {
        return out;
    };
    out.ticks_per_frame = header.ticks_per_frame;
    out.first_tick = header.first_tick;
    let mut columns = header.columns;
    let mut well_formed = !header.trailing_data;

    let mut coder = CursorCoder::new(&header.quantization);
    out.ticks.reserve_exact(header.tick_count as usize);
    for _ in 0..header.tick_count {
        let (Some(x), Some(y)) = (columns.cursor_x.zigzag(), columns.cursor_y.zigzag()) else {
            well_formed = false;
            break;
        };
        out.ticks.push(SampleFields {
            cursor: coder.decode((x, y)),
            ..SampleFields::INITIAL
        });
    }
    budget.ticks -= out.ticks.len() as u32;

    well_formed &= decode_changes(
        &mut out.ticks,
        &mut columns.camera_ticks,
        SampleFields::INITIAL.screen,
        |camera| {
            let x = (camera.0 as i32).checked_add(columns.camera_x.zigzag()?)?;
            let y = (camera.1 as i32).checked_add(columns.camera_y.zigzag()?)?;
            Some((u16::try_from(x).ok()?, u16::try_from(y).ok()?))
        },
        |fields, camera| fields.screen = camera,
    );
    well_formed &= decode_changes(
        &mut out.ticks,
        &mut columns.state_ticks,
        state_byte(&SampleFields::INITIAL),
        |_| columns.states.u8(),
        |fields, state| {
            fields.region = CursorRegion::from_u8(state >> STATE_REGION_SHIFT);
            fields.cursor_type = state & MAX_CURSOR_TYPE;
        },
    );

    let event_limit = MAX_TRACK_EVENTS.min(budget.events) as usize;
    let mut tick = 0u32;
    while !columns.event_ticks.is_empty() {
        if out.events.len() >= event_limit {
            well_formed = false;
            break;
        }
        let next_tick = columns
            .event_ticks
            .varint()
            .and_then(|gap| tick.checked_add(gap));
        let Some(next_tick) = next_tick else {
            well_formed = false;
            break;
        };
        tick = next_tick;
        let Some(kind) = decode_event(&mut columns.events) else {
            well_formed = false;
            break;
        };
        if let Some(kind) = kind {
            out.events.push(TrackEvent { tick, kind });
        }
    }
    budget.events -= out.events.len() as u32;

    out.truncated = !well_formed || !columns.all_consumed();
    out
}

/// Decodes a column of change ticks (see `encode_payload`): each change's value is `next` of the
/// value before it (starting from `initial`), and is `set` on the ticks from the change's tick
/// until the next change's. Returns false if the column is malformed or places a change past the
/// last tick; the rest of the column is then ignored, leaving the last good change's value on
/// the remaining ticks.
fn decode_changes<T: Copy>(
    ticks: &mut [SampleFields],
    tick_column: &mut Reader<'_>,
    initial: T,
    mut next: impl FnMut(T) -> Option<T>,
    set: impl Fn(&mut SampleFields, T),
) -> bool {
    let mut value = initial;
    let mut changed_at = 0u32;
    let mut well_formed = true;
    while !tick_column.is_empty() {
        let change = tick_column
            .varint()
            .and_then(|gap| changed_at.checked_add(gap))
            .filter(|&tick| (tick as usize) < ticks.len())
            .and_then(|tick| Some((tick, next(value)?)));
        let Some((tick, new_value)) = change else {
            well_formed = false;
            break;
        };
        for fields in &mut ticks[changed_at as usize..tick as usize] {
            set(fields, value);
        }
        value = new_value;
        changed_at = tick;
    }
    for fields in ticks.iter_mut().skip(changed_at as usize) {
        set(fields, value);
    }
    well_formed
}

/// `None` for a malformed event, `Some(None)` for one to skip (unknown type or values). Data past
/// what a known type uses is ignored.
fn decode_event(reader: &mut Reader<'_>) -> Option<Option<EventKind>> {
    let kind = reader.u8()?;
    let len = reader.varint()?;
    let mut data = reader.bytes(len as usize)?;
    let event = match kind {
        EVENT_VIEWPORT => {
            let render_width = data.read_u16::<LE>().ok()?;
            let render_height = data.read_u16::<LE>().ok()?;
            let zoom = data.read_f32::<LE>().ok()?;
            zoom.is_finite().then_some(EventKind::Viewport(Viewport {
                render_width,
                render_height,
                zoom,
            }))
        }
        EVENT_BUTTON => {
            let button = data.read_u8().ok()?;
            let down = data.read_u8().ok()? != 0;
            MouseButton::from_u8(button).map(|button| EventKind::Button { button, down })
        }
        EVENT_FOCUS => Some(EventKind::Focus(data.read_u8().ok()? != 0)),
        EVENT_DRAG => {
            let active = data.read_u8().ok()? != 0;
            let x = data.read_i16::<LE>().ok()?;
            let y = data.read_i16::<LE>().ok()?;
            Some(EventKind::Drag(active.then_some((x, y))))
        }
        _ => None,
    };
    Some(event)
}

/// A parsed `SbFp` section.
#[derive(Debug, Clone, PartialEq)]
pub struct Section {
    pub game_id: [u8; 16],
    pub tracks: Vec<Track>,
}

/// Appends an `SbFp` section holding `tracks` (at most 255) to `out`, including the section id
/// and length that precede every replay section.
///
/// ```text
/// u32 section_id (SECTION_ID)
/// u32 data_length (not counting these first 8 bytes)
/// 0x0     u8 format_major (1)
///     Readers skip the whole section when this is newer than they know.
/// 0x1     u8 format_minor (0)
///     Only additive changes.
/// 0x2     u16 header_length
///     Bytes from the start of the data to the first track entry (0x16 in 1.0).
/// 0x4     u8 game_id[16]
///     Same bytes as the Sbat section's game_id_uuid.
/// 0x14    u8 track_count
/// 0x15    u8 reserved
/// --- Track entries, back to back ---
/// 0x0     u16 entry_header_length (0x1c in 1.0)
/// 0x2     u8 codec (2)
///     Readers skip payloads of codecs they don't know, which includes 1.
/// 0x3     u8 flags
///     0x1 relayed: recorded by another client than the one that saved the replay
///     0x2 synthesized: generated afterwards rather than recorded from a player's input
///     0x4 truncated (TRACK_FLAG_TRUNCATED)
/// 0x4     u32 sb_user_id
/// 0x8     u8 storm_id (0xff if unknown)
/// 0x9     u8 bw_player_id (0xff if unknown or an observer)
/// 0xa     u16 reserved
/// 0xc     u32 first_frame
/// 0x10    u32 last_frame
/// 0x14    u32 uncompressed_length
/// 0x18    u32 payload_length
/// entry_header_length:
///         u8 payload[payload_length]
///     A zstd-compressed codec 2 payload (see `encode_payload`) of uncompressed_length bytes.
/// ```
/// All values are little endian. `out` is left unchanged on error.
pub fn write_section(out: &mut Vec<u8>, game_id: [u8; 16], tracks: &[Track]) -> io::Result<()> {
    let start = out.len();
    let result = write_section_inner(out, game_id, tracks, &DEFAULT_QUANTIZATION);
    if result.is_err() {
        out.truncate(start);
    }
    result
}

fn write_section_inner(
    out: &mut Vec<u8>,
    game_id: [u8; 16],
    tracks: &[Track],
    quantization: &[(u32, u32)],
) -> io::Result<()> {
    let track_count = u8::try_from(tracks.len())
        .map_err(|_| io::Error::new(io::ErrorKind::InvalidInput, "too many tracks"))?;
    out.write_u32::<LE>(SECTION_ID)?;
    let length_pos = out.len();
    out.write_u32::<LE>(0)?;
    let data_start = out.len();
    out.write_u8(FORMAT_MAJOR)?;
    out.write_u8(FORMAT_MINOR)?;
    out.write_u16::<LE>(SECTION_HEADER_LENGTH)?;
    out.extend_from_slice(&game_id);
    out.write_u8(track_count)?;
    out.write_u8(0)?;
    for track in tracks {
        let (payload, uncompressed_length) = encode_track_payload(track, quantization)?;
        let payload_length = u32::try_from(payload.len()).map_err(|_| too_large())?;
        out.write_u16::<LE>(ENTRY_HEADER_LENGTH)?;
        out.write_u8(CODEC_TICKS)?;
        out.write_u8(track.flags)?;
        out.write_u32::<LE>(track.owner.sb_user_id)?;
        out.write_u8(track.owner.storm_id)?;
        out.write_u8(track.owner.bw_player_id)?;
        out.write_u16::<LE>(0)?;
        out.write_u32::<LE>(track.first_frame().unwrap_or(0))?;
        out.write_u32::<LE>(track.last_frame().unwrap_or(0))?;
        out.write_u32::<LE>(uncompressed_length)?;
        out.write_u32::<LE>(payload_length)?;
        out.extend_from_slice(&payload);
    }
    let length = u32::try_from(out.len() - data_start)
        .map_err(|_| io::Error::new(io::ErrorKind::InvalidInput, "section is too large"))?;
    (&mut out[length_pos..]).write_u32::<LE>(length)?;
    Ok(())
}

struct EntryHeader {
    codec: u8,
    flags: u8,
    owner: TrackOwner,
    uncompressed_length: u32,
}

/// Splits one track entry off the front of `data`, returning its header, payload, and the data
/// after it.
fn split_entry(data: &[u8]) -> Option<(EntryHeader, &[u8], &[u8])> {
    let mut header = data;
    let header_length = header.read_u16::<LE>().ok()?;
    if header_length < ENTRY_HEADER_LENGTH {
        return None;
    }
    let codec = header.read_u8().ok()?;
    let flags = header.read_u8().ok()?;
    let sb_user_id = header.read_u32::<LE>().ok()?;
    let storm_id = header.read_u8().ok()?;
    let bw_player_id = header.read_u8().ok()?;
    let _reserved = header.read_u16::<LE>().ok()?;
    let _first_frame = header.read_u32::<LE>().ok()?;
    let _last_frame = header.read_u32::<LE>().ok()?;
    let uncompressed_length = header.read_u32::<LE>().ok()?;
    let payload_length = header.read_u32::<LE>().ok()?;
    let after_header = data.get(header_length as usize..)?;
    let (payload, rest) = after_header.split_at_checked(payload_length as usize)?;
    let entry = EntryHeader {
        codec,
        flags,
        owner: TrackOwner {
            sb_user_id,
            storm_id,
            bw_player_id,
        },
        uncompressed_length,
    };
    Some((entry, payload, rest))
}

/// Decompresses `payload`, returning `None` unless it decompresses to exactly `expected_len`
/// bytes. Decompression stops with an error rather than output more than `expected_len` bytes,
/// so an oversized stream costs no more than that.
fn decompress(payload: &[u8], expected_len: u32) -> Option<Vec<u8>> {
    let out = zstd::bulk::decompress(payload, expected_len as usize).ok()?;
    (out.len() == expected_len as usize).then_some(out)
}

/// Parses an `SbFp` section's data (after the section id and length). Returns `None` if the
/// header is malformed or from a newer major format. Tracks with unknown codecs or payloads that
/// fail to decompress are skipped; a track whose payload is malformed keeps what decoded before
/// the malformation and is flagged [`TRACK_FLAG_TRUNCATED`].
pub fn parse_section(payload: &[u8]) -> Option<Section> {
    let mut header = payload;
    let format_major = header.read_u8().ok()?;
    if format_major != FORMAT_MAJOR {
        debug!("Skipping first-person section with format {format_major}");
        return None;
    }
    let _format_minor = header.read_u8().ok()?;
    let header_length = header.read_u16::<LE>().ok()?;
    if header_length < SECTION_HEADER_LENGTH {
        return None;
    }
    let game_id: [u8; 16] = payload.get(0x4..0x14)?.try_into().ok()?;
    let track_count = *payload.get(0x14)?;
    let mut rest = payload.get(header_length as usize..)?;

    let mut tracks = Vec::with_capacity(track_count as usize);
    let mut uncompressed_budget = MAX_SECTION_UNCOMPRESSED;
    let mut decode_budget = DecodeBudget::section();
    for i in 0..track_count {
        let Some((entry, track_payload, next)) = split_entry(rest) else {
            warn!("First-person track entry {i} is malformed, ignoring the rest");
            break;
        };
        rest = next;
        if entry.codec != CODEC_TICKS {
            debug!("Skipping first-person track {i} with codec {}", entry.codec);
            continue;
        }
        if entry.uncompressed_length > MAX_TRACK_UNCOMPRESSED
            || entry.uncompressed_length as u64 > uncompressed_budget
        {
            warn!(
                "Skipping first-person track {i}: {} bytes uncompressed is too large",
                entry.uncompressed_length,
            );
            continue;
        }
        uncompressed_budget -= entry.uncompressed_length as u64;
        let Some(data) = decompress(track_payload, entry.uncompressed_length) else {
            warn!("Skipping first-person track {i}: payload failed to decompress");
            continue;
        };
        let decoded = decode_payload(&data, &mut decode_budget);
        if decoded.truncated {
            warn!("First-person track {i} is malformed, keeping the part before that");
        }
        tracks.push(decoded.into_track(entry.owner, entry.flags));
    }
    Some(Section { game_id, tracks })
}

#[cfg(test)]
mod test {
    use super::*;

    /// xorshift64*, for deterministic synthetic tracks and mutations.
    struct Rng(u64);

    impl Rng {
        fn next_u64(&mut self) -> u64 {
            self.0 ^= self.0 >> 12;
            self.0 ^= self.0 << 25;
            self.0 ^= self.0 >> 27;
            self.0.wrapping_mul(0x2545_f491_4f6c_dd1d)
        }

        fn below(&mut self, limit: u32) -> u32 {
            (self.next_u64() >> 32) as u32 % limit
        }

        fn signed(&mut self, magnitude: i32) -> i32 {
            self.below(magnitude as u32 * 2 + 1) as i32 - magnitude
        }
    }

    /// Milliseconds per frame at the Fastest game speed, which synthetic tracks are recorded at.
    const FRAME_MS: u32 = 42;

    /// A quantization table for tracks of 1 tick a frame, with the same speeds per second as
    /// [`DEFAULT_QUANTIZATION`] at 2 ticks a frame.
    const ONE_PER_FRAME_QUANTIZATION: [(u32, u32); 2] = [(16, 2), (48, 4)];

    fn owner(sb_user_id: u32) -> TrackOwner {
        TrackOwner {
            sb_user_id,
            storm_id: 1,
            bw_player_id: 2,
        }
    }

    fn sample(frame: u32, sub: u8, cursor: (i16, i16), screen: (u16, u16)) -> Sample {
        Sample {
            frame,
            sub,
            cursor,
            screen,
            region: CursorRegion::Game,
            cursor_type: 0,
        }
    }

    fn event(frame: u32, sub: u8, kind: EventKind) -> Event {
        Event { frame, sub, kind }
    }

    fn fields(cursor: (i16, i16), screen: (u16, u16)) -> SampleFields {
        SampleFields {
            cursor,
            screen,
            ..SampleFields::INITIAL
        }
    }

    fn track_event(tick: u32, kind: EventKind) -> TrackEvent {
        TrackEvent { tick, kind }
    }

    fn tick_track(
        ticks_per_frame: u8,
        first_tick: u32,
        ticks: Vec<SampleFields>,
        events: Vec<TrackEvent>,
    ) -> Track {
        Track {
            owner: owner(1),
            flags: 0,
            ticks_per_frame,
            first_tick,
            ticks,
            events,
        }
    }

    /// A track of 1 tick a frame holding just `cursors`, from `first_tick` on.
    fn cursor_track(first_tick: u32, cursors: &[(i16, i16)]) -> Track {
        let ticks = cursors.iter().map(|&c| fields(c, (0, 0))).collect();
        tick_track(1, first_tick, ticks, Vec::new())
    }

    fn resample(ticks_per_frame: u8, samples: &[Sample], events: &[Event]) -> Track {
        Track::resample(owner(1), 0, ticks_per_frame, samples, events)
    }

    fn synthetic_track(seconds: u32, seed: u64) -> Track {
        synthetic_recorder(seconds, seed, 1200, 2).snapshot(false)
    }

    /// A player's input at 60 Hz over a game at Fastest: eased cursor moves with flicks and
    /// pauses of up to `max_pause_ms`, edge scrolls, camera jumps, clicks, box drags, zoom changes
    /// and an alt-tab.
    fn synthetic_recorder(
        seconds: u32,
        seed: u64,
        max_pause_ms: u32,
        ticks_per_frame: u8,
    ) -> TrackRecorder {
        let mut rng = Rng(seed);
        let mut recorder = TrackRecorder::new(owner(1234), ticks_per_frame);
        let viewport = Viewport {
            render_width: 1920,
            render_height: 1080,
            zoom: 1.0,
        };
        recorder.push_event(event(0, 0, EventKind::Viewport(viewport)));

        let total_ms = seconds * 1000;
        let mut cursor = (960.0f64, 540.0f64);
        let mut target = cursor;
        let mut speed = 0.2;
        let mut pause_until = 0u32;
        let mut screen = (1024i32, 1024i32);
        let mut scroll: Option<((i32, i32), u32)> = None;
        let mut release: Option<(u32, MouseButton, bool)> = None;
        let mut unfocused_until: Option<u32> = None;
        let mut now = 0u32;
        let mut tick = 0u32;
        while now < total_ms {
            let frame = now / FRAME_MS;
            let sub = ((now % FRAME_MS) * SUBFRAMES as u32 / FRAME_MS) as u8;
            let stamp = |kind| event(frame, sub, kind);

            if let Some((at, button, dragging)) = release
                && now >= at
            {
                recorder.push_event(stamp(EventKind::Button {
                    button,
                    down: false,
                }));
                if dragging {
                    recorder.push_event(stamp(EventKind::Drag(None)));
                }
                release = None;
            }

            if now >= pause_until {
                let dx = target.0 - cursor.0;
                let dy = target.1 - cursor.1;
                if dx.abs() < 1.0 && dy.abs() < 1.0 {
                    pause_until = now + rng.below(max_pause_ms + 1);
                    if release.is_none() && rng.below(3) == 0 {
                        let button = match rng.below(4) {
                            0 => MouseButton::Left,
                            _ => MouseButton::Right,
                        };
                        let dragging = button == MouseButton::Left && rng.below(2) == 0;
                        recorder.push_event(stamp(EventKind::Button { button, down: true }));
                        if dragging {
                            let at = (cursor.0 as i16, cursor.1 as i16);
                            recorder.push_event(stamp(EventKind::Drag(Some(at))));
                        }
                        release = Some((now + 60 + rng.below(300), button, dragging));
                    }
                    let flick = rng.below(4) == 0;
                    target = if flick {
                        (rng.below(1920) as f64, rng.below(1080) as f64)
                    } else {
                        (
                            (cursor.0 + rng.signed(150) as f64).clamp(0.0, 1919.0),
                            (cursor.1 + rng.signed(150) as f64).clamp(0.0, 1079.0),
                        )
                    };
                    speed = if flick { 0.35 } else { 0.15 };
                } else {
                    cursor.0 += dx * speed + rng.signed(1) as f64 * 0.5;
                    cursor.1 += dy * speed + rng.signed(1) as f64 * 0.5;
                }
            }

            let mut cursor_type = 0;
            match scroll {
                Some(((sx, sy), until)) if now < until => {
                    screen.0 = (screen.0 + sx).clamp(0, 8192);
                    screen.1 = (screen.1 + sy).clamp(0, 8192);
                    cursor_type = 11;
                }
                _ => {
                    scroll = None;
                    if rng.below(300) == 0 {
                        let step = [(-16, 0), (16, 0), (0, -16), (0, 16)][rng.below(4) as usize];
                        scroll = Some((step, now + 200 + rng.below(800)));
                    } else if rng.below(400) == 0 {
                        screen = (rng.below(8000) as i32, rng.below(8000) as i32);
                    }
                }
            }

            if tick % 3000 == 1500 {
                let zoom = if (tick / 3000).is_multiple_of(2) {
                    1.25
                } else {
                    1.0
                };
                recorder.push_event(stamp(EventKind::Viewport(Viewport { zoom, ..viewport })));
            }
            match unfocused_until {
                None if now >= total_ms * 3 / 5 => {
                    recorder.push_event(stamp(EventKind::Focus(false)));
                    unfocused_until = Some(now + 3000);
                }
                Some(until) if until != 0 && now >= until => {
                    recorder.push_event(stamp(EventKind::Focus(true)));
                    unfocused_until = Some(0);
                }
                _ => (),
            }

            let region = if cursor.1 > 860.0 {
                CursorRegion::Ui
            } else {
                CursorRegion::Game
            };
            recorder.push_sample(Sample {
                frame,
                sub,
                cursor: (cursor.0 as i16, cursor.1 as i16),
                screen: (screen.0 as u16, screen.1 as u16),
                region,
                cursor_type,
            });
            now += if tick % 3 == 2 { 16 } else { 17 };
            tick += 1;
        }
        recorder
    }

    /// Checks the invariants every track keeps, however it was made.
    fn assert_valid(track: &Track) {
        assert!((1..=MAX_TICKS_PER_FRAME).contains(&track.ticks_per_frame));
        assert!(track.ticks.len() <= MAX_TRACK_TICKS as usize);
        if let Some(count) = track.ticks.len().checked_sub(1) {
            assert!(track.first_tick.checked_add(count as u32).is_some());
        }
        assert!(track.ticks.iter().all(|t| t.cursor_type <= MAX_CURSOR_TYPE));
        assert!(track.events.len() <= MAX_TRACK_EVENTS as usize);
        assert!(track.events.windows(2).all(|w| w[0].tick <= w[1].tick));
    }

    fn decode(data: &[u8]) -> DecodedTrack {
        decode_payload(data, &mut DecodeBudget::section())
    }

    /// `track` as written with `quantization` and read back.
    fn reencode(track: &Track, quantization: &[(u32, u32)]) -> Track {
        let payload = encode_payload(track, quantization).unwrap();
        let decoded = decode(&payload);
        assert!(!decoded.truncated);
        decoded.into_track(track.owner, track.flags)
    }

    fn compress(data: &[u8]) -> Vec<u8> {
        zstd::bulk::compress(data, 3).unwrap()
    }

    fn zigzags(values: &[i32]) -> Vec<u8> {
        let mut out = Vec::new();
        for &value in values {
            write_zigzag(&mut out, value);
        }
        out
    }

    fn varints(values: &[u32]) -> Vec<u8> {
        let mut out = Vec::new();
        for &value in values {
            write_varint(&mut out, value);
        }
        out
    }

    /// An uncompressed payload with hand-made header values and `columns`.
    fn payload(
        ticks_per_frame: u8,
        quantization: &[(u32, u32)],
        first_tick: u32,
        tick_count: u32,
        columns: [&[u8]; COLUMN_COUNT],
    ) -> Vec<u8> {
        let mut out = vec![ticks_per_frame, quantization.len() as u8];
        for &(speed_over, step) in quantization {
            write_varint(&mut out, speed_over);
            write_varint(&mut out, step);
        }
        write_varint(&mut out, first_tick);
        write_varint(&mut out, tick_count);
        for column in columns {
            write_varint(&mut out, column.len() as u32);
        }
        for column in columns {
            out.extend_from_slice(column);
        }
        out
    }

    /// A payload of `tick_count` ticks at (0, 0), with no changes or events.
    fn resting_payload(first_tick: u32, tick_count: u32) -> Vec<u8> {
        let zeros = vec![0; tick_count as usize];
        payload(
            1,
            &[],
            first_tick,
            tick_count,
            [&zeros, &zeros, &[], &[], &[], &[], &[], &[], &[]],
        )
    }

    /// Section data (after the id and length) with hand-made entries of
    /// `(codec, uncompressed_length, payload)`, owned by user 55.
    fn raw_section(entries: &[(u8, u32, &[u8])]) -> Vec<u8> {
        let mut out = vec![FORMAT_MAJOR, FORMAT_MINOR];
        out.write_u16::<LE>(SECTION_HEADER_LENGTH).unwrap();
        out.extend_from_slice(&[7; 16]);
        out.push(entries.len() as u8);
        out.push(0);
        for &(codec, uncompressed_length, payload) in entries {
            out.write_u16::<LE>(ENTRY_HEADER_LENGTH).unwrap();
            out.push(codec);
            out.push(0);
            out.write_u32::<LE>(55).unwrap();
            out.extend_from_slice(&[0, 0, 0, 0]);
            out.write_u32::<LE>(0).unwrap();
            out.write_u32::<LE>(0).unwrap();
            out.write_u32::<LE>(uncompressed_length).unwrap();
            out.write_u32::<LE>(payload.len() as u32).unwrap();
            out.extend_from_slice(payload);
        }
        out
    }

    fn raw_owner() -> TrackOwner {
        TrackOwner {
            sb_user_id: 55,
            storm_id: 0,
            bw_player_id: 0,
        }
    }

    /// Checks a written section's id and length, returning its data.
    fn section_data(section: &[u8]) -> &[u8] {
        let id = (&section[0..]).read_u32::<LE>().unwrap();
        let length = (&section[4..]).read_u32::<LE>().unwrap();
        assert_eq!(id, SECTION_ID);
        assert_eq!(&section[0..4], b"SbFp");
        assert_eq!(length as usize, section.len() - 8);
        &section[8..]
    }

    #[test]
    fn payload_bytes() {
        let ui = |cursor, screen| SampleFields {
            region: CursorRegion::Ui,
            cursor_type: 4,
            ..fields(cursor, screen)
        };
        let track = tick_track(
            2,
            10,
            vec![
                fields((1, -1), (0, 0)),
                ui((4, -3), (300, 2)),
                ui((7, -5), (300, 2)),
                ui((20, -5), (300, 2)),
                ui((40, -5), (300, 2)),
            ],
            vec![
                track_event(
                    10,
                    EventKind::Button {
                        button: MouseButton::Left,
                        down: true,
                    },
                ),
                track_event(12, EventKind::Focus(false)),
            ],
        );
        let data = encode_payload(&track, &DEFAULT_QUANTIZATION).unwrap();
        #[rustfmt::skip]
        let expected = [
            // Ticks per frame, the quantization table, first tick, tick count.
            2, 2, 8, 2, 24, 4, 10, 5,
            // Column lengths.
            5, 5, 1, 2, 1, 1, 1, 2, 7,
            // Cursor x codes: 1 from 0; 2 off the predicted 2; on the predicted 7; 10 off the
            // predicted 10; then moving 13 a tick, in steps of 2: 3.5 steps off the predicted 33,
            // rounded to 4.
            2, 4, 0, 20, 8,
            // Cursor y codes: -1, -1 off the predicted -2, 0, 2 off the predicted -7, 0.
            1, 1, 0, 4, 0,
            // The camera changes on the second tick, by (+300, +2).
            1, 0xd8, 0x04, 4,
            // The state changes on the second tick, to Ui and cursor type 4.
            1, 0x84,
            // Events on ticks 10 and 12.
            10, 2,
            EVENT_BUTTON, 2, 0, 1,
            EVENT_FOCUS, 1, 0,
        ];
        assert_eq!(data, expected);

        let decoded = decode(&data);
        assert!(!decoded.truncated);
        let mut quantized = track.clone();
        quantized.ticks[4].cursor = (41, -5);
        assert_eq!(decoded.into_track(track.owner, track.flags), quantized);
        // Without quantization, the last tick is exact.
        assert_eq!(reencode(&track, &[]), track);
    }

    #[test]
    fn payload_round_trip() {
        let track = synthetic_track(120, 1);
        assert_valid(&track);
        assert_eq!(track.flags, 0);
        // 2 ticks a frame over 2 minutes of 42 ms frames.
        assert!(track.ticks.len() > 5500, "{}", track.ticks.len());
        assert!(track.events.len() > 50);
        for kind in 0..4 {
            assert!(track.events.iter().any(|e| {
                matches!(
                    (kind, e.kind),
                    (0, EventKind::Viewport(_))
                        | (1, EventKind::Button { .. })
                        | (2, EventKind::Focus(_))
                        | (3, EventKind::Drag(_))
                )
            }));
        }
        assert!(track.events.windows(2).any(|w| w[0].tick == w[1].tick));
        let jump = |w: &[SampleFields]| (w[0].screen.0 as i32 - w[1].screen.0 as i32).abs();
        assert!(track.ticks.windows(2).any(|w| jump(w) > MAX_SCROLL_STEP));
        assert!(track.ticks.windows(2).any(|w| w[0].region != w[1].region));
        assert!(
            track
                .ticks
                .windows(2)
                .any(|w| w[0].cursor_type != w[1].cursor_type)
        );

        // Without quantization, exact.
        assert_eq!(reencode(&track, &[]), track);
        // Quantization only moves cursor positions, and a quantized track is written as it is.
        for quantization in [DEFAULT_QUANTIZATION, ONE_PER_FRAME_QUANTIZATION] {
            let once = reencode(&track, &quantization);
            assert_ne!(once, track);
            assert_eq!(once.events, track.events);
            assert!(once.ticks.iter().zip(&track.ticks).all(|(a, b)| {
                a.screen == b.screen && a.region == b.region && a.cursor_type == b.cursor_type
            }));
            assert_eq!(reencode(&once, &quantization), once);
        }

        let (compressed, length) = encode_track_payload(&track, &DEFAULT_QUANTIZATION).unwrap();
        let decoded = decode(&decompress(&compressed, length).unwrap());
        assert!(!decoded.truncated);
        assert_eq!(
            decoded.into_track(track.owner, track.flags),
            reencode(&track, &DEFAULT_QUANTIZATION),
        );
    }

    #[test]
    fn quantized_round_trip_is_stable_anywhere() {
        // Wild jumps across the whole i16 range, which clamping at its ends cuts short.
        let mut rng = Rng(77);
        let mut cursor = (0i32, 0i32);
        let cursors: Vec<(i16, i16)> = (0..5000)
            .map(|_| {
                let reach = [2, 30, 3000, 70000][rng.below(4) as usize];
                cursor.0 = (cursor.0 + rng.signed(reach)).clamp(-32768, 32767);
                cursor.1 = (cursor.1 + rng.signed(reach)).clamp(-32768, 32767);
                (cursor.0 as i16, cursor.1 as i16)
            })
            .collect();
        let track = cursor_track(3, &cursors);
        assert!(cursors.iter().any(|&c| c.0 == i16::MIN || c.1 == i16::MAX));
        assert_eq!(reencode(&track, &[]), track);
        for quantization in [
            &DEFAULT_QUANTIZATION[..],
            &ONE_PER_FRAME_QUANTIZATION,
            &[(4096, 4096)],
            &[
                (4, 1),
                (5, 2),
                (6, 3),
                (7, 4),
                (8, 4),
                (9, 4),
                (10, 4),
                (11, 4),
            ],
        ] {
            let once = reencode(&track, quantization);
            assert_eq!(reencode(&once, quantization), once);
        }
    }

    #[test]
    fn invalid_quantization_rejected() {
        let track = cursor_track(0, &[(1, 2)]);
        for quantization in [
            &[(8, 0)][..],
            &[(8, 2), (8, 4)],
            &[(24, 4), (8, 2)],
            // Steps above the first level's speed can keep a resting cursor oscillating.
            &[(4, 8)],
            &[(2, 2), (24, 4)],
            &[(8000, MAX_QUANTIZATION_STEP + 1)],
            &[(1, 1); MAX_QUANTIZATION_LEVELS + 1],
        ] {
            assert!(
                encode_payload(&track, quantization).is_err(),
                "{quantization:?}"
            );
        }
    }

    #[test]
    fn quantization_error_is_bounded() {
        let track = synthetic_track(60, 12);
        for quantization in [DEFAULT_QUANTIZATION, ONE_PER_FRAME_QUANTIZATION] {
            let quantized = reencode(&track, &quantization);
            // Follows the decoded movement to know each tick's step.
            let mut coder = CursorCoder::new(&quantization);
            let mut inexact = 0;
            for (i, (original, decoded)) in track.ticks.iter().zip(&quantized.ticks).enumerate() {
                let step = coder.step() as u32;
                let error = (
                    original.cursor.0.abs_diff(decoded.cursor.0) as u32,
                    original.cursor.1.abs_diff(decoded.cursor.1) as u32,
                );
                assert!(
                    error.0 * 2 <= step && error.1 * 2 <= step,
                    "tick {i}: {error:?}"
                );
                if error != (0, 0) {
                    inexact += 1;
                }
                // Exact from the third tick of a rest on.
                let resting =
                    i >= 2 && (i - 2..i).all(|j| track.ticks[j].cursor == original.cursor);
                assert!(!resting || error == (0, 0), "tick {i}");
                coder.advance((decoded.cursor.0 as i32, decoded.cursor.1 as i32));
            }
            assert!(inexact > 50, "{inexact}");
        }
    }

    #[test]
    fn empty_track_round_trip() {
        let track = tick_track(2, 0, Vec::new(), Vec::new());
        let data = encode_payload(&track, &[]).unwrap();
        assert_eq!(data, [2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
        assert_eq!(reencode(&track, &DEFAULT_QUANTIZATION), track);
        assert!(track.is_empty());
        assert_eq!(track.first_frame(), None);
        assert_eq!(track.view_at(0.0), None);
        let recorded = TrackRecorder::new(owner(1), 2).snapshot(false);
        assert!(recorded.is_empty() && recorded.events.is_empty());
    }

    #[test]
    fn steady_motion_codes_to_zeros() {
        let straight: Vec<(i16, i16)> = (0..3000).map(|i| (100 + i * 3, 200 - i * 2)).collect();
        let mut rng = Rng(42);
        let mut wander = (0i16, 0i16);
        let random: Vec<(i16, i16)> = (0..3000)
            .map(|_| {
                wander.0 = wander.0.wrapping_add(rng.signed(20) as i16);
                wander.1 = wander.1.wrapping_add(rng.signed(20) as i16);
                wander
            })
            .collect();
        let straight = cursor_track(0, &straight);
        let columns = encode_columns(&straight, &[]).unwrap();
        // The first tick moves from (0, 0) to the start, and the second turns that movement into
        // the steady one.
        let zeros = vec![0; 2998];
        assert_eq!(
            columns.cursor_x,
            [zigzags(&[100, -97]), zeros.clone()].concat()
        );
        assert_eq!(columns.cursor_y, [zigzags(&[200, -202]), zeros].concat());

        let (straight, _) = encode_track_payload(&straight, &DEFAULT_QUANTIZATION).unwrap();
        let (random, _) =
            encode_track_payload(&cursor_track(0, &random), &DEFAULT_QUANTIZATION).unwrap();
        assert!(
            straight.len() * 10 < random.len(),
            "{} vs {}",
            straight.len(),
            random.len(),
        );
    }

    #[test]
    fn section_round_trip() {
        let mut first = synthetic_track(30, 2);
        first.flags = 0x1;
        let mut second = synthetic_recorder(45, 3, 1200, 3).snapshot(false);
        second.owner = TrackOwner {
            sb_user_id: 99,
            storm_id: 3,
            bw_player_id: UNKNOWN_PLAYER,
        };
        let empty = Track::empty(owner(5), TRACK_FLAG_TRUNCATED);
        let tracks = vec![first, second, empty];
        let game_id = *b"0123456789abcdef";

        let mut out = vec![0xaa, 0xbb];
        write_section(&mut out, game_id, &tracks).unwrap();
        assert_eq!(&out[..2], &[0xaa, 0xbb]);
        let data = section_data(&out[2..]);
        let entry = &data[SECTION_HEADER_LENGTH as usize..];
        assert_eq!(entry[2], CODEC_TICKS);
        let first_frame = (&entry[0xc..]).read_u32::<LE>().unwrap();
        let last_frame = (&entry[0x10..]).read_u32::<LE>().unwrap();
        assert_eq!(Some(first_frame), tracks[0].first_frame());
        assert_eq!(Some(last_frame), tracks[0].last_frame());

        let section = parse_section(data).unwrap();
        assert_eq!(section.game_id, game_id);
        let expected: Vec<Track> = tracks
            .iter()
            .map(|t| reencode(t, &DEFAULT_QUANTIZATION))
            .collect();
        assert_eq!(section.tracks, expected);
        assert_eq!(section.tracks[1].ticks_per_frame, 3);
    }

    #[test]
    fn too_many_tracks_leaves_output_unchanged() {
        let track = cursor_track(1, &[(1, 1)]);
        let mut out = vec![1, 2, 3];
        assert!(write_section(&mut out, [0; 16], &vec![track; 256]).is_err());
        assert_eq!(out, [1, 2, 3]);
    }

    #[test]
    fn unknown_codec_skipped() {
        let tracks = vec![synthetic_track(5, 4), synthetic_track(5, 5)];
        let expected = reencode(&tracks[1], &DEFAULT_QUANTIZATION);
        let mut out = Vec::new();
        write_section(&mut out, [1; 16], &tracks).unwrap();
        let mut data = section_data(&out).to_vec();
        data[SECTION_HEADER_LENGTH as usize + 2] = 7;
        let section = parse_section(&data).unwrap();
        assert_eq!(section.tracks, std::slice::from_ref(&expected));

        // A codec 1 entry beside a codec 2 one.
        let (payload, length) = encode_track_payload(&tracks[1], &DEFAULT_QUANTIZATION).unwrap();
        let data = raw_section(&[
            (1, 300, b"a codec 1 payload"),
            (CODEC_TICKS, length, &payload),
        ]);
        let section = parse_section(&data).unwrap();
        assert_eq!(
            section.tracks,
            [Track {
                owner: raw_owner(),
                flags: 0,
                ..expected
            }],
        );
    }

    #[test]
    fn longer_headers_skipped() {
        let tracks = vec![synthetic_track(5, 6), synthetic_track(5, 7)];
        let mut out = Vec::new();
        write_section(&mut out, [1; 16], &tracks).unwrap();
        let data = section_data(&out);

        // Grow the section header by 3 bytes and each entry header by 5, as a newer minor
        // version adding fields would.
        let mut grown = data[..SECTION_HEADER_LENGTH as usize].to_vec();
        (&mut grown[2..])
            .write_u16::<LE>(SECTION_HEADER_LENGTH + 3)
            .unwrap();
        grown.extend_from_slice(&[0xee; 3]);
        let mut rest = &data[SECTION_HEADER_LENGTH as usize..];
        while !rest.is_empty() {
            let payload_length = (&rest[0x18..]).read_u32::<LE>().unwrap() as usize;
            let entry_end = ENTRY_HEADER_LENGTH as usize;
            let mut header = rest[..entry_end].to_vec();
            (&mut header[0..])
                .write_u16::<LE>(ENTRY_HEADER_LENGTH + 5)
                .unwrap();
            grown.extend_from_slice(&header);
            grown.extend_from_slice(&[0xee; 5]);
            grown.extend_from_slice(&rest[entry_end..entry_end + payload_length]);
            rest = &rest[entry_end + payload_length..];
        }
        let expected: Vec<Track> = tracks
            .iter()
            .map(|t| reencode(t, &DEFAULT_QUANTIZATION))
            .collect();
        assert_eq!(parse_section(&grown).unwrap().tracks, expected);
    }

    #[test]
    fn unknown_event_type_skipped() {
        #[rustfmt::skip]
        let events = [
            // Unknown event type 9, then a known event, a button the reader doesn't know, and a
            // focus event with an extra trailing byte.
            9, 3, 0xff, 0xff, 0xff,
            EVENT_BUTTON, 2, 1, 0,
            EVENT_BUTTON, 2, 7, 1,
            EVENT_FOCUS, 2, 1, 0xee,
        ];
        let event_ticks = [3, 0, 0, 1];
        let data = payload(
            2,
            &[],
            6,
            1,
            [&[0], &[0], &[], &[], &[], &[], &[], &event_ticks, &events],
        );
        let decoded = decode(&data);
        assert!(!decoded.truncated);
        assert_eq!(decoded.ticks, [SampleFields::INITIAL]);
        let expected = [
            track_event(
                3,
                EventKind::Button {
                    button: MouseButton::Right,
                    down: false,
                },
            ),
            track_event(4, EventKind::Focus(true)),
        ];
        assert_eq!(decoded.events, expected);

        // The same through a section.
        let data = raw_section(&[(CODEC_TICKS, data.len() as u32, &compress(&data))]);
        let section = parse_section(&data).unwrap();
        assert_eq!(section.tracks[0].events, expected);
        assert_eq!(section.tracks[0].flags, 0);
    }

    #[test]
    fn malformed_payloads_truncate() {
        // Every prefix of a real payload.
        let track = synthetic_track(10, 9);
        let full = encode_payload(&track, &DEFAULT_QUANTIZATION).unwrap();
        for len in 0..full.len() {
            let decoded = decode(&full[..len]);
            assert!(decoded.truncated, "{len}");
            assert_valid(&decoded.into_track(track.owner, 0));
        }
        assert!(!decode(&full).truncated);

        let two = |columns: [&[u8]; COLUMN_COUNT]| decode(&payload(1, &[], 0, 2, columns));
        let cursor: &[u8] = &zigzags(&[5, 1]);
        // A cursor column running out: an unfinished varint.
        let decoded = two([&[10, 0x80], cursor, &[], &[], &[], &[], &[], &[], &[]]);
        assert!(decoded.truncated);
        assert_eq!(decoded.ticks, [fields((5, 5), (0, 0))]);
        // A cursor code beyond 32 bits.
        let wide = [0, 0x80, 0x80, 0x80, 0x80, 0x10];
        let decoded = two([&wide, &[0; 6], &[], &[], &[], &[], &[], &[], &[]]);
        assert!(decoded.truncated);
        assert_eq!(decoded.ticks.len(), 1);
        // Cursor data left over after the last tick keeps the ticks.
        let decoded = two([&[2, 0, 0], cursor, &[], &[], &[], &[], &[], &[], &[]]);
        assert!(decoded.truncated);
        assert_eq!(decoded.ticks.len(), 2);

        // A camera change past the last tick: the earlier change holds for the rest.
        let x = zigzags(&[16, 32]);
        let decoded = two([cursor, cursor, &[0, 2], &x, &[0, 0], &[], &[], &[], &[]]);
        assert!(decoded.truncated);
        assert_eq!(decoded.ticks[0].screen, (16, 0));
        assert_eq!(decoded.ticks[1].screen, (16, 0));
        // The same tick beyond u32.
        let ticks = varints(&[1, u32::MAX]);
        let decoded = two([cursor, cursor, &ticks, &x, &[0, 0], &[], &[], &[], &[]]);
        assert!(decoded.truncated);
        assert_eq!(decoded.ticks[1].screen, (16, 0));
        // The camera moving out of u16 range.
        let decoded = two([
            cursor,
            cursor,
            &[1],
            &zigzags(&[-1]),
            &[0],
            &[],
            &[],
            &[],
            &[],
        ]);
        assert!(decoded.truncated);
        assert_eq!(decoded.ticks[1].screen, (0, 0));
        // A camera change too large to add to the camera's position at all.
        let decoded = two([
            cursor,
            cursor,
            &[0, 1],
            &zigzags(&[u16::MAX as i32, i32::MAX]),
            &zigzags(&[0, i32::MIN]),
            &[],
            &[],
            &[],
            &[],
        ]);
        assert!(decoded.truncated);
        assert_eq!(decoded.ticks[1].screen, (u16::MAX, 0));
        // A camera change without its y.
        let decoded = two([cursor, cursor, &[0, 1], &x, &[0], &[], &[], &[], &[]]);
        assert!(decoded.truncated);
        assert_eq!(decoded.ticks[1].screen, (16, 0));
        // Camera values left over.
        let decoded = two([cursor, cursor, &[1], &x, &[0, 0], &[], &[], &[], &[]]);
        assert!(decoded.truncated);
        assert_eq!(decoded.ticks[1].screen, (16, 0));

        // A state change past the last tick, and one without its value.
        let decoded = two([cursor, cursor, &[], &[], &[], &[0, 2], &[0x85, 1], &[], &[]]);
        assert!(decoded.truncated);
        assert_eq!(decoded.ticks[1].region, CursorRegion::Ui);
        assert_eq!(decoded.ticks[1].cursor_type, 5);
        let decoded = two([cursor, cursor, &[], &[], &[], &[0, 1], &[0x85], &[], &[]]);
        assert!(decoded.truncated);
        assert_eq!(decoded.ticks[1].cursor_type, 5);

        // An event tick overflowing u32 keeps the events before it.
        let focus = [EVENT_FOCUS, 1, 0, EVENT_FOCUS, 1, 1];
        let ticks = varints(&[u32::MAX, 1]);
        let decoded = two([cursor, cursor, &[], &[], &[], &[], &[], &ticks, &focus]);
        assert!(decoded.truncated);
        assert_eq!(
            decoded.events,
            [track_event(u32::MAX, EventKind::Focus(false))]
        );
        // An event tick without its event, and a known event too short for its type.
        let decoded = two([
            cursor,
            cursor,
            &[],
            &[],
            &[],
            &[],
            &[],
            &[1, 1],
            &focus[..3],
        ]);
        assert!(decoded.truncated);
        assert_eq!(decoded.events.len(), 1);
        let decoded = two([
            cursor,
            cursor,
            &[],
            &[],
            &[],
            &[],
            &[],
            &[1],
            &[EVENT_DRAG, 1, 1],
        ]);
        assert!(decoded.truncated);
        assert!(decoded.events.is_empty());
        // An event left without a tick.
        let decoded = two([cursor, cursor, &[], &[], &[], &[], &[], &[1], &focus]);
        assert!(decoded.truncated);
        assert_eq!(decoded.events.len(), 1);

        // Data after the columns.
        let mut data = resting_payload(0, 1);
        assert!(!decode(&data).truncated);
        data.push(0);
        assert!(decode(&data).truncated);
        // Columns longer than the payload.
        let mut data = payload(
            1,
            &[],
            0,
            1,
            [&[0], &[0], &[], &[], &[], &[], &[], &[0], &[0; 3]],
        );
        data.pop();
        let decoded = decode(&data);
        assert!(decoded.truncated);
        assert!(decoded.ticks.is_empty() && decoded.events.is_empty());

        // Through a section, the track is kept and flagged.
        let raw = payload(
            1,
            &[],
            0,
            2,
            [&[10, 0x80], cursor, &[], &[], &[], &[], &[], &[], &[]],
        );
        let section = parse_section(&raw_section(&[(
            CODEC_TICKS,
            raw.len() as u32,
            &compress(&raw),
        )]))
        .unwrap();
        assert_eq!(section.tracks[0].flags, TRACK_FLAG_TRUNCATED);
        assert_eq!(section.tracks[0].ticks.len(), 1);
    }

    #[test]
    fn bad_header_values_skip_the_track() {
        let columns: [&[u8]; COLUMN_COUNT] = [&[2], &[2], &[], &[], &[], &[], &[], &[], &[]];
        let decodes = |ticks_per_frame: u8, quantization: &[(u32, u32)]| {
            let decoded = decode(&payload(ticks_per_frame, quantization, 0, 1, columns));
            if decoded.truncated {
                assert!(decoded.ticks.is_empty() && decoded.events.is_empty());
            }
            !decoded.truncated
        };
        assert!(decodes(1, &[]));
        assert!(decodes(8, &[]));
        assert!(!decodes(0, &[]));
        assert!(!decodes(9, &[]));
        assert!(decodes(1, &[(0, 1), (1, MAX_QUANTIZATION_STEP)]));
        assert!(decodes(1, &[(1, 1); 1]));
        assert!(!decodes(1, &[(8, 0)]));
        assert!(!decodes(1, &[(8, MAX_QUANTIZATION_STEP + 1)]));
        assert!(!decodes(1, &[(8, 2), (8, 4)]));
        assert!(!decodes(1, &[(24, 4), (8, 2)]));
        let many: Vec<(u32, u32)> = (0..9).map(|i| (i, 1)).collect();
        assert!(decodes(1, &many[..8]));
        assert!(!decodes(1, &many));
        // A table readers accept but writers refuse still decodes.
        assert!(decodes(1, &[(0, 4096)]));
    }

    #[test]
    fn hostile_tick_counts_rejected() {
        // Far more ticks than the cursor columns hold.
        let data = payload(
            1,
            &[],
            0,
            u32::MAX,
            [&[0], &[0], &[], &[], &[], &[], &[], &[], &[]],
        );
        let decoded = decode(&data);
        assert!(decoded.truncated && decoded.ticks.is_empty());
        // Ticks enough for the columns, but over the per-track limit.
        let decoded = decode(&resting_payload(0, MAX_TRACK_TICKS + 1));
        assert!(decoded.truncated && decoded.ticks.is_empty());
        // A last tick beyond u32.
        assert!(decode(&resting_payload(u32::MAX, 2)).truncated);
        let decoded = decode(&resting_payload(u32::MAX, 1));
        assert!(!decoded.truncated);
        let track = decoded.into_track(owner(1), 0);
        assert_eq!(track.last_frame(), Some(u32::MAX));
        assert!(track.view_at(u32::MAX as f64 + 0.5).is_some());

        // The section's budget runs out.
        let mut budget = DecodeBudget {
            ticks: 5,
            events: 10,
        };
        assert_eq!(
            decode_payload(&resting_payload(0, 3), &mut budget)
                .ticks
                .len(),
            3
        );
        let decoded = decode_payload(&resting_payload(0, 3), &mut budget);
        assert!(decoded.truncated && decoded.ticks.is_empty());
        assert_eq!(
            decode_payload(&resting_payload(0, 2), &mut budget)
                .ticks
                .len(),
            2
        );
        assert_eq!(budget.ticks, 0);

        let focus = [EVENT_FOCUS, 1, 0].repeat(3);
        let data = payload(
            1,
            &[],
            0,
            0,
            [&[], &[], &[], &[], &[], &[], &[], &[0, 0, 0], &focus],
        );
        let mut budget = DecodeBudget {
            ticks: 5,
            events: 4,
        };
        let decoded = decode_payload(&data, &mut budget);
        assert!(!decoded.truncated);
        assert_eq!(decoded.events.len(), 3);
        let decoded = decode_payload(&data, &mut budget);
        assert!(decoded.truncated);
        assert_eq!(decoded.events.len(), 1);
        assert_eq!(budget.events, 0);
    }

    #[test]
    fn newer_format_major_rejected() {
        let mut out = Vec::new();
        write_section(&mut out, [1; 16], &[synthetic_track(2, 8)]).unwrap();
        let mut data = section_data(&out).to_vec();
        assert!(parse_section(&data).is_some());
        data[0] = FORMAT_MAJOR + 1;
        assert!(parse_section(&data).is_none());
        data[0] = FORMAT_MAJOR;
        data[1] = FORMAT_MINOR + 1;
        assert!(parse_section(&data).is_some());
    }

    #[test]
    fn oversized_payloads_skipped() {
        let zeros = vec![0u8; 8 * 1024 * 1024];
        let bomb = compress(&zeros);
        // Without the decompressed size in its frame header.
        let unsized_bomb = zstd::stream::encode_all(&zeros[..], 3).unwrap();
        assert!(
            zstd::zstd_safe::get_frame_content_size(&unsized_bomb)
                .ok()
                .flatten()
                .is_none()
        );
        let small = resting_payload(1, 1);
        let small_len = small.len() as u32;
        let data = raw_section(&[
            // Decompress past their stated length.
            (CODEC_TICKS, 100, &bomb),
            (CODEC_TICKS, 100, &unsized_bomb),
            // States a length over the per-track limit.
            (CODEC_TICKS, MAX_TRACK_UNCOMPRESSED + 1, &bomb),
            // Decompress short of and past their stated length.
            (CODEC_TICKS, small_len + 1, &compress(&small)),
            (CODEC_TICKS, small_len - 1, &compress(&small)),
            // Not zstd.
            (CODEC_TICKS, small_len, &small),
            (CODEC_TICKS, small_len, &compress(&small)),
        ]);
        let section = parse_section(&data).unwrap();
        assert_eq!(section.tracks.len(), 1);
        assert_eq!(section.tracks[0].ticks, [SampleFields::INITIAL]);
        assert_eq!(section.tracks[0].first_tick, 1);
    }

    #[test]
    fn garbage_never_panics() {
        let mut rng = Rng(0x5eed);
        let track = synthetic_track(10, 9);
        let data = encode_payload(&track, &DEFAULT_QUANTIZATION).unwrap();
        let mut out = Vec::new();
        write_section(&mut out, [3; 16], &[track.clone(), synthetic_track(3, 10)]).unwrap();
        let section = section_data(&out).to_vec();
        let check = |track: &Track| {
            assert_valid(track);
            for time in [-1.0, 0.0, 30.0, 50.25, 1e12, f64::NAN] {
                let _ = track.view_at(time);
            }
            let _ = (track.first_frame(), track.last_frame());
            let _ = encode_payload(track, &DEFAULT_QUANTIZATION).unwrap();
        };

        for i in 0..3000u32 {
            let mut mutated = data.clone();
            // Mutate the header and the start of the columns often, as they steer the rest.
            let range = if i.is_multiple_of(2) {
                64.min(mutated.len() as u32)
            } else {
                mutated.len() as u32
            };
            for _ in 0..1 + rng.below(4) {
                let index = rng.below(range) as usize;
                mutated[index] = rng.next_u64() as u8;
            }
            if rng.below(4) == 0 {
                mutated.truncate(rng.below(mutated.len() as u32 + 1) as usize);
            }
            check(&decode(&mutated).into_track(track.owner, 0));
        }

        for i in 0..1000u32 {
            let mut mutated = section.clone();
            // Mostly mutate the headers, where a single flip reaches the most code.
            let range = if i.is_multiple_of(2) {
                0x40
            } else {
                mutated.len() as u32
            };
            for _ in 0..1 + rng.below(4) {
                let index = rng.below(range) as usize;
                mutated[index] = rng.next_u64() as u8;
            }
            if rng.below(4) == 0 {
                mutated.truncate(rng.below(mutated.len() as u32 + 1) as usize);
            }
            if let Some(section) = parse_section(&mutated) {
                section.tracks.iter().for_each(&check);
            }
        }

        for len in 0..200 {
            let random: Vec<u8> = (0..len).map(|_| rng.next_u64() as u8).collect();
            let _ = parse_section(&random);
            check(&decode(&random).into_track(track.owner, 0));
        }
    }

    #[test]
    fn ten_minutes_compresses_small() {
        // With pauses as a player makes them, and with the cursor never resting.
        for max_pause_ms in [1200, 0] {
            let track = synthetic_recorder(600, 11, max_pause_ms, 2).snapshot(false);
            let (payload, uncompressed_length) =
                encode_track_payload(&track, &DEFAULT_QUANTIZATION).unwrap();
            println!(
                "{max_pause_ms} ms pauses: {} ticks, {} events, {uncompressed_length} -> {} B",
                track.ticks.len(),
                track.events.len(),
                payload.len(),
            );
            assert!(track.ticks.len() > 28_000);
            assert!(payload.len() < 48 * 1024, "{} bytes", payload.len());
        }
    }

    fn view_track() -> Track {
        let ui = |screen| SampleFields {
            region: CursorRegion::Ui,
            cursor_type: 3,
            ..fields((0, 0), screen)
        };
        let viewport = |zoom| {
            EventKind::Viewport(Viewport {
                render_width: 640,
                render_height: 480,
                zoom,
            })
        };
        // Ticks 20 to 24 are at 10 to 12 frames.
        tick_track(
            2,
            20,
            vec![
                fields((0, 0), (0, 0)),
                fields((0, 0), (16, 0)),
                ui((32, 0)),
                ui((1000, 0)),
                ui((1000, 16)),
            ],
            vec![
                track_event(15, viewport(1.0)),
                track_event(21, EventKind::Drag(Some((120, 90)))),
                track_event(22, EventKind::Focus(false)),
                track_event(22, EventKind::Drag(None)),
                track_event(
                    23,
                    EventKind::Button {
                        button: MouseButton::Middle,
                        down: true,
                    },
                ),
                track_event(24, viewport(2.0)),
                track_event(40, EventKind::Focus(true)),
            ],
        )
    }

    #[test]
    fn view_passes_through_ticks() {
        let track = synthetic_track(20, 13);
        for (i, tick) in track.ticks.iter().enumerate() {
            let time = (track.first_tick as usize + i) as f64 / 2.0;
            let view = track.view_at(time).unwrap();
            assert_eq!(view.cursor, (tick.cursor.0 as f32, tick.cursor.1 as f32));
            assert_eq!(view.screen, (tick.screen.0 as f32, tick.screen.1 as f32));
            assert_eq!(view.region, tick.region);
            assert_eq!(view.cursor_type, tick.cursor_type);
        }
    }

    #[test]
    fn view_cursor_rests() {
        let xs = [100, 100, 100, 130, 160, 170, 175, 175, 175];
        let cursors = xs.map(|x| (x, 50));
        let track = cursor_track(10, &cursors);
        let at = |time: f64| {
            let cursor = track.view_at(time).unwrap().cursor;
            assert!((cursor.1 - 50.0).abs() < 1e-4, "{time}: {cursor:?}");
            cursor.0
        };
        let fractions = (0..=64).map(|i| i as f64 / 64.0);
        // Held exactly between two ticks at the same position.
        for f in fractions.clone() {
            assert_eq!(at(10.0 + f), 100.0);
            assert_eq!(at(11.0 + f), 100.0);
            assert_eq!(at(17.0 + f), 175.0);
        }
        // Leaving rest: eases out, never backwards or past the next tick.
        let mut previous = 100.0;
        for f in fractions.clone() {
            let x = at(12.0 + f);
            assert!(previous <= x && x <= 130.0, "{f}: {x}");
            previous = x;
        }
        assert!(at(12.125) < 100.0 + 30.0 * 0.125);
        // Coming to rest: eases in, never past the stop.
        let mut previous = 170.0;
        for f in fractions {
            let x = at(15.0 + f);
            assert!(previous <= x && x <= 175.0, "{f}: {x}");
            previous = x;
        }
        assert!(at(15.875) > 170.0 + 5.0 * 0.875);
        // Moving through ticks, it curves through them.
        assert_eq!(at(14.0), 160.0);
        assert!(at(13.5) > 130.0 && at(13.5) < 160.0);
        assert_eq!(at(100.0), 175.0);
    }

    #[test]
    fn view_camera_scrolls_and_jumps() {
        let track = view_track();
        assert_eq!(track.view_at(10.25).unwrap().screen, (8.0, 0.0));
        // A jump holds until its tick.
        assert_eq!(track.view_at(11.25).unwrap().screen, (32.0, 0.0));
        assert_eq!(track.view_at(11.4999).unwrap().screen, (32.0, 0.0));
        assert_eq!(track.view_at(11.5).unwrap().screen, (1000.0, 0.0));
        assert_eq!(track.view_at(11.75).unwrap().screen, (1000.0, 8.0));
        // Region and cursor type are the earlier tick's.
        let view = track.view_at(10.75).unwrap();
        assert_eq!((view.region, view.cursor_type), (CursorRegion::Game, 0));
        let view = track.view_at(11.0).unwrap();
        assert_eq!((view.region, view.cursor_type), (CursorRegion::Ui, 3));
    }

    #[test]
    fn view_events() {
        let track = view_track();
        // An event before the first tick applies from it on.
        let view = track.view_at(10.25).unwrap();
        assert_eq!(view.viewport.unwrap().zoom, 1.0);
        assert!(view.focused);
        assert_eq!(view.drag_start, None);
        assert!(!view.grab_panning);
        assert_eq!(track.view_at(10.5).unwrap().drag_start, Some((120, 90)));
        assert_eq!(track.view_at(10.9).unwrap().drag_start, Some((120, 90)));
        let view = track.view_at(11.0).unwrap();
        assert!(!view.focused);
        assert_eq!(view.drag_start, None);
        assert!(!view.grab_panning);
        assert!(track.view_at(11.5).unwrap().grab_panning);
        assert_eq!(track.view_at(12.0).unwrap().viewport.unwrap().zoom, 2.0);
        // Events after the last tick still apply.
        assert!(!track.view_at(19.9).unwrap().focused);
        assert!(track.view_at(20.0).unwrap().focused);
    }

    #[test]
    fn view_ends() {
        let track = view_track();
        assert_eq!(track.view_at(9.999), None);
        assert_eq!(track.view_at(f64::NAN), None);
        assert_eq!(track.view_at(f64::NEG_INFINITY), None);
        assert!(track.view_at(10.0).is_some());
        for time in [12.0, 1000.0, f64::INFINITY] {
            let view = track.view_at(time).unwrap();
            assert_eq!(view.screen, (1000.0, 16.0));
        }
        let empty = Track {
            ticks: Vec::new(),
            ..view_track()
        };
        assert_eq!(empty.view_at(15.0), None);
    }

    #[test]
    fn resample_between_samples() {
        // 10 2/8 and 10 6/8 frames, with ticks at 10 1/2 and 11.
        let samples = [
            sample(10, 2, (0, 0), (0, 0)),
            sample(10, 6, (100, 40), (16, 8)),
        ];
        let track = resample(2, &samples, &[]);
        assert_eq!(track.first_tick, 21);
        assert_eq!(
            track.ticks,
            [fields((50, 20), (8, 4)), fields((100, 40), (16, 8))],
        );
        assert_eq!(track.first_frame(), Some(10));
        assert_eq!(track.last_frame(), Some(11));
    }

    #[test]
    fn resample_holds_across_long_gaps() {
        let samples = [
            sample(10, 0, (5, 5), (0, 0)),
            // Over MAX_INTERPOLATION_GAP_FRAMES later.
            sample(16, 0, (50, 60), (100, 0)),
            sample(16, 4, (55, 65), (110, 0)),
        ];
        let track = resample(1, &samples, &[]);
        assert_eq!(track.first_tick, 10);
        let mut expected = vec![fields((5, 5), (0, 0)); 6];
        expected.push(fields((50, 60), (100, 0)));
        expected.push(fields((55, 65), (110, 0)));
        assert_eq!(track.ticks, expected);
    }

    #[test]
    fn resample_ticks_per_frame() {
        // 4 3/8 and 6 1/8 frames.
        let samples = [sample(4, 3, (0, 0), (0, 0)), sample(6, 1, (70, 0), (0, 0))];
        for (ticks_per_frame, first_tick, count) in [(1, 5, 3), (2, 9, 5), (3, 14, 6), (8, 35, 15)]
        {
            let track = resample(ticks_per_frame, &samples, &[]);
            assert_eq!(track.ticks_per_frame, ticks_per_frame);
            assert_eq!(
                (track.first_tick, track.ticks.len()),
                (first_tick, count),
                "{ticks_per_frame}",
            );
            assert_eq!(track.ticks.last().unwrap().cursor, (70, 0));
        }
        assert_eq!(resample(0, &samples, &[]).ticks_per_frame, 1);
        assert_eq!(resample(9, &samples, &[]).ticks_per_frame, 8);

        // Every tick holds the raw view at its time, from at or after the first sample to at or
        // after the last.
        for ticks_per_frame in [1, 2, 3] {
            let recorder = synthetic_recorder(20, 14, 1200, ticks_per_frame);
            let samples = &recorder.samples;
            let track = recorder.snapshot(false);
            let tick_time = |tick: u32| tick as f64 / ticks_per_frame as f64;
            let first = samples[0].time();
            let last = samples.last().unwrap().time();
            assert!(tick_time(track.first_tick) >= first);
            assert!(track.first_tick == 0 || tick_time(track.first_tick - 1) < first);
            let last_tick = track.last_tick().unwrap();
            assert!(tick_time(last_tick) >= last && tick_time(last_tick - 1) < last);
            for (tick, fields) in (track.first_tick..).zip(&track.ticks) {
                let raw = raw_view(samples, tick_time(tick)).unwrap();
                assert_eq!(*fields, raw.rounded(), "{tick}");
            }
        }
    }

    #[test]
    fn resample_event_ticks() {
        let samples = [sample(20, 0, (1, 1), (0, 0)), sample(21, 0, (2, 2), (0, 0))];
        let events = [
            event(5, 3, EventKind::Focus(false)),
            event(5, 4, EventKind::Focus(true)),
            event(5, 6, EventKind::Focus(false)),
            event(5, 7, EventKind::Focus(true)),
            event(30, 0, EventKind::Focus(false)),
        ];
        let ticks = |ticks_per_frame| {
            resample(ticks_per_frame, &samples, &events)
                .events
                .iter()
                .map(|e| e.tick)
                .collect::<Vec<_>>()
        };
        assert_eq!(ticks(1), [5, 5, 5, 5, 30]);
        assert_eq!(ticks(2), [10, 11, 11, 11, 60]);
        assert_eq!(ticks(3), [16, 16, 17, 17, 90]);
        // Events on one tick keep their order.
        let track = resample(2, &samples, &events);
        assert_eq!(track.events[3].kind, EventKind::Focus(true));
        assert_eq!(track.first_frame(), Some(5));
        assert_eq!(track.last_frame(), Some(30));
    }

    #[test]
    fn resample_drops_what_readers_reject() {
        let far = [sample(u32::MAX, 7, (1, 1), (0, 0))];
        let track = resample(8, &far, &[event(u32::MAX, 0, EventKind::Focus(true))]);
        assert_eq!(track.flags, TRACK_FLAG_TRUNCATED);
        assert!(track.ticks.is_empty() && track.events.is_empty());
        assert_valid(&track);

        // As many ticks as readers accept, flagged when more were recorded.
        let frames = MAX_TRACK_TICKS / 2;
        let samples = [
            sample(0, 0, (1, 1), (0, 0)),
            sample(frames - 1, 4, (2, 2), (0, 0)),
        ];
        let track = resample(2, &samples, &[]);
        assert_eq!(
            (track.ticks.len(), track.flags),
            (MAX_TRACK_TICKS as usize, 0)
        );
        let samples = [
            sample(0, 0, (1, 1), (0, 0)),
            sample(frames, 0, (2, 2), (0, 0)),
        ];
        let track = resample(2, &samples, &[]);
        assert_eq!(track.ticks.len(), MAX_TRACK_TICKS as usize);
        assert_eq!(track.flags, TRACK_FLAG_TRUNCATED);
        assert_valid(&track);
    }

    #[test]
    fn subframes_stay_in_their_frame() {
        let samples = [
            sample(5, 7, (10, 10), (0, 0)),
            // Out of range, counts as 7.
            sample(6, 200, (20, 10), (0, 0)),
        ];
        let track = resample(8, &samples, &[]);
        assert_eq!((track.first_tick, track.ticks.len()), (47, 9));
        assert_eq!(track.view_at(5.5), None);
        assert_eq!(track.view_at(5.875).unwrap().cursor, (10.0, 10.0));
        assert_eq!(track.view_at(6.875).unwrap().cursor, (20.0, 10.0));
        assert_eq!(track.view_at(6.9).unwrap().cursor, (20.0, 10.0));
    }

    #[test]
    fn first_and_last_frame() {
        let mut track = tick_track(2, 21, vec![fields((0, 0), (0, 0)); 4], Vec::new());
        assert_eq!(track.first_frame(), Some(10));
        assert_eq!(track.last_frame(), Some(12));
        track.events.push(track_event(3, EventKind::Focus(true)));
        track.events.push(track_event(61, EventKind::Focus(true)));
        assert_eq!(track.first_frame(), Some(1));
        assert_eq!(track.last_frame(), Some(30));
        track.ticks.clear();
        assert_eq!(track.last_frame(), Some(30));
        track.events.clear();
        assert_eq!(track.first_frame(), None);
        assert_eq!(track.last_frame(), None);
    }

    #[test]
    fn recorder_change_gating() {
        let mut recorder = TrackRecorder::new(owner(7), 2);
        recorder.push_sample(sample(1, 0, (5, 5), (0, 0)));
        recorder.push_sample(sample(1, 4, (5, 5), (0, 0)));
        recorder.push_sample(sample(9, 0, (5, 5), (0, 0)));
        recorder.push_sample(sample(9, 2, (5, 6), (0, 0)));
        recorder.push_sample(Sample {
            cursor_type: 3,
            ..sample(9, 5, (5, 6), (0, 0))
        });
        recorder.push_sample(Sample {
            cursor_type: 3,
            region: CursorRegion::Ui,
            ..sample(10, 0, (5, 6), (0, 0))
        });
        recorder.push_sample(Sample {
            cursor_type: 3,
            region: CursorRegion::Ui,
            ..sample(10, 1, (5, 6), (0, 0))
        });
        // An earlier stamp is raised to keep the samples ordered.
        recorder.push_sample(sample(8, 0, (5, 6), (16, 0)));
        recorder.push_event(event(4, 0, EventKind::Focus(true)));
        recorder.push_event(event(3, 0, EventKind::Focus(false)));
        recorder.push_event(event(4, 9, EventKind::Focus(true)));

        let snapshot = recorder.snapshot(true);
        assert_eq!(snapshot.flags, TRACK_FLAG_TRUNCATED);
        recorder.push_sample(sample(11, 12, (0, 0), (0, 0)));
        let track = recorder.snapshot(false);
        assert_eq!(track.flags, 0);
        assert_eq!(track.owner, owner(7));
        assert_eq!(track.ticks[..snapshot.ticks.len()], snapshot.ticks);
        let keys: Vec<_> = recorder.samples.iter().map(|s| (s.frame, s.sub)).collect();
        assert_eq!(keys, [(1, 0), (9, 2), (9, 5), (10, 0), (10, 0), (11, 7)]);
        let keys: Vec<_> = recorder.events.iter().map(|e| (e.frame, e.sub)).collect();
        assert_eq!(keys, [(4, 0), (4, 0), (4, 7)]);
        // Ticks from frame 1 to 11 7/8.
        assert_eq!((track.first_tick, track.ticks.len()), (2, 23));

        // Cursor types past what tracks store are stored as the largest.
        let mut recorder = TrackRecorder::new(owner(7), 0);
        assert_eq!(recorder.ticks_per_frame, 1);
        recorder.push_sample(Sample {
            cursor_type: 200,
            ..sample(1, 0, (5, 5), (0, 0))
        });
        let track = recorder.snapshot(false);
        assert_eq!(track.ticks[0].cursor_type, MAX_CURSOR_TYPE);
        assert_eq!(reencode(&track, &DEFAULT_QUANTIZATION), track);
        assert_eq!(TrackRecorder::new(owner(7), 20).ticks_per_frame, 8);
    }
}
