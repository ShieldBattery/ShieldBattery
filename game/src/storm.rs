#![allow(bad_style)]

use std::mem;
use std::ptr::null_mut;

use lazy_static::lazy_static;

use crate::windows;

lazy_static! {
    static ref SNET_GET_PLAYER_NAMES: unsafe extern "stdcall" fn(*mut *const i8) = unsafe {
        let storm = windows::load_library("storm").expect("Couldn't load storm");
        let func = storm
            .proc_address_ordinal(144)
            .expect("Couldn't find SNetGetPlayerNames");
        mem::transmute(func)
    };
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

pub unsafe fn SNetGetPlayerNames() -> Vec<Option<String>> {
    let mut buffer: [*const i8; 8] = [null_mut(); 8];
    SNET_GET_PLAYER_NAMES(buffer.as_mut_ptr());
    buffer
        .iter()
        .map(|&ptr| {
            if ptr.is_null() {
                None
            } else {
                Some(std::ffi::CStr::from_ptr(ptr).to_string_lossy().into())
            }
        })
        .collect()
}
