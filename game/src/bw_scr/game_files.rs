//! Reading files out of the game's own storage through the game's own file access, for assets the
//! overlay draws but cannot ship: they are the game's, and only the game may hand them out.

use std::ffi::{CStr, c_void};
use std::mem::{offset_of, size_of};
use std::ptr::{addr_of, addr_of_mut, null};

use super::scr;
use super::{BwScr, Thiscall};
use crate::bw::Bw;

/// Room for the file handle `open_file` fills: [`scr::FileHandle`]'s fields up to `file_ok`, then a
/// five-word slot holding the callback that closes the file. `scr::FileHandle` declares only two
/// words of that slot, which is all the file hook writes, but the game's own handle is the whole of
/// this.
#[repr(C)]
struct FileHandleStorage([usize; 12]);

const _: () = assert!(size_of::<FileHandleStorage>() == 12 * size_of::<usize>());
const _: () = assert!(offset_of!(scr::FileHandle, file_ok) == 6 * size_of::<usize>());
const _: () = assert!(offset_of!(scr::FileHandle, close_callback) == 7 * size_of::<usize>());

/// A handle's read, as the game calls it: the length and the count read are pointer-sized on 64-bit,
/// and the game compares all of the count it gets back.
type ReadFn = unsafe extern "C" fn(*mut scr::FileHandle, *mut u8, usize) -> usize;

/// How large a read buffer the game's own loaders ask the storage for.
const CASC_BUFFER_SIZE: u32 = 0x20000;

impl BwScr {
    /// Reads all of `path` (as the storage names it, e.g. `webui/dist/lib/images/icon_minerals.png`)
    /// through the game's own file access, or `None` where the game has no such file.
    ///
    /// Must be called on the game's main thread: the game keeps the last file it opened in globals
    /// that are written without a lock. Never from inside the file hook, whose call is still using
    /// them.
    pub(super) unsafe fn read_game_file(&self, path: &CStr) -> Option<Vec<u8>> {
        unsafe {
            let mut storage = FileHandleStorage([0; 12]);
            let handle = storage.0.as_mut_ptr() as *mut scr::FileHandle;
            // The game's defaults for a plain data file: no SD/HD variant, no locale.
            let params = scr::OpenParams {
                extension: null(),
                _unk4: 0,
                file_type: 0,
                locale: 0,
                flags: 0,
                casc_buffer_size: CASC_BUFFER_SIZE,
                safety_padding: [0; 4],
            };
            let open_file: unsafe extern "C" fn(
                *mut scr::FileHandle,
                *const u8,
                *const scr::OpenParams,
            ) -> *mut scr::FileHandle = std::mem::transmute(self.open_file.0);
            open_file(handle, path.as_ptr().cast(), &params);
            // Only the low byte is the flag; the game leaves the rest of the word alone.
            let opened = *(addr_of!((*handle).file_ok) as *const u8) != 0;
            let contents = if opened { read_to_end(handle) } else { None };
            self.close_game_file(handle, opened);
            contents
        }
    }

    /// Closes a handle `open_file` filled, in the order the game's own loaders do: the close
    /// callback runs for a file that opened, the callback is destroyed (and freed if it lives on
    /// the heap), then the handle itself.
    unsafe fn close_game_file(&self, handle: *mut scr::FileHandle, opened: bool) {
        unsafe {
            // The slot holds the callback inline, or the address of one on the heap with its low
            // bit set; a bare 1 is an empty slot.
            let slot = addr_of_mut!((*handle).close_callback) as *mut usize;
            let tag = *slot;
            if tag != 1 {
                let on_heap = tag & 1 != 0;
                let callback = match on_heap {
                    true => (tag & !1) as *mut scr::Function,
                    false => slot as *mut scr::Function,
                };
                if opened {
                    (*(*callback).vtable).invoke.call1(callback);
                }
                (*(*callback).vtable).destroy_inner.call2(callback, 0);
                if on_heap {
                    self.free(callback as *mut u8);
                }
                *slot = 1;
            }
            if opened {
                (*(*handle).vtable).destroy.call2(handle, 0);
            }
        }
    }
}

/// Reads the whole of an open file, or `None` if it comes up short of the size it gives.
unsafe fn read_to_end(handle: *mut scr::FileHandle) -> Option<Vec<u8>> {
    unsafe {
        let seekable = addr_of_mut!((*handle).vtable3) as *mut c_void;
        let size = (*(*handle).vtable3).file_size.call1(seekable) as usize;
        let read: Thiscall<ReadFn> = Thiscall::foreign((*(*handle).vtable).read.cast_usize());
        let mut contents = vec![0u8; size];
        let mut filled = 0;
        while filled < size {
            let count = read.call3(handle, contents.as_mut_ptr().add(filled), size - filled);
            if count == 0 {
                break;
            }
            filled += count;
        }
        (filled == size).then_some(contents)
    }
}
