//! Heap memory a crash dump carries beyond what dbghelp writes on its own: memory around the
//! addresses the crashing thread was working with, and the objects that registered pointer tables
//! point at.
//!
//! The data segments a dump includes hold the game's globals and the stacks hold return addresses,
//! but nearly every object those point at lives in heap memory, which a dump leaves out. So before
//! the dump is written, the crashing thread's registers and the top of its stack are read for
//! values that point into private or mapped memory, and a small chunk around each such address
//! goes into the dump. The first few pointer-sized values a register points at count as well,
//! which catches a register pointing at a table of object pointers. A registered pointer table, an
//! array whose entries point at objects of a known size, gets those objects added whole.
//!
//! This runs while every other thread keeps running, so any memory can be freed or unmapped at
//! any moment. Nothing here dereferences an address it was given or found: regions are asked of
//! `VirtualQuery`, whose answer may already be stale, and memory is read with `ReadProcessMemory`,
//! which fails instead of faulting. A chunk whose memory is gone by the time dbghelp reads it is
//! left out of the dump by the dump callback. Nothing here allocates, takes a lock, logs or
//! panics (the DLL aborts on panic, which would leave no dump at all), so all arithmetic on
//! addresses saturates.

use std::mem;
use std::sync::atomic::{AtomicUsize, Ordering};

use winapi::um::memoryapi::{ReadProcessMemory, VirtualQuery};
use winapi::um::processthreadsapi::GetCurrentProcess;
use winapi::um::winnt::{
    CONTEXT, EXCEPTION_POINTERS, MEM_COMMIT, MEM_MAPPED, MEM_PRIVATE, MEMORY_BASIC_INFORMATION,
    PAGE_GUARD, PAGE_NOACCESS,
};

use super::is_read_ok_protect;

const WORD: usize = mem::size_of::<usize>();

/// Addresses below this are never mapped (the first 64 KiB of the address space is reserved), so
/// small integers are dropped without asking the system about them.
const LOWEST_CANDIDATE: usize = 0x1_0000;

/// The chunk added around an address the crashing thread referenced. Objects are often pointed at
/// in their middle, so it starts a little before the address.
const REFERENCED_CHUNK: ChunkShape = ChunkShape {
    lead: 0x80,
    align: 0x40,
    len: 0x400,
    span: 0x100,
};

/// Pointer-sized slots read at each register that points at readable memory.
const SLOTS_PER_REGISTER: usize = 8;
/// Pointer-sized slots read from the crashing thread's stack pointer up.
const STACK_SLOTS: usize = 512;
/// Most chunks the crashing thread's registers and stack add.
const MAX_REFERENCED_CHUNKS: usize = 384;
/// Most chunks the registered pointer tables add, all tables together.
const MAX_TABLE_CHUNKS: usize = 64;
/// Most entries read of one registered table.
const MAX_TABLE_ENTRIES: usize = 64;
/// Most bytes added for the object one table entry points at.
const MAX_POINTEE_LEN: usize = 0x1000;
/// Most pointer tables that can be registered.
const MAX_POINTER_TABLES: usize = 8;
/// Most chunks a dump gets from this module.
pub(super) const MAX_CHUNKS: usize = MAX_REFERENCED_CHUNKS + MAX_TABLE_CHUNKS;

/// The general-purpose registers searched for addresses, as many as the architecture has besides
/// the stack and instruction pointers.
#[cfg(target_arch = "x86_64")]
pub(super) const REGISTER_COUNT: usize = 15;
#[cfg(target_arch = "x86")]
pub(super) const REGISTER_COUNT: usize = 7;

/// What `VirtualQuery` says about the region of memory around an address.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(super) struct Region {
    pub base: usize,
    pub size: usize,
    /// `MEM_COMMIT`, `MEM_RESERVE` or `MEM_FREE`.
    pub state: u32,
    /// `PAGE_*` protection of the region's pages.
    pub protect: u32,
    /// `MEM_PRIVATE`, `MEM_MAPPED` or `MEM_IMAGE`.
    pub kind: u32,
    /// Start of the allocation the region is part of, shared by all regions of one allocation.
    pub allocation_base: usize,
}

impl Region {
    fn from_info(info: &MEMORY_BASIC_INFORMATION) -> Region {
        Region {
            base: info.BaseAddress as usize,
            size: info.RegionSize,
            state: info.State,
            protect: info.Protect,
            kind: info.Type,
            allocation_base: info.AllocationBase as usize,
        }
    }

    fn end(&self) -> usize {
        self.base.saturating_add(self.size)
    }

    fn contains(&self, address: usize) -> bool {
        address >= self.base && address < self.end()
    }

    /// Whether the region's memory can be read without faulting, as far as its protection says.
    fn is_readable(&self) -> bool {
        self.state == MEM_COMMIT
            && self.protect & (PAGE_GUARD | PAGE_NOACCESS) == 0
            && is_read_ok_protect(self.protect)
    }

    /// Whether the region can hold heap objects worth adding to a dump: readable memory that is
    /// not an image's. Images' writable sections are in every dump already.
    fn holds_heap_objects(&self) -> bool {
        self.is_readable() && (self.kind == MEM_PRIVATE || self.kind == MEM_MAPPED)
    }

    /// How many whole pointer-sized slots, up to `max`, lie in the region from `address` on.
    fn slots_from(&self, address: usize, max: usize) -> usize {
        if !self.contains(address) {
            return 0;
        }
        ((self.end() - address) / WORD).min(max)
    }
}

/// How the chunk around an address of interest is placed.
#[derive(Clone, Copy, Debug)]
struct ChunkShape {
    /// Bytes before the address the chunk starts at, before aligning.
    lead: usize,
    /// What the chunk's start is aligned down to; a power of two.
    align: usize,
    /// Bytes in the chunk.
    len: usize,
    /// Bytes from the address on that the chunk exists to capture. An address whose span other
    /// chunks hold already adds nothing.
    span: usize,
}

impl ChunkShape {
    /// The chunk for a whole object of `len` bytes that an address points at the start of.
    fn object(len: usize) -> ChunkShape {
        ChunkShape {
            lead: 0,
            align: 1,
            len,
            span: len,
        }
    }

    /// The chunk around `address`, as `(start, end)`, cut to `region`, or `None` when `region`
    /// doesn't hold `address`.
    fn place(&self, address: usize, region: &Region) -> Option<(usize, usize)> {
        if !region.contains(address) {
            return None;
        }
        let start = (address.saturating_sub(self.lead) & !(self.align.max(1) - 1)).max(region.base);
        let end = start.saturating_add(self.len).min(region.end());
        (end > address).then_some((start, end))
    }
}

/// What [`ChunkList::add`] did with an address.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Placement {
    Added,
    /// Earlier chunks hold the address's span already.
    Covered,
    /// The list is at the limit it was given.
    Full,
    /// The address isn't in the region given for it.
    Outside,
}

/// Memory chunks for a dump, as `(start, end)`. No two of them overlap, and earlier ones are
/// never changed, so they come in the order their addresses were added.
pub(super) struct ChunkList {
    chunks: [(usize, usize); MAX_CHUNKS],
    count: usize,
}

impl ChunkList {
    pub(super) fn new() -> ChunkList {
        ChunkList {
            chunks: [(0, 0); MAX_CHUNKS],
            count: 0,
        }
    }

    pub(super) fn as_slice(&self) -> &[(usize, usize)] {
        self.chunks.get(..self.count).unwrap_or(&[])
    }

    pub(super) fn len(&self) -> usize {
        self.count
    }

    /// Bytes in all chunks together.
    pub(super) fn bytes(&self) -> usize {
        self.as_slice()
            .iter()
            .fold(0usize, |sum, &(start, end)| sum.saturating_add(end - start))
    }

    /// The first byte at or after `address` that no chunk holds.
    fn first_uncovered(&self, address: usize) -> usize {
        let mut position = address;
        // Each pass moves past at least one chunk or ends the walk, so it takes at most one pass
        // per chunk.
        for _ in 0..=self.count {
            let holding = self
                .as_slice()
                .iter()
                .find(|&&(start, end)| start <= position && position < end);
            match holding {
                Some(&(_, end)) => position = end,
                None => break,
            }
        }
        position
    }

    /// Whether chunks hold all of the `span` bytes from `address` on.
    fn covers(&self, address: usize, span: usize) -> bool {
        self.first_uncovered(address) >= address.saturating_add(span)
    }

    /// Adds the chunk `shape` places around `address` in `region`, less what earlier chunks hold,
    /// unless they hold all of the address's span already or the list has `limit` chunks.
    ///
    /// What gets added is the one stretch of the chunk that holds the first byte of the span no
    /// earlier chunk does, cut where earlier chunks begin and end, so chunks never overlap.
    fn add(
        &mut self,
        address: usize,
        region: &Region,
        shape: &ChunkShape,
        limit: usize,
    ) -> Placement {
        let Some((start, end)) = shape.place(address, region) else {
            return Placement::Outside;
        };
        let span_end = address.saturating_add(shape.span).min(end);
        let gap = self.first_uncovered(address);
        if gap >= span_end {
            return Placement::Covered;
        }
        if self.count >= limit.min(MAX_CHUNKS) {
            return Placement::Full;
        }
        let mut piece_start = start;
        let mut piece_end = end;
        for &(other_start, other_end) in self.as_slice() {
            if other_end <= gap && other_end > piece_start {
                piece_start = other_end;
            }
            if other_start > gap && other_start < piece_end {
                piece_end = other_start;
            }
        }
        if let Some(slot) = self.chunks.get_mut(self.count) {
            *slot = (piece_start, piece_end);
            self.count += 1;
        }
        Placement::Added
    }
}

/// Where memory is looked up and read from: the current process, or a made-up address space in
/// tests.
pub(super) trait AddressSpace {
    /// The region holding `address`, or `None` where nothing can be said about it.
    fn region(&self, address: usize) -> Option<Region>;
    /// Reads `out.len()` pointer-sized values starting at `address`, which needn't be aligned, and
    /// returns how many were read: fewer when the memory went away. Never faults.
    fn read_slots(&self, address: usize, out: &mut [usize]) -> usize;
}

/// The address space of this process, read without risking a fault.
pub(super) struct CurrentProcess;

impl AddressSpace for CurrentProcess {
    fn region(&self, address: usize) -> Option<Region> {
        unsafe {
            let mut info: MEMORY_BASIC_INFORMATION = mem::zeroed();
            if VirtualQuery(address as *const _, &mut info, mem::size_of_val(&info)) == 0 {
                return None;
            }
            Some(Region::from_info(&info))
        }
    }

    fn read_slots(&self, address: usize, out: &mut [usize]) -> usize {
        if out.is_empty() {
            return 0;
        }
        let mut read = 0;
        // A partial copy still reports how much it read.
        unsafe {
            ReadProcessMemory(
                GetCurrentProcess(),
                address as *const _,
                out.as_mut_ptr() as *mut _,
                mem::size_of_val(out),
                &mut read,
            );
        }
        (read / WORD).min(out.len())
    }
}

/// What the scan needs of the crashing thread.
#[derive(Clone, Copy, Debug)]
pub(super) struct CrashingThread {
    /// The general-purpose registers in [`registers_of`]'s order.
    pub registers: [usize; REGISTER_COUNT],
    pub stack_pointer: usize,
}

impl CrashingThread {
    pub(super) fn from_context(context: &CONTEXT) -> CrashingThread {
        CrashingThread {
            registers: registers_of(context),
            stack_pointer: stack_pointer_of(context),
        }
    }
}

/// The general-purpose registers of `context` other than the stack and instruction pointers.
#[cfg(target_arch = "x86_64")]
fn registers_of(context: &CONTEXT) -> [usize; REGISTER_COUNT] {
    [
        context.Rax,
        context.Rbx,
        context.Rcx,
        context.Rdx,
        context.Rsi,
        context.Rdi,
        context.Rbp,
        context.R8,
        context.R9,
        context.R10,
        context.R11,
        context.R12,
        context.R13,
        context.R14,
        context.R15,
    ]
    .map(|value| value as usize)
}

#[cfg(target_arch = "x86")]
fn registers_of(context: &CONTEXT) -> [usize; REGISTER_COUNT] {
    [
        context.Eax,
        context.Ebx,
        context.Ecx,
        context.Edx,
        context.Esi,
        context.Edi,
        context.Ebp,
    ]
    .map(|value| value as usize)
}

#[cfg(target_arch = "x86_64")]
fn stack_pointer_of(context: &CONTEXT) -> usize {
    context.Rsp as usize
}

#[cfg(target_arch = "x86")]
fn stack_pointer_of(context: &CONTEXT) -> usize {
    context.Esp as usize
}

/// An array of `count` pointers at `base`, each to an object of `pointee_len` bytes or null.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub(super) struct PointerTable {
    pub base: usize,
    pub count: usize,
    pub pointee_len: usize,
}

struct PointerTableSlot {
    /// 0 while the slot is free. Stored last when registering, so a nonzero base read with
    /// `Acquire` comes with its count and length.
    base: AtomicUsize,
    count: AtomicUsize,
    pointee_len: AtomicUsize,
}

/// Pointer tables whose objects crash dumps carry. Registering is lock-free and reading never
/// waits, so a crash can read the tables whatever other threads are doing.
pub(super) struct PointerTableRegistry {
    slots: [PointerTableSlot; MAX_POINTER_TABLES],
    claimed: AtomicUsize,
}

impl PointerTableRegistry {
    pub(super) const fn new() -> PointerTableRegistry {
        PointerTableRegistry {
            slots: [const {
                PointerTableSlot {
                    base: AtomicUsize::new(0),
                    count: AtomicUsize::new(0),
                    pointee_len: AtomicUsize::new(0),
                }
            }; MAX_POINTER_TABLES],
            claimed: AtomicUsize::new(0),
        }
    }

    /// Adds a table, or updates the count and length of the one registered at the same `base`.
    /// Returns false for an empty table or when all slots are taken.
    pub(super) fn register(&self, base: usize, count: usize, pointee_len: usize) -> bool {
        if base == 0 || count == 0 || pointee_len == 0 {
            return false;
        }
        let existing = self
            .slots
            .iter()
            .find(|slot| slot.base.load(Ordering::Acquire) == base);
        if let Some(slot) = existing {
            slot.count.store(count, Ordering::Relaxed);
            slot.pointee_len.store(pointee_len, Ordering::Relaxed);
            return true;
        }
        let index = self.claimed.fetch_add(1, Ordering::Relaxed);
        let Some(slot) = self.slots.get(index) else {
            return false;
        };
        slot.count.store(count, Ordering::Relaxed);
        slot.pointee_len.store(pointee_len, Ordering::Relaxed);
        slot.base.store(base, Ordering::Release);
        true
    }

    /// Copies the registered tables into `out`, returning how many there are.
    pub(super) fn snapshot(&self, out: &mut [PointerTable; MAX_POINTER_TABLES]) -> usize {
        let mut found = 0;
        for slot in &self.slots {
            let base = slot.base.load(Ordering::Acquire);
            if base == 0 {
                continue;
            }
            if let Some(entry) = out.get_mut(found) {
                *entry = PointerTable {
                    base,
                    count: slot.count.load(Ordering::Relaxed),
                    pointee_len: slot.pointee_len.load(Ordering::Relaxed),
                };
                found += 1;
            }
        }
        found
    }
}

pub(super) static POINTER_TABLES: PointerTableRegistry = PointerTableRegistry::new();

/// Fills `chunks` with the memory a dump of `exception` should carry beyond dbghelp's own: the
/// objects of the registered pointer tables, then the memory the crashing thread referenced.
/// Without an exception context only the tables are read.
///
/// # Safety
///
/// `exception` must be null or valid, and so must its context record if not null.
pub(super) unsafe fn collect_for_crash(exception: *mut EXCEPTION_POINTERS, chunks: &mut ChunkList) {
    let thread = unsafe {
        exception
            .as_ref()
            .and_then(|pointers| pointers.ContextRecord.as_ref())
            .map(CrashingThread::from_context)
    };
    let mut tables = [PointerTable::default(); MAX_POINTER_TABLES];
    let table_count = POINTER_TABLES.snapshot(&mut tables);
    collect(
        &CurrentProcess,
        thread.as_ref(),
        tables.get(..table_count).unwrap_or(&[]),
        chunks,
    );
}

/// Adds to `chunks` the objects `tables` point at, up to [`MAX_TABLE_CHUNKS`] chunks, then up to
/// [`MAX_REFERENCED_CHUNKS`] chunks of memory `thread` referenced, in this order of priority:
/// memory its registers point at, memory the first slots its registers point at point to, and
/// memory values on its stack point at.
fn collect(
    space: &impl AddressSpace,
    thread: Option<&CrashingThread>,
    tables: &[PointerTable],
    chunks: &mut ChunkList,
) {
    let table_limit = chunks.len().saturating_add(MAX_TABLE_CHUNKS);
    add_table_objects(space, tables, chunks, table_limit);
    if let Some(thread) = thread {
        let referenced_limit = chunks.len().saturating_add(MAX_REFERENCED_CHUNKS);
        add_referenced(space, thread, chunks, referenced_limit);
    }
}

fn add_table_objects(
    space: &impl AddressSpace,
    tables: &[PointerTable],
    chunks: &mut ChunkList,
    limit: usize,
) {
    for table in tables {
        let shape = ChunkShape::object(table.pointee_len.min(MAX_POINTEE_LEN));
        if shape.len == 0 {
            continue;
        }
        let Some(region) = space.region(table.base).filter(Region::is_readable) else {
            continue;
        };
        let mut entries = [0usize; MAX_TABLE_ENTRIES];
        let wanted = region.slots_from(table.base, table.count.min(MAX_TABLE_ENTRIES));
        let read = space.read_slots(table.base, entries.get_mut(..wanted).unwrap_or(&mut []));
        for &entry in entries.get(..read).unwrap_or(&[]) {
            if chunks.len() >= limit {
                return;
            }
            if entry < LOWEST_CANDIDATE || chunks.covers(entry, shape.span) {
                continue;
            }
            if let Some(target) = space.region(entry).filter(Region::holds_heap_objects) {
                chunks.add(entry, &target, &shape, limit);
            }
        }
    }
}

/// The candidate rule for an address the crashing thread referenced, and what is known for
/// applying it.
struct ReferencedRule {
    /// Allocation of the crashing thread's stack, which every dump holds already.
    stack_allocation: Option<usize>,
    limit: usize,
}

impl ReferencedRule {
    /// Adds the chunk around `value` if it qualifies, using `region` when it was looked up
    /// already. Returns false once the list is at its limit.
    fn consider(
        &self,
        space: &impl AddressSpace,
        chunks: &mut ChunkList,
        value: usize,
        region: Option<Region>,
    ) -> bool {
        if chunks.len() >= self.limit {
            return false;
        }
        if value < LOWEST_CANDIDATE || chunks.covers(value, REFERENCED_CHUNK.span) {
            return true;
        }
        let Some(region) = region.or_else(|| space.region(value)) else {
            return true;
        };
        if !region.holds_heap_objects() || Some(region.allocation_base) == self.stack_allocation {
            return true;
        }
        chunks.add(value, &region, &REFERENCED_CHUNK, self.limit) != Placement::Full
    }
}

fn add_referenced(
    space: &impl AddressSpace,
    thread: &CrashingThread,
    chunks: &mut ChunkList,
    limit: usize,
) {
    let stack_region = space.region(thread.stack_pointer);
    let rule = ReferencedRule {
        stack_allocation: stack_region.map(|region| region.allocation_base),
        limit,
    };
    let mut regions = [None; REGISTER_COUNT];
    for (&value, region) in thread.registers.iter().zip(regions.iter_mut()) {
        if value >= LOWEST_CANDIDATE {
            *region = space.region(value);
        }
        if !rule.consider(space, chunks, value, *region) {
            return;
        }
    }
    for (&value, region) in thread.registers.iter().zip(regions.iter()) {
        let Some(region) = region.filter(Region::is_readable) else {
            continue;
        };
        let mut slots = [0usize; SLOTS_PER_REGISTER];
        let wanted = region.slots_from(value, SLOTS_PER_REGISTER);
        let read = space.read_slots(value, slots.get_mut(..wanted).unwrap_or(&mut []));
        for &slot in slots.get(..read).unwrap_or(&[]) {
            if !rule.consider(space, chunks, slot, None) {
                return;
            }
        }
    }
    let Some(stack_region) = stack_region.filter(Region::is_readable) else {
        return;
    };
    let mut slots = [0usize; STACK_SLOTS];
    let wanted = stack_region.slots_from(thread.stack_pointer, STACK_SLOTS);
    let read = space.read_slots(
        thread.stack_pointer,
        slots.get_mut(..wanted).unwrap_or(&mut []),
    );
    for &slot in slots.get(..read).unwrap_or(&[]) {
        if !rule.consider(space, chunks, slot, None) {
            return;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    use winapi::um::winnt::{MEM_IMAGE, MEM_RESERVE, PAGE_READONLY, PAGE_READWRITE};

    fn region(base: usize, size: usize, kind: u32) -> Region {
        Region {
            base,
            size,
            state: MEM_COMMIT,
            protect: PAGE_READWRITE,
            kind,
            allocation_base: base,
        }
    }

    fn heap(base: usize, size: usize) -> Region {
        region(base, size, MEM_PRIVATE)
    }

    /// A made-up address space: regions, and pointer-sized values at some addresses (0
    /// elsewhere in readable regions).
    struct FakeSpace {
        regions: Vec<Region>,
        values: Vec<(usize, usize)>,
    }

    impl FakeSpace {
        fn new(regions: Vec<Region>) -> FakeSpace {
            FakeSpace {
                regions,
                values: Vec::new(),
            }
        }

        fn with_values(mut self, at: usize, values: &[usize]) -> FakeSpace {
            for (i, &value) in values.iter().enumerate() {
                self.values.push((at + i * WORD, value));
            }
            self
        }
    }

    impl AddressSpace for FakeSpace {
        fn region(&self, address: usize) -> Option<Region> {
            self.regions.iter().copied().find(|r| r.contains(address))
        }

        fn read_slots(&self, address: usize, out: &mut [usize]) -> usize {
            for (i, slot) in out.iter_mut().enumerate() {
                let at = address + i * WORD;
                match self.region(at) {
                    Some(r) if r.is_readable() && at + WORD <= r.end() => {
                        *slot = self
                            .values
                            .iter()
                            .find(|&&(a, _)| a == at)
                            .map(|&(_, v)| v)
                            .unwrap_or(0);
                    }
                    _ => return i,
                }
            }
            out.len()
        }
    }

    fn thread(registers: &[usize], stack_pointer: usize) -> CrashingThread {
        let mut all = [0; REGISTER_COUNT];
        all[..registers.len()].copy_from_slice(registers);
        CrashingThread {
            registers: all,
            stack_pointer,
        }
    }

    #[test]
    fn heap_qualifies_but_images_and_unreadable_memory_dont() {
        assert!(heap(0x10000, 0x1000).holds_heap_objects());
        assert!(region(0x10000, 0x1000, MEM_MAPPED).holds_heap_objects());
        assert!(!region(0x10000, 0x1000, MEM_IMAGE).holds_heap_objects());
        assert!(region(0x10000, 0x1000, MEM_IMAGE).is_readable());
        let guarded = Region {
            protect: PAGE_READWRITE | PAGE_GUARD,
            ..heap(0x10000, 0x1000)
        };
        assert!(!guarded.holds_heap_objects());
        let no_access = Region {
            protect: PAGE_NOACCESS,
            ..heap(0x10000, 0x1000)
        };
        assert!(!no_access.holds_heap_objects());
        let reserved = Region {
            state: MEM_RESERVE,
            ..heap(0x10000, 0x1000)
        };
        assert!(!reserved.holds_heap_objects());
        let read_only = Region {
            protect: PAGE_READONLY,
            ..heap(0x10000, 0x1000)
        };
        assert!(read_only.holds_heap_objects());
    }

    #[test]
    fn chunk_starts_before_the_address_aligned() {
        let r = heap(0x10000, 0x10000);
        assert_eq!(
            REFERENCED_CHUNK.place(0x15123, &r),
            Some((0x15080, 0x15480))
        );
        assert_eq!(
            REFERENCED_CHUNK.place(0x15100, &r),
            Some((0x15080, 0x15480))
        );
    }

    #[test]
    fn chunk_is_cut_to_its_region() {
        let r = heap(0x10000, 0x1000);
        // Near the start: can't begin before the region.
        assert_eq!(
            REFERENCED_CHUNK.place(0x10010, &r),
            Some((0x10000, 0x10400))
        );
        // Near the end: stops at the region's end.
        assert_eq!(
            REFERENCED_CHUNK.place(0x10ff8, &r),
            Some((0x10f40, 0x11000))
        );
        // Outside the region.
        assert_eq!(REFERENCED_CHUNK.place(0x11000, &r), None);
        assert_eq!(REFERENCED_CHUNK.place(0xfff0, &r), None);
    }

    #[test]
    fn chunk_at_the_top_of_32_bit_and_full_address_spaces() {
        // Ends at 4 GiB, or at the last byte where that doesn't fit in a usize.
        let top_32 = heap(0xffff_0000, 0x1_0000);
        let top_32_end = 0xffff_0000usize.saturating_add(0x1_0000);
        assert_eq!(
            REFERENCED_CHUNK.place(0xffff_fff0, &top_32),
            Some((0xffff_ff40, top_32_end)),
        );
        let top = heap(usize::MAX - 0xfff, 0x1000);
        // The region's end saturates instead of overflowing.
        let (start, end) = REFERENCED_CHUNK.place(usize::MAX - 4, &top).unwrap();
        assert_eq!(end, usize::MAX);
        assert!(start <= usize::MAX - 4);
        let mut chunks = ChunkList::new();
        assert_eq!(
            chunks.add(usize::MAX - 4, &top, &REFERENCED_CHUNK, 10),
            Placement::Added,
        );
        assert!(chunks.covers(usize::MAX - 4, REFERENCED_CHUNK.span));
    }

    #[test]
    fn object_chunk_starts_at_the_object() {
        let r = heap(0x10000, 0x10000);
        assert_eq!(
            ChunkShape::object(0x1e8).place(0x12345, &r),
            Some((0x12345, 0x1252d))
        );
    }

    #[test]
    fn address_held_by_an_earlier_chunk_adds_nothing() {
        let r = heap(0x10000, 0x10000);
        let mut chunks = ChunkList::new();
        assert_eq!(
            chunks.add(0x12000, &r, &REFERENCED_CHUNK, 10),
            Placement::Added
        );
        assert_eq!(
            chunks.add(0x12010, &r, &REFERENCED_CHUNK, 10),
            Placement::Covered
        );
        // 0x80 bytes before 0x12000 are held too.
        assert_eq!(
            chunks.add(0x11f80, &r, &REFERENCED_CHUNK, 10),
            Placement::Covered
        );
        assert_eq!(chunks.as_slice(), &[(0x11f80, 0x12380)]);
    }

    #[test]
    fn overlapping_chunk_is_cut_to_what_is_new() {
        let r = heap(0x10000, 0x10000);
        let mut chunks = ChunkList::new();
        chunks.add(0x12000, &r, &REFERENCED_CHUNK, 10);
        // Its span runs past the first chunk's end: only the rest is added.
        assert_eq!(
            chunks.add(0x12300, &r, &REFERENCED_CHUNK, 10),
            Placement::Added
        );
        assert_eq!(chunks.as_slice(), &[(0x11f80, 0x12380), (0x12380, 0x12680)]);
        // A chunk ending inside a later one is cut at that one's start.
        assert_eq!(
            chunks.add(0x11c00, &r, &REFERENCED_CHUNK, 10),
            Placement::Added
        );
        assert_eq!(chunks.as_slice()[2], (0x11b80, 0x11f80));
        // An address between two chunks fills just the gap.
        let mut gap = ChunkList::new();
        gap.add(0x13000, &r, &REFERENCED_CHUNK, 10);
        gap.add(0x13500, &r, &REFERENCED_CHUNK, 10);
        assert_eq!(
            gap.add(0x13390, &r, &REFERENCED_CHUNK, 10),
            Placement::Added
        );
        assert_eq!(gap.as_slice()[2], (0x13380, 0x13480));
        assert_no_overlaps(&chunks);
        assert_no_overlaps(&gap);
    }

    #[test]
    fn span_held_across_several_chunks_adds_nothing() {
        let r = heap(0x10000, 0x10000);
        let mut chunks = ChunkList::new();
        chunks.add(0x12000, &r, &REFERENCED_CHUNK, 10);
        chunks.add(0x12300, &r, &REFERENCED_CHUNK, 10);
        assert_eq!(
            chunks.add(0x12340, &r, &REFERENCED_CHUNK, 10),
            Placement::Covered
        );
    }

    #[test]
    fn span_cut_by_the_region_counts_as_held() {
        let r = heap(0x10000, 0x1000);
        let mut chunks = ChunkList::new();
        chunks.add(0x10f00, &r, &REFERENCED_CHUNK, 10);
        // Its span would run past the region's end, which no chunk can hold.
        assert_eq!(
            chunks.add(0x10fc0, &r, &REFERENCED_CHUNK, 10),
            Placement::Covered
        );
    }

    #[test]
    fn list_stops_at_its_limit() {
        let r = heap(0x10000, 0x100000);
        let mut chunks = ChunkList::new();
        for i in 0..3 {
            assert_eq!(
                chunks.add(0x20000 + i * 0x1000, &r, &REFERENCED_CHUNK, 3),
                Placement::Added,
            );
        }
        assert_eq!(
            chunks.add(0x30000, &r, &REFERENCED_CHUNK, 3),
            Placement::Full
        );
        // Something already held still reports so.
        assert_eq!(
            chunks.add(0x20000, &r, &REFERENCED_CHUNK, 3),
            Placement::Covered
        );
        assert_eq!(chunks.len(), 3);
        assert_eq!(chunks.bytes(), 3 * 0x400);
    }

    #[test]
    fn list_never_grows_past_its_storage() {
        let r = heap(0x10000, 0x1000_0000);
        let mut chunks = ChunkList::new();
        for i in 0..MAX_CHUNKS + 10 {
            chunks.add(0x20000 + i * 0x1000, &r, &REFERENCED_CHUNK, usize::MAX);
        }
        assert_eq!(chunks.len(), MAX_CHUNKS);
    }

    fn assert_no_overlaps(chunks: &ChunkList) {
        let all = chunks.as_slice();
        for (i, &(a_start, a_end)) in all.iter().enumerate() {
            assert!(a_start < a_end, "{all:x?}");
            for &(b_start, b_end) in &all[i + 1..] {
                assert!(a_end <= b_start || b_end <= a_start, "{all:x?}");
            }
        }
    }

    const STACK: usize = 0x7000_0000;
    const DATA: usize = 0x4000_0000;
    const HEAP: usize = 0x1000_0000;

    fn standard_regions() -> Vec<Region> {
        vec![
            Region {
                allocation_base: STACK - 0x10_0000,
                ..heap(STACK, 0x4000)
            },
            region(DATA, 0x1000, MEM_IMAGE),
            heap(HEAP, 0x100_0000),
        ]
    }

    #[test]
    fn registers_into_heap_are_added_and_others_are_not() {
        let space = FakeSpace::new(standard_regions());
        let mut chunks = ChunkList::new();
        // Heap, image data, stack, a small integer, unmapped memory.
        let t = thread(
            &[HEAP + 0x5000, DATA + 0x10, STACK + 0x100, 5, 0x9000_0000],
            STACK,
        );
        collect(&space, Some(&t), &[], &mut chunks);
        assert_eq!(chunks.as_slice(), &[(HEAP + 0x4f80, HEAP + 0x5380)]);
    }

    #[test]
    fn register_pointing_at_a_pointer_table_adds_its_targets() {
        // A table of object pointers in image data, as a renderer keeps its textures.
        let space = FakeSpace::new(standard_regions()).with_values(
            DATA + 0x100,
            &[HEAP + 0x1000, 0, HEAP + 0x2000, 7, HEAP + 0x3000],
        );
        let mut chunks = ChunkList::new();
        let t = thread(&[DATA + 0x100], STACK);
        collect(&space, Some(&t), &[], &mut chunks);
        assert_eq!(
            chunks.as_slice(),
            &[
                (HEAP + 0xf80, HEAP + 0x1380),
                (HEAP + 0x1f80, HEAP + 0x2380),
                (HEAP + 0x2f80, HEAP + 0x3380),
            ],
        );
    }

    #[test]
    fn slots_read_at_a_register_stop_at_its_region() {
        // The register points at the last two slots of the data region.
        let space = FakeSpace::new(standard_regions())
            .with_values(DATA + 0x1000 - 2 * WORD, &[HEAP + 0x1000, HEAP + 0x2000]);
        let mut chunks = ChunkList::new();
        let t = thread(&[DATA + 0x1000 - 2 * WORD], STACK);
        collect(&space, Some(&t), &[], &mut chunks);
        assert_eq!(chunks.len(), 2);
    }

    #[test]
    fn stack_values_into_heap_are_added() {
        let space = FakeSpace::new(standard_regions())
            .with_values(STACK + 0x40, &[HEAP + 0x8000, STACK + 0x200, HEAP + 0x9000]);
        let mut chunks = ChunkList::new();
        collect(&space, Some(&thread(&[], STACK + 0x40)), &[], &mut chunks);
        assert_eq!(
            chunks.as_slice(),
            &[
                (HEAP + 0x7f80, HEAP + 0x8380),
                (HEAP + 0x8f80, HEAP + 0x9380)
            ],
        );
    }

    #[test]
    fn stack_scan_reads_only_its_first_slots() {
        let mut values = vec![0usize; STACK_SLOTS + 1];
        values[STACK_SLOTS - 1] = HEAP + 0x1000;
        values[STACK_SLOTS] = HEAP + 0x2000;
        let space = FakeSpace::new(standard_regions()).with_values(STACK, &values);
        let mut chunks = ChunkList::new();
        collect(&space, Some(&thread(&[], STACK)), &[], &mut chunks);
        assert_eq!(chunks.as_slice(), &[(HEAP + 0xf80, HEAP + 0x1380)]);
    }

    #[test]
    fn budget_goes_to_registers_then_their_slots_then_the_stack() {
        // Many distinct heap addresses on the stack, behind a register into heap and a register
        // into a pointer table.
        let stack_values: Vec<usize> = (0..STACK_SLOTS)
            .map(|i| HEAP + 0x10_0000 + i * 0x1000)
            .collect();
        let table: Vec<usize> = (0..SLOTS_PER_REGISTER)
            .map(|i| HEAP + 0x8_0000 + i * 0x1000)
            .collect();
        let space = FakeSpace::new(standard_regions())
            .with_values(STACK, &stack_values)
            .with_values(DATA + 0x200, &table);
        let mut chunks = ChunkList::new();
        let t = thread(&[DATA + 0x200, HEAP + 0x40_0000], STACK);
        collect(&space, Some(&t), &[], &mut chunks);
        assert_eq!(chunks.len(), MAX_REFERENCED_CHUNKS);
        let all = chunks.as_slice();
        // The register's own target first, then the table's targets, then the stack's in order.
        assert_eq!(all[0], (HEAP + 0x40_0000 - 0x80, HEAP + 0x40_0000 + 0x380));
        for (i, &(start, _)) in all[1..1 + SLOTS_PER_REGISTER].iter().enumerate() {
            assert_eq!(start, HEAP + 0x8_0000 + i * 0x1000 - 0x80);
        }
        let stack_chunks = MAX_REFERENCED_CHUNKS - 1 - SLOTS_PER_REGISTER;
        assert_eq!(
            all.last().unwrap().0,
            HEAP + 0x10_0000 + (stack_chunks - 1) * 0x1000 - 0x80,
        );
        assert_no_overlaps(&chunks);
    }

    #[test]
    fn tables_add_whole_objects_within_their_own_budget() {
        let units = [
            HEAP + 0x1000,
            0,
            HEAP + 0x2000,
            DATA + 0x10,
            3,
            HEAP + 0x1000,
        ];
        let space = FakeSpace::new(standard_regions()).with_values(DATA + 0x400, &units);
        let table = PointerTable {
            base: DATA + 0x400,
            count: units.len(),
            pointee_len: 0x1e8,
        };
        let mut chunks = ChunkList::new();
        // A register near the start of the first unit adds nothing, as the unit's chunk holds its
        // span. One near the unit's end adds the stretch after the unit that its span reaches.
        let t = thread(&[HEAP + 0x1010, HEAP + 0x1180], STACK);
        collect(&space, Some(&t), &[table], &mut chunks);
        assert_eq!(
            chunks.as_slice(),
            &[
                (HEAP + 0x1000, HEAP + 0x11e8),
                (HEAP + 0x2000, HEAP + 0x21e8),
                (HEAP + 0x11e8, HEAP + 0x1500),
            ],
        );
        assert_no_overlaps(&chunks);
    }

    #[test]
    fn table_objects_are_cut_to_the_largest_object_length() {
        let space = FakeSpace::new(standard_regions()).with_values(DATA, &[HEAP + 0x1000]);
        let table = PointerTable {
            base: DATA,
            count: 1,
            pointee_len: 0x100_0000,
        };
        let mut chunks = ChunkList::new();
        collect(&space, None, &[table], &mut chunks);
        assert_eq!(
            chunks.as_slice(),
            &[(HEAP + 0x1000, HEAP + 0x1000 + MAX_POINTEE_LEN)]
        );
    }

    #[test]
    fn table_budget_leaves_the_referenced_budget_whole() {
        let units: Vec<usize> = (0..MAX_TABLE_ENTRIES).map(|i| HEAP + i * 0x1000).collect();
        let more_units: Vec<usize> = (0..12).map(|i| HEAP + 0x40_0000 + i * 0x1000).collect();
        let stack_values: Vec<usize> = (0..STACK_SLOTS)
            .map(|i| HEAP + 0x80_0000 + i * 0x1000)
            .collect();
        let space = FakeSpace::new(standard_regions())
            .with_values(DATA, &units)
            .with_values(DATA + 0x800, &more_units)
            .with_values(STACK, &stack_values);
        let tables = [
            PointerTable {
                base: DATA,
                count: 1000,
                pointee_len: 0x100,
            },
            PointerTable {
                base: DATA + 0x800,
                count: more_units.len(),
                pointee_len: 0x100,
            },
        ];
        let mut chunks = ChunkList::new();
        collect(&space, Some(&thread(&[], STACK)), &tables, &mut chunks);
        assert_eq!(chunks.len(), MAX_CHUNKS);
        // The first table's entries take the whole table budget, leaving the second nothing, and
        // the stack gets all of its own.
        assert_eq!(
            chunks.as_slice()[MAX_TABLE_CHUNKS - 1],
            (HEAP + 63 * 0x1000, HEAP + 63 * 0x1000 + 0x100),
        );
        assert_eq!(
            chunks.as_slice()[MAX_TABLE_CHUNKS].0,
            HEAP + 0x80_0000 - 0x80
        );
    }

    #[test]
    fn unreadable_table_or_stack_adds_nothing() {
        let mut regions = standard_regions();
        regions.push(Region {
            protect: PAGE_NOACCESS,
            ..heap(0x5000_0000, 0x1000)
        });
        let space = FakeSpace::new(regions);
        let table = PointerTable {
            base: 0x5000_0000,
            count: 12,
            pointee_len: 0x1e8,
        };
        let mut chunks = ChunkList::new();
        collect(
            &space,
            Some(&thread(&[], 0x5000_0000)),
            &[table],
            &mut chunks,
        );
        collect(&space, Some(&thread(&[], 0x9000_0000)), &[], &mut chunks);
        assert_eq!(chunks.len(), 0);
    }

    #[test]
    fn registry_updates_a_table_registered_again_and_fills_up() {
        let registry = PointerTableRegistry::new();
        let mut out = [PointerTable::default(); MAX_POINTER_TABLES];
        assert_eq!(registry.snapshot(&mut out), 0);
        assert!(!registry.register(0, 12, 0x1e8));
        assert!(!registry.register(0x1000, 0, 0x1e8));
        assert!(registry.register(0x1000, 12, 0x1e8));
        assert!(registry.register(0x1000, 12, 0x150));
        assert_eq!(registry.snapshot(&mut out), 1);
        assert_eq!(
            out[0],
            PointerTable {
                base: 0x1000,
                count: 12,
                pointee_len: 0x150,
            },
        );
        for i in 1..MAX_POINTER_TABLES {
            assert!(registry.register(0x1000 + i * 0x100, 1, 1));
        }
        assert!(!registry.register(0x9000, 1, 1));
        assert_eq!(registry.snapshot(&mut out), MAX_POINTER_TABLES);
    }

    /// The whole scan against this process's own memory: heap objects a register and a pointer
    /// table point at are found and read.
    #[test]
    fn collects_from_this_process() {
        let object = Box::new([0x5au8; 0x40]);
        let target = Box::new([0xa5u8; 0x40]);
        let table = Box::new([&*target as *const [u8; 0x40] as usize, 0, 0, 0]);
        let mut chunks = ChunkList::new();
        let t = thread(
            &[&*object as *const _ as usize, table.as_ptr() as usize],
            &chunks as *const ChunkList as usize,
        );
        collect(&CurrentProcess, Some(&t), &[], &mut chunks);
        assert!(chunks.covers(&*object as *const _ as usize, 0x40));
        assert!(chunks.covers(&*target as *const _ as usize, 0x40));
        assert!(chunks.covers(table.as_ptr() as usize, 4 * WORD));
    }
}
