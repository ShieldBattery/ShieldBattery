//! The snapshot the rollback engine restores and re-simulates from.
//!
//! A snapshot is a memcpy of every range [`super::ranges`] resolves, plus the per-player trigger
//! lists, which are heap nodes copied and relinked rather than flat ranges (see
//! [`TriggerLists`]). [`Snapshots`] keeps several, each labeled with the frame count the
//! simulation had reached when it was taken, so a rollback can restore the newest one at or before
//! the frame it needs and re-simulate from there.

use std::mem::size_of;

use parking_lot::Mutex;

use crate::bw::{self, Bw};
use crate::bw_scr::{BwScr, resolve_operand, scr};

use super::copier::{Copier, Direction, SLOT_ALIGN};
use super::ranges::{
    self, AI_PLAYERS, CAPACITY_MASK, MAX_POOL_CAPACITY, PLAYERS, RangeKind, RangeList,
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
    /// For each snapshot slot, every player's list.
    saved: Vec<Vec<SavedTriggerList>>,
}

#[derive(Clone, Default)]
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
        TriggerLists {
            heads,
            saved: Vec::new(),
        }
    }

    fn head(&self, player: usize) -> *mut usize {
        (self.heads + player * 3 * size_of::<usize>()) as *mut usize
    }

    unsafe fn take(&mut self, slot: usize) {
        unsafe {
            while self.saved.len() <= slot {
                self.saved.push(
                    (0..TRIGGER_LIST_PLAYERS)
                        .map(|_| SavedTriggerList::default())
                        .collect(),
                );
            }
            for player in 0..TRIGGER_LIST_PLAYERS {
                let head = self.head(player);
                let saved = &mut self.saved[slot][player];
                saved.header = [head.read(), head.add(1).read(), head.add(2).read()];
                saved.nodes.clear();
                saved.nodes.extend(list_nodes(head));
                saved.bytes.clear();
                for &node in &saved.nodes {
                    saved.bytes.extend_from_slice(std::slice::from_raw_parts(
                        node as *const u8,
                        TRIGGER_NODE_SIZE,
                    ));
                }
            }
        }
    }

    unsafe fn restore(&mut self, slot: usize, bw: &BwScr) {
        unsafe {
            for player in 0..TRIGGER_LIST_PLAYERS {
                let head = self.head(player);
                let saved = &mut self.saved[slot][player];
                if list_nodes(head).eq(saved.nodes.iter().copied()) {
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
                for node in list_nodes(head).collect::<Vec<_>>() {
                    bw.free(node as *mut u8);
                }
                let replacements = saved
                    .nodes
                    .iter()
                    .map(|_| bw.alloc(TRIGGER_NODE_SIZE) as usize)
                    .collect::<Vec<_>>();
                let old_nodes = std::mem::replace(&mut saved.nodes, replacements);
                let translate = |link: usize| {
                    old_nodes
                        .iter()
                        .position(|&x| x == link)
                        .map(|i| saved.nodes[i])
                        .unwrap_or(link)
                };
                // The saved copy's links are translated as well as the live ones: this snapshot
                // can be restored again, and its nodes are the replacements from now on.
                let word = size_of::<usize>();
                for (i, &node) in saved.nodes.iter().enumerate() {
                    let saved_node = saved.bytes.as_mut_ptr().add(i * TRIGGER_NODE_SIZE);
                    for link in 0..2 {
                        let at = saved_node.add(link * word) as *mut usize;
                        at.write_unaligned(translate(at.read_unaligned()));
                    }
                    std::ptr::copy_nonoverlapping(saved_node, node as *mut u8, TRIGGER_NODE_SIZE);
                }
                saved.header[0] = translate(saved.header[0]);
                saved.header[1] = translate(saved.header[1]);
                head.write(saved.header[0]);
                head.add(1).write(saved.header[1]);
                head.add(2).write(saved.header[2]);
            }
        }
    }
}

/// Every node of the trigger list whose header is at `head`, found by following the second link
/// from the header round to the header again.
unsafe fn list_nodes(head: *mut usize) -> impl Iterator<Item = usize> {
    unsafe {
        let head = head as usize;
        let mut node = (head as *const usize).add(1).read();
        std::iter::from_fn(move || {
            if node == head || node == 0 {
                return None;
            }
            let current = node;
            node = (node as *const usize).add(1).read();
            Some(current)
        })
        .take(MAX_TRIGGERS_PER_PLAYER)
    }
}

/// The snapshots of the simulation a rollback can go back to, and the ranges they were built from.
///
/// Slots are allocated as they are first needed and reused once their snapshot is dropped, so the
/// memory held follows how far back rollbacks actually reach rather than a fixed bound.
pub(crate) struct Snapshots {
    /// The ranges, for code that inspects live memory alongside the snapshots.
    #[cfg(debug_assertions)]
    ranges: Vec<ranges::Range>,
    /// Bytes one snapshot of the ranges takes, alignment padding included.
    slot_bytes: usize,
    /// Copies the ranges into and out of the slots, each range at a [`SLOT_ALIGN`]-aligned offset.
    copier: Copier,
    slots: Vec<Slot>,
    /// The trigger lists, when analysis found their headers.
    trigger_lists: Option<TriggerLists>,
    replay_data: *mut bw::ReplayData,
}

// The pointers are BW's own globals, only touched from the game thread that owns the snapshots.
unsafe impl Send for Snapshots {}

struct Slot {
    /// The frame count of the simulation when this slot's snapshot was taken, or `None` for a slot
    /// holding nothing that can be restored.
    frame: Option<u32>,
    bytes: Box<[SlotLine]>,
    replay: ReplayCursor,
}

/// What a snapshot holds besides its bytes, for a caller that stores snapshots outside the slots.
#[derive(Clone)]
pub(crate) struct SnapshotExtras {
    replay: ReplayCursor,
    /// Every player's trigger list, when the layout has them.
    trigger_lists: Option<Vec<SavedTriggerList>>,
}

/// The unit a slot's bytes are allocated in, so that every range in it can start on a cache line.
#[derive(Clone)]
#[repr(C, align(64))]
struct SlotLine([u8; SLOT_ALIGN]);

/// Where the replay's command stream was, as offsets into its buffer.
///
/// Playback reads each frame's commands through the replay data, and recording appends them to it,
/// so a restore has to rewind it with the simulation. Its buffer is not part of the snapshot: in
/// playback it never changes, and while recording it grows, possibly moving, so the pointers into
/// it are kept as offsets and put back relative to wherever the buffer is now. Bytes past the
/// restored length are overwritten as the re-simulated frames append their commands again.
#[derive(Copy, Clone, Default)]
struct ReplayCursor {
    data_length: u32,
    /// Offset of the open record's command bytes, or `None` when no record was open.
    current_frame_data_start: Option<usize>,
    current_frame: u32,
    data_pos: usize,
}

impl ReplayCursor {
    unsafe fn capture(replay: *const bw::ReplayData) -> ReplayCursor {
        unsafe {
            let start = (*replay).data_start as usize;
            let open = (*replay).current_frame_data_start;
            ReplayCursor {
                data_length: (*replay).data_length,
                current_frame_data_start: (!open.is_null()).then(|| open as usize - start),
                current_frame: (*replay).current_frame,
                data_pos: ((*replay).data_pos as usize).wrapping_sub(start),
            }
        }
    }

    unsafe fn restore(&self, replay: *mut bw::ReplayData) {
        unsafe {
            let start = (*replay).data_start;
            (*replay).data_length = self.data_length;
            (*replay).current_frame_data_start = match self.current_frame_data_start {
                Some(offset) => start.add(offset),
                None => std::ptr::null_mut(),
            };
            (*replay).current_frame = self.current_frame;
            (*replay).data_pos = start.wrapping_add(self.data_pos);
        }
    }
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
            // The game struct is copied in pieces around the fields only the person watching
            // changes (see `ranges::VIEWER_LOCAL_GAME_FIELDS`).
            let mut start = 0;
            for &(_, offset, len) in ranges::VIEWER_LOCAL_GAME_FIELDS {
                list.add("game", game as usize + start, offset - start);
                start = offset + len;
            }
            list.add("game", game as usize + start, size_of::<bw::Game>() - start);
            list.add(
                "players",
                bw.players() as usize,
                PLAYERS * size_of::<bw::Player>(),
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

            #[cfg(debug_assertions)]
            ranges::add_extra_ranges_from_env(bw, &mut list);

            list.make_disjoint();
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
            let mut offsets = Vec::with_capacity(ranges.len());
            let mut slot_bytes = 0;
            for range in &ranges {
                offsets.push(slot_bytes);
                slot_bytes = (slot_bytes + range.len()).next_multiple_of(SLOT_ALIGN);
            }
            let copier = Copier::new(
                ranges
                    .iter()
                    .zip(&offsets)
                    .map(|(range, &offset)| (range.start(), offset, range.len())),
            );
            Some(Snapshots {
                #[cfg(debug_assertions)]
                ranges,
                slot_bytes,
                copier,
                slots: Vec::new(),
                trigger_lists,
                replay_data: bw.replay_data(),
            })
        }
    }

    /// Snapshots the simulation as it is now, labeled with `frame`, its current frame count. Takes
    /// the place of an earlier snapshot of the same frame.
    pub(crate) unsafe fn take(&mut self, frame: u32) {
        unsafe {
            let slot = self.free_slot_for(frame);
            self.copier.copy(
                self.slots[slot].bytes.as_mut_ptr() as *mut u8,
                Direction::ToSlot,
            );
            if let Some(trigger_lists) = &mut self.trigger_lists {
                trigger_lists.take(slot);
            }
            if !self.replay_data.is_null() {
                self.slots[slot].replay = ReplayCursor::capture(self.replay_data);
            }
            self.slots[slot].frame = Some(frame);
        }
    }

    /// The slot a snapshot of frame count `frame` goes in: the one already holding that frame, or
    /// one holding nothing, allocated if there is none.
    fn free_slot_for(&mut self, frame: u32) -> usize {
        match self
            .slots
            .iter()
            .position(|x| x.frame == Some(frame))
            .or_else(|| self.slots.iter().position(|x| x.frame.is_none()))
        {
            Some(slot) => slot,
            None => {
                self.slots.push(Slot {
                    frame: None,
                    bytes: vec![SlotLine([0; SLOT_ALIGN]); self.slot_bytes / SLOT_ALIGN]
                        .into_boxed_slice(),
                    replay: ReplayCursor::default(),
                });
                self.slots.len() - 1
            }
        }
    }

    /// Restores the newest snapshot taken at or before frame count `frame`, or the oldest one held
    /// when every snapshot is newer, and drops every snapshot newer than the one restored: they
    /// belong to a simulation that is about to be replaced. Returns the frame count restored, or
    /// `None` when no snapshot is held.
    pub(crate) unsafe fn restore_at_or_before(&mut self, frame: u32, bw: &BwScr) -> Option<u32> {
        unsafe {
            let slot = self
                .slot_at_or_before(frame)
                .or_else(|| self.oldest_slot())?;
            let restored = self.slots[slot].frame?;
            self.copier.copy(
                self.slots[slot].bytes.as_mut_ptr() as *mut u8,
                Direction::FromSlot,
            );
            if let Some(trigger_lists) = &mut self.trigger_lists {
                trigger_lists.restore(slot, bw);
            }
            if !self.replay_data.is_null() {
                self.slots[slot].replay.restore(self.replay_data);
            }
            for x in &mut self.slots {
                if x.frame.is_some_and(|x| x > restored) {
                    x.frame = None;
                }
            }
            Some(restored)
        }
    }

    /// Drops the snapshots that a rollback to frame count `frame` or later can never need: every
    /// one older than the newest taken at or before `frame`, which is kept.
    pub(crate) fn drop_older_than_needed_for(&mut self, frame: u32) {
        let Some(keep) = self
            .slot_at_or_before(frame)
            .and_then(|x| self.slots[x].frame)
        else {
            return;
        };
        for x in &mut self.slots {
            if x.frame.is_some_and(|x| x < keep) {
                x.frame = None;
            }
        }
    }

    /// Drops every snapshot.
    pub(crate) fn forget_all(&mut self) {
        for x in &mut self.slots {
            x.frame = None;
        }
    }

    /// Whether a snapshot of frame count `frame` is held.
    pub(crate) fn has(&self, frame: u32) -> bool {
        self.slots.iter().any(|x| x.frame == Some(frame))
    }

    /// The frame count of the oldest snapshot held.
    pub(crate) fn oldest_frame(&self) -> Option<u32> {
        self.oldest_slot().and_then(|x| self.slots[x].frame)
    }

    /// The frame count of the newest snapshot held at or before frame count `frame`.
    pub(crate) fn newest_at_or_before(&self, frame: u32) -> Option<u32> {
        self.slot_at_or_before(frame)
            .and_then(|x| self.slots[x].frame)
    }

    /// The bytes of the snapshot of frame count `frame`, every range at its offset in the slot,
    /// for a caller that stores them elsewhere. The rest of the snapshot is its
    /// [`SnapshotExtras`].
    pub(crate) fn bytes_of(&self, frame: u32) -> Option<&[u8]> {
        let slot = self.slots.iter().find(|x| x.frame == Some(frame))?;
        // A slot is whole `SlotLine`s, so its bytes are that many lines' worth, with no padding
        // between them.
        unsafe {
            Some(std::slice::from_raw_parts(
                slot.bytes.as_ptr() as *const u8,
                slot.bytes.len() * SLOT_ALIGN,
            ))
        }
    }

    /// The parts of the snapshot of frame count `frame` that aren't its [`bytes_of`](Self::bytes_of).
    pub(crate) fn extras_of(&self, frame: u32) -> Option<SnapshotExtras> {
        let slot = self.slots.iter().position(|x| x.frame == Some(frame))?;
        Some(SnapshotExtras {
            replay: self.slots[slot].replay,
            trigger_lists: self
                .trigger_lists
                .as_ref()
                .and_then(|x| x.saved.get(slot).cloned()),
        })
    }

    /// Puts back a snapshot of frame count `frame` that a caller stored elsewhere, as if it had
    /// just been taken: `fill` writes its [`bytes_of`](Self::bytes_of) into the slot, which holds
    /// the snapshot once `fill` succeeds. Takes the place of a snapshot of the same frame.
    pub(crate) fn load(
        &mut self,
        frame: u32,
        extras: SnapshotExtras,
        fill: impl FnOnce(&mut [u8]) -> std::io::Result<()>,
    ) -> std::io::Result<()> {
        let slot = self.free_slot_for(frame);
        self.slots[slot].frame = None;
        let bytes = &mut self.slots[slot].bytes;
        // A slot is whole `SlotLine`s, so its bytes are that many lines' worth, with no padding
        // between them.
        let bytes = unsafe {
            std::slice::from_raw_parts_mut(bytes.as_mut_ptr() as *mut u8, bytes.len() * SLOT_ALIGN)
        };
        fill(bytes)?;
        self.slots[slot].replay = extras.replay;
        if let (Some(trigger_lists), Some(saved)) = (&mut self.trigger_lists, extras.trigger_lists)
        {
            while trigger_lists.saved.len() <= slot {
                trigger_lists.saved.push(Vec::new());
            }
            trigger_lists.saved[slot] = saved;
        }
        self.slots[slot].frame = Some(frame);
        Ok(())
    }

    /// Whether no snapshot is held.
    pub(crate) fn is_empty(&self) -> bool {
        self.slots.iter().all(|x| x.frame.is_none())
    }

    fn slot_at_or_before(&self, frame: u32) -> Option<usize> {
        self.slots
            .iter()
            .enumerate()
            .filter(|(_, x)| x.frame.is_some_and(|x| x <= frame))
            .max_by_key(|(_, x)| x.frame)
            .map(|(index, _)| index)
    }

    fn oldest_slot(&self) -> Option<usize> {
        self.slots
            .iter()
            .enumerate()
            .filter(|(_, x)| x.frame.is_some())
            .min_by_key(|(_, x)| x.frame)
            .map(|(index, _)| index)
    }

    /// Threads helping with copies.
    #[cfg(debug_assertions)]
    pub(crate) fn copy_helpers(&self) -> usize {
        self.copier.helpers()
    }

    /// Time the threads helping with copies have spent awake, for a bench to count their cost.
    #[cfg(debug_assertions)]
    pub(crate) fn copy_helper_busy(&self) -> std::time::Duration {
        self.copier.helper_busy()
    }

    /// The ranges a snapshot copies, for code that inspects live memory alongside it (an audit, a
    /// dump).
    #[cfg(debug_assertions)]
    pub(crate) fn ranges(&self) -> &[ranges::Range] {
        &self.ranges
    }
}
