//! Copies of a thread's registers and the top of its stack, taken while the thread is briefly
//! suspended, and the walk of its call stack from such a copy once it runs again.
//!
//! Between suspending a thread and resuming it, nothing may allocate, log or take a lock: the
//! suspended thread may be holding the very lock that would need, and then neither thread can
//! continue. So the copy goes into a buffer allocated beforehand, using only system calls that take
//! no user-mode locks (`SuspendThread`, `GetThreadContext`, `ReadProcessMemory`, `ResumeThread`),
//! and everything else (unwinding, naming modules, logging) works from the copy afterwards. The
//! copy reads the stack with `ReadProcessMemory`, which fails rather than faulting where a thread
//! that is exiting has already given its stack back.

use std::mem;

use winapi::um::memoryapi::{ReadProcessMemory, VirtualQuery};
use winapi::um::processthreadsapi::{
    GetCurrentProcess, GetThreadContext, ResumeThread, SuspendThread,
};
use winapi::um::winnt::{
    CONTEXT, CONTEXT_CONTROL, CONTEXT_INTEGER, HANDLE, MEM_COMMIT, MEMORY_BASIC_INFORMATION,
    PAGE_EXECUTE_READ, PAGE_EXECUTE_READWRITE, PAGE_EXECUTE_WRITECOPY, PAGE_GUARD,
};

/// A `CONTEXT` aligned as `GetThreadContext` requires on x86_64, which winapi's definition leaves
/// out.
#[repr(C, align(16))]
struct AlignedContext(CONTEXT);

/// One thread's registers and the top of its stack.
pub struct StackCopy {
    context: Box<AlignedContext>,
    stack: Box<[usize]>,
    /// Words of `stack` holding the copy.
    words: usize,
    /// Where the copy starts on the thread's own stack: its stack pointer.
    stack_pointer: usize,
}

impl StackCopy {
    /// A copy with room for `bytes` of stack.
    pub fn new(bytes: usize) -> StackCopy {
        StackCopy {
            context: Box::new(unsafe { mem::zeroed() }),
            stack: vec![0usize; bytes / size_of::<usize>()].into_boxed_slice(),
            words: 0,
            stack_pointer: 0,
        }
    }

    /// Suspends `thread`, copies its registers and as much of its stack from the stack pointer up
    /// as fits (when the stack pointer lies in `stack_low..stack_high`, the thread's stack), and
    /// resumes it. Returns whether the registers were read; the stack copy may still be empty.
    ///
    /// `thread` needs `THREAD_SUSPEND_RESUME` and `THREAD_GET_CONTEXT` access, and must not be the
    /// calling thread.
    ///
    /// Allocates nothing and takes no lock, as the module documentation explains.
    pub unsafe fn capture(
        &mut self,
        thread: HANDLE,
        (stack_low, stack_high): (usize, usize),
    ) -> bool {
        self.words = 0;
        self.stack_pointer = 0;
        unsafe {
            if SuspendThread(thread) == u32::MAX {
                return false;
            }
            let context = &mut self.context.0;
            context.ContextFlags = CONTEXT_CONTROL | CONTEXT_INTEGER;
            let ok = GetThreadContext(thread, context) != 0;
            let sp = stack_pointer(context);
            if ok && sp >= stack_low && sp < stack_high {
                let bytes = (stack_high - sp).min(self.stack.len() * size_of::<usize>());
                let mut read = 0;
                // A partial copy still reports how much it read.
                ReadProcessMemory(
                    GetCurrentProcess(),
                    sp as *const _,
                    self.stack.as_mut_ptr() as *mut _,
                    bytes,
                    &mut read,
                );
                self.words = read / size_of::<usize>();
            }
            ResumeThread(thread);
            self.stack_pointer = sp;
            ok
        }
    }

    /// Walks the copied call stack, innermost first, calling `frame` with each frame's address (the
    /// instruction the thread was at, then each caller's return address) and the start of the
    /// function containing it (the address itself where that isn't known), for up to `max_frames`
    /// frames. Return addresses are only looked for in `code`.
    ///
    /// On x86_64 the walk follows the images' unwind data, and past a function that has none (a
    /// leaf function, or code generated at run time such as hook trampolines) it continues from
    /// the next stack word above that looks like a return address. On x86, which has no unwind
    /// data to follow, every stack word that looks like a return address is a frame, so stale ones
    /// from earlier calls are mixed in.
    ///
    /// The walk changes the copied registers, so a copy is walked once per capture.
    pub fn walk(
        &mut self,
        code: &CodeRanges,
        max_frames: usize,
        mut frame: impl FnMut(usize, usize),
    ) {
        if max_frames == 0 {
            return;
        }
        #[cfg(target_arch = "x86_64")]
        unsafe {
            unwind(
                &mut self.context.0,
                self.stack_pointer,
                &self.stack[..self.words],
                code,
                max_frames,
                &mut frame,
            );
        }
        #[cfg(target_arch = "x86")]
        {
            let pc = self.context.0.Eip as usize;
            frame(pc, pc);
            let mut found = 1;
            for &word in &self.stack[..self.words] {
                if found >= max_frames {
                    break;
                }
                if code.contains_return_address(word) && looks_like_return_address(word) {
                    frame(word, word);
                    found += 1;
                }
            }
        }
    }
}

type NtQueryInformationThreadFn =
    unsafe extern "system" fn(HANDLE, u32, *mut std::ffi::c_void, u32, *mut u32) -> i32;

/// `THREAD_BASIC_INFORMATION`.
#[repr(C)]
struct ThreadBasicInformation {
    exit_status: i32,
    teb: usize,
    client_id: [usize; 2],
    affinity_mask: usize,
    priority: i32,
    base_priority: i32,
}

/// Finds where other threads' stacks are, from their thread environment blocks.
pub struct StackBounds {
    nt_query_information_thread: NtQueryInformationThreadFn,
}

impl StackBounds {
    /// Looks up what finding stacks needs from ntdll. Best done ahead of time: looking up a
    /// function can wait on the loader's lock, which a stalled thread may hold.
    pub fn resolve() -> Option<StackBounds> {
        let ntdll = crate::windows::load_library("ntdll").ok()?;
        let function = ntdll.proc_address("NtQueryInformationThread").ok()?;
        Some(StackBounds {
            nt_query_information_thread: unsafe {
                mem::transmute::<winapi::shared::minwindef::FARPROC, NtQueryInformationThreadFn>(
                    function,
                )
            },
        })
    }

    /// The address range `thread`'s stack reserves, from the base of its allocation to the top the
    /// thread started from. `thread` needs `THREAD_QUERY_INFORMATION` access.
    pub fn of(&self, thread: HANDLE) -> Option<(usize, usize)> {
        const THREAD_BASIC_INFORMATION_CLASS: u32 = 0;
        unsafe {
            let mut info: ThreadBasicInformation = mem::zeroed();
            let status = (self.nt_query_information_thread)(
                thread,
                THREAD_BASIC_INFORMATION_CLASS,
                &mut info as *mut ThreadBasicInformation as *mut _,
                size_of::<ThreadBasicInformation>() as u32,
                std::ptr::null_mut(),
            );
            if status < 0 || info.teb == 0 {
                return None;
            }
            // NT_TIB, at the start of the TEB: exception list, then the stack's top.
            let mut stack_top = 0usize;
            let mut read = 0;
            let ok = ReadProcessMemory(
                GetCurrentProcess(),
                (info.teb + size_of::<usize>()) as *const _,
                &mut stack_top as *mut usize as *mut _,
                size_of::<usize>(),
                &mut read,
            );
            if ok == 0 || stack_top == 0 {
                return None;
            }
            let mut region: MEMORY_BASIC_INFORMATION = mem::zeroed();
            if VirtualQuery(
                (stack_top - 1) as *const _,
                &mut region,
                size_of_val(&region),
            ) == 0
            {
                return None;
            }
            Some((region.AllocationBase as usize, stack_top))
        }
    }
}

fn stack_pointer(context: &CONTEXT) -> usize {
    #[cfg(target_arch = "x86_64")]
    {
        context.Rsp as usize
    }
    #[cfg(target_arch = "x86")]
    {
        context.Esp as usize
    }
}

/// Sorted, non-overlapping address ranges of readable code that return addresses may point into.
pub struct CodeRanges(Vec<(usize, usize)>);

impl CodeRanges {
    pub fn from_ranges(mut ranges: Vec<(usize, usize)>) -> CodeRanges {
        ranges.sort_unstable();
        CodeRanges(ranges)
    }

    /// Every committed, readable and executable region of the address space: the code of each
    /// loaded image, and code generated at run time.
    pub fn executable_memory() -> CodeRanges {
        let mut ranges = Vec::new();
        let mut address = 0usize;
        loop {
            let mut info: MEMORY_BASIC_INFORMATION = unsafe { mem::zeroed() };
            let queried =
                unsafe { VirtualQuery(address as *const _, &mut info, size_of_val(&info)) };
            if queried == 0 {
                break;
            }
            let base = info.BaseAddress as usize;
            let readable_code = info.Protect
                & (PAGE_EXECUTE_READ | PAGE_EXECUTE_READWRITE | PAGE_EXECUTE_WRITECOPY)
                != 0
                && info.Protect & PAGE_GUARD == 0;
            if info.State == MEM_COMMIT && readable_code {
                ranges.push((base, base + info.RegionSize));
            }
            match base.checked_add(info.RegionSize) {
                Some(next) if next > address => address = next,
                _ => break,
            }
        }
        CodeRanges::from_ranges(ranges)
    }

    /// Whether `address` lies in one of the ranges with at least the 8 bytes before it, which
    /// [`looks_like_return_address`] reads, in the same range.
    fn contains_return_address(&self, address: usize) -> bool {
        let index = self.0.partition_point(|&(low, _)| low <= address);
        index
            .checked_sub(1)
            .and_then(|i| self.0.get(i))
            .is_some_and(|&(low, high)| address >= low.saturating_add(8) && address < high)
    }
}

/// Whether the instruction before `address` is a call, as it is for a return address. Reads the 7
/// bytes before `address`.
fn looks_like_return_address(address: usize) -> bool {
    unsafe {
        let before = |n: usize| ((address - n) as *const u8).read();
        // call rel32
        before(5) == 0xe8
            // call r/m: ff /2 with the register and memory forms of various lengths
            || (before(2) == 0xff && before(1) & 0x38 == 0x10)
            || (before(3) == 0xff && before(2) & 0x38 == 0x10)
            || (before(6) == 0xff && before(5) & 0x38 == 0x10)
            || (before(7) == 0xff && before(6) & 0x38 == 0x10)
    }
}

#[cfg(target_arch = "x86_64")]
#[repr(C)]
struct RuntimeFunction {
    begin: u32,
    end: u32,
    unwind: u32,
}

#[cfg(target_arch = "x86_64")]
unsafe extern "system" {
    fn RtlLookupFunctionEntry(
        pc: u64,
        image_base: *mut u64,
        history: *mut std::ffi::c_void,
    ) -> *mut RuntimeFunction;
    fn RtlVirtualUnwind(
        handler_type: u32,
        image_base: u64,
        pc: u64,
        function: *mut RuntimeFunction,
        context: *mut CONTEXT,
        handler_data: *mut *mut std::ffi::c_void,
        establisher_frame: *mut u64,
        context_pointers: *mut std::ffi::c_void,
    ) -> *mut std::ffi::c_void;
}

/// Walks a copied call stack with the images' unwind data (see [`StackCopy::walk`]). The walk
/// reads the copy of the stack taken while the thread was suspended: every register pointing into
/// the copied part of the stack is moved to point into the copy, before the first frame and again
/// after each one, since unwinding a frame restores registers that hold addresses on the original
/// stack. A frame is only unwound when everything its unwind data says unwinding it reads lies in
/// the copy, so the walk stops at the first frame that is not, or whose unwind data it does not
/// follow.
#[cfg(target_arch = "x86_64")]
unsafe fn unwind(
    context: &mut CONTEXT,
    sp: usize,
    stack: &[usize],
    code: &CodeRanges,
    max_frames: usize,
    frame: &mut impl FnMut(usize, usize),
) {
    unsafe {
        let copy = stack.as_ptr() as u64;
        let copied = size_of_val(stack) as u64;
        let original = sp as u64;
        let translate_all = |context: &mut CONTEXT| {
            for reg in [
                &mut context.Rsp,
                &mut context.Rbp,
                &mut context.Rbx,
                &mut context.Rsi,
                &mut context.Rdi,
                &mut context.R12,
                &mut context.R13,
                &mut context.R14,
                &mut context.R15,
            ] {
                if *reg >= original && *reg < original + copied {
                    *reg = *reg - original + copy;
                }
            }
        };
        translate_all(context);
        let end = copy + copied;
        let in_copy = |from: u64, bytes: u64| from >= copy && from.saturating_add(bytes) <= end;
        let mut found = 0;
        while found < max_frames {
            let pc = context.Rip;
            if pc == 0 {
                break;
            }
            let mut image_base = 0u64;
            let function = RtlLookupFunctionEntry(pc, &mut image_base, std::ptr::null_mut());
            let start = match function.is_null() {
                true => pc,
                false => image_base + (*function).begin as u64,
            };
            frame(pc as usize, start as usize);
            found += 1;
            if !in_copy(context.Rsp, 8) {
                break;
            }
            if function.is_null() {
                let mut slot = context.Rsp;
                loop {
                    if !in_copy(slot, 8) {
                        return;
                    }
                    let word = (slot as *const usize).read();
                    if code.contains_return_address(word) && looks_like_return_address(word) {
                        break;
                    }
                    slot += 8;
                }
                context.Rip = (slot as *const u64).read();
                context.Rsp = slot + 8;
            } else {
                let Some(reads) = frame_reads(image_base, function) else {
                    break;
                };
                if !in_copy(context.Rsp, reads.bytes) {
                    break;
                }
                if reads.frame_register != 0 {
                    let base =
                        register(context, reads.frame_register).wrapping_sub(reads.frame_offset);
                    if !in_copy(base, reads.bytes) {
                        break;
                    }
                }
                let mut handler_data = std::ptr::null_mut();
                let mut establisher = 0u64;
                RtlVirtualUnwind(
                    0,
                    image_base,
                    pc,
                    function,
                    context,
                    &mut handler_data,
                    &mut establisher,
                    std::ptr::null_mut(),
                );
                translate_all(context);
            }
        }
    }
}

/// What unwinding one frame reads of the stack, from its unwind data.
#[cfg(target_arch = "x86_64")]
struct FrameReads {
    /// Bytes up from the frame's base: its allocation, the registers pushed and saved, and the
    /// return address.
    bytes: u64,
    /// The register the function keeps its frame's base in, offset by `frame_offset`, or 0 for one
    /// that keeps it in the stack pointer.
    frame_register: u8,
    frame_offset: u64,
}

/// What unwinding `function`'s frame reads, from its unwind codes and those it chains to, or `None`
/// for unwind data this walk does not follow.
#[cfg(target_arch = "x86_64")]
unsafe fn frame_reads(image_base: u64, function: *const RuntimeFunction) -> Option<FrameReads> {
    const UNW_FLAG_CHAININFO: u8 = 0x4;
    const MAX_CHAINED: usize = 8;
    unsafe {
        let mut pushed = 8u64;
        let mut saved = 0u64;
        let mut frame_register = 0;
        let mut frame_offset = 0;
        let mut function = function;
        for chained in 0..MAX_CHAINED {
            let unwind = (*function).unwind;
            if unwind & 1 != 0 {
                return None;
            }
            let info = (image_base + u64::from(unwind)) as *const u8;
            let flags = info.read() >> 3;
            let count = usize::from(info.add(2).read());
            if chained == 0 {
                let frame = info.add(3).read();
                frame_register = frame & 0xf;
                frame_offset = u64::from(frame >> 4) * 16;
            }
            let codes = info.add(4) as *const u16;
            let slot = |i: usize| u64::from(codes.add(i).read_unaligned());
            let mut i = 0;
            while i < count {
                let code = slot(i);
                let op_info = code >> 12;
                let slots = match (code >> 8) & 0xf {
                    // UWOP_PUSH_NONVOL
                    0 => {
                        pushed += 8;
                        1
                    }
                    // UWOP_ALLOC_LARGE
                    1 if op_info == 0 => {
                        pushed += slot(i + 1) * 8;
                        2
                    }
                    1 => {
                        pushed += slot(i + 1) | slot(i + 2) << 16;
                        3
                    }
                    // UWOP_ALLOC_SMALL
                    2 => {
                        pushed += op_info * 8 + 8;
                        1
                    }
                    // UWOP_SET_FPREG
                    3 => 1,
                    // UWOP_SAVE_NONVOL, UWOP_SAVE_XMM128
                    4 => {
                        saved = saved.max(slot(i + 1) * 8 + 8);
                        2
                    }
                    8 => {
                        saved = saved.max(slot(i + 1) * 16 + 16);
                        2
                    }
                    // UWOP_SAVE_NONVOL_FAR, UWOP_SAVE_XMM128_FAR
                    5 => {
                        saved = saved.max((slot(i + 1) | slot(i + 2) << 16) + 8);
                        3
                    }
                    9 => {
                        saved = saved.max((slot(i + 1) | slot(i + 2) << 16) + 16);
                        3
                    }
                    // UWOP_PUSH_MACHFRAME
                    10 => {
                        pushed += 40 + op_info * 8;
                        1
                    }
                    _ => return None,
                };
                i += slots;
            }
            if flags & UNW_FLAG_CHAININFO == 0 {
                return Some(FrameReads {
                    bytes: pushed.max(saved),
                    frame_register,
                    frame_offset,
                });
            }
            function = codes.add((count + 1) & !1) as *const RuntimeFunction;
        }
        None
    }
}

/// The general purpose register an unwind code numbers `index`.
#[cfg(target_arch = "x86_64")]
fn register(context: &CONTEXT, index: u8) -> u64 {
    match index {
        0 => context.Rax,
        1 => context.Rcx,
        2 => context.Rdx,
        3 => context.Rbx,
        4 => context.Rsp,
        5 => context.Rbp,
        6 => context.Rsi,
        7 => context.Rdi,
        8 => context.R8,
        9 => context.R9,
        10 => context.R10,
        11 => context.R11,
        12 => context.R12,
        13 => context.R13,
        14 => context.R14,
        _ => context.R15,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    use std::sync::atomic::{AtomicBool, Ordering};
    use std::sync::{Arc, Barrier};

    #[test]
    fn return_addresses_need_room_before_them_in_one_range() {
        let code = CodeRanges::from_ranges(vec![(0x3000, 0x4000), (0x1000, 0x2000)]);
        assert!(code.contains_return_address(0x1008));
        assert!(code.contains_return_address(0x1fff));
        assert!(code.contains_return_address(0x3500));
        assert!(!code.contains_return_address(0x1007));
        assert!(!code.contains_return_address(0x2000));
        assert!(!code.contains_return_address(0x2500));
        assert!(!code.contains_return_address(0x500));
        assert!(!code.contains_return_address(0x4000));
    }

    #[test]
    fn executable_memory_holds_this_code() {
        let code = CodeRanges::executable_memory();
        let here = executable_memory_holds_this_code as *const () as usize;
        assert!(code.contains_return_address(here + 16));
    }

    #[inline(never)]
    fn park_until(stop: &AtomicBool, barrier: &Barrier) {
        barrier.wait();
        while !stop.load(Ordering::Acquire) {
            std::thread::sleep(std::time::Duration::from_millis(1));
        }
    }

    /// A thread waiting in `park_until` has, on its copied stack, the return address into
    /// `park_until` and that of `park_until` returning into the thread's closure.
    #[test]
    fn walk_finds_the_callers_of_a_waiting_thread() {
        use std::os::windows::io::AsRawHandle;
        use winapi::um::handleapi::DuplicateHandle;
        use winapi::um::winnt::DUPLICATE_SAME_ACCESS;

        let stop = Arc::new(AtomicBool::new(false));
        let barrier = Arc::new(Barrier::new(2));
        let thread = {
            let stop = stop.clone();
            let barrier = barrier.clone();
            std::thread::spawn(move || park_until(&stop, &barrier))
        };
        barrier.wait();
        std::thread::sleep(std::time::Duration::from_millis(20));
        let mut handle = std::ptr::null_mut();
        unsafe {
            DuplicateHandle(
                GetCurrentProcess(),
                thread.as_raw_handle() as HANDLE,
                GetCurrentProcess(),
                &mut handle,
                0,
                0,
                DUPLICATE_SAME_ACCESS,
            );
        }
        let bounds = StackBounds::resolve().unwrap().of(handle).unwrap();
        let mut copy = StackCopy::new(64 * 1024);
        let captured = unsafe { copy.capture(handle, bounds) };
        stop.store(true, Ordering::Release);
        thread.join().unwrap();
        unsafe { winapi::um::handleapi::CloseHandle(handle) };
        assert!(captured);
        let code = CodeRanges::executable_memory();
        let mut frames = Vec::new();
        copy.walk(&code, 64, |address, function| {
            frames.push((address, function))
        });
        assert!(frames.len() > 1, "{frames:x?}");
        let park = park_until as *const () as usize;
        assert!(
            frames
                .iter()
                .skip(1)
                .any(|&(address, _)| address > park && address < park + 0x400),
            "no return address into park_until {park:x} in {frames:x?}",
        );
    }
}
