//! Crashes the game on purpose, in a debug build with `SB_FORCE_CRASH=<seconds>` set, to check what
//! a crash dump carries.
//!
//! The given number of seconds after the game's first logic step, the game's main thread
//! allocates recognizable heap objects and then faults reading address 0x10 while holding pointers
//! to them, so the dump shows whether the heap the crashing thread referenced made it in:
//!
//! - a 0x40-byte object of `SB.REG.OBJECT...` repeated, held in rdi (edi on x86),
//! - a table of 4 pointers, held in rsi (edx on x86), each to a 0x40-byte object of
//!   `SB.NESTED.OBJ.#0` to `SB.NESTED.OBJ.#3` repeated, which only reading the table reaches,
//! - a 0x40-byte object of `SB.STACK.OBJECT.` repeated, referenced only from the stack.
//!
//! The objects' addresses are logged just before the fault.

use std::sync::OnceLock;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{Duration, Instant};

const ENV_VAR: &str = "SB_FORCE_CRASH";

/// The address the crash reads: in the never-mapped first page.
const FAULT_ADDRESS: usize = 0x10;

/// Milliseconds after the first step to crash at, `u64::MAX` when the crash is off.
static CRASH_AFTER_MS: AtomicU64 = AtomicU64::new(u64::MAX);
static FIRST_STEP: OnceLock<Instant> = OnceLock::new();

type MarkedObject = [u8; 0x40];
const TABLE_LEN: usize = 4;

pub fn init_from_env() {
    let Ok(value) = std::env::var(ENV_VAR) else {
        return;
    };
    let Ok(seconds) = value.trim().parse::<f64>() else {
        warn!("{ENV_VAR}={value} isn't a number of seconds, not crashing");
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
