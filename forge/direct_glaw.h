#ifndef FORGE_DIRECT_GLAW_H_
#define FORGE_DIRECT_GLAW_H_
// Fake DirectDraw7 implementation that forwards drawing responsibility to OpenGL
// Designed to handle everything Brood War needs, not guaranteed to work for anything else
#include <Windows.h>
#include <ddraw.h>

namespace sbat {
namespace forge {

HRESULT WINAPI DirectGlawCreate(GUID* guid_ptr, IDirectDraw7** direct_draw_out, IUnknown* unused);

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
};

}  // namespace forge
}  // namespace sbat

#endif  // FORGE_DIRECT_GLAW_H_