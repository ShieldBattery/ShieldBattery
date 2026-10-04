//! The copying a snapshot and a restore are made of, split between the game thread and a few
//! helper threads.
//!
//! One core moves a snapshot's megabytes at a fraction of what the memory system can take, so the
//! ranges are cut into pieces that several threads copy at once. The game thread copies alongside
//! the helpers and returns only once every piece is done, so nothing reads or writes the memory
//! being copied until the copy is complete, and the bytes copied are the same whoever copies them.

use std::sync::Arc;
use std::sync::atomic::{AtomicBool, AtomicU64, AtomicUsize, Ordering};
use std::thread::{JoinHandle, Thread};
#[cfg(debug_assertions)]
use std::time::{Duration, Instant};

/// Alignment of every range's bytes inside a snapshot slot. Ranges are only split on these
/// boundaries, so no thread writes a slot cache line that another thread writes too.
pub(crate) const SLOT_ALIGN: usize = 64;

/// Bytes a chunk of work covers at most. Small enough that the threads run out of work close
/// together, and well under the size at which the C runtime's memcpy switches to stores that
/// bypass the cache, which would leave a restored simulation outside it for the steps that follow.
const CHUNK_BYTES: usize = 64 * 1024;

/// Helper threads at most. Copies stop getting faster past a few threads, as they are limited by
/// memory bandwidth rather than by any one core.
const MAX_HELPERS: usize = 3;

/// Overrides how many helper threads a copier starts, for a bench comparing counts.
#[cfg(debug_assertions)]
pub(crate) static HELPERS_OVERRIDE: AtomicUsize = AtomicUsize::new(usize::MAX);

/// Which way a copy goes between the simulation's memory and a snapshot slot.
#[derive(Copy, Clone, Eq, PartialEq)]
pub(crate) enum Direction {
    ToSlot,
    FromSlot,
}

/// One contiguous copy between the simulation's memory and a slot.
struct Piece {
    memory: usize,
    slot_offset: usize,
    len: usize,
}

/// Copies a fixed set of ranges between the simulation's memory and any slot laid out like the
/// others.
pub(crate) struct Copier {
    shared: Arc<Shared>,
    helpers: Vec<(Thread, JoinHandle<()>)>,
}

/// What the game thread and the helpers share: the pieces, and the copy in progress.
struct Shared {
    pieces: Box<[Piece]>,
    /// For each chunk, the index of its first piece, then one past the last piece.
    chunk_starts: Box<[u32]>,
    /// The copy in progress: its sequence number in the high half, the next chunk to claim in the
    /// low half. A thread only copies a chunk it claimed by moving this on from the value it read
    /// the copy's slot and direction under, so it never copies a chunk for a copy that has ended.
    claim: AtomicU64,
    /// Chunks of the copy in progress that are done.
    done: AtomicUsize,
    slot: AtomicUsize,
    to_slot: AtomicBool,
    shutdown: AtomicBool,
    /// Time the helpers spent awake, for a bench to count their cost.
    #[cfg(debug_assertions)]
    helper_busy_ns: AtomicU64,
}

impl Shared {
    fn chunk_count(&self) -> u32 {
        self.chunk_starts.len() as u32 - 1
    }

    /// Claims and copies chunks of the copy in progress until every chunk has been claimed.
    unsafe fn work(&self) {
        unsafe {
            let count = self.chunk_count();
            loop {
                let claim = self.claim.load(Ordering::Acquire);
                let chunk = claim as u32;
                if chunk >= count {
                    return;
                }
                let slot = self.slot.load(Ordering::Relaxed);
                let to_slot = self.to_slot.load(Ordering::Relaxed);
                if self
                    .claim
                    .compare_exchange_weak(claim, claim + 1, Ordering::AcqRel, Ordering::Relaxed)
                    .is_err()
                {
                    continue;
                }
                let first = self.chunk_starts[chunk as usize] as usize;
                let end = self.chunk_starts[chunk as usize + 1] as usize;
                for piece in &self.pieces[first..end] {
                    let in_slot = (slot + piece.slot_offset) as *mut u8;
                    let memory = piece.memory as *mut u8;
                    match to_slot {
                        true => std::ptr::copy_nonoverlapping(memory, in_slot, piece.len),
                        false => std::ptr::copy_nonoverlapping(in_slot, memory, piece.len),
                    }
                }
                self.done.fetch_add(1, Ordering::Release);
            }
        }
    }
}

impl Copier {
    /// A copier of `ranges`, each `(address, offset in a slot, length)`.
    pub(crate) fn new(ranges: impl Iterator<Item = (usize, usize, usize)>) -> Copier {
        let mut pieces = Vec::new();
        let mut chunk_starts = vec![0u32];
        let mut chunk_bytes = 0;
        for (memory, slot_offset, len) in ranges {
            let mut at = 0;
            while at < len {
                // A range is only split on a slot line boundary.
                let room = (CHUNK_BYTES - chunk_bytes) / SLOT_ALIGN * SLOT_ALIGN;
                let n = (len - at).min(room);
                if n != 0 {
                    pieces.push(Piece {
                        memory: memory + at,
                        slot_offset: slot_offset + at,
                        len: n,
                    });
                    at += n;
                    chunk_bytes += n;
                }
                if chunk_bytes + SLOT_ALIGN > CHUNK_BYTES {
                    chunk_starts.push(pieces.len() as u32);
                    chunk_bytes = 0;
                }
            }
        }
        if chunk_bytes != 0 {
            chunk_starts.push(pieces.len() as u32);
        }
        let chunks = chunk_starts.len() as u32 - 1;
        let shared = Arc::new(Shared {
            pieces: pieces.into_boxed_slice(),
            chunk_starts: chunk_starts.into_boxed_slice(),
            claim: AtomicU64::new(chunks as u64),
            done: AtomicUsize::new(0),
            slot: AtomicUsize::new(0),
            to_slot: AtomicBool::new(false),
            shutdown: AtomicBool::new(false),
            #[cfg(debug_assertions)]
            helper_busy_ns: AtomicU64::new(0),
        });
        let helpers = (0..helper_count())
            .filter_map(|i| {
                let shared = shared.clone();
                let handle = std::thread::Builder::new()
                    .name(format!("rollback copy {i}"))
                    .spawn(move || help(&shared));
                match handle {
                    Ok(handle) => Some((handle.thread().clone(), handle)),
                    Err(e) => {
                        warn!("Could not start a rollback copy thread: {e}");
                        None
                    }
                }
            })
            .collect::<Vec<_>>();
        Copier { shared, helpers }
    }

    /// Copies every range between the simulation's memory and the slot starting at `slot`.
    pub(crate) unsafe fn copy(&self, slot: *mut u8, direction: Direction) {
        unsafe {
            let shared = &*self.shared;
            shared.slot.store(slot as usize, Ordering::Relaxed);
            shared
                .to_slot
                .store(direction == Direction::ToSlot, Ordering::Relaxed);
            shared.done.store(0, Ordering::Relaxed);
            let sequence = (shared.claim.load(Ordering::Relaxed) >> 32).wrapping_add(1);
            shared.claim.store(sequence << 32, Ordering::Release);
            for (thread, _) in &self.helpers {
                thread.unpark();
            }
            shared.work();
            let count = shared.chunk_count() as usize;
            while shared.done.load(Ordering::Acquire) < count {
                std::hint::spin_loop();
            }
        }
    }

    /// Helper threads started.
    #[cfg(debug_assertions)]
    pub(crate) fn helpers(&self) -> usize {
        self.helpers.len()
    }

    /// Time the helper threads have spent awake since the copier started.
    #[cfg(debug_assertions)]
    pub(crate) fn helper_busy(&self) -> Duration {
        Duration::from_nanos(self.shared.helper_busy_ns.load(Ordering::Relaxed))
    }
}

impl Drop for Copier {
    fn drop(&mut self) {
        self.shared.shutdown.store(true, Ordering::Release);
        for (thread, _) in &self.helpers {
            thread.unpark();
        }
        for (_, handle) in self.helpers.drain(..) {
            let _ = handle.join();
        }
    }
}

/// Helpers to start: up to [`MAX_HELPERS`], leaving a logical processor for the game thread and
/// one for everything else.
fn helper_count() -> usize {
    #[cfg(debug_assertions)]
    {
        let forced = HELPERS_OVERRIDE.load(Ordering::Relaxed);
        if forced != usize::MAX {
            return forced;
        }
    }
    std::thread::available_parallelism()
        .map(|x| x.get().saturating_sub(2).min(MAX_HELPERS))
        .unwrap_or(0)
}

/// A helper thread: sleeps until a copy starts, helps with it, and goes back to sleep.
fn help(shared: &Shared) {
    unsafe {
        loop {
            #[cfg(debug_assertions)]
            let woke = Instant::now();
            shared.work();
            #[cfg(debug_assertions)]
            shared
                .helper_busy_ns
                .fetch_add(woke.elapsed().as_nanos() as u64, Ordering::Relaxed);
            if shared.shutdown.load(Ordering::Acquire) {
                return;
            }
            std::thread::park();
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[repr(C, align(64))]
    #[derive(Clone)]
    struct Line([u8; SLOT_ALIGN]);

    #[test]
    fn copies_every_byte_both_ways() {
        // Lengths around the chunk size and the slot line size, so ranges are split mid-range, at
        // their ends, and on line boundaries short of a full chunk.
        let lengths = [
            1,
            63,
            64,
            65,
            CHUNK_BYTES - 1,
            CHUNK_BYTES,
            CHUNK_BYTES + 1,
            3 * CHUNK_BYTES + 100,
            200,
            7,
            CHUNK_BYTES * 2 - 64,
            1 << 20,
        ];
        let mut memory = lengths
            .iter()
            .map(|&len| vec![0u8; len])
            .collect::<Vec<_>>();
        let mut offsets = Vec::new();
        let mut slot_bytes = 0;
        for &len in &lengths {
            offsets.push(slot_bytes);
            slot_bytes = (slot_bytes + len).next_multiple_of(SLOT_ALIGN);
        }
        let copier = Copier::new(
            memory
                .iter()
                .zip(&offsets)
                .map(|(x, &offset)| (x.as_ptr() as usize, offset, x.len())),
        );
        let mut slots = (0..2)
            .map(|_| vec![Line([0; SLOT_ALIGN]); slot_bytes / SLOT_ALIGN])
            .collect::<Vec<_>>();
        let fill = |memory: &mut [Vec<u8>], seed: u32| {
            for (i, range) in memory.iter_mut().enumerate() {
                for (j, byte) in range.iter_mut().enumerate() {
                    let value = seed
                        .wrapping_mul(31)
                        .wrapping_add(i as u32 * 7)
                        .wrapping_add(j as u32 * 13);
                    *byte = (value >> 2) as u8;
                }
            }
        };
        for round in 0..50u32 {
            fill(&mut memory, round);
            let expected = memory.clone();
            let slot = slots[round as usize % 2].as_mut_ptr() as *mut u8;
            unsafe { copier.copy(slot, Direction::ToSlot) };
            fill(&mut memory, round + 1000);
            unsafe { copier.copy(slot, Direction::FromSlot) };
            assert!(memory == expected, "round {round}");
        }
    }
}
