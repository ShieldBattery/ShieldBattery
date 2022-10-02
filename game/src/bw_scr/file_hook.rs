use std::ffi::CStr;
use std::ptr::null_mut;
use std::sync::atomic::Ordering;

use arrayvec::ArrayVec;
use lazy_static::lazy_static;
use libc::c_void;

use super::thiscall::Thiscall;
use super::{scr, BwScr};

pub fn open_file_hook(
    bw: &'static BwScr,
    out: *mut scr::FileHandle,
    path: *const u8,
    params: *const scr::OpenParams,
    orig: unsafe extern "C" fn(
        *mut scr::FileHandle,
        *const u8,
        *const scr::OpenParams,
    ) -> *mut scr::FileHandle,
) -> *mut scr::FileHandle {
    unsafe {
        let mut buffer = ArrayVec::new();
        let real = real_path(path, params, &mut buffer);
        if let Some(path) = real {
            let is_sd = (*params).file_type == 1;
            if bw.disable_hd && !is_sd {
                if let Some(patched) = check_dummied_out_hd(path) {
                    memory_buffer_to_bw_file_handle(patched, out);
                    return out;
                }
            }
            // This file is so big that it can take hundreds of milliseconds to parse,
            // use empty json array instead.
            if path == b"rez/badnames.json" {
                memory_buffer_to_bw_file_handle(DUMMY_BADNAMES, out);
                return out;
            } else if path == b"anim/skins.json" {
                // Since we don't have a menu where the user can switch
                // skins when game has launched, we shouldn't spend any time
                // loading skins that cannot be switched to.
                let skins = if bw.show_skins.load(Ordering::Relaxed) {
                    if bw.is_carbot.load(Ordering::Relaxed) {
                        CARBOT_SKINS
                    } else {
                        NONCARBOT_SKINS
                    }
                } else {
                    EMPTY_SKINS
                };
                memory_buffer_to_bw_file_handle(skins, out);
                return out;
            } else {
                if bw.is_carbot.load(Ordering::Relaxed) && bw.show_skins.load(Ordering::Relaxed) {
                    // Similarly to skins.json check, don't load all regular HD sprites
                    // if the user has selected carbot
                    // Carbot doesn't have variant for every single sprite,
                    // most notably selection circles but also some (semi-unused?) doodads.
                    // So those anim files still have to be loaded.
                    if path.starts_with(b"anim/main_") && path.ends_with(b".anim") {
                        let load_anim = path
                            .get(b"anim/main_".len()..)
                            .and_then(|x| {
                                let num_str = std::str::from_utf8(x.get(..3)?).ok()?;
                                let num = num_str.parse::<u32>().ok()?;
                                MISSING_CARBOT_SPRITES_LOOKUP.get(num as usize).copied()
                            })
                            .unwrap_or(false);
                        if !load_anim {
                            memory_buffer_to_bw_file_handle(DUMMY_ANIM, out);
                            return out;
                        }
                    }
                }
            }
        }
        orig(out, path, params)
    }
}

static DUMMY_ANIM: &[u8] = include_bytes!("../../files/dummy.anim");
static DUMMY_DDSGRP: &[u8] = &[0x08, 0x00, 0x00, 0x00, 0x00, 0x00, 0x02, 0x10];
static DUMMY_BADNAMES: &[u8] = br#"[]"#;
static EMPTY_SKINS: &[u8] = br#"{"skins":[]}"#;
static NONCARBOT_SKINS: &[u8] = br#"{"skins":[{"id":1,"name":"PreSale"}]}"#;
static CARBOT_SKINS: &[u8] = br#"{"skins":[{"id":2,"name":"Carbot"}]}"#;

static MISSING_CARBOT_SPRITES_LOOKUP: [bool; 999] = missing_carbot_sprites();
const MISSING_CARBOT_SPRITES_LIST: &[u32] = &[
    106, 503, 561, 562, 563, 564, 565, 566, 567, 568, 569, 570, 571, 572, 573, 574, 575, 576, 577,
    578, 579, 580, 581, 588, 611, 613, 615, 617, 619, 621, 623, 625, 627, 629, 631, 633, 635, 637,
    639, 666, 692, 694, 696, 698, 705, 707, 709, 711, 756, 784, 792, 837, 839, 861, 873, 893, 905,
    908, 910, 932, 965, 972,
];

const fn missing_carbot_sprites() -> [bool; 999] {
    let mut result = [false; 999];
    let mut i = 0;
    while i < MISSING_CARBOT_SPRITES_LIST.len() {
        result[MISSING_CARBOT_SPRITES_LIST[i] as usize] = true;
        i += 1;
    }
    result
}

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
        return Some(EMPTY_SKINS);
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
    buffer: &'a mut ArrayVec<u8, 256>,
) -> Option<&'a [u8]> {
    // Doing this 256-byte array lookup to normalize instead of a simpler match may be
    // an unnecessary micro-optimization, but the older code was quite excessively
    // verbose and SCR opens ~2000 files during startup so I'd say this is worth it.
    static NORMALIZE_MAP: &[u8; 256] = &[
        0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08, 0x09, 0x0a, 0x0b, 0x0c, 0x0d, 0x0e,
        0x0f, 0x10, 0x11, 0x12, 0x13, 0x14, 0x15, 0x16, 0x17, 0x18, 0x19, 0x1a, 0x1b, 0x1c, 0x1d,
        0x1e, 0x1f, 0x20, 0x21, 0x22, 0x23, 0x24, 0x25, 0x26, 0x27, 0x28, 0x29, 0x2a, 0x2b, 0x2c,
        0x2d, 0x2e, 0x2f, 0x30, 0x31, 0x32, 0x33, 0x34, 0x35, 0x36, 0x37, 0x38, 0x39, 0x3a, 0x3b,
        0x3c, 0x3d, 0x3e, 0x3f, 0x40, b'a', b'b', b'c', b'd', b'e', b'f', b'g', b'h', b'i', b'j',
        b'k', b'l', b'm', b'n', b'o', b'p', b'q', b'r', b's', b't', b'u', b'v', b'w', b'x', b'y',
        b'z', 0x5b, b'/', 0x5d, 0x5e, 0x5f, 0x60, 0x61, 0x62, 0x63, 0x64, 0x65, 0x66, 0x67, 0x68,
        0x69, 0x6a, 0x6b, 0x6c, 0x6d, 0x6e, 0x6f, 0x70, 0x71, 0x72, 0x73, 0x74, 0x75, 0x76, 0x77,
        0x78, 0x79, 0x7a, 0x7b, 0x7c, 0x7d, 0x7e, 0x7f, 0x80, 0x81, 0x82, 0x83, 0x84, 0x85, 0x86,
        0x87, 0x88, 0x89, 0x8a, 0x8b, 0x8c, 0x8d, 0x8e, 0x8f, 0x90, 0x91, 0x92, 0x93, 0x94, 0x95,
        0x96, 0x97, 0x98, 0x99, 0x9a, 0x9b, 0x9c, 0x9d, 0x9e, 0x9f, 0xa0, 0xa1, 0xa2, 0xa3, 0xa4,
        0xa5, 0xa6, 0xa7, 0xa8, 0xa9, 0xaa, 0xab, 0xac, 0xad, 0xae, 0xaf, 0xb0, 0xb1, 0xb2, 0xb3,
        0xb4, 0xb5, 0xb6, 0xb7, 0xb8, 0xb9, 0xba, 0xbb, 0xbc, 0xbd, 0xbe, 0xbf, 0xc0, 0xc1, 0xc2,
        0xc3, 0xc4, 0xc5, 0xc6, 0xc7, 0xc8, 0xc9, 0xca, 0xcb, 0xcc, 0xcd, 0xce, 0xcf, 0xd0, 0xd1,
        0xd2, 0xd3, 0xd4, 0xd5, 0xd6, 0xd7, 0xd8, 0xd9, 0xda, 0xdb, 0xdc, 0xdd, 0xde, 0xdf, 0xe0,
        0xe1, 0xe2, 0xe3, 0xe4, 0xe5, 0xe6, 0xe7, 0xe8, 0xe9, 0xea, 0xeb, 0xec, 0xed, 0xee, 0xef,
        0xf0, 0xf1, 0xf2, 0xf3, 0xf4, 0xf5, 0xf6, 0xf7, 0xf8, 0xf9, 0xfa, 0xfb, 0xfc, 0xfd, 0xfe,
        0xff,
    ];
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
        *val = NORMALIZE_MAP[*val as usize];
    }
    Some(slice)
}

unsafe fn memory_buffer_to_bw_file_handle(buffer: &'static [u8], handle: *mut scr::FileHandle) {
    let inner = Box::new(FileAllocation {
        file: FileState { buffer, pos: 0 },
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
        get_sizes: Thiscall::new(function_object_size),
        copy: Thiscall::new(function_copy),
        copy2: Thiscall::new(function_copy),
        safety_padding: [0; 0x20],
    };
}

unsafe extern "C" fn file_handle_destroy_nop(_file: *mut scr::FileHandle, _dyn_free: u32) {}

unsafe extern "C" fn function_nop_destory(_file: *mut scr::Function, _unk: u32) {}

unsafe extern "C" fn function_object_size(_file: *mut scr::Function, size: *mut u32) {
    *size = 0xc;
    *size.add(1) = 0x4;
    *(size.add(2) as *mut u8) = 0x1;
}

unsafe extern "C" fn function_copy(this: *mut scr::Function, other: *mut scr::Function) {
    *other = *this;
}

unsafe extern "C" fn read_file_wrap(file: *mut scr::FileHandle, out: *mut u8, size: u32) -> u32 {
    let read = (*file).read;
    let vtable = (*read).vtable;
    (*vtable).read.call3(read, out, size)
}

unsafe extern "C" fn skip_wrap(file: *mut scr::FileHandle, size: u32) {
    let read = (*file).read;
    let vtable = (*read).vtable;
    (*vtable).skip.call2(read, size)
}

unsafe extern "C" fn read_file(file: *mut scr::FileRead, out: *mut u8, size: u32) -> u32 {
    let file = (*file).inner as *mut FileAllocation;
    let buf = std::slice::from_raw_parts_mut(out, size as usize);
    (*file).file.read(buf)
}

unsafe extern "C" fn skip(file: *mut scr::FileRead, size: u32) {
    let file = (*file).inner as *mut FileAllocation;
    let pos = (*file).file.tell();
    (*file).file.seek(pos.saturating_add(size));
}

unsafe extern "C" fn peek_wrap(file: *mut c_void, out: *mut u8, size: u32) -> u32 {
    let file = (file as usize - 4) as *mut scr::FileHandle;
    let peek = (*file).peek;
    let vtable = (*peek).vtable;
    (*vtable).peek.call3(peek, out, size)
}

unsafe extern "C" fn peek(file: *mut scr::FilePeek, out: *mut u8, size: u32) -> u32 {
    let file = (*file).inner as *mut FileAllocation;
    let buf = std::slice::from_raw_parts_mut(out, size as usize);
    let old_pos = (*file).file.tell();
    let result = (*file).file.read(buf);
    (*file).file.seek(old_pos);
    result
}

unsafe extern "C" fn tell_wrap(file: *mut c_void) -> u32 {
    let file = (file as usize - 8) as *mut scr::FileHandle;
    let metadata = (*file).metadata;
    let vtable = (*metadata).vtable;
    (*vtable).tell.call1(metadata)
}

unsafe extern "C" fn seek_wrap(file: *mut c_void, pos: u32) {
    let file = (file as usize - 8) as *mut scr::FileHandle;
    let metadata = (*file).metadata;
    let vtable = (*metadata).vtable;
    (*vtable).seek.call2(metadata, pos)
}

unsafe extern "C" fn file_size_wrap(file: *mut c_void) -> u32 {
    let file = (file as usize - 8) as *mut scr::FileHandle;
    let metadata = (*file).metadata;
    let vtable = (*metadata).vtable;
    (*vtable).file_size.call1(metadata)
}

unsafe extern "C" fn tell(file: *mut scr::FileMetadata) -> u32 {
    let file = (*file).inner as *mut FileAllocation;
    (*file).file.tell()
}

unsafe extern "C" fn seek(file: *mut scr::FileMetadata, pos: u32) {
    let file = (*file).inner as *mut FileAllocation;
    (*file).file.seek(pos);
}

unsafe extern "C" fn file_size(file: *mut scr::FileMetadata) -> u32 {
    let file = (*file).inner as *mut FileAllocation;
    (*file).file.size()
}

unsafe extern "C" fn close_file(this: *mut scr::Function) {
    let file = (*this).inner as *mut FileAllocation;
    // Hopefully ok?
    drop(Box::from_raw(file));
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
