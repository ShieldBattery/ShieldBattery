#include "forge/direct_x.h"

#include <algorithm>
#include <map>
#include <string>
#include <utility>
#include <vector>

#include "forge/indirect_draw.h"
#include "forge/forge.h"
#include "logger/logger.h"

namespace sbat {
namespace forge {

using std::map;
using std::pair;
using std::string;
using std::unique_ptr;
using std::vector;
using namespace DirectX;

string DirectXRenderer::last_error_ = "";  // NOLINT

unique_ptr<DirectXRenderer> DirectXRenderer::Create(HWND window, uint32 ddraw_width,
    uint32 ddraw_height, RendererDisplayMode display_mode, bool maintain_aspect_ratio,
    const map<string, pair<string, string>>& shaders) {
  unique_ptr<DirectXRenderer> direct_x(new DirectXRenderer(window, ddraw_width, ddraw_height,
    display_mode, maintain_aspect_ratio, shaders));

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

string GetErrorMsg(HRESULT result) {
  _com_error error(result);
  return string(error.ErrorMessage());
}

string DirectXRenderer::GetLastError() {
  return last_error_;
}

DxTextureMapper::DxTextureMapper(const DxTexture& texture, uint32 mip_slice, uint32 array_slice,
      uint32 mip_levels)
  : result_(),
    subresource_(D3D10CalcSubresource(mip_slice, array_slice, mip_levels)),
    texture_(),
    mapped_texture_() {
  result_ = texture.get()->Map(subresource_, D3D10_MAP_WRITE_DISCARD, 0, &mapped_texture_);
  if (FAILED(result_)) {
    Logger::Logf(LogLevel::Error, "Error mapping a texture: %s", GetErrorMsg(result_));
    return;
  }

  // Store off a pointer to the texture and AddRef it, our ComDeleter will remove that ref when
  // the mapper is destroyed
  texture_.reset(texture.get());
  texture_->AddRef();
}

DxTextureMapper::~DxTextureMapper() {
  if (!has_error()) {
    texture_->Unmap(subresource_);
  }
}

DxTexture::DxTexture(ID3D10Texture2D* texture)
  : texture_(texture) {
}

DxTexture::~DxTexture() {
  ReleaseCom(texture_);
}

unique_ptr<DxTexture> DxTexture::NewTexture(const DxDevice& device,
    const D3D10_TEXTURE2D_DESC& texture_desc) {
  ID3D10Texture2D* texture;
  HRESULT result = device.get()->CreateTexture2D(&texture_desc, NULL, &texture);
  if (FAILED(result)) {
    Logger::Logf(LogLevel::Error, "Error creating a texture: %s", GetErrorMsg(result));
    return nullptr;
  } else {
    return unique_ptr<DxTexture>(new DxTexture(texture));
  }
}

unique_ptr<DxTexture> DxTexture::FromSwapChain(const DxSwapChain& swap_chain) {
  ID3D10Texture2D* texture;
  HRESULT result = swap_chain.get()->GetBuffer(0, __uuidof(ID3D10Texture2D),
      reinterpret_cast<void**>(&texture));
  if (FAILED(result)) {
    Logger::Logf(LogLevel::Error, "Error getting a buffer texture: %s", GetErrorMsg(result));
    return nullptr;
  } else {
    return std::unique_ptr<DxTexture>(new DxTexture(texture));
  }
}

DxSwapChain::DxSwapChain(const DxDevice& device, DXGI_SWAP_CHAIN_DESC* swap_chain_desc)
  : result_(),
    swap_chain_(nullptr) {
  void* out;
  result_ = device.get()->QueryInterface(__uuidof(IDXGIDevice), &out);
  if (FAILED(result_)) {
    Logger::Logf(LogLevel::Error, "Error querying a device interface: %s", GetErrorMsg(result_));
    return;
  }
  auto dxgi_device = WrapComVoid<IDXGIDevice>(out);

  result_ = dxgi_device->GetParent(__uuidof(IDXGIAdapter), &out);
  if (FAILED(result_)) {
    Logger::Logf(LogLevel::Error, "Error getting a dxgi adapter: %s", GetErrorMsg(result_));
  }
  auto dxgi_adapter = WrapComVoid<IDXGIAdapter>(out);

  result_ = dxgi_adapter->GetParent(__uuidof(IDXGIFactory), &out);
  if (FAILED(result_)) {
    Logger::Logf(LogLevel::Error, "Error getting a dxgi factory: %s", GetErrorMsg(result_));
    return;
  }
  auto dxgi_factory = WrapComVoid<IDXGIFactory>(out);

  result_ = dxgi_factory->CreateSwapChain(device.get(), swap_chain_desc, &swap_chain_);
}

DxSwapChain::~DxSwapChain() {
  ReleaseCom(swap_chain_);
}

DxBlob::DxBlob(const string& src, const string& type, const string& version)
  : blob_(nullptr),
    error_blob_(nullptr),
    result_(NULL) {
  result_ = D3DCompile(src.c_str(), src.length(), NULL, NULL, NULL, type.c_str(), version.c_str(),
      NULL, NULL, &blob_, &error_blob_);
}

DxBlob::~DxBlob() {
  ReleaseCom(error_blob_);
  ReleaseCom(blob_);
}

DxVertexBlob::DxVertexBlob(const string& src)
  : DxBlob(src, "VS_Main", "vs_4_0") {
}

DxVertexBlob::~DxVertexBlob() {}

DxPixelBlob::DxPixelBlob(const string& src)
  : DxBlob(src, "PS_Main", "ps_4_0") {
}

DxPixelBlob::~DxPixelBlob() {}

DxVertexShader::DxVertexShader(const DxDevice& device, const DxVertexBlob& vertex_blob)
  : result_(),
    vertex_shader_(nullptr) {
  result_ = device.get()->CreateVertexShader(vertex_blob.GetBufferPointer(),
      vertex_blob.GetBufferSize(), &vertex_shader_);
}

DxVertexShader::~DxVertexShader() {
  ReleaseCom(vertex_shader_);
}

DxPixelShader::DxPixelShader(const DxDevice& device, const DxPixelBlob& pixel_blob)
  : result_(),
    pixel_shader_(nullptr) {
  result_ = device.get()->CreatePixelShader(pixel_blob.GetBufferPointer(),
      pixel_blob.GetBufferSize(), &pixel_shader_);
}

DxPixelShader::~DxPixelShader() {
  ReleaseCom(pixel_shader_);
}

DxInputLayout::DxInputLayout(const DxDevice& device,
      const D3D10_INPUT_ELEMENT_DESC& input_layout_desc, uint32 desc_size,
      const DxVertexBlob& vertex_blob)
  : result_(),
    input_layout_(nullptr) {
  result_ = device.get()->CreateInputLayout(&input_layout_desc, desc_size,
      vertex_blob.GetBufferPointer(), vertex_blob.GetBufferSize(), &input_layout_);
}

DxInputLayout::~DxInputLayout() {
  ReleaseCom(input_layout_);
}

DxSamplerState::DxSamplerState(const DxDevice& device, const D3D10_SAMPLER_DESC& sampler_desc)
  : result_(),
    sampler_state_(nullptr) {
  result_ = device.get()->CreateSamplerState(&sampler_desc, &sampler_state_);
}

DxSamplerState::~DxSamplerState() {
  ReleaseCom(sampler_state_);
}

DxVertexBuffer::DxVertexBuffer(const DxDevice& device, const D3D10_BUFFER_DESC& buffer_desc,
      const D3D10_SUBRESOURCE_DATA& buffer_data, uint32 stride, uint32 offset)
  : result_(),
    buffer_(nullptr),
    stride_(stride),
    offset_(offset) {
  assert(buffer_desc.BindFlags & D3D10_BIND_VERTEX_BUFFER);
  result_ = device.get()->CreateBuffer(&buffer_desc, &buffer_data, &buffer_);
}

DxVertexBuffer::~DxVertexBuffer() {
  ReleaseCom(buffer_);
}

DxVertexBufferMapper::DxVertexBufferMapper(const DxVertexBuffer& buffer)
  : result_(),
    buffer_(),
    mapped_buffer_() {
  result_ = buffer.get()->Map(D3D10_MAP_WRITE_DISCARD, 0, &mapped_buffer_);
  if (FAILED(result_)) {
    Logger::Logf(LogLevel::Error, "Error mapping a vertex buffer: %s", GetErrorMsg(result_));
    return;
  }

  // Store off a pointer to the buffer and AddRef it, our ComDeleter will remove that ref when
  // the mapper is destroyed
  buffer_.reset(buffer.get());
  buffer_->AddRef();
}

DxVertexBufferMapper::~DxVertexBufferMapper() {
  if (!has_error()) {
    buffer_->Unmap();
  }
}

DxDevice::DxDevice()
  : device_(nullptr),
    result_(NULL) {
  result_ = D3D10CreateDevice(0, D3D10_DRIVER_TYPE_HARDWARE, 0, 0, D3D10_SDK_VERSION, &device_);
}

DxDevice::~DxDevice() {
  ReleaseCom(device_);
}

unique_ptr<DxSwapChain> DxDevice::CreateSwapChain(DXGI_SWAP_CHAIN_DESC* swap_chain_desc) {
  auto state = unique_ptr<DxSwapChain>(new DxSwapChain(*this, swap_chain_desc));
  if (FAILED(state->result())) {
    Logger::Logf(LogLevel::Error, "Error creating a swap chain: %s", GetErrorMsg(state->result()));
    return nullptr;
  } else {
    return state;
  }
}

unique_ptr<DxVertexShader> DxDevice::CreateVertexShader(const DxVertexBlob& vertex_blob) {
  auto shader = unique_ptr<DxVertexShader>(new DxVertexShader(*this, vertex_blob));
  if (FAILED(shader->result())) {
    Logger::Logf(LogLevel::Error,
        "Error creating a vertex shader: %s", GetErrorMsg(shader->result()));
    return nullptr;
  } else {
    return shader;
  }
}

unique_ptr<DxPixelShader> DxDevice::CreatePixelShader(const DxPixelBlob& pixel_blob) {
  auto shader = unique_ptr<DxPixelShader>(new DxPixelShader(*this, pixel_blob));
  if (FAILED(shader->result())) {
    Logger::Logf(LogLevel::Error,
        "Error creating a pixel shader: %s", GetErrorMsg(shader->result()));
    return nullptr;
  } else {
    return shader;
  }
}

unique_ptr<DxInputLayout> DxDevice::CreateInputLayout(
    const D3D10_INPUT_ELEMENT_DESC& input_layout_desc, uint32 desc_size,
    const DxVertexBlob& vertex_blob) {
  auto layout = unique_ptr<DxInputLayout>(
      new DxInputLayout(*this, input_layout_desc, desc_size, vertex_blob));
  if (FAILED(layout->result())) {
    Logger::Logf(LogLevel::Error,
        "Error creating an input layout: %s", GetErrorMsg(layout->result()));
    return nullptr;
  } else {
    return layout;
  }
}

PtrDxRenderTargetView DxDevice::CreateRenderTargetView(const DxTexture& texture) {
  ID3D10RenderTargetView* render_target_view;
  HRESULT result = device_->CreateRenderTargetView(texture.get(), NULL, &render_target_view);
  if (FAILED(result)) {
    Logger::Logf(LogLevel::Error, "Error creating a render target view: %s", GetErrorMsg(result));
    return nullptr;
  } else {
    return PtrDxRenderTargetView(render_target_view);
  }
}

PtrDxShaderResourceView DxDevice::CreateShaderResourceView(const DxTexture& texture,
    const D3D10_SHADER_RESOURCE_VIEW_DESC& srv_desc) {
  ID3D10ShaderResourceView* shader_resource_view;
  HRESULT result =
      device_->CreateShaderResourceView(texture.get(), &srv_desc, &shader_resource_view);
  if (FAILED(result)) {
    Logger::Logf(LogLevel::Error, "Error creating a shader resource view: %s",
        GetErrorMsg(result));
    return nullptr;
  } else {
    return PtrDxShaderResourceView(shader_resource_view);
  }
}

unique_ptr<DxSamplerState> DxDevice::CreateSamplerState(const D3D10_SAMPLER_DESC& sampler_desc) {
  auto state = unique_ptr<DxSamplerState>(new DxSamplerState(*this, sampler_desc));
  if (FAILED(state->result())) {
    Logger::Logf(LogLevel::Error, "Error creating a texture sampler: %s",
        GetErrorMsg(state->result()));
    return nullptr;
  } else {
    return state;
  }
}

unique_ptr<DxVertexBuffer> DxDevice::CreateVertexBuffer(const D3D10_BUFFER_DESC& buffer_desc,
    const D3D10_SUBRESOURCE_DATA& buffer_data, uint32 stride, uint32 offset) {
  auto buffer = unique_ptr<DxVertexBuffer>(
      new DxVertexBuffer(*this, buffer_desc, buffer_data, stride, offset));
  if (FAILED(buffer->result())) {
    Logger::Logf(LogLevel::Error,
        "Error creating a vertex buffer: %s", GetErrorMsg(buffer->result()));
    return nullptr;
  } else {
    return buffer;
  }
}

// Constructing this *can* fail and leave a partially uninitialized object. The assumption is that
// this constructor will only ever be called by the factory method, and the factory method will take
// care of deleting any errored objects instead of returning them higher up, so no methods outside
// of the constructor will need to check for such a state.
DirectXRenderer::DirectXRenderer(HWND window, uint32 ddraw_width, uint32 ddraw_height,
  RendererDisplayMode display_mode, bool maintain_aspect_ratio,
  const map<string, pair<string, string>>& shaders)
  : error_(),
    window_(window),
    client_rect_(),
    dx_device_(),
    swap_chain_(),
    back_buffer_(),
    back_buffer_view_(),
    depalettized_view_(),
    depalettized_vertex_shader_(),
    depalettized_pixel_shader_(),
    scaling_pixel_shader_(),
    font_pixel_shader_(),
    input_layout_(),
    vertex_buffer_(),
    palette_texture_(),
    bw_screen_texture_(),
    rendered_texture_(),
    bw_screen_view_(),
    palette_view_(),
    rendered_view_(),
    rendered_texture_sampler_(),
    font_atlas_(),
    font_view_(),
    font_vertex_buffer_(),
    font_blend_state_(),
    ddraw_width_(ddraw_width),
    ddraw_height_(ddraw_height),
    ddraw_viewport_(),
    final_viewport_(),
    render_skipper_(window) {
  Logger::Log(LogLevel::Verbose, "IndirectDraw initializing DirectX");
  GetClientRect(window, &client_rect_);

  uint32 width = client_rect_.right - client_rect_.left;
  uint32 height = client_rect_.bottom - client_rect_.top;

  dx_device_.reset(new DxDevice);
  if (FAILED(dx_device_->result())) {
    Logger::Logf(LogLevel::Error, "Error creating a DirectX device: %s",
        GetErrorMsg(dx_device_->result()));
    error_ = "Error creating a DirectX device";
    return;
  } else if (DIRECTDRAWLOG) {
    Logger::Log(LogLevel::Verbose, "DirectX device created");
  }

  ddraw_viewport_.Width = ddraw_width_;
  ddraw_viewport_.Height = ddraw_height_;
  ddraw_viewport_.MinDepth = 0.0f;
  ddraw_viewport_.MaxDepth = 1.0f;
  ddraw_viewport_.TopLeftX = 0;
  ddraw_viewport_.TopLeftY = 0;

  DXGI_SWAP_CHAIN_DESC swap_chain_desc = DXGI_SWAP_CHAIN_DESC();
  swap_chain_desc.BufferCount = 1;
  swap_chain_desc.BufferDesc.Width = width;
  swap_chain_desc.BufferDesc.Height = height;
  swap_chain_desc.BufferDesc.Format = DXGI_FORMAT_R8G8B8A8_UNORM;
  // Refresh rate isn't necessary since we're windowed
  swap_chain_desc.BufferDesc.RefreshRate.Numerator = 0;
  swap_chain_desc.BufferDesc.RefreshRate.Denominator = 1;
  swap_chain_desc.BufferUsage = DXGI_USAGE_RENDER_TARGET_OUTPUT;
  swap_chain_desc.OutputWindow = window_;
  swap_chain_desc.Windowed = true;
  swap_chain_desc.SampleDesc.Count = 1;
  swap_chain_desc.SampleDesc.Quality = 0;

  swap_chain_ = dx_device_->CreateSwapChain(&swap_chain_desc);
  if (!swap_chain_) {
    error_ = "Error creating a DirectX swap chain";
    return;
  } else if (DIRECTDRAWLOG) {
    Logger::Log(LogLevel::Verbose, "DirectX swap chain created");
  }

  back_buffer_ = DxTexture::FromSwapChain(*swap_chain_);
  if (!back_buffer_) {
    error_ = "Error getting a back buffer texture";
    return;
  } else if (DIRECTDRAWLOG) {
    Logger::Log(LogLevel::Verbose, "Back buffer texture retrieved");
  }

  back_buffer_view_ = dx_device_->CreateRenderTargetView(*back_buffer_);
  if (!back_buffer_view_) {
    error_ = "Error creating a back buffer render target view";
    return;
  } else if (DIRECTDRAWLOG) {
    Logger::Log(LogLevel::Verbose, "Back buffer render target view created");
  }

  D3D10_BLEND_DESC blend_desc = {0};
  blend_desc.BlendEnable[0] = true;
  blend_desc.SrcBlend = D3D10_BLEND_SRC_ALPHA;
  blend_desc.DestBlend = D3D10_BLEND_INV_SRC_ALPHA;
  blend_desc.BlendOp = D3D10_BLEND_OP_ADD;
  blend_desc.SrcBlendAlpha = D3D10_BLEND_ZERO;
  blend_desc.DestBlendAlpha = D3D10_BLEND_ZERO;
  blend_desc.BlendOpAlpha = D3D10_BLEND_OP_ADD;
  blend_desc.RenderTargetWriteMask[0] = D3D10_COLOR_WRITE_ENABLE_ALL;
  if (!SUCCEEDED(dx_device_->get()->CreateBlendState(&blend_desc, &font_blend_state_))) {
    error_ = "Error creating a font blend state";
    return;
  } else if (DIRECTDRAWLOG) {
    Logger::Log(LogLevel::Verbose, "Font blend state created");
  }
  AddComRef(font_blend_state_.get());

  RECT output_rect = 
      GetOutputSize(display_mode, maintain_aspect_ratio, client_rect_, ddraw_width_, ddraw_height_);
  final_viewport_.Width = output_rect.right - output_rect.left;
  final_viewport_.Height = output_rect.bottom - output_rect.top;
  final_viewport_.MinDepth = 0.0f;
  final_viewport_.MaxDepth = 1.0f;
  final_viewport_.TopLeftX = output_rect.left;
  final_viewport_.TopLeftY = output_rect.top;

  if (!InitShaders(shaders)) {
    return;
  }
  if (!InitTextures()) {
    return;
  }
  if (!InitVertices()) {
    return;
  }
  if (!InitFontVertexBuffer()) {
    return;
  }
}

DirectXRenderer::~DirectXRenderer() {
}

bool DirectXRenderer::InitShaders(const map<string, pair<string, string>>& shaders) {
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

  if (shaders.count("font") != 0) {
    if (!InitFontShader(shaders)) {
      return false;
    }
  } else {
    error_ = "No font shader found";
    return false;
  }

  return true;
}

bool DirectXRenderer::InitDepalettizingShader(const map<string, pair<string, string>>& shaders) {
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

  D3D10_INPUT_ELEMENT_DESC input_layout_desc[] = {
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

bool DirectXRenderer::InitScalingShader(const map<string, pair<string, string>>& shaders) {
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

bool DirectXRenderer::InitFontShader(const map<string, pair<string, string>>& shaders) {
  const pair<string, string> shader_pair = shaders.at("font");

  DxPixelBlob pixel_blob(shader_pair.second);
  if (pixel_blob.has_error()) {
    Logger::Logf(LogLevel::Error, "Error compiling a font pixel shader: %s",
      pixel_blob.GetErrorBufferPointer());
    error_ = "Error compiling a font pixel shader";
    return false;
  } else if (DIRECTDRAWLOG) {
    Logger::Log(LogLevel::Verbose, "Font pixel shader compiled");
  }

  font_pixel_shader_ = dx_device_->CreatePixelShader(pixel_blob);
  if (!font_pixel_shader_) {
    error_ = "Error creating a font pixel shader";
    return false;
  } else if (DIRECTDRAWLOG) {
    Logger::Log(LogLevel::Verbose, "Font pixel shader created");
  }

  return true;
}

bool DirectXRenderer::InitTextures() {
  if (!InitRenderedTexture()) {
    return false;
  }
  if (!InitBwScreenTexture()) {
    return false;
  }
  if (!InitPaletteTexture()) {
    return false;
  }
  if (!InitFontAtlasTexture()) {
    return false;
  }

  D3D10_SAMPLER_DESC rendered_texture_sampler_desc = D3D10_SAMPLER_DESC();
  rendered_texture_sampler_desc.Filter = D3D10_FILTER_MIN_MAG_MIP_LINEAR;
  rendered_texture_sampler_desc.AddressU = D3D10_TEXTURE_ADDRESS_CLAMP;
  rendered_texture_sampler_desc.AddressV = D3D10_TEXTURE_ADDRESS_CLAMP;
  rendered_texture_sampler_desc.AddressW = D3D10_TEXTURE_ADDRESS_CLAMP;
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

bool DirectXRenderer::InitRenderedTexture() {
  D3D10_TEXTURE2D_DESC rendered_texture_desc = D3D10_TEXTURE2D_DESC();
  rendered_texture_desc.Width = ddraw_width_;
  rendered_texture_desc.Height = ddraw_height_;
  rendered_texture_desc.MipLevels = 1;
  rendered_texture_desc.ArraySize = 1;
  rendered_texture_desc.Format = DXGI_FORMAT_R8G8B8A8_UNORM;
  rendered_texture_desc.Usage = D3D10_USAGE_DEFAULT;
  rendered_texture_desc.BindFlags = D3D10_BIND_RENDER_TARGET | D3D10_BIND_SHADER_RESOURCE;
  rendered_texture_desc.SampleDesc.Count = 1;

  rendered_texture_ = DxTexture::NewTexture(*dx_device_, rendered_texture_desc);
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

  rendered_view_ = dx_device_->CreateShaderResourceView(*rendered_texture_, srv_desc);
  if (!rendered_view_) {
    error_ = "Error creating a rendered resource view";
    return false;
  } else if (DIRECTDRAWLOG) {
    Logger::Log(LogLevel::Verbose, "Rendered resource view created");
  }

  depalettized_view_ = dx_device_->CreateRenderTargetView(*rendered_texture_);
  if (!depalettized_view_) {
    error_ = "Error creating a depalettized render target view";
    return false;
  } else if (DIRECTDRAWLOG) {
    Logger::Log(LogLevel::Verbose, "Depalettized render target view created");
  }

  return true;
}

bool DirectXRenderer::InitBwScreenTexture() {
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

  bw_screen_texture_ = DxTexture::NewTexture(*dx_device_, bw_screen_texture_desc);
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

  bw_screen_view_ = dx_device_->CreateShaderResourceView(*bw_screen_texture_, srv_desc);
  if (!bw_screen_view_) {
    error_ = "Error creating a BW screen resource view";
    return false;
  } else if (DIRECTDRAWLOG) {
    Logger::Log(LogLevel::Verbose, "BW screen resource view created");
  }

  return true;
}

bool DirectXRenderer::InitPaletteTexture() {
  D3D10_TEXTURE2D_DESC palette_texture_desc = D3D10_TEXTURE2D_DESC();
  palette_texture_desc.Width = 256;
  palette_texture_desc.Height = 1;
  palette_texture_desc.MipLevels = 1;
  palette_texture_desc.ArraySize = 1;
  palette_texture_desc.Format = DXGI_FORMAT_R8G8B8A8_UNORM;
  palette_texture_desc.Usage = D3D10_USAGE_DYNAMIC;
  palette_texture_desc.BindFlags = D3D10_BIND_SHADER_RESOURCE;
  palette_texture_desc.CPUAccessFlags = D3D10_CPU_ACCESS_WRITE;
  palette_texture_desc.SampleDesc.Count = 1;

  palette_texture_ = DxTexture::NewTexture(*dx_device_, palette_texture_desc);
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

  palette_view_ = dx_device_->CreateShaderResourceView(*palette_texture_, srv_desc);
  if (!palette_view_) {
    error_ = "Error creating a palette resource view";
    return false;
  } else if (DIRECTDRAWLOG) {
    Logger::Log(LogLevel::Verbose, "Palette resource view created");
  }

  return true;
}

bool DirectXRenderer::InitFontAtlasTexture() {
  D3D10_TEXTURE2D_DESC desc = {0};
  desc.Width = 1024;
  desc.Height = 256;
  desc.MipLevels = 1;
  desc.ArraySize = 1;
  desc.Format = DXGI_FORMAT_R8G8B8A8_UNORM;
  desc.Usage = D3D10_USAGE_DYNAMIC;  // TODO(tec27): Use CopySubresourceRegion instead of doing this
  desc.BindFlags = D3D10_BIND_SHADER_RESOURCE;
  desc.CPUAccessFlags = D3D10_CPU_ACCESS_WRITE;
  desc.SampleDesc.Count = 1;

  font_atlas_ = DxTexture::NewTexture(*dx_device_, desc);
  if (!font_atlas_) {
    error_ = "Error creating font atlas texture";
    return false;
  } else if (DIRECTDRAWLOG) {
    Logger::Log(LogLevel::Verbose, "Font atlas texture created");
  }

  D3D10_SHADER_RESOURCE_VIEW_DESC srv_desc = D3D10_SHADER_RESOURCE_VIEW_DESC();
  srv_desc.Format = desc.Format;
  srv_desc.ViewDimension = D3D10_SRV_DIMENSION_TEXTURE2D;
  srv_desc.Texture2D.MipLevels = desc.MipLevels;

  font_view_ = dx_device_->CreateShaderResourceView(*font_atlas_, srv_desc);
  if (!palette_view_) {
    error_ = "Error creating font atlas resource view";
    return false;
  } else if (DIRECTDRAWLOG) {
    Logger::Log(LogLevel::Verbose, "Font atlas resource view created");
  }

  return true;
}

bool DirectXRenderer::InitVertices() {
  Vertex vertices[] = {
    { XMFLOAT2(-1.0f, -1.0f), XMFLOAT2(0.0f, 1.0f) },
    { XMFLOAT2(-1.0f,  1.0f), XMFLOAT2(0.0f, 0.0f) },
    { XMFLOAT2(1.0f, -1.0f), XMFLOAT2(1.0f, 1.0f) },
    { XMFLOAT2(1.0f,  1.0f), XMFLOAT2(1.0f, 0.0f) },
  };

  D3D10_BUFFER_DESC vertex_buffer_desc = D3D10_BUFFER_DESC();
  vertex_buffer_desc.Usage = D3D10_USAGE_IMMUTABLE;
  vertex_buffer_desc.ByteWidth = sizeof(Vertex) * 4;
  vertex_buffer_desc.BindFlags = D3D10_BIND_VERTEX_BUFFER;
  vertex_buffer_desc.CPUAccessFlags = 0;
  vertex_buffer_desc.MiscFlags = 0;

  D3D10_SUBRESOURCE_DATA vertex_buffer_data = D3D10_SUBRESOURCE_DATA();
  vertex_buffer_data.pSysMem = vertices;

  vertex_buffer_ =
      dx_device_->CreateVertexBuffer(vertex_buffer_desc, vertex_buffer_data, sizeof(Vertex), 0);
  if (!vertex_buffer_) {
    error_ = "Error creating a vertex buffer";
    return false;
  } else if (DIRECTDRAWLOG) {
    Logger::Log(LogLevel::Verbose, "Vertex buffer created");
  }

  return true;
}

bool DirectXRenderer::InitFontVertexBuffer() {
  Vertex vertices[] = {
    {XMFLOAT2(-1.0f, -1.0f), XMFLOAT2(0.0f, 1.0f)},
    {XMFLOAT2(-1.0f,  1.0f), XMFLOAT2(0.0f, 0.0f)},
    {XMFLOAT2(1.0f, -1.0f), XMFLOAT2(1.0f, 1.0f)},
    {XMFLOAT2(1.0f,  1.0f), XMFLOAT2(1.0f, 0.0f)},
  };

  D3D10_BUFFER_DESC desc = D3D10_BUFFER_DESC();
  desc.Usage = D3D10_USAGE_DYNAMIC;
  desc.ByteWidth = sizeof(vertices);
  desc.BindFlags = D3D10_BIND_VERTEX_BUFFER;
  desc.CPUAccessFlags = D3D10_CPU_ACCESS_WRITE;
  desc.MiscFlags = 0;

  D3D10_SUBRESOURCE_DATA data = D3D10_SUBRESOURCE_DATA();
  data.pSysMem = vertices;

  font_vertex_buffer_ = dx_device_->CreateVertexBuffer(desc, data, sizeof(Vertex), 0);
  if (!font_vertex_buffer_) {
    error_ = "Error creating font vertex buffer";
    return false;
  } else if (DIRECTDRAWLOG) {
    Logger::Log(LogLevel::Verbose, "Font vertex buffer created");
  }

  return true;
}

void DirectXRenderer::UpdatePalette(const IndirectDrawPalette& palette) {
  DxTextureMapper mapper(*palette_texture_, 0, 0, 1);
  if (mapper.has_error()) {
    if (DIRECTDRAWLOG) {
      Logger::Logf(LogLevel::Error,
          "Mapping palette texture failed: %s", GetErrorMsg(mapper.error()));
    }
    return;
  } else if (DIRECTDRAWLOG) {
    Logger::Log(LogLevel::Verbose, "Palette texture mapped");
  }

  std::transform(palette.entries().begin(), palette.entries().end(),
      mapper.GetData<PaletteTextureEntry*>(), ConvertToPaletteTextureEntry);
}

void DirectXRenderer::UpdateFontAtlas(const vector<uint32>& pixels, uint32 width, uint32 height) {
  DxTextureMapper mapper(*font_atlas_, 0, 0, 1);
  if (mapper.has_error()) {
    if (DIRECTDRAWLOG) {
      Logger::Logf(LogLevel::Error,
        "Mapping font atlas texture failed: %s", GetErrorMsg(mapper.error()));
    }
    return;
  } else if (DIRECTDRAWLOG) {
    Logger::Log(LogLevel::Verbose, "Font atlas texture mapped");
  }

  uint32 row_pitch = mapper.GetRowPitch() / sizeof(uint32);
  for (uint32 y = 0; y < height; y++) {
    auto& row_start = pixels.begin() + (y * width);
    std::copy(row_start, row_start + width, mapper.GetData<uint32*>() + (y * row_pitch));
  }

  DxVertexBufferMapper vertex_mapper(*font_vertex_buffer_);
  if (vertex_mapper.has_error()) {
    if (DIRECTDRAWLOG) {
      Logger::Logf(LogLevel::Error,
        "Mapping font vertex buffer failed: %s", GetErrorMsg(mapper.error()));
    }
    return;
  } else if (DIRECTDRAWLOG) {
    Logger::Log(LogLevel::Verbose, "Font vertex buffer mapped");
  }

  float widthFloat = static_cast<float>(width);
  float heightFloat = static_cast<float>(height);
  float x = (widthFloat / final_viewport_.Width) / 2.0f;
  float y = (heightFloat / final_viewport_.Height) / 2.0f;

  Vertex vertices[] = {
    {XMFLOAT2(-x, -y), XMFLOAT2(0.0f, heightFloat)},
    {XMFLOAT2(-x,  y), XMFLOAT2(0.0f, 0.0f)},
    {XMFLOAT2(x, -y), XMFLOAT2(widthFloat, heightFloat)},
    {XMFLOAT2(x,  y), XMFLOAT2(widthFloat, 0.0f)},
  };

  std::copy(&vertices[0], &vertices[0] + 4, vertex_mapper.GetData<Vertex*>());
}

void DirectXRenderer::Render(const std::vector<byte> &surface_data) {
  if (render_skipper_.ShouldSkipRender()) {
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
  RenderText();
  swap_chain_->Present(0, 0);

  render_skipper_.UpdateLastFrameTime();
  if (DIRECTDRAWLOG) {
    Logger::Log(LogLevel::Verbose, "DirectX rendering completed");
  }
}

void DirectXRenderer::CopyDdrawSurface(const std::vector<byte>& surface_data) {
  DxTextureMapper mapper(*bw_screen_texture_, 0, 0, 1);
  if (mapper.has_error()) {
    if (DIRECTDRAWLOG) {
      Logger::Logf(LogLevel::Error,
          "Mapping BW screen texture failed: %s", GetErrorMsg(mapper.error()));
    }
    return;
  } else if (DIRECTDRAWLOG) {
    Logger::Log(LogLevel::Verbose, "BW screen texture mapped");
  }

  BYTE* mapped_data = mapper.GetData<BYTE*>();
  if (mapper.GetRowPitch() == (ddraw_width_ * sizeof(BYTE))) {
    // No need to go row-by-row, since the rows are directly adjacent
    std::copy(surface_data.begin(), surface_data.end(), mapped_data);
  } else {
    // Go row-by-row
    for (uint32 row = 0; row < ddraw_height_; row++, mapped_data += mapper.GetRowPitch()) {
      std::copy(surface_data.begin() + (row * ddraw_width_),
          surface_data.begin() + (row * ddraw_width_ + ddraw_width_),
          mapped_data);
    }
  }
}

void DirectXRenderer::ConvertToFullColor() {
  dx_device_->SetRenderTarget(depalettized_view_)
      .SetViewports(1, &ddraw_viewport_)
      .SetInputLayout(*input_layout_)
      .SetVertexBuffers(*vertex_buffer_)
      .SetPrimitiveTopology(D3D10_PRIMITIVE_TOPOLOGY_TRIANGLESTRIP)
      .SetVertexShader(*depalettized_vertex_shader_)
      .SetPixelShader(*depalettized_pixel_shader_)
      .SetPixelShaderResource(0, bw_screen_view_)
      .SetPixelShaderResource(1, palette_view_)
      .Draw(4, 0);
  dx_device_->ClearPixelShaderResource(0)
    .ClearPixelShaderResource(1);
}

void DirectXRenderer::RenderToScreen() {
  dx_device_->SetRenderTarget(back_buffer_view_)
      .SetViewports(1, &final_viewport_)
      .SetPixelShader(*scaling_pixel_shader_)
      .SetPixelShaderResource(0, rendered_view_)
      .SetPixelShaderSampler(*rendered_texture_sampler_)
      .Draw(4, 0);
  dx_device_->ClearPixelShaderResource(0);
}

void DirectXRenderer::RenderText() {
  dx_device_->SetRenderTarget(back_buffer_view_)
    .SetViewports(1, &final_viewport_)
    .SetInputLayout(*input_layout_)
    .SetVertexBuffers(*font_vertex_buffer_)
    .SetPrimitiveTopology(D3D10_PRIMITIVE_TOPOLOGY_TRIANGLESTRIP)
    .SetVertexShader(*depalettized_vertex_shader_)
    .SetBlendState(font_blend_state_)
    .SetPixelShader(*font_pixel_shader_)
    .SetPixelShaderResource(0, font_view_)
    .Draw(4, 0 /* TODO TODO TODO */);
  dx_device_->ClearPixelShaderResource(0)
    .ClearBlendState();
}

}  // namespace forge
}  // namespace sbat