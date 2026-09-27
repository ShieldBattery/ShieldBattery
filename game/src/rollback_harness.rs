//! Drives the rollback engine ([`crate::rollback`]) off replay playback, to prove that its
//! snapshot ranges capture the whole synced state and to measure how the game would look if it
//! predicted ahead of some players' commands.
//!
//! Each tick restores the snapshot taken `R` frames ago, re-simulates those frames plus one, and
//! takes a fresh snapshot one frame further along. If the range list covers the state completely,
//! the per-frame fingerprint is identical to a plain playback of the same replay and the game
//! plays on unchanged; state the list misses shows up as a fingerprint divergence against a plain
//! playback's [`crate::rollback_probe`] rows, keyed by frame.
//!
//! On top of that it can hold chosen players' commands back, which is what makes the rollback do
//! work instead of reproducing what it rolled back over. A player given a delay of `K` frames is
//! only heard from `K` frames after the frame a command was issued for, so the re-simulated span
//! runs without those commands and the frames it produces are a prediction. The confirmed step at
//! the back of the span always has them, because `R` is held at or above every delay, so the
//! confirmed frames still reproduce plain playback exactly while the present frames differ by
//! however wrong the prediction was. Each row of the log carries both frames, which is the
//! measurement.
//!
//! Compiled out of release DLLs along with the engine it drives.

use std::fs::File;
use std::io::Write;
use std::mem::size_of;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use parking_lot::Mutex;

use crate::bw::players::StormPlayerId;
use crate::bw::{self, Bw};
use crate::bw_scr::BwScr;
use crate::game_thread;
use crate::rollback;
use crate::rollback::ranges::Range;
use crate::rollback::snapshot::{SNAPSHOTS, Snapshots};
use crate::rollback::sounds::{self, SoundCounts};
use crate::rollback_probe::Fingerprint;

/// Environment variable that arms the harness, holding the rollback depth in frames: with
/// `SB_ROLLBACK_HARNESS=8` every logic step rewinds eight frames and re-simulates them. Must be at
/// least 1.
const ENV_VAR: &str = "SB_ROLLBACK_HARNESS";

/// Environment variable that gives chosen players a command delay, holding a comma-separated list
/// of `<storm player id>:<frames>`: with `SB_ROLLBACK_DELAY=1:3,2:2` storm player 1's commands are
/// only known three frames after the frame they were issued for and storm player 2's two frames
/// after. Does nothing on its own; the delays are only applied while [`ENV_VAR`] arms the harness.
const DELAY_ENV_VAR: &str = "SB_ROLLBACK_DELAY";

/// Environment variable naming one frame whose simulations to audit: the executable's static data
/// is copied just before the step that first simulates the frame and again before the confirmed
/// step that simulates it for the last time, and every difference outside the snapshot's ranges is
/// written out. The snapshot state both steps start from is the same, so with no delayed players a
/// difference there is state the earlier simulations left behind that the snapshot does not cover.
const AUDIT_ENV_VAR: &str = "SB_ROLLBACK_AUDIT_FRAME";

/// The frame [`AUDIT_ENV_VAR`] names, or 0 when no audit was asked for.
static AUDIT_FRAME: AtomicU32 = AtomicU32::new(0);

/// The static data copied before the audited frame was first simulated, once it has been.
static AUDIT_FIRST: Mutex<Option<Vec<u8>>> = Mutex::new(None);

/// The snapshot's ranges as the step that first simulated the audited frame left them.
static AUDIT_FIRST_RESULT: Mutex<Option<Vec<u8>>> = Mutex::new(None);

/// Whether the audit has been written, so a replay seek back past the frame does not write it again.
static AUDIT_DONE: AtomicBool = AtomicBool::new(false);

/// Rollback depth in frames, or 0 when the harness is not armed.
static ROLLBACK_FRAMES: AtomicU32 = AtomicU32::new(0);

/// Each storm player's command delay in frames; 0 for a player whose commands are known as soon as
/// the frame they were issued for is simulated.
static DELAYS: [AtomicU32; bw::MAX_STORM_PLAYERS] =
    [const { AtomicU32::new(0) }; bw::MAX_STORM_PLAYERS];

/// Whether any player has a nonzero delay, so that a run with none pays a single relaxed load per
/// replay command.
static ANY_DELAY: AtomicBool = AtomicBool::new(false);

/// How many steps of the current tick run after the one in progress, which is how far ahead of the
/// frame a step reads commands for the tick's newest frame is.
static STEPS_AFTER_CURRENT: AtomicU32 = AtomicU32::new(0);

/// Commands the current tick left unapplied because the player that issued them is delayed and the
/// tick's newest frame has not reached them yet.
static SUPPRESSED_COMMANDS: AtomicU32 = AtomicU32::new(0);

/// Commands of delayed players that the current tick's confirmed step applied.
static APPLIED_DELAYED_COMMANDS: AtomicU32 = AtomicU32::new(0);

/// Whether the run has already been checked against the "replay playback only" requirement.
static ELIGIBILITY_CHECKED: AtomicBool = AtomicBool::new(false);

/// The CSV rows, kept across replay seeks so one run produces one file.
static LOG_FILE: Mutex<Option<HarnessFile>> = Mutex::new(None);

/// One unit as a frame shows it: which slot, which occupant of that slot, whose, what it is, and
/// where.
#[derive(Copy, Clone, Eq, PartialEq)]
struct UnitView {
    unit: usize,
    /// Counts the times the slot has been handed out, so a slot that a unit died out of and a new
    /// one took over reads as two different units rather than as one that jumped across the map.
    unique_index: u8,
    player: u8,
    id: u16,
    x: i16,
    y: i16,
}

impl UnitView {
    fn key(&self) -> (usize, u8) {
        (self.unit, self.unique_index)
    }

    /// Pixels between the two positions along whichever axis they are further apart on.
    fn distance(&self, other: &UnitView) -> u32 {
        (self.x as i32 - other.x as i32)
            .unsigned_abs()
            .max((self.y as i32 - other.y as i32).unsigned_abs())
    }
}

/// The frame on screen as a tick left it, kept so the next tick can see how the late commands
/// changed that same frame.
struct DisplayedFrame {
    frame: u32,
    units: Vec<UnitView>,
    /// The slot and unique index of every unit in the snapshot the next tick restores, sorted.
    /// Both simulations of the frame grow from that snapshot, so a unit it holds is the same unit
    /// wherever the two show its slot and index. A unit created after it is not: the two
    /// simulations hand slots out in whatever order their commands made them, and can give one
    /// slot and index to two different units.
    anchored: Vec<(usize, u8)>,
}

static DISPLAYED_UNITS: Mutex<Option<DisplayedFrame>> = Mutex::new(None);

/// The anchored units of the snapshot taken by the tick in progress, which become its
/// [`DisplayedFrame::anchored`] once the tick ends.
static SNAPSHOT_UNITS: Mutex<Vec<(usize, u8)>> = Mutex::new(Vec::new());

/// How far the frame shown at the end of the previous tick turned out to be wrong, once this tick
/// re-simulated it with the commands that had arrived since: what a player would see corrected.
#[derive(Default)]
struct Corrections {
    /// How far each unit shown on the frame that is still there but somewhere else moved, in
    /// pixels along whichever axis it moved further.
    moves: Vec<u32>,
    /// Units shown on the frame that are still there but as a different unit type: a morph or a
    /// mode change (larva to egg, a tank sieging) that the late commands started, undid or moved
    /// to another frame.
    morphed: u32,
    /// Units there that the frame did not show: a death taken back, or something created on a
    /// command that arrived late. They pop into view.
    popped_in: u32,
    /// Units the frame showed that are not there: a death that happened on a command that arrived
    /// late, or something whose creation the late commands undid. They pop out of view.
    popped_out: u32,
}

static TICK_CORRECTIONS: Mutex<Corrections> = Mutex::new(Corrections {
    moves: Vec::new(),
    morphed: 0,
    popped_in: 0,
    popped_out: 0,
});

/// Every active unit, ordered by slot.
unsafe fn capture_units(bw: &BwScr) -> Vec<UnitView> {
    unsafe {
        let mut units = bw
            .active_units()
            .map(|unit| {
                let position = unit.position();
                UnitView {
                    unit: *unit as usize,
                    unique_index: (**unit).minor_unique_index,
                    player: unit.player(),
                    id: unit.id().0,
                    x: position.x,
                    y: position.y,
                }
            })
            .collect::<Vec<_>>();
        units.sort_unstable_by_key(|x| x.unit);
        units
    }
}

/// Compares the units the previous tick showed for its frame with the same frame as this tick has
/// just re-simulated it, if that is the frame the simulation is on now.
///
/// Units the snapshot both simulations started from holds are matched by slot and unique index.
/// Units created since are matched to one of the same type and owner, nearest first, since
/// nothing else about them carries over from one simulation to the other.
unsafe fn compare_displayed_units(bw: &BwScr) {
    unsafe {
        let displayed = DISPLAYED_UNITS.lock();
        let Some(displayed) = displayed.as_ref() else {
            return;
        };
        if bw.probe_frame_count() != Some(displayed.frame) {
            return;
        }
        let now = capture_units(bw);
        let is_anchored = |x: &&UnitView| displayed.anchored.binary_search(&x.key()).is_ok();
        let (shown_anchored, shown_new): (Vec<&UnitView>, Vec<&UnitView>) =
            displayed.units.iter().partition(is_anchored);
        let (now_anchored, mut now_new): (Vec<&UnitView>, Vec<&UnitView>) =
            now.iter().partition(is_anchored);

        let mut corrections = Corrections::default();
        let mut smoothing = SMOOTHING_OFFSETS.lock();
        let mut found = 0;
        for a in &shown_anchored {
            match now_anchored.binary_search_by_key(&a.unit, |x| x.unit) {
                Ok(index) if now_anchored[index].key() == a.key() => {
                    let b = now_anchored[index];
                    found += 1;
                    if a.id != b.id {
                        corrections.morphed += 1;
                    }
                    if (a.x, a.y) != (b.x, b.y) {
                        corrections.moves.push(a.distance(b));
                        smoothing.note(b, a);
                    }
                }
                _ => corrections.popped_out += 1,
            }
        }
        corrections.popped_in += (now_anchored.len() - found) as u32;

        for a in &shown_new {
            let nearest = now_new
                .iter()
                .enumerate()
                .filter(|(_, b)| b.id == a.id && b.player == a.player)
                .min_by_key(|(_, b)| a.distance(b))
                .map(|(index, _)| index);
            match nearest {
                Some(index) => {
                    let b = now_new.swap_remove(index);
                    if (a.x, a.y) != (b.x, b.y) {
                        corrections.moves.push(a.distance(b));
                        smoothing.note(b, a);
                    }
                }
                None => corrections.popped_out += 1,
            }
        }
        corrections.popped_in += now_new.len() as u32;
        *TICK_CORRECTIONS.lock() = corrections;
    }
}

/// Notes which units the snapshot just taken holds. Called right after each snapshot.
unsafe fn record_snapshot_units(bw: &BwScr) {
    unsafe {
        let mut keys = capture_units(bw)
            .iter()
            .map(|x| x.key())
            .collect::<Vec<_>>();
        keys.sort_unstable();
        *SNAPSHOT_UNITS.lock() = keys;
    }
}

/// Environment variable that turns on correction smoothing, holding the number of frames a
/// correction is spread over: a unit a rollback moved is drawn part of the way back towards where
/// the frame before showed it, and reaches its corrected position that many frames later instead
/// of jumping there. With 2 it is drawn 2/3, then 1/3 of the way back.
const SMOOTHING_ENV_VAR: &str = "SB_ROLLBACK_SMOOTHING";

/// The frames [`SMOOTHING_ENV_VAR`] spreads a correction over, or 0 when smoothing is off.
static SMOOTHING_FRAMES: AtomicU32 = AtomicU32::new(0);

/// Whether [`SMOOTHING_ENV_VAR`] asked for correction smoothing, which makes analysis resolve the
/// sprite position functions it hooks.
pub fn smoothing_enabled() -> bool {
    SMOOTHING_FRAMES.load(Ordering::Acquire) != 0
}

/// How far each corrected unit is drawn from where the simulation has it.
struct SmoothingOffsets {
    units: Vec<UnitOffset>,
}

struct UnitOffset {
    unit: usize,
    unique_index: u8,
    x: f32,
    y: f32,
    /// Frames left until the unit is drawn at its true position, counting the one that gets
    /// there.
    frames_left: u32,
}

impl SmoothingOffsets {
    /// Keeps `now` drawn where `shown` was drawn: the frame about to be shown carries on from the
    /// frame the correction replaced rather than from the corrected one.
    fn note(&mut self, now: &UnitView, shown: &UnitView) {
        let frames = SMOOTHING_FRAMES.load(Ordering::Relaxed);
        if frames == 0 {
            return;
        }
        let x = (shown.x - now.x) as f32;
        let y = (shown.y - now.y) as f32;
        match self
            .units
            .iter_mut()
            .find(|o| o.unit == now.unit && o.unique_index == now.unique_index)
        {
            Some(offset) => {
                offset.x += x;
                offset.y += y;
                offset.frames_left = frames + 1;
            }
            None => self.units.push(UnitOffset {
                unit: now.unit,
                unique_index: now.unique_index,
                x,
                y,
                frames_left: frames + 1,
            }),
        }
    }
}

static SMOOTHING_OFFSETS: Mutex<SmoothingOffsets> =
    Mutex::new(SmoothingOffsets { units: Vec::new() });

/// The drawing offset of each sprite for the frame being shown, sorted by sprite, which the
/// sprite position hooks read while the game layer is drawn.
static SPRITE_DRAW_OFFSETS: Mutex<Vec<(usize, i16, i16)>> = Mutex::new(Vec::new());

/// Whether the game layer is being drawn, the only time a sprite's position is reported with its
/// drawing offset. Everything else that reads sprite positions, the simulation and the vision
/// and sync pass that runs before the game layer is drawn included, sees the true position.
static DRAWING_GAME_LAYER: AtomicBool = AtomicBool::new(false);

/// Marks the start and end of the game layer's drawing. Called from the graphic layers hook.
pub fn set_drawing_game_layer(drawing: bool) {
    DRAWING_GAME_LAYER.store(drawing, Ordering::Relaxed);
}

/// The offset to add to `sprite`'s position as the game layer draws it, if it has one. Called
/// from the sprite position hooks.
pub fn sprite_draw_offset(sprite: usize) -> Option<(i16, i16)> {
    if !DRAWING_GAME_LAYER.load(Ordering::Relaxed) || !smoothing_enabled() {
        return None;
    }
    let offsets = SPRITE_DRAW_OFFSETS.lock();
    offsets
        .binary_search_by_key(&sprite, |x| x.0)
        .ok()
        .map(|index| (offsets[index].1, offsets[index].2))
}

/// Steps every unit's offset one frame closer to zero, in equal steps over the frames it has left,
/// and turns the result into the sprite offsets for the frame about to be shown. A unit that no
/// longer exists, or whose slot has been handed to another unit, loses its offset; a unit's
/// subunit (a turret) is drawn with the unit's offset.
unsafe fn update_draw_offsets() {
    unsafe {
        let mut offsets = SMOOTHING_OFFSETS.lock();
        let mut sprites = Vec::new();
        offsets.units.retain_mut(|offset| {
            let unit = offset.unit as *const bw::Unit;
            let alive = (*unit).flingy.sprite as usize != 0
                && (*unit).minor_unique_index == offset.unique_index;
            if !alive || offset.frames_left <= 1 {
                return false;
            }
            offset.x -= offset.x / offset.frames_left as f32;
            offset.y -= offset.y / offset.frames_left as f32;
            offset.frames_left -= 1;
            let x = offset.x.round() as i16;
            let y = offset.y.round() as i16;
            sprites.push(((*unit).flingy.sprite as usize, x, y));
            let subunit = (*unit).subunit;
            if !subunit.is_null() && !(*subunit).flingy.sprite.is_null() {
                sprites.push(((*subunit).flingy.sprite as usize, x, y));
            }
            true
        });
        sprites.sort_unstable_by_key(|x| x.0);
        *SPRITE_DRAW_OFFSETS.lock() = sprites;
    }
}

/// Wall time the parts of one tick took.
#[derive(Default)]
struct TickTimes {
    restore: Duration,
    steps: Duration,
    snapshot: Duration,
    /// The whole tick, bookkeeping and sound reconciliation included.
    total: Duration,
    /// Processor cycles the game thread ran for over the same span as `total`. A tick whose wall
    /// time is far above what these cycles take at the processor's usual rate spent the
    /// difference descheduled, which is the system's doing rather than the tick's.
    cycles: u64,
}

/// Processor cycles the calling thread has run for. Unlike wall time it stops counting while the
/// thread is not scheduled.
fn thread_cycles() -> u64 {
    use winapi::um::processthreadsapi::GetCurrentThread;
    use winapi::um::realtimeapiset::QueryThreadCycleTime;
    let mut cycles = 0;
    unsafe {
        QueryThreadCycleTime(GetCurrentThread(), &mut cycles);
    }
    cycles
}

struct HarnessFile {
    path: PathBuf,
    file: File,
}

/// Arms the harness if the environment asks for it. Called once while the DLL initialises, before
/// the game thread exists.
pub fn init_from_env() {
    if let Ok(spec) = std::env::var(DUMP_ENV_VAR) {
        match parse_frame_list(&spec) {
            Some(frames) if !frames.is_empty() => {
                info!(
                    "{DUMP_ENV_VAR}: dumping the snapshot ranges at {} frames, {}..={}",
                    frames.len(),
                    frames[0],
                    frames[frames.len() - 1],
                );
                *DUMP_FRAMES.lock() = frames;
                DUMP_ARMED.store(true, Ordering::Release);
            }
            _ => error!(
                "{DUMP_ENV_VAR}={spec:?} is not a comma-separated list of frames or \
                 <first>-<last>[/<step>] ranges; ignoring it"
            ),
        }
    }
    if let Ok(spec) = std::env::var(SMOOTHING_ENV_VAR) {
        match spec.parse::<u32>() {
            Ok(frames) if frames > 0 => {
                SMOOTHING_FRAMES.store(frames, Ordering::Release);
                info!(
                    "{SMOOTHING_ENV_VAR}: rollback corrections will be eased in over {frames} \
                     frames rather than snapped"
                );
            }
            _ => error!("{SMOOTHING_ENV_VAR}={spec:?} is not a frame count; ignoring it"),
        }
    }
    let Ok(spec) = std::env::var(ENV_VAR) else {
        if std::env::var(DELAY_ENV_VAR).is_ok() {
            error!("{DELAY_ENV_VAR} needs {ENV_VAR} to be set as well; ignoring it");
        }
        return;
    };
    let frames = match spec.parse::<u32>() {
        Ok(frames) if frames >= 1 => frames,
        _ => {
            error!("{ENV_VAR}={spec:?} is not a frame count of at least 1; ignoring it");
            return;
        }
    };
    // A tick's confirmed step is `frames` behind its newest frame, and it has to stay at or behind
    // every delayed player's known-through frame: a confirmed step that ran without commands the
    // player has since sent would leave those unapplied for good, and the confirmed timeline would
    // stop matching plain playback.
    let max_delay = init_delays_from_env();
    let frames = match frames < max_delay {
        true => {
            info!(
                "{ENV_VAR}={frames} is shallower than the largest delay; rolling back \
                 {max_delay} frames instead"
            );
            max_delay
        }
        false => frames,
    };
    ROLLBACK_FRAMES.store(frames, Ordering::Release);
    info!("{ENV_VAR} armed: every logic step will roll back {frames} frames");
    if let Ok(spec) = std::env::var(AUDIT_ENV_VAR) {
        match spec.parse::<u32>() {
            Ok(frame) if frame > frames => {
                AUDIT_FRAME.store(frame, Ordering::Release);
                info!("{AUDIT_ENV_VAR}: auditing the simulations of frame {frame}");
            }
            _ => error!("{AUDIT_ENV_VAR}={spec:?} is not a frame past the first tick; ignoring it"),
        }
    }
}

/// Whether anything currently wants the snapshot's ranges resolved: the harness is armed, a range
/// dump was asked for, or (checked by the caller) the rollback probe is active. Analysis resolving
/// them costs a noticeable part of launch time, so a run that wants none of these does not pay for
/// it.
pub(crate) fn wants_ranges() -> bool {
    ROLLBACK_FRAMES.load(Ordering::Acquire) != 0 || DUMP_ARMED.load(Ordering::Acquire)
}

/// Environment variable naming frames at which to write every snapshot range out, with or without
/// the harness armed: with it, from the confirmed step that produces the frame for the last time;
/// without it, from plain playback. Diffing the two dumps (pointers translated into range offsets)
/// shows what synced state a harness run has wrong before a fingerprint notices. Takes a
/// comma-separated list of frames and `<first>-<last>[/<step>]` ranges, so one run can bisect
/// toward the first frame the two disagree on: `500-9500/500`, then a finer range between the
/// last matching dump and the first differing one.
const DUMP_ENV_VAR: &str = "SB_ROLLBACK_DUMP_FRAME";

/// The frames [`DUMP_ENV_VAR`] names that have not been dumped yet, ascending.
static DUMP_FRAMES: Mutex<Vec<u32>> = Mutex::new(Vec::new());

/// Whether [`DUMP_ENV_VAR`] asked for any dumps, so a step can check without taking the lock.
static DUMP_ARMED: AtomicBool = AtomicBool::new(false);

/// Parses a [`DUMP_ENV_VAR`] value into ascending, deduplicated frames, or `None` if any entry is
/// malformed.
fn parse_frame_list(spec: &str) -> Option<Vec<u32>> {
    let mut frames = Vec::new();
    for entry in spec.split(',').map(|x| x.trim()).filter(|x| !x.is_empty()) {
        match entry.split_once('-') {
            None => frames.push(entry.parse::<u32>().ok()?),
            Some((first, rest)) => {
                let (last, step) = match rest.split_once('/') {
                    Some((last, step)) => (last, step.parse::<u32>().ok()?),
                    None => (rest, 1),
                };
                let (first, last) = (first.parse::<u32>().ok()?, last.parse::<u32>().ok()?);
                if step == 0 || first > last {
                    return None;
                }
                frames.extend((first..=last).step_by(step as usize));
            }
        }
    }
    frames.retain(|&x| x > 0);
    frames.sort_unstable();
    frames.dedup();
    Some(frames)
}

/// Writes the snapshot ranges to `rollback-dump-<frame>-<pid>.bin`, with their layout in a `.csv`
/// beside it, when the simulation is on one of the frames [`DUMP_ENV_VAR`] names.
unsafe fn dump_if_due(bw: &BwScr) {
    unsafe {
        if !DUMP_ARMED.load(Ordering::Relaxed) {
            return;
        }
        let Some(target) = bw.probe_frame_count() else {
            return;
        };
        {
            let mut frames = DUMP_FRAMES.lock();
            match frames.binary_search(&target) {
                Ok(index) => {
                    frames.remove(index);
                }
                Err(_) => return,
            }
        }
        let Some(layout) = Snapshots::build(bw) else {
            error!("{DUMP_ENV_VAR}: could not lay out the snapshot ranges");
            return;
        };
        let exe_base = bw.rollback_exe_data_section().map(|x| x.0).unwrap_or(0);
        let mut bytes = Vec::new();
        let mut table = format!("exe_base,{exe_base:x},0\nname,start,len\n");
        for range in layout.ranges() {
            bytes.extend_from_slice(std::slice::from_raw_parts(
                range.start() as *const u8,
                range.len(),
            ));
            table.push_str(&format!(
                "{},{:x},{:x}\n",
                range.name(),
                range.start(),
                range.len()
            ));
        }
        let logs = crate::parse_args().user_data_path.join("logs");
        let stem = format!("rollback-dump-{target}-{}", std::process::id());
        let results = [
            std::fs::write(logs.join(format!("{stem}.bin")), &bytes),
            std::fs::write(logs.join(format!("{stem}.csv")), &table),
        ];
        match results.iter().find_map(|x| x.as_ref().err()) {
            None => info!("{DUMP_ENV_VAR}: wrote {stem} ({} bytes)", bytes.len()),
            Some(e) => error!("{DUMP_ENV_VAR}: could not write {stem}: {e}"),
        }
    }
}

fn audit_armed() -> bool {
    AUDIT_FRAME.load(Ordering::Relaxed) != 0 && !AUDIT_DONE.load(Ordering::Relaxed)
}

/// Copies the executable's static data before the step that first simulates the audited frame,
/// and diffs against that copy before the confirmed step that simulates it for the last time.
unsafe fn audit_before_step(bw: &BwScr, ranges: &[Range], confirmed: bool) {
    unsafe {
        let target = AUDIT_FRAME.load(Ordering::Relaxed);
        if bw.probe_frame_count().map(|x| x + 1) != Some(target) {
            return;
        }
        let Some((exe_base, data, data_len)) = bw.rollback_exe_data_section() else {
            return;
        };
        let current = std::slice::from_raw_parts(data as *const u8, data_len);
        let mut stored = AUDIT_FIRST.lock();
        let Some(first) = stored.as_ref() else {
            *stored = Some(current.to_vec());
            info!("Rollback audit captured static data before frame {target} was first simulated");
            return;
        };
        if !confirmed {
            return;
        }
        AUDIT_DONE.store(true, Ordering::Relaxed);
        let covered = |address: usize| {
            ranges
                .iter()
                .any(|x| address >= x.start() && address < x.start() + x.len())
        };
        let word = size_of::<usize>();
        let mut lines = Vec::new();
        for offset in (0..data_len.min(first.len()) - word + 1).step_by(word) {
            let address = data + offset;
            let before = &first[offset..offset + word];
            let after = &current[offset..offset + word];
            if before != after && !covered(address) {
                let value = |bytes: &[u8]| {
                    bytes
                        .iter()
                        .rev()
                        .fold(0usize, |acc, &x| (acc << 8) | x as usize)
                };
                lines.push(format!(
                    "{:x},{:x},{:x}",
                    address - exe_base,
                    value(before),
                    value(after),
                ));
            }
        }
        write_audit(
            &format!("rollback-audit-{target}.csv"),
            "exe_offset,first,final",
            &lines,
        );
    }
}

/// Copies the snapshot's ranges after the step that first simulates the audited frame, and diffs
/// against that copy after the confirmed step that simulates it for the last time. The two steps
/// start from the same snapshot state, so where their results differ is what the leftover state
/// [`audit_before_step`] reports made the simulation do differently.
unsafe fn audit_after_step(bw: &BwScr, ranges: &[Range], confirmed: bool) {
    unsafe {
        let target = AUDIT_FRAME.load(Ordering::Relaxed);
        if bw.probe_frame_count() != Some(target) {
            return;
        }
        let mut current = Vec::new();
        for range in ranges {
            current.extend_from_slice(std::slice::from_raw_parts(
                range.start() as *const u8,
                range.len(),
            ));
        }
        let mut stored = AUDIT_FIRST_RESULT.lock();
        let Some(first) = stored.as_ref() else {
            *stored = Some(current);
            return;
        };
        if !confirmed {
            return;
        }
        let word = size_of::<usize>();
        let mut lines = Vec::new();
        let mut base = 0;
        for (index, range) in ranges.iter().enumerate() {
            for offset in (0..range.len()).step_by(word) {
                let end = (offset + word).min(range.len());
                let before = &first[base + offset..base + end];
                let after = &current[base + offset..base + end];
                if before != after {
                    let hex = |bytes: &[u8]| {
                        bytes
                            .iter()
                            .rev()
                            .map(|x| format!("{x:02x}"))
                            .collect::<String>()
                    };
                    lines.push(format!(
                        "{},{index},{:x},{offset:x},{},{}",
                        range.name(),
                        range.start(),
                        hex(before),
                        hex(after),
                    ));
                }
            }
            base += range.len();
        }
        write_audit(
            &format!("rollback-audit-{target}-result.csv"),
            "range,index,range_start,offset,first,final",
            &lines,
        );
    }
}

fn write_audit(file_name: &str, header: &str, lines: &[String]) {
    let path = crate::parse_args()
        .user_data_path
        .join("logs")
        .join(file_name);
    let contents = format!("{header}\n{}\n", lines.join("\n"));
    match std::fs::write(&path, contents) {
        Ok(()) => info!(
            "Rollback audit: {} differing words written to {}",
            lines.len(),
            path.display(),
        ),
        Err(e) => error!("Rollback audit could not write {}: {e}", path.display()),
    }
}

/// A change of depth and delays asked for while a game is running, waiting for the game thread's
/// next logic step.
struct Settings {
    depth: u32,
    delays: [u32; bw::MAX_STORM_PLAYERS],
}

static PENDING_SETTINGS: Mutex<Option<Settings>> = Mutex::new(None);

/// Whether [`PENDING_SETTINGS`] holds a change, so a logic step can check without taking the lock.
static SETTINGS_PENDING: AtomicBool = AtomicBool::new(false);

/// Asks for a new rollback depth and set of per-player delays (`(storm player, frames)`; players
/// not listed get none) from the next logic step on. A depth of 0 stops rolling back; a nonzero
/// depth below the largest delay is raised to it. Only takes effect in a game whose harness was
/// armed at launch, since that is what makes analysis resolve the snapshot's ranges.
pub fn request_settings(depth: u32, delays: &[(u8, u32)]) {
    let mut per_player = [0; bw::MAX_STORM_PLAYERS];
    for &(player, frames) in delays {
        match per_player.get_mut(player as usize) {
            Some(slot) => *slot = frames,
            None => error!("Rollback settings: storm player {player} is out of range; ignoring it"),
        }
    }
    info!("Rollback settings requested: depth {depth}, delays {per_player:?}");
    *PENDING_SETTINGS.lock() = Some(Settings {
        depth,
        delays: per_player,
    });
    SETTINGS_PENDING.store(true, Ordering::Release);
}

/// Applies a pending change of depth and delays. The simulation goes back to the newest confirmed
/// frame first: that state is right whatever the delays are, so the next tick can anchor there as
/// if the game had just started, and the frame on screen moves once by the difference in depth.
unsafe fn apply_pending_settings(bw: &BwScr) {
    unsafe {
        let Some(settings) = PENDING_SETTINGS.lock().take() else {
            return;
        };
        if bw.rollback_range_specs().is_empty() {
            error!("Rollback settings ignored: the harness was not armed when the game launched");
            return;
        }
        let mut max_delay = 0;
        for (slot, &frames) in DELAYS.iter().zip(settings.delays.iter()) {
            slot.store(frames, Ordering::Release);
            max_delay = max_delay.max(frames);
        }
        ANY_DELAY.store(max_delay != 0, Ordering::Release);
        let depth = match settings.depth {
            0 => 0,
            depth => depth.max(max_delay),
        };

        let mut guard = SNAPSHOTS.lock();
        if let Some(snapshot) = guard.as_mut()
            && let Some(confirmed) = snapshot.confirmed()
        {
            bw.rollback_clear_selection_visuals();
            snapshot.restore(confirmed, bw);
            snapshot.clear_confirmed();
            bw.rollback_rebuild_selection_visuals();
        }
        if depth == 0 {
            // Rebuilt from scratch should rolling back be turned on again later, anchored wherever
            // the game has got to by then.
            *guard = None;
            sounds::forget_presented();
        }
        drop(guard);
        // The frame on screen jumps with the depth; that is not a correction.
        *DISPLAYED_UNITS.lock() = None;
        ROLLBACK_FRAMES.store(depth, Ordering::Release);
        info!(
            "Rollback settings applied: depth {depth}, delays {:?}",
            settings.delays
        );
    }
}

/// Reads the per-player command delays out of the environment and stores them, returning the
/// largest one so the caller can keep the rollback depth at or above it.
fn init_delays_from_env() -> u32 {
    let Ok(spec) = std::env::var(DELAY_ENV_VAR) else {
        return 0;
    };
    let mut max_delay = 0;
    for entry in spec.split(',').filter(|x| !x.trim().is_empty()) {
        let parsed = entry.split_once(':').and_then(|(player, delay)| {
            let player = player.trim().parse::<usize>().ok()?;
            let delay = delay.trim().parse::<u32>().ok()?;
            (player < bw::MAX_STORM_PLAYERS).then_some((player, delay))
        });
        let Some((player, delay)) = parsed else {
            error!(
                "{DELAY_ENV_VAR} entry {entry:?} is not <storm player id>:<frames> with an id \
                 below {}; ignoring it",
                bw::MAX_STORM_PLAYERS,
            );
            continue;
        };
        DELAYS[player].store(delay, Ordering::Release);
        if delay != 0 {
            ANY_DELAY.store(true, Ordering::Release);
            max_delay = max_delay.max(delay);
            info!("Storm player {player}'s commands will be known {delay} frames late");
        }
    }
    max_delay
}

/// Whether the command the replay records for `command_frame` from `storm_player` has been
/// received by the time the tick in progress reaches its newest frame.
///
/// A step reads the commands of one frame, `step_frame`, and the tick runs
/// [`STEPS_AFTER_CURRENT`] more steps after it, so the tick's newest frame (the present the
/// simulation is being driven to) is `present = step_frame + steps_after_current`. A player with a
/// delay of `K` frames is heard from `K` frames after the frame a command was issued for, so the
/// command counts as known once `present >= command_frame + K`, which is the test below.
///
/// The confirmed step reads `step_frame = present - R`, and `R` is at least every delayed player's
/// `K`, so `command_frame <= present - R <= present - K` holds for every command it reads and the
/// confirmed timeline applies all of them on the frame the replay recorded them for. A command a
/// predicted step skips is read again on a later tick, since restoring a snapshot rewinds the
/// replay cursor along with the simulation.
pub fn replay_command_is_known(
    storm_player: StormPlayerId,
    command_frame: u32,
    step_frame: u32,
) -> bool {
    if !ANY_DELAY.load(Ordering::Relaxed) || !rollback::tick_running() {
        return true;
    }
    let Some(delay) = DELAYS.get(storm_player.0 as usize) else {
        return true;
    };
    let delay = delay.load(Ordering::Relaxed);
    if delay == 0 {
        return true;
    }
    let present = step_frame.saturating_add(STEPS_AFTER_CURRENT.load(Ordering::Relaxed));
    if command_frame.saturating_add(delay) > present {
        SUPPRESSED_COMMANDS.fetch_add(1, Ordering::Relaxed);
        return false;
    }
    if rollback::in_confirmed_step() {
        APPLIED_DELAYED_COMMANDS.fetch_add(1, Ordering::Relaxed);
    }
    true
}

/// Drops the snapshot and its range list, so the next logic step rebuilds both, and clears the
/// display and smoothing state that only makes sense for the frame just shown. Called when the
/// game loop (re-)enters game init (which is how a backwards replay seek restarts playback).
pub fn reset_for_game_init() {
    if SNAPSHOTS.lock().take().is_some() {
        debug!("Rollback harness snapshot dropped for game init");
    }
    *DISPLAYED_UNITS.lock() = None;
    SMOOTHING_OFFSETS.lock().units.clear();
    SPRITE_DRAW_OFFSETS.lock().clear();
    rollback::reset_for_game_init();
}

/// Runs BW's logic step for one tick of the game loop, rolling the simulation back and
/// re-simulating it first when the harness is armed.
///
/// Every step still goes through the rollback probe, so the two measure independently: with only
/// the probe armed this is one plain step, and with both armed the probe sees each re-simulated
/// frame as a step of its own.
pub unsafe fn run_game_logic_step(
    bw: &'static BwScr,
    param: usize,
    orig: unsafe extern "C" fn(usize) -> usize,
) -> usize {
    unsafe {
        if SETTINGS_PENDING.swap(false, Ordering::AcqRel) {
            apply_pending_settings(bw);
        }
        let rollback_frames = ROLLBACK_FRAMES.load(Ordering::Acquire);
        if rollback_frames == 0 {
            let ret = crate::rollback_probe::run_game_logic_step(bw, param, orig);
            dump_if_due(bw);
            return ret;
        }
        if !ELIGIBILITY_CHECKED.swap(true, Ordering::AcqRel) && !game_thread::is_replay() {
            // Rolling a live game back would re-send network turns that have already gone out, and
            // there would be nothing to compare the fingerprints against either.
            ROLLBACK_FRAMES.store(0, Ordering::Release);
            info!("{ENV_VAR} only runs during replay playback; leaving the simulation alone");
            return crate::rollback_probe::run_game_logic_step(bw, param, orig);
        }
        if !bw.rollback_observer_ui_hooked() {
            // Re-simulated frames would repeat the observer UI's notifications, and it
            // dereferences records a repeated notification has already consumed.
            ROLLBACK_FRAMES.store(0, Ordering::Release);
            error!("{ENV_VAR} needs the observer UI hooks, which analysis could not resolve");
            return crate::rollback_probe::run_game_logic_step(bw, param, orig);
        }
        run_tick(bw, param, orig, rollback_frames as usize)
    }
}

unsafe fn run_tick(
    bw: &'static BwScr,
    param: usize,
    orig: unsafe extern "C" fn(usize) -> usize,
    rollback_frames: usize,
) -> usize {
    unsafe {
        let tick_start = Instant::now();
        let tick_start_cycles = thread_cycles();
        let mut guard = SNAPSHOTS.lock();
        if guard.is_none() {
            *guard = Snapshots::build(bw);
        }
        let Some(snapshot) = guard.as_mut() else {
            return crate::rollback_probe::run_game_logic_step(bw, param, orig);
        };

        // `steps_after` is how many further steps the tick runs once this one is done, which is
        // what turns the frame a step reads commands for into the tick's newest frame.
        let audit_ranges = audit_armed().then(|| snapshot.ranges().to_vec());
        let step = |steps_after: usize, confirmed: bool| {
            if let Some(ranges) = &audit_ranges {
                audit_before_step(bw, ranges, confirmed);
            }
            STEPS_AFTER_CURRENT.store(steps_after as u32, Ordering::Relaxed);
            rollback::set_step_confirmed(confirmed);
            let start = Instant::now();
            let ret = crate::rollback_probe::run_game_logic_step(bw, param, orig);
            let elapsed = start.elapsed();
            if let Some(ranges) = &audit_ranges {
                audit_after_step(bw, ranges, confirmed);
            }
            if confirmed {
                dump_if_due(bw);
            }
            compare_displayed_units(bw);
            (ret, elapsed)
        };

        let mut times = TickTimes::default();
        let mut ret = 0;
        // Every step pushes the tick the game loop paces itself against one frame further into the
        // future, so after a tick that simulates several frames it goes back to the value the
        // first step left it at, keeping real-time pacing at exactly one frame per tick.
        let mut paced_tick = None;
        // The fingerprint of the state the tick's snapshot holds: the newest frame that every
        // command the replay records for it has been applied on.
        let confirmed_fingerprint;

        SUPPRESSED_COMMANDS.store(0, Ordering::Relaxed);
        APPLIED_DELAYED_COMMANDS.store(0, Ordering::Relaxed);
        *TICK_CORRECTIONS.lock() = Corrections::default();
        rollback::begin_tick();
        match snapshot.confirmed() {
            // Steady state: the snapshot is `rollback_frames` frames behind the simulation, so
            // going back to it and simulating one frame re-derives the frame the snapshot moves on
            // to, and the remaining steps catch back up and add the one new frame.
            Some(confirmed) => {
                let start = Instant::now();
                // Selection circles come from a small pool of their own, outside the snapshot, so
                // the ones on the frame being shown go back to it before the restore drops the
                // sprites they are attached to; otherwise every tick would leak them until none
                // are left to show.
                bw.rollback_clear_selection_visuals();
                snapshot.restore(confirmed, bw);
                times.restore = start.elapsed();

                let (step_ret, elapsed) = step(rollback_frames, true);
                ret = step_ret;
                times.steps += elapsed;
                paced_tick = Some(bw.probe_next_game_step_tick());
                confirmed_fingerprint = bw.probe_fingerprint();

                let start = Instant::now();
                bw.rollback_clear_selection_visuals();
                snapshot.take(1 - confirmed);
                times.snapshot = start.elapsed();
                record_snapshot_units(bw);

                for frame in 0..rollback_frames {
                    let (step_ret, elapsed) = step(rollback_frames - 1 - frame, false);
                    ret = step_ret;
                    times.steps += elapsed;
                }
            }
            // First tick of the game: anchor the snapshot here and run the simulation
            // `rollback_frames` frames past it, which is the distance every later tick keeps.
            None => {
                let start = Instant::now();
                bw.rollback_clear_selection_visuals();
                snapshot.take(0);
                times.snapshot = start.elapsed();
                record_snapshot_units(bw);
                // No step of this tick re-derives a frame, so the state the snapshot just captured
                // is the confirmed one and its fingerprint is already final.
                confirmed_fingerprint = bw.probe_fingerprint();

                for frame in 0..rollback_frames {
                    let (step_ret, elapsed) = step(rollback_frames - 1 - frame, false);
                    ret = step_ret;
                    times.steps += elapsed;
                    if frame == 0 {
                        paced_tick = Some(bw.probe_next_game_step_tick());
                    }
                }
            }
        }

        rollback::end_tick();
        // Selection circles and health bars hang off the simulation's sprites but belong to what
        // the person watching has selected. They come off before every restore and every
        // snapshot, and go back on here for the frame about to be shown.
        bw.rollback_rebuild_selection_visuals();
        if let Some(frame) = bw.probe_frame_count() {
            *DISPLAYED_UNITS.lock() = Some(DisplayedFrame {
                frame,
                units: capture_units(bw),
                anchored: std::mem::take(&mut SNAPSHOT_UNITS.lock()),
            });
            update_draw_offsets();
        }
        if let Some(paced_tick) = paced_tick {
            bw.probe_set_next_game_step_tick(paced_tick);
        }
        drop(guard);

        if let (Some(present), Some(confirmed)) = (bw.probe_fingerprint(), confirmed_fingerprint) {
            let sound_counts = sounds::reconcile_sounds(bw, confirmed.frame, present.frame);
            times.total = tick_start.elapsed();
            times.cycles = thread_cycles().wrapping_sub(tick_start_cycles);
            write_row(
                &present,
                &confirmed,
                SUPPRESSED_COMMANDS.load(Ordering::Relaxed),
                APPLIED_DELAYED_COMMANDS.load(Ordering::Relaxed),
                &sound_counts,
                &TICK_CORRECTIONS.lock(),
                &times,
            );
        } else {
            sounds::forget_requested();
        }
        ret
    }
}

fn write_row(
    present: &Fingerprint,
    confirmed: &Fingerprint,
    suppressed_commands: u32,
    applied_delayed_commands: u32,
    sounds: &SoundCounts,
    corrections: &Corrections,
    times: &TickTimes,
) {
    let mut log_file = LOG_FILE.lock();
    if log_file.is_none() {
        match HarnessFile::create() {
            Ok(file) => {
                info!("Rollback harness logging to {}", file.path.display());
                *log_file = Some(file);
            }
            Err(e) => {
                error!("Rollback harness could not open its log file: {e}");
                ROLLBACK_FRAMES.store(0, Ordering::Release);
                return;
            }
        }
    }
    let Some(log_file) = log_file.as_mut() else {
        return;
    };
    // Every move rather than a summary of them, so an analysis can take percentiles over a whole
    // run; they are few enough per tick that the row stays short.
    let moves = corrections
        .moves
        .iter()
        .map(|x| x.to_string())
        .collect::<Vec<_>>()
        .join(";");
    let result = writeln!(
        &mut log_file.file,
        "{},{},{},{suppressed_commands},{applied_delayed_commands},{},{},{},{},{},{},{},{},{},{moves},\
         {},{},{},{},{}",
        fingerprint_columns(present),
        fingerprint_columns(confirmed),
        ROLLBACK_FRAMES.load(Ordering::Relaxed),
        sounds.on_time,
        sounds.late,
        sounds.late_frames,
        sounds.stale,
        corrections.moves.len(),
        corrections.moves.iter().copied().max().unwrap_or(0),
        corrections.morphed,
        corrections.popped_in,
        corrections.popped_out,
        times.restore.as_micros(),
        times.steps.as_micros(),
        times.snapshot.as_micros(),
        times.total.as_micros(),
        times.cycles / 1000,
    );
    if let Err(e) = result {
        // Give up on the file rather than logging once per frame for the rest of the game.
        error!("Rollback harness write failed, closing the log: {e}");
        ROLLBACK_FRAMES.store(0, Ordering::Release);
    }
}

/// One fingerprint as CSV columns: the frame it was taken on, the words around the RNG seed, the
/// first four players' minerals and gas, and the trigger countdown.
fn fingerprint_columns(fingerprint: &Fingerprint) -> String {
    let rng = &fingerprint.rng;
    let minerals = &fingerprint.minerals;
    let gas = &fingerprint.gas;
    format!(
        "{},{},{},{},{},{},{},{},{},{},{},{},{},{},{},{},{}",
        fingerprint.frame,
        rng[0],
        rng[1],
        rng[2],
        rng[3],
        rng[4],
        rng[5],
        minerals[0],
        minerals[1],
        minerals[2],
        minerals[3],
        gas[0],
        gas[1],
        gas[2],
        gas[3],
        fingerprint.trigger_timer,
        fingerprint.extra_columns(),
    )
}

impl HarnessFile {
    fn create() -> Result<HarnessFile, String> {
        let seconds = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or(Duration::ZERO)
            .as_secs();
        // Alongside the game log, which is the directory anyone collecting a run's artifacts
        // already picks up. The process id keeps games started in the same second from
        // truncating each other's file.
        let path = crate::parse_args()
            .user_data_path
            .join("logs")
            .join(format!(
                "rollback-harness-{seconds}-{}.csv",
                std::process::id()
            ));
        let mut file = File::create(&path).map_err(|e| format!("{}: {e}", path.display()))?;
        writeln!(
            &mut file,
            "frame,rng0,rng1,rng2,rng3,rng4,rng5,\
             minerals0,minerals1,minerals2,minerals3,gas0,gas1,gas2,gas3,trigger_timer,\
             elapsed_seconds,player_types,state_hash,\
             confirmed_frame,c_rng0,c_rng1,c_rng2,c_rng3,c_rng4,c_rng5,\
             c_minerals0,c_minerals1,c_minerals2,c_minerals3,c_gas0,c_gas1,c_gas2,c_gas3,\
             c_trigger_timer,c_elapsed_seconds,c_player_types,c_state_hash,rollback_frames,\
             suppressed_commands,applied_delayed_commands,\
             sounds_on_time,sounds_late,sounds_late_frames,sounds_stale,\
             units_moved,max_move,units_morphed,units_popped_in,units_popped_out,move_distances,\
             restore_micros,steps_micros,snapshot_micros,tick_micros,tick_kcycles"
        )
        .map_err(|e| format!("{}: {e}", path.display()))?;
        Ok(HarnessFile { path, file })
    }
}
