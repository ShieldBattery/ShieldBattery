//! A macro that handles hooking an exported function that may have already
//! been hooked in a way that GetProcAddress doesn't return the expected dll.

use std::io;

use libc::c_void;

use crate::windows;

#[cfg(target_arch = "x86")]
macro_rules! system_hooks {
    ($(!0 => $name:ident($($args:tt)*) $(-> $ret:ty)?;)*) => {
        whack_hooks!(stdcall, 0,
            $(!0 => $name($($args)*) $(-> $ret)?;)*
        );
    };
}

#[cfg(target_arch = "x86_64")]
macro_rules! system_hooks {
    ($(!0 => $name:ident($($args:tt)*) $(-> $ret:ty)?;)*) => {
        whack_hooks!(0,
            $(!0 => $name($($args)*) $(-> $ret)?;)*
        );
    };
}

// stdcall, with first argument in ecx.
#[cfg(target_arch = "x86")]
macro_rules! thiscall_hooks {
    ($(!0 => $name:ident($($args:tt)*) $(-> $ret:ty)?;)*) => {
        whack_hooks!(stdcall, 0,
            $(!0 => $name(@ecx $($args)*) $(-> $ret)?;)*
        );
    };
}

// Just standard win64 calling convention.
#[cfg(target_arch = "x86_64")]
macro_rules! thiscall_hooks {
    ($(!0 => $name:ident($($args:tt)*) $(-> $ret:ty)?;)*) => {
        whack_hooks!(0,
            $(!0 => $name($($args)*) $(-> $ret)?;)*
        );
    };
}

// It would be preferrable to refactor this macro away to some sort of an api like
// ```
//    let mut hook = WinapiDllHook::new(&mut patcher, "user32");
//    hook.hook(ShowWindow, "ShowWindow", show_window_hook); // Does normal hook here, or buffers
//                                                           // an unusal hook for later.
//    ...
//    hook.commit(); // Does unusual_hooks here, if any
// ```
// instead, but this was copy-pasted from older code that did it this way so this'll do for now.

macro_rules! hook_winapi_exports {
    ($active:expr_2021, $expected_name:expr_2021, $($name:expr_2021, $hook:ident, $func:ident;)*) => {{
        let lib = crate::windows::load_library($expected_name).unwrap();
        let mut default_patcher = $active.patch_library($expected_name, 0);
        const fn zero(_name: &'static str) -> usize {
            0
        }
        const fn no_entry(_name: &'static str) -> crate::hook_macro::HookedEntry {
            crate::hook_macro::HookedEntry::NONE
        }
        let mut unusual_hooks = [$(zero($name)),*];
        let mut hooked_entries = [$(no_entry($name)),*];
        let mut i = 0;
        $(
            let proc_address = crate::hook_macro::hook_proc_address(&lib, $name);
            if let Ok(proc_address) = proc_address {
                let actual_module =
                    crate::windows::module_from_address(proc_address as *mut c_void);
                let normal = actual_module.as_ref()
                    .map(|x| x.1 == lib.handle())
                    .unwrap_or(false);
                if normal {
                    let addr = proc_address - lib.handle() as usize;
                    hooked_entries[i] = crate::hook_macro::HookedEntry::capture(proc_address);
                    default_patcher.hook_closure_address($hook, $func, addr);
                } else {
                    unusual_hooks[i] = proc_address;
                }
            } else {
                error!("Didn't find {}", $name);
            }
            #[allow(unused_assignments)] { i += 1; }
        )*
        drop(default_patcher);
        i = 0;
        $(
            if unusual_hooks[i] != 0 {
                let proc_address = unusual_hooks[i];
                let (mut patcher, offset, _guard) =
                    crate::hook_macro::unprotect_memory_for_hook($active, proc_address);
                hooked_entries[i] = crate::hook_macro::HookedEntry::capture(proc_address);
                patcher.hook_closure_address($hook, $func, offset);
            }
            #[allow(unused_assignments)] { i += 1; }
        )*
        crate::hook_macro::shorten_hook_entry_jumps(&hooked_entries);
    }}
}

/// Bytes whack overwrites when hooking a function entry.
#[cfg(target_arch = "x86_64")]
const WHACK_ENTRY_PATCH_LEN: usize = 14;
#[cfg(target_arch = "x86")]
const WHACK_ENTRY_PATCH_LEN: usize = 6;

/// Bytes of a `jmp rel32`, the shortest jump that can reach an arbitrary address.
const SHORT_JUMP_LEN: usize = 5;

/// A function entry as it was before whack hooked it.
///
/// Other programs injected into the process (sandboxes, overlays, input software) hook the same
/// winapi entries, by overwriting the first bytes with a jump and keeping the instructions they
/// displaced in a trampoline which resumes execution at `entry + displaced_len`. Hooking such an
/// entry afterwards must not write past that resume point, or the other program's trampoline
/// returns into the middle of our jump. whack's entry patch is longer than the jumps those
/// programs use, so the bytes it does not need are captured here and put back once it has
/// hooked. See `shorten_hook_entry_jumps`.
#[derive(Copy, Clone)]
pub struct HookedEntry {
    /// Address of the hooked function entry, or 0 when nothing was hooked.
    address: usize,
    original: [u8; WHACK_ENTRY_PATCH_LEN],
}

impl HookedEntry {
    pub const NONE: HookedEntry = HookedEntry {
        address: 0,
        original: [0; WHACK_ENTRY_PATCH_LEN],
    };

    /// Records the entry bytes at `address`. Must be called before the function is hooked.
    pub unsafe fn capture(address: usize) -> HookedEntry {
        unsafe {
            let mut original = [0u8; WHACK_ENTRY_PATCH_LEN];
            std::ptr::copy_nonoverlapping(
                address as *const u8,
                original.as_mut_ptr(),
                WHACK_ENTRY_PATCH_LEN,
            );
            HookedEntry { address, original }
        }
    }
}

/// Reads the hook wrapper address out of the entry patch whack wrote at `address`.
///
/// Returns `None` if the entry does not hold the expected patch, which means something other
/// than the hook that was just applied is there and it must be left alone.
#[cfg(target_arch = "x86_64")]
unsafe fn whack_patch_destination(address: *const u8) -> Option<*const u8> {
    unsafe {
        // `jmp [rip + 0]`, followed by the destination address.
        if *address != 0xff || *address.add(1) != 0x25 {
            return None;
        }
        if (address.add(2) as *const u32).read_unaligned() != 0 {
            return None;
        }
        Some((address.add(6) as *const *const u8).read_unaligned())
    }
}

#[cfg(target_arch = "x86")]
unsafe fn whack_patch_destination(address: *const u8) -> Option<*const u8> {
    unsafe {
        // `jmp [addr]`, where `addr` points to a slot holding the destination.
        if *address != 0xff || *address.add(1) != 0x25 {
            return None;
        }
        let slot = (address.add(2) as *const u32).read_unaligned() as usize;
        Some((slot as *const *const u8).read_unaligned())
    }
}

/// Rewrites the entry patches whack applied into `jmp rel32`, restoring the bytes past it.
///
/// This leaves the same hook in place, reaching the same wrapper, while touching as few bytes of
/// the function entry as a jump possibly can. Entries that hold something other than the expected
/// patch are left as they are.
pub fn shorten_hook_entry_jumps(entries: &[HookedEntry]) {
    for entry in entries.iter().filter(|x| x.address != 0) {
        if let Err(e) = unsafe { shorten_entry_jump(entry) } {
            // The long jump whack wrote works on its own, so this is only a loss of the
            // headroom that lets other programs' hooks on the same entry keep working.
            warn!("Couldn't shorten hook jump at {:x}: {}", entry.address, e);
        }
    }
}

unsafe fn shorten_entry_jump(entry: &HookedEntry) -> Result<(), &'static str> {
    unsafe {
        let address = entry.address as *mut u8;
        let destination =
            whack_patch_destination(address).ok_or("Entry doesn't hold the expected patch")?;
        let relative = (destination as isize)
            .wrapping_sub(address as isize)
            .wrapping_sub(SHORT_JUMP_LEN as isize);
        let relative = i32::try_from(relative).map_err(|_| "Wrapper is out of jump range")?;

        let mut jump = [0u8; SHORT_JUMP_LEN];
        jump[0] = 0xe9;
        jump[1..].copy_from_slice(&relative.to_le_bytes());

        let _guard =
            crate::windows::unprotect_memory(address as *mut c_void, WHACK_ENTRY_PATCH_LEN)
                .map_err(|_| "Couldn't unprotect memory")?;
        // Write the jump before restoring the bytes past it. Restoring first would leave whack's
        // jump reading a half-restored destination, while this order keeps the entry a jump to
        // the wrapper the entire time.
        std::ptr::copy_nonoverlapping(jump.as_ptr(), address, SHORT_JUMP_LEN);
        std::ptr::copy_nonoverlapping(
            entry.original.as_ptr().add(SHORT_JUMP_LEN),
            address.add(SHORT_JUMP_LEN),
            WHACK_ENTRY_PATCH_LEN - SHORT_JUMP_LEN,
        );
        flush_instruction_cache(address, WHACK_ENTRY_PATCH_LEN);
        Ok(())
    }
}

unsafe fn flush_instruction_cache(address: *const u8, length: usize) {
    use winapi::um::processthreadsapi::{FlushInstructionCache, GetCurrentProcess};
    unsafe {
        FlushInstructionCache(GetCurrentProcess(), address as *const _, length);
    }
}

/// Helper for hook_winapi_exports! macro.
pub unsafe fn unprotect_memory_for_hook(
    active_patcher: &mut whack::Patcher,
    proc_address: usize,
) -> (
    whack::ModulePatcher<'_>,
    usize,
    Option<windows::MemoryProtectionGuard>,
) {
    unsafe {
        // Windows has always 4k pages
        let start = proc_address & !0xfff;
        let end = ((proc_address + 0x10) | 0xfff) + 1;
        let len = end - start;
        // If the unprotection for some reason fails, just keep going and hope the memory
        // can be written.
        let start = start as *mut c_void;
        debug!(
            "Unprotecting memory for hook {:x} @ {:x}~{:x}",
            proc_address, start as usize, len
        );
        let guard = windows::unprotect_memory(start, len).ok();
        let patcher = active_patcher.patch_memory(start, start, !0);
        (patcher, proc_address - start as usize, guard)
    }
}

/// Determines address for hooking the function.
///
/// In addition to just GetProcAddress this follows any unconditional jumps at the
/// address returned by GetProcAddress, in order to avoid placing a second hook
/// at a address which was already hooked by some system DLL (Nvidia driver).
/// This should end up being more stable than otherwise.
pub unsafe fn hook_proc_address(lib: &windows::Library, proc: &str) -> Result<usize, io::Error> {
    unsafe {
        let mut address = lib.proc_address(proc)? as *const u8;
        loop {
            match *address {
                // Long jump
                0xe9 => {
                    let offset = (address.add(1) as *const i32).read_unaligned() as isize as usize;
                    address = address.wrapping_add(5).wrapping_add(offset);
                }
                // Short jump
                0xeb => {
                    let offset = *address.add(1) as i8 as isize as usize;
                    address = address.wrapping_add(2).wrapping_add(offset);
                }
                _ => return Ok(address as usize),
            }
        }
    }
}

/// Verifies that hooking a function another program has already hooked keeps that hook working.
///
/// The other program is simulated here, since the point is to have the entry already patched with
/// a jump shorter than whack's when whack hooks it.
#[cfg(test)]
mod test {
    use std::mem;
    use std::ptr;
    use std::sync::atomic::{AtomicUsize, Ordering};

    use libc::c_void;
    use winapi::um::memoryapi::VirtualAlloc;
    use winapi::um::winnt::{MEM_COMMIT, MEM_RESERVE, PAGE_EXECUTE_READWRITE};

    use super::{HookedEntry, SHORT_JUMP_LEN, shorten_hook_entry_jumps};

    whack_hooks!(0,
        0 => BinaryFunc(u32, u32) -> u32;
    );

    /// `|a, b| a * 2 + b`, padded so that instruction boundaries fall both where the simulated
    /// hook's jump ends and where whack's instruction copy ends.
    #[cfg(target_arch = "x86_64")]
    const TARGET_CODE: &[u8] = &[
        0x89, 0xc8, // mov eax, ecx
        0x01, 0xc0, // add eax, eax
        0x01, 0xd0, // add eax, edx
        0x90, 0x90, 0x90, 0x90, 0x90, 0x90, // nops, up to the 12 byte boundary
        0x90, 0x90, // nops the simulated hook's trampoline resumes into
        0xc3, // ret
    ];

    #[cfg(target_arch = "x86")]
    const TARGET_CODE: &[u8] = &[
        0x8b, 0x44, 0x24, 0x04, // mov eax, [esp + 4]
        0x40, // inc eax, ending at the 5 byte boundary
        0x48, // dec eax, the byte the trampoline resumes into
        0x01, 0xc0, // add eax, eax
        0x03, 0x44, 0x24, 0x08, // add eax, [esp + 8]
        0xc3, // ret
    ];

    /// Bytes the simulated hook displaces, matching the jumps such programs use on each arch.
    #[cfg(target_arch = "x86_64")]
    const OTHER_HOOK_LEN: usize = 12;
    #[cfg(target_arch = "x86")]
    const OTHER_HOOK_LEN: usize = 5;

    static OTHER_HOOK_ORIG: AtomicUsize = AtomicUsize::new(0);

    unsafe extern "C" fn other_hook_handler(a: u32, b: u32) -> u32 {
        unsafe {
            let orig: unsafe extern "C" fn(u32, u32) -> u32 =
                mem::transmute(OTHER_HOOK_ORIG.load(Ordering::Relaxed));
            orig(a, b) + 1000
        }
    }

    fn alloc_exec(size: usize) -> *mut u8 {
        unsafe {
            let out = VirtualAlloc(
                ptr::null_mut(),
                size,
                MEM_RESERVE | MEM_COMMIT,
                PAGE_EXECUTE_READWRITE,
            ) as *mut u8;
            assert!(!out.is_null());
            out
        }
    }

    /// Patches `target` the way another program's hook would, and returns the trampoline that
    /// calls the unhooked function.
    unsafe fn install_other_hook(target: *mut u8) -> unsafe extern "C" fn(u32, u32) -> u32 {
        unsafe {
            let trampoline = alloc_exec(0x100);
            ptr::copy_nonoverlapping(target, trampoline, OTHER_HOOK_LEN);
            let resume = target.add(OTHER_HOOK_LEN);
            write_trampoline_return(trampoline.add(OTHER_HOOK_LEN), resume);

            let handler = other_hook_handler as *const () as *const u8;
            #[cfg(target_arch = "x86_64")]
            {
                // mov rax, handler; jmp rax
                target.copy_from_nonoverlapping([0x48, 0xb8].as_ptr(), 2);
                (target.add(2) as *mut usize).write_unaligned(handler as usize);
                target
                    .add(10)
                    .copy_from_nonoverlapping([0xff, 0xe0].as_ptr(), 2);
            }
            #[cfg(target_arch = "x86")]
            write_jump(target, handler);

            mem::transmute::<*mut u8, unsafe extern "C" fn(u32, u32) -> u32>(trampoline)
        }
    }

    /// Writes a jump from `at` to `to` that reaches however far apart the two allocations landed.
    ///
    /// The trampoline and the function it returns into are separate allocations at addresses
    /// chosen by the system, so on 64-bit nothing bounds the distance between them.
    unsafe fn write_trampoline_return(at: *mut u8, to: *const u8) {
        unsafe {
            #[cfg(target_arch = "x86_64")]
            {
                // jmp [rip + 0], followed by the address to return to.
                at.copy_from_nonoverlapping([0xff, 0x25, 0x00, 0x00, 0x00, 0x00].as_ptr(), 6);
                (at.add(6) as *mut *const u8).write_unaligned(to);
            }
            #[cfg(target_arch = "x86")]
            write_jump(at, to);
        }
    }

    /// Writes a `jmp rel32` from `at` to `to`, which any two addresses are in range of on 32-bit.
    #[cfg(target_arch = "x86")]
    unsafe fn write_jump(at: *mut u8, to: *const u8) {
        unsafe {
            let relative = (to as isize)
                .wrapping_sub(at as isize)
                .wrapping_sub(SHORT_JUMP_LEN as isize);
            *at = 0xe9;
            (at.add(1) as *mut i32).write_unaligned(relative as i32);
        }
    }

    /// Puts back the bytes captured before hooking, so that a hook placed on a function the rest
    /// of the process shares does not outlive the test that placed it.
    unsafe fn restore_entry(entry: &HookedEntry) {
        unsafe {
            let address = entry.address as *mut u8;
            let _guard =
                crate::windows::unprotect_memory(address as *mut c_void, entry.original.len())
                    .unwrap();
            ptr::copy_nonoverlapping(entry.original.as_ptr(), address, entry.original.len());
            super::flush_instruction_cache(address, entry.original.len());
        }
    }

    unsafe fn load_target() -> (*mut u8, unsafe extern "C" fn(u32, u32) -> u32) {
        unsafe {
            let target = alloc_exec(0x1000);
            ptr::copy_nonoverlapping(TARGET_CODE.as_ptr(), target, TARGET_CODE.len());
            (target, mem::transmute::<*mut u8, _>(target))
        }
    }

    #[test]
    fn other_hook_keeps_working() {
        unsafe {
            let (target, func) = load_target();
            assert_eq!(func(5, 3), 13);

            // The other program gets there first, as one injected earlier into the process has.
            OTHER_HOOK_ORIG.store(install_other_hook(target) as usize, Ordering::Relaxed);
            assert_eq!(func(5, 3), 1013);

            let entry = HookedEntry::capture(target as usize);
            let mut patcher = whack::Patcher::new();
            {
                let mut patch =
                    patcher.patch_memory(target as *mut _, target as *mut _, target as usize);
                patch.hook_closure_address(
                    BinaryFunc,
                    |a, b, orig: unsafe extern "C" fn(_, _) -> _| orig(a, b) + 100,
                    0,
                );
            }
            shorten_hook_entry_jumps(&[entry]);

            // Our hook, the other program's hook it chains into, and the original code the other
            // program's trampoline resumes into, all in order.
            assert_eq!(func(5, 3), 1113);
            assert_eq!(func(10, 1), 1121);
        }
    }

    #[test]
    fn entry_bytes_past_jump_are_left_alone() {
        unsafe {
            let (target, _) = load_target();

            let entry = HookedEntry::capture(target as usize);
            let mut patcher = whack::Patcher::new();
            {
                let mut patch =
                    patcher.patch_memory(target as *mut _, target as *mut _, target as usize);
                patch.hook_closure_address(
                    BinaryFunc,
                    |a, b, orig: unsafe extern "C" fn(_, _) -> _| orig(a, b),
                    0,
                );
            }
            shorten_hook_entry_jumps(&[entry]);

            let tail = std::slice::from_raw_parts(
                target.add(SHORT_JUMP_LEN),
                TARGET_CODE.len() - SHORT_JUMP_LEN,
            );
            assert_eq!(tail, &TARGET_CODE[SHORT_JUMP_LEN..]);
        }
    }
    system_hooks!(
        !0 => IsBadStringPtrW(*const u16, usize) -> u32;
    );

    /// Hooks an actual dll export, where the entry has whatever prologue and alignment the
    /// system happens to give it, rather than the hand-written one the other tests use.
    #[test]
    fn real_export_stays_callable() {
        unsafe {
            let lib = crate::windows::load_library("kernel32").unwrap();
            let address = super::hook_proc_address(&lib, "IsBadStringPtrW").unwrap();
            let func: unsafe extern "system" fn(*const u16, usize) -> u32 = mem::transmute(address);
            let text: Vec<u16> = "asdf\0".encode_utf16().collect();
            assert_eq!(func(text.as_ptr(), 9999), 0);

            let entry = HookedEntry::capture(address);
            let mut patcher = whack::Patcher::new();
            let hook = |_a: *const u16, b: usize, _orig: unsafe extern "C" fn(_, _) -> _| b as u32;
            hook_winapi_exports!(&mut patcher, "kernel32",
                "IsBadStringPtrW", IsBadStringPtrW, hook;
            );

            assert_eq!(
                *(address as *const u8),
                0xe9,
                "Entry should hold a short jump"
            );
            assert_eq!(func(text.as_ptr(), 9999), 9999);
            assert_eq!(func(text.as_ptr(), 2), 2);

            // Everything else in the process shares this function, so unhook it before anything
            // else gets to call it. Dropping the patcher afterwards is what leaves the wrapper
            // code unreachable rather than dangling.
            restore_entry(&entry);
            assert_eq!(func(text.as_ptr(), 9999), 0);
            drop(patcher);
        }
    }
}
