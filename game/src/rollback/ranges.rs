//! Which memory the rollback engine's snapshot covers.
//!
//! The simulation's synced state is a fixed list of `(address, length)` ranges: static globals and
//! array bases resolved from binary analysis ([`analyze_ranges`]), object pools sized from the
//! analysis's own vector layouts, and blocks and structs sized from constants pinned to the layout
//! the game crate is compiled against. [`analyze_ranges`] resolves the analysis-derived half of
//! that list once, during analysis; turning it into concrete addresses and copying it happens in
//! [`super::snapshot`].

use std::mem::size_of;

use scr_analysis::scarf::{MemAccessSize, Operand, OperandCtx, OperandType};

use bw_dat::structs::Path as BwPath;

use crate::bw;
use crate::bw_scr::{BwScr, resolve_operand, scr};

/// Environment variable adding static memory to the snapshot beyond what analysis resolves, as a
/// comma-separated list of `<hex offset from the executable's base>+<hex length>`. Offsets are
/// specific to one build of the game, so this is only for trying out candidates an audit turned up.
const EXTRA_RANGES_ENV_VAR: &str = "SB_ROLLBACK_EXTRA_RANGES";

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
pub(super) const AI_PLAYERS: usize = 8;
/// Slots in the player array, which is also how many entries the per-player unit list heads and
/// the trigger unit caches have.
pub(super) const PLAYERS: usize = 0xc;
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
pub(super) const CAPACITY_MASK: usize = usize::MAX >> 1;
/// Largest element count a pool vector is believed to reach. A capacity beyond it means the field
/// was read from something that is not a pool vector, and copying that many bytes would run off
/// the end of the heap.
pub(super) const MAX_POOL_CAPACITY: usize = 1 << 20;

/// Players that have a trigger list.
pub(super) const TRIGGER_LIST_PLAYERS: usize = 8;

/// How a range's address and length are derived from one analysis result.
///
/// An analysis result is either a static array base, in which case the operand *is* the address,
/// or a `MemXX[address]` global, in which case the operand's own storage holds the value and
/// evaluating the operand yields whatever that global holds. [`RangeKind::Storage`] and
/// [`RangeKind::StorageBlock`] take the first reading of a `MemXX[..]` result and every other kind
/// takes the second, which is why one rule covers both array bases and pointer globals.
#[derive(Copy, Clone)]
pub(super) enum RangeKind {
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
    /// [`TriggerLists`](super::snapshot::TriggerLists) rather than as ranges.
    TriggerLists,
}

/// Synced state the snapshot deliberately leaves out, with the reason. Logged beside the layout so
/// that a fingerprint divergence can be weighed against what is known to be missing before
/// anything else is suspected.
pub(super) const EXCLUDED: &[(&str, &str)] = &[
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
    pub(super) kind: RangeKind,
}

impl RangeSpec {
    pub fn name(&self) -> &'static str {
        self.name
    }

    pub fn operand(&self) -> Option<Operand<'static>> {
        self.op
    }
}

// The operands are interned in a leaked context that outlives the process and are only ever read,
// like the rest of the analysis results `BwScr` holds.
unsafe impl Send for RangeSpec {}
unsafe impl Sync for RangeSpec {}

/// One contiguous span of BW memory the snapshot copies.
#[derive(Copy, Clone)]
pub(crate) struct Range {
    name: &'static str,
    start: usize,
    len: usize,
}

impl Range {
    pub(crate) fn name(&self) -> &'static str {
        self.name
    }

    pub(crate) fn start(&self) -> usize {
        self.start
    }

    pub(crate) fn len(&self) -> usize {
        self.len
    }
}

/// The ranges as they are being resolved, alongside the names of the ones that could not be.
pub(super) struct RangeList {
    pub(super) ranges: Vec<Range>,
    pub(super) omitted: Vec<&'static str>,
}

impl RangeList {
    /// Adds one range, treating a null address or an empty length as a range that could not be
    /// resolved: the snapshot is built from whatever ranges do resolve, and the layout log names
    /// the rest.
    pub(super) fn add(&mut self, name: &'static str, start: usize, len: usize) {
        match start != 0 && len != 0 {
            true => self.ranges.push(Range { name, start, len }),
            false => self.omit(name),
        }
    }

    pub(super) fn omit(&mut self, name: &'static str) {
        self.omitted.push(name);
    }
}

/// Adds the ranges [`EXTRA_RANGES_ENV_VAR`] names to the layout, for trying out whether some static
/// memory the analysis does not cover yet is state the snapshot is missing.
pub(super) fn add_extra_ranges_from_env(bw: &BwScr, list: &mut RangeList) {
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

/// Resolves the operands the snapshot covers, onto the same context the rest of `BwScr`'s operands
/// are copied into. Called once during analysis.
///
/// A result the analysis cannot find is kept in the list with no operand, so the layout log names
/// it as omitted rather than silently dropping it.
pub fn analyze_ranges(
    analysis: &mut scr_analysis::Analysis<'_>,
    ctx: OperandCtx<'static>,
) -> Vec<RangeSpec> {
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
        // Which unit spawned the last spinning bullet, and which side that bullet was turned to.
        // A bullet from that same unit takes the other side without drawing from the synced RNG,
        // so a re-simulated frame that saw a later spawner here draws a different number of times.
        ("last_bullet_spawner", analysis.last_bullet_spawner()),
        (
            "last_bullet_spin_direction",
            analysis.last_bullet_spin_direction(),
        ),
        // Counted up and down as bullets are created and released, so every re-simulated frame
        // moves it. Bullet creation for some weapons is refused once it reaches a limit, compared
        // unsigned, so a count left to drift below zero refuses every one of them.
        ("active_bullet_count", analysis.active_bullet_count()),
        ("first_active_bullet", analysis.first_active_bullet()),
        ("last_active_bullet", analysis.last_active_bullet()),
        ("first_free_order", analysis.first_free_order()),
        ("last_free_order", analysis.last_free_order()),
        ("allocated_order_count", analysis.allocated_order_count()),
        ("first_free_path", analysis.first_free_path()),
        ("lurker_hits_frame", analysis.lurker_hits_frame()),
        ("lurker_hits_pos", analysis.lurker_hits_pos()),
        ("game_frame_count", analysis.game_frame_count()),
        // Counts down to the next check of whether the local player's game is decided. Left out,
        // every re-simulated frame winds it down again, so the check runs at other frames than on
        // clients that don't roll back.
        (
            "trigger_result_check_timer",
            analysis.trigger_result_check_timer(),
        ),
        // The countdown that decides which logic steps also run a network turn, the step that
        // counts `game_frame_count` up and records a sync slot. Every step takes a fixed amount
        // off it, so left out, each re-simulated step would move later turns to earlier frames.
        ("turn_timer_accumulator", analysis.turn_timer_accumulator()),
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
        // The three that decide when every unit's ignore-as-target flag is cleared: a countdown,
        // a second countdown it reloads, and a pending request.
        (
            "ai_target_ignore_reset",
            analysis.ai_target_ignore_reset_counter(),
        ),
        (
            "ai_target_ignore_reset2",
            analysis.ai_target_ignore_reset_counter2(),
        ),
        (
            "ai_target_ignore_request_reset",
            analysis.ai_target_ignore_request_reset(),
        ),
        // AI region stepping walks a fixed number of regions every frame from where the last frame
        // stopped, so it needs both halves of its cursor: which player, and which region.
        ("step_ai_regions_player", analysis.step_ai_regions_player()),
        ("step_ai_regions_region", analysis.step_ai_regions_region()),
        (
            "ai_expansion_player_cursor",
            analysis.ai_expansion_player_cursor(),
        ),
        // The cursors the sync checksum ring is written through, and the accumulators whose
        // value the next recorded checksum picks up. Each is a global of its own beside the
        // ring rather than a field of it.
        // Whether the order confirmation marker is drawn. Its sprite and animation are in the
        // pools, and its animation clears this when it ends; restored apart from them, a marker
        // whose animation a restore rewound past its end would stay drawn for good.
        ("draw_cursor_marker", analysis.draw_cursor_marker()),
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
            "Rollback snapshots {name} as {struct_size:#x} bytes, but the running build lays it \
             out as {analysis_size:#x}"
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

/// The address and byte length of a memory operand's own storage, or `None` for an operand that
/// isn't a memory access (a static array base).
pub(super) unsafe fn storage_of(op: Operand<'_>) -> Option<(usize, usize)> {
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
