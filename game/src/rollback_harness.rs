//! Drives the rollback engine ([`crate::rollback`]) off replay playback, to prove that its
//! snapshot ranges capture the whole synced state and to measure how the game would look if it
//! predicted ahead of some players' commands.
//!
//! It can hold chosen players' commands back: a player given a delay of `K` frames is only heard
//! from `K` frames after the frame a command was issued for, so the frames simulated before then
//! run without it and are a prediction. When the command becomes known, the next tick rolls back
//! to the frame it was issued for and re-simulates with it, as a live game would when a late turn
//! arrives. Once every delayed player has been heard from for a frame it is confirmed: it
//! reproduces plain playback exactly, while the frames past it differ by however wrong the
//! prediction was. Each row of the log carries both the present frame and the newest confirmed
//! one, which is the measurement.
//!
//! On top of that it can force a rollback of a fixed depth every tick, re-simulating frames whose
//! inputs have not changed at all. If the snapshot's ranges cover the state completely, the
//! per-frame fingerprint is identical to a plain playback of the same replay and the game plays on
//! unchanged; state the ranges miss shows up as a fingerprint divergence against a plain
//! playback's [`crate::rollback_probe`] rows, keyed by frame.
//!
//! Compiled out of release DLLs along with the engine it drives.

use std::collections::BTreeMap;
use std::fs::File;
use std::io::Write;
use std::mem::size_of;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, AtomicI32, AtomicU32, Ordering};
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
use crate::rollback::tick::{self, TickPlan};
use crate::rollback_probe::Fingerprint;

/// Environment variable that arms the harness, holding a rollback depth in frames that every tick
/// re-simulates whether or not any command came late: with `SB_ROLLBACK_HARNESS=8` every tick goes
/// back at least eight frames. With 0 a tick rolls back only when a delayed player's command
/// arrives, as a live game would.
const ENV_VAR: &str = "SB_ROLLBACK_HARNESS";

/// Environment variable holding the spacing of the snapshots in frames: with
/// `SB_ROLLBACK_SNAPSHOT_SPACING=3` every third frame is snapshotted, and a rollback re-simulates
/// from the newest snapshot at or before the frame it needs. Defaults to
/// [`tick::DEFAULT_SNAPSHOT_SPACING`].
const SPACING_ENV_VAR: &str = "SB_ROLLBACK_SNAPSHOT_SPACING";

/// The snapshot spacing [`SPACING_ENV_VAR`] asks for, if it is set to a valid one.
pub(crate) fn snapshot_spacing_from_env() -> Option<u32> {
    let spec = std::env::var(SPACING_ENV_VAR).ok()?;
    match spec.parse::<u32>() {
        Ok(spacing) if spacing >= 1 => {
            info!("{SPACING_ENV_VAR}: snapshotting every {spacing} frames");
            Some(spacing)
        }
        _ => {
            error!("{SPACING_ENV_VAR}={spec:?} is not a frame count of at least 1; ignoring it");
            None
        }
    }
}

/// Environment variable that gives chosen players a command delay, holding a comma-separated list
/// of `<storm player id>:<frames>`: with `SB_ROLLBACK_DELAY=1:3,2:2` storm player 1's commands are
/// only known three frames after the frame they were issued for and storm player 2's two frames
/// after. Does nothing on its own; the delays are only applied while [`ENV_VAR`] arms the harness.
const DELAY_ENV_VAR: &str = "SB_ROLLBACK_DELAY";

/// Environment variable naming one frame whose simulations to audit: the executable's static data
/// is copied just before the step that first simulates the frame and again before every later
/// step that simulates it, and every difference outside the snapshot's ranges is written out,
/// each simulation's diff replacing the last. What is left compares the first simulation with
/// the last one, which is the simulation whose fingerprint the harness reports for the frame.
/// Every simulation starts from the same snapshot state, so with no delayed players a difference
/// there is state the earlier simulations left behind that the snapshot does not cover.
/// Needs a forced depth, since otherwise nothing simulates a frame twice.
const AUDIT_ENV_VAR: &str = "SB_ROLLBACK_AUDIT_FRAME";

/// Environment variable naming a frame that replay playback steps to as fast as it can before it
/// plays on in real time, with or without the harness armed: `SB_ROLLBACK_HARNESS_FROM=12000`
/// starts measuring in the middle of a game rather than at its start. Frame timings
/// ([`crate::frame_timing`]) start over once it is reached.
const FROM_ENV_VAR: &str = "SB_ROLLBACK_HARNESS_FROM";

/// The frame [`FROM_ENV_VAR`] names, or 0 once it has been reached or when none was asked for.
static FROM_FRAME: AtomicU32 = AtomicU32::new(0);

/// Environment variable holding the players (a hexadecimal bit mask) whose vision replay playback
/// shows from [`FROM_ENV_VAR`]'s frame on, standing in for a player's fog of war in a live game:
/// `SB_ROLLBACK_HARNESS_VISION=1` shows only player 0's.
const VISION_ENV_VAR: &str = "SB_ROLLBACK_HARNESS_VISION";

/// The players [`VISION_ENV_VAR`] names, or -1 when it isn't set.
static VISION: AtomicI32 = AtomicI32::new(-1);

/// Plain steps run per game loop tick while stepping to [`FROM_FRAME`].
const FAST_FORWARD_STEPS_PER_TICK: u32 = 400;

/// The frame [`AUDIT_ENV_VAR`] names, or 0 when no audit was asked for.
static AUDIT_FRAME: AtomicU32 = AtomicU32::new(0);

/// The static data copied before the audited frame was first simulated, once it has been.
static AUDIT_FIRST: Mutex<Option<Vec<u8>>> = Mutex::new(None);

/// The snapshot's ranges as the step that first simulated the audited frame left them.
static AUDIT_FIRST_RESULT: Mutex<Option<Vec<u8>>> = Mutex::new(None);

/// Whether the harness is armed.
static ARMED: AtomicBool = AtomicBool::new(false);

/// The depth in frames every tick rolls back whether or not a command came late.
static FORCED_DEPTH: AtomicU32 = AtomicU32::new(0);

/// Frames between snapshots.
static SNAPSHOT_SPACING: AtomicU32 = AtomicU32::new(tick::DEFAULT_SNAPSHOT_SPACING);

/// A delayed player's command that a step read before it was known, and so left unapplied.
struct LateCommand {
    storm_player: StormPlayerId,
    /// The frame the replay records it for.
    command_frame: u32,
    /// Frames after `command_frame` it becomes known (see [`command_delay`]).
    delay: u32,
    /// The frame count the step that read it started from, which a rollback has to restore to (or
    /// before) for the command to be applied on its own frame.
    read_from: u32,
}

/// The commands left unapplied so far that are not known yet, each once.
static LATE_COMMANDS: Mutex<Vec<LateCommand>> = Mutex::new(Vec::new());

/// The newest confirmed frame count as of the last tick.
static LAST_CONFIRMED: AtomicU32 = AtomicU32::new(0);

/// A frame count the next tick has to re-simulate from, set when the delays change so the frames
/// already predicted are simulated again with the new ones.
static RESIMULATE_FROM: Mutex<Option<u32>> = Mutex::new(None);

/// The fingerprint of each frame count's most recent simulation, from the newest confirmed one on
/// (with some history, since a change of delays can move the confirmed frame back). A confirmed
/// frame's entry is its final simulation, which is what a row reports as the confirmed state.
static FINGERPRINTS: Mutex<BTreeMap<u32, Fingerprint>> = Mutex::new(BTreeMap::new());

/// Fingerprints kept from before the newest confirmed frame.
const FINGERPRINT_HISTORY: u32 = 256;

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

/// Commands of delayed players that the current tick's steps applied on confirmed frames.
static APPLIED_DELAYED_COMMANDS: AtomicU32 = AtomicU32::new(0);

/// How far a tick's present is in the replay's frame numbering, which decides whether a command is
/// known, from the same present as a frame count, which a tick is planned in. Observed by
/// [`replay_command_is_known`] whenever it holds a command back; `i32::MIN` until it first has.
static COMMAND_FRAME_OFFSET: AtomicI32 = AtomicI32::new(i32::MIN);

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

/// The frame on screen as a tick left it, kept so a later tick that re-simulates it can see how
/// the late commands changed it.
struct DisplayedFrame {
    frame: u32,
    units: Vec<UnitView>,
}

static DISPLAYED_UNITS: Mutex<Option<DisplayedFrame>> = Mutex::new(None);

/// The slot and unique index of every unit in the snapshot the tick in progress restored, sorted.
/// Both simulations of the frame on screen grow from that snapshot, so a unit it holds is the same
/// unit wherever the two show its slot and index. A unit created after it is not: the two
/// simulations hand slots out in whatever order their commands made them, and can give one slot
/// and index to two different units.
static ANCHORED_UNITS: Mutex<Vec<(usize, u8)>> = Mutex::new(Vec::new());

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
        if bw.rollback_frame_count() != Some(displayed.frame) {
            return;
        }
        let now = capture_units(bw);
        let anchored = ANCHORED_UNITS.lock();
        let is_anchored = |x: &&UnitView| anchored.binary_search(&x.key()).is_ok();
        let (shown_anchored, shown_new): (Vec<&UnitView>, Vec<&UnitView>) =
            displayed.units.iter().partition(is_anchored);
        let (now_anchored, mut now_new): (Vec<&UnitView>, Vec<&UnitView>) =
            now.iter().partition(is_anchored);

        let mut corrections = Corrections::default();
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
                    }
                }
                None => corrections.popped_out += 1,
            }
        }
        corrections.popped_in += now_new.len() as u32;
        *TICK_CORRECTIONS.lock() = corrections;
    }
}

/// Notes which units the snapshot just restored holds. Called before the first step after a
/// restore.
unsafe fn record_anchored_units(bw: &BwScr) {
    unsafe {
        let mut keys = capture_units(bw)
            .iter()
            .map(|x| x.key())
            .collect::<Vec<_>>();
        keys.sort_unstable();
        *ANCHORED_UNITS.lock() = keys;
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
    if let Ok(spec) = std::env::var(FROM_ENV_VAR) {
        match spec.parse::<u32>() {
            Ok(frame) => {
                info!("{FROM_ENV_VAR}: stepping replay playback to frame {frame} first");
                FROM_FRAME.store(frame, Ordering::Release);
            }
            Err(_) => error!("{FROM_ENV_VAR}={spec:?} is not a frame; ignoring it"),
        }
    }
    if let Ok(spec) = std::env::var(VISION_ENV_VAR) {
        match u8::from_str_radix(spec.trim_start_matches("0x"), 16) {
            Ok(players) => VISION.store(players.into(), Ordering::Release),
            Err(_) => error!("{VISION_ENV_VAR}={spec:?} is not a player mask; ignoring it"),
        }
    }
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
    let Ok(spec) = std::env::var(ENV_VAR) else {
        if std::env::var(DELAY_ENV_VAR).is_ok() {
            error!("{DELAY_ENV_VAR} needs {ENV_VAR} to be set as well; ignoring it");
        }
        return;
    };
    let depth = match spec.parse::<u32>() {
        Ok(depth) => depth,
        _ => {
            error!("{ENV_VAR}={spec:?} is not a frame count; ignoring it");
            return;
        }
    };
    init_delays_from_env();
    FORCED_DEPTH.store(depth, Ordering::Release);
    ARMED.store(true, Ordering::Release);
    info!("{ENV_VAR} armed: every tick will roll back at least {depth} frames");
    if let Some(spacing) = snapshot_spacing_from_env() {
        SNAPSHOT_SPACING.store(spacing, Ordering::Release);
    }
    if let Ok(spec) = std::env::var(AUDIT_ENV_VAR) {
        match spec.parse::<u32>() {
            Ok(frame) if frame > depth && depth > 0 => {
                AUDIT_FRAME.store(frame, Ordering::Release);
                info!("{AUDIT_ENV_VAR}: auditing the simulations of frame {frame}");
            }
            _ => error!(
                "{AUDIT_ENV_VAR}={spec:?} is not a frame past the first tick, or {ENV_VAR} forces \
                 no depth; ignoring it"
            ),
        }
    }
}

/// Environment variable naming frames at which to write every snapshot range out, with or without
/// the harness armed: with it, from the first step that simulates the frame once it is confirmed;
/// without it, from plain playback. Diffing the two dumps (pointers translated into range offsets)
/// shows what synced state a harness run has wrong before a fingerprint notices. Takes a
/// comma-separated list of frames and `<first>-<last>[/<step>]` ranges, so one run can bisect
/// toward the first frame the two disagree on: `500-9500/500`, then a finer range between the
/// last matching dump and the first differing one.
const DUMP_ENV_VAR: &str = "SB_ROLLBACK_DUMP_FRAME";

/// The frames [`DUMP_ENV_VAR`] names, ascending.
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
/// beside it, whenever the simulation is on one of the frames [`DUMP_ENV_VAR`] names. A frame
/// re-simulated after a rollback is dumped again over the earlier files, so they end up holding
/// its last simulation, the one whose fingerprint the harness reports.
unsafe fn dump_if_due(bw: &BwScr) {
    unsafe {
        if !DUMP_ARMED.load(Ordering::Relaxed) {
            return;
        }
        let Some(target) = bw.rollback_frame_count() else {
            return;
        };
        if DUMP_FRAMES.lock().binary_search(&target).is_err() {
            return;
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
    AUDIT_FRAME.load(Ordering::Relaxed) != 0
}

/// Copies the executable's static data before the step that first simulates the audited frame,
/// and diffs against that copy before every later step that simulates it.
unsafe fn audit_before_step(bw: &BwScr, ranges: &[Range]) {
    unsafe {
        let target = AUDIT_FRAME.load(Ordering::Relaxed);
        if bw.rollback_frame_count().map(|x| x + 1) != Some(target) {
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
/// against that copy after every later step that simulates it. The steps start from
/// the same snapshot state, so where their results differ is what the leftover state
/// [`audit_before_step`] reports made the simulation do differently.
unsafe fn audit_after_step(bw: &BwScr, ranges: &[Range]) {
    unsafe {
        let target = AUDIT_FRAME.load(Ordering::Relaxed);
        if bw.rollback_frame_count() != Some(target) {
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

/// Asks for a new forced rollback depth and set of per-player delays (`(storm player, frames)`;
/// players not listed get none) from the next logic step on. A depth of 0 with no delays stops
/// rolling back. Only takes effect in a game whose harness was armed at launch, since that is what
/// makes analysis resolve the snapshot's ranges.
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

/// Applies a pending change of depth and delays. The frames past the newest confirmed one were
/// simulated with the old delays, so the next tick re-simulates them with the new ones, leaving the
/// frame on screen where it is. Turning the harness off instead goes back to the confirmed frame,
/// whose state is right whatever the delays were, and plays on from there.
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
        FORCED_DEPTH.store(settings.depth, Ordering::Release);
        LATE_COMMANDS.lock().clear();
        // The frame on screen is re-simulated with different delays; that is not a correction.
        *DISPLAYED_UNITS.lock() = None;
        let confirmed = LAST_CONFIRMED.load(Ordering::Relaxed);
        if settings.depth == 0 && max_delay == 0 {
            let mut guard = SNAPSHOTS.lock();
            if let Some(snapshots) = guard.as_mut() {
                let selection = bw.rollback_local_selection();
                bw.rollback_clear_selection_visuals();
                let overlays = bw.rollback_detach_placement_overlays();
                let restored = snapshots.restore_at_or_before(confirmed, bw);
                if let Some(restored) = restored {
                    rollback::selection::undo_after(bw, restored);
                }
                bw.rollback_settle_local_selection(&selection);
                bw.rollback_reattach_placement_overlays(overlays);
                bw.rollback_rebuild_selection_visuals();
            }
            // Rebuilt from scratch should rolling back be turned on again later, anchored wherever
            // the game has got to by then.
            *guard = None;
            drop(guard);
            sounds::forget_presented();
            rollback::announcements::forget();
            FINGERPRINTS.lock().clear();
            ARMED.store(false, Ordering::Release);
        } else {
            *RESIMULATE_FROM.lock() = Some(confirmed);
            ARMED.store(true, Ordering::Release);
        }
        info!(
            "Rollback settings applied: depth {}, delays {:?}",
            settings.depth, settings.delays
        );
    }
}

/// Reads the per-player command delays out of the environment and stores them.
fn init_delays_from_env() {
    let Ok(spec) = std::env::var(DELAY_ENV_VAR) else {
        return;
    };
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
            info!("Storm player {player}'s commands will be known {delay} frames late");
        }
    }
}

/// The largest delay any player has.
fn max_delay() -> u32 {
    DELAYS
        .iter()
        .map(|x| x.load(Ordering::Relaxed))
        .max()
        .unwrap_or(0)
}

/// How many frames after the frame a command from `storm_player` was issued for it becomes known.
///
/// A leave waits for the longest delay any player has, whoever it is from. Applying a leave cannot
/// be undone, so the engine lets no rollback reach back past the step that applied it; a live
/// game therefore applies one only once every slot's turns up to its step have arrived, and a
/// leave the harness applied any earlier would strand the commands of slower players issued
/// before it, which then arrive with no rollback able to apply them.
fn command_delay(storm_player: StormPlayerId, is_leave: bool) -> u32 {
    if is_leave {
        return max_delay();
    }
    DELAYS
        .get(storm_player.0 as usize)
        .map_or(0, |x| x.load(Ordering::Relaxed))
}

/// Whether the command the replay records for `command_frame` from `storm_player` has been
/// received by the time the tick in progress reaches its newest frame. `is_leave` says whether it
/// is a player leaving, which waits on every player (see [`command_delay`]).
///
/// A step reads the commands of one frame, `step_frame`, and the tick runs
/// [`STEPS_AFTER_CURRENT`] more steps after it, so the tick's newest frame (the present the
/// simulation is being driven to) is `present = step_frame + steps_after_current`. A player with a
/// delay of `K` frames is heard from `K` frames after the frame a command was issued for, so the
/// command counts as known once `present >= command_frame + K`, which is the test below.
///
/// A command that is not known yet is noted, so the first tick that knows it rolls back to the
/// step that read it and simulates its frame again with it. Restoring a snapshot rewinds the
/// replay cursor along with the simulation, so that step reads it again.
pub fn replay_command_is_known(
    storm_player: StormPlayerId,
    is_leave: bool,
    command_frame: u32,
    step_frame: u32,
) -> bool {
    if !ANY_DELAY.load(Ordering::Relaxed) || !rollback::tick_running() {
        return true;
    }
    let delay = command_delay(storm_player, is_leave);
    if delay == 0 {
        return true;
    }
    let present = step_frame.saturating_add(STEPS_AFTER_CURRENT.load(Ordering::Relaxed));
    if command_frame.saturating_add(delay) > present {
        SUPPRESSED_COMMANDS.fetch_add(1, Ordering::Relaxed);
        // The step produces `rollback::step_frame()` and is followed by `steps_after_current`
        // more, so the tick's present frame count is their sum; `present` is the same frame in the
        // replay's numbering.
        let present_count =
            rollback::step_frame().saturating_add(STEPS_AFTER_CURRENT.load(Ordering::Relaxed));
        COMMAND_FRAME_OFFSET.store(present as i32 - present_count as i32, Ordering::Relaxed);
        let read_from = rollback::step_frame().saturating_sub(1);
        let mut late = LATE_COMMANDS.lock();
        match late
            .iter_mut()
            .find(|x| x.storm_player == storm_player && x.command_frame == command_frame)
        {
            Some(x) => x.read_from = x.read_from.min(read_from),
            None => late.push(LateCommand {
                storm_player,
                command_frame,
                delay,
                read_from,
            }),
        }
        return false;
    }
    if rollback::in_final_step() {
        APPLIED_DELAYED_COMMANDS.fetch_add(1, Ordering::Relaxed);
    }
    true
}

/// Takes the noted late commands that are known by the time a tick reaches `present`, returning
/// the earliest frame count a rollback has to restore to so that every one of them is applied.
fn take_arrived_commands(present: u32) -> Option<u32> {
    let offset = COMMAND_FRAME_OFFSET.load(Ordering::Relaxed);
    if offset == i32::MIN {
        return None;
    }
    let present = (present as i64 + offset as i64).max(0) as u32;
    let mut earliest = None::<u32>;
    LATE_COMMANDS.lock().retain(|x| {
        let known = x.command_frame.saturating_add(x.delay) <= present;
        if known {
            earliest = Some(earliest.map_or(x.read_from, |e| e.min(x.read_from)));
        }
        !known
    });
    earliest
}

/// Drops the snapshot and its range list, so the next logic step rebuilds both, and clears the
/// display state that only makes sense for the frame just shown. Called when the
/// game loop (re-)enters game init (which is how a backwards replay seek restarts playback).
pub fn reset_for_game_init() {
    if SNAPSHOTS.lock().take().is_some() {
        debug!("Rollback harness snapshot dropped for game init");
    }
    LATE_COMMANDS.lock().clear();
    FINGERPRINTS.lock().clear();
    *RESIMULATE_FROM.lock() = None;
    LAST_CONFIRMED.store(0, Ordering::Relaxed);
    *DISPLAYED_UNITS.lock() = None;
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
        let from = FROM_FRAME.load(Ordering::Relaxed);
        if from != 0 && game_thread::is_replay() {
            match bw.rollback_frame_count() {
                Some(frame) if frame < from => return fast_forward(bw, param, orig, frame, from),
                _ => {
                    FROM_FRAME.store(0, Ordering::Relaxed);
                    crate::frame_timing::reset();
                    if let Ok(players) = u8::try_from(VISION.load(Ordering::Relaxed)) {
                        bw.rollback_set_replay_vision(players);
                    }
                }
            }
        }
        if !ARMED.load(Ordering::Acquire) {
            let ret = crate::rollback_probe::run_game_logic_step(bw, param, orig);
            dump_if_due(bw);
            return ret;
        }
        if !ELIGIBILITY_CHECKED.swap(true, Ordering::AcqRel) && !game_thread::is_replay() {
            // Rolling a live game back would re-send network turns that have already gone out, and
            // there would be nothing to compare the fingerprints against either.
            ARMED.store(false, Ordering::Release);
            info!("{ENV_VAR} only runs during replay playback; leaving the simulation alone");
            return crate::rollback_probe::run_game_logic_step(bw, param, orig);
        }
        if let Some(missing) = bw.rollback_missing_analysis() {
            ARMED.store(false, Ordering::Release);
            error!("{ENV_VAR} can't roll back: analysis did not find {missing}");
            return crate::rollback_probe::run_game_logic_step(bw, param, orig);
        }
        run_tick(bw, param, orig)
    }
}

/// Runs plain steps from `frame` towards `target`, a batch per game loop tick.
unsafe fn fast_forward(
    bw: &BwScr,
    param: usize,
    orig: unsafe extern "C" fn(usize) -> usize,
    mut frame: u32,
    target: u32,
) -> usize {
    unsafe {
        // Each step pushes the tick the game loop paces itself against a frame further on, so put
        // it back once the batch has run.
        let paced_tick = bw.rollback_next_game_step_tick();
        let mut ret = 0;
        let mut ran = 0;
        while frame < target && ran < FAST_FORWARD_STEPS_PER_TICK {
            ret = orig(param);
            sounds::forget_requested();
            ran += 1;
            match bw.rollback_frame_count() {
                Some(after) if after > frame => frame = after,
                // The replay ended first.
                _ => break,
            }
        }
        bw.rollback_set_next_game_step_tick(paced_tick);
        ret
    }
}

unsafe fn run_tick(
    bw: &'static BwScr,
    param: usize,
    orig: unsafe extern "C" fn(usize) -> usize,
) -> usize {
    unsafe {
        let tick_start = Instant::now();
        let tick_start_cycles = thread_cycles();
        let mut guard = SNAPSHOTS.lock();
        if guard.is_none() {
            *guard = Snapshots::build(bw);
        }
        let (Some(snapshots), Some(current)) = (guard.as_mut(), bw.rollback_frame_count()) else {
            return crate::rollback_probe::run_game_logic_step(bw, param, orig);
        };

        // Each tick adds one frame. It is confirmed once every delayed player has been heard from
        // for it, and at least the forced depth is re-simulated regardless.
        let depth = FORCED_DEPTH.load(Ordering::Relaxed);
        let present = current + 1;
        let confirmed = present.saturating_sub(depth.max(max_delay()));
        let forced = (depth > 0).then(|| present.saturating_sub(depth + 1));
        let rollback_to = [
            forced,
            take_arrived_commands(present),
            RESIMULATE_FROM.lock().take(),
        ]
        .into_iter()
        .flatten()
        .min();
        let plan = TickPlan {
            rollback_to,
            present,
            confirmed,
            spacing: SNAPSHOT_SPACING.load(Ordering::Relaxed),
        };

        let audit_ranges = audit_armed().then(|| snapshots.ranges().to_vec());
        SUPPRESSED_COMMANDS.store(0, Ordering::Relaxed);
        APPLIED_DELAYED_COMMANDS.store(0, Ordering::Relaxed);
        *TICK_CORRECTIONS.lock() = Corrections::default();
        let (ret, report) = tick::run_tick(bw, snapshots, current, &plan, |step| {
            if step.resumes_from_restore {
                record_anchored_units(bw);
            }
            if let Some(ranges) = &audit_ranges {
                audit_before_step(bw, ranges);
            }
            STEPS_AFTER_CURRENT.store(step.steps_after, Ordering::Relaxed);
            let ret = crate::rollback_probe::run_game_logic_step(bw, param, orig);
            if let Some(ranges) = &audit_ranges {
                audit_after_step(bw, ranges);
            }
            dump_if_due(bw);
            if let Some(fingerprint) = bw.probe_fingerprint() {
                FINGERPRINTS.lock().insert(fingerprint.frame, fingerprint);
            }
            compare_displayed_units(bw);
            ret
        });
        drop(guard);
        LAST_CONFIRMED.store(confirmed, Ordering::Relaxed);

        if let Some(frame) = bw.rollback_frame_count() {
            *DISPLAYED_UNITS.lock() = Some(DisplayedFrame {
                frame,
                units: capture_units(bw),
            });
        }

        let confirmed_fingerprint = {
            let mut fingerprints = FINGERPRINTS.lock();
            let kept = fingerprints.split_off(&confirmed.saturating_sub(FINGERPRINT_HISTORY));
            *fingerprints = kept;
            fingerprints.get(&confirmed).cloned()
        };
        if let (Some(present), Some(confirmed)) = (bw.probe_fingerprint(), confirmed_fingerprint) {
            let sound_counts = sounds::reconcile_sounds(
                bw,
                report.window_start,
                report.settled_through,
                present.frame,
            );
            let times = TickTimes {
                restore: report.restore_time,
                steps: report.step_time,
                snapshot: report.snapshot_time,
                total: tick_start.elapsed(),
                cycles: thread_cycles().wrapping_sub(tick_start_cycles),
            };
            let counts = TickCounts {
                resimulated: report
                    .restored
                    .map_or(0, |x| present.frame.saturating_sub(x + 1)),
                suppressed_commands: SUPPRESSED_COMMANDS.load(Ordering::Relaxed),
                applied_delayed_commands: APPLIED_DELAYED_COMMANDS.load(Ordering::Relaxed),
                retracted_announcements: report.retracted_announcements,
            };
            write_row(
                &present,
                &confirmed,
                &counts,
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

/// What one tick re-simulated and did with delayed players' commands.
struct TickCounts {
    /// Frames before the present the tick simulated again.
    resimulated: u32,
    suppressed_commands: u32,
    applied_delayed_commands: u32,
    /// Text lines and observer UI notifications an earlier tick made for a frame this one
    /// re-simulated without making them.
    retracted_announcements: u32,
}

fn write_row(
    present: &Fingerprint,
    confirmed: &Fingerprint,
    counts: &TickCounts,
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
                ARMED.store(false, Ordering::Release);
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
        "{},{},{},{},{},{},{},{},{},{},{},{},{},{},{},{moves},\
         {},{},{},{},{}",
        fingerprint_columns(present),
        fingerprint_columns(confirmed),
        counts.resimulated,
        counts.suppressed_commands,
        counts.applied_delayed_commands,
        counts.retracted_announcements,
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
        ARMED.store(false, Ordering::Release);
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
             suppressed_commands,applied_delayed_commands,retracted_announcements,\
             sounds_on_time,sounds_late,sounds_late_frames,sounds_stale,\
             units_moved,max_move,units_morphed,units_popped_in,units_popped_out,move_distances,\
             restore_micros,steps_micros,snapshot_micros,tick_micros,tick_kcycles"
        )
        .map_err(|e| format!("{}: {e}", path.display()))?;
        Ok(HarnessFile { path, file })
    }
}
