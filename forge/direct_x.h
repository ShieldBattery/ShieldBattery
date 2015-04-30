#ifndef FORGE_DIRECT_X_H_
#define FORGE_DIRECT_X_H_

#include <node.h>
#include <Windows.h>
#include <comdef.h>
#include <d3d10.h>
#include <d3dx10.h>
#include <D3Dcompiler.h>
#include <xnamath.h>
#include <array>
#include <map>
#include <memory>
#include <string>
#include <utility>
#include <vector>

#include "common/macros.h"
#include "common/types.h"
#include "forge/renderer.h"
#include "forge/renderer_utils.h"

namespace sbat {
namespace forge {

template<typename ComType>
void ReleaseCom(ComType* obj) {
  if (obj) {
    obj->Release();
  }
}

struct ComDeleter {
public:
  template<typename T>
  void operator()(T* obj) {
    obj->Release();
  }
};

template<typename ComType>
std::unique_ptr<ComType, ComDeleter> WrapComVoid(void* output_ptr) {
  return std::unique_ptr<ComType, ComDeleter>(reinterpret_cast<ComType*>(output_ptr));
}

struct Vertex {
  XMFLOAT2 pos;
  XMFLOAT2 texcoord;
};

class IndirectDraw;
class IndirectDrawPalette;
class DxDevice;

class DxSwapChain {
  friend class DxDevice;
public:
  ~DxSwapChain();

  void Present(uint32 sync_interval, uint32 flags) { swap_chain_->Present(sync_interval, flags); }

  HRESULT result() const { return result_; }
  IDXGISwapChain* get() const { return swap_chain_; }
private:
  DxSwapChain(const DxDevice& device, DXGI_SWAP_CHAIN_DESC* swap_chain_desc);

  HRESULT result_;
  IDXGISwapChain* swap_chain_;

  DISALLOW_COPY_AND_ASSIGN(DxSwapChain);
};

class DxTexture {
public:
  ~DxTexture();

  static std::unique_ptr<DxTexture> NewTexture(const DxDevice& device,
      const D3D10_TEXTURE2D_DESC& texture_desc);
  static std::unique_ptr<DxTexture> FromSwapChain(const DxSwapChain& swap_chain);

  ID3D10Texture2D* get() const { return texture_; }
private:
  explicit DxTexture(ID3D10Texture2D* texture);

  ID3D10Texture2D* texture_;

  DISALLOW_COPY_AND_ASSIGN(DxTexture);
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
  HRESULT result_;
  uint32 subresource_;
  std::unique_ptr<ID3D10Texture2D, ComDeleter> texture_;
  D3D10_MAPPED_TEXTURE2D mapped_texture_;

  DISALLOW_COPY_AND_ASSIGN(DxTextureMapper);
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
  ID3D10Blob* blob_;
  ID3D10Blob* error_blob_;
  HRESULT result_;

  DISALLOW_COPY_AND_ASSIGN(DxBlob);
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

  HRESULT result_;
  ID3D10VertexShader* vertex_shader_;

  DISALLOW_COPY_AND_ASSIGN(DxVertexShader);
};

class DxPixelShader {
  friend class DxDevice;
public:
  ~DxPixelShader();

  HRESULT result() const { return result_; }
  ID3D10PixelShader* get() const { return pixel_shader_; }
private:
  DxPixelShader(const DxDevice& device, const DxPixelBlob& pixel_blob);

  HRESULT result_;
  ID3D10PixelShader* pixel_shader_;

  DISALLOW_COPY_AND_ASSIGN(DxPixelShader);
};

class DxInputLayout {
  friend class DxDevice;
public:
  ~DxInputLayout();

  HRESULT result() const { return result_; }
  ID3D10InputLayout* get() const { return input_layout_; }
private:
  DxInputLayout(const DxDevice& device, const D3D10_INPUT_ELEMENT_DESC& input_layout_desc,
      uint32 desc_size, const DxVertexBlob& vertex_blob);

  HRESULT result_;
  ID3D10InputLayout* input_layout_;

  DISALLOW_COPY_AND_ASSIGN(DxInputLayout);
};

class DxSamplerState {
  friend class DxDevice;
public:
  ~DxSamplerState();

  HRESULT result() const { return result_; }
  ID3D10SamplerState* get() const { return sampler_state_; }
private:
  DxSamplerState(const DxDevice& device, const D3D10_SAMPLER_DESC& sampler_desc);

  HRESULT result_;
  ID3D10SamplerState* sampler_state_;

  DISALLOW_COPY_AND_ASSIGN(DxSamplerState);
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

  HRESULT result_;
  ID3D10Buffer* buffer_;
  uint32 stride_;
  uint32 offset_;

  DISALLOW_COPY_AND_ASSIGN(DxVertexBuffer);
};

typedef std::unique_ptr<ID3D10RenderTargetView, ComDeleter> PtrDxRenderTargetView;
typedef std::unique_ptr<ID3D10ShaderResourceView, ComDeleter> PtrDxShaderResourceView;

class DxDevice {
public:
  DxDevice();
  ~DxDevice();

  std::unique_ptr<DxSwapChain> CreateSwapChain(DXGI_SWAP_CHAIN_DESC* swap_chain_desc);
  std::unique_ptr<DxVertexShader> CreateVertexShader(const DxVertexBlob& vertex_blob);
  std::unique_ptr<DxPixelShader> CreatePixelShader(const DxPixelBlob& pixel_blob);
  std::unique_ptr<DxInputLayout> CreateInputLayout(
      const D3D10_INPUT_ELEMENT_DESC& input_layout_desc, uint32 desc_size,
      const DxVertexBlob& vertex_blob);
  PtrDxRenderTargetView CreateRenderTargetView(const DxTexture& texture);
  PtrDxShaderResourceView CreateShaderResourceView(const DxTexture& texture,
      const D3D10_SHADER_RESOURCE_VIEW_DESC& srv_desc);
  std::unique_ptr<DxSamplerState> CreateSamplerState(const D3D10_SAMPLER_DESC& sampler_desc);
  std::unique_ptr<DxVertexBuffer> CreateVertexBuffer(const D3D10_BUFFER_DESC& buffer_desc,
      const D3D10_SUBRESOURCE_DATA& buffer_data, uint32 stride, uint32 offset);

  DxDevice& SetRenderTarget(const PtrDxRenderTargetView& target_view) {
    ID3D10RenderTargetView* views[] = { target_view.get() };
    device_->OMSetRenderTargets(1, views, nullptr);
    return *this;
  }
  DxDevice& SetViewports(uint32 num_viewports, const D3D10_VIEWPORT* viewports) {
    device_->RSSetViewports(num_viewports, viewports);
    return *this;
  }
  DxDevice& SetInputLayout(const DxInputLayout& input_layout) {
    device_->IASetInputLayout(input_layout.get());
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
  DxDevice& SetPixelShaderSampler(const DxSamplerState& sampler) {
    ID3D10SamplerState* samplers[] =  { sampler.get() };
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
  ID3D10Device* device_;
  HRESULT result_;

  DISALLOW_COPY_AND_ASSIGN(DxDevice);
};

class DirectX : public Renderer {
public:
  virtual ~DirectX();

  static std::unique_ptr<DirectX> Create(HWND window, uint32 ddraw_width, uint32 ddraw_height,
      RendererDisplayMode display_mode, bool maintain_aspect_ratio,
      const std::map<std::string, std::pair<std::string, std::string>>& shaders);
  static std::string GetLastError();

  virtual void Render(const std::vector<byte>& surface_data);
  virtual void UpdatePalette(const IndirectDrawPalette& palette);

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

  DirectX(HWND window, uint32 ddraw_width, uint32 ddraw_height, RendererDisplayMode display_mode,
      bool maintain_aspect_ratio,
      const std::map<std::string, std::pair<std::string, std::string>>& shaders);
  bool InitShaders(const std::map<std::string, std::pair<std::string, std::string>>& shaders);
  bool InitDepalettizingShader(
      const std::map<std::string, std::pair<std::string, std::string>>& shaders);
  bool InitScalingShader(
      const std::map<std::string, std::pair<std::string, std::string>>& shaders);
  bool InitTextures();
  bool InitRenderedTexture();
  bool InitBwScreenTexture();
  bool InitPaletteTexture();
  bool InitVertices();

  void CopyDdrawSurface(const std::vector<byte>& surface_data);
  void ConvertToFullColor();
  void RenderToScreen();

  static inline PaletteTextureEntry ConvertToPaletteTextureEntry(const PALETTEENTRY& entry) {
    const PaletteTextureEntry result = { entry.peRed, entry.peGreen, entry.peBlue, 255 };
    return result;
  }

  static std::string last_error_;

  std::string error_;
  HWND window_;
  RECT client_rect_;

  std::unique_ptr<DxDevice> dx_device_;
  std::unique_ptr<DxSwapChain> swap_chain_;
  std::unique_ptr<DxTexture> back_buffer_;
  PtrDxRenderTargetView back_buffer_view_;
  PtrDxRenderTargetView depalettized_view_;

  std::unique_ptr<DxVertexShader> depalettized_vertex_shader_;
  std::unique_ptr<DxPixelShader> depalettized_pixel_shader_;
  std::unique_ptr<DxInputLayout> input_layout_;
  std::unique_ptr<DxPixelShader> scaling_pixel_shader_;
  std::unique_ptr<DxVertexBuffer> vertex_buffer_;

  std::unique_ptr<DxTexture> palette_texture_;
  std::unique_ptr<DxTexture> bw_screen_texture_;
  std::unique_ptr<DxTexture> rendered_texture_;
  PtrDxShaderResourceView bw_screen_view_;
  PtrDxShaderResourceView palette_view_;
  PtrDxShaderResourceView rendered_view_;
  std::unique_ptr<DxSamplerState> rendered_texture_sampler_;

  uint32 ddraw_width_;
  uint32 ddraw_height_;
  D3D10_VIEWPORT ddraw_viewport_;
  D3D10_VIEWPORT final_viewport_;
  RenderSkipper render_skipper_;

  DISALLOW_COPY_AND_ASSIGN(DirectX);
};

}  // namespace forge
}  // namespace sbat

#endif  // FORGE_DIRECT_X_H_