#![allow(bad_style)]

use std::mem;

use lazy_static::lazy_static;

use crate::windows;

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
