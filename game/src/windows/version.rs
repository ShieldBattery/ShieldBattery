use std::path::Path;
use std::ptr::null_mut;

use libc::c_void;
use winapi::um::winver::{GetFileVersionInfoW, GetFileVersionInfoSizeW, VerQueryValueW};

use crate::windows::winapi_str;

#[derive(Debug, Eq, PartialEq, Ord, PartialOrd, Copy, Clone)]
pub struct Version(pub u16, pub u16, pub u16, pub u16);

fn file_version_buf(path: &Path) -> Option<Vec<u8>> {
    unsafe {
        let path = winapi_str(path);
        let buf_size = GetFileVersionInfoSizeW(path.as_ptr(), null_mut());
        let mut buf = vec![0; buf_size as usize];
        let buf_ptr = buf.as_mut_ptr() as *mut c_void;
        let ok = GetFileVersionInfoW(path.as_ptr(), 0, buf_size, buf_ptr);
        if ok == 0 {
            None
        } else {
            Some(buf)
        }
    }
}

pub fn get_version(path: &Path) -> Option<Version> {
    unsafe {
        file_version_buf(path)
            .and_then(|mut buf| {
                let buf_ptr = buf.as_mut_ptr() as *mut c_void;
                let mut size = 0u32;
                let mut info_ptr = null_mut();
                let ok = VerQueryValueW(
                    buf_ptr,
                    winapi_str("\\").as_ptr(),
                    &mut info_ptr,
                    &mut size
                );
                if ok == 0 {
                    return None;
                }
                let info = info_ptr as *const u32;
                let high = *info.offset(2);
                let low = *info.offset(3);
                Some(Version(
                    (high >> 16) as u16,
                    (high & 0xffff) as u16,
                    (low >> 16) as u16,
                    (low & 0xffff) as u16
                ))
            })
    }
}
