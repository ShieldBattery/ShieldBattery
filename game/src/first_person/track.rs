//! First-person tracks: one player's cursor and camera over a game, recorded at render rate during
//! a live game, stored in the `SbFp` replay section, and interpolated on playback.

use std::io::{self, Read, Write};

use byteorder::{LE, ReadBytesExt, WriteBytesExt};
use flate2::Compression;
use flate2::read::DeflateDecoder;
use flate2::write::DeflateEncoder;

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
const CODEC_RECORDS: u8 = 1;

/// Largest decompressed payload a single track may have.
const MAX_TRACK_UNCOMPRESSED: u32 = 64 * 1024 * 1024;
/// Largest total of decompressed payloads one section may have, so a section full of maximum-size
/// tracks can't exhaust memory.
const MAX_SECTION_UNCOMPRESSED: u64 = 256 * 1024 * 1024;

const MASK_CURSOR: u8 = 0x1;
const MASK_SCREEN: u8 = 0x2;
const MASK_REGION: u8 = 0x4;
const MASK_CURSOR_TYPE: u8 = 0x8;
const MASK_EVENTS: u8 = 0x10;
const MASK_SAMPLE: u8 = 0x20;
const MASK_SAMPLE_FIELDS: u8 = MASK_CURSOR | MASK_SCREEN | MASK_REGION | MASK_CURSOR_TYPE;
const MASK_RESERVED: u8 = 0xc0;

const EVENT_VIEWPORT: u8 = 1;
const EVENT_BUTTON: u8 = 2;
const EVENT_FOCUS: u8 = 3;
const EVENT_DRAG: u8 = 4;

/// Stamps divide each frame into this many parts.
const SUBFRAMES: u8 = 8;
/// The last part of a frame a stamp can be in.
const MAX_SUB: u8 = SUBFRAMES - 1;
/// Number of byte columns in a track payload.
const COLUMN_COUNT: usize = 7;

/// Samples further apart than this many frames are not interpolated between: recording is
/// change-gated at render rate, so a longer gap means nothing moved until just before the later
/// sample.
const MAX_INTERPOLATION_GAP_FRAMES: f64 = 4.0;
/// A camera move larger than this (in map pixels, either axis) between two samples is a hotkey or
/// minimap jump rather than a scroll, and is shown as a cut.
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

/// One snapshot of the player's cursor and camera.
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
    /// scroll x8). Decoded tracks may hold any value; users must range check it.
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

/// The parts of a sample that change-gating and delta coding compare.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct SampleFields {
    cursor: (i16, i16),
    screen: (u16, u16),
    region: CursorRegion,
    cursor_type: u8,
}

impl SampleFields {
    /// The values a track's first sample is delta coded against.
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

    fn time(&self) -> f64 {
        stamp_time(self.key())
    }
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

/// One player's recorded cursor and camera. `samples` and `events` are each ordered by
/// `(frame, sub)`.
#[derive(Debug, Clone, PartialEq)]
pub struct Track {
    pub owner: TrackOwner,
    /// `TRACK_FLAG_*` bits.
    pub flags: u8,
    pub samples: Vec<Sample>,
    pub events: Vec<Event>,
}

/// What a track shows at one point in time.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct View {
    /// Cursor in BW's UI coordinates (see [`Sample::cursor`]).
    pub cursor: (f32, f32),
    /// Top-left of the camera in map pixels.
    pub screen: (f32, f32),
    pub region: CursorRegion,
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
    /// The earliest frame of any sample or event.
    pub fn first_frame(&self) -> Option<u32> {
        let sample = self.samples.first().map(|s| s.frame);
        let event = self.events.first().map(|e| e.frame);
        [sample, event].into_iter().flatten().min()
    }

    /// The latest frame of any sample or event.
    pub fn last_frame(&self) -> Option<u32> {
        let sample = self.samples.last().map(|s| s.frame);
        let event = self.events.last().map(|e| e.frame);
        [sample, event].into_iter().flatten().max()
    }

    /// The view at `time`, in frames (`frame as f64 + fraction`). `None` before the first
    /// sample; the last sample holds after the track ends.
    pub fn view_at(&self, time: f64) -> Option<View> {
        let samples = &self.samples;
        let next = samples.partition_point(|s| s.time() <= time);
        let index = next.checked_sub(1)?;
        let current = &samples[index];
        let mut cursor = (current.cursor.0 as f32, current.cursor.1 as f32);
        let mut screen = (current.screen.0 as f32, current.screen.1 as f32);
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
                    ) as f32
                };
                cursor = (axis(|s| s.cursor.0 as f64), axis(|s| s.cursor.1 as f64));

                let dx = after.screen.0 as i32 - current.screen.0 as i32;
                let dy = after.screen.1 as i32 - current.screen.1 as i32;
                if dx.abs() <= MAX_SCROLL_STEP && dy.abs() <= MAX_SCROLL_STEP {
                    let u = ((time - t1) / (t2 - t1)).clamp(0.0, 1.0);
                    screen = (
                        (current.screen.0 as f64 + dx as f64 * u) as f32,
                        (current.screen.1 as f64 + dy as f64 * u) as f32,
                    );
                }
            }
        }

        let end = self.events.partition_point(|e| e.time() <= time);
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
            cursor,
            screen,
            region: current.region,
            cursor_type: current.cursor_type,
            viewport,
            focused: focused.unwrap_or(true),
            drag_start: drag.flatten(),
            grab_panning: middle.unwrap_or(false),
        })
    }
}

/// The time of a `(frame, sub)` stamp, in frames.
fn stamp_time((frame, sub): (u32, u8)) -> f64 {
    frame as f64 + sub as f64 / SUBFRAMES as f64
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
    let u2 = u * u;
    let u3 = u2 * u;
    (2.0 * u3 - 3.0 * u2 + 1.0) * p1
        + (u3 - 2.0 * u2 + u) * m1
        + (-2.0 * u3 + 3.0 * u2) * p2
        + (u3 - u2) * m2
}

/// Collects a track during a live game. Pushes are cheap (no allocation beyond `Vec` growth), as
/// they run on the render thread.
#[derive(Debug, Clone)]
pub struct TrackRecorder {
    owner: TrackOwner,
    samples: Vec<Sample>,
    events: Vec<Event>,
}

impl TrackRecorder {
    pub fn new(owner: TrackOwner) -> TrackRecorder {
        TrackRecorder {
            owner,
            samples: Vec::new(),
            events: Vec::new(),
        }
    }

    /// Records `sample` unless its cursor, screen, region and cursor type all equal the previous
    /// sample's. A stamp earlier than the previous sample's is raised to it, keeping the track
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
    /// track ordered, and `sub` is clamped to 7.
    pub fn push_event(&mut self, mut event: Event) {
        let mut key = event.key();
        if let Some(last) = self.events.last() {
            key = key.max(last.key());
        }
        (event.frame, event.sub) = key;
        self.events.push(event);
    }

    /// A copy of the track recorded so far, leaving the recorder to continue.
    pub fn snapshot(&self, truncated: bool) -> Track {
        Track {
            owner: self.owner,
            flags: truncated_flags(truncated),
            samples: self.samples.clone(),
            events: self.events.clone(),
        }
    }
}

fn truncated_flags(truncated: bool) -> u8 {
    if truncated { TRACK_FLAG_TRUNCATED } else { 0 }
}

fn write_varint(out: &mut Vec<u8>, value: u32) {
    write_varint_u64(out, value as u64);
}

fn write_varint_u64(out: &mut Vec<u8>, mut value: u64) {
    while value >= 0x80 {
        out.push(value as u8 | 0x80);
        value >>= 7;
    }
    out.push(value as u8);
}

fn write_zigzag(out: &mut Vec<u8>, value: i32) {
    write_varint(out, ((value << 1) ^ (value >> 31)) as u32);
}

/// Encodes and DEFLATE-compresses a track's samples and events (codec 1). Returns the compressed
/// payload and its uncompressed length.
///
/// Samples and events are merged into records in `(frame, sub)` order, and each record's fields
/// are split into columns that compress well on their own:
/// ```text
/// varint record_count
/// varint column_length[7]  byte length of each column below, in order
/// column 1, stamps: per record, varint (frame_gap << 3) | sub
///     frame_gap is from the previous record's frame (the first record's is its frame).
/// column 2, masks: per record, u8 mask
///     bit0 cursor changed
///     bit1 screen changed
///     bit2 region changed
///     bit3 cursor_type changed
///     bit4 the record has events
///     bit5 the record carries a sample; fields without their bit set repeat the previous
///         sample's (initially cursor (0, 0), screen (0, 0), region Game, cursor_type 0).
///         Without it the record only carries events, and bits 0-3 must be clear.
///     bits 6-7 reserved; a reader stops decoding the track at a record using them.
/// column 3, cursor x: per record with bit0, zigzag-varint (dx - prev_dx)
///     dx is the change from the previous sample's cursor x, and prev_dx the dx of the previous
///     record with bit0 (initially 0), so motion at a steady velocity encodes as zeros.
/// column 4, cursor y: as column 3, for y
/// column 5, screen x: per record with bit1, zigzag-varint change from the previous sample's
/// column 6, screen y: as column 5, for y
/// column 7, misc: per record in order,
///     u8 region if bit2 (0 Game, 1 Ui)
///     u8 cursor_type if bit3
///     if bit4: varint count, then each { u8 type, varint length, u8 data[length] }
///         1 Viewport { u16 width, u16 height, f32 zoom }
///         2 Button { u8 button, u8 down }
///         3 Focus { u8 focused }
///         4 Drag { u8 active, i16 x, i16 y } (x, y are 0 when inactive)
///         Readers skip unknown types, and data past what they know of a type.
/// ```
/// Events stamped the same as a sample go in that sample's record. All values are little endian.
/// Stamps earlier than the previous record's are written as the previous record's. A reader
/// requires every column to be consumed exactly.
pub fn encode_track_payload(track: &Track) -> io::Result<(Vec<u8>, u32)> {
    let records = encode_records(track)?;
    let uncompressed_length = u32::try_from(records.len()).map_err(|_| too_large())?;
    let mut encoder = DeflateEncoder::new(Vec::new(), Compression::best());
    encoder.write_all(&records)?;
    Ok((encoder.finish()?, uncompressed_length))
}

fn too_large() -> io::Error {
    io::Error::new(io::ErrorKind::InvalidInput, "track is too large")
}

/// A payload's columns, in payload order.
#[derive(Debug, Default)]
struct Columns {
    stamps: Vec<u8>,
    masks: Vec<u8>,
    cursor_x: Vec<u8>,
    cursor_y: Vec<u8>,
    screen_x: Vec<u8>,
    screen_y: Vec<u8>,
    misc: Vec<u8>,
}

impl Columns {
    fn all(&self) -> [&[u8]; COLUMN_COUNT] {
        [
            &self.stamps,
            &self.masks,
            &self.cursor_x,
            &self.cursor_y,
            &self.screen_x,
            &self.screen_y,
            &self.misc,
        ]
    }
}

fn encode_records(track: &Track) -> io::Result<Vec<u8>> {
    let (record_count, columns) = encode_columns(track)?;
    let columns = columns.all();
    let total: usize = columns.iter().map(|c| c.len()).sum();
    let mut out = Vec::with_capacity(total + 5 * (COLUMN_COUNT + 1));
    write_varint(&mut out, record_count);
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

/// Splits `track` into records, returning the record count and the columns holding them.
fn encode_columns(track: &Track) -> io::Result<(u32, Columns)> {
    let record_estimate = track.samples.len() + track.events.len();
    let mut columns = Columns {
        stamps: Vec::with_capacity(record_estimate),
        masks: Vec::with_capacity(record_estimate),
        cursor_x: Vec::with_capacity(track.samples.len()),
        cursor_y: Vec::with_capacity(track.samples.len()),
        ..Columns::default()
    };
    let mut record_count = 0u32;
    let mut prev_key = (0u32, 0u8);
    let mut prev = SampleFields::INITIAL;
    let mut prev_velocity = (0i32, 0i32);
    let mut samples = track.samples.iter().peekable();
    let mut events = track.events.iter().peekable();
    loop {
        let (sample, key) = match (samples.peek(), events.peek()) {
            (None, None) => break,
            (Some(&s), Some(e)) if s.key() <= e.key() => (Some(s), s.key()),
            (Some(&s), None) => (Some(s), s.key()),
            (_, Some(e)) => (None, e.key()),
        };
        if sample.is_some() {
            samples.next();
        }
        let key = key.max(prev_key);
        let event_count = events.clone().take_while(|e| e.key() <= key).count();

        let frame_gap = (key.0 - prev_key.0) as u64;
        write_varint_u64(&mut columns.stamps, (frame_gap << 3) | key.1 as u64);
        let mut mask = 0;
        if let Some(sample) = sample {
            mask |= MASK_SAMPLE;
            let fields = sample.fields();
            if fields.cursor != prev.cursor {
                mask |= MASK_CURSOR;
                let velocity = (
                    fields.cursor.0 as i32 - prev.cursor.0 as i32,
                    fields.cursor.1 as i32 - prev.cursor.1 as i32,
                );
                write_zigzag(&mut columns.cursor_x, velocity.0 - prev_velocity.0);
                write_zigzag(&mut columns.cursor_y, velocity.1 - prev_velocity.1);
                prev_velocity = velocity;
            }
            if fields.screen != prev.screen {
                mask |= MASK_SCREEN;
                let dx = fields.screen.0 as i32 - prev.screen.0 as i32;
                let dy = fields.screen.1 as i32 - prev.screen.1 as i32;
                write_zigzag(&mut columns.screen_x, dx);
                write_zigzag(&mut columns.screen_y, dy);
            }
            if fields.region != prev.region {
                mask |= MASK_REGION;
                columns.misc.push(fields.region as u8);
            }
            if fields.cursor_type != prev.cursor_type {
                mask |= MASK_CURSOR_TYPE;
                columns.misc.push(fields.cursor_type);
            }
            prev = fields;
        }
        if event_count != 0 {
            mask |= MASK_EVENTS;
            let count = u32::try_from(event_count).map_err(|_| too_large())?;
            write_varint(&mut columns.misc, count);
            for event in events.by_ref().take(event_count) {
                write_event(&mut columns.misc, &event.kind);
            }
        }
        columns.masks.push(mask);
        record_count = record_count.checked_add(1).ok_or_else(too_large)?;
        prev_key = key;
    }
    Ok((record_count, columns))
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

/// Bounds-checked reads from a byte slice; every read returns `None` past the end.
struct Reader<'a> {
    data: &'a [u8],
}

impl<'a> Reader<'a> {
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

#[derive(Debug, Default)]
struct DecodedRecords {
    samples: Vec<Sample>,
    events: Vec<Event>,
    /// The payload was malformed; the records before the first malformed one were kept.
    truncated: bool,
}

/// Readers over a payload's columns.
struct ColumnReaders<'a> {
    stamps: Reader<'a>,
    masks: Reader<'a>,
    cursor_x: Reader<'a>,
    cursor_y: Reader<'a>,
    screen_x: Reader<'a>,
    screen_y: Reader<'a>,
    misc: Reader<'a>,
}

impl ColumnReaders<'_> {
    fn all_consumed(&self) -> bool {
        [
            &self.stamps,
            &self.masks,
            &self.cursor_x,
            &self.cursor_y,
            &self.screen_x,
            &self.screen_y,
            &self.misc,
        ]
        .iter()
        .all(|column| column.data.is_empty())
    }
}

/// Splits a payload into its record count and columns. The `bool` is whether data follows the
/// last column.
fn split_columns(data: &[u8]) -> Option<(u32, ColumnReaders<'_>, bool)> {
    let mut reader = Reader { data };
    let record_count = reader.varint()?;
    let mut lengths = [0u32; COLUMN_COUNT];
    for length in &mut lengths {
        *length = reader.varint()?;
    }
    let mut columns = lengths.map(|_| Reader { data: &[] });
    for (column, &length) in columns.iter_mut().zip(&lengths) {
        column.data = reader.bytes(length as usize)?;
    }
    let [stamps, masks, cursor_x, cursor_y, screen_x, screen_y, misc] = columns;
    let readers = ColumnReaders {
        stamps,
        masks,
        cursor_x,
        cursor_y,
        screen_x,
        screen_y,
        misc,
    };
    Some((record_count, readers, !reader.data.is_empty()))
}

struct DecodeState {
    frame: u32,
    sub: u8,
    fields: SampleFields,
    cursor_velocity: (i32, i32),
}

/// Decodes an uncompressed codec 1 payload. Stops at the first malformed record, keeping the
/// records before it; the result is always ordered by `(frame, sub)`. Column data left over after
/// the last record, or data after the columns, also marks the payload malformed.
fn decode_records(data: &[u8]) -> DecodedRecords {
    let mut out = DecodedRecords::default();
    let Some((record_count, mut columns, trailing_data)) = split_columns(data) else {
        out.truncated = true;
        return out;
    };
    let mut state = DecodeState {
        frame: 0,
        sub: 0,
        fields: SampleFields::INITIAL,
        cursor_velocity: (0, 0),
    };
    // Every record takes at least one byte of the stamp column, so a bogus count runs out of
    // data quickly.
    for _ in 0..record_count {
        let event_count = out.events.len();
        if decode_record(&mut columns, &mut state, &mut out).is_none() {
            out.events.truncate(event_count);
            out.truncated = true;
            return out;
        }
    }
    out.truncated = trailing_data || !columns.all_consumed();
    out
}

fn decode_record(
    columns: &mut ColumnReaders<'_>,
    state: &mut DecodeState,
    out: &mut DecodedRecords,
) -> Option<()> {
    let stamp = columns.stamps.varint_u64()?;
    let gap = u32::try_from(stamp >> 3).ok()?;
    let sub = (stamp & 7) as u8;
    let mask = columns.masks.u8()?;
    if mask & MASK_RESERVED != 0 {
        return None;
    }
    if mask & MASK_SAMPLE == 0 && mask & MASK_SAMPLE_FIELDS != 0 {
        return None;
    }
    let frame = state.frame.checked_add(gap)?;
    if gap == 0 && sub < state.sub {
        return None;
    }

    let mut fields = state.fields;
    let mut velocity = state.cursor_velocity;
    if mask & MASK_CURSOR != 0 {
        velocity = (
            velocity.0.checked_add(columns.cursor_x.zigzag()?)?,
            velocity.1.checked_add(columns.cursor_y.zigzag()?)?,
        );
        let x = i16::try_from((fields.cursor.0 as i32).checked_add(velocity.0)?).ok()?;
        let y = i16::try_from((fields.cursor.1 as i32).checked_add(velocity.1)?).ok()?;
        fields.cursor = (x, y);
    }
    if mask & MASK_SCREEN != 0 {
        let dx = columns.screen_x.zigzag()?;
        let dy = columns.screen_y.zigzag()?;
        let x = u16::try_from((fields.screen.0 as i32).checked_add(dx)?).ok()?;
        let y = u16::try_from((fields.screen.1 as i32).checked_add(dy)?).ok()?;
        fields.screen = (x, y);
    }
    if mask & MASK_REGION != 0 {
        fields.region = CursorRegion::from_u8(columns.misc.u8()?);
    }
    if mask & MASK_CURSOR_TYPE != 0 {
        fields.cursor_type = columns.misc.u8()?;
    }
    if mask & MASK_EVENTS != 0 {
        // Each event takes at least 2 bytes, so a bogus count runs out of data quickly.
        let count = columns.misc.varint()?;
        for _ in 0..count {
            if let Some(kind) = decode_event(&mut columns.misc)? {
                out.events.push(Event { frame, sub, kind });
            }
        }
    }
    if mask & MASK_SAMPLE != 0 {
        out.samples.push(Sample {
            frame,
            sub,
            cursor: fields.cursor,
            screen: fields.screen,
            region: fields.region,
            cursor_type: fields.cursor_type,
        });
        state.fields = fields;
        state.cursor_velocity = velocity;
    }
    state.frame = frame;
    state.sub = sub;
    Some(())
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
/// 0x2     u8 codec (1)
///     Readers skip payloads of codecs they don't know.
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
///         u8 payload[payload_length] (see `encode_track_payload`)
/// ```
/// All values are little endian. `out` is left unchanged on error.
pub fn write_section(out: &mut Vec<u8>, game_id: [u8; 16], tracks: &[Track]) -> io::Result<()> {
    let start = out.len();
    let result = write_section_inner(out, game_id, tracks);
    if result.is_err() {
        out.truncate(start);
    }
    result
}

fn write_section_inner(out: &mut Vec<u8>, game_id: [u8; 16], tracks: &[Track]) -> io::Result<()> {
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
        let (payload, uncompressed_length) = encode_track_payload(track)?;
        let payload_length = u32::try_from(payload.len())
            .map_err(|_| io::Error::new(io::ErrorKind::InvalidInput, "track is too large"))?;
        out.write_u16::<LE>(ENTRY_HEADER_LENGTH)?;
        out.write_u8(CODEC_RECORDS)?;
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

/// Decompresses `payload`, returning `None` unless it inflates to exactly `expected_len` bytes.
/// Reads at most one byte past `expected_len`, so an oversized stream costs no more than that.
fn inflate(payload: &[u8], expected_len: u32) -> Option<Vec<u8>> {
    let mut out = Vec::new();
    DeflateDecoder::new(payload)
        .take(expected_len as u64 + 1)
        .read_to_end(&mut out)
        .ok()?;
    (out.len() == expected_len as usize).then_some(out)
}

/// Parses an `SbFp` section's data (after the section id and length). Returns `None` if the
/// header is malformed or from a newer major format. Tracks with unknown codecs or payloads that
/// fail to decompress are skipped; a track whose records are malformed partway keeps the records
/// before that and is flagged [`TRACK_FLAG_TRUNCATED`].
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
    let mut budget = MAX_SECTION_UNCOMPRESSED;
    for i in 0..track_count {
        let Some((entry, track_payload, next)) = split_entry(rest) else {
            warn!("First-person track entry {i} is malformed, ignoring the rest");
            break;
        };
        rest = next;
        if entry.codec != CODEC_RECORDS {
            debug!("Skipping first-person track {i} with codec {}", entry.codec);
            continue;
        }
        if entry.uncompressed_length > MAX_TRACK_UNCOMPRESSED
            || entry.uncompressed_length as u64 > budget
        {
            warn!(
                "Skipping first-person track {i}: {} bytes uncompressed is too large",
                entry.uncompressed_length,
            );
            continue;
        }
        budget -= entry.uncompressed_length as u64;
        let Some(records) = inflate(track_payload, entry.uncompressed_length) else {
            warn!("Skipping first-person track {i}: payload failed to decompress");
            continue;
        };
        let decoded = decode_records(&records);
        if decoded.truncated {
            warn!("First-person track {i} has malformed records, keeping the part before them");
        }
        let truncated_flag = if decoded.truncated {
            TRACK_FLAG_TRUNCATED
        } else {
            0
        };
        tracks.push(Track {
            owner: entry.owner,
            flags: entry.flags | truncated_flag,
            samples: decoded.samples,
            events: decoded.events,
        });
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

    fn synthetic_track(seconds: u32, seed: u64) -> Track {
        synthetic_track_with_pauses(seconds, seed, 1200)
    }

    /// A player's input at 60 Hz over a game at Fastest: eased cursor moves with flicks and
    /// pauses of up to `max_pause_ms`, edge scrolls, camera jumps, clicks, box drags, zoom changes
    /// and an alt-tab.
    fn synthetic_track_with_pauses(seconds: u32, seed: u64, max_pause_ms: u32) -> Track {
        let mut rng = Rng(seed);
        let mut recorder = TrackRecorder::new(owner(1234));
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
        recorder.snapshot(false)
    }

    fn assert_ordered(samples: &[Sample], events: &[Event]) {
        assert!(samples.windows(2).all(|w| w[0].key() <= w[1].key()));
        assert!(events.windows(2).all(|w| w[0].key() <= w[1].key()));
        assert!(samples.iter().all(|s| s.sub <= MAX_SUB));
        assert!(events.iter().all(|e| e.sub <= MAX_SUB));
    }

    fn deflate(data: &[u8]) -> Vec<u8> {
        let mut encoder = DeflateEncoder::new(Vec::new(), Compression::default());
        encoder.write_all(data).unwrap();
        encoder.finish().unwrap()
    }

    /// An uncompressed payload of `record_count` records stored in hand-made `columns`.
    fn payload(record_count: u32, columns: [&[u8]; COLUMN_COUNT]) -> Vec<u8> {
        let mut out = Vec::new();
        write_varint(&mut out, record_count);
        for column in columns {
            write_varint(&mut out, column.len() as u32);
        }
        for column in columns {
            out.extend_from_slice(column);
        }
        out
    }

    /// A payload holding just a sample at frame 1 with the initial fields.
    fn one_sample_payload() -> Vec<u8> {
        payload(1, [&[8], &[MASK_SAMPLE], &[], &[], &[], &[], &[]])
    }

    /// Section data (after the id and length) with hand-made entries of
    /// `(codec, uncompressed_length, payload)`.
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
        let track = Track {
            owner: owner(1),
            flags: 0,
            samples: vec![
                sample(5, 3, (1, -1), (0, 0)),
                Sample {
                    region: CursorRegion::Ui,
                    cursor_type: 4,
                    ..sample(7, 5, (4, -3), (300, 2))
                },
                Sample {
                    region: CursorRegion::Ui,
                    cursor_type: 4,
                    ..sample(7, 6, (7, -5), (300, 2))
                },
            ],
            events: vec![
                event(
                    5,
                    3,
                    EventKind::Button {
                        button: MouseButton::Left,
                        down: true,
                    },
                ),
                event(7, 0, EventKind::Focus(false)),
            ],
        };
        let records = encode_records(&track).unwrap();
        // Records: a sample with a button event, an events-only record two frames later, a
        // sample changing every field, and a sample keeping the cursor's velocity.
        #[rustfmt::skip]
        let expected = [
            // Record count, column lengths.
            4, 4, 4, 3, 3, 2, 1, 11,
            // Stamps: (5 << 3) | 3, (2 << 3) | 0, 5, 6.
            43, 16, 5, 6,
            // Masks.
            0x31, 0x10, 0x2f, 0x21,
            // Cursor x: velocity 1, then 3 (+2), then 3 (+0).
            2, 4, 0,
            // Cursor y: velocity -1, then -2 (-1), then -2 (+0).
            1, 1, 0,
            // Screen x: +300.
            0xd8, 0x04,
            // Screen y: +2.
            4,
            // Misc: the button event, the focus event, then region and cursor type.
            1, EVENT_BUTTON, 2, 0, 1,
            1, EVENT_FOCUS, 1, 0,
            1, 4,
        ];
        assert_eq!(records, expected);
        let decoded = decode_records(&records);
        assert!(!decoded.truncated);
        assert_eq!(decoded.samples, track.samples);
        assert_eq!(decoded.events, track.events);
    }

    #[test]
    fn payload_round_trip() {
        let track = synthetic_track(120, 1);
        assert!(track.samples.len() > 1000);
        assert!(track.events.len() > 50);
        // Several samples share a frame, and events land both with samples and on their own.
        assert!(track.samples.windows(2).any(|w| w[0].frame == w[1].frame));
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
        let lone_event = track
            .events
            .iter()
            .any(|e| !track.samples.iter().any(|s| s.key() == e.key()));
        assert!(lone_event);
        let jump = |w: &[Sample]| (w[0].screen.0 as i32 - w[1].screen.0 as i32).abs();
        assert!(track.samples.windows(2).any(|w| jump(w) > MAX_SCROLL_STEP));

        let (payload, uncompressed_length) = encode_track_payload(&track).unwrap();
        let records = inflate(&payload, uncompressed_length).unwrap();
        let decoded = decode_records(&records);
        assert!(!decoded.truncated);
        assert_eq!(decoded.samples, track.samples);
        assert_eq!(decoded.events, track.events);
    }

    #[test]
    fn empty_track_round_trip() {
        let track = Track {
            owner: owner(1),
            flags: 0,
            samples: Vec::new(),
            events: Vec::new(),
        };
        let records = encode_records(&track).unwrap();
        assert_eq!(records, [0; COLUMN_COUNT + 1]);
        let decoded = decode_records(&records);
        assert!(!decoded.truncated);
        assert!(decoded.samples.is_empty() && decoded.events.is_empty());
    }

    #[test]
    fn steady_motion_predicts_to_zeros() {
        let mut straight = TrackRecorder::new(owner(1));
        let mut random = TrackRecorder::new(owner(1));
        let mut rng = Rng(42);
        let mut wander = (0i16, 0i16);
        for i in 0..3000u32 {
            let (frame, sub) = (i / 2, (i % 2) as u8 * 4);
            let along = (i as i16 * 3, -(i as i16) * 2);
            straight.push_sample(sample(frame, sub, along, (0, 0)));
            wander.0 = wander.0.wrapping_add(rng.signed(20) as i16);
            wander.1 = wander.1.wrapping_add(rng.signed(20) as i16);
            random.push_sample(sample(frame, sub, wander, (0, 0)));
        }
        let straight = straight.snapshot(false);
        let (_, columns) = encode_columns(&straight).unwrap();
        // Only the first move, starting the motion, changes the velocity.
        assert_eq!(&columns.cursor_x[..1], &[6]);
        assert_eq!(&columns.cursor_y[..1], &[3]);
        assert!(columns.cursor_x[1..].iter().all(|&b| b == 0));
        assert!(columns.cursor_y[1..].iter().all(|&b| b == 0));

        let (straight_payload, _) = encode_track_payload(&straight).unwrap();
        let (random_payload, _) = encode_track_payload(&random.snapshot(false)).unwrap();
        assert!(
            straight_payload.len() * 10 < random_payload.len(),
            "{} vs {}",
            straight_payload.len(),
            random_payload.len(),
        );
    }

    #[test]
    fn section_round_trip() {
        let mut first = synthetic_track(30, 2);
        first.flags = 0x1;
        let mut second = synthetic_track(45, 3);
        second.owner = TrackOwner {
            sb_user_id: 99,
            storm_id: 3,
            bw_player_id: UNKNOWN_PLAYER,
        };
        let empty = Track {
            owner: owner(5),
            flags: TRACK_FLAG_TRUNCATED,
            samples: Vec::new(),
            events: Vec::new(),
        };
        let tracks = vec![first, second, empty];
        let game_id = *b"0123456789abcdef";

        let mut out = vec![0xaa, 0xbb];
        write_section(&mut out, game_id, &tracks).unwrap();
        assert_eq!(&out[..2], &[0xaa, 0xbb]);
        let data = section_data(&out[2..]);
        let entry = &data[SECTION_HEADER_LENGTH as usize..];
        let first_frame = (&entry[0xc..]).read_u32::<LE>().unwrap();
        let last_frame = (&entry[0x10..]).read_u32::<LE>().unwrap();
        assert_eq!(Some(first_frame), tracks[0].first_frame());
        assert_eq!(Some(last_frame), tracks[0].last_frame());

        let section = parse_section(data).unwrap();
        assert_eq!(section.game_id, game_id);
        assert_eq!(section.tracks, tracks);
    }

    #[test]
    fn too_many_tracks_leaves_output_unchanged() {
        let track = Track {
            owner: owner(1),
            flags: 0,
            samples: vec![sample(1, 0, (1, 1), (0, 0))],
            events: Vec::new(),
        };
        let mut out = vec![1, 2, 3];
        assert!(write_section(&mut out, [0; 16], &vec![track; 256]).is_err());
        assert_eq!(out, [1, 2, 3]);
    }

    #[test]
    fn unknown_codec_skipped() {
        let tracks = vec![synthetic_track(5, 4), synthetic_track(5, 5)];
        let mut out = Vec::new();
        write_section(&mut out, [1; 16], &tracks).unwrap();
        let mut data = section_data(&out).to_vec();
        data[SECTION_HEADER_LENGTH as usize + 2] = 7;
        let section = parse_section(&data).unwrap();
        assert_eq!(section.tracks, tracks[1..]);
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
        assert_eq!(parse_section(&grown).unwrap().tracks, tracks);
    }

    #[test]
    fn unknown_event_type_skipped() {
        #[rustfmt::skip]
        let misc = [
            // Unknown event type 9, then a known event, a button the reader doesn't know, and a
            // focus event with an extra trailing byte.
            4, 9, 3, 0xff, 0xff, 0xff,
            EVENT_BUTTON, 2, 1, 0,
            EVENT_BUTTON, 2, 7, 1,
            EVENT_FOCUS, 2, 1, 0xee,
        ];
        let records = payload(1, [&[(3 << 3) | 1], &[0x30], &[], &[], &[], &[], &misc]);
        let decoded = decode_records(&records);
        assert!(!decoded.truncated);
        assert_eq!(decoded.samples, [sample(3, 1, (0, 0), (0, 0))]);
        assert_eq!(
            decoded.events,
            [
                event(
                    3,
                    1,
                    EventKind::Button {
                        button: MouseButton::Right,
                        down: false,
                    },
                ),
                event(3, 1, EventKind::Focus(true)),
            ],
        );

        // The same through a section.
        let data = raw_section(&[(CODEC_RECORDS, records.len() as u32, &deflate(&records))]);
        let section = parse_section(&data).unwrap();
        assert_eq!(section.tracks[0].events, decoded.events);
        assert_eq!(section.tracks[0].flags, 0);
    }

    #[test]
    fn malformed_payloads_truncate() {
        // A reserved mask bit on the second record.
        let records = payload(2, [&[8, 8], &[0x21, 0x60], &[2], &[2], &[], &[], &[]]);
        let decoded = decode_records(&records);
        assert!(decoded.truncated);
        assert_eq!(decoded.samples, [sample(1, 0, (1, 1), (0, 0))]);

        let data = raw_section(&[(CODEC_RECORDS, records.len() as u32, &deflate(&records))]);
        let section = parse_section(&data).unwrap();
        assert_eq!(section.tracks[0].flags, TRACK_FLAG_TRUNCATED);
        assert_eq!(section.tracks[0].samples.len(), 1);

        // Sample fields without the sample bit.
        let records = payload(1, [&[8], &[0x01], &[2], &[2], &[], &[], &[]]);
        assert!(decode_records(&records).truncated);
        // A known event too short for its type drops the record's events and sample.
        let misc = [2, EVENT_FOCUS, 1, 1, EVENT_DRAG, 1, 1];
        let decoded = decode_records(&payload(1, [&[8], &[0x30], &[], &[], &[], &[], &misc]));
        assert!(decoded.truncated);
        assert!(decoded.samples.is_empty() && decoded.events.is_empty());
        // Time going backwards within a frame.
        let records = payload(2, [&[8 | 5, 4], &[0x20, 0x20], &[], &[], &[], &[], &[]]);
        let decoded = decode_records(&records);
        assert!(decoded.truncated);
        assert_eq!(decoded.samples.len(), 1);
        // A record's cursor column running out.
        let records = payload(2, [&[8, 8], &[0x21, 0x21], &[2], &[2], &[], &[], &[]]);
        let decoded = decode_records(&records);
        assert!(decoded.truncated);
        assert_eq!(decoded.samples.len(), 1);
        // More records stated than the columns hold.
        let records = payload(5, [&[8], &[0x20], &[], &[], &[], &[], &[]]);
        let decoded = decode_records(&records);
        assert!(decoded.truncated);
        assert_eq!(decoded.samples.len(), 1);
        // Column data left over after the last record keeps the records, but is malformed.
        let records = payload(1, [&[8], &[0x20], &[0], &[], &[], &[], &[]]);
        let decoded = decode_records(&records);
        assert!(decoded.truncated);
        assert_eq!(decoded.samples.len(), 1);
        // Data after the columns.
        let mut records = one_sample_payload();
        assert!(!decode_records(&records).truncated);
        records.push(0);
        assert!(decode_records(&records).truncated);
        // Columns longer than the payload.
        let mut records = payload(1, [&[8], &[0x20], &[], &[], &[], &[], &[0; 3]]);
        records.pop();
        let decoded = decode_records(&records);
        assert!(decoded.truncated);
        assert!(decoded.samples.is_empty());
        // A cursor moving out of i16 range.
        let far = {
            let mut out = Vec::new();
            write_zigzag(&mut out, 40_000);
            out
        };
        let records = payload(1, [&[8], &[0x21], &far, &[0], &[], &[], &[]]);
        assert!(decode_records(&records).truncated);
        // An empty payload has no header.
        assert!(decode_records(&[]).truncated);
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
        let bomb = deflate(&vec![0u8; 8 * 1024 * 1024]);
        let small = one_sample_payload();
        let small_len = small.len() as u32;
        let data = raw_section(&[
            // Inflates past its stated length.
            (CODEC_RECORDS, 100, &bomb),
            // States a length over the per-track limit.
            (CODEC_RECORDS, MAX_TRACK_UNCOMPRESSED + 1, &bomb),
            // Inflates short of its stated length.
            (CODEC_RECORDS, small_len + 1, &deflate(&small)),
            (CODEC_RECORDS, small_len, &deflate(&small)),
        ]);
        let section = parse_section(&data).unwrap();
        assert_eq!(section.tracks.len(), 1);
        assert_eq!(section.tracks[0].samples, [sample(1, 0, (0, 0), (0, 0))]);
    }

    #[test]
    fn garbage_never_panics() {
        let mut rng = Rng(0x5eed);
        let track = synthetic_track(10, 9);
        let records = encode_records(&track).unwrap();
        let mut out = Vec::new();
        write_section(&mut out, [3; 16], &[track.clone(), synthetic_track(3, 10)]).unwrap();
        let data = section_data(&out).to_vec();

        for i in 0..3000u32 {
            let mut mutated = records.clone();
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
            let decoded = decode_records(&mutated);
            assert_ordered(&decoded.samples, &decoded.events);
        }

        for i in 0..3000u32 {
            let mut mutated = data.clone();
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
                for track in &section.tracks {
                    assert_ordered(&track.samples, &track.events);
                    let _ = track.view_at(50.0);
                }
            }
        }

        for len in 0..200 {
            let random: Vec<u8> = (0..len).map(|_| rng.next_u64() as u8).collect();
            let _ = parse_section(&random);
            let _ = decode_records(&random);
        }
    }

    #[test]
    fn ten_minutes_compresses_small() {
        // With pauses as a player makes them, and with the cursor never resting.
        for (max_pause_ms, min_samples) in [(1200, 10_000), (0, 30_000)] {
            let track = synthetic_track_with_pauses(600, 11, max_pause_ms);
            let (payload, uncompressed_length) = encode_track_payload(&track).unwrap();
            println!(
                "{max_pause_ms} ms pauses: {} samples, {} events, {uncompressed_length} -> {} B",
                track.samples.len(),
                track.events.len(),
                payload.len(),
            );
            assert!(track.samples.len() > min_samples);
            assert!(payload.len() < 100 * 1024, "{} bytes", payload.len());
        }
    }

    fn view_track() -> Track {
        Track {
            owner: owner(1),
            flags: 0,
            samples: vec![
                sample(10, 0, (100, 100), (0, 0)),
                sample(10, 3, (120, 90), (16, 0)),
                sample(10, 6, (150, 70), (32, 0)),
                sample(11, 1, (170, 60), (1000, 0)),
                sample(11, 5, (175, 58), (1000, 16)),
                // Over MAX_INTERPOLATION_GAP_FRAMES later.
                sample(20, 0, (400, 400), (1000, 32)),
            ],
            events: vec![
                event(
                    10,
                    0,
                    EventKind::Viewport(Viewport {
                        render_width: 640,
                        render_height: 480,
                        zoom: 1.0,
                    }),
                ),
                event(10, 3, EventKind::Drag(Some((120, 90)))),
                event(11, 1, EventKind::Focus(false)),
                event(11, 1, EventKind::Drag(None)),
                event(
                    11,
                    3,
                    EventKind::Button {
                        button: MouseButton::Middle,
                        down: true,
                    },
                ),
                event(
                    12,
                    0,
                    EventKind::Viewport(Viewport {
                        render_width: 640,
                        render_height: 480,
                        zoom: 2.0,
                    }),
                ),
            ],
        }
    }

    #[test]
    fn view_passes_through_samples() {
        let track = view_track();
        for s in &track.samples {
            let view = track.view_at(s.time()).unwrap();
            assert_eq!(view.cursor, (s.cursor.0 as f32, s.cursor.1 as f32));
            assert_eq!(view.screen, (s.screen.0 as f32, s.screen.1 as f32));
            assert_eq!(view.region, s.region);
        }
    }

    #[test]
    fn view_interpolates() {
        let track = view_track();
        assert_eq!(track.samples[1].time(), 10.375);
        let view = track.view_at(10.1875).unwrap();
        assert!((100.0..120.0).contains(&view.cursor.0), "{view:?}");
        assert!((90.0..100.0).contains(&view.cursor.1), "{view:?}");
        // Short camera moves scroll.
        assert_eq!(view.screen, (8.0, 0.0));
        assert_eq!(view.viewport.unwrap().zoom, 1.0);
        assert!(view.focused);
        assert_eq!(view.drag_start, None);
        assert!(!view.grab_panning);

        // Between 10 6/8 and 11 1/8.
        let view = track.view_at(10.9375).unwrap();
        assert!((150.0..170.0).contains(&view.cursor.0), "{view:?}");
        // A jump holds until the next sample.
        assert_eq!(view.screen, (32.0, 0.0));
        assert_eq!(view.drag_start, Some((120, 90)));
        let view = track.view_at(11.125).unwrap();
        assert_eq!(view.screen, (1000.0, 0.0));
        assert!(!view.focused);
        assert_eq!(view.drag_start, None);
        assert!(!view.grab_panning);
        assert!(track.view_at(11.375).unwrap().grab_panning);

        // A long gap holds the earlier sample.
        let view = track.view_at(15.0).unwrap();
        assert_eq!(view.cursor, (175.0, 58.0));
        assert_eq!(view.screen, (1000.0, 16.0));
        assert_eq!(view.viewport.unwrap().zoom, 2.0);
    }

    #[test]
    fn view_ends() {
        let track = view_track();
        assert_eq!(track.view_at(9.999), None);
        assert_eq!(track.view_at(f64::NAN), None);
        let view = track.view_at(1000.0).unwrap();
        assert_eq!(view.cursor, (400.0, 400.0));
        assert_eq!(view.screen, (1000.0, 32.0));
        let empty = Track {
            samples: Vec::new(),
            ..view_track()
        };
        assert_eq!(empty.view_at(15.0), None);
    }

    #[test]
    fn subframes_stay_in_their_frame() {
        let track = Track {
            owner: owner(1),
            flags: 0,
            samples: vec![
                sample(5, 7, (10, 10), (0, 0)),
                // Out of range, counts as 7.
                sample(6, 200, (20, 10), (0, 0)),
            ],
            events: Vec::new(),
        };
        assert_eq!(track.samples[0].time(), 5.875);
        assert_eq!(track.samples[1].time(), 6.875);
        assert_eq!(track.view_at(5.5), None);
        assert_eq!(track.view_at(5.875).unwrap().cursor, (10.0, 10.0));
        assert_eq!(track.view_at(6.9).unwrap().cursor, (20.0, 10.0));
        let decoded = decode_records(&encode_records(&track).unwrap());
        assert_eq!(decoded.samples[1].key(), (6, 7));
    }

    #[test]
    fn first_and_last_frame() {
        let mut track = view_track();
        assert_eq!(track.first_frame(), Some(10));
        assert_eq!(track.last_frame(), Some(20));
        track.events.push(event(30, 0, EventKind::Focus(true)));
        track.samples.remove(0);
        assert_eq!(track.first_frame(), Some(10));
        assert_eq!(track.last_frame(), Some(30));
        track.samples.clear();
        track.events.clear();
        assert_eq!(track.first_frame(), None);
    }

    #[test]
    fn recorder_change_gating() {
        let mut recorder = TrackRecorder::new(owner(7));
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
        // An earlier stamp is raised to keep the track ordered.
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
        assert_eq!(snapshot.samples, track.samples[..5]);
        let keys: Vec<_> = track.samples.iter().map(|s| (s.frame, s.sub)).collect();
        assert_eq!(keys, [(1, 0), (9, 2), (9, 5), (10, 0), (10, 0), (11, 7)]);
        let keys: Vec<_> = track.events.iter().map(|e| (e.frame, e.sub)).collect();
        assert_eq!(keys, [(4, 0), (4, 0), (4, 7)]);
    }
}
