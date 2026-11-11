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

#[derive(Clone, Copy)]
pub enum ShaderModel {
    Sm4,
    /// Shader model 4 in a container that also carries the shader compiled for Direct3D 9, the
    /// form SC:R's own entries for Direct3D feature levels below 11 take. A feature level 9 device
    /// can only create a shader from such a container, so a replacement for a shader that every
    /// frame is drawn with has to be built this way.
    Sm4Level9,
    Sm5,
}

pub enum ShaderType {
    Vertex,
    Pixel,
}

/// Wraps a compiled D3D shader into the format SC:R's Prism renderer keeps shaders in: a header
/// with masks of the texture, sampler and constant buffer slots the shader reads, then the DXBC
/// container.
///
/// The slots are read from the container's reflection data, so `bytes` must not be stripped of it.
pub fn wrap_prism_shader(bytes: &[u8]) -> io::Result<Vec<u8>> {
    let slots = ResourceSlots::read(bytes)?;
    let mut out = vec![0u8; 0x38];
    out[0] = 0x3;
    out[0x10..0x14].copy_from_slice(&slots.textures.to_le_bytes());
    out[0x20..0x24].copy_from_slice(&slots.samplers.to_le_bytes());
    out[0x28..0x2c].copy_from_slice(&slots.constant_buffers.to_le_bytes());
    out[0x30..0x34].copy_from_slice(&(bytes.len() as u32).to_le_bytes());
    out[0x34] = 0x4;
    out.extend_from_slice(bytes);
    Ok(out)
}

/// Masks of the slots a shader binds resources to, a bit per slot.
#[derive(Debug, Default, Eq, PartialEq)]
struct ResourceSlots {
    textures: u32,
    samplers: u32,
    constant_buffers: u32,
}

impl ResourceSlots {
    /// Reads the bindings out of the `RDEF` chunk of a DXBC container.
    fn read(dxbc: &[u8]) -> io::Result<ResourceSlots> {
        let invalid = |what: &str| io::Error::new(io::ErrorKind::InvalidData, what.to_string());
        let u32_at = |data: &[u8], offset: usize| {
            data.get(offset..offset + 4)
                .map(|x| u32::from_le_bytes([x[0], x[1], x[2], x[3]]))
                .ok_or_else(|| invalid("DXBC container is truncated"))
        };
        if dxbc.get(..4) != Some(b"DXBC") {
            return Err(invalid("not a DXBC container"));
        }
        let chunk_count = u32_at(dxbc, 0x1c)? as usize;
        let rdef = (0..chunk_count)
            .map(|i| u32_at(dxbc, 0x20 + i * 4).map(|offset| offset as usize))
            .find_map(|offset| match offset {
                Ok(offset) if dxbc.get(offset..offset + 4) == Some(b"RDEF") => Some(Ok(offset)),
                Ok(_) => None,
                Err(e) => Some(Err(e)),
            })
            .ok_or_else(|| invalid("shader has no reflection data"))??;
        let size = u32_at(dxbc, rdef + 4)? as usize;
        let rdef = dxbc
            .get(rdef + 8..rdef + 8 + size)
            .ok_or_else(|| invalid("RDEF chunk is truncated"))?;

        // A D3D11_SHADER_INPUT_BIND_DESC as stored for shader models 4 and 5.0: name, type, return
        // type, dimension, sample count, bind point, bind count, flags.
        const BINDING_SIZE: usize = 0x20;
        let binding_count = u32_at(rdef, 0x8)? as usize;
        let bindings = u32_at(rdef, 0xc)? as usize;
        let mut slots = ResourceSlots::default();
        for i in 0..binding_count {
            let binding = bindings + i * BINDING_SIZE;
            let kind = u32_at(rdef, binding + 0x4)?;
            let first = u32_at(rdef, binding + 0x14)?;
            let count = u32_at(rdef, binding + 0x18)?;
            let mask = (first..first.saturating_add(count))
                .filter(|&slot| slot < 32)
                .fold(0u32, |mask, slot| mask | (1 << slot));
            match kind {
                D3D_SIT_CBUFFER => slots.constant_buffers |= mask,
                D3D_SIT_TEXTURE => slots.textures |= mask,
                D3D_SIT_SAMPLER => slots.samplers |= mask,
                _ => (),
            }
        }
        Ok(slots)
    }
}

/// Disassembles a compiled D3D shader.
pub fn disassemble(bytes: &[u8]) -> io::Result<Vec<u8>> {
    unsafe {
        let mut blob = null_mut();
        let error = D3DDisassemble(
            bytes.as_ptr() as *const _,
            bytes.len(),
            0,
            c"".as_ptr() as *const _,
            &mut blob,
        );
        if error != 0 {
            return Err(io::Error::from_raw_os_error(error));
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
            let name = format!("{name}\0");
            let val = format!("{val}\0");
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
            (ShaderModel::Sm4, ShaderType::Vertex) => c"vs_4_0".as_ptr(),
            (ShaderModel::Sm4Level9, ShaderType::Vertex) => c"vs_4_0_level_9_1".as_ptr(),
            (ShaderModel::Sm5, ShaderType::Vertex) => c"vs_5_0".as_ptr(),
            (ShaderModel::Sm4, ShaderType::Pixel) => c"ps_4_0".as_ptr(),
            (ShaderModel::Sm4Level9, ShaderType::Pixel) => c"ps_4_0_level_9_1".as_ptr(),
            (ShaderModel::Sm5, ShaderType::Pixel) => c"ps_5_0".as_ptr(),
        };
        let error = D3DCompile2(
            bytes.as_ptr() as *const _,
            bytes.len(),
            null(),
            defines.as_ptr(),
            include.0 as *mut ID3DInclude,
            c"main".as_ptr(),
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
        let include_files = std::mem::take(&mut (*include.0).opened_files);
        Ok(CompileResults {
            shader: blob_to_bytes(code),
            include_files,
        })
    }
}

unsafe fn blob_to_bytes(blob: *mut ID3D10Blob) -> Vec<u8> {
    let slice = unsafe {
        std::slice::from_raw_parts(
            (*blob).GetBufferPointer() as *const u8,
            (*blob).GetBufferSize(),
        )
    };
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
    #[allow(clippy::new_ret_no_self)]
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
        unsafe {
            *out_data = null_mut();
            *out_size = 0;
        }
        let s = s as *mut IncludeHandler;
        let filename = unsafe {
            let filename_len = (0..).position(|i| *filename.add(i) == 0).unwrap();
            std::slice::from_raw_parts(filename as *const u8, filename_len)
        };
        let filename = match std::str::from_utf8(filename) {
            Ok(o) => o,
            Err(_) => return E_FAIL,
        };
        let result = unsafe {
            let path = (*s).path.join(filename);
            (*s).opened_files.push(path.to_str().unwrap().into());
            match fs::read(&path) {
                Ok(o) => o,
                Err(e) => {
                    (*s).error = Some(e);
                    return E_FAIL;
                }
            }
        };
        let ptr = result.as_ptr();
        let len = result.len();
        unsafe {
            (*s).buffers.push(result);
            *out_data = ptr as *const _;
            *out_size = len as u32;
        }
        S_OK
    }

    unsafe extern "system" fn close(
        s: *mut ID3DInclude,
        data: *const winapi::ctypes::c_void,
    ) -> HRESULT {
        let s = s as *mut IncludeHandler;
        unsafe {
            let pos = match (*s)
                .buffers
                .iter()
                .position(|x| x.as_ptr() == data as *const u8)
            {
                Some(s) => s,
                None => return E_FAIL,
            };
            (*s).buffers.swap_remove(pos);
        }
        S_OK
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn slots_of(source: &str, model: ShaderModel) -> ResourceSlots {
        let compiled = compile(
            source.as_bytes(),
            &[],
            Path::new("."),
            ShaderType::Pixel,
            model,
        )
        .expect("Test shader compiles");
        ResourceSlots::read(&compiled.shader).expect("Test shader has reflection data")
    }

    #[test]
    fn header_masks_name_the_slots_the_shader_reads() {
        let source = "
            Texture2D<float4> a : register(t0);
            Texture2D<float4> b : register(t2);
            SamplerState s : register(s1);
            cbuffer constants : register(b0) { float4 color; };
            float4 main(float4 pos : SV_Position, float2 uv : TEXCOORD0) : SV_Target0
            {
                return (a.Sample(s, uv) + b.Sample(s, uv)) * color;
            }
        ";
        let expected = ResourceSlots {
            textures: 0b101,
            samplers: 0b10,
            constant_buffers: 0b1,
        };
        assert_eq!(slots_of(source, ShaderModel::Sm5), expected);
        assert_eq!(slots_of(source, ShaderModel::Sm4Level9), expected);
    }

    #[test]
    fn header_carries_the_masks_and_the_container() {
        let source = "
            Texture2D<float4> a : register(t0);
            SamplerState s : register(s0);
            float4 main(float4 pos : SV_Position, float2 uv : TEXCOORD0) : SV_Target0
            {
                return a.Sample(s, uv);
            }
        ";
        let compiled = compile(
            source.as_bytes(),
            &[],
            Path::new("."),
            ShaderType::Pixel,
            ShaderModel::Sm5,
        )
        .expect("Test shader compiles")
        .shader;
        let wrapped = wrap_prism_shader(&compiled).expect("Test shader wraps");
        let u32_at =
            |offset: usize| u32::from_le_bytes(wrapped[offset..offset + 4].try_into().unwrap());
        assert_eq!(u32_at(0x10), 1);
        assert_eq!(u32_at(0x20), 1);
        assert_eq!(u32_at(0x28), 0);
        assert_eq!(u32_at(0x30) as usize, compiled.len());
        assert_eq!(&wrapped[0x38..], &compiled[..]);
    }
}
