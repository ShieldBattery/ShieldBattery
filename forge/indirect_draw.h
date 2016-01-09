#ifndef FORGE_INDIRECT_DRAW_H_
#define FORGE_INDIRECT_DRAW_H_
// Fake DirectDraw7 implementation that forwards drawing responsibility to OpenGL
// Designed to handle everything Brood War needs, not guaranteed to work for anything else

#include <node.h>
#define WIN32_LEAN_AND_MEAN
#include <Windows.h>
#include <ddraw.h>
#include <gl/glew.h>
#include <gl/gl.h>
#include <array>
#include <memory>
#include <vector>

#include "common/types.h"
#include "forge/open_gl.h"

// enables/disables in-depth logging about DirectDraw method calls
#define DIRECTDRAWLOG false

namespace sbat {
namespace forge {

HRESULT WINAPI IndirectDrawCreate(GUID* guid_ptr, IDirectDraw7** direct_draw_out, IUnknown* unused);

class IndirectDrawPalette;

class IndirectDraw : public IDirectDraw7 {
public:
  IndirectDraw();
  virtual ~IndirectDraw();

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
  inline HWND window() const { return window_; }
  void Render(const std::vector<byte>& surface_data);
  void UpdatePalette(const IndirectDrawPalette& palette);

private:
  void MaybeInitializeRenderer();

  int refcount_;
  HWND window_;
  std::unique_ptr<Renderer> renderer_;
  DWORD display_width_;
  DWORD display_height_;
  DWORD display_bpp_;
};



class IndirectDrawPalette : public IDirectDrawPalette {
public:
  IndirectDrawPalette(IndirectDraw* owner, DWORD flags, PALETTEENTRY* color_array);
  virtual ~IndirectDrawPalette();

  /*** IUnknown methods ***/
  HRESULT WINAPI QueryInterface(REFIID riid, void** obj_out);
  ULONG WINAPI AddRef();
  ULONG WINAPI Release();
  /*** IDirectDrawPalette methods ***/
  HRESULT WINAPI GetCaps(DWORD* caps);
  HRESULT WINAPI GetEntries(DWORD flags, DWORD start, DWORD count, PALETTEENTRY* palette_out);
  HRESULT WINAPI Initialize(IDirectDraw* owner, DWORD flags, PALETTEENTRY* color_array);
  HRESULT WINAPI SetEntries(DWORD unused, DWORD start, DWORD count, PALETTEENTRY* entries);

  const std::array<PALETTEENTRY, 256>& entries() const { return entries_; } 

private:
  IndirectDraw* owner_;
  int refcount_;
  std::array<PALETTEENTRY, 256> entries_;
};

class IndirectDrawSurface : public IDirectDrawSurface7 {
public:
  IndirectDrawSurface(IndirectDraw* owner, DDSURFACEDESC2* surface_desc);
  virtual ~IndirectDrawSurface();

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

private:
  int refcount_;
  IndirectDraw* owner_;
  IndirectDrawPalette* palette_;
  DDSURFACEDESC2 surface_desc_;
  DWORD width_;
  DWORD height_;
  LONG pitch_;
  std::vector<byte> surface_data_;
};

}  // namespace forge
}  // namespace sbat

#endif  // FORGE_INDIRECT_DRAW_H_