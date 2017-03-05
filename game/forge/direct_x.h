#pragma once

#include <node.h>
#include <Windows.h>
#include <comdef.h>
#include <d3d10.h>
#include <D3Dcompiler.h>
#include <DirectXMath.h>
#include <array>
#include <map>
#include <memory>
#include <string>
#include <utility>
#include <vector>

#include "common/types.h"
#include "forge/com_utils.h"
#include "forge/renderer.h"
#include "forge/renderer_utils.h"

namespace sbat {
namespace forge {

struct Vertex {
  DirectX::XMFLOAT2 pos;
  DirectX::XMFLOAT2 texcoord;
};

class IndirectDraw;
class IndirectDrawPalette;
class DxDevice;

class DxTexture {
public:
  ~DxTexture();

  static std::unique_ptr<DxTexture> NewTexture(const DxDevice& device,
      const D3D10_TEXTURE2D_DESC& texture_desc);
  static std::unique_ptr<DxTexture> FromSwapChain(IDXGISwapChain* swapChain);

  ID3D10Texture2D* get() const { return texture_; }
private:
  explicit DxTexture(ID3D10Texture2D* texture);

  // Disallow copying
  DxTexture(const DxTexture&) = delete;
  DxTexture& operator=(const DxTexture&) = delete;

  ID3D10Texture2D* texture_;
};

class DxTextureMapper {
public:
  DxTextureMapper(const DxTexture& texture, uint32 mip_slice, uint32 array_slice,
      uint32 mip_levels);
  ~DxTextureMapper();

  template<typename T>
  T GetData() const { return reinterpret_cast<T>(mapped_texture_.pData); }
  uint32 GetRowPitch() const { return mapped_texture_.RowPitch; }
  bool has_error() const { return result_ != S_OK; }
  HRESULT error() const { return result_; }
  D3D10_MAPPED_TEXTURE2D get() const { return mapped_texture_; }
private:
  // Disallow copying
  DxTextureMapper(const DxTextureMapper&) = delete;
  DxTextureMapper& operator=(const DxTextureMapper&) = delete;

  HRESULT result_;
  uint32 subresource_;
  std::unique_ptr<ID3D10Texture2D, ComDeleter> texture_;
  D3D10_MAPPED_TEXTURE2D mapped_texture_;
};

class DxBlob {
public:
  DxBlob(const std::string& src, const std::string& type, const std::string& version);
  virtual ~DxBlob();

  void* GetBufferPointer() const { return blob_->GetBufferPointer(); }
  size_t GetBufferSize() const { return blob_->GetBufferSize(); }
  void* GetErrorBufferPointer() const { return error_blob_->GetBufferPointer(); }

  bool has_error() const { return result_ != S_OK; }
  ID3D10Blob* get() const { return blob_; }
private:
  // Disallow copying
  DxBlob(const DxBlob&) = delete;
  DxBlob& operator=(const DxBlob&) = delete;

  ID3D10Blob* blob_;
  ID3D10Blob* error_blob_;
  HRESULT result_;
};


class DxVertexBlob : public DxBlob {
public:
  explicit DxVertexBlob(const std::string& src);
  virtual ~DxVertexBlob();
};

class DxPixelBlob : public DxBlob {
public:
  explicit DxPixelBlob(const std::string& src);
  virtual ~DxPixelBlob();
};

class DxVertexShader {
  friend class DxDevice;
public:
  ~DxVertexShader();

  HRESULT result() const { return result_; }
  ID3D10VertexShader* get() const { return vertex_shader_; }
private:
  DxVertexShader(const DxDevice& device, const DxVertexBlob& vertex_blob);

  // Disallow copying
  DxVertexShader(const DxVertexShader&) = delete;
  DxVertexShader& operator=(const DxVertexShader&) = delete;

  HRESULT result_;
  ID3D10VertexShader* vertex_shader_;
};

class DxPixelShader {
  friend class DxDevice;
public:
  ~DxPixelShader();

  HRESULT result() const { return result_; }
  ID3D10PixelShader* get() const { return pixel_shader_; }
private:
  DxPixelShader(const DxDevice& device, const DxPixelBlob& pixel_blob);

  // Disallow copying
  DxPixelShader(const DxPixelShader&) = delete;
  DxPixelShader& operator=(const DxPixelShader&) = delete;

  HRESULT result_;
  ID3D10PixelShader* pixel_shader_;
};

class DxVertexBuffer {
  friend class DxDevice;
public:
  ~DxVertexBuffer();

  HRESULT result() const { return result_; }
  ID3D10Buffer* get() const { return buffer_; }
  uint32 stride() const { return stride_; }
  uint32 offset() const { return offset_; }
private:
  DxVertexBuffer(const DxDevice& device, const D3D10_BUFFER_DESC& buffer_desc,
      const D3D10_SUBRESOURCE_DATA& buffer_data, uint32 stride, uint32 offset);

  // Disallow copying
  DxVertexBuffer(const DxVertexBuffer&) = delete;
  DxVertexBuffer& operator=(const DxVertexBuffer&) = delete;

  HRESULT result_;
  ID3D10Buffer* buffer_;
  uint32 stride_;
  uint32 offset_;
};

class DxVertexBufferMapper {
public:
  DxVertexBufferMapper(const DxVertexBuffer& buffer);
  ~DxVertexBufferMapper();

  template<typename T>
  T GetData() const { return reinterpret_cast<T>(mapped_buffer_); }
  bool has_error() const { return result_ != S_OK; }
  HRESULT error() const { return result_; }
private:
  // Disallow copying
  DxVertexBufferMapper(const DxVertexBufferMapper&) = delete;
  DxVertexBufferMapper& operator=(const DxVertexBufferMapper&) = delete;

  HRESULT result_;
  std::unique_ptr<ID3D10Buffer, ComDeleter> buffer_;
  void* mapped_buffer_;
};

typedef std::unique_ptr<ID3D10RenderTargetView, ComDeleter> PtrDxRenderTargetView;
typedef std::unique_ptr<ID3D10ShaderResourceView, ComDeleter> PtrDxShaderResourceView;

class DxDevice {
public:
  DxDevice();
  ~DxDevice();

  std::unique_ptr<DxVertexShader> CreateVertexShader(const DxVertexBlob& vertex_blob);
  std::unique_ptr<DxPixelShader> CreatePixelShader(const DxPixelBlob& pixel_blob);
  PtrDxRenderTargetView CreateRenderTargetView(const DxTexture& texture);
  PtrDxShaderResourceView CreateShaderResourceView(const DxTexture& texture,
      const D3D10_SHADER_RESOURCE_VIEW_DESC& srv_desc);
  std::unique_ptr<DxVertexBuffer> CreateVertexBuffer(const D3D10_BUFFER_DESC& buffer_desc,
      const D3D10_SUBRESOURCE_DATA& buffer_data, uint32 stride, uint32 offset);

  DxDevice& SetRenderTarget(const PtrDxRenderTargetView& target_view) {
    ID3D10RenderTargetView* views[] = { target_view.get() };
    device_->OMSetRenderTargets(1, views, nullptr);
    return *this;
  }
  DxDevice& SetBlendState(const SafeComPtr<ID3D10BlendState> blend_state) {
    const float blend_factor[] = {1, 1, 1, 1};
    device_->OMSetBlendState(blend_state.get(), blend_factor, 0xffffffff);
    return *this;
  }
  DxDevice& ClearBlendState() {
    const float blend_factor[] = {1, 1, 1, 1};
    device_->OMSetBlendState(nullptr, blend_factor, 0xffffffff);
    return *this;
  }
  DxDevice& SetViewports(uint32 num_viewports, const D3D10_VIEWPORT* viewports) {
    device_->RSSetViewports(num_viewports, viewports);
    return *this;
  }
  DxDevice& SetInputLayout(ID3D10InputLayout* inputLayout) {
    device_->IASetInputLayout(inputLayout);
    return *this;
  }
  DxDevice& SetVertexBuffers(const DxVertexBuffer& vertex_buffer) {
    ID3D10Buffer* buffers[] = { vertex_buffer.get() };
    uint32 strides[] = { vertex_buffer.stride() };
    uint32 offsets[] = { vertex_buffer.offset() };
    device_->IASetVertexBuffers(0, 1, buffers, strides, offsets);
    return *this;
  }
  DxDevice& SetPrimitiveTopology(D3D10_PRIMITIVE_TOPOLOGY topology) {
    device_->IASetPrimitiveTopology(topology);
    return *this;
  }
  DxDevice& SetVertexShader(const DxVertexShader& vertex_shader) {
    device_->VSSetShader(vertex_shader.get());
    return *this;
  }
  DxDevice& SetPixelShader(const DxPixelShader& pixel_shader) {
    device_->PSSetShader(pixel_shader.get());
    return *this;
  }
  DxDevice& SetPixelShaderResource(uint32 start_slot, const PtrDxShaderResourceView& resource_view) {
    ID3D10ShaderResourceView* views[] = { resource_view.get() };
    device_->PSSetShaderResources(start_slot, 1, views);
    return *this;
  }
  DxDevice& ClearPixelShaderResource(uint32 start_slot) {
    ID3D10ShaderResourceView* views[] = { nullptr };
    device_->PSSetShaderResources(start_slot, 1, views);
    return *this;
  }
  DxDevice& SetPixelShaderSampler(ID3D10SamplerState* sampler) {
    ID3D10SamplerState * samplers[] =  { sampler };
    device_->PSSetSamplers(0, 1, samplers);
    return *this;
  }
  DxDevice& Draw(uint32 vertex_count, uint32 start_vertex_location) {
    device_->Draw(vertex_count, start_vertex_location);
    return *this;
  }

  HRESULT result() const { return result_; }
  ID3D10Device* get() const { return device_; }

private:
  // Disallow copying
  DxDevice(const DxDevice&) = delete;
  DxDevice& operator=(const DxDevice&) = delete;

  ID3D10Device* device_;
  HRESULT result_;
};

class DirectXRenderer : public Renderer {
public:
  virtual ~DirectXRenderer();

  static std::unique_ptr<DirectXRenderer> Create(HWND window, uint32 ddraw_width,
      uint32 ddraw_height, RendererDisplayMode display_mode, bool maintain_aspect_ratio,
      const std::map<std::string, std::pair<std::string, std::string>>& shaders);
  static std::string GetLastError();

  virtual void Render(const std::vector<byte>& surface_data);
  virtual void UpdatePalette(const IndirectDrawPalette& palette);
  virtual void UpdateFontAtlas(const std::vector<uint32>& pixels, uint32 width, uint32 height);

  bool has_error() { return !error_.empty(); }
  std::string error() { return error_; }

private:
  #pragma pack(push, 1)
  struct PaletteTextureEntry {
    byte blue;
    byte green;
    byte red;
    byte alpha;
  };
  #pragma pack(pop)

  DirectXRenderer(HWND window, uint32 ddraw_width, uint32 ddraw_height,
      RendererDisplayMode display_mode, bool maintain_aspect_ratio,
      const std::map<std::string, std::pair<std::string, std::string>>& shaders);
  bool InitShaders(const std::map<std::string, std::pair<std::string, std::string>>& shaders);
  bool InitDepalettizingShader(
      const std::map<std::string, std::pair<std::string, std::string>>& shaders);
  bool InitScalingShader(
      const std::map<std::string, std::pair<std::string, std::string>>& shaders);
  bool InitFontShader(
    const std::map<std::string, std::pair<std::string, std::string>>& shaders);
  bool InitTextures();
  bool InitRenderedTexture();
  bool InitBwScreenTexture();
  bool InitPaletteTexture();
  bool InitFontAtlasTexture();
  bool InitVertices();
  bool InitFontVertexBuffer();

  void CopyDdrawSurface(const std::vector<byte>& surface_data);
  void ConvertToFullColor();
  void RenderToScreen();
  void RenderText();

  static inline PaletteTextureEntry ConvertToPaletteTextureEntry(const PALETTEENTRY& entry) {
    const PaletteTextureEntry result = { entry.peRed, entry.peGreen, entry.peBlue, 255 };
    return result;
  }

  // Disallow copying
  DirectXRenderer(const DirectXRenderer&) = delete;
  DirectXRenderer& operator=(const DirectXRenderer&) = delete;

  static std::string last_error_;

  std::string error_;
  HWND window_;
  RECT client_rect_;

  std::unique_ptr<DxDevice> dx_device_;
  SafeComPtr<IDXGISwapChain> swapChain_;
  std::unique_ptr<DxTexture> back_buffer_;
  PtrDxRenderTargetView back_buffer_view_;
  PtrDxRenderTargetView depalettized_view_;

  std::unique_ptr<DxVertexShader> depalettized_vertex_shader_;
  std::unique_ptr<DxPixelShader> depalettized_pixel_shader_;
  std::unique_ptr<DxPixelShader> scaling_pixel_shader_;
  std::unique_ptr<DxPixelShader> font_pixel_shader_;
  SafeComPtr<ID3D10InputLayout> inputLayout_;
  std::unique_ptr<DxVertexBuffer> vertex_buffer_;

  std::unique_ptr<DxTexture> palette_texture_;
  std::unique_ptr<DxTexture> bw_screen_texture_;
  std::unique_ptr<DxTexture> rendered_texture_;
  PtrDxShaderResourceView bw_screen_view_;
  PtrDxShaderResourceView palette_view_;
  PtrDxShaderResourceView rendered_view_;
  SafeComPtr<ID3D10SamplerState> renderedTextureSampler_;

  std::unique_ptr<DxTexture> font_atlas_;
  PtrDxShaderResourceView font_view_;
  std::unique_ptr<DxVertexBuffer> font_vertex_buffer_;
  SafeComPtr<ID3D10BlendState> font_blend_state_;

  uint32 ddraw_width_;
  uint32 ddraw_height_;
  D3D10_VIEWPORT ddraw_viewport_;
  D3D10_VIEWPORT final_viewport_;
  RenderSkipper render_skipper_;
};

}  // namespace forge
}  // namespace sbat
