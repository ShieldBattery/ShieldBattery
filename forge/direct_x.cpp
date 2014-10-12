#include "forge/direct_x.h"

#include <map>
#include <vector>
#include <string>

#include "forge/indirect_draw.h"
#include "forge/forge.h"
#include "logger/logger.h"

namespace sbat {
namespace forge {

using std::map;
using std::pair;
using std::string;
using std::unique_ptr;

string DirectX::last_error_ = "";

unique_ptr<DirectX> DirectX::Create(HWND window, uint32 ddraw_width, uint32 ddraw_height,
    RendererDisplayMode display_mode, bool maintain_aspect_ratio,
    const map<string, pair<string, string>>& shaders) {
  unique_ptr<DirectX> direct_x(
      new DirectX(window, ddraw_width, ddraw_height, display_mode, maintain_aspect_ratio, shaders));

  if (direct_x->has_error()) {
    Logger::Log(LogLevel::Error, "IndirectDraw failed to initialize DirectX");
    last_error_ = direct_x->error();
    Logger::Log(LogLevel::Error, direct_x->error().c_str());
    direct_x.release();
  } else {
    last_error_ = "";
    Logger::Log(LogLevel::Verbose, "IndirectDraw initialized DirectX successfully");
  }

  return direct_x;
}

void ReleaseCOM(IUnknown* dx_interface) {
  if (dx_interface) {
    dx_interface->Release();
  }
  dx_interface = NULL;
}

string GetErrorMsg(HRESULT result) {
  _com_error error(result);
  return std::string(error.ErrorMessage());
}

string DirectX::GetLastError() {
  return last_error_;
}

DxRenderTargetView::DxRenderTargetView(ID3D10RenderTargetView& render_target_view)
  : render_target_view_(&render_target_view) {
}

DxRenderTargetView::~DxRenderTargetView() {
  ReleaseCOM(render_target_view_);
}

DxShaderResourceView::DxShaderResourceView(ID3D10ShaderResourceView& shader_resource_view)
  : shader_resource_view_(&shader_resource_view) {
}

DxShaderResourceView::~DxShaderResourceView() {
  ReleaseCOM(shader_resource_view_);
}

DxMappedTexture::DxMappedTexture(D3D10_MAPPED_TEXTURE2D mapped_texture)
  : mapped_texture_(mapped_texture) {
}

DxMappedTexture::~DxMappedTexture() {
}

DxTexture::DxTexture(ID3D10Texture2D& texture)
  : texture_(&texture) {
}

unique_ptr<DxRenderTargetView> DxTexture::CreateRenderTargetView(DxDevice& device) {
  return device.CreateRenderTargetView(*texture_);
}

unique_ptr<DxShaderResourceView> DxTexture::CreateShaderResourceView(DxDevice& device,
    D3D10_SHADER_RESOURCE_VIEW_DESC srv_desc) {
  return device.CreateShaderResourceView(*texture_, srv_desc);
}

DxMappedTexture* DxTexture::Map(UINT subresource) {
  D3D10_MAPPED_TEXTURE2D mapped_texture;
  HRESULT result = texture_->Map(subresource, D3D10_MAP_WRITE_DISCARD, 0, &mapped_texture);
  if (result != S_OK) {
    Logger::Logf(LogLevel::Error, "Error mapping a texture: %s", GetErrorMsg(result));
    return nullptr;
  } else {
    return new DxMappedTexture(mapped_texture);
  }
}

void DxTexture::Unmap(UINT subresource) {
  texture_->Unmap(subresource);
}

DxTexture::~DxTexture() {
  ReleaseCOM(texture_);
}

DxSwapChain::DxSwapChain(IDXGISwapChain& swap_chain)
  : swap_chain_(&swap_chain) {
}

unique_ptr<DxTexture> DxSwapChain::GetBuffer() {
  ID3D10Texture2D* texture;
  HRESULT result = swap_chain_->GetBuffer(0, __uuidof(ID3D10Texture2D),
      reinterpret_cast<void**>(&texture));
  if (result != S_OK) {
    Logger::Logf(LogLevel::Error, "Error getting a buffer texture: %s", GetErrorMsg(result));
    return nullptr;
  } else {
    return std::unique_ptr<DxTexture>(new DxTexture(*texture));
  }
}

DxSwapChain::~DxSwapChain() {
  ReleaseCOM(swap_chain_);
}

DxBlob::DxBlob(const std::string& src, LPCSTR type, LPCSTR version)
  : blob_(nullptr),
    error_blob_(nullptr),
    result_(NULL) {
  result_ = D3DCompile(src.c_str(), src.length(), NULL, NULL, NULL, type, version,
      NULL, NULL, &blob_, &error_blob_);
}

DxBlob::~DxBlob() {
  ReleaseCOM(error_blob_);
  ReleaseCOM(blob_);
}

DxVertexBlob::DxVertexBlob(const std::string& src)
  : DxBlob(src, "VS_Main", "vs_4_0") {
}

DxVertexBlob::~DxVertexBlob() {
}

DxPixelBlob::DxPixelBlob(const std::string& src)
  : DxBlob(src, "PS_Main", "ps_4_0") {
}

DxPixelBlob::~DxPixelBlob() {
}

DxVertexShader::DxVertexShader(ID3D10VertexShader& vertex_shader)
  : vertex_shader_(&vertex_shader) {
}

DxVertexShader::~DxVertexShader() {
  ReleaseCOM(vertex_shader_);
}

DxPixelShader::DxPixelShader(ID3D10PixelShader& pixel_shader)
  : pixel_shader_(&pixel_shader) {
}

DxPixelShader::~DxPixelShader() {
  ReleaseCOM(pixel_shader_);
}

DxInputLayout::DxInputLayout(ID3D10InputLayout& input_layout)
  : input_layout_(&input_layout) {
}

DxInputLayout::~DxInputLayout() {
  ReleaseCOM(input_layout_);
}

DxBuffer::DxBuffer(ID3D10Buffer& buffer)
  : buffer_(&buffer) {
}

DxSamplerState::DxSamplerState(ID3D10SamplerState& sampler_state)
  : sampler_state_(&sampler_state) {
}

DxSamplerState::~DxSamplerState() {
  ReleaseCOM(sampler_state_);
}

DxBuffer::~DxBuffer() {
  ReleaseCOM(buffer_);
}

DxVertexBuffer::DxVertexBuffer(ID3D10Buffer& buffer)
  : DxBuffer(buffer) {
}

DxVertexBuffer::~DxVertexBuffer() {
}

DxDevice::DxDevice()
  : device_(nullptr),
    dxgi_device_(nullptr),
    dxgi_adapter_(nullptr),
    dxgi_factory_(nullptr),
    result_(NULL) {
  result_ = D3D10CreateDevice(0, D3D10_DRIVER_TYPE_HARDWARE, 0, 0, D3D10_SDK_VERSION, &device_);
}

unique_ptr<DxSwapChain> DxDevice::CreateSwapChain(DXGI_SWAP_CHAIN_DESC swap_chain_desc) {
  IDXGISwapChain* swap_chain;
  HRESULT result = device_->QueryInterface(__uuidof(IDXGIDevice),
      reinterpret_cast<void**>(&dxgi_device_));
  if (result != S_OK) {
    Logger::Logf(LogLevel::Error, "Error querying a device interface: %s", GetErrorMsg(result));
    return nullptr;
  } else {
    result = dxgi_device_->GetParent(__uuidof(IDXGIAdapter),
        reinterpret_cast<void**>(&dxgi_adapter_));
  }
  if (result != S_OK) {
    Logger::Logf(LogLevel::Error, "Error getting a dxgi adapter: %s", GetErrorMsg(result));
    return nullptr;
  } else {
    result = dxgi_adapter_->GetParent(__uuidof(IDXGIFactory),
        reinterpret_cast<void**>(&dxgi_factory_));
  }
  if (result != S_OK) {
    Logger::Logf(LogLevel::Error, "Error getting a dxgi factory: %s", GetErrorMsg(result));
    return nullptr;
  } else {
    result = dxgi_factory_->CreateSwapChain(device_, &swap_chain_desc, &swap_chain);
  }
  if (result != S_OK) {
    Logger::Logf(LogLevel::Error, "Error creating a DirectX swap chain: %s", GetErrorMsg(result));
    return nullptr;
  } else {
    return unique_ptr<DxSwapChain>(new DxSwapChain(*swap_chain));
  }
}

unique_ptr<DxVertexShader> DxDevice::CreateVertexShader(const DxVertexBlob& vertex_blob) {
  ID3D10VertexShader* vertex_shader;
  HRESULT result = device_->CreateVertexShader(vertex_blob.GetBufferPointer(),
      vertex_blob.GetBufferSize(), &vertex_shader);
  if (result != S_OK) {
    Logger::Logf(LogLevel::Error, "Error creating a vertex shader: %s", GetErrorMsg(result));
    return nullptr;
  } else {
    return unique_ptr<DxVertexShader>(new DxVertexShader(*vertex_shader));
  }
}

unique_ptr<DxPixelShader> DxDevice::CreatePixelShader(const DxPixelBlob& pixel_blob) {
  ID3D10PixelShader* pixel_shader;
  HRESULT result = device_->CreatePixelShader(pixel_blob.GetBufferPointer(),
      pixel_blob.GetBufferSize(), &pixel_shader);
  if (result != S_OK) {
    Logger::Logf(LogLevel::Error, "Error creating a pixel shader: %s", GetErrorMsg(result));
    return nullptr;
  } else {
    return unique_ptr<DxPixelShader>(new DxPixelShader(*pixel_shader));
  }
}

unique_ptr<DxTexture> DxDevice::CreateTexture2D(D3D10_TEXTURE2D_DESC texture_desc) {
  ID3D10Texture2D* texture;
  HRESULT result = device_->CreateTexture2D(&texture_desc, NULL, &texture);
  if (result != S_OK) {
    Logger::Logf(LogLevel::Error, "Error creating a texture: %s", GetErrorMsg(result));
    return nullptr;
  } else {
    return unique_ptr<DxTexture>(new DxTexture(*texture));
  }
}

unique_ptr<DxInputLayout> DxDevice::CreateInputLayout(
    const D3D10_INPUT_ELEMENT_DESC& input_layout_desc,
    UINT desc_size, const DxVertexBlob& vertex_blob) {
  ID3D10InputLayout* input_layout;
  HRESULT result = device_->CreateInputLayout(&input_layout_desc, desc_size,
      vertex_blob.GetBufferPointer(), vertex_blob.GetBufferSize(), &input_layout);
  if (result != S_OK) {
    Logger::Logf(LogLevel::Error, "Error creating an input layout: %s", GetErrorMsg(result));
    return nullptr;
  } else {
    return unique_ptr<DxInputLayout>(new DxInputLayout(*input_layout));
  }
}

unique_ptr<DxRenderTargetView> DxDevice::CreateRenderTargetView(ID3D10Texture2D& texture) {
  ID3D10RenderTargetView* render_target_view;
  HRESULT result = device_->CreateRenderTargetView(&texture, NULL, &render_target_view);
  if (result != S_OK) {
    Logger::Logf(LogLevel::Error, "Error creating a render target view: %s", GetErrorMsg(result));
    return nullptr;
  } else {
    return unique_ptr<DxRenderTargetView>(new DxRenderTargetView(*render_target_view));
  }
}

unique_ptr<DxShaderResourceView> DxDevice::CreateShaderResourceView(ID3D10Texture2D& texture,
    D3D10_SHADER_RESOURCE_VIEW_DESC srv_desc) {
  ID3D10ShaderResourceView* shader_resource_view;
  HRESULT result = device_->CreateShaderResourceView(&texture, &srv_desc, &shader_resource_view);
  if (result != S_OK) {
    Logger::Logf(LogLevel::Error, "Error creating a shader resource view: %s",
        GetErrorMsg(result));
    return nullptr;
  } else {
    return unique_ptr<DxShaderResourceView>(new DxShaderResourceView(*shader_resource_view));
  }
}

unique_ptr<DxSamplerState> DxDevice::CreateSamplerState(D3D10_SAMPLER_DESC sampler_desc) {
  ID3D10SamplerState* sampler_state;
  HRESULT result = device_->CreateSamplerState(&sampler_desc, &sampler_state);
  if (result != S_OK) {
    Logger::Logf(LogLevel::Error, "Error creating a texture sampler: %s", GetErrorMsg(result));
    return nullptr;
  } else {
    return unique_ptr<DxSamplerState>(new DxSamplerState(*sampler_state));
  }
}

unique_ptr<DxVertexBuffer> DxDevice::CreateVertexBuffer(D3D10_BUFFER_DESC buffer_desc,
    D3D10_SUBRESOURCE_DATA buffer_data) {
  ID3D10Buffer* vertex_buffer;
  HRESULT result = device_->CreateBuffer(&buffer_desc, &buffer_data, &vertex_buffer);
  if (result != S_OK) {
    Logger::Logf(LogLevel::Error, "Error creating a vertex buffer: %s", GetErrorMsg(result));
    return nullptr;
  } else {
    return unique_ptr<DxVertexBuffer>(new DxVertexBuffer(*vertex_buffer));
  }
}

DxDevice::~DxDevice() {
  ReleaseCOM(dxgi_factory_);
  ReleaseCOM(dxgi_adapter_);
  ReleaseCOM(dxgi_device_);
  ReleaseCOM(device_);
}

// Constructing this *can* fail and leave a partially uninitialized object. The assumption is that
// this constructor will only ever be called by the factory method, and the factory method will take
// care of deleting any errored objects instead of returning them higher up, so no methods outside
// of the constructor will need to check for such a state.
DirectX::DirectX(HWND window, uint32 ddraw_width, uint32 ddraw_height,
    RendererDisplayMode display_mode, bool maintain_aspect_ratio,
    const map<string, pair<string, string>>& shaders)
  : error_(),
    window_(window),
    client_rect_(),
    dx_device_(nullptr),
    dx_swap_chain_(nullptr),
    back_buffer_(nullptr),
    back_buffer_render_target_view_(nullptr),
    depalettized_render_target_view_(nullptr),
    depalettized_vertex_shader_(nullptr),
    depalettized_pixel_shader_(nullptr),
    input_layout_(nullptr),
    scaling_pixel_shader_(nullptr),
    vertex_buffer_(nullptr),
    palette_texture_(nullptr),
    bw_screen_texture_(nullptr),
    rendered_texture_(nullptr),
    bw_screen_view_(nullptr),
    palette_view_(nullptr),
    rendered_view_(nullptr),
    rendered_texture_sampler_(nullptr),
    ddraw_width_(ddraw_width),
    ddraw_height_(ddraw_height),
    display_mode_(display_mode),
    maintain_aspect_ratio_(maintain_aspect_ratio),
    aspect_ratio_width_(0),
    aspect_ratio_height_(0),
    counter_frequency_(),
    last_frame_time_() {
  Logger::Log(LogLevel::Verbose, "IndirectDraw initializing DirectX");
  GetClientRect(window, &client_rect_);

  unsigned int width = client_rect_.right - client_rect_.left;
  unsigned int height = client_rect_.bottom - client_rect_.top;

  dx_device_.reset(new DxDevice);
  if (dx_device_->get_result() != S_OK) {
    Logger::Logf(LogLevel::Error, "Error creating a DirectX device: %s",
        GetErrorMsg(dx_device_->get_result()));
    error_ = "Error creating a DirectX device";
    return;
  } else if (DIRECTDRAWLOG) {
    Logger::Log(LogLevel::Verbose, "DirectX device created");
  }

  DXGI_SWAP_CHAIN_DESC swap_chain_desc = DXGI_SWAP_CHAIN_DESC();
  swap_chain_desc.BufferCount = 1;
  swap_chain_desc.BufferDesc.Width = width;
  swap_chain_desc.BufferDesc.Height = height;
  swap_chain_desc.BufferDesc.Format = DXGI_FORMAT_R8G8B8A8_UNORM;
  swap_chain_desc.BufferDesc.RefreshRate.Numerator = 60;
  swap_chain_desc.BufferDesc.RefreshRate.Denominator = 1;
  swap_chain_desc.BufferUsage = DXGI_USAGE_RENDER_TARGET_OUTPUT;
  swap_chain_desc.OutputWindow = window_;
  swap_chain_desc.Windowed = true;
  swap_chain_desc.SampleDesc.Count = 1;
  swap_chain_desc.SampleDesc.Quality = 0;

  dx_swap_chain_ = dx_device_->CreateSwapChain(swap_chain_desc);
  if (!dx_swap_chain_) {
    error_ = "Error creating a DirectX swap chain";
    return;
  } else if (DIRECTDRAWLOG) {
    Logger::Log(LogLevel::Verbose, "DirectX swap chain created");
  }

  back_buffer_ = dx_swap_chain_->GetBuffer();
  if (!back_buffer_) {
    error_ = "Error getting a back buffer texture";
    return;
  } else if (DIRECTDRAWLOG) {
    Logger::Log(LogLevel::Verbose, "Back buffer texture retrieved");
  }

  back_buffer_render_target_view_ = back_buffer_->CreateRenderTargetView(*dx_device_);
  if (!back_buffer_render_target_view_) {
    error_ = "Error creating a back buffer render target view";
    return;
  } else if (DIRECTDRAWLOG) {
    Logger::Log(LogLevel::Verbose, "Back buffer render target view created");
  }

  if (display_mode_ == RendererDisplayMode::FullScreen && maintain_aspect_ratio_) {
    aspect_ratio_width_ = client_rect_.right;
    aspect_ratio_height_ = client_rect_.bottom;

    float original_ratio = ((float) ddraw_width) / ddraw_height;
    float actual_ratio = ((float) aspect_ratio_width_) / aspect_ratio_height_;
    if (original_ratio > actual_ratio) {
      float height_unrounded = aspect_ratio_width_ / original_ratio;
      while (height_unrounded - (static_cast<int>(height_unrounded)) > 0.0001f) {
        // we want to avoid having fractional parts to avoid weird alignments in linear filtering,
        // so we decrease the width until no fractions are necessary. Since BW is 4:3, this can be
        // done in 3 steps or less
        aspect_ratio_width_--;
        height_unrounded = aspect_ratio_width_ / original_ratio;
      }
      aspect_ratio_height_ = static_cast<int>(height_unrounded);
    } else {
      float width_unrounded = aspect_ratio_height_ * original_ratio;
      while (width_unrounded - (static_cast<int>(width_unrounded)) > 0.0001f) {
        // same as above, we decrease the height to avoid rounding errors
        aspect_ratio_height_--;
        width_unrounded = aspect_ratio_height_ * original_ratio;
      }
      aspect_ratio_width_ = static_cast<int>(width_unrounded);
    }
  }

  QueryPerformanceFrequency(&counter_frequency_);
  counter_frequency_.QuadPart /= 1000LL;  // convert to ticks per millisecond

  if (!InitShaders(shaders)) {
    return;
  }

  if (!InitTextures()) {
    return;
  }

  if (!InitVertices()) {
    return;
  }
}

bool DirectX::InitShaders(const map<string, pair<string, string>>& shaders) {
  if (shaders.count("depalettizing") != 0) {
    if (!InitDepalettizingShader(shaders)) {
      return false;
    }
  } else {
    error_ = "No depalettizing shader found";
    return false;
  }
  if (shaders.count("scaling") != 0) {
    if (!InitScalingShader(shaders)) {
      return false;
    }
  } else {
    error_ = "No scaling shader found";
    return false;
  }

  return true;
}

bool DirectX::InitDepalettizingShader(const map<string, pair<string, string>>& shaders) {
  const pair<string, string> shader_pair = shaders.at("depalettizing");

  DxVertexBlob vertex_blob(shader_pair.first);
  if (vertex_blob.has_error()) {
    Logger::Logf(LogLevel::Error, "Error compiling a palettizing vertex shader: %s",
      vertex_blob.GetErrorBufferPointer());
    error_ = "Error compiling a palettizing vertex shader";
    return false;
  } else if (DIRECTDRAWLOG) {
    Logger::Log(LogLevel::Verbose, "Palettizing vertex shader compiled");
  }

  depalettized_vertex_shader_ = dx_device_->CreateVertexShader(vertex_blob);
  if (!depalettized_vertex_shader_) {
    error_ = "Error creating a palettizing vertex shader";
    return false;
  } else if (DIRECTDRAWLOG) {
    Logger::Log(LogLevel::Verbose, "Palettizing vertex shader created");
  }

  D3D10_INPUT_ELEMENT_DESC input_layout_desc[] =
  {
      { "POSITION", 0, DXGI_FORMAT_R32G32_FLOAT, 0, 0, D3D10_INPUT_PER_VERTEX_DATA, 0 },
      { "TEXCOORD", 0, DXGI_FORMAT_R32G32_FLOAT, 0, 8, D3D10_INPUT_PER_VERTEX_DATA, 0 }
  };

  input_layout_ = dx_device_->CreateInputLayout(*input_layout_desc, ARRAYSIZE(input_layout_desc),
      vertex_blob);
  if (!input_layout_) {
    error_ = "Error creating an input layout";
    return false;
  } else if (DIRECTDRAWLOG) {
    Logger::Log(LogLevel::Verbose, "Input layout created");
  }
    
  DxPixelBlob pixel_blob(shader_pair.second);
  if (pixel_blob.has_error()) {
    Logger::Logf(LogLevel::Error, "Error compiling a palettizing pixel shader: %s",
      pixel_blob.GetErrorBufferPointer());
    error_ = "Error compiling a palettizing pixel shader";
    return false;
  } else if (DIRECTDRAWLOG) {
    Logger::Log(LogLevel::Verbose, "Palettizing pixel shader compiled");
  }
    
  depalettized_pixel_shader_ = dx_device_->CreatePixelShader(pixel_blob);
  if (!depalettized_pixel_shader_) {
    error_ = "Error creating a depalettizing pixel shader";
    return false;
  } else if (DIRECTDRAWLOG) {
    Logger::Log(LogLevel::Verbose, "Depalettizing pixel shader created");
  }

  return true;
}

bool DirectX::InitScalingShader(const map<string, pair<string, string>>& shaders) {
  const pair<string, string> shader_pair = shaders.at("scaling");

  DxPixelBlob pixel_blob(shader_pair.second);
  if (pixel_blob.has_error()) {
    Logger::Logf(LogLevel::Error, "Error compiling a scaling pixel shader: %s",
      pixel_blob.GetErrorBufferPointer());
    error_ = "Error compiling a scaling pixel shader";
    return false;
  } else if (DIRECTDRAWLOG) {
    Logger::Log(LogLevel::Verbose, "Scaling pixel shader compiled");
  }

  scaling_pixel_shader_ = dx_device_->CreatePixelShader(pixel_blob);
  if (!scaling_pixel_shader_) {
    error_ = "Error creating a scaling pixel shader";
    return false;
  } else if (DIRECTDRAWLOG) {
    Logger::Log(LogLevel::Verbose, "Scaling pixel shader created");
  }

  return true;
}

bool DirectX::InitTextures() {
  if (!InitRenderedTexture()) {
    return false;
  }

  if (!InitBwScreenTexture()) {
    return false;
  }

  if (!InitPaletteTexture()) {
    return false;
  }

  D3D10_SAMPLER_DESC rendered_texture_sampler_desc = D3D10_SAMPLER_DESC();
  rendered_texture_sampler_desc.Filter = D3D10_FILTER_MIN_MAG_MIP_LINEAR;
  rendered_texture_sampler_desc.AddressU = D3D10_TEXTURE_ADDRESS_WRAP;
  rendered_texture_sampler_desc.AddressV = D3D10_TEXTURE_ADDRESS_WRAP;
  rendered_texture_sampler_desc.AddressW = D3D10_TEXTURE_ADDRESS_WRAP;
  rendered_texture_sampler_desc.ComparisonFunc = D3D10_COMPARISON_NEVER;
  rendered_texture_sampler_desc.MinLOD = 0;
  rendered_texture_sampler_desc.MaxLOD = D3D10_FLOAT32_MAX;

  rendered_texture_sampler_ = dx_device_->CreateSamplerState(rendered_texture_sampler_desc);
  if (!rendered_texture_sampler_) {
    error_ = "Error creating a rendered texture sampler";
    return false;
  } else if (DIRECTDRAWLOG) {
    Logger::Log(LogLevel::Verbose, "Rendered texture sampler created");
  }

  return true;
}

bool DirectX::InitRenderedTexture() {
  D3D10_TEXTURE2D_DESC rendered_texture_desc = D3D10_TEXTURE2D_DESC();
  rendered_texture_desc.Width = ddraw_width_;
  rendered_texture_desc.Height = ddraw_height_;
  rendered_texture_desc.MipLevels = 1;
  rendered_texture_desc.ArraySize = 1;
  rendered_texture_desc.Format = DXGI_FORMAT_R8G8B8A8_UNORM;
  rendered_texture_desc.Usage = D3D10_USAGE_DEFAULT;
  rendered_texture_desc.BindFlags = D3D10_BIND_RENDER_TARGET | D3D10_BIND_SHADER_RESOURCE;
  rendered_texture_desc.SampleDesc.Count = 1;

  rendered_texture_ = dx_device_->CreateTexture2D(rendered_texture_desc);
  if (!rendered_texture_) {
    error_ = "Error creating a rendered texture";
    return false;
  } else if (DIRECTDRAWLOG) {
    Logger::Log(LogLevel::Verbose, "Rendered texture created");
  }

  D3D10_SHADER_RESOURCE_VIEW_DESC srv_desc = D3D10_SHADER_RESOURCE_VIEW_DESC();
  srv_desc.Format = rendered_texture_desc.Format;
  srv_desc.ViewDimension = D3D10_SRV_DIMENSION_TEXTURE2D;
  srv_desc.Texture2D.MipLevels = rendered_texture_desc.MipLevels;

  rendered_view_ = rendered_texture_->CreateShaderResourceView(*dx_device_, srv_desc);
  if (!rendered_view_) {
    error_ = "Error creating a rendered resource view";
    return false;
  } else if (DIRECTDRAWLOG) {
    Logger::Log(LogLevel::Verbose, "Rendered resource view created");
  }

  depalettized_render_target_view_ = rendered_texture_->CreateRenderTargetView(*dx_device_);
  if (!depalettized_render_target_view_) {
    error_ = "Error creating a depalettized render target view";
    return false;
  } else if (DIRECTDRAWLOG) {
    Logger::Log(LogLevel::Verbose, "Depalettized render target view created");
  }

  return true;
}

bool DirectX::InitBwScreenTexture() {
  D3D10_TEXTURE2D_DESC bw_screen_texture_desc = D3D10_TEXTURE2D_DESC();
  bw_screen_texture_desc.Width = ddraw_width_;
  bw_screen_texture_desc.Height = ddraw_height_;
  bw_screen_texture_desc.MipLevels = 1;
  bw_screen_texture_desc.ArraySize = 1;
  bw_screen_texture_desc.Format = DXGI_FORMAT_R8_UINT;
  bw_screen_texture_desc.Usage = D3D10_USAGE_DYNAMIC;
  bw_screen_texture_desc.BindFlags = D3D10_BIND_SHADER_RESOURCE;
  bw_screen_texture_desc.CPUAccessFlags = D3D10_CPU_ACCESS_WRITE;
  bw_screen_texture_desc.SampleDesc.Count = 1;

  bw_screen_texture_ = dx_device_->CreateTexture2D(bw_screen_texture_desc);
  if (!bw_screen_texture_) {
    error_ = "Error creating a BW screen texture";
    return false;
  } else if (DIRECTDRAWLOG) {
    Logger::Log(LogLevel::Verbose, "BW screen texture created");
  }

  D3D10_SHADER_RESOURCE_VIEW_DESC srv_desc = D3D10_SHADER_RESOURCE_VIEW_DESC();
  srv_desc.Format = bw_screen_texture_desc.Format;
  srv_desc.ViewDimension = D3D10_SRV_DIMENSION_TEXTURE2D;
  srv_desc.Texture2D.MipLevels = bw_screen_texture_desc.MipLevels;

  bw_screen_view_ = bw_screen_texture_->CreateShaderResourceView(*dx_device_, srv_desc);
  if (!bw_screen_view_) {
    error_ = "Error creating a BW screen resource view";
    return false;
  } else if (DIRECTDRAWLOG) {
    Logger::Log(LogLevel::Verbose, "BW screen resource view created");
  }

  return true;
}

bool DirectX::InitPaletteTexture() {
  D3D10_TEXTURE2D_DESC palette_texture_desc = D3D10_TEXTURE2D_DESC();
  palette_texture_desc.Width = 256;
  palette_texture_desc.Height = 1;
  palette_texture_desc.MipLevels = 1;
  palette_texture_desc.ArraySize = 1;
  palette_texture_desc.Format = DXGI_FORMAT_B8G8R8A8_UNORM;
  palette_texture_desc.Usage = D3D10_USAGE_DYNAMIC;
  palette_texture_desc.BindFlags = D3D10_BIND_SHADER_RESOURCE;
  palette_texture_desc.CPUAccessFlags = D3D10_CPU_ACCESS_WRITE;
  palette_texture_desc.SampleDesc.Count = 1;

  palette_texture_ = dx_device_->CreateTexture2D(palette_texture_desc);
  if (!palette_texture_) {
    error_ = "Error creating a palette texture";
    return false;
  } else if (DIRECTDRAWLOG) {
    Logger::Log(LogLevel::Verbose, "Palette texture created");
  }

  D3D10_SHADER_RESOURCE_VIEW_DESC srv_desc = D3D10_SHADER_RESOURCE_VIEW_DESC();
  srv_desc.Format = palette_texture_desc.Format;
  srv_desc.ViewDimension = D3D10_SRV_DIMENSION_TEXTURE2D;
  srv_desc.Texture2D.MipLevels = palette_texture_desc.MipLevels;

  palette_view_ = palette_texture_->CreateShaderResourceView(*dx_device_, srv_desc);
  if (!palette_view_) {
    error_ = "Error creating a palette resource view";
    return false;
  } else if (DIRECTDRAWLOG) {
    Logger::Log(LogLevel::Verbose, "Palette resource view created");
  }

  return true;
}

bool DirectX::InitVertices() {
  Vertex vertices[] =
  {
    { XMFLOAT2(-1.0f, -1.0f), XMFLOAT2(0.0f, 1.0f) },
    { XMFLOAT2(-1.0f,  1.0f), XMFLOAT2(0.0f, 0.0f) },
    { XMFLOAT2( 1.0f, -1.0f), XMFLOAT2(1.0f, 1.0f) },
    { XMFLOAT2( 1.0f,  1.0f), XMFLOAT2(1.0f, 0.0f) },
  };

  D3D10_BUFFER_DESC vertex_buffer_desc = D3D10_BUFFER_DESC();
  vertex_buffer_desc.Usage = D3D10_USAGE_IMMUTABLE;
  vertex_buffer_desc.ByteWidth = sizeof(Vertex) * 4;
  vertex_buffer_desc.BindFlags = D3D10_BIND_VERTEX_BUFFER;
  vertex_buffer_desc.CPUAccessFlags = 0;
  vertex_buffer_desc.MiscFlags = 0;
  
  D3D10_SUBRESOURCE_DATA vertex_buffer_data = D3D10_SUBRESOURCE_DATA();
  vertex_buffer_data.pSysMem = vertices;
  
  vertex_buffer_ = dx_device_->CreateVertexBuffer(vertex_buffer_desc, vertex_buffer_data);
  if (!vertex_buffer_) {
    error_ = "Error creating a vertex buffer";
    return false;
  } else if (DIRECTDRAWLOG) {
    Logger::Log(LogLevel::Verbose, "Vertex buffer created");
  }

  return true;
}

DirectX::~DirectX() {
}

void DirectX::UpdatePalette(const IndirectDrawPalette& palette) {
  DxMappedTexture* mapped_palette_texture = palette_texture_->Map(
      D3D10CalcSubresource(0, 0, 1));
  if (!mapped_palette_texture) {
    return;
  } else if (DIRECTDRAWLOG) {
    Logger::Log(LogLevel::Verbose, "Palette texture mapped");
  }

  std::transform(palette.entries().begin(), palette.entries().end(),
      mapped_palette_texture->GetData<PaletteTextureEntry*>(), ConvertToPaletteTextureEntry);

  palette_texture_->Unmap(D3D10CalcSubresource(0, 0, 1));
}

void DirectX::Render(const std::vector<byte> &surface_data) {
  // BW has a nasty habit of trying to render ridiculously fast (like in the middle of a tight 7k
  // iteration loop during data intialization when there's nothing to actually render) and this
  // causes issues when the graphics card decides it doesn't want to queue commands any more. To
  // avoid these issues, we attempt to kill vsync, but also try to help BW out by not actually
  // making rendering calls this fast. 120Hz seems like a "reasonable" limit to me (and by
  // reasonable, I mean unlikely to cause weird issues), even though BW will never actually update
  // any state that fast.
  LARGE_INTEGER frame_time;
  QueryPerformanceCounter(&frame_time);
  if ((frame_time.QuadPart - last_frame_time_.QuadPart) / counter_frequency_.QuadPart < 8) {
    return;
  }
  // Don't render while minimized (we tell BW its never minimized, so even though it has a check for
  // this, it will be rendering anyway)
  if (IsIconic(window_)) {
    return;
  }

  if (DIRECTDRAWLOG) {
    Logger::Log(LogLevel::Verbose, "DirectX rendering");
  }

  CopyDdrawSurface(surface_data);
  if (DIRECTDRAWLOG) {
    Logger::Log(LogLevel::Verbose, "DirectX rendering - after ddraw texture copied");
  }
  ConvertToFullColor();
  if (DIRECTDRAWLOG) {
    Logger::Log(LogLevel::Verbose, "DirectX rendering - after converted to full color");
  }
  RenderToScreen();
  dx_swap_chain_->Present(0, 0);

  QueryPerformanceCounter(&last_frame_time_);
  if (DIRECTDRAWLOG) {
    Logger::Logf(LogLevel::Verbose,
        "DirectX rendering completed [perf counter: %lld]",
        last_frame_time_.QuadPart / counter_frequency_.QuadPart);
  }
}

void DirectX::CopyDdrawSurface(const std::vector<byte>& surface_data) {
  DxMappedTexture* mapped_screen_texture = bw_screen_texture_->Map(D3D10CalcSubresource(0, 0, 1));
  if (!mapped_screen_texture) {
    return;
  } else if (DIRECTDRAWLOG) {
    Logger::Log(LogLevel::Verbose, "BW screen texture mapped");
  }

  BYTE* mapped_data = mapped_screen_texture->GetData<BYTE*>();
  for(UINT row = 0; row < ddraw_height_; row++) {
    std::copy(&surface_data[row*ddraw_width_], &surface_data[row*ddraw_width_ + ddraw_width_],
        mapped_data);
    mapped_data += mapped_screen_texture->GetRowPitch();
  }

  bw_screen_texture_->Unmap(D3D10CalcSubresource(0, 0, 1));
}

void DirectX::ConvertToFullColor() {
  dx_device_->OMSetRenderTargets(1, depalettized_render_target_view_->get(), NULL);

  D3D10_VIEWPORT viewport;
  viewport.Width = ddraw_width_;
  viewport.Height = ddraw_height_;
  viewport.MinDepth = 0.0f;
  viewport.MaxDepth = 1.0f;
  viewport.TopLeftX = 0;
  viewport.TopLeftY = 0;

  dx_device_->RSSetViewports(1, &viewport);

  unsigned int stride = sizeof(Vertex);
  unsigned int offset = 0;

  dx_device_->IASetInputLayout(input_layout_->get());
  dx_device_->IASetVertexBuffers(0, 1, vertex_buffer_->get(), &stride, &offset);
  dx_device_->IASetPrimitiveTopology(D3D10_PRIMITIVE_TOPOLOGY_TRIANGLESTRIP);

  dx_device_->VSSetShader(depalettized_vertex_shader_->get());
  dx_device_->PSSetShader(depalettized_pixel_shader_->get());
  dx_device_->PSSetShaderResources(0, 1, bw_screen_view_->get());
  dx_device_->PSSetShaderResources(1, 1, palette_view_->get());

  dx_device_->Draw(4, 0);
}

void DirectX::RenderToScreen() {
  dx_device_->OMSetRenderTargets(1, back_buffer_render_target_view_->get(), NULL);

  D3D10_VIEWPORT viewport;
  viewport.Width = ddraw_width_;
  viewport.Height = ddraw_height_;
  viewport.MinDepth = 0.0f;
  viewport.MaxDepth = 1.0f;
  viewport.TopLeftX = 0;
  viewport.TopLeftY = 0;

  if (display_mode_ != RendererDisplayMode::FullScreen || aspect_ratio_width_ == 0) {
	  viewport.Width = client_rect_.right;
    viewport.Height = client_rect_.bottom;
    viewport.TopLeftX = 0;
    viewport.TopLeftY = 0;
  } else if (aspect_ratio_width_ > 0) {
    viewport.Width = aspect_ratio_width_;
    viewport.Height = aspect_ratio_height_;
    viewport.TopLeftX = static_cast<int>(((client_rect_.right - aspect_ratio_width_) / 2.) + 0.5);
    viewport.TopLeftY = static_cast<int>(((client_rect_.bottom - aspect_ratio_height_) / 2.) + 0.5);
  }

  dx_device_->RSSetViewports(1, &viewport);

  dx_device_->PSSetShader(scaling_pixel_shader_->get());
  dx_device_->PSSetShaderResources(0, 1, rendered_view_->get());
  dx_device_->PSSetSamplers(0, 1, rendered_texture_sampler_->get());
  
  dx_device_->Draw(4, 0);
}

}  // namespace forge
}  // namespace sbat