use std::io;
use std::mem::size_of;
use std::ptr;

use scopeguard::{ScopeGuard, defer, guard};
use winapi::shared::windef::HWND;
use winapi::um::winbase::{GMEM_MOVEABLE, GlobalAlloc, GlobalFree, GlobalLock, GlobalUnlock};
use winapi::um::winuser::{
    CF_UNICODETEXT, CloseClipboard, EmptyClipboard, OpenClipboard, SetClipboardData,
};

/// Writes Unicode text to the system clipboard, owned by `window`.
pub fn copy_text(window: HWND, text: &str) -> io::Result<()> {
    let text: Vec<u16> = text.encode_utf16().chain(Some(0)).collect();
    unsafe {
        let memory = GlobalAlloc(GMEM_MOVEABLE, text.len() * size_of::<u16>());
        if memory.is_null() {
            return Err(io::Error::last_os_error());
        }
        let memory = guard(memory, |memory| {
            GlobalFree(memory);
        });
        let buffer = GlobalLock(*memory).cast::<u16>();
        if buffer.is_null() {
            return Err(io::Error::last_os_error());
        }
        ptr::copy_nonoverlapping(text.as_ptr(), buffer, text.len());
        GlobalUnlock(*memory);
        if OpenClipboard(window) == 0 {
            return Err(io::Error::last_os_error());
        }
        defer! { CloseClipboard(); }
        if EmptyClipboard() == 0 || SetClipboardData(CF_UNICODETEXT, *memory).is_null() {
            return Err(io::Error::last_os_error());
        }
        // SetClipboardData transfers the allocation to Windows on success.
        ScopeGuard::into_inner(memory);
        Ok(())
    }
}
