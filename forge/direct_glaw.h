#ifndef FORGE_DIRECT_GLAW_H_
#define FORGE_DIRECT_GLAW_H_
// Fake DirectDraw7 implementation that forwards drawing responsibility to OpenGL
// Designed to handle everything Brood War needs, not guaranteed to work for anything else

#include <node.h>
#include <Windows.h>
#include <ddraw.h>
#include <gl/glew.h>
#include <gl/gl.h>
#include <array>
#include <memory>
#include <vector>

#include "common/types.h"

// enables/disables in-depth logging about DirectDraw method calls
#define DIRECTDRAWLOG false

namespace sbat {
namespace forge {

HRESULT WINAPI DirectGlawCreate(GUID* guid_ptr, IDirectDraw7** direct_draw_out, IUnknown* unused);

struct ShaderResources {
  struct {
    GLint bw_screen;
    GLint palette;
  } uniforms;

  struct {
    GLint position;
    GLint texpos;
  } attributes;
};

class DirectGlaw : public IDirectDraw7 {
public:
  DirectGlaw();
  virtual ~DirectGlaw();

  // COM methods, woohoo. Renamed parameters and stuff to better match the style around here
  /*** IUnknown methods ***/
  HRESULT WINAPI QueryInterface(REFIID riid, void** obj_out);
  ULONG WINAPI AddRef();
  ULONG WINAPI Release();
  /*** IDirectDraw methods ***/
  HRESULT WINAPI Compact();
  HRESULT WINAPI CreateClipper(DWORD flags, IDirectDrawClipper** clipper_out, IUnknown* unused);
  HRESULT WINAPI CreatePalette(DWORD flags, PALETTEENTRY* color_array,
      IDirectDrawPalette** palette_out, IUnknown* unused);
  HRESULT WINAPI CreateSurface(DDSURFACEDESC2* surface_desc, IDirectDrawSurface7** surface_out,
      IUnknown* unused);
  HRESULT WINAPI DuplicateSurface(IDirectDrawSurface7* surface, IDirectDrawSurface7** duped_out);
  HRESULT WINAPI EnumDisplayModes(DWORD flags, DDSURFACEDESC2* surface_desc, void* context,
      LPDDENUMMODESCALLBACK2 callback);
  HRESULT WINAPI EnumSurfaces(DWORD flags, DDSURFACEDESC2* surface_desc, void* context,
      LPDDENUMSURFACESCALLBACK7 callback);
  HRESULT WINAPI FlipToGDISurface();
  HRESULT WINAPI GetCaps(DDCAPS* driver_caps, DDCAPS* hel_caps);
  HRESULT WINAPI GetDisplayMode(DDSURFACEDESC2* surface_desc);
  HRESULT WINAPI GetFourCCCodes(DWORD* num_codes, DWORD* codes);
  HRESULT WINAPI GetGDISurface(IDirectDrawSurface7** surface_out);
  HRESULT WINAPI GetMonitorFrequency(DWORD* freq);
  HRESULT WINAPI GetScanLine(DWORD* scanline);
  HRESULT WINAPI GetVerticalBlankStatus(BOOL* is_in_vertical_blank);
  HRESULT WINAPI Initialize(GUID* guid);
  HRESULT WINAPI RestoreDisplayMode();
  HRESULT WINAPI SetCooperativeLevel(HWND window_handle, DWORD flags);
  HRESULT WINAPI SetDisplayMode(DWORD width, DWORD height, DWORD bpp, DWORD refresh_rate,
      DWORD flags);
  HRESULT WINAPI WaitForVerticalBlank(DWORD flags, HANDLE event_handle);
  /*** Added in the v2 interface ***/
  HRESULT WINAPI GetAvailableVidMem(DDSCAPS2* caps, DWORD* total, DWORD* free);
  /*** Added in the V4 Interface ***/
  HRESULT WINAPI GetSurfaceFromDC(HDC dc_handle, IDirectDrawSurface7** surface_out);
  HRESULT WINAPI RestoreAllSurfaces();
  HRESULT WINAPI TestCooperativeLevel();
  HRESULT WINAPI GetDeviceIdentifier(DDDEVICEIDENTIFIER2* identifier, DWORD flags);
  HRESULT WINAPI StartModeTest(SIZE* modes_to_test, DWORD num_entries, DWORD flags);
  HRESULT WINAPI EvaluateMode(DWORD flags, DWORD* timeout_secs);

  // custom methods
  inline DWORD display_width() const { return display_width_; }
  inline DWORD display_height() const { return display_height_; }
  inline DWORD display_bpp() const { return display_bpp_; }
  inline GLuint shader_program() const { return shader_program_; }
  inline const ShaderResources* shader_resources() const { return &shader_resources_; }
  inline HWND window() const { return window_; }
  void InitializeOpenGl();
  void SwapBuffers();
  void SetVertexShader(char* shader_src);
  void SetFragmentShader(char* shader_src);

private:
  GLuint BuildShader(GLenum type, const char* src);
  void BuildProgram();

  int refcount_;
  HWND window_;
  HDC dc_;
  HGLRC gl_context_;
  DWORD display_width_;
  DWORD display_height_;
  DWORD display_bpp_;
  bool opengl_initialized_;
  GLuint vertex_shader_;
  GLuint fragment_shader_;
  GLuint shader_program_;
  ShaderResources shader_resources_;
};

class DirectGlawPalette : public IDirectDrawPalette {
public:
  DirectGlawPalette(DWORD flags, PALETTEENTRY* color_array);
  virtual ~DirectGlawPalette();

  /*** IUnknown methods ***/
  HRESULT WINAPI QueryInterface(REFIID riid, void** obj_out);
  ULONG WINAPI AddRef();
  ULONG WINAPI Release();
  /*** IDirectDrawPalette methods ***/
  HRESULT WINAPI GetCaps(DWORD* caps);
  HRESULT WINAPI GetEntries(DWORD flags, DWORD start, DWORD count, PALETTEENTRY* palette_out);
  HRESULT WINAPI Initialize(IDirectDraw* owner, DWORD flags, PALETTEENTRY* color_array);
  HRESULT WINAPI SetEntries(DWORD unused, DWORD start, DWORD count, PALETTEENTRY* entries);

  // Custom functions
  void InitForOpenGl();
  inline void BindTexture(GLint uniform, int glTexture, int texture_slot) {
    glActiveTexture(glTexture);
    glBindTexture(GL_TEXTURE_2D, texture_);
    glUniform1i(uniform, texture_slot);
  }

private:
#pragma pack(push, 1)
  struct PaletteTextureEntry {
    byte blue;
    byte green;
    byte red;
    byte alpha;
  };
#pragma pack(pop)

  static inline PaletteTextureEntry ConvertToPaletteTextureEntry(const PALETTEENTRY& entry) {
    const PaletteTextureEntry result = { entry.peBlue, entry.peGreen, entry.peRed, 255 };
    return result;
  }

  int refcount_;
  std::array<PALETTEENTRY, 256> entries_;
  std::array<PaletteTextureEntry, 256> texture_data_;
  GLuint texture_;
  bool is_opengl_inited;
};

template <typename T, int n>
class GlStaticBuffer {
public:
  GlStaticBuffer(GLenum buffer_target, const std::array<T, n>& data) : data_(data), buffer_(0) {
    glGenBuffers(1, &buffer_);
    glBindBuffer(buffer_target, buffer_);
    glBufferData(buffer_target, data_.size() * sizeof(T), &data_[0], GL_STATIC_DRAW);
  }

  ~GlStaticBuffer() {
    if (buffer_) {
      glDeleteBuffers(1, &buffer_);
    }
  }

  inline GLuint buffer() { return buffer_; }

private:
  // Disable copying
  GlStaticBuffer(const GlStaticBuffer&);
  GlStaticBuffer& operator=(const GlStaticBuffer&);

  std::array<T, n> data_;
  GLuint buffer_;
};

class DirectGlawSurface : public IDirectDrawSurface7 {
public:
  DirectGlawSurface(DirectGlaw* owner, DDSURFACEDESC2* surface_desc);
  virtual ~DirectGlawSurface();

  /*** IUnknown methods ***/
  HRESULT WINAPI QueryInterface(REFIID riid, void** obj_out);
  ULONG WINAPI AddRef();
  ULONG WINAPI Release();
  /*** IDirectDrawSurface methods ***/
  HRESULT WINAPI AddAttachedSurface(IDirectDrawSurface7* surface);
  HRESULT WINAPI AddOverlayDirtyRect(RECT* dirty_rect);
  HRESULT WINAPI Blt(RECT* dest_rect, IDirectDrawSurface7* src, RECT* src_rect, DWORD flags,
      DDBLTFX* fx);
  HRESULT WINAPI BltBatch(DDBLTBATCH* operations, DWORD count, DWORD unused);
  HRESULT WINAPI BltFast(DWORD x, DWORD y, IDirectDrawSurface7* src, RECT* src_rect, DWORD flags);
  HRESULT WINAPI DeleteAttachedSurface(DWORD flags, IDirectDrawSurface7* attached);
  HRESULT WINAPI EnumAttachedSurfaces(void* context, LPDDENUMSURFACESCALLBACK7 callback);
  HRESULT WINAPI EnumOverlayZOrders(DWORD flags, void* context,
      LPDDENUMSURFACESCALLBACK7 callback);
  HRESULT WINAPI Flip(IDirectDrawSurface7* target_override, DWORD flags);
  HRESULT WINAPI GetAttachedSurface(DDSCAPS2* caps, IDirectDrawSurface7** surface_out);
  HRESULT WINAPI GetBltStatus(DWORD flags);
  HRESULT WINAPI GetCaps(DDSCAPS2* caps_out);
  HRESULT WINAPI GetClipper(IDirectDrawClipper** clipper_out);
  HRESULT WINAPI GetColorKey(DWORD flags, DDCOLORKEY* color_key_out);
  HRESULT WINAPI GetDC(HDC* dc_out);
  HRESULT WINAPI GetFlipStatus(DWORD flags);
  HRESULT WINAPI GetOverlayPosition(LONG* x_out, LONG* y_out);
  HRESULT WINAPI GetPalette(IDirectDrawPalette** palette_out);
  HRESULT WINAPI GetPixelFormat(DDPIXELFORMAT* pixel_format_out);
  HRESULT WINAPI GetSurfaceDesc(DDSURFACEDESC2* surface_desc_out);
  HRESULT WINAPI Initialize(IDirectDraw* direct_draw, DDSURFACEDESC2* surface_desc);
  HRESULT WINAPI IsLost();
  HRESULT WINAPI Lock(RECT* dest_rect, DDSURFACEDESC2* surface_desc, DWORD flags, HANDLE unused);
  HRESULT WINAPI ReleaseDC(HDC dc);
  HRESULT WINAPI Restore();
  HRESULT WINAPI SetClipper(IDirectDrawClipper* clipper);
  HRESULT WINAPI SetColorKey(DWORD flags, DDCOLORKEY* color_key);
  HRESULT WINAPI SetOverlayPosition(LONG x, LONG y);
  HRESULT WINAPI SetPalette(IDirectDrawPalette* palette);
  HRESULT WINAPI Unlock(RECT* locked_rect);
  HRESULT WINAPI UpdateOverlay(RECT* src_rect, IDirectDrawSurface7* dest_surface, RECT* dest_rect,
      DWORD flags, DDOVERLAYFX* overlay_fx);
  HRESULT WINAPI UpdateOverlayDisplay(DWORD unused);
  HRESULT WINAPI UpdateOverlayZOrder(DWORD flags, IDirectDrawSurface7* surface_ref);
  /*** Added in the v2 interface ***/
  HRESULT WINAPI GetDDInterface(void** direct_draw);
  HRESULT WINAPI PageLock(DWORD unused);
  HRESULT WINAPI PageUnlock(DWORD unused);
  /*** Added in the v3 interface ***/
  HRESULT WINAPI SetSurfaceDesc(DDSURFACEDESC2* surface_desc, DWORD unused);
  /*** Added in the v4 interface ***/
  HRESULT WINAPI SetPrivateData(REFGUID tag, void* data, DWORD data_size, DWORD flags);
  HRESULT WINAPI GetPrivateData(REFGUID tag, void* buffer, DWORD* buffer_size);
  HRESULT WINAPI FreePrivateData(REFGUID tag);
  HRESULT WINAPI GetUniquenessValue(DWORD* value);
  HRESULT WINAPI ChangeUniquenessValue();
  /*** Moved Texture7 methods here ***/
  HRESULT WINAPI SetPriority(DWORD priority);
  HRESULT WINAPI GetPriority(DWORD* priority_out);
  HRESULT WINAPI SetLOD(DWORD lod);
  HRESULT WINAPI GetLOD(DWORD* lod_out);

  // custom functions
  inline bool is_primary_surface() const {
    return (surface_desc_.ddsCaps.dwCaps & DDSCAPS_PRIMARYSURFACE) != 0;
  }
  void Render();

private:
  int refcount_;
  DirectGlaw* owner_;
  DirectGlawPalette* palette_;
  DDSURFACEDESC2 surface_desc_;
  DWORD width_;
  DWORD height_;
  LONG pitch_;
  uint32 texture_internal_format_;
  uint32 texture_format_;
  std::vector<byte> surface_data_;
  std::array<GLuint, 2> textures_;
  uint32 texture_in_use_;
  std::unique_ptr<GlStaticBuffer<GLfloat, 16>> vertex_buffer_;
  std::unique_ptr<GlStaticBuffer<GLushort, 4>> element_buffer_;
  LARGE_INTEGER counter_frequency_;
  LARGE_INTEGER last_frame_time_;
};

}  // namespace forge
}  // namespace sbat

#endif  // FORGE_DIRECT_GLAW_H_