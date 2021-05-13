//! A macro that handles hooking an exported function that may have already
//! been hooked in a way that GetProcAddress doesn't return the expected dll.

use std::io;

use libc::c_void;

use crate::windows;

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
    ($active:expr, $expected_name:expr, $($name:expr, $hook:ident, $func:ident;)*) => {{
        let lib = crate::windows::load_library($expected_name).unwrap();
        let mut default_patcher = $active.patch_library($expected_name, 0);
        const fn zero(_name: &'static str) -> usize {
            0
        }
        let mut unusual_hooks = [$(zero($name)),*];
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
                    default_patcher.hook_closure_address($hook, $func, addr);
                } else {
                    unusual_hooks[i] = proc_address;
                }
            } else {
                error!("Didn't find {}", $name);
            }
            #[allow(unused_assignments)] { i += 1; }
        )*
        i = 0;
        $(
            if unusual_hooks[i] != 0 {
                let proc_address = unusual_hooks[i];
                let (mut patcher, offset, _guard) =
                    crate::hook_macro::unprotect_memory_for_hook($active, proc_address);
                patcher.hook_closure_address($hook, $func, offset);
            }
            #[allow(unused_assignments)] { i += 1; }
        )*
    }}
}

/// Helper for hook_winapi_exports! macro.
pub unsafe fn unprotect_memory_for_hook<'a>(
    active_patcher: &'a mut whack::Patcher,
    proc_address: usize,
) -> (whack::ModulePatcher<'a>, usize, Option<windows::MemoryProtectionGuard>) {
    // Windows has always 4k pages
    let start = proc_address & !0xfff;
    let end = ((proc_address + 0x10) | 0xfff) + 1;
    let len = end - start;
    // If the unprotection for some reason fails, just keep going and hope the memory
    // can be written.
    let start = start as *mut c_void;
    debug!("Unprotecting memory for hook {:x} @ {:x}~{:x}", proc_address, start as usize, len);
    let guard = windows::unprotect_memory(start, len).ok();
    let patcher = active_patcher.patch_memory(start, start, !0);
    (patcher, proc_address - start as usize, guard)
}

/// Determines address for hooking the function.
///
/// In addition to just GetProcAddress this follows any unconditional jumps at the
/// address returned by GetProcAddress, in order to avoid placing a second hook
/// at a address which was already hooked by some system DLL (Nvidia driver).
/// This should end up being more stable than otherwise.
pub unsafe fn hook_proc_address(lib: &windows::Library, proc: &str) -> Result<usize, io::Error> {
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
