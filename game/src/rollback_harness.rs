//! Rolls the simulation back and re-simulates it every logic step of a replay, to prove that a
//! memcpy snapshot of a fixed list of memory ranges captures the whole synced state.
//!
//! The simulation allocates nothing during play: the object pools are vectors whose storage is
//! sized once at map init and never moves, and the rest of the synced state lives in static
//! globals or in heap blocks whose owning pointer never changes after init. A snapshot is
//! therefore a fixed list of `(address, length)` ranges, captured once per game and copied in
//! place with no pointer rewriting.
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
//! Everything here is compiled out of release DLLs: it drives the simulation off the game loop's
//! own schedule and writes into live BW memory, so a release build must not contain the code at
//! all rather than merely decline to run it.

use std::fs::File;
use std::io::Write;
use std::mem::size_of;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use parking_lot::Mutex;
use scr_analysis::scarf::{MemAccessSize, Operand, OperandCtx, OperandType};

use bw_dat::structs::Path as BwPath;

use crate::bw::players::StormPlayerId;
use crate::bw::{self, Bw};
use crate::bw_scr::{BwScr, resolve_operand, scr};
use crate::game_thread;
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

/// Environment variable adding static memory to the snapshot beyond what analysis resolves, as a
/// comma-separated list of `<hex offset from the executable's base>+<hex length>`. Offsets are
/// specific to one build of the game, so this is only for trying out candidates an audit turned up.
const EXTRA_RANGES_ENV_VAR: &str = "SB_ROLLBACK_EXTRA_RANGES";

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

/// Whether the steps of a tick are running, so the replay's commands are gated on the delays. A
/// step taken outside a tick is not part of a prediction and applies every command it reads.
static GATING_ACTIVE: AtomicBool = AtomicBool::new(false);

/// How many steps of the current tick run after the one in progress, which is how far ahead of the
/// frame a step reads commands for the tick's newest frame is.
static STEPS_AFTER_CURRENT: AtomicU32 = AtomicU32::new(0);

/// Whether the step in progress is the tick's confirmed step, the one whose frame no later tick
/// simulates again.
static IN_CONFIRMED_STEP: AtomicBool = AtomicBool::new(false);

/// Commands the current tick left unapplied because the player that issued them is delayed and the
/// tick's newest frame has not reached them yet.
static SUPPRESSED_COMMANDS: AtomicU32 = AtomicU32::new(0);

/// Commands of delayed players that the current tick's confirmed step applied.
static APPLIED_DELAYED_COMMANDS: AtomicU32 = AtomicU32::new(0);

/// Whether the steps of a tick are running, so the `play_sound` hook records the simulation's sound
/// requests in [`SOUND_LEDGER`] instead of playing them.
static RECORD_SOUNDS: AtomicBool = AtomicBool::new(false);

/// The sounds of the frames a later tick can still re-simulate.
static SOUND_LEDGER: Mutex<SoundLedger> = Mutex::new(SoundLedger {
    requested: Vec::new(),
    presented: Vec::new(),
});

/// Whether the run has already been checked against the "replay playback only" requirement.
static ELIGIBILITY_CHECKED: AtomicBool = AtomicBool::new(false);

/// The snapshot ranges and buffers for the game currently running, built at its first logic step
/// and dropped when the game loop re-enters game init (which is how a backwards replay seek
/// restarts playback).
static HARNESS: Mutex<Option<Harness>> = Mutex::new(None);

/// The CSV rows, kept across replay seeks so one run produces one file.
static LOG_FILE: Mutex<Option<HarnessFile>> = Mutex::new(None);

// Element sizes the ranges below are derived from. A size that is too small silently leaves
// simulation state out of the snapshot; one that is too large reads and writes past the end of a
// pool's storage, so each is pinned per architecture here even where the declaring crate already
// checks it.
const _: () = assert!(size_of::<scr::BwVector>() == 3 * size_of::<usize>());
const _: () = assert!(size_of::<bw::Game>() == 0x17700);
// The camera position the snapshot skips is the pair of u16 tile coordinates right before the
// map dimensions.
const _: () = assert!(std::mem::offset_of!(bw::Game, screen_pos_x_tiles) == 0xe0);
const _: () = assert!(std::mem::offset_of!(bw::Game, screen_pos_y_tiles) == 0xe2);
const _: () = assert!(std::mem::offset_of!(bw::Game, map_width_tiles) == 0xe4);
const _: () = assert!(size_of::<bw::Player>() == 0x24);
const _: () = assert!(size_of::<BwPath>() == 0x80);
const _: () = assert!(size_of::<bw::ResourceAreaArray>() == 0x2ee8);

#[cfg(target_arch = "x86")]
const _: () = {
    assert!(size_of::<bw::Pathing>() == 0x97a20);
    assert!(size_of::<bw::Unit>() == 0x150);
    assert!(size_of::<bw::Sprite>() == 0x28);
    assert!(size_of::<bw::Image>() == 0x40);
    assert!(size_of::<bw::Bullet>() == 0x70);
    assert!(size_of::<bw::Order>() == 0x14);
    assert!(size_of::<bw::LoneSprite>() == 0x10);
    assert!(size_of::<bw::FowSprite>() == 0x10);
    assert!(size_of::<bw::AiRegion>() == 0x34);
    assert!(size_of::<bw::PlayerAiData>() == 0x4e8);
    assert!(size_of::<bw::ReplayData>() == 0x20);
};

#[cfg(target_arch = "x86_64")]
const _: () = {
    assert!(size_of::<bw::Pathing>() == 0xa1670);
    assert!(size_of::<bw::Unit>() == 0x1e8);
    assert!(size_of::<bw::Sprite>() == 0x48);
    assert!(size_of::<bw::Image>() == 0x58);
    assert!(size_of::<bw::Bullet>() == 0xa8);
    assert!(size_of::<bw::Order>() == 0x28);
    assert!(size_of::<bw::LoneSprite>() == 0x20);
    assert!(size_of::<bw::FowSprite>() == 0x20);
    assert!(size_of::<bw::AiRegion>() == 0x50);
    assert!(size_of::<bw::PlayerAiData>() == 0x6e8);
    assert!(size_of::<bw::ReplayData>() == 0x30);
};

/// Players whose per-player synced arrays (selection, AI data, AI regions) are part of the
/// simulation.
const AI_PLAYERS: usize = 8;
/// Slots in the player array, which is also how many entries the per-player unit list heads and
/// the trigger unit caches have.
const PLAYERS: usize = 0xc;
/// Units one player can have selected at once.
const SELECTION_SIZE: usize = 0xc;
/// Selection hotkey groups one player has.
const SELECTION_HOTKEY_GROUPS: usize = 8;
/// Unit ids the trigger unit-count caches hold a count for, per player.
const TRIGGER_CACHE_UNIT_IDS: usize = 228;
/// Tile rows the sprite hline lists are bucketed into.
const SPRITE_HLINE_COUNT: usize = 0x100;
/// Slots in the disappearing-creep hash table, which the creep step indexes as
/// `(x + y * 0x11) & 0x3ff`.
const DCREEP_LOOKUP_SLOTS: usize = 0x400;
/// Disappearing-creep lists, each with a head pointer and an entry count.
const DCREEP_LISTS: usize = 0xa;
/// Movement paths the path pool holds.
const PATH_COUNT: usize = 0x400;
/// Frame buckets in the lurker hit ring.
const LURKER_HIT_FRAMES: usize = 0x20;
/// Hits one frame bucket of the lurker hit ring records.
const LURKER_HITS_PER_FRAME: usize = 0x10;
/// Entries in the sync checksum ring.
const SYNC_RING_ENTRIES: usize = 0x10;
/// Bytes of one sync checksum ring entry.
const SYNC_RING_ENTRY: usize = 0x10c;
/// Check kinds the recorded checksums rotate through, one byte each.
const SYNC_CHECK_KINDS: usize = 0x20;
/// Sprite hline rows the current sync check folds a visibility mask of, one byte each.
const SYNC_VISION_BYTES: usize = 0x100;
/// Bytes of the unit repulsion field, a fixed 0xab by 0xab grid of one byte per chunk.
const REPULSE_STATE_SIZE: usize = 0xab * 0xab;
/// A pool vector's capacity word carries a flag in its top bit for storage the vector does not
/// own, so the element count is the rest of the word.
const CAPACITY_MASK: usize = usize::MAX >> 1;
/// Largest element count a pool vector is believed to reach. A capacity beyond it means the field
/// was read from something that is not a pool vector, and copying that many bytes would run off
/// the end of the heap.
const MAX_POOL_CAPACITY: usize = 1 << 20;

/// How a range's address and length are derived from one analysis result.
///
/// An analysis result is either a static array base, in which case the operand *is* the address,
/// or a `MemXX[address]` global, in which case the operand's own storage holds the value and
/// evaluating the operand yields whatever that global holds. [`RangeKind::Storage`] and
/// [`RangeKind::StorageBlock`] take the first reading of a `MemXX[..]` result and every other kind
/// takes the second, which is why one rule covers both array bases and pointer globals.
#[derive(Copy, Clone)]
enum RangeKind {
    /// The bytes the operand's own memory access covers, so a `Mem32[x]` global contributes the
    /// four bytes at `x`.
    Storage,
    /// `len` bytes starting at the operand's own address, for a global that analysis resolves as
    /// the first word of a larger block.
    StorageBlock { len: usize },
    /// `len` bytes at `offset` from the address the operand evaluates to.
    Block { offset: isize, len: usize },
    /// `len` bytes of the block whose address is held in the pointer `offset` bytes into what the
    /// operand evaluates to.
    IndirectBlock { offset: usize, len: usize },
    /// One tile array: `map_width_tiles * map_height_tiles * stride` bytes at the address the
    /// operand evaluates to.
    MapTiles { stride: usize },
    /// A pool's vector header plus the whole of its storage, `capacity` elements of
    /// `element_size` bytes.
    PoolVector { element_size: usize },
    /// One pointer per AI player, each to that player's array of one `AiRegion` per pathing region
    /// of the current map.
    AiRegions,
    /// The per-player trigger list headers the operand is the base of; copied as
    /// [`TriggerLists`] rather than as ranges.
    TriggerLists,
}

/// Synced state the snapshot deliberately leaves out, with the reason. Logged beside the layout so
/// that a fingerprint divergence can be weighed against what is known to be missing before
/// anything else is suspected.
const EXCLUDED: &[(&str, &str)] = &[
    (
        "foliage_state",
        "the simulation marks resource footprints in it but only rendering reads it",
    ),
    (
        "pathing_dynamic_state_edges",
        "the collision edge arrays it points at are built from the terrain at map init and only \
         read while a game runs; the analysis gives each array's pointer, count, capacity and \
         entry size offsets should copying them ever be wanted, and their capacity is grown as \
         they fill, so a copier has to size each array from those live fields rather than from a \
         constant",
    ),
];

/// One analysis result the snapshot covers, and how to turn it into an address range.
pub struct RangeSpec {
    name: &'static str,
    op: Option<Operand<'static>>,
    kind: RangeKind,
}

// The operands are interned in a leaked context that outlives the process and are only ever read,
// like the rest of the analysis results `BwScr` holds.
unsafe impl Send for RangeSpec {}
unsafe impl Sync for RangeSpec {}

/// One contiguous span of BW memory the snapshot copies.
#[derive(Copy, Clone)]
struct Range {
    name: &'static str,
    start: usize,
    len: usize,
}

/// The ranges as they are being resolved, alongside the names of the ones that could not be.
struct RangeList {
    ranges: Vec<Range>,
    omitted: Vec<&'static str>,
}

impl RangeList {
    /// Adds one range, treating a null address or an empty length as a range that could not be
    /// resolved: the harness runs with whatever it does have, and the layout log names the rest.
    fn add(&mut self, name: &'static str, start: usize, len: usize) {
        match start != 0 && len != 0 {
            true => self.ranges.push(Range { name, start, len }),
            false => self.omit(name),
        }
    }

    fn omit(&mut self, name: &'static str) {
        self.omitted.push(name);
    }
}

/// One sound the simulation asked for while a tick was running.
///
/// A re-simulated frame asks for the same sounds again unless the commands that arrived since
/// changed what happened on it, so a request is recognised across ticks by its frame, sound and
/// position.
#[derive(Copy, Clone)]
struct SoundRequest {
    frame: u32,
    sound_id: u32,
    /// Where on the map the sound plays, or `None` for one that is not positioned.
    position: Option<(i32, i32)>,
    volume: f32,
}

impl SoundRequest {
    fn is_same_sound(&self, other: &SoundRequest) -> bool {
        self.frame == other.frame
            && self.sound_id == other.sound_id
            && self.position == other.position
    }
}

/// Sound requests on either side of one tick.
///
/// A tick re-simulates every frame an earlier tick already played sounds for, so reconciling the
/// two lists once its steps have run tells which requests are new (the new frame's, and any that
/// the late commands caused on a re-simulated frame) and which sounds were played for a prediction
/// that did not happen.
struct SoundLedger {
    /// Requests the steps of the tick in progress have made, in the order they made them.
    requested: Vec<SoundRequest>,
    /// Requests already played for the frames the next tick re-simulates.
    presented: Vec<SoundRequest>,
}

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

/// What reconciling one tick's sound requests did.
#[derive(Default)]
struct SoundCounts {
    /// Requests for the tick's new frame, played as the frame is shown.
    on_time: u32,
    /// Requests for a re-simulated frame that no earlier tick played, played now instead.
    late: u32,
    /// Frames the late requests were played behind the frame they were made on, summed.
    late_frames: u32,
    /// Sounds an earlier tick played for a re-simulated frame that no longer asks for them.
    stale: u32,
}

struct Harness {
    ranges: Vec<Range>,
    /// Two buffers of the layout's total size, so a fresh snapshot is never written into the one a
    /// restore is reading from.
    buffers: [Vec<u8>; 2],
    /// Index into `buffers` of the snapshot the next tick rolls back to, or `None` until the first
    /// snapshot of the game has been taken.
    /// The trigger lists, when analysis found their headers.
    trigger_lists: Option<TriggerLists>,
    confirmed: Option<usize>,
}

struct HarnessFile {
    path: PathBuf,
    file: File,
}

/// Arms the harness if the environment asks for it. Called once while the DLL initialises, before
/// the game thread exists.
pub fn init_from_env() {
    if let Ok(spec) = std::env::var(DUMP_ENV_VAR) {
        match spec.parse::<u32>() {
            Ok(frame) if frame > 0 => {
                DUMP_FRAME.store(frame, Ordering::Release);
                info!("{DUMP_ENV_VAR}: dumping the snapshot ranges at frame {frame}");
            }
            _ => error!("{DUMP_ENV_VAR}={spec:?} is not a frame number; ignoring it"),
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

/// Adds the ranges [`EXTRA_RANGES_ENV_VAR`] names to the layout, for trying out whether some static
/// memory the analysis does not cover yet is state the snapshot is missing.
fn add_extra_ranges_from_env(bw: &BwScr, list: &mut RangeList) {
    let Ok(spec) = std::env::var(EXTRA_RANGES_ENV_VAR) else {
        return;
    };
    let Some((exe_base, _, _)) = bw.rollback_exe_data_section() else {
        return;
    };
    for entry in spec.split(',').filter(|x| !x.trim().is_empty()) {
        let parsed = entry.split_once('+').and_then(|(offset, len)| {
            let offset = usize::from_str_radix(offset.trim().trim_start_matches("0x"), 16).ok()?;
            let len = usize::from_str_radix(len.trim().trim_start_matches("0x"), 16).ok()?;
            Some((offset, len))
        });
        match parsed {
            Some((offset, len)) => {
                info!("{EXTRA_RANGES_ENV_VAR}: adding exe+{offset:x}, {len:x} bytes");
                list.add("extra", exe_base + offset, len);
            }
            None => error!(
                "{EXTRA_RANGES_ENV_VAR} entry {entry:?} is not <hex exe offset>+<hex length>; \
                 ignoring it"
            ),
        }
    }
}

/// Players that have a trigger list.
const TRIGGER_LIST_PLAYERS: usize = 8;

/// Bytes of the trigger a trigger list node carries after its two links: the map's trigger record
/// with its runtime state (execution flags, the action in progress) in it.
const TRIGGER_SIZE: usize = 0x960;

/// Upper bound on the nodes one trigger list is walked for, against a list whose links have been
/// overwritten.
const MAX_TRIGGERS_PER_PLAYER: usize = 0x10000;

/// The per-player trigger lists, which the snapshot copies node by node rather than as ranges.
///
/// Each player's triggers are a circular doubly linked list of heap nodes whose header lives in a
/// static array, and the nodes hold state the simulation changes (which triggers have run, how far
/// a waiting one has got). The lists never grow during a game, but a trigger pass that decides a
/// player's defeat, or a player leaving, frees that player's whole list; a re-simulation of the
/// same frames then has to find the list as it was. So a snapshot keeps each list's header and
/// whole nodes, and a restore copies the nodes back when the same ones are still linked, or
/// allocates new nodes for them, with their links translated, when the list has been freed since.
struct TriggerLists {
    /// The first of the [`TRIGGER_LIST_PLAYERS`] list headers, each `next, previous, count`.
    heads: usize,
    /// For each snapshot buffer, every player's list.
    saved: [Vec<SavedTriggerList>; 2],
}

#[derive(Default)]
struct SavedTriggerList {
    /// The list's header words.
    header: [usize; 3],
    /// The nodes' addresses, in the order they were walked.
    nodes: Vec<usize>,
    /// The nodes' bytes, links included, [`TRIGGER_NODE_SIZE`] each, in the same order.
    bytes: Vec<u8>,
}

/// Bytes of one trigger list node: its two links, then its trigger.
const TRIGGER_NODE_SIZE: usize = 2 * size_of::<usize>() + TRIGGER_SIZE;

impl TriggerLists {
    fn new(heads: usize) -> TriggerLists {
        let empty = || {
            (0..TRIGGER_LIST_PLAYERS)
                .map(|_| SavedTriggerList::default())
                .collect()
        };
        TriggerLists {
            heads,
            saved: [empty(), empty()],
        }
    }

    fn head(&self, player: usize) -> *mut usize {
        (self.heads + player * 3 * size_of::<usize>()) as *mut usize
    }

    /// Every node of one list, found by following the second link from the header round to the
    /// header again.
    unsafe fn walk(&self, player: usize) -> Vec<usize> {
        unsafe {
            let head = self.head(player);
            let mut nodes = Vec::new();
            let mut node = head.add(1).read();
            while node != head as usize && node != 0 && nodes.len() < MAX_TRIGGERS_PER_PLAYER {
                nodes.push(node);
                node = (node as *const usize).add(1).read();
            }
            nodes
        }
    }

    unsafe fn take(&mut self, buffer: usize) {
        unsafe {
            for player in 0..TRIGGER_LIST_PLAYERS {
                let nodes = self.walk(player);
                let head = self.head(player);
                let saved = &mut self.saved[buffer][player];
                saved.header = [head.read(), head.add(1).read(), head.add(2).read()];
                saved.bytes.clear();
                for &node in &nodes {
                    saved.bytes.extend_from_slice(std::slice::from_raw_parts(
                        node as *const u8,
                        TRIGGER_NODE_SIZE,
                    ));
                }
                saved.nodes = nodes;
            }
        }
    }

    unsafe fn restore(&mut self, buffer: usize, bw: &BwScr) {
        unsafe {
            for player in 0..TRIGGER_LIST_PLAYERS {
                let current = self.walk(player);
                let head = self.head(player);
                let saved = &mut self.saved[buffer][player];
                if current == saved.nodes {
                    for (i, &node) in saved.nodes.iter().enumerate() {
                        std::ptr::copy_nonoverlapping(
                            saved.bytes.as_ptr().add(i * TRIGGER_NODE_SIZE),
                            node as *mut u8,
                            TRIGGER_NODE_SIZE,
                        );
                    }
                    continue;
                }
                // The list was freed since the snapshot: bring its nodes back in allocations of
                // our own, pointing every link that pointed at an old node at its replacement.
                for &node in &current {
                    bw.free(node as *mut u8);
                }
                let replacements = saved
                    .nodes
                    .iter()
                    .map(|_| bw.alloc(TRIGGER_NODE_SIZE) as usize)
                    .collect::<Vec<_>>();
                let translate = |link: usize| {
                    saved
                        .nodes
                        .iter()
                        .position(|&x| x == link)
                        .map(|i| replacements[i])
                        .unwrap_or(link)
                };
                for (i, &node) in replacements.iter().enumerate() {
                    std::ptr::copy_nonoverlapping(
                        saved.bytes.as_ptr().add(i * TRIGGER_NODE_SIZE),
                        node as *mut u8,
                        TRIGGER_NODE_SIZE,
                    );
                    let links = node as *mut usize;
                    links.write(translate(links.read()));
                    links.add(1).write(translate(links.add(1).read()));
                }
                head.write(translate(saved.header[0]));
                head.add(1).write(translate(saved.header[1]));
                head.add(2).write(saved.header[2]);
                saved.nodes = replacements;
            }
        }
    }
}

/// Environment variable naming a frame at which to write every snapshot range out, with or without
/// the harness armed: with it, from the confirmed step that produces the frame for the last time;
/// without it, from plain playback. Diffing the two dumps (pointers translated into range offsets)
/// shows what synced state a harness run has wrong before a fingerprint notices.
const DUMP_ENV_VAR: &str = "SB_ROLLBACK_DUMP_FRAME";

/// The frame [`DUMP_ENV_VAR`] names, or 0 when no dump was asked for.
static DUMP_FRAME: AtomicU32 = AtomicU32::new(0);

/// Writes the snapshot ranges to `rollback-dump-<frame>-<pid>.bin`, with their layout in a `.csv`
/// beside it, once the simulation is on the frame [`DUMP_ENV_VAR`] names.
unsafe fn dump_if_due(bw: &BwScr) {
    unsafe {
        let target = DUMP_FRAME.load(Ordering::Relaxed);
        if target == 0 || bw.probe_frame_count() != Some(target) {
            return;
        }
        DUMP_FRAME.store(0, Ordering::Relaxed);
        let Some(layout) = Harness::build(bw) else {
            error!("{DUMP_ENV_VAR}: could not lay out the snapshot ranges");
            return;
        };
        let exe_base = bw.rollback_exe_data_section().map(|x| x.0).unwrap_or(0);
        let mut bytes = Vec::new();
        let mut table = format!("exe_base,{exe_base:x},0\nname,start,len\n");
        for range in &layout.ranges {
            bytes.extend_from_slice(std::slice::from_raw_parts(
                range.start as *const u8,
                range.len,
            ));
            table.push_str(&format!(
                "{},{:x},{:x}\n",
                range.name, range.start, range.len
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
                .any(|x| address >= x.start && address < x.start + x.len)
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
                range.start as *const u8,
                range.len,
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
            for offset in (0..range.len).step_by(word) {
                let end = (offset + word).min(range.len);
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
                        range.name,
                        range.start,
                        hex(before),
                        hex(after),
                    ));
                }
            }
            base += range.len;
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

        let mut guard = HARNESS.lock();
        if let Some(harness) = guard.as_mut()
            && let Some(confirmed) = harness.confirmed
        {
            bw.rollback_clear_selection_visuals();
            harness.restore(confirmed, bw);
            harness.confirmed = None;
            bw.rollback_rebuild_selection_visuals();
        }
        if depth == 0 {
            // Rebuilt from scratch should rolling back be turned on again later, anchored wherever
            // the game has got to by then.
            *guard = None;
            SOUND_LEDGER.lock().presented.clear();
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
    if !ANY_DELAY.load(Ordering::Relaxed) || !GATING_ACTIVE.load(Ordering::Relaxed) {
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
    if IN_CONFIRMED_STEP.load(Ordering::Relaxed) {
        APPLIED_DELAYED_COMMANDS.fetch_add(1, Ordering::Relaxed);
    }
    true
}

/// Whether the step in progress produces a predicted frame, one that a later tick simulates again.
///
/// What the simulation announces as it happens (text lines such as chat, notifications to the
/// observer UI) must be held back on such a step: the confirmed step that eventually produces the
/// frame for the last time announces the same things, and each of them is meant to happen once.
/// That puts them `R` frames behind the frames being shown, in exchange for never showing one that
/// the late commands took back. Called from the hooks on those announcements.
pub fn in_predicted_step() -> bool {
    GATING_ACTIVE.load(Ordering::Relaxed) && !IN_CONFIRMED_STEP.load(Ordering::Relaxed)
}

/// Where the observer UI keeps each player's research and upgrade records: the UI object holds a
/// vector of per-player records (`players`), each of which holds a vector of upgrade records keyed
/// by the unique id of the unit doing the research, with a state that is 0 while it is in
/// progress.
#[cfg(target_arch = "x86_64")]
mod observer_ui_layout {
    pub const PLAYERS: usize = 0x8;
    pub const PLAYER_COUNT: usize = 0x10;
    pub const PLAYER_SIZE: usize = 0x90;
    pub const PLAYER_UPGRADES: usize = 0x60;
    pub const PLAYER_UPGRADE_COUNT: usize = 0x68;
    pub const UNIT_PLAYER: usize = 0x68;
}
#[cfg(target_arch = "x86")]
mod observer_ui_layout {
    pub const PLAYERS: usize = 0x4;
    pub const PLAYER_COUNT: usize = 0x8;
    pub const PLAYER_SIZE: usize = 0x68;
    pub const PLAYER_UPGRADES: usize = 0x50;
    pub const PLAYER_UPGRADE_COUNT: usize = 0x54;
    pub const UNIT_PLAYER: usize = 0x4c;
}
/// Bytes of one upgrade record, and where its in-progress state lives in it (after the `u32` key).
const OBSERVER_UPGRADE_SIZE: usize = 0x14;
const OBSERVER_UPGRADE_STATE: usize = 0xc;

/// The `(key, state)` of every upgrade record the observer UI keeps for `unit`'s owner.
unsafe fn observer_upgrade_records(ui: usize, unit: usize) -> Vec<(u32, i32)> {
    use observer_ui_layout::*;
    unsafe {
        let player = ((unit + UNIT_PLAYER) as *const u8).read() as u32;
        let players = ((ui + PLAYERS) as *const usize).read();
        let count = ((ui + PLAYER_COUNT) as *const usize).read();
        let mut out = Vec::new();
        for i in 0..count {
            let record = players + i * PLAYER_SIZE;
            if (record as *const u32).read() != player {
                continue;
            }
            let upgrades = ((record + PLAYER_UPGRADES) as *const usize).read();
            let upgrade_count = ((record + PLAYER_UPGRADE_COUNT) as *const usize).read();
            for j in 0..upgrade_count {
                let entry = upgrades + j * OBSERVER_UPGRADE_SIZE;
                out.push((
                    (entry as *const u32).read(),
                    ((entry + OBSERVER_UPGRADE_STATE) as *const i32).read(),
                ));
            }
        }
        out
    }
}

/// The key of the in-progress observer UI record for each unit it was told started research or an
/// upgrade, as the UI stored it.
static OBSERVER_RESEARCH_KEYS: Mutex<Vec<(usize, u32)>> = Mutex::new(Vec::new());

/// Notes the key the observer UI has just stored for `unit`'s research or upgrade, the newest of
/// its owner's records. Called from the observer UI hook after a start notification has gone
/// through.
pub unsafe fn observer_research_started(ui: usize, unit: usize) {
    unsafe {
        let Some(&(key, _)) = observer_upgrade_records(ui, unit).last() else {
            return;
        };
        let mut keys = OBSERVER_RESEARCH_KEYS.lock();
        keys.retain(|&(x, _)| x != unit);
        keys.push((unit, key));
    }
}

/// Whether the observer UI can be told `unit`'s research or upgrade finished, which it only takes
/// while it still holds the in-progress record: it dereferences the record it looks up without
/// checking it was found. It retires a record on its own once the frames it shows have the unit
/// gone, and those frames run ahead of the confirmed ones the notifications come from. Called from
/// the observer UI hook for a finish notification it lets through.
pub unsafe fn observer_research_finishing(ui: usize, unit: usize) -> bool {
    unsafe {
        let key = {
            let mut keys = OBSERVER_RESEARCH_KEYS.lock();
            keys.iter()
                .position(|&(x, _)| x == unit)
                .map(|index| keys.swap_remove(index).1)
        };
        let open = key.is_some_and(|key| {
            observer_upgrade_records(ui, unit)
                .iter()
                .any(|&(id, state)| id == key && state == 0)
        });
        if !open {
            let frame = bw::get_bw().probe_frame_count().unwrap_or(0);
            debug!(
                "Observer UI no longer holds unit {unit:x}'s research record on frame {frame}; \
                 not telling it the research finished"
            );
        }
        open
    }
}

/// Records a sound request the simulation makes while a tick's steps run, returning what the
/// `play_sound` hook should answer in place of playing it, or `None` outside a tick to let the
/// request through. Called from the `play_sound` hook with its arguments.
///
/// A request tied to a unit is recorded at the unit's position: the sound is played only after the
/// tick, by which point the unit may no longer exist.
pub fn intercept_play_sound(
    sound_id: u32,
    volume: f32,
    unit: *mut libc::c_void,
    x: *mut i32,
    y: *mut i32,
) -> Option<u32> {
    if !RECORD_SOUNDS.load(Ordering::Relaxed) {
        return None;
    }
    unsafe {
        let bw = bw::get_bw();
        let position = if !x.is_null() {
            Some((*x, if y.is_null() { 0 } else { *y }))
        } else {
            bw_dat::Unit::from_ptr(unit as *mut bw::Unit).map(|unit| {
                let position = unit.position();
                (position.x as i32, position.y as i32)
            })
        };
        SOUND_LEDGER.lock().requested.push(SoundRequest {
            frame: bw.probe_frame_count().unwrap_or(0),
            sound_id,
            position,
            volume,
        });
    }
    // The original reports whether a channel took the sound; nothing in the simulation reads it.
    Some(1)
}

/// Drops the snapshot and its range list, so the next logic step rebuilds both. Called when the
/// game loop (re-)enters game init: the pools are reallocated there, and every address the layout
/// captured has to be resolved again.
pub fn reset_for_game_init() {
    if HARNESS.lock().take().is_some() {
        debug!("Rollback harness snapshot dropped for game init");
    }
    let mut ledger = SOUND_LEDGER.lock();
    ledger.requested.clear();
    ledger.presented.clear();
    OBSERVER_RESEARCH_KEYS.lock().clear();
    *DISPLAYED_UNITS.lock() = None;
}

/// Resolves the operands the snapshot covers, onto the same context the rest of `BwScr`'s operands
/// are copied into. Called once during analysis.
///
/// A result the analysis cannot find is kept in the list with no operand, so the layout log names
/// it as omitted rather than silently dropping it.
pub fn analyze_ranges(
    analysis: &mut scr_analysis::Analysis<'_>,
    ctx: OperandCtx<'static>,
) -> Vec<RangeSpec> {
    // Most of these need an analysis pass nothing else in the game asks for, which adds up to a
    // noticeable part of launch time, so a run that will neither roll anything back nor dump the
    // ranges does not pay for them.
    if ROLLBACK_FRAMES.load(Ordering::Acquire) == 0 && DUMP_FRAME.load(Ordering::Acquire) == 0 {
        return Vec::new();
    }
    let word = size_of::<usize>();
    let sizes = analysis.state_block_sizes();
    let mut out = Vec::new();
    let mut add = |name, op: Option<Operand<'_>>, kind| {
        out.push(RangeSpec {
            name,
            op: op.map(|x| ctx.copy_operand(x)),
            kind,
        });
    };

    // Globals whose entire contribution is the word they occupy: the heads and tails of the
    // simulation's object lists, the free-list heads of its pools, and the counters kept beside
    // them.
    let words = [
        ("first_active_unit", analysis.first_active_unit()),
        ("last_active_unit", analysis.last_active_unit()),
        ("first_hidden_unit", analysis.first_hidden_unit()),
        ("first_dying_unit", analysis.first_dying_unit()),
        ("first_revealer", analysis.first_revealer()),
        ("first_invisible_unit", analysis.first_invisible_unit()),
        ("first_pylon", analysis.first_pylon()),
        ("first_free_unit", analysis.first_free_unit()),
        ("last_free_unit", analysis.last_free_unit()),
        ("unit_count", analysis.unit_count()),
        // Live entry count shared by the two unit position search arrays, which hold two entries
        // per tracked unit. It is a global of its own rather than a field of either array's
        // vector header, and which header it neighbours is a layout detail of the build, so it is
        // resolved from the analysis instead of derived from a header's address. The arrays are
        // maintained incrementally with no rebuild path, so a count that is not rewound with them
        // drifts until an insertion walks past the live entries into stale slots.
        (
            "unit_position_search_entry_count",
            analysis.unit_position_search_entry_count(),
        ),
        ("pylon_refresh", analysis.pylon_refresh()),
        ("pylon_auras_visible", analysis.pylon_auras_visible()),
        ("order_timer_reset", analysis.order_timer_reset_counter()),
        (
            "secondary_order_timer_reset",
            analysis.secondary_order_timer_reset_counter(),
        ),
        ("first_free_sprite", analysis.first_free_sprite()),
        ("last_free_sprite", analysis.last_free_sprite()),
        ("first_lone_sprite", analysis.first_lone_sprite()),
        ("last_lone_sprite", analysis.last_lone_sprite()),
        ("first_free_lone_sprite", analysis.first_free_lone_sprite()),
        ("last_free_lone_sprite", analysis.last_free_lone_sprite()),
        ("first_fow_sprite", analysis.first_active_fow_sprite()),
        ("last_fow_sprite", analysis.last_active_fow_sprite()),
        ("first_free_fow_sprite", analysis.first_free_fow_sprite()),
        ("last_free_fow_sprite", analysis.last_free_fow_sprite()),
        ("first_free_image", analysis.first_free_image()),
        ("last_free_image", analysis.last_free_image()),
        ("first_free_bullet", analysis.first_free_bullet()),
        ("last_free_bullet", analysis.last_free_bullet()),
        ("first_active_bullet", analysis.first_active_bullet()),
        ("last_active_bullet", analysis.last_active_bullet()),
        ("first_free_order", analysis.first_free_order()),
        ("last_free_order", analysis.last_free_order()),
        ("allocated_order_count", analysis.allocated_order_count()),
        ("first_free_path", analysis.first_free_path()),
        ("lurker_hits_frame", analysis.lurker_hits_frame()),
        ("lurker_hits_pos", analysis.lurker_hits_pos()),
        ("game_frame_count", analysis.game_frame_count()),
        ("vision_update_counter", analysis.vision_update_counter()),
        ("vision_updated", analysis.vision_updated()),
        ("is_paused", analysis.is_paused()),
        ("trigger_current_player", analysis.trigger_current_player()),
        // The per-frame countdown to the next trigger pass; without it every extra simulated
        // frame in a tick counts down further than plain playback and triggers fire early.
        (
            "trigger_execution_timer",
            analysis.trigger_execution_timer(),
        ),
        // The trigger step's other per-frame countdowns. The first decides when the game's elapsed
        // seconds tick up, which elapsed-time conditions and the melee victory checks read; left
        // out, every re-simulated frame winds it down again and the game clock runs several
        // times too fast.
        (
            "trigger_elapsed_time_tick_timer",
            analysis.trigger_elapsed_time_tick_timer(),
        ),
        (
            "leaderboard_refresh_timer",
            analysis.leaderboard_refresh_timer(),
        ),
        ("dcreep_next_update", analysis.dcreep_next_update()),
        (
            "dcreep_unit_next_update",
            analysis.dcreep_unit_next_update(),
        ),
        ("first_ai_script", analysis.first_ai_script()),
        ("ai_military_update", analysis.ai_military_update_counter()),
        (
            "ai_target_ignore_reset",
            analysis.ai_target_ignore_reset_counter(),
        ),
        ("step_ai_regions_player", analysis.step_ai_regions_player()),
        (
            "ai_expansion_player_cursor",
            analysis.ai_expansion_player_cursor(),
        ),
        // The cursors the sync checksum ring is written through, and the accumulators whose
        // value the next recorded checksum picks up. Each is a global of its own beside the
        // ring rather than a field of it.
        ("sync_slot_index", analysis.sync_slot_index()),
        ("sync_check_kind_index", analysis.sync_check_kind_index()),
        ("sync_check_kind_count", analysis.sync_check_kind_count()),
        ("sync_map_row_index", analysis.sync_map_row_index()),
        (
            "captured_minimap_unit_vision_sync_value",
            analysis.captured_minimap_unit_vision_sync_value(),
        ),
        (
            "captured_minimap_marker_count_sync_value",
            analysis.captured_minimap_marker_count_sync_value(),
        ),
        (
            "current_sync_state_byte",
            analysis.current_sync_state_byte(),
        ),
        (
            "current_sync_check_hash",
            analysis.current_sync_check_hash(),
        ),
    ];
    for (name, op) in words {
        add(name, op, RangeKind::Storage);
    }

    // Fixed-size blocks, each at the address its analysis result evaluates to: a static array base
    // is that address itself, and a pointer global holds it.
    let trigger_cache_size = checked_size(
        "trigger_unit_caches",
        PLAYERS * TRIGGER_CACHE_UNIT_IDS * size_of::<u32>(),
        sizes.trigger_completed_units_cache,
    );
    let path_entry_size = checked_size("path_array_entry", size_of::<BwPath>(), sizes.path_entry);
    let blocks = [
        (
            "first_player_unit",
            analysis.first_player_unit(),
            PLAYERS * word,
        ),
        (
            "sprite_hlines",
            analysis.sprites_by_y_tile_start(),
            SPRITE_HLINE_COUNT * word,
        ),
        (
            "sprite_hlines_end",
            analysis.sprites_by_y_tile_end(),
            SPRITE_HLINE_COUNT * word,
        ),
        (
            "trigger_completed_units_cache",
            analysis.trigger_completed_units_cache(),
            trigger_cache_size,
        ),
        (
            "trigger_all_units_cache",
            analysis.trigger_all_units_cache(),
            trigger_cache_size,
        ),
        (
            "selections",
            analysis.selections(),
            AI_PLAYERS * SELECTION_SIZE * word,
        ),
        // `local_selection` stays out: it is what the person watching has selected, which the
        // simulation never reads (it only prunes units that die out of it), and restoring it would
        // undo every selection made since the snapshot.
        (
            "selection_hotkey_last_used_frames",
            analysis.selection_hotkey_last_used_frames(),
            AI_PLAYERS * SELECTION_HOTKEY_GROUPS * size_of::<u16>(),
        ),
        (
            "resource_areas",
            analysis.resource_areas(),
            checked_size(
                "resource_areas",
                size_of::<bw::ResourceAreaArray>(),
                sizes.resource_areas,
            ),
        ),
        (
            "path_array",
            analysis.path_array(),
            checked_size("path_array", PATH_COUNT * path_entry_size, sizes.path_array),
        ),
        (
            "pathing",
            analysis.pathing(),
            checked_size("pathing", size_of::<bw::Pathing>(), sizes.pathing_state),
        ),
        (
            "repulse_state",
            analysis.repulse_state(),
            REPULSE_STATE_SIZE,
        ),
        (
            "dcreep_lookup",
            analysis.dcreep_lookup(),
            DCREEP_LOOKUP_SLOTS * word,
        ),
        (
            "dcreep_list_begin",
            analysis.dcreep_list_begin(),
            DCREEP_LISTS * word,
        ),
        (
            "dcreep_list_size",
            analysis.dcreep_list_size(),
            DCREEP_LISTS * size_of::<u16>(),
        ),
        (
            "player_ai",
            analysis.player_ai(),
            checked_size(
                "player_ai",
                AI_PLAYERS * size_of::<bw::PlayerAiData>(),
                sizes.player_ai,
            ),
        ),
        (
            "player_ai_towns",
            analysis.player_ai_towns(),
            AI_PLAYERS * 2 * word,
        ),
        (
            "first_guard_ai",
            analysis.first_guard_ai(),
            AI_PLAYERS * 2 * word,
        ),
        // The sync checksum ring and the arrays beside it. None of them holds a pointer, so the
        // same lengths describe both architectures.
        (
            "sync_data",
            analysis.sync_data(),
            SYNC_RING_ENTRIES * SYNC_RING_ENTRY,
        ),
        (
            "sync_check_kinds",
            analysis.sync_check_kinds(),
            SYNC_CHECK_KINDS,
        ),
        (
            "current_sync_vision_bytes",
            analysis.current_sync_vision_bytes(),
            SYNC_VISION_BYTES,
        ),
        // Per-player trigger runtime state beside the trigger lists: waits in progress and their
        // remaining time, the victory states a trigger pass decides, and whose triggers run.
        (
            "player_trigger_wait_active_flags",
            analysis.player_trigger_wait_active_flags(),
            TRIGGER_LIST_PLAYERS,
        ),
        (
            "player_trigger_wait_timers",
            analysis.player_trigger_wait_timers(),
            TRIGGER_LIST_PLAYERS * size_of::<u32>(),
        ),
        (
            "player_trigger_victory_states",
            analysis.player_trigger_victory_states(),
            TRIGGER_LIST_PLAYERS,
        ),
        (
            "player_trigger_active_flags",
            analysis.player_trigger_active_flags(),
            TRIGGER_LIST_PLAYERS,
        ),
    ];
    for (name, op, len) in blocks {
        add(name, op, RangeKind::Block { offset: 0, len });
    }
    add(
        "player_trigger_lists",
        analysis.player_trigger_lists(),
        RangeKind::TriggerLists,
    );

    // Terrain arrays, one entry per map tile.
    let tile_arrays = [
        ("map_tile_flags", analysis.map_tile_flags(), 4),
        (
            "tileset_indexed_map_tiles",
            analysis.tileset_indexed_map_tiles(),
            2,
        ),
        ("vx4_map_tiles", analysis.vx4_map_tiles(), 2),
        ("creep_original_tiles", analysis.creep_original_tiles(), 2),
        ("creep_tile_borders", analysis.creep_tile_borders(), 1),
    ];
    for (name, op, stride) in tile_arrays {
        add(name, op, RangeKind::MapTiles { stride });
    }

    // The RNG seed, the draw state that advances beside it and the enable flag share one block of
    // six words, so the whole block is taken at once.
    add(
        "rng_seed",
        analysis.rng_seed(),
        RangeKind::StorageBlock {
            len: 6 * size_of::<u32>(),
        },
    );
    // Each hit in the lurker ring is an attacker and its victim, and the analysis resolves the
    // victim slot of the first hit rather than the ring's own base, so the range starts one
    // pointer earlier.
    add(
        "lurker_hits",
        analysis.lurker_hits(),
        RangeKind::Block {
            offset: -(word as isize),
            len: LURKER_HIT_FRAMES * LURKER_HITS_PER_FRAME * 2 * word,
        },
    );
    add("ai_regions", analysis.ai_regions(), RangeKind::AiRegions);
    // The pathing state block ends with a pointer to the dynamic state, a small heap struct
    // holding the collision edge arrays' pointers, counts, capacities and bounds. Both where that
    // pointer sits and how large the struct is differ between the architectures, so both come
    // from the analysis; a struct size of zero means it found neither.
    let dynamic_pathing = analysis.dynamic_pathing();
    add(
        "pathing_dynamic_state",
        analysis
            .pathing()
            .filter(|_| dynamic_pathing.struct_size != 0),
        RangeKind::IndirectBlock {
            offset: dynamic_pathing.state_offset as usize,
            len: dynamic_pathing.struct_size as usize,
        },
    );

    // Statically allocated pools of fixed size entries, each with a free list threaded through
    // the entries it has not handed out. The entries and that list head have to be rewound as
    // one: a list head left pointing past a rolled back allocation hands the same entry out
    // twice, and one left pointing at an entry the rollback un-freed loses the rest of the list.
    // The entry size and count come from the analysis rather than from a constant here, since
    // they differ between the two architectures.
    let ai_pools = analysis.ai_pools();
    let pools = [
        (
            "worker_ai_pool_storage",
            "worker_ai_free_list",
            ai_pools.worker,
        ),
        (
            "building_ai_pool_storage",
            "building_ai_free_list",
            ai_pools.building,
        ),
        ("ai_town_pool_storage", "ai_town_free_list", ai_pools.town),
        (
            "ai_script_pool_storage",
            "ai_script_free_list",
            ai_pools.script,
        ),
        (
            "military_ai_pool_storage",
            "military_ai_free_list",
            ai_pools.military,
        ),
        (
            "guard_ai_pool_storage",
            "guard_ai_free_list",
            ai_pools.guard,
        ),
        (
            "dcreep_state_pool",
            "dcreep_state_free_list",
            ai_pools.dcreep,
        ),
    ];
    for (storage_name, free_list_name, pool) in pools {
        let len = pool.entry_size as usize * pool.entry_count as usize;
        add(
            storage_name,
            pool.storage,
            RangeKind::Block { offset: 0, len },
        );
        add(free_list_name, pool.free_list, RangeKind::Storage);
    }
    add(
        "ai_spending_player_index",
        ai_pools.ai_spending_player_index,
        RangeKind::Storage,
    );

    out.extend(pool_specs(analysis, ctx));
    out
}

/// The byte size a fixed state block is snapshotted at: the size the struct it is declared as
/// says, warning when the analysis of the running build disagrees.
///
/// The struct is what the rest of the DLL is compiled against, so it stays the size that is
/// copied; the analysis reads the size out of the code that allocates and zeroes the block in the
/// build actually running, so a disagreement means that build's layout is not the one the DLL
/// expects and the snapshot either misses part of the block or reaches past it. An analysis that
/// found no size at all reports zero, which says nothing and is not worth a warning.
fn checked_size(name: &'static str, struct_size: usize, analysis_size: u32) -> usize {
    if analysis_size != 0 && analysis_size as usize != struct_size {
        warn!(
            "Rollback harness snapshots {name} as {struct_size:#x} bytes, but the running build \
             lays it out as {analysis_size:#x}"
        );
    }
    struct_size
}

/// A pool's name, the size of the object it holds, and the auxiliary arrays that are resized
/// alongside those objects, in the order they appear once the object array itself has been taken
/// out of the pool's vector list.
struct Pool {
    name: &'static str,
    object_size: usize,
    auxiliary: &'static [AuxiliaryArray],
}

/// One per-object array that lives beside a pool's objects rather than inside them.
struct AuxiliaryArray {
    name: &'static str,
    element_size: usize,
    /// How the array's length is derived from the pool's object count: `count * mul.max(1) + add`.
    /// Checked against what the analysis reports for the vector it is matched with, so a change in
    /// the order a pool's vectors are enumerated in is caught instead of silently applying one
    /// array's element size to another.
    length: (u32, u32),
}

/// The sprite pool's auxiliary arrays: the draw-order binary heap, keyed by depth, and the sorted
/// draw list it feeds.
const SPRITE_AUXILIARY_ARRAYS: &[AuxiliaryArray] = &[
    AuxiliaryArray {
        name: "sprite_draw_heap",
        // A sort key and a sprite pointer, the key padded out to the pointer's alignment.
        element_size: 2 * size_of::<usize>(),
        length: (1, 0),
    },
    AuxiliaryArray {
        name: "sprite_draw_order",
        element_size: size_of::<usize>(),
        length: (0, 0),
    },
];

/// The unit pool's auxiliary arrays: the splash target scratch list, the two coordinate-sorted
/// position search arrays, and the scratch marks and results of a position query.
const UNIT_AUXILIARY_ARRAYS: &[AuxiliaryArray] = &[
    AuxiliaryArray {
        name: "air_splash_candidates",
        element_size: size_of::<usize>(),
        length: (0, 0),
    },
    AuxiliaryArray {
        name: "unit_position_search_x",
        // A unit pool index and a coordinate, both 32-bit, so the same size on both architectures.
        element_size: 8,
        length: (0, 2),
    },
    AuxiliaryArray {
        name: "unit_position_search_y",
        element_size: 8,
        length: (0, 2),
    },
    AuxiliaryArray {
        name: "unit_query_scratch_marks",
        element_size: 4,
        length: (1, 0),
    },
    AuxiliaryArray {
        name: "unit_query_results",
        element_size: size_of::<usize>(),
        length: (1, 0),
    },
];

/// Resolves the object pools' vectors: the objects themselves plus the auxiliary per-object arrays
/// that are resized alongside them.
///
/// Nothing in the analysis result says which of a pool's vectors holds the objects, so that one is
/// recognised by comparing addresses against the separately resolved pool globals and the rest are
/// sized from their position among the remainder. An auxiliary array with no size to match it is
/// left out with its pool named, since guessing the size either misses state or walks off the end
/// of the allocation.
fn pool_specs(
    analysis: &mut scr_analysis::Analysis<'_>,
    ctx: OperandCtx<'static>,
) -> Vec<RangeSpec> {
    let pools = [
        Pool {
            name: "images",
            object_size: size_of::<bw::Image>(),
            auxiliary: &[],
        },
        Pool {
            name: "sprites",
            object_size: size_of::<bw::Sprite>(),
            auxiliary: SPRITE_AUXILIARY_ARRAYS,
        },
        Pool {
            name: "lone_sprites",
            object_size: size_of::<bw::LoneSprite>(),
            auxiliary: &[],
        },
        Pool {
            name: "units",
            object_size: size_of::<bw::Unit>(),
            auxiliary: UNIT_AUXILIARY_ARRAYS,
        },
        Pool {
            name: "bullets",
            object_size: size_of::<bw::Bullet>(),
            auxiliary: &[],
        },
        Pool {
            name: "orders",
            object_size: size_of::<bw::Order>(),
            auxiliary: &[],
        },
        Pool {
            name: "fow_sprites",
            object_size: size_of::<bw::FowSprite>(),
            auxiliary: &[],
        },
    ];

    let object_vectors = [analysis.images(), analysis.sprites(), analysis.units()];
    let vectors = analysis.pool_vectors();
    let mut out = Vec::new();
    for (index, pool) in pools.iter().enumerate() {
        let unresolved = || RangeSpec {
            name: pool.name,
            op: None,
            kind: RangeKind::PoolVector {
                element_size: pool.object_size,
            },
        };
        let Some(entries) = vectors.get(index) else {
            out.push(unresolved());
            continue;
        };
        // A pool with a single vector has no auxiliary arrays for it to be confused with.
        let object_index = match entries.len() {
            1 => Some(0),
            _ => entries.iter().position(|&(op, _, _)| {
                object_vectors
                    .iter()
                    .any(|known| known.is_some_and(|known| known == op))
            }),
        };
        let mut auxiliary = pool.auxiliary.iter();
        for (slot, &(op, add, mul)) in entries.iter().enumerate() {
            let (name, element_size) = if Some(slot) == object_index {
                (pool.name, pool.object_size)
            } else {
                match auxiliary.next() {
                    Some(array) if array.length == (add, mul) => (array.name, array.element_size),
                    _ => {
                        out.push(unresolved());
                        continue;
                    }
                }
            };
            out.push(RangeSpec {
                name,
                op: Some(ctx.copy_operand(op)),
                kind: RangeKind::PoolVector { element_size },
            });
        }
    }
    out
}

impl Harness {
    /// Turns the analysis results into concrete address ranges. Returns `None` before a game's
    /// state exists, so the next logic step can try again.
    unsafe fn build(bw: &BwScr) -> Option<Harness> {
        unsafe {
            let game = bw.game();
            if game.is_null() {
                return None;
            }
            let map_tiles = (*game).map_width_tiles as usize * (*game).map_height_tiles as usize;
            let pathing = bw.rollback_pathing();
            let region_count = match pathing.is_null() {
                true => 0,
                false => (*pathing).region_count as usize,
            };

            let mut list = RangeList {
                ranges: Vec::new(),
                omitted: Vec::new(),
            };
            let mut trigger_lists = None;
            // The `game` and `players` globals are obfuscated operands, so they come from the
            // accessors that already know how to unpick them rather than from a range spec.
            // The camera's tile position is kept inside the game struct even though only local
            // scrolling writes it and only rendering reads it; restoring it would yank the view
            // back to wherever it was when the snapshot was taken, so the struct is copied in two
            // pieces around those two words.
            let camera = std::mem::offset_of!(bw::Game, screen_pos_x_tiles);
            let camera_len = size_of::<u16>() * 2;
            list.add("game", game as usize, camera);
            list.add(
                "game",
                game as usize + camera + camera_len,
                size_of::<bw::Game>() - camera - camera_len,
            );
            list.add(
                "players",
                bw.players() as usize,
                PLAYERS * size_of::<bw::Player>(),
            );
            // Replay playback reads each frame's commands through this cursor struct, so rewinding
            // it rewinds the command stream alongside the simulation.
            list.add(
                "replay_data",
                bw.replay_data() as usize,
                size_of::<bw::ReplayData>(),
            );

            for spec in bw.rollback_range_specs() {
                let Some(op) = spec.op else {
                    list.omit(spec.name);
                    continue;
                };
                match spec.kind {
                    RangeKind::Storage => match storage_of(op) {
                        Some((start, len)) => list.add(spec.name, start, len),
                        None => list.omit(spec.name),
                    },
                    RangeKind::StorageBlock { len } => match storage_of(op) {
                        Some((start, _)) => list.add(spec.name, start, len),
                        None => list.omit(spec.name),
                    },
                    RangeKind::Block { offset, len } => {
                        let start = resolve_operand(op, &[]).wrapping_add_signed(offset);
                        list.add(spec.name, start, len);
                    }
                    RangeKind::IndirectBlock { offset, len } => {
                        let block = resolve_operand(op, &[]);
                        match block != 0 {
                            true => {
                                let slot = (block + offset) as *const usize;
                                list.add(spec.name, slot.read(), len);
                            }
                            false => list.omit(spec.name),
                        }
                    }
                    RangeKind::MapTiles { stride } => {
                        list.add(spec.name, resolve_operand(op, &[]), map_tiles * stride);
                    }
                    RangeKind::PoolVector { element_size } => {
                        let vector = resolve_operand(op, &[]) as *const scr::BwVector;
                        if vector.is_null() {
                            list.omit(spec.name);
                            continue;
                        }
                        list.add(spec.name, vector as usize, size_of::<scr::BwVector>());
                        let capacity = (*vector).capacity & CAPACITY_MASK;
                        match capacity <= MAX_POOL_CAPACITY {
                            true => list.add(
                                spec.name,
                                (*vector).data as usize,
                                capacity * element_size,
                            ),
                            false => list.omit(spec.name),
                        }
                    }
                    RangeKind::TriggerLists => {
                        let heads = resolve_operand(op, &[]);
                        match heads != 0 {
                            true => trigger_lists = Some(TriggerLists::new(heads)),
                            false => list.omit(spec.name),
                        }
                    }
                    RangeKind::AiRegions => {
                        let base = resolve_operand(op, &[]);
                        list.add(spec.name, base, AI_PLAYERS * size_of::<usize>());
                        if base == 0 || region_count == 0 {
                            list.omit("ai_regions_arrays");
                            continue;
                        }
                        for player in 0..AI_PLAYERS {
                            let array = (base as *const usize).add(player).read();
                            list.add(spec.name, array, region_count * size_of::<bw::AiRegion>());
                        }
                    }
                }
            }

            add_extra_ranges_from_env(bw, &mut list);

            let RangeList { ranges, omitted } = list;
            for range in &ranges {
                debug!(
                    "Rollback harness range {:x}..{:x} ({} bytes)",
                    range.start,
                    range.start + range.len,
                    range.len,
                );
            }
            let total_bytes = ranges.iter().map(|x| x.len).sum::<usize>();
            info!(
                "Rollback harness snapshot layout: {} ranges, {total_bytes} bytes, omitted [{}]",
                ranges.len(),
                omitted.join(", "),
            );
            for (name, reason) in EXCLUDED {
                info!("Rollback harness leaves out {name}: {reason}");
            }
            if ranges.is_empty() {
                return None;
            }
            Some(Harness {
                ranges,
                buffers: [vec![0u8; total_bytes], vec![0u8; total_bytes]],
                trigger_lists,
                confirmed: None,
            })
        }
    }

    /// Copies every range into `buffer`, which becomes the snapshot the next restore reads from.
    unsafe fn take(&mut self, buffer: usize) {
        unsafe {
            let mut out = self.buffers[buffer].as_mut_ptr();
            for range in &self.ranges {
                std::ptr::copy_nonoverlapping(range.start as *const u8, out, range.len);
                out = out.add(range.len);
            }
            if let Some(trigger_lists) = &mut self.trigger_lists {
                trigger_lists.take(buffer);
            }
            self.confirmed = Some(buffer);
        }
    }

    unsafe fn restore(&mut self, buffer: usize, bw: &BwScr) {
        unsafe {
            let mut input = self.buffers[buffer].as_ptr();
            for range in &self.ranges {
                std::ptr::copy_nonoverlapping(input, range.start as *mut u8, range.len);
                input = input.add(range.len);
            }
            if let Some(trigger_lists) = &mut self.trigger_lists {
                trigger_lists.restore(buffer, bw);
            }
        }
    }
}

/// The address and byte length of a memory operand's own storage, or `None` for an operand that
/// isn't a memory access (a static array base).
unsafe fn storage_of(op: Operand<'_>) -> Option<(usize, usize)> {
    unsafe {
        match op.ty() {
            OperandType::Memory(mem) => {
                let (base, offset) = mem.address();
                let address = resolve_operand(base, &[]).wrapping_add(offset as usize);
                let len = match mem.size {
                    MemAccessSize::Mem8 => 1,
                    MemAccessSize::Mem16 => 2,
                    MemAccessSize::Mem32 => 4,
                    MemAccessSize::Mem64 => 8,
                };
                Some((address, len))
            }
            _ => None,
        }
    }
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
        let mut guard = HARNESS.lock();
        if guard.is_none() {
            *guard = Harness::build(bw);
        }
        let Some(harness) = guard.as_mut() else {
            return crate::rollback_probe::run_game_logic_step(bw, param, orig);
        };

        // `steps_after` is how many further steps the tick runs once this one is done, which is
        // what turns the frame a step reads commands for into the tick's newest frame.
        let audit_ranges = audit_armed().then(|| harness.ranges.clone());
        let step = |steps_after: usize, confirmed: bool| {
            if let Some(ranges) = &audit_ranges {
                audit_before_step(bw, ranges, confirmed);
            }
            STEPS_AFTER_CURRENT.store(steps_after as u32, Ordering::Relaxed);
            IN_CONFIRMED_STEP.store(confirmed, Ordering::Relaxed);
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
        GATING_ACTIVE.store(true, Ordering::Relaxed);
        RECORD_SOUNDS.store(true, Ordering::Relaxed);
        match harness.confirmed {
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
                harness.restore(confirmed, bw);
                times.restore = start.elapsed();

                let (step_ret, elapsed) = step(rollback_frames, true);
                ret = step_ret;
                times.steps += elapsed;
                paced_tick = Some(bw.probe_next_game_step_tick());
                confirmed_fingerprint = bw.probe_fingerprint();

                let start = Instant::now();
                bw.rollback_clear_selection_visuals();
                harness.take(1 - confirmed);
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
                harness.take(0);
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

        GATING_ACTIVE.store(false, Ordering::Relaxed);
        IN_CONFIRMED_STEP.store(false, Ordering::Relaxed);
        RECORD_SOUNDS.store(false, Ordering::Relaxed);
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
        }
        if let Some(paced_tick) = paced_tick {
            bw.probe_set_next_game_step_tick(paced_tick);
        }
        drop(guard);

        if let (Some(present), Some(confirmed)) = (bw.probe_fingerprint(), confirmed_fingerprint) {
            let sounds = reconcile_sounds(bw, confirmed.frame, present.frame);
            times.total = tick_start.elapsed();
            times.cycles = thread_cycles().wrapping_sub(tick_start_cycles);
            write_row(
                &present,
                &confirmed,
                SUPPRESSED_COMMANDS.load(Ordering::Relaxed),
                APPLIED_DELAYED_COMMANDS.load(Ordering::Relaxed),
                &sounds,
                &TICK_CORRECTIONS.lock(),
                &times,
            );
        } else {
            SOUND_LEDGER.lock().requested.clear();
        }
        ret
    }
}

/// Plays the sounds the tick's steps asked for that no earlier tick played, and counts the ones an
/// earlier tick played that the re-simulation no longer asks for.
///
/// `final_frame` is the frame the tick's snapshot holds, which no later tick simulates again, and
/// `present_frame` the newest frame the tick reached, the one about to be shown.
unsafe fn reconcile_sounds(bw: &BwScr, final_frame: u32, present_frame: u32) -> SoundCounts {
    unsafe {
        let mut ledger = SOUND_LEDGER.lock();
        let requested = std::mem::take(&mut ledger.requested);
        let mut presented = std::mem::take(&mut ledger.presented);
        let mut new_requests = Vec::new();
        for request in &requested {
            match presented.iter().position(|x| x.is_same_sound(request)) {
                Some(index) => {
                    presented.swap_remove(index);
                }
                None => new_requests.push(*request),
            }
        }
        // Every frame the earlier ticks played sounds for was re-simulated by this one, so what is
        // left over was only ever part of a prediction.
        let mut counts = SoundCounts {
            stale: presented.len() as u32,
            ..SoundCounts::default()
        };
        ledger.presented = requested
            .into_iter()
            .filter(|x| x.frame > final_frame)
            .collect();
        drop(ledger);

        for request in new_requests {
            let lateness = present_frame.saturating_sub(request.frame);
            match lateness {
                0 => counts.on_time += 1,
                _ => {
                    counts.late += 1;
                    counts.late_frames += lateness;
                }
            }
            bw.probe_play_sound(request.sound_id, request.volume, request.position);
        }
        counts
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
             elapsed_seconds,player_types,\
             confirmed_frame,c_rng0,c_rng1,c_rng2,c_rng3,c_rng4,c_rng5,\
             c_minerals0,c_minerals1,c_minerals2,c_minerals3,c_gas0,c_gas1,c_gas2,c_gas3,\
             c_trigger_timer,c_elapsed_seconds,c_player_types,rollback_frames,\
             suppressed_commands,applied_delayed_commands,\
             sounds_on_time,sounds_late,sounds_late_frames,sounds_stale,\
             units_moved,max_move,units_morphed,units_popped_in,units_popped_out,move_distances,\
             restore_micros,steps_micros,snapshot_micros,tick_micros,tick_kcycles"
        )
        .map_err(|e| format!("{}: {e}", path.display()))?;
        Ok(HarnessFile { path, file })
    }
}
