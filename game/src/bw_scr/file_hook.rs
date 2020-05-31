use std::ffi::CStr;
use std::ptr::null_mut;

use arrayvec::ArrayVec;
use lazy_static::lazy_static;
use libc::c_void;

use super::scr;
use super::thiscall::Thiscall;

pub fn open_file_hook(
    out: *mut scr::FileHandle,
    path: *const u8,
    params: *const scr::OpenParams,
    orig: unsafe extern fn(
        *mut scr::FileHandle, *const u8, *const scr::OpenParams,
    ) -> *mut scr::FileHandle,
) -> *mut scr::FileHandle {
    unsafe {
        let mut buffer = ArrayVec::new();
        let real = real_path(path, params, &mut buffer);
        if let Some(path) = real {
            let is_sd = (*params).file_type == 1;
            if !is_sd {
                if let Some(patched) = check_dummied_out_hd(path) {
                    memory_buffer_to_bw_file_handle(patched, out);
                    return out;
                }
            }
        }
        orig(out, path, params)
    }
}

static DUMMY_ANIM: &[u8] = include_bytes!("../../files/dummy.anim");
static DUMMY_DDSGRP: &[u8] = &[0x08, 0x00, 0x00, 0x00, 0x00, 0x00, 0x02, 0x10];
static DUMMY_SKINS: &[u8] = br#"{"skins":[]}"#;

fn check_dummied_out_hd(path: &[u8]) -> Option<&'static [u8]> {
    if path.ends_with(b".anim") {
        // Avoid touching tileset/foliage.anim
        if path.starts_with(b"anim/") {
            return Some(DUMMY_ANIM);
        }
    } else if path.ends_with(b".dds") {
        // Font dds files are used (only) in SD, but they aren't loaded
        // on file param SD.
        if !path.starts_with(b"font/") {
            // Anim happens to have a dds inside it :)
            let dummy_dds = &DUMMY_ANIM[0x174..];
            return Some(dummy_dds);
        }
    } else if path.ends_with(b".dds.vr4") {
        return Some(DUMMY_DDSGRP);
    } else if path.ends_with(b".dds.grp") {
        // Avoid tileset.dds.grps, they need their frames
        if path.starts_with(b"unit/") || path.starts_with(b"effect/") {
            return Some(DUMMY_DDSGRP);
        }
    } else if path == b"anim/skins.json" {
        return Some(DUMMY_SKINS);
    }
    None
}

/// If `params` has a file extension set, it will override whatever
/// extension `path` has.
///
/// Why it is done like that, I have no idea.
///
/// This function also normalizes to ascii lowercase and replaces any '\\' with '/'
unsafe fn real_path<'a>(
    path: *const u8,
    params: *const scr::OpenParams,
    buffer: &'a mut ArrayVec<[u8; 256]>,
) -> Option<&'a [u8]> {
    let c_path = CStr::from_ptr(path as *const i8);
    let c_path = c_path.to_bytes();

    let alt_extension = if (*params).extension.is_null() {
        None
    } else {
        Some(CStr::from_ptr((*params).extension as *const i8))
    };

    let c_path_for_switched_extension = match alt_extension.is_some() {
        true => match c_path.iter().rev().position(|&x| x == b'.') {
            Some(period) => &c_path[..c_path.len() - period - 1],
            None => c_path,
        },
        false => c_path,
    };
    if let Err(_) = buffer.try_extend_from_slice(c_path_for_switched_extension) {
        return None;
    }
    if let Some(ext) = alt_extension {
        if let Err(_) = buffer.try_extend_from_slice(ext.to_bytes()) {
            return None;
        }
    }
    let slice = &mut buffer[..];
    for val in slice.iter_mut() {
        match *val {
            b'A' ..= b'Z' => {
                *val = b'a' + (*val - b'A');
            }
            b'\\' => {
                *val = b'/';
            }
            _ => (),
        }
    }
    Some(slice)
}

unsafe fn memory_buffer_to_bw_file_handle(buffer: &'static [u8], handle: *mut scr::FileHandle) {
    let inner = Box::new(FileAllocation {
        file: FileState {
            buffer,
            pos: 0,
        },
        read: scr::FileRead {
            vtable: &*FILE_READ_VTABLE,
            inner: null_mut(),
        },
        peek: scr::FilePeek {
            vtable: &*FILE_PEEK_VTABLE,
            inner: null_mut(),
        },
        metadata: scr::FileMetadata {
            vtable: &*FILE_METADATA_VTABLE,
            inner: null_mut(),
        },
    });

    let inner_ptr = Box::into_raw(inner);
    (*inner_ptr).metadata.inner = inner_ptr as *mut c_void;
    (*inner_ptr).peek.inner = inner_ptr as *mut c_void;
    (*inner_ptr).read.inner = inner_ptr as *mut c_void;
    let close_callback = scr::Function {
        vtable: &*FUNCTION_VTABLE,
        inner: inner_ptr as *mut c_void,
    };

    *handle = scr::FileHandle {
        vtable: &*FILE_HANDLE_VTABLE1,
        vtable2: &*FILE_HANDLE_VTABLE2,
        vtable3: &*FILE_HANDLE_VTABLE3,
        metadata: &mut (*inner_ptr).metadata,
        peek: &mut (*inner_ptr).peek,
        read: &mut (*inner_ptr).read,
        file_ok: 1,
        close_callback,
    };
}

struct FileAllocation {
    file: FileState,
    read: scr::FileRead,
    peek: scr::FilePeek,
    metadata: scr::FileMetadata,
}

struct FileState {
    buffer: &'static [u8],
    pos: u32,
}

lazy_static! {
    static ref FILE_HANDLE_VTABLE1: scr::V_FileHandle1 = scr::V_FileHandle1 {
        destroy: Thiscall::new(file_handle_destroy_nop),
        read: Thiscall::new(read_file_wrap),
        skip: Thiscall::new(skip_wrap),
        safety_padding: [0; 0x20],
    };

    static ref FILE_HANDLE_VTABLE2: scr::V_FileHandle2 = scr::V_FileHandle2 {
        unk0: [0; 1],
        peek: Thiscall::new(peek_wrap),
        safety_padding: [0; 0x20],
    };

    static ref FILE_HANDLE_VTABLE3: scr::V_FileHandle3 = scr::V_FileHandle3 {
        unk0: [0; 1],
        tell: Thiscall::new(tell_wrap),
        seek: Thiscall::new(seek_wrap),
        file_size: Thiscall::new(file_size_wrap),
        safety_padding: [0; 0x20],
    };

    static ref FILE_METADATA_VTABLE: scr::V_FileMetadata = scr::V_FileMetadata {
        unk0: [0; 1],
        tell: Thiscall::new(tell),
        seek: Thiscall::new(seek),
        file_size: Thiscall::new(file_size),
        safety_padding: [0; 0x20],
    };

    static ref FILE_READ_VTABLE: scr::V_FileRead = scr::V_FileRead {
        destroy: 0,
        read: Thiscall::new(read_file),
        skip: Thiscall::new(skip),
        safety_padding: [0; 0x20],
    };

    static ref FILE_PEEK_VTABLE: scr::V_FilePeek = scr::V_FilePeek {
        destroy: 0,
        peek: Thiscall::new(peek),
        safety_padding: [0; 0x20],
    };

    static ref FUNCTION_VTABLE: scr::V_Function = scr::V_Function {
        destroy_inner: Thiscall::new(function_nop_destory),
        invoke: Thiscall::new(close_file),
        destroy: 0,
        get_sizes: Thiscall::new(function_object_size),
        unk10: 0,
        copy: Thiscall::new(function_copy),
        safety_padding: [0; 0x20],
    };
}

unsafe extern fn file_handle_destroy_nop(_file: *mut scr::FileHandle, _dyn_free: u32) {
}

unsafe extern fn function_nop_destory(_file: *mut scr::Function, _unk: u32) {
}

unsafe extern fn function_object_size(
    _file: *mut scr::Function,
    size: *mut u32,
    other: *mut u32,
) {
    *size = 0xc;
    *other = 0x4;
}

unsafe extern fn function_copy(this: *mut scr::Function, other: *mut scr::Function) {
    *other = *this;
}

unsafe extern fn read_file_wrap(file: *mut scr::FileHandle, out: *mut u8, size: u32) -> u32 {
    let read = (*file).read;
    let vtable = (*read).vtable;
    (*vtable).read.call3(read, out, size)
}

unsafe extern fn skip_wrap(file: *mut scr::FileHandle, size: u32) {
    let read = (*file).read;
    let vtable = (*read).vtable;
    (*vtable).skip.call2(read, size)
}

unsafe extern fn read_file(file: *mut scr::FileRead, out: *mut u8, size: u32) -> u32 {
    let file = (*file).inner as *mut FileAllocation;
    let buf = std::slice::from_raw_parts_mut(out, size as usize);
    (*file).file.read(buf)
}

unsafe extern fn skip(file: *mut scr::FileRead, size: u32) {
    let file = (*file).inner as *mut FileAllocation;
    let pos = (*file).file.tell();
    (*file).file.seek(pos.saturating_add(size));
}

unsafe extern fn peek_wrap(file: *mut c_void, out: *mut u8, size: u32) -> u32 {
    let file = (file as usize - 4) as *mut scr::FileHandle;
    let peek = (*file).peek;
    let vtable = (*peek).vtable;
    (*vtable).peek.call3(peek, out, size)
}

unsafe extern fn peek(file: *mut scr::FilePeek, out: *mut u8, size: u32) -> u32 {
    let file = (*file).inner as *mut FileAllocation;
    let buf = std::slice::from_raw_parts_mut(out, size as usize);
    let old_pos = (*file).file.tell();
    let result = (*file).file.read(buf);
    (*file).file.seek(old_pos);
    result
}

unsafe extern fn tell_wrap(file: *mut c_void) -> u32 {
    let file = (file as usize - 8) as *mut scr::FileHandle;
    let metadata = (*file).metadata;
    let vtable = (*metadata).vtable;
    (*vtable).tell.call1(metadata)
}

unsafe extern fn seek_wrap(file: *mut c_void, pos: u32) {
    let file = (file as usize - 8) as *mut scr::FileHandle;
    let metadata = (*file).metadata;
    let vtable = (*metadata).vtable;
    (*vtable).seek.call2(metadata, pos)
}

unsafe extern fn file_size_wrap(file: *mut c_void) -> u32 {
    let file = (file as usize - 8) as *mut scr::FileHandle;
    let metadata = (*file).metadata;
    let vtable = (*metadata).vtable;
    (*vtable).file_size.call1(metadata)
}

unsafe extern fn tell(file: *mut scr::FileMetadata) -> u32 {
    let file = (*file).inner as *mut FileAllocation;
    (*file).file.tell()
}

unsafe extern fn seek(file: *mut scr::FileMetadata, pos: u32) {
    let file = (*file).inner as *mut FileAllocation;
    (*file).file.seek(pos);
}

unsafe extern fn file_size(file: *mut scr::FileMetadata) -> u32 {
    let file = (*file).inner as *mut FileAllocation;
    (*file).file.size()
}

unsafe extern fn close_file(this: *mut scr::Function) {
    let file = (*this).inner as *mut FileAllocation;
    // Hopefully ok?
    Box::from_raw(file);
}

impl FileState {
    pub fn tell(&self) -> u32 {
        self.pos
    }

    pub fn seek(&mut self, pos: u32) {
        self.pos = pos;
    }

    pub fn size(&self) -> u32 {
        self.buffer.len() as u32
    }

    pub fn read(&mut self, out: &mut [u8]) -> u32 {
        let buffer = &self.buffer[self.pos as usize..];
        let read_len = out.len().min(buffer.len());
        (&mut out[..read_len]).copy_from_slice(&buffer[..read_len]);
        self.pos += read_len as u32;
        read_len as u32
    }
}
