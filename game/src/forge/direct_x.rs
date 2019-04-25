use std::fmt;
use std::io;
use std::mem;
use std::path::Path;
use std::ptr::null_mut;

use lazy_static::lazy_static;
use libc::c_void;
use winapi::Interface;
use winapi::shared::windef::{HWND, RECT};
use winapi::shared::dxgi::*;
use winapi::shared::dxgiformat::*;
use winapi::shared::dxgitype::*;
use winapi::shared::winerror::S_OK;
use winapi::um::d3dcommon::*;
use winapi::um::d3d11::*;
use winapi::um::unknwnbase::IUnknown;
use winapi::um::winuser::GetClientRect;
use winapi::um::wingdi::PALETTEENTRY;

use crate::windows;

use super::Settings;
use super::renderer::RenderApi;

pub struct Error {
    err: io::Error,
    stack: Vec<String>,
}

pub type Result<T> = std::result::Result<T, Error>;

trait ResultExt {
    fn context<S: Into<String>>(self, message: S) -> Self;
}

impl<T> ResultExt for Result<T> {
    fn context<S: Into<String>>(mut self, message: S) -> Result<T> {
        if let Err(ref mut e) = self {
            e.stack.push(message.into());
        }
        self
    }
}

impl Error {
    fn from_code(code: i32) -> Error {
        Error {
            err: io::Error::from_raw_os_error(code),
            stack: Vec::new(),
        }
    }
}

impl fmt::Display for Error {
    fn fmt(&self, f: &mut fmt::Formatter) -> fmt::Result {
        writeln!(f, "D3D error: {}", self.err)?;
        if !self.stack.is_empty() {
            writeln!(f, "Cause stack:")?;
            for msg in &self.stack {
                writeln!(f, "    {}", msg)?;
            }
        }
        Ok(())
    }
}

struct ComPtr<Interface>(*mut Interface);

impl<Interface> std::ops::Deref for ComPtr<Interface> {
    type Target = *mut Interface;
    fn deref(&self) -> &Self::Target {
        &self.0
    }
}

impl<Interface> Drop for ComPtr<Interface> {
    fn drop(&mut self) {
        unsafe {
            (*(self.0 as *mut IUnknown)).Release();
        }
    }
}

struct Device(ComPtr<ID3D11Device>, ComPtr<ID3D11DeviceContext>);
struct SwapChain(ComPtr<IDXGISwapChain>);
struct RenderTargetView(ComPtr<ID3D11RenderTargetView>);
struct VertexShader(ComPtr<ID3D11VertexShader>, ComPtr<ID3D11InputLayout>);
struct PixelShader(ComPtr<ID3D11PixelShader>);
struct Texture2d(ComPtr<ID3D11Texture2D>);
struct ShaderResourceView(ComPtr<ID3D11ShaderResourceView>);
struct SamplerState(ComPtr<ID3D11SamplerState>);
struct Buffer(ComPtr<ID3D11Buffer>);
struct Blob(ComPtr<ID3DBlob>);

struct Shaders {
    depalettized_vertex: VertexShader,
    depalettized_pixel: PixelShader,
    scaling_pixel: PixelShader,
}

struct Textures {
    palette_texture: Texture2d,
    bw_screen_texture: Texture2d,
    #[allow(dead_code)]
    rendered_texture: Texture2d,
    palette_view: ShaderResourceView,
    bw_screen_view: ShaderResourceView,
    rendered_texture_view: ShaderResourceView,
    depalettized_view: RenderTargetView,
    sampler: SamplerState,
}

struct Vertices {
    vertex_buffer: Buffer,
}

pub struct Renderer {
    device: Device,
    swap_chain: SwapChain,
    back_buffer_view: RenderTargetView,
    shaders: Shaders,
    textures: Textures,
    vertices: Vertices,
    ddraw_viewport: D3D11_VIEWPORT,
    final_viewport: D3D11_VIEWPORT,
    ddraw_width: u32,
    ddraw_height: u32,
}

fn create_device_and_swap_chain(window: HWND, width: u32, height: u32) -> Result<(Device, SwapChain)> {
    unsafe {
        let swap_chain_desc = DXGI_SWAP_CHAIN_DESC {
            BufferDesc: DXGI_MODE_DESC {
                Width: width,
                Height: height,
                // Refresh rate isn't necessary since we're windowed
                RefreshRate: DXGI_RATIONAL {
                    Numerator: 0,
                    Denominator: 1,
                },
                Format: DXGI_FORMAT_R8G8B8A8_UNORM,
                ScanlineOrdering: DXGI_MODE_SCANLINE_ORDER_UNSPECIFIED,
                Scaling: DXGI_MODE_SCALING_UNSPECIFIED,
            },
            SampleDesc: DXGI_SAMPLE_DESC {
                Count: 1,
                Quality: 0,
            },
            BufferUsage: DXGI_USAGE_RENDER_TARGET_OUTPUT,
            BufferCount: 1,
            OutputWindow: window,
            Windowed: 1,
            SwapEffect: DXGI_SWAP_EFFECT_DISCARD,
            Flags: 0,
        };
        let mut swap_chain = null_mut();
        let mut device = null_mut();
        let mut context = null_mut();
        let result = D3D11CreateDeviceAndSwapChain(
            null_mut(),
            D3D_DRIVER_TYPE_HARDWARE,
            null_mut(), // software
            0, // flags
            null_mut(), // feature level
            0, // feature level count
            D3D11_SDK_VERSION,
            &swap_chain_desc,
            &mut swap_chain,
            &mut device,
            null_mut(), // selected feature level
            &mut context,
        );
        if result == S_OK {
            Ok((Device(ComPtr(device), ComPtr(context)), SwapChain(ComPtr(swap_chain))))
        } else {
            Err(Error::from_code(result))
        }
    }
}

impl Device {
    fn create_render_target_view(&self, texture: &Texture2d) -> Result<RenderTargetView> {
        unsafe {
            let mut render_target_view = null_mut();
            let result = (**self.0).CreateRenderTargetView(
                *texture.0 as *mut _,
                null_mut(),
                &mut render_target_view,
            );
            if result == S_OK {
                Ok(RenderTargetView(ComPtr(render_target_view)))
            } else {
                Err(Error::from_code(result))
            }
        }
    }

    fn create_shader_resource_view(
        &self,
        texture: &Texture2d,
        desc: &D3D11_SHADER_RESOURCE_VIEW_DESC,
    ) -> Result<ShaderResourceView> {
        unsafe {
            let mut view = null_mut();
            let result =
                (**self.0).CreateShaderResourceView(*texture.0 as *mut _, desc, &mut view);
            if result == S_OK {
                Ok(ShaderResourceView(ComPtr(view)))
            } else {
                Err(Error::from_code(result))
            }
        }
    }

    fn create_texture2d(&self, desc: &D3D11_TEXTURE2D_DESC) -> Result<Texture2d> {
        unsafe {
            let mut texture = null_mut();
            let result = (**self.0).CreateTexture2D(desc, null_mut(), &mut texture);
            if result == S_OK {
                Ok(Texture2d(ComPtr(texture)))
            } else {
                Err(Error::from_code(result))
            }
        }
    }

    fn create_vertex_buffer(
        &self,
        desc: &D3D11_BUFFER_DESC,
        data: &D3D11_SUBRESOURCE_DATA,
    ) -> Result<Buffer> {
        unsafe {
            let mut buffer = null_mut();
            let result = (**self.0).CreateBuffer(desc, data, &mut buffer);
            if result == S_OK {
                Ok(Buffer(ComPtr(buffer)))
            } else {
                Err(Error::from_code(result))
            }
        }
    }

    fn create_sampler_state(&self, desc: &D3D11_SAMPLER_DESC) -> Result<SamplerState> {
        unsafe {
            let mut state = null_mut();
            let result = (**self.0).CreateSamplerState(desc, &mut state);
            if result == S_OK {
                Ok(SamplerState(ComPtr(state)))
            } else {
                Err(Error::from_code(result))
            }
        }
    }

    fn create_vertex_shader(
        &self,
        code: &[u8],
        desc: &[D3D11_INPUT_ELEMENT_DESC],
    ) -> Result<VertexShader> {
        unsafe {
            let blob = compile_blob(code, "VS_Main", "vs_4_0")
                .context("Compiling shader")?;
            let mut shader = null_mut();
            let result = (**self.0).CreateVertexShader(
                (**blob.0).GetBufferPointer(),
                (**blob.0).GetBufferSize(),
                null_mut(),
                &mut shader,
            );
            if result != S_OK {
                return Err(Error::from_code(result)).context("Creating vertex shader");
            }
            let mut layout = null_mut();
            let result = (**self.0).CreateInputLayout(
                desc.as_ptr(),
                desc.len() as u32,
                (**blob.0).GetBufferPointer(),
                (**blob.0).GetBufferSize(),
                &mut layout,
            );
            if result == S_OK {
                Ok(VertexShader(ComPtr(shader), ComPtr(layout)))
            } else {
                Err(Error::from_code(result))
            }
        }
    }

    fn create_pixel_shader(&self, code: &[u8]) -> Result<PixelShader> {
        unsafe {
            let blob = compile_blob(code, "PS_Main", "ps_4_0")
                .context("Compiling shader")?;
            let mut shader = null_mut();
            let result = (**self.0).CreatePixelShader(
                (**blob.0).GetBufferPointer(),
                (**blob.0).GetBufferSize(),
                null_mut(),
                &mut shader,
            );
            if result == S_OK {
                Ok(PixelShader(ComPtr(shader)))
            } else {
                Err(Error::from_code(result))
            }
        }
    }

    fn map_texture<'a>(&'a self, texture: &'a Texture2d) -> Result<MappedTexture<'a>> {
        unsafe {
            let mut mapped: D3D11_MAPPED_SUBRESOURCE = mem::zeroed();
            let result = (**self.1).Map(
                *texture.0 as *mut _,
                0,
                D3D11_MAP_WRITE_DISCARD,
                0,
                &mut mapped,
            );
            if result == S_OK {
                Ok(MappedTexture(mapped, self, texture))
            } else {
                Err(Error::from_code(result))
            }
        }
    }
}

struct MappedTexture<'a>(D3D11_MAPPED_SUBRESOURCE, &'a Device, &'a Texture2d);

impl<'a> Drop for MappedTexture<'a> {
    fn drop(&mut self) {
        unsafe {
            (**(self.1).1).Unmap(*(self.2).0 as *mut _, 0);
        }
    }
}

impl SwapChain {
    fn back_buffer_texture(&self) -> Result<Texture2d> {
        unsafe {
            let mut texture = null_mut();
            let result = (**self.0).GetBuffer(
                0,
                &ID3D11Texture2D::uuidof(),
                &mut texture,
            );
            if result == S_OK {
                Ok(Texture2d(ComPtr(texture as *mut ID3D11Texture2D)))
            } else {
                Err(Error::from_code(result))
            }
        }
    }
}

unsafe fn client_rect(window: HWND) -> RECT {
    let mut rect: RECT = mem::zeroed();
    GetClientRect(window, &mut rect);
    rect
}

impl Renderer {
    pub fn new(
        window: HWND,
        settings: &Settings,
        ddraw_width: u32,
        ddraw_height: u32,
    ) -> Result<Renderer> {
        let client_rect = unsafe { client_rect(window) };
        let width = (client_rect.right - client_rect.left) as u32;
        let height = (client_rect.bottom - client_rect.top) as u32;
        let (device, swap_chain) = create_device_and_swap_chain(window, width, height)
            .context("Creating device/swap chain")?;
        let ddraw_viewport = D3D11_VIEWPORT {
            Width: ddraw_width as f32,
            Height: ddraw_height as f32,
            MinDepth: 0.0,
            MaxDepth: 0.0,
            TopLeftX: 0.0,
            TopLeftY: 0.0,
        };
        let back_buffer = swap_chain.back_buffer_texture()
            .context("Accessing back buffer texture")?;
        let back_buffer_view = device.create_render_target_view(&back_buffer)
            .context("Creating render target view for back buffer")?;
        let output_rect = settings.get_output_size(&client_rect, ddraw_width, ddraw_height);
        let final_viewport = D3D11_VIEWPORT {
            Width: (output_rect.right - output_rect.left) as f32,
            Height: (output_rect.bottom - output_rect.top) as f32,
            MinDepth: 0.0,
            MaxDepth: 0.0,
            TopLeftX: output_rect.left as f32,
            TopLeftY: output_rect.top as f32,
        };
        let shaders = Shaders::init(&device)
            .context("Creating shaders")?;
        let textures = Textures::init(&device, ddraw_width, ddraw_height)
            .context("Creating textures")?;
        let vertices = Vertices::init(&device)
            .context("Creating vertices")?;
        Ok(Renderer {
            device,
            swap_chain,
            back_buffer_view,
            shaders,
            textures,
            vertices,
            ddraw_viewport,
            final_viewport,
            ddraw_width,
            ddraw_height,
        })
    }

    unsafe fn try_render(&mut self, pixels: &[u8]) -> Result<()> {
        assert_eq!(pixels.len(), self.ddraw_width as usize * self.ddraw_height as usize);
        let mapped = self.device.map_texture(&self.textures.bw_screen_texture)
            .context("Couldn't map BW screen texture")?;

        let mut ptr = mapped.0.pData as *mut u8;
        if mapped.0.RowPitch == self.ddraw_width {
            // No need to go row-by-row, since the rows are directly adjacent
            std::ptr::copy_nonoverlapping(pixels.as_ptr(), ptr, pixels.len());
        } else {
            for row in pixels.chunks_exact(self.ddraw_width as usize) {
                std::ptr::copy_nonoverlapping(row.as_ptr(), ptr, self.ddraw_width as usize);
                ptr = ptr.add(mapped.0.RowPitch as usize);
            }
        }
        drop(mapped);

        // Depalettize image
        let strides = [std::mem::size_of::<Vertex>() as u32];
        let offsets = [0];
        let pixel_shader_resources = [
            *self.textures.bw_screen_view.0,
            *self.textures.palette_view.0,
        ];
        let render_targets = [*self.textures.depalettized_view.0];
        let viewports = [self.ddraw_viewport];
        (**self.device.1).OMSetRenderTargets(1, render_targets.as_ptr(), null_mut());
        (**self.device.1).RSSetViewports(1, viewports.as_ptr());
        (**self.device.1).IASetInputLayout(*self.shaders.depalettized_vertex.1);
        (**self.device.1).IASetVertexBuffers(
            0, 1, &*self.vertices.vertex_buffer.0, strides.as_ptr(), offsets.as_ptr()
        );
        (**self.device.1).IASetPrimitiveTopology(D3D11_PRIMITIVE_TOPOLOGY_TRIANGLESTRIP);
        (**self.device.1).VSSetShader(*self.shaders.depalettized_vertex.0, null_mut(), 0);
        (**self.device.1).PSSetShader(*self.shaders.depalettized_pixel.0, null_mut(), 0);
        (**self.device.1).PSSetShaderResources(0, 2, pixel_shader_resources.as_ptr());
        (**self.device.1).Draw(4, 0);

        let pixel_shader_resources = [null_mut(), null_mut()];
        (**self.device.1).PSSetShaderResources(0, 2, pixel_shader_resources.as_ptr());

        // Render the depalettized texture
        let render_targets = [*self.back_buffer_view.0];
        let viewports = [self.final_viewport];
        let pixel_shader_resources = [*self.textures.rendered_texture_view.0];
        let samplers = [*self.textures.sampler.0];
        (**self.device.1).OMSetRenderTargets(1, render_targets.as_ptr(), null_mut());
        (**self.device.1).RSSetViewports(1, viewports.as_ptr());
        (**self.device.1).PSSetShader(*self.shaders.scaling_pixel.0, null_mut(), 0);
        (**self.device.1).PSSetShaderResources(0, 1, pixel_shader_resources.as_ptr());
        (**self.device.1).PSSetSamplers(0, 1, samplers.as_ptr());
        (**self.device.1).Draw(4, 0);

        let pixel_shader_resources = [null_mut()];
        (**self.device.1).PSSetShaderResources(0, 1, pixel_shader_resources.as_ptr());

        (**self.swap_chain.0).Present(0, 0);
        Ok(())
    }
}

#[repr(C)]
struct Vertex {
    pos: (f32, f32),
    texcoord: (f32, f32),
}

impl Vertices {
    fn init(device: &Device) -> Result<Vertices> {
        let vertices = &[Vertex {
            pos: (-1.0, -1.0),
            texcoord: (0.0, 1.0),
        }, Vertex {
            pos: (-1.0, 1.0),
            texcoord: (0.0, 0.0),
        }, Vertex {
            pos: (1.0, -1.0),
            texcoord: (1.0, 1.0),
        }, Vertex {
            pos: (1.0, 1.0),
            texcoord: (1.0, 0.0),
        }];
        let vertex_size = mem::size_of::<Vertex>() as u32;
        assert_eq!(vertex_size, 0x10);
        let desc = D3D11_BUFFER_DESC {
            Usage: D3D11_USAGE_IMMUTABLE,
            ByteWidth: vertex_size * 4,
            BindFlags: D3D11_BIND_VERTEX_BUFFER,
            CPUAccessFlags: 0,
            MiscFlags: 0,
            StructureByteStride: 0,
        };
        let data = D3D11_SUBRESOURCE_DATA {
            pSysMem: vertices.as_ptr() as *const _,
            SysMemPitch: 0,
            SysMemSlicePitch: 0,
        };
        let vertex_buffer = device.create_vertex_buffer(&desc, &data)
            .context("Creating vertex buffer")?;
        Ok(Vertices {
            vertex_buffer,
        })
    }
}

impl Shaders {
    fn init(device: &Device) -> Result<Shaders> {
        let input_desc = &[D3D11_INPUT_ELEMENT_DESC {
            SemanticName: "POSITION\0".as_ptr() as *const i8,
            SemanticIndex: 0,
            Format: DXGI_FORMAT_R32G32_FLOAT,
            InputSlot: 0,
            AlignedByteOffset: 0,
            InputSlotClass: D3D11_INPUT_PER_VERTEX_DATA,
            InstanceDataStepRate: 0,
        }, D3D11_INPUT_ELEMENT_DESC {
            SemanticName: "TEXCOORD\0".as_ptr() as *const i8,
            SemanticIndex: 0,
            Format: DXGI_FORMAT_R32G32_FLOAT,
            InputSlot: 0,
            AlignedByteOffset: 8,
            InputSlotClass: D3D11_INPUT_PER_VERTEX_DATA,
            InstanceDataStepRate: 0,
        }];
        let depalettized_vertex = device.create_vertex_shader(
            include_bytes!("shaders/directx/vs_depalettizing.hlsl"),
            input_desc,
        ).context("Creating depalettized vertex shader")?;
        let depalettized_pixel =
            device.create_pixel_shader(include_bytes!("shaders/directx/ps_depalettizing.hlsl"))
                .context("Creating depalettized pixel shader")?;
        let scaling_pixel =
            device.create_pixel_shader(include_bytes!("shaders/directx/ps_scaling.hlsl"))
                .context("Creating scaling pixel shader")?;
        Ok(Shaders {
            depalettized_vertex,
            depalettized_pixel,
            scaling_pixel,
        })
    }

}

impl Textures {
    fn init(device: &Device, ddraw_width: u32, ddraw_height: u32) -> Result<Textures> {
        let texture_desc = D3D11_TEXTURE2D_DESC {
            Width: ddraw_width,
            Height: ddraw_height,
            MipLevels: 1,
            ArraySize: 1,
            Format: DXGI_FORMAT_R8G8B8A8_UNORM,
            SampleDesc: DXGI_SAMPLE_DESC {
                Count: 1,
                Quality: 0,
            },
            Usage: D3D11_USAGE_DEFAULT,
            BindFlags: D3D11_BIND_RENDER_TARGET | D3D11_BIND_SHADER_RESOURCE,
            CPUAccessFlags: 0,
            MiscFlags: 0,
        };
        let rendered_texture = device.create_texture2d(&texture_desc)
            .context("Creating rendered texture")?;

        let view_desc = view_desc_from_texture2d_desc(&texture_desc);
        let rendered_texture_view =
            device.create_shader_resource_view(&rendered_texture, &view_desc)
                .context("Creating rendered texture shader resource view")?;

        let depalettized_view = device.create_render_target_view(&rendered_texture)
            .context("Creating render target view for render texture")?;

        let texture_desc = D3D11_TEXTURE2D_DESC {
            Width: ddraw_width,
            Height: ddraw_height,
            MipLevels: 1,
            ArraySize: 1,
            Format: DXGI_FORMAT_R8_UINT,
            SampleDesc: DXGI_SAMPLE_DESC {
                Count: 1,
                Quality: 0,
            },
            Usage: D3D11_USAGE_DYNAMIC,
            BindFlags: D3D11_BIND_SHADER_RESOURCE,
            CPUAccessFlags: D3D11_CPU_ACCESS_WRITE,
            MiscFlags: 0,
        };
        let bw_screen_texture = device.create_texture2d(&texture_desc)
            .context("Creating BW screen texture")?;

        let view_desc = view_desc_from_texture2d_desc(&texture_desc);
        let bw_screen_view = device.create_shader_resource_view(&bw_screen_texture, &view_desc)
            .context("Creating BW screen texture shader resource view")?;

        let texture_desc = D3D11_TEXTURE2D_DESC {
            Width: 256,
            Height: 1,
            MipLevels: 1,
            ArraySize: 1,
            Format: DXGI_FORMAT_R8G8B8A8_UNORM,
            SampleDesc: DXGI_SAMPLE_DESC {
                Count: 1,
                Quality: 0,
            },
            Usage: D3D11_USAGE_DYNAMIC,
            BindFlags: D3D11_BIND_SHADER_RESOURCE,
            CPUAccessFlags: D3D11_CPU_ACCESS_WRITE,
            MiscFlags: 0,
        };
        let palette_texture = device.create_texture2d(&texture_desc)
            .context("Creating palette texture")?;

        let view_desc = view_desc_from_texture2d_desc(&texture_desc);
        let palette_view = device.create_shader_resource_view(&palette_texture, &view_desc)
            .context("Creating palette texture shader resource view")?;

        let sampler_desc = D3D11_SAMPLER_DESC {
            Filter: D3D11_FILTER_MIN_MAG_MIP_LINEAR,
            AddressU: D3D11_TEXTURE_ADDRESS_CLAMP,
            AddressV: D3D11_TEXTURE_ADDRESS_CLAMP,
            AddressW: D3D11_TEXTURE_ADDRESS_CLAMP,
            MipLODBias: 0.0,
            MaxAnisotropy: 0,
            ComparisonFunc: D3D11_COMPARISON_NEVER,
            MinLOD: 0.0,
            MaxLOD: D3D11_FLOAT32_MAX,
            BorderColor: [0.0; 4],
        };
        let sampler = device.create_sampler_state(&sampler_desc)
            .context("Creating sampler state")?;

        Ok(Textures {
            rendered_texture,
            rendered_texture_view,
            bw_screen_texture,
            bw_screen_view,
            palette_texture,
            palette_view,
            depalettized_view,
            sampler,
        })
    }
}

lazy_static! {
    static ref D3D_COMPILE: unsafe extern "stdcall" fn(
        *const c_void,
        usize,
        *const u8,
        *const D3D_SHADER_MACRO,
        *mut ID3DInclude,
        *const u8,
        *const u8,
        u32,
        u32,
        *mut *mut ID3DBlob,
        *mut *mut ID3DBlob,
    ) -> i32 = unsafe {
        let (path, _) = windows::module_from_address(compile_blob as *mut c_void)
            .expect("Unable to get own module");
        let path = Path::new(&path);
        let this_dll_dir = path.parent().unwrap();
        // Ideally we'd be in dist/ directory with d3dcompiler dll
        let mut d3dcompiler_path = this_dll_dir.join("d3dcompiler_47.dll");
        if !d3dcompiler_path.is_file() {
            debug!("{} is not a file", d3dcompiler_path.display());
            // Though also try to look at shieldbattery/game/dist if we're at
            // shieldbattery/game/rust-dll/target/i686-pc-windows-msvc/{debug, release}
            fn parent4(path: &Path) -> Option<&Path> {
                Some(path.parent()?.parent()?.parent()?.parent()?)
            }
            d3dcompiler_path = parent4(&this_dll_dir).unwrap().join("dist/d3dcompiler_47.dll");
            if !d3dcompiler_path.is_file() {
                debug!("{} is not a file", d3dcompiler_path.display());
                panic!("Can't find d3dcompiler_47.dll");
            }
        }
        let dll = windows::load_library(d3dcompiler_path).expect("Couldn't load d3dcompiler");
        let func = dll.proc_address("D3DCompile").expect("Couldn't find D3DCompile");
        mem::forget(dll); // Keep dll loaded
        mem::transmute(func)
    };
}

unsafe fn compile_blob(code: &[u8], ty: &str, version: &str) -> Result<Blob> {
    let mut ty: Vec<u8> = ty.as_bytes().into();
    ty.push(0);
    let mut version: Vec<u8> = version.as_bytes().into();
    version.push(0);
    let compile = *D3D_COMPILE;
    let mut blob = null_mut();
    let mut error_blob = null_mut();
    let result = compile(
        code.as_ptr() as *const c_void,
        code.len(),
        null_mut(),
        null_mut(),
        null_mut(),
        ty.as_ptr(),
        version.as_ptr(),
        0,
        0,
        &mut blob,
        &mut error_blob,
    );
    if result == S_OK {
        Ok(Blob(ComPtr(blob)))
    } else {
        // TODO error blob
        Err(Error::from_code(result))
    }
}

fn view_desc_from_texture2d_desc(
    texture_desc: &D3D11_TEXTURE2D_DESC,
) -> D3D11_SHADER_RESOURCE_VIEW_DESC {
    unsafe {
        let mut desc: D3D11_SHADER_RESOURCE_VIEW_DESC = mem::zeroed();
        desc.Format = texture_desc.Format;
        desc.ViewDimension = D3D11_SRV_DIMENSION_TEXTURE2D;
        desc.u.Texture2D_mut().MipLevels = texture_desc.MipLevels;
        desc
    }
}

impl RenderApi for Renderer {
    fn update_palette(&mut self, palette: &[PALETTEENTRY]) {
        let mapped = match self.device.map_texture(&self.textures.palette_texture) {
            Ok(o) => o,
            Err(e) => {
                error!("Couldn't map palette texture: {}", e);
                return;
            }
        };
        unsafe {
            let mut ptr = mapped.0.pData as *mut u8;
            for color in palette {
                *ptr.add(0) = color.peRed;
                *ptr.add(1) = color.peGreen;
                *ptr.add(2) = color.peBlue;
                *ptr.add(3) = 255;
                ptr = ptr.add(4);
            }
        }
    }

    fn render(&mut self, pixels: &[u8]) {
        if let Err(e) = unsafe { self.try_render(pixels) } {
            error!("Rendering error {}", e);
        }
    }
}
