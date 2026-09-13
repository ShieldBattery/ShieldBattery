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

/// Whether sound requests are being swallowed because the frame being simulated has already been
/// played once. Read by the `play_sound` hook.
static SUPPRESS_SOUNDS: AtomicBool = AtomicBool::new(false);

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
/// Bytes of the pathing state's dynamic-state block: four edge array pointers, their counts and
/// growth limits, and the collision bounds.
#[cfg(target_arch = "x86_64")]
const PATHING_DYNAMIC_STATE_SIZE: usize = 0x48;

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
    /// One tile array: `map_width_tiles * map_height_tiles * stride` bytes at the address the
    /// operand evaluates to.
    MapTiles { stride: usize },
    /// A pool's vector header plus the whole of its storage, `capacity` elements of
    /// `element_size` bytes. `live_count_name` names a vector whose number of live entries is
    /// kept in a separate 32-bit global just before the header, which must be restored with it.
    PoolVector {
        element_size: usize,
        live_count_name: Option<&'static str>,
    },
    /// One pointer per AI player, each to that player's array of one `AiRegion` per pathing region
    /// of the current map.
    AiRegions,
    /// The block the pathing state's last word points at, which holds the collision edge arrays'
    /// pointers, counts and bounds. Taken from the pathing state operand.
    PathingDynamicState,
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
         read while a game runs",
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
            true => self.ranges.push(Range { start, len }),
            false => self.omit(name),
        }
    }

    fn omit(&mut self, name: &'static str) {
        self.omitted.push(name);
    }
}

struct Harness {
    ranges: Vec<Range>,
    /// Two buffers of the layout's total size, so a fresh snapshot is never written into the one a
    /// restore is reading from.
    buffers: [Vec<u8>; 2],
    /// Index into `buffers` of the snapshot the next tick rolls back to, or `None` until the first
    /// snapshot of the game has been taken.
    confirmed: Option<usize>,
}

struct HarnessFile {
    path: PathBuf,
    file: File,
}

/// Arms the harness if the environment asks for it. Called once while the DLL initialises, before
/// the game thread exists.
pub fn init_from_env() {
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

/// Whether the frame being simulated has already been played once, so its sounds must not be
/// played again. Called from the `play_sound` hook.
pub fn sounds_suppressed() -> bool {
    SUPPRESS_SOUNDS.load(Ordering::Relaxed)
}

/// Drops the snapshot and its range list, so the next logic step rebuilds both. Called when the
/// game loop (re-)enters game init: the pools are reallocated there, and every address the layout
/// captured has to be resolved again.
pub fn reset_for_game_init() {
    if HARNESS.lock().take().is_some() {
        debug!("Rollback harness snapshot dropped for game init");
    }
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
    // noticeable part of launch time, so a run that will not roll anything back does not pay for
    // them.
    if ROLLBACK_FRAMES.load(Ordering::Acquire) == 0 {
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
        (
            "local_selection",
            analysis.local_selection(),
            SELECTION_SIZE * word,
        ),
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
    ];
    for (name, op, len) in blocks {
        add(name, op, RangeKind::Block { offset: 0, len });
    }

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
    add(
        "pathing_dynamic_state",
        analysis.pathing(),
        RangeKind::PathingDynamicState,
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
    /// Name of the array's live entry count when that count lives in a 32-bit global directly
    /// before the vector header rather than in the header's length field.
    live_count_name: Option<&'static str>,
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
        live_count_name: None,
    },
    AuxiliaryArray {
        name: "sprite_draw_order",
        element_size: size_of::<usize>(),
        length: (0, 0),
        live_count_name: None,
    },
];

/// The unit pool's auxiliary arrays: the splash target scratch list, the two coordinate-sorted
/// position search arrays, and the scratch marks and results of a position query.
const UNIT_AUXILIARY_ARRAYS: &[AuxiliaryArray] = &[
    AuxiliaryArray {
        name: "air_splash_candidates",
        element_size: size_of::<usize>(),
        length: (0, 0),
        live_count_name: None,
    },
    AuxiliaryArray {
        name: "unit_position_search_x",
        // A unit pool index and a coordinate, both 32-bit, so the same size on both architectures.
        element_size: 8,
        length: (0, 2),
        // Both search arrays share one live entry count (two entries per tracked unit), kept in
        // the global just before this vector. The arrays are maintained incrementally with no
        // rebuild path, so a count that is not rewound with them drifts until an insertion walks
        // past the live entries into stale slots.
        live_count_name: Some("unit_position_search_entry_count"),
    },
    AuxiliaryArray {
        name: "unit_position_search_y",
        element_size: 8,
        length: (0, 2),
        live_count_name: None,
    },
    AuxiliaryArray {
        name: "unit_query_scratch_marks",
        element_size: 4,
        length: (1, 0),
        live_count_name: None,
    },
    AuxiliaryArray {
        name: "unit_query_results",
        element_size: size_of::<usize>(),
        length: (1, 0),
        live_count_name: None,
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
                live_count_name: None,
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
            let (name, element_size, live_count_name) = if Some(slot) == object_index {
                (pool.name, pool.object_size, None)
            } else {
                match auxiliary.next() {
                    Some(array) if array.length == (add, mul) => {
                        (array.name, array.element_size, array.live_count_name)
                    }
                    _ => {
                        out.push(unresolved());
                        continue;
                    }
                }
            };
            out.push(RangeSpec {
                name,
                op: Some(ctx.copy_operand(op)),
                kind: RangeKind::PoolVector {
                    element_size,
                    live_count_name,
                },
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
                    RangeKind::MapTiles { stride } => {
                        list.add(spec.name, resolve_operand(op, &[]), map_tiles * stride);
                    }
                    RangeKind::PoolVector {
                        element_size,
                        live_count_name,
                    } => {
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
                        if let Some(count_name) = live_count_name {
                            // The count sits one pointer before the header on x86_64. Its position
                            // relative to the header has not been confirmed on the 32-bit build,
                            // so there it is left out rather than guessed; a count that is not
                            // within the array's capacity means the word is something else.
                            #[cfg(target_arch = "x86_64")]
                            {
                                let count_address = vector as usize - size_of::<usize>();
                                let count = (count_address as *const u32).read() as usize;
                                match count <= capacity {
                                    true => list.add(count_name, count_address, 4),
                                    false => list.omit(count_name),
                                }
                            }
                            #[cfg(target_arch = "x86")]
                            list.omit(count_name);
                        }
                    }
                    RangeKind::PathingDynamicState => {
                        // The pointer is the pathing state's last word.
                        #[cfg(target_arch = "x86_64")]
                        {
                            let state = resolve_operand(op, &[]);
                            match state != 0 {
                                true => {
                                    let slot = (state + size_of::<bw::Pathing>()
                                        - size_of::<usize>())
                                        as *const usize;
                                    list.add(spec.name, slot.read(), PATHING_DYNAMIC_STATE_SIZE);
                                }
                                false => list.omit(spec.name),
                            }
                        }
                        // The block's 32-bit size has not been verified against the 32-bit build,
                        // and it is small enough that leaving it out costs little.
                        #[cfg(target_arch = "x86")]
                        list.omit(spec.name);
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
            self.confirmed = Some(buffer);
        }
    }

    unsafe fn restore(&self, buffer: usize) {
        unsafe {
            let mut input = self.buffers[buffer].as_ptr();
            for range in &self.ranges {
                std::ptr::copy_nonoverlapping(input, range.start as *mut u8, range.len);
                input = input.add(range.len);
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
        let rollback_frames = ROLLBACK_FRAMES.load(Ordering::Acquire);
        if rollback_frames == 0 {
            return crate::rollback_probe::run_game_logic_step(bw, param, orig);
        }
        if !ELIGIBILITY_CHECKED.swap(true, Ordering::AcqRel) && !game_thread::is_replay() {
            // Rolling a live game back would re-send network turns that have already gone out, and
            // there would be nothing to compare the fingerprints against either.
            ROLLBACK_FRAMES.store(0, Ordering::Release);
            info!("{ENV_VAR} only runs during replay playback; leaving the simulation alone");
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
        let mut guard = HARNESS.lock();
        if guard.is_none() {
            *guard = Harness::build(bw);
        }
        let Some(harness) = guard.as_mut() else {
            return crate::rollback_probe::run_game_logic_step(bw, param, orig);
        };

        // `steps_after` is how many further steps the tick runs once this one is done, which is
        // what turns the frame a step reads commands for into the tick's newest frame.
        let step = |suppress_sounds: bool, steps_after: usize, confirmed: bool| {
            SUPPRESS_SOUNDS.store(suppress_sounds, Ordering::Release);
            STEPS_AFTER_CURRENT.store(steps_after as u32, Ordering::Relaxed);
            IN_CONFIRMED_STEP.store(confirmed, Ordering::Relaxed);
            let start = Instant::now();
            let ret = crate::rollback_probe::run_game_logic_step(bw, param, orig);
            let elapsed = start.elapsed();
            SUPPRESS_SOUNDS.store(false, Ordering::Release);
            (ret, elapsed)
        };

        let mut restore_micros = Duration::ZERO;
        let mut steps_micros = Duration::ZERO;
        let snapshot_micros;
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
        GATING_ACTIVE.store(true, Ordering::Relaxed);
        match harness.confirmed {
            // Steady state: the snapshot is `rollback_frames` frames behind the simulation, so
            // going back to it and simulating one frame re-derives the frame the snapshot moves on
            // to, and the remaining steps catch back up and add the one new frame.
            Some(confirmed) => {
                let start = Instant::now();
                harness.restore(confirmed);
                restore_micros = start.elapsed();

                let (step_ret, elapsed) = step(true, rollback_frames, true);
                ret = step_ret;
                steps_micros += elapsed;
                paced_tick = Some(bw.probe_next_game_step_tick());
                confirmed_fingerprint = bw.probe_fingerprint();

                let start = Instant::now();
                harness.take(1 - confirmed);
                snapshot_micros = start.elapsed();

                for frame in 0..rollback_frames {
                    // Only the last step reaches a frame the game has never simulated, so it is
                    // the only one whose sounds belong to the present.
                    let steps_after = rollback_frames - 1 - frame;
                    let (step_ret, elapsed) =
                        step(frame + 1 != rollback_frames, steps_after, false);
                    ret = step_ret;
                    steps_micros += elapsed;
                }
            }
            // First tick of the game: anchor the snapshot here and run the simulation
            // `rollback_frames` frames past it, which is the distance every later tick keeps.
            None => {
                let start = Instant::now();
                harness.take(0);
                snapshot_micros = start.elapsed();
                // No step of this tick re-derives a frame, so the state the snapshot just captured
                // is the confirmed one and its fingerprint is already final.
                confirmed_fingerprint = bw.probe_fingerprint();

                for frame in 0..rollback_frames {
                    let (step_ret, elapsed) = step(false, rollback_frames - 1 - frame, false);
                    ret = step_ret;
                    steps_micros += elapsed;
                    if frame == 0 {
                        paced_tick = Some(bw.probe_next_game_step_tick());
                    }
                }
            }
        }

        GATING_ACTIVE.store(false, Ordering::Relaxed);
        IN_CONFIRMED_STEP.store(false, Ordering::Relaxed);
        if let Some(paced_tick) = paced_tick {
            bw.probe_set_next_game_step_tick(paced_tick);
        }
        drop(guard);

        if let (Some(present), Some(confirmed)) = (bw.probe_fingerprint(), confirmed_fingerprint) {
            write_row(
                &present,
                &confirmed,
                SUPPRESSED_COMMANDS.load(Ordering::Relaxed),
                APPLIED_DELAYED_COMMANDS.load(Ordering::Relaxed),
                restore_micros,
                steps_micros,
                snapshot_micros,
            );
        }
        ret
    }
}

fn write_row(
    present: &Fingerprint,
    confirmed: &Fingerprint,
    suppressed_commands: u32,
    applied_delayed_commands: u32,
    restore: Duration,
    steps: Duration,
    snapshot: Duration,
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
    let result = writeln!(
        &mut log_file.file,
        "{},{},{suppressed_commands},{applied_delayed_commands},{},{},{}",
        fingerprint_columns(present),
        fingerprint_columns(confirmed),
        restore.as_micros(),
        steps.as_micros(),
        snapshot.as_micros(),
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
        "{},{},{},{},{},{},{},{},{},{},{},{},{},{},{},{}",
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
    )
}

impl HarnessFile {
    fn create() -> Result<HarnessFile, String> {
        let seconds = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or(Duration::ZERO)
            .as_secs();
        // Alongside the game log, which is the directory anyone collecting a run's artifacts
        // already picks up.
        let path = crate::parse_args()
            .user_data_path
            .join("logs")
            .join(format!("rollback-harness-{seconds}.csv"));
        let mut file = File::create(&path).map_err(|e| format!("{}: {e}", path.display()))?;
        writeln!(
            &mut file,
            "frame,rng0,rng1,rng2,rng3,rng4,rng5,\
             minerals0,minerals1,minerals2,minerals3,gas0,gas1,gas2,gas3,trigger_timer,\
             confirmed_frame,c_rng0,c_rng1,c_rng2,c_rng3,c_rng4,c_rng5,\
             c_minerals0,c_minerals1,c_minerals2,c_minerals3,c_gas0,c_gas1,c_gas2,c_gas3,\
             c_trigger_timer,suppressed_commands,applied_delayed_commands,\
             restore_micros,steps_micros,snapshot_micros"
        )
        .map_err(|e| format!("{}: {e}", path.display()))?;
        Ok(HarnessFile { path, file })
    }
}
