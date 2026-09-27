//! The snapshot the rollback engine restores and re-simulates from.
//!
//! A snapshot is a memcpy of every range [`super::ranges`] resolves, plus the per-player trigger
//! lists, which are heap nodes copied and relinked rather than flat ranges (see
//! [`TriggerLists`]). [`Snapshots`] holds two buffers so that taking a fresh snapshot never
//! overwrites the one a restore is still reading, and tracks which of the two is confirmed: the
//! snapshot of a frame no later tick will simulate again.

use std::mem::size_of;

use parking_lot::Mutex;

use crate::bw::{self, Bw};
use crate::bw_scr::{BwScr, resolve_operand, scr};

use super::ranges::{
    self, AI_PLAYERS, CAPACITY_MASK, MAX_POOL_CAPACITY, PLAYERS, Range, RangeKind, RangeList,
    TRIGGER_LIST_PLAYERS,
};

/// Bytes of the trigger a trigger list node carries after its two links: the map's trigger record
/// with its runtime state (execution flags, the action in progress) in it.
const TRIGGER_SIZE: usize = 0x960;

/// Upper bound on the nodes one trigger list is walked for, against a list whose links have been
/// overwritten.
const MAX_TRIGGERS_PER_PLAYER: usize = 0x10000;

/// Bytes of one trigger list node: its two links, then its trigger.
const TRIGGER_NODE_SIZE: usize = 2 * size_of::<usize>() + TRIGGER_SIZE;

/// The per-player trigger lists, which the snapshot copies node by node rather than as ranges.
///
/// Each player's triggers are a circular doubly linked list of heap nodes whose header lives in a
/// static array, and the nodes hold state the simulation changes (which triggers have run, how far
/// a waiting one has got). The lists never grow during a game, but a trigger pass that decides a
/// player's defeat, or a player leaving, frees that player's whole list; a re-simulation of the
/// same frames then has to find the list as it was. So a snapshot keeps each list's header and
/// whole nodes, and a restore copies the nodes back when the same ones are still linked, or
/// allocates new nodes for them, with their links translated, when the list has been freed since.
pub(crate) struct TriggerLists {
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

/// One snapshot of the simulation, and the ranges it was built from.
pub(crate) struct Snapshots {
    ranges: Vec<Range>,
    /// Two buffers of the layout's total size, so a fresh snapshot is never written into the one a
    /// restore is reading from.
    buffers: [Vec<u8>; 2],
    /// The trigger lists, when analysis found their headers.
    trigger_lists: Option<TriggerLists>,
    /// Index into `buffers` of the snapshot the next tick rolls back to, or `None` until the first
    /// snapshot of the game has been taken.
    confirmed: Option<usize>,
}

/// The current game's snapshot ranges and buffers, built at the first tick that needs them and
/// dropped when the game loop re-enters game init, since every address the layout resolved has to
/// be found again.
pub(crate) static SNAPSHOTS: Mutex<Option<Snapshots>> = Mutex::new(None);

impl Snapshots {
    /// Turns the analysis results into concrete address ranges. Returns `None` before a game's
    /// state exists, so the next logic step can try again.
    pub(crate) unsafe fn build(bw: &BwScr) -> Option<Snapshots> {
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
                let Some(op) = spec.operand() else {
                    list.omit(spec.name());
                    continue;
                };
                match spec.kind {
                    RangeKind::Storage => match ranges::storage_of(op) {
                        Some((start, len)) => list.add(spec.name(), start, len),
                        None => list.omit(spec.name()),
                    },
                    RangeKind::StorageBlock { len } => match ranges::storage_of(op) {
                        Some((start, _)) => list.add(spec.name(), start, len),
                        None => list.omit(spec.name()),
                    },
                    RangeKind::Block { offset, len } => {
                        let start = resolve_operand(op, &[]).wrapping_add_signed(offset);
                        list.add(spec.name(), start, len);
                    }
                    RangeKind::IndirectBlock { offset, len } => {
                        let block = resolve_operand(op, &[]);
                        match block != 0 {
                            true => {
                                let slot = (block + offset) as *const usize;
                                list.add(spec.name(), slot.read(), len);
                            }
                            false => list.omit(spec.name()),
                        }
                    }
                    RangeKind::MapTiles { stride } => {
                        list.add(spec.name(), resolve_operand(op, &[]), map_tiles * stride);
                    }
                    RangeKind::PoolVector { element_size } => {
                        let vector = resolve_operand(op, &[]) as *const scr::BwVector;
                        if vector.is_null() {
                            list.omit(spec.name());
                            continue;
                        }
                        list.add(spec.name(), vector as usize, size_of::<scr::BwVector>());
                        let capacity = (*vector).capacity & CAPACITY_MASK;
                        match capacity <= MAX_POOL_CAPACITY {
                            true => list.add(
                                spec.name(),
                                (*vector).data as usize,
                                capacity * element_size,
                            ),
                            false => list.omit(spec.name()),
                        }
                    }
                    RangeKind::TriggerLists => {
                        let heads = resolve_operand(op, &[]);
                        match heads != 0 {
                            true => trigger_lists = Some(TriggerLists::new(heads)),
                            false => list.omit(spec.name()),
                        }
                    }
                    RangeKind::AiRegions => {
                        let base = resolve_operand(op, &[]);
                        list.add(spec.name(), base, AI_PLAYERS * size_of::<usize>());
                        if base == 0 || region_count == 0 {
                            list.omit("ai_regions_arrays");
                            continue;
                        }
                        for player in 0..AI_PLAYERS {
                            let array = (base as *const usize).add(player).read();
                            list.add(spec.name(), array, region_count * size_of::<bw::AiRegion>());
                        }
                    }
                }
            }

            ranges::add_extra_ranges_from_env(bw, &mut list);

            let RangeList { ranges, omitted } = list;
            for range in &ranges {
                debug!(
                    "Rollback range {:x}..{:x} ({} bytes)",
                    range.start(),
                    range.start() + range.len(),
                    range.len(),
                );
            }
            let total_bytes = ranges.iter().map(|x| x.len()).sum::<usize>();
            info!(
                "Rollback snapshot layout: {} ranges, {total_bytes} bytes, omitted [{}]",
                ranges.len(),
                omitted.join(", "),
            );
            for (name, reason) in ranges::EXCLUDED {
                info!("Rollback snapshot leaves out {name}: {reason}");
            }
            if ranges.is_empty() {
                return None;
            }
            Some(Snapshots {
                ranges,
                buffers: [vec![0u8; total_bytes], vec![0u8; total_bytes]],
                trigger_lists,
                confirmed: None,
            })
        }
    }

    /// Copies every range into `buffer`, which becomes the snapshot the next restore reads from.
    pub(crate) unsafe fn take(&mut self, buffer: usize) {
        unsafe {
            let mut out = self.buffers[buffer].as_mut_ptr();
            for range in &self.ranges {
                std::ptr::copy_nonoverlapping(range.start() as *const u8, out, range.len());
                out = out.add(range.len());
            }
            if let Some(trigger_lists) = &mut self.trigger_lists {
                trigger_lists.take(buffer);
            }
            self.confirmed = Some(buffer);
        }
    }

    pub(crate) unsafe fn restore(&mut self, buffer: usize, bw: &BwScr) {
        unsafe {
            let mut input = self.buffers[buffer].as_ptr();
            for range in &self.ranges {
                std::ptr::copy_nonoverlapping(input, range.start() as *mut u8, range.len());
                input = input.add(range.len());
            }
            if let Some(trigger_lists) = &mut self.trigger_lists {
                trigger_lists.restore(buffer, bw);
            }
        }
    }

    /// The ranges this snapshot copies, for code that inspects live memory alongside it (an
    /// audit, a dump).
    pub(crate) fn ranges(&self) -> &[Range] {
        &self.ranges
    }

    /// Index into the snapshot's buffers of the confirmed snapshot, or `None` until the first one
    /// of the game has been taken.
    pub(crate) fn confirmed(&self) -> Option<usize> {
        self.confirmed
    }

    /// Forgets which buffer is confirmed, so the next tick anchors a fresh one as if the game had
    /// just started.
    pub(crate) fn clear_confirmed(&mut self) {
        self.confirmed = None;
    }
}
