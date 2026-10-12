//! The snapshot the rollback engine restores and re-simulates from.
//!
//! A snapshot is a memcpy of every range [`super::ranges`] resolves, plus the few bytes of the
//! per-player trigger lists the simulation changes, which live in heap nodes rather than flat ranges
//! (see [`TriggerLists`]). [`Snapshots`] keeps several, each labeled with the frame count the
//! simulation had reached when it was taken, so a rollback can restore the newest one at or before
//! the frame it needs and re-simulate from there.

use std::collections::HashMap;
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

/// Bytes of a trigger list node's two links, which come before its trigger.
const TRIGGER_LINKS_SIZE: usize = 2 * size_of::<usize>();

/// Bytes of one trigger list node: its two links, then its trigger.
const TRIGGER_NODE_SIZE: usize = TRIGGER_LINKS_SIZE + TRIGGER_SIZE;

/// Offset in a trigger of its execution flags, a word of which the simulation only ever changes
/// bits of the lowest byte.
const TRIGGER_FLAGS: usize = 0x940;

/// Offset in a trigger of the index of the action it is running.
const TRIGGER_CURRENT_ACTION: usize = 0x95f;

/// Offset in a trigger of its actions.
const TRIGGER_ACTIONS: usize = 0x140;
const TRIGGER_ACTION_COUNT: usize = 64;
const ACTION_SIZE: usize = 0x20;
const ACTION_TYPE: usize = 0x1a;

/// Offset in an action of its flags, the lowest bit of which an action that waits across frames
/// sets while it waits.
const ACTION_FLAGS: usize = 0x1c;

/// The action types that wait across frames: Wait, Transmission and Center View.
const WAITING_ACTION_TYPES: [u8; 3] = [4, 7, 10];

/// Environment variable that, set to anything, makes every snapshot check that the simulation has
/// changed no byte of a trigger list node other than the ones [`TriggerLists`] keeps.
#[cfg(debug_assertions)]
const VERIFY_TRIGGERS_ENV_VAR: &str = "SB_ROLLBACK_VERIFY_TRIGGERS";

/// The per-player trigger lists, of which a snapshot keeps only the bytes the simulation changes.
///
/// Each player's triggers are a circular doubly linked list of heap nodes whose header lives in a
/// static array. Once a game is running, nothing but the trigger step writes to the nodes, and it
/// only writes a trigger's execution flags, the index of the action it is running, and the flags of
/// its actions that wait. The lists never grow or change order during a game, but a trigger pass
/// that decides a player's defeat, or a player leaving, frees that player's whole list; a
/// re-simulation of the same frames then has to find the list as it was. So the lists' nodes are
/// copied whole once, when the layout is built, and each snapshot keeps the bytes that can change,
/// or the header of a list freed by then. A restore writes those bytes back into the same nodes,
/// or, when the list has been freed since, into new nodes made from the copy.
pub(crate) struct TriggerLists {
    /// The first of the [`TRIGGER_LIST_PLAYERS`] list headers, each `last, first, count`.
    heads: usize,
    /// Every player's list as it was when the layout was built.
    lists: Vec<TriggerList>,
    /// For each snapshot slot, every player's list.
    saved: Vec<Vec<SavedTriggerList>>,
}

struct TriggerList {
    /// The header's words while the list has its nodes.
    header: [usize; 3],
    /// The nodes' addresses, in the order they are walked.
    nodes: Vec<usize>,
    /// The nodes' bytes, links included, [`TRIGGER_NODE_SIZE`] each, in the same order.
    bytes: Vec<u8>,
    /// Where the bytes the simulation can change are, as the index of their node in `nodes` and
    /// their offset in it, in node order.
    state: Vec<(u32, u16)>,
}

#[derive(Clone, Default)]
struct SavedTriggerList {
    /// The header's words when the list had been freed, or `None` while it had its nodes.
    freed_header: Option<[usize; 3]>,
    /// While the list had its nodes, the byte at each of its [`TriggerList::state`] places, in the
    /// same order.
    state: Vec<u8>,
}

impl TriggerLists {
    unsafe fn new(heads: usize) -> TriggerLists {
        unsafe {
            let lists = (0..TRIGGER_LIST_PLAYERS)
                .map(|player| TriggerList::new(head(heads, player)))
                .collect();
            TriggerLists {
                heads,
                lists,
                saved: Vec::new(),
            }
        }
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
            for (player, list) in self.lists.iter().enumerate() {
                let head = head(self.heads, player);
                let saved = &mut self.saved[slot][player];
                saved.state.clear();
                if !has_nodes(head) {
                    saved.freed_header = Some(read_header(head));
                    continue;
                }
                debug_assert!(
                    !list.nodes.is_empty(),
                    "Trigger list {player} has nodes it didn't have when the layout was built",
                );
                #[cfg(debug_assertions)]
                if verify_triggers() {
                    list.verify(head, player);
                }
                saved.freed_header = None;
                saved.state.extend(list.state.iter().map(|&(node, offset)| {
                    ((list.nodes[node as usize] + offset as usize) as *const u8).read()
                }));
            }
        }
    }

    unsafe fn restore(&mut self, slot: usize, bw: &BwScr) {
        unsafe {
            for (player, list) in self.lists.iter_mut().enumerate() {
                let head = head(self.heads, player);
                let saved = &self.saved[slot][player];
                if let Some(header) = saved.freed_header {
                    if has_nodes(head) {
                        for node in list_nodes(head).collect::<Vec<_>>() {
                            bw.free(node as *mut u8);
                        }
                    }
                    write_header(head, header);
                    continue;
                }
                if !has_nodes(head) {
                    list.relink(head, bw);
                }
                for (&(node, offset), &value) in list.state.iter().zip(&saved.state) {
                    ((list.nodes[node as usize] + offset as usize) as *mut u8).write(value);
                }
            }
        }
    }
}

impl TriggerList {
    unsafe fn new(head: *mut usize) -> TriggerList {
        unsafe {
            let nodes = list_nodes(head).collect::<Vec<_>>();
            let mut bytes = Vec::with_capacity(nodes.len() * TRIGGER_NODE_SIZE);
            let mut state = Vec::new();
            for (index, &node) in nodes.iter().enumerate() {
                let node = std::slice::from_raw_parts(node as *const u8, TRIGGER_NODE_SIZE);
                bytes.extend_from_slice(node);
                state.extend(state_offsets(node).map(|offset| (index as u32, offset as u16)));
            }
            TriggerList {
                header: read_header(head),
                nodes,
                bytes,
                state,
            }
        }
    }

    /// Brings back the nodes of a list the game has freed, in allocations of our own made from the
    /// copy, pointing every link that pointed at an old node at its replacement. The copy's links
    /// are translated as well, since its nodes are the replacements from now on.
    unsafe fn relink(&mut self, head: *mut usize, bw: &BwScr) {
        unsafe {
            let replacements = self
                .nodes
                .iter()
                .map(|_| bw.alloc(TRIGGER_NODE_SIZE) as usize)
                .collect::<Vec<_>>();
            let translations = self
                .nodes
                .iter()
                .copied()
                .zip(replacements.iter().copied())
                .collect::<HashMap<_, _>>();
            let translate = |link: usize| translations.get(&link).copied().unwrap_or(link);
            let word = size_of::<usize>();
            for (i, &node) in replacements.iter().enumerate() {
                let copy = self.bytes.as_mut_ptr().add(i * TRIGGER_NODE_SIZE);
                for link in 0..2 {
                    let at = copy.add(link * word) as *mut usize;
                    at.write_unaligned(translate(at.read_unaligned()));
                }
                std::ptr::copy_nonoverlapping(copy, node as *mut u8, TRIGGER_NODE_SIZE);
            }
            self.header[0] = translate(self.header[0]);
            self.header[1] = translate(self.header[1]);
            write_header(head, self.header);
            self.nodes = replacements;
        }
    }

    /// Panics if the list at `head` isn't this list's nodes, or if any byte of them other than the
    /// ones a snapshot keeps differs from the copy.
    #[cfg(debug_assertions)]
    unsafe fn verify(&self, head: *mut usize, player: usize) {
        unsafe {
            assert!(
                list_nodes(head).eq(self.nodes.iter().copied()),
                "Trigger list {player} isn't linked the way it was when the layout was built",
            );
            let mut state = self.state.iter().peekable();
            for (index, &node) in self.nodes.iter().enumerate() {
                let live = std::slice::from_raw_parts(node as *const u8, TRIGGER_NODE_SIZE);
                let mut expected: [u8; TRIGGER_NODE_SIZE] = self.bytes[index * TRIGGER_NODE_SIZE..]
                    [..TRIGGER_NODE_SIZE]
                    .try_into()
                    .expect("A node's copy is a node long");
                while let Some(&(_, offset)) = state.next_if(|x| x.0 as usize == index) {
                    expected[offset as usize] = live[offset as usize];
                }
                if let Some(offset) = live.iter().zip(&expected).position(|(a, b)| a != b) {
                    panic!(
                        "Trigger {index} of player {player}'s list changed at node offset \
                        {offset:#x}, which snapshots don't keep: {:#x} -> {:#x}",
                        expected[offset], live[offset],
                    );
                }
            }
        }
    }
}

/// Offsets in the trigger list node `node` of the bytes the simulation can change: its trigger's
/// execution flags (the lowest byte, the only one that changes), the index of the action it is
/// running, and the flags of each of its actions that waits.
fn state_offsets(node: &[u8]) -> impl Iterator<Item = usize> + '_ {
    let trigger = TRIGGER_LINKS_SIZE;
    let actions = (0..TRIGGER_ACTION_COUNT)
        .map(move |i| trigger + TRIGGER_ACTIONS + i * ACTION_SIZE)
        .filter(|&action| WAITING_ACTION_TYPES.contains(&node[action + ACTION_TYPE]))
        .map(|action| action + ACTION_FLAGS);
    [trigger + TRIGGER_FLAGS, trigger + TRIGGER_CURRENT_ACTION]
        .into_iter()
        .chain(actions)
}

#[cfg(debug_assertions)]
fn verify_triggers() -> bool {
    static VERIFY: std::sync::LazyLock<bool> =
        std::sync::LazyLock::new(|| std::env::var_os(VERIFY_TRIGGERS_ENV_VAR).is_some());
    *VERIFY
}

/// The header of player `player`'s trigger list, given the first of the headers.
fn head(heads: usize, player: usize) -> *mut usize {
    (heads + player * 3 * size_of::<usize>()) as *mut usize
}

unsafe fn read_header(head: *mut usize) -> [usize; 3] {
    unsafe { [head.read(), head.add(1).read(), head.add(2).read()] }
}

unsafe fn write_header(head: *mut usize, header: [usize; 3]) {
    unsafe {
        head.write(header[0]);
        head.add(1).write(header[1]);
        head.add(2).write(header[2]);
    }
}

/// Whether the trigger list whose header is at `head` has nodes. Freeing a list points its header
/// at itself.
unsafe fn has_nodes(head: *mut usize) -> bool {
    unsafe {
        let first = head.add(1).read();
        first != head as usize && first != 0
    }
}

/// Every node of the trigger list whose header is at `head`, found by following the second link
/// from the header round to the header again, and no more than the header counts, against a list
/// whose links have been overwritten.
unsafe fn list_nodes(head: *mut usize) -> impl Iterator<Item = usize> {
    unsafe {
        let count = head.add(2).read();
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
        .take(count)
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
#[derive(Clone, Default)]
pub(crate) struct SnapshotExtras {
    replay: ReplayCursor,
    /// Every player's trigger list, when the layout has them.
    trigger_lists: Option<Vec<SavedTriggerList>>,
}

impl SnapshotExtras {
    /// Allocations owned by the extras, excluding the struct itself.
    pub(crate) fn heap_bytes(&self) -> usize {
        self.trigger_lists.as_ref().map_or(0, |lists| {
            lists.capacity() * size_of::<SavedTriggerList>()
                + lists
                    .iter()
                    .map(|list| list.state.capacity())
                    .sum::<usize>()
        })
    }
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
    /// Bytes needed by one raw snapshot slot, including alignment padding.
    pub(crate) fn byte_len(&self) -> usize {
        self.slot_bytes
    }

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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn state_offsets_cover_flags_current_action_and_waiting_actions() {
        let mut node = vec![0u8; TRIGGER_NODE_SIZE];
        let action = |i: usize| TRIGGER_LINKS_SIZE + TRIGGER_ACTIONS + i * ACTION_SIZE;
        // A Wait, a Create Unit, a Transmission past an empty action, and a Center View in the
        // last slot.
        for (i, kind) in [(0, 4), (1, 44), (5, 7), (63, 10)] {
            node[action(i) + ACTION_TYPE] = kind;
        }
        assert_eq!(
            state_offsets(&node).collect::<Vec<_>>(),
            vec![
                TRIGGER_LINKS_SIZE + TRIGGER_FLAGS,
                TRIGGER_LINKS_SIZE + TRIGGER_CURRENT_ACTION,
                action(0) + ACTION_FLAGS,
                action(5) + ACTION_FLAGS,
                action(63) + ACTION_FLAGS,
            ],
        );
    }
}
