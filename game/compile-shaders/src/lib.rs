//! A crate to contain shader compilation code that is used by both main librarys's
//! build script (When adding precompiled shaders to .dll), and main library itself
//! (When loading shaders at runtime)

use std::fs;
use std::io;
use std::path::{Path, PathBuf};
use std::ptr::{null, null_mut};

use winapi::shared::winerror::{E_FAIL, S_OK};
use winapi::um::d3dcommon::*;
use winapi::um::d3dcompiler::*;
use winapi::um::winnt::HRESULT;

pub enum ShaderModel {
    Sm4,
    Sm5,
}

pub enum ShaderType {
    Vertex,
    Pixel,
}

/// Wraps a D3D shader into the format that SC:R's prism renderer expects them in.
pub fn wrap_prism_shader(bytes: &[u8]) -> Vec<u8> {
    let mut out = vec![0u8; 0x38];
    out[0] = 0x3;
    out[0x10] = 0x3;
    out[0x20] = 0x3;
    out[0x28] = 0x1;
    (&mut out[0x30..0x34]).copy_from_slice(&(bytes.len() as u32).to_le_bytes());
    out[0x34] = 0x4;
    out.extend_from_slice(bytes);
    out
}

/// Disassembles a compiled D3D shader.
pub fn disassemble(bytes: &[u8]) -> io::Result<Vec<u8>> {
    unsafe {
        let mut blob = null_mut();
        let error = D3DDisassemble(
            bytes.as_ptr() as *const _,
            bytes.len(),
            0,
            b"\0".as_ptr() as *const _,
            &mut blob,
        );
        if error != 0 {
            return Err(io::Error::from_raw_os_error(error).into());
        }
        scopeguard::defer! {
            (*blob).Release();
        }
        Ok(blob_to_bytes(blob))
    }
}

pub struct CompileResults {
    pub shader: Vec<u8>,
    /// List of include files opened.
    /// Used so that build script can tell cargo that they are build inputs
    /// that must be tracked for changes.
    pub include_files: Vec<String>,
}

pub fn compile(
    bytes: &[u8],
    in_defines: &[(&str, &str)],
    shader_dir: &Path,
    shader_type: ShaderType,
    model: ShaderModel,
) -> io::Result<CompileResults> {
    unsafe {
        let mut defines = vec![];
        // Hold define strings for the compilation
        let mut strings = vec![];
        for &(name, val) in in_defines {
            let name = format!("{}\0", name);
            let val = format!("{}\0", val);
            defines.push(D3D_SHADER_MACRO {
                Name: name.as_ptr() as *const i8,
                Definition: val.as_ptr() as *const i8,
            });
            strings.push(name);
            strings.push(val);
        }
        defines.push(D3D_SHADER_MACRO {
            Name: null(),
            Definition: null(),
        });
        let mut code = null_mut();
        let mut errors = null_mut();
        let include = IncludeHandler::new(shader_dir.into());
        let model_string = match (model, shader_type) {
            (ShaderModel::Sm4, ShaderType::Vertex) => "vs_4_0\0".as_ptr() as *const i8,
            (ShaderModel::Sm5, ShaderType::Vertex) => "vs_5_0\0".as_ptr() as *const i8,
            (ShaderModel::Sm4, ShaderType::Pixel) => "ps_4_0\0".as_ptr() as *const i8,
            (ShaderModel::Sm5, ShaderType::Pixel) => "ps_5_0\0".as_ptr() as *const i8,
        };
        let error = D3DCompile2(
            bytes.as_ptr() as *const _,
            bytes.len(),
            null(),
            defines.as_ptr(),
            include.0 as *mut ID3DInclude,
            b"main\0".as_ptr() as *const i8,
            model_string,
            D3DCOMPILE_OPTIMIZATION_LEVEL3 | D3DCOMPILE_WARNINGS_ARE_ERRORS,
            0,
            0,
            null(),
            0,
            &mut code,
            &mut errors,
        );
        scopeguard::defer! {
            if !code.is_null() {
                (*code).Release();
            }
            if !errors.is_null() {
                (*errors).Release();
            }
        }
        if let Some(error) = (*include.0).error.take() {
            return Err(error);
        }
        if error != 0 {
            if !errors.is_null() {
                let errors = blob_to_bytes(errors);
                let error_msg = String::from_utf8_lossy(&errors);
                if !error_msg.is_empty() {
                    return Err(io::Error::new(io::ErrorKind::InvalidInput, error_msg));
                }
            }
            return Err(io::Error::from_raw_os_error(error));
        }
        let include_files = std::mem::replace(&mut (*include.0).opened_files, Vec::new());
        Ok(CompileResults {
            shader: blob_to_bytes(code),
            include_files,
        })
    }
}

unsafe fn blob_to_bytes(blob: *mut ID3D10Blob) -> Vec<u8> {
    let slice = std::slice::from_raw_parts(
        (*blob).GetBufferPointer() as *const u8,
        (*blob).GetBufferSize(),
    );
    slice.into()
}

static INCLUDE_VTABLE: ID3DIncludeVtbl = ID3DIncludeVtbl {
    Open: IncludeHandler::open,
    Close: IncludeHandler::close,
};

#[repr(C)]
struct IncludeHandler {
    interface: ID3DInclude,
    path: PathBuf,
    buffers: Vec<Vec<u8>>,
    opened_files: Vec<String>,
    error: Option<io::Error>,
}

struct IncludeHandlerHandle(*mut IncludeHandler);

impl Drop for IncludeHandlerHandle {
    fn drop(&mut self) {
        unsafe {
            drop(Box::from_raw(self.0));
        }
    }
}

/// Resolves shader includes to a filesystem file relative from the path passed to the
/// constructor.
impl IncludeHandler {
    fn new(path: PathBuf) -> IncludeHandlerHandle {
        let ptr = Box::into_raw(Box::new(IncludeHandler {
            interface: ID3DInclude {
                lpVtbl: &INCLUDE_VTABLE,
            },
            path,
            opened_files: Vec::new(),
            buffers: Vec::new(),
            error: None,
        }));
        IncludeHandlerHandle(ptr)
    }

    unsafe extern "system" fn open(
        s: *mut ID3DInclude,
        _include_type: D3D_INCLUDE_TYPE,
        filename: *const i8,
        _parent_data: *const winapi::ctypes::c_void,
        out_data: *mut *const winapi::ctypes::c_void,
        out_size: *mut u32,
    ) -> HRESULT {
        *out_data = null_mut();
        *out_size = 0;
        let s = s as *mut IncludeHandler;
        let filename_len = (0..).position(|i| *filename.add(i) == 0).unwrap();
        let filename = std::slice::from_raw_parts(filename as *const u8, filename_len);
        let filename = match std::str::from_utf8(filename) {
            Ok(o) => o,
            Err(_) => return E_FAIL,
        };
        let path = (*s).path.join(filename);
        (*s).opened_files.push(path.to_str().unwrap().into());
        let result = match fs::read(&path) {
            Ok(o) => o,
            Err(e) => {
                (*s).error = Some(e);
                return E_FAIL;
            }
        };
        let ptr = result.as_ptr();
        let len = result.len();
        (*s).buffers.push(result);
        *out_data = ptr as *const _;
        *out_size = len as u32;
        S_OK
    }

    unsafe extern "system" fn close(
        s: *mut ID3DInclude,
        data: *const winapi::ctypes::c_void,
    ) -> HRESULT {
        let s = s as *mut IncludeHandler;
        let pos = match (*s)
            .buffers
            .iter()
            .position(|x| x.as_ptr() == data as *const u8)
        {
            Some(s) => s,
            None => return E_FAIL,
        };
        (*s).buffers.swap_remove(pos);
        S_OK
    }
}
