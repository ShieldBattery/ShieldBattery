//! Crashes the game on purpose, in a debug build with `SB_FORCE_CRASH` set, to check what a crash
//! dump carries and how a crash is handled.
//!
//! `SB_FORCE_CRASH=<seconds>`: the given number of seconds after the game's first logic step, the
//! game's main thread allocates recognizable heap objects and then faults reading address 0x10
//! while holding pointers to them, so the dump shows whether the heap the crashing thread
//! referenced made it in:
//!
//! - a 0x40-byte object of `SB.REG.OBJECT...` repeated, held in rdi (edi on x86),
//! - a table of 4 pointers, held in rsi (edx on x86), each to a 0x40-byte object of
//!   `SB.NESTED.OBJ.#0` to `SB.NESTED.OBJ.#3` repeated, which only reading the table reaches,
//! - a 0x40-byte object of `SB.STACK.OBJECT.` repeated, referenced only from the stack.
//!
//! The objects' addresses are logged just before the fault.
//!
//! `SB_FORCE_CRASH=imports`: where the main thread would enter the exe, before game init, it
//! crashes the way the exe's startup code does when SC:R's exe packer leaves the exe's import
//! table unfinished (see `crash_dump::is_unfinished_import_table_crash`), on the first launch
//! attempt only, so the app's relaunch can be watched succeeding.
//! `SB_FORCE_CRASH=imports-every-attempt` crashes on every attempt, to watch the relaunch fail as
//! well.
//!
//! The crash waits for the main thread to start because `OnInject` runs inside the loader's
//! process initialization, where no frame below it leads to the unhandled exception filter: a
//! crash there ends the process without reaching this DLL's crash handling.

use std::sync::OnceLock;
use std::sync::atomic::{AtomicU64, AtomicUsize, Ordering};
use std::time::{Duration, Instant};

const ENV_VAR: &str = "SB_FORCE_CRASH";
const IMPORTS_FIRST_ATTEMPT: &str = "imports";
const IMPORTS_EVERY_ATTEMPT: &str = "imports-every-attempt";

/// The address the crash reads: in the never-mapped first page.
const FAULT_ADDRESS: usize = 0x10;

/// Milliseconds after the first step to crash at, `u64::MAX` when the crash is off.
static CRASH_AFTER_MS: AtomicU64 = AtomicU64::new(u64::MAX);
static FIRST_STEP: OnceLock<Instant> = OnceLock::new();

type MarkedObject = [u8; 0x40];
const TABLE_LEN: usize = 4;

/// Reads `SB_FORCE_CRASH`. Called at the end of `OnInject`, on the main thread.
pub fn init_from_env() {
    let Ok(value) = std::env::var(ENV_VAR) else {
        return;
    };
    let value = value.trim();
    if value == IMPORTS_FIRST_ATTEMPT || value == IMPORTS_EVERY_ATTEMPT {
        let attempt = crate::launch_attempt();
        if value == IMPORTS_FIRST_ATTEMPT && attempt > 1 {
            info!("{ENV_VAR}={value}: not crashing on launch attempt {attempt}");
            return;
        }
        if let Err(e) = arm_null_import_crash() {
            error!("{ENV_VAR}={value}: not crashing, {e}");
        }
        return;
    }
    let Ok(seconds) = value.parse::<f64>() else {
        warn!(
            "{ENV_VAR}={value} is neither a number of seconds, {IMPORTS_FIRST_ATTEMPT} nor \
             {IMPORTS_EVERY_ATTEMPT}, not crashing"
        );
        return;
    };
    let after = Duration::from_secs_f64(seconds.max(0.0));
    CRASH_AFTER_MS.store(after.as_millis() as u64, Ordering::Relaxed);
    info!("{ENV_VAR}: the game will crash {seconds} seconds after it starts");
}

/// Called at each game logic step, on the game's main thread; crashes once it is time.
pub fn on_step() {
    let after = CRASH_AFTER_MS.load(Ordering::Relaxed);
    if after == u64::MAX {
        return;
    }
    let first_step = FIRST_STEP.get_or_init(Instant::now);
    if first_step.elapsed() >= Duration::from_millis(after) {
        crash();
    }
}

fn marked_object(marker: &[u8; 16]) -> *mut MarkedObject {
    let mut object = Box::new([0u8; 0x40]);
    for chunk in object.chunks_exact_mut(marker.len()) {
        chunk.copy_from_slice(marker);
    }
    Box::into_raw(object)
}

#[inline(never)]
fn crash() -> ! {
    let register_object = marked_object(b"SB.REG.OBJECT...");
    let nested: [*mut MarkedObject; TABLE_LEN] = std::array::from_fn(|i| {
        let mut marker = *b"SB.NESTED.OBJ.#0";
        marker[15] += i as u8;
        marked_object(&marker)
    });
    let table = Box::into_raw(Box::new(nested));
    let stack_object = marked_object(b"SB.STACK.OBJECT.");
    // Keeps the pointer in this frame's stack memory, where the crash finds it.
    let stack_slots = [stack_object; 2];
    std::hint::black_box(&stack_slots);
    error!(
        "{ENV_VAR}: crashing with the register object at {register_object:p}, the pointer table \
         at {table:p} holding {nested:?}, and the stack object at {stack_object:p}"
    );
    fault(register_object, table)
}

/// Reads [`FAULT_ADDRESS`] with `object` and `table` in the registers the module documentation
/// names.
#[inline(never)]
fn fault(object: *mut MarkedObject, table: *mut [*mut MarkedObject; TABLE_LEN]) -> ! {
    unsafe {
        #[cfg(target_arch = "x86_64")]
        std::arch::asm!(
            "mov {address}, [{address}]",
            address = inout(reg) FAULT_ADDRESS => _,
            in("rdi") object,
            in("rsi") table,
            options(nostack, readonly),
        );
        #[cfg(target_arch = "x86")]
        std::arch::asm!(
            "mov {address}, [{address}]",
            address = inout(reg) FAULT_ADDRESS => _,
            in("edi") object,
            in("edx") table,
            options(nostack, readonly),
        );
    }
    unreachable!("reading {FAULT_ADDRESS:#x} didn't fault");
}

/// Bytes a [`NullImportCall`] takes in the exe's headers: the 6-byte `call [slot]`, padding to the
/// slot's alignment, and the pointer-sized slot.
const NULL_IMPORT_CALL_LEN: usize = 16;

/// Where [`arm_null_import_crash`] puts its call: the zero-filled end of the page holding the exe's
/// headers, past its section table, which nothing reads once the image is mapped.
struct NullImportCall {
    /// The `call [slot]` instruction.
    call: usize,
    /// The pointer it calls through, which stays null.
    slot: usize,
}

impl NullImportCall {
    /// Finds [`NULL_IMPORT_CALL_LEN`] zero bytes, aligned to as many, between the end of the exe's
    /// section table and the end of its first page. `None` if they aren't there.
    unsafe fn find() -> Option<NullImportCall> {
        use winapi::um::libloaderapi::GetModuleHandleW;
        use winapi::um::winnt::{
            IMAGE_DOS_HEADER, IMAGE_FILE_HEADER, IMAGE_NT_HEADERS, IMAGE_SECTION_HEADER,
        };
        unsafe {
            let base = GetModuleHandleW(std::ptr::null()) as usize;
            if base == 0 {
                return None;
            }
            let dos = base as *const IMAGE_DOS_HEADER;
            let nt = (base + (*dos).e_lfanew as usize) as *const IMAGE_NT_HEADERS;
            let section_table_end = nt as usize
                + 4
                + size_of::<IMAGE_FILE_HEADER>()
                + (*nt).FileHeader.SizeOfOptionalHeader as usize
                + (*nt).FileHeader.NumberOfSections as usize * size_of::<IMAGE_SECTION_HEADER>();
            let page_end = base + 0x1000;
            let first = section_table_end.next_multiple_of(NULL_IMPORT_CALL_LEN);
            (first..page_end)
                .step_by(NULL_IMPORT_CALL_LEN)
                .take_while(|&start| start + NULL_IMPORT_CALL_LEN <= page_end)
                .find(|&start| {
                    std::slice::from_raw_parts(start as *const u8, NULL_IMPORT_CALL_LEN)
                        .iter()
                        .all(|&byte| byte == 0)
                })
                .map(|start| NullImportCall {
                    call: start,
                    slot: start + NULL_IMPORT_CALL_LEN - size_of::<usize>(),
                })
        }
    }

    /// The `call [slot]` instruction's bytes.
    fn instruction(&self) -> [u8; 6] {
        // x86-64 addresses the slot relative to the next instruction, x86 absolutely.
        #[cfg(target_arch = "x86_64")]
        let operand = (self.slot - (self.call + 6)) as u32;
        #[cfg(target_arch = "x86")]
        let operand = self.slot as u32;
        let [a, b, c, d] = operand.to_le_bytes();
        [0xff, 0x15, a, b, c, d]
    }
}

/// The armed [`NullImportCall`]'s call instruction, 0 when none is armed.
static NULL_IMPORT_CALL: AtomicUsize = AtomicUsize::new(0);

/// Sets up the main thread to crash as the exe's own startup code does when it calls an import the
/// exe packer never resolved: writes a `call [slot]` whose slot is null into spare space of the
/// exe image (see [`NullImportCall`]), and has the main thread start at [`call_null_import`],
/// which runs it, in place of the exe's entry point.
fn arm_null_import_crash() -> Result<(), String> {
    use winapi::um::libloaderapi::GetModuleHandleW;
    use winapi::um::winnt::{IMAGE_DOS_HEADER, IMAGE_NT_HEADERS};
    unsafe {
        let null_call =
            NullImportCall::find().ok_or("no spare space in the exe's headers for a call")?;
        let base = GetModuleHandleW(std::ptr::null()) as usize;
        let dos = base as *const IMAGE_DOS_HEADER;
        let nt = (base + (*dos).e_lfanew as usize) as *const IMAGE_NT_HEADERS;
        let entry = base + (*nt).OptionalHeader.AddressOfEntryPoint as usize;
        let start = main_thread_start_address(entry)?;
        write_code(null_call.call, &null_call.instruction())?;
        NULL_IMPORT_CALL.store(null_call.call, Ordering::Relaxed);
        *start = call_null_import as *const () as usize;
        info!(
            "{ENV_VAR}: the main thread will start by calling through the null pointer at {:x} \
             from {:x}, in the exe's headers, instead of the exe's entry point at {entry:x}",
            null_call.slot, null_call.call,
        );
        Ok(())
    }
}

/// Where the start address the main thread will run once the loader's process initialization is
/// done is stored, which must currently be `entry`. Called during that initialization, on the main
/// thread.
///
/// The exe's code is rewritten as the game starts up, so a patch at the entry point itself doesn't
/// survive until the main thread gets there. Instead this finds the thread context the loader
/// resumes the main thread with, which sits higher up the main thread's stack: its instruction
/// pointer is `RtlUserThreadStart`, which takes the start address in rcx (eax on x86).
unsafe fn main_thread_start_address(entry: usize) -> Result<&'static mut usize, String> {
    use winapi::um::winnt::CONTEXT;
    unsafe extern "system" {
        fn GetCurrentThreadStackLimits(low: *mut usize, high: *mut usize);
    }
    unsafe {
        let ntdll = crate::windows::load_library("ntdll").map_err(|e| e.to_string())?;
        let thread_start = ntdll
            .proc_address("RtlUserThreadStart")
            .map_err(|e| e.to_string())? as usize;
        let (mut low, mut high) = (0, 0);
        GetCurrentThreadStackLimits(&mut low, &mut high);
        let marker = 0usize;
        let here = &raw const marker as usize;
        // x64 keeps a CONTEXT 16-byte aligned.
        let align = if cfg!(target_arch = "x86_64") { 16 } else { 4 };
        let first = here.next_multiple_of(align).max(low);
        let found = (first..high.saturating_sub(size_of::<CONTEXT>()))
            .step_by(align)
            .map(|address| address as *mut CONTEXT)
            .find_map(|context| {
                #[cfg(target_arch = "x86_64")]
                let (ip, start) = ((*context).Rip as usize, &raw mut (*context).Rcx);
                #[cfg(target_arch = "x86")]
                let (ip, start) = ((*context).Eip as usize, &raw mut (*context).Eax);
                (ip == thread_start && *start as usize == entry).then_some(start)
            });
        match found {
            Some(start) => Ok(&mut *(start as *mut usize)),
            None => Err(format!(
                "no thread context starting the exe's entry point at {entry:x} on the stack"
            )),
        }
    }
}

/// Copies `code` to `address` in the exe image, leaving its page executable and writable.
unsafe fn write_code(address: usize, code: &[u8]) -> Result<(), String> {
    use winapi::um::memoryapi::VirtualProtect;
    use winapi::um::processthreadsapi::{FlushInstructionCache, GetCurrentProcess};
    use winapi::um::winnt::PAGE_EXECUTE_READWRITE;
    unsafe {
        let mut old_protect = 0;
        let protected = VirtualProtect(
            address as *mut _,
            code.len(),
            PAGE_EXECUTE_READWRITE,
            &mut old_protect,
        );
        if protected == 0 {
            return Err(format!(
                "couldn't make {address:x} writable: {}",
                std::io::Error::last_os_error()
            ));
        }
        std::ptr::copy_nonoverlapping(code.as_ptr(), address as *mut u8, code.len());
        FlushInstructionCache(GetCurrentProcess(), address as *const _, code.len());
        Ok(())
    }
}

/// Runs in place of the exe's entry point, as the main thread's start routine: calls the armed
/// [`NullImportCall`], which faults executing address 0 with its return address, inside the exe,
/// on top of the stack.
extern "system" fn call_null_import(_peb: *mut libc::c_void) -> ! {
    let call = NULL_IMPORT_CALL.load(Ordering::Relaxed);
    error!(
        "{ENV_VAR}: thread {:x} calling through a null pointer from {call:x}",
        unsafe { winapi::um::processthreadsapi::GetCurrentThreadId() },
    );
    unsafe {
        std::arch::asm!(
            "call {call}",
            call = in(reg) call,
            options(noreturn),
        );
    }
}
