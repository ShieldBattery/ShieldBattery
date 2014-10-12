#ifndef FORGE_DIRECT_X_H_
#define FORGE_DIRECT_X_H_

#include <node.h>
#include <Windows.h>
#include <array>
#include <comdef.h>
#include <map>
#include <memory>
#include <d3d10.h>
#include <d3dx10.h>
#include <D3Dcompiler.h>
#include <vector>
#include <xnamath.h>

#include "common/macros.h"
#include "common/types.h"
#include "forge/renderer.h"

namespace sbat {
namespace forge {

struct Vertex
{
  XMFLOAT2 pos;
  XMFLOAT2 texcoord;
};

class IndirectDraw;
class IndirectDrawPalette;
class DxDevice;

class DxRenderTargetView {
  friend class DxDevice;
public:
  ~DxRenderTargetView();

  ID3D10RenderTargetView* const* get() const { return &render_target_view_; }
private:
  DxRenderTargetView(ID3D10RenderTargetView& render_target_view);

  ID3D10RenderTargetView* render_target_view_;

  DISALLOW_COPY_AND_ASSIGN(DxRenderTargetView);
};

class DxShaderResourceView {
  friend class DxDevice;
public:
  ~DxShaderResourceView();

  ID3D10ShaderResourceView* const* get() const { return &shader_resource_view_; }
private:
  DxShaderResourceView(ID3D10ShaderResourceView& shader_resource_view);

  ID3D10ShaderResourceView* shader_resource_view_;

  DISALLOW_COPY_AND_ASSIGN(DxShaderResourceView);
};

class DxMappedTexture {
  friend class DxTexture;
public:
  ~DxMappedTexture();

  template<typename T>
  T GetData() const { return reinterpret_cast<T>(mapped_texture_.pData); }
  UINT GetRowPitch() const { return mapped_texture_.RowPitch; }
  D3D10_MAPPED_TEXTURE2D get() const { return mapped_texture_; }
private:
  DxMappedTexture(D3D10_MAPPED_TEXTURE2D mapped_texture);

  D3D10_MAPPED_TEXTURE2D mapped_texture_;

  DISALLOW_COPY_AND_ASSIGN(DxMappedTexture);
};

class DxTexture {
public:
  DxTexture(ID3D10Texture2D& texture);
  ~DxTexture();

  std::unique_ptr<DxRenderTargetView> CreateRenderTargetView(DxDevice& device);
  std::unique_ptr<DxShaderResourceView> CreateShaderResourceView(DxDevice& device,
      D3D10_SHADER_RESOURCE_VIEW_DESC srv_desc);
  DxMappedTexture* Map(UINT subresource);
  void Unmap(UINT subresource);

  ID3D10Texture2D* get() const { return texture_; }
private:
  ID3D10Texture2D* texture_;

  DISALLOW_COPY_AND_ASSIGN(DxTexture);
};

class DxSwapChain {
  friend class DxDevice;
public:
  ~DxSwapChain();

  std::unique_ptr<DxTexture> GetBuffer();
  void Present(UINT sync_interval, UINT flags) { swap_chain_->Present(sync_interval, flags); }

  IDXGISwapChain* get() const { return swap_chain_; }
private:
  DxSwapChain(IDXGISwapChain& swap_chain);

  IDXGISwapChain* swap_chain_;

  DISALLOW_COPY_AND_ASSIGN(DxSwapChain);
};

class DxBlob {
public:
  DxBlob(const std::string& src, LPCSTR type, LPCSTR version);
  virtual ~DxBlob();

  LPVOID GetBufferPointer() const { return blob_->GetBufferPointer(); }
  SIZE_T GetBufferSize() const { return blob_->GetBufferSize(); }
  LPVOID GetErrorBufferPointer() const { return error_blob_->GetBufferPointer(); }

  bool has_error() const { return result_ != S_OK; }
  ID3D10Blob* get() const { return blob_; }
  ID3D10Blob* get_error() const { return error_blob_; }
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

  ID3D10VertexShader* get() const { return vertex_shader_; }
private:
  DxVertexShader(ID3D10VertexShader& vertex_shader);

  ID3D10VertexShader* vertex_shader_;

  DISALLOW_COPY_AND_ASSIGN(DxVertexShader);
};

class DxPixelShader {
  friend class DxDevice;
public:
  ~DxPixelShader();

  ID3D10PixelShader* get() const { return pixel_shader_; }
private:
  DxPixelShader(ID3D10PixelShader& pixel_shader);

  ID3D10PixelShader* pixel_shader_;

  DISALLOW_COPY_AND_ASSIGN(DxPixelShader);
};

class DxInputLayout {
  friend class DxDevice;
public:
  ~DxInputLayout();

  ID3D10InputLayout* get() const { return input_layout_; }
private:
  DxInputLayout(ID3D10InputLayout& input_layout);

  ID3D10InputLayout* input_layout_;

  DISALLOW_COPY_AND_ASSIGN(DxInputLayout);
};

class DxSamplerState {
  friend class DxDevice;
public:
  ~DxSamplerState();

  ID3D10SamplerState* const* get() const { return &sampler_state_; }
private:
  DxSamplerState(ID3D10SamplerState& sampler_state);

  ID3D10SamplerState* sampler_state_;

  DISALLOW_COPY_AND_ASSIGN(DxSamplerState);
};

class DxBuffer {
public:
  DxBuffer(ID3D10Buffer& buffer);
  virtual ~DxBuffer();

  ID3D10Buffer* const* get() const { return &buffer_; }
private:
  ID3D10Buffer* buffer_;

  DISALLOW_COPY_AND_ASSIGN(DxBuffer);
};

class DxVertexBuffer : public DxBuffer {
  friend class DxDevice;
public:
  virtual ~DxVertexBuffer();
private:
  explicit DxVertexBuffer(ID3D10Buffer& buffer);
};

class DxDevice {
public:
  DxDevice();
  ~DxDevice();

  std::unique_ptr<DxSwapChain> CreateSwapChain(DXGI_SWAP_CHAIN_DESC swap_chain_desc);
  std::unique_ptr<DxVertexShader> CreateVertexShader(const DxVertexBlob& vertex_blob);
  std::unique_ptr<DxPixelShader> CreatePixelShader(const DxPixelBlob& pixel_blob);
  std::unique_ptr<DxTexture> CreateTexture2D(D3D10_TEXTURE2D_DESC texture_desc);
  std::unique_ptr<DxInputLayout> CreateInputLayout(
      const D3D10_INPUT_ELEMENT_DESC& input_layout_desc, UINT desc_size,
      const DxVertexBlob& vertex_blob);
  std::unique_ptr<DxRenderTargetView> CreateRenderTargetView(ID3D10Texture2D& texture);
  std::unique_ptr<DxShaderResourceView> CreateShaderResourceView(ID3D10Texture2D& texture,
      D3D10_SHADER_RESOURCE_VIEW_DESC srv_desc);
  std::unique_ptr<DxSamplerState> CreateSamplerState(D3D10_SAMPLER_DESC sampler_desc);
  std::unique_ptr<DxVertexBuffer> CreateVertexBuffer(D3D10_BUFFER_DESC buffer_desc,
      D3D10_SUBRESOURCE_DATA buffer_data);

  void OMSetRenderTargets(UINT num_views, ID3D10RenderTargetView* const* render_target_views,
      ID3D10DepthStencilView* depth_stencil_view) {
    device_->OMSetRenderTargets(num_views, render_target_views, depth_stencil_view);
  }
  void RSSetViewports(UINT num_view_ports, const D3D10_VIEWPORT* viewports) {
    device_->RSSetViewports(num_view_ports, viewports);
  }
  void IASetInputLayout(ID3D10InputLayout* input_layout) {
    device_->IASetInputLayout(input_layout);
  }
  void IASetVertexBuffers(UINT start_slot, UINT num_buffers, ID3D10Buffer* const* vertex_buffers,
      const UINT* strides, const UINT* offsets) {
    device_->IASetVertexBuffers(start_slot, num_buffers, vertex_buffers, strides, offsets);
  }
  void IASetPrimitiveTopology(D3D10_PRIMITIVE_TOPOLOGY topology) {
    device_->IASetPrimitiveTopology(topology);
  }
  void VSSetShader(ID3D10VertexShader* vertex_shader) {
    device_->VSSetShader(vertex_shader);
  }
  void PSSetShader(ID3D10PixelShader* pixel_shader) {
    device_->PSSetShader(pixel_shader);
  }
  void PSSetShaderResources(UINT start_slot, UINT num_views,
      ID3D10ShaderResourceView* const* shader_resource_views) {
    device_->PSSetShaderResources(start_slot, num_views, shader_resource_views);
  }
  void PSSetSamplers(UINT start_slot, UINT num_samplers, ID3D10SamplerState* const* samplers) {
    device_->PSSetSamplers(start_slot, num_samplers, samplers);
  }
  void Draw(UINT vertex_count, UINT start_vertex_location) {
    device_->Draw(vertex_count, start_vertex_location);
  }

  HRESULT get_result() const { return result_; }
  ID3D10Device* get() const { return device_; }
private:
  ID3D10Device* device_;
  IDXGIDevice* dxgi_device_;
  IDXGIAdapter* dxgi_adapter_;
  IDXGIFactory* dxgi_factory_;
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
    const PaletteTextureEntry result = { entry.peBlue, entry.peGreen, entry.peRed, 255 };
    return result;
  }

  static std::string last_error_;

  std::string error_;
  HWND window_;
  RECT client_rect_;

  std::unique_ptr<DxDevice> dx_device_;
  std::unique_ptr<DxSwapChain> dx_swap_chain_;
  std::unique_ptr<DxTexture> back_buffer_;
  std::unique_ptr<DxRenderTargetView> back_buffer_render_target_view_;
  std::unique_ptr<DxRenderTargetView> depalettized_render_target_view_;
  
  std::unique_ptr<DxVertexShader> depalettized_vertex_shader_;
  std::unique_ptr<DxPixelShader> depalettized_pixel_shader_;
  std::unique_ptr<DxInputLayout> input_layout_;
  std::unique_ptr<DxPixelShader> scaling_pixel_shader_;
  std::unique_ptr<DxVertexBuffer> vertex_buffer_;

  std::unique_ptr<DxTexture> palette_texture_;
  std::unique_ptr<DxTexture> bw_screen_texture_;
  std::unique_ptr<DxTexture> rendered_texture_;
  std::unique_ptr<DxShaderResourceView> bw_screen_view_;
  std::unique_ptr<DxShaderResourceView> palette_view_;
  std::unique_ptr<DxShaderResourceView> rendered_view_;
  std::unique_ptr<DxSamplerState> rendered_texture_sampler_;

  uint32 ddraw_width_;
  uint32 ddraw_height_;
  RendererDisplayMode display_mode_;
  bool maintain_aspect_ratio_;
  uint32 aspect_ratio_width_;
  uint32 aspect_ratio_height_;
  LARGE_INTEGER counter_frequency_;
  LARGE_INTEGER last_frame_time_;

  DISALLOW_COPY_AND_ASSIGN(DirectX);
};

}  // namespace forge
}  // namespace sbat

#endif  // FORGE_DIRECT_X_H_