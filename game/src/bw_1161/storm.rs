#![allow(bad_style)]

use std::mem;

use lazy_static::lazy_static;

use crate::bw;
use crate::windows;

#[repr(C)]
pub struct SCode {
    pub whatever: [u8; 0x4c],
    pub code_offsets: [*mut u8; 0xa1],
}

whack_hooks!(stdcall, 0x15000000,
    0x1503DE90 => InitializeSnpList();
    0x150380A0 => UnloadSnp(u32);
);

whack_vars!(init_vars, 0x15000000,
    0x1505E630 => snp_list_initialized: u32;
    // Not actually a full entry, just next/prev pointers
    0x1505AD6C => snp_list: bw::SnpListEntry;
    0x1505EC04 => surface_copy_code: *mut SCode;
);

lazy_static! {
    static ref SERR_GET_LAST_ERROR: unsafe extern "stdcall" fn() -> u32 = unsafe {
        let storm = windows::load_library("storm").expect("Couldn't load storm");
        let func = storm
            .proc_address_ordinal(463)
            .expect("Couldn't find SErrGetLastError");
        mem::transmute(func)
    };
    static ref SERR_SET_LAST_ERROR: unsafe extern "stdcall" fn(u32) = unsafe {
        let storm = windows::load_library("storm").expect("Couldn't load storm");
        let func = storm
            .proc_address_ordinal(465)
            .expect("Couldn't find SErrSetLastError");
        mem::transmute(func)
    };
}

pub unsafe fn SErrGetLastError() -> u32 {
    SERR_GET_LAST_ERROR()
}

pub unsafe fn SErrSetLastError(error: u32) {
    SERR_SET_LAST_ERROR(error);
}
