#include "forge/direct_glaw.h"

#include "logger/logger.h"

#define DIRECTDRAWLOG true

namespace sbat {
namespace forge {

HRESULT WINAPI DirectGlawCreate(GUID* guid_ptr, IDirectDraw7** direct_draw_out, IUnknown* unused) {
  if(DIRECTDRAWLOG) { 
    Logger::Log(LogLevel::Verbose, "DirectGlawCreate called");
  }

  // You want a DirectDraw? Here, have a DirectGlaw. You'll never know the difference!
  *direct_draw_out = new DirectGlaw();
  return DD_OK;
}

DirectGlaw::DirectGlaw() {
}

DirectGlaw::~DirectGlaw(){
}

HRESULT WINAPI DirectGlaw::QueryInterface(REFIID riid, void** obj_out) {
  if(DIRECTDRAWLOG) { 
    Logger::Log(LogLevel::Verbose, "QueryInterface called");
  }

  return DDERR_UNSUPPORTED; // TODO(tec27): Implement
}

ULONG WINAPI DirectGlaw::AddRef() {
  if(DIRECTDRAWLOG) { 
    Logger::Log(LogLevel::Verbose, "AddRef called");
  }

  return DDERR_UNSUPPORTED; // TODO(tec27): Implement
}

ULONG WINAPI DirectGlaw::Release() {
  if(DIRECTDRAWLOG) { 
    Logger::Log(LogLevel::Verbose, "Release called");
  }

  return DDERR_UNSUPPORTED; // TODO(tec27): Implement
}

HRESULT WINAPI DirectGlaw::Compact() {
  if(DIRECTDRAWLOG) { 
    Logger::Log(LogLevel::Verbose, "Compact called");
  }

  return DDERR_UNSUPPORTED; // TODO(tec27): Implement
}

HRESULT WINAPI DirectGlaw::CreateClipper(DWORD flags, IDirectDrawClipper** clipper_out,
    IUnknown* unused) {
  if(DIRECTDRAWLOG) { 
    Logger::Logf(LogLevel::Verbose, "CreateClipper called with flags: %08x", flags);
  }

  return DDERR_UNSUPPORTED; // TODO(tec27): Implement
}

HRESULT WINAPI DirectGlaw::CreatePalette(DWORD flags, PALETTEENTRY* color_array,
    IDirectDrawPalette** palette_out, IUnknown* unused) {
  if(DIRECTDRAWLOG) { 
    Logger::Logf(LogLevel::Verbose, "CreatePalette called with flags: %08x", flags);
  }

  return DDERR_UNSUPPORTED; // TODO(tec27): Implement
}

HRESULT WINAPI DirectGlaw::CreateSurface(DDSURFACEDESC2* surface_desc, 
    IDirectDrawSurface7** surface_out, IUnknown* unused) {
  if(DIRECTDRAWLOG) { 
    Logger::Log(LogLevel::Verbose, "CreateSurface called");
  }

  return DDERR_UNSUPPORTED; // TODO(tec27): Implement
}

HRESULT WINAPI DirectGlaw::DuplicateSurface(IDirectDrawSurface7* surface,
    IDirectDrawSurface7** duped_out) {
  if(DIRECTDRAWLOG) { 
    Logger::Log(LogLevel::Verbose, "DuplicateSurface called");
  }

  return DDERR_UNSUPPORTED; // TODO(tec27): Implement
}

HRESULT WINAPI DirectGlaw::EnumDisplayModes(DWORD flags, DDSURFACEDESC2* surface_desc,
    void* context, LPDDENUMMODESCALLBACK2 callback) {
  if(DIRECTDRAWLOG) { 
    Logger::Logf(LogLevel::Verbose, "EnumDisplayModes called with flags: %08x", flags);
  }

  return DDERR_UNSUPPORTED; // TODO(tec27): Implement
}

HRESULT WINAPI DirectGlaw::EnumSurfaces(DWORD flags, DDSURFACEDESC2* surface_desc, void* context,
    LPDDENUMSURFACESCALLBACK7 callback) {
  if(DIRECTDRAWLOG) { 
    Logger::Logf(LogLevel::Verbose, "EnumSurfaces called with flags: %08x", flags);
  }

  return DDERR_UNSUPPORTED; // TODO(tec27): Implement
}

HRESULT WINAPI DirectGlaw::FlipToGDISurface() {
  if(DIRECTDRAWLOG) { 
    Logger::Log(LogLevel::Verbose, "FlipToGDISurface called");
  }

  return DDERR_UNSUPPORTED; // TODO(tec27): Implement
}

HRESULT WINAPI DirectGlaw::GetCaps(DDCAPS* driver_caps, DDCAPS* hel_caps) {
  if(DIRECTDRAWLOG) { 
    Logger::Log(LogLevel::Verbose, "GetCaps called");
  }

  return DDERR_UNSUPPORTED; // TODO(tec27): Implement
}

HRESULT WINAPI DirectGlaw::GetDisplayMode(DDSURFACEDESC2* surface_desc) {
  if(DIRECTDRAWLOG) { 
    Logger::Log(LogLevel::Verbose, "GetDisplayMode called");
  }

  return DDERR_UNSUPPORTED; // TODO(tec27): Implement
}

HRESULT WINAPI DirectGlaw::GetFourCCCodes(DWORD* num_codes, DWORD* codes) {
  if(DIRECTDRAWLOG) { 
    Logger::Log(LogLevel::Verbose, "GetFourCCCodes called");
  }

  return DDERR_UNSUPPORTED; // TODO(tec27): Implement
}

HRESULT WINAPI DirectGlaw::GetGDISurface(IDirectDrawSurface7** surface_out) {
  if(DIRECTDRAWLOG) { 
    Logger::Log(LogLevel::Verbose, "DirectGlawCreate called");
  }

  return DDERR_UNSUPPORTED; // TODO(tec27): Implement
}

HRESULT WINAPI DirectGlaw::GetMonitorFrequency(DWORD* freq) {
  if(DIRECTDRAWLOG) { 
    Logger::Log(LogLevel::Verbose, "GetMonitorFrequency called");
  }

  return DDERR_UNSUPPORTED; // TODO(tec27): Implement
}

HRESULT WINAPI DirectGlaw::GetScanLine(DWORD* scanline) {
  if(DIRECTDRAWLOG) { 
    Logger::Log(LogLevel::Verbose, "GetScanLine called");
  }

  return DDERR_UNSUPPORTED; // TODO(tec27): Implement
}

HRESULT WINAPI DirectGlaw::GetVerticalBlankStatus(BOOL* is_in_vertical_blank) {
  if(DIRECTDRAWLOG) { 
    Logger::Log(LogLevel::Verbose, "GetVerticalBlankStatus called");
  }

  return DDERR_UNSUPPORTED; // TODO(tec27): Implement
}

HRESULT WINAPI DirectGlaw::Initialize(GUID* guid) {
  if(DIRECTDRAWLOG) { 
    Logger::Log(LogLevel::Verbose, "Initialize called");
  }

  return DDERR_UNSUPPORTED; // TODO(tec27): Implement
}

HRESULT WINAPI DirectGlaw::RestoreDisplayMode() {
  if(DIRECTDRAWLOG) { 
    Logger::Log(LogLevel::Verbose, "RestoreDisplayMode called");
  }

  return DDERR_UNSUPPORTED; // TODO(tec27): Implement
}

HRESULT WINAPI DirectGlaw::SetCooperativeLevel(HWND window_handle, DWORD flags) {
  if(DIRECTDRAWLOG) { 
    Logger::Logf(LogLevel::Verbose, "SetCooperativeLevel called with flags: %08x", flags);
  }

  return DDERR_UNSUPPORTED; // TODO(tec27): Implement
}

HRESULT WINAPI DirectGlaw::SetDisplayMode(DWORD width, DWORD height, DWORD bpp, DWORD refresh_rate,
    DWORD flags) {
  if(DIRECTDRAWLOG) { 
    Logger::Logf(LogLevel::Verbose, "SetDisplayMode called (%d,%d), %d, %d with flags: %08x",
        width, height, bpp, refresh_rate, flags);
  }

  return DDERR_UNSUPPORTED; // TODO(tec27): Implement
}

HRESULT WINAPI DirectGlaw::WaitForVerticalBlank(DWORD flags, HANDLE event_handle) {
  if(DIRECTDRAWLOG) { 
    Logger::Logf(LogLevel::Verbose, "WaitForVerticalBlank called with flags: %08x", flags);
  }

  return DDERR_UNSUPPORTED; // TODO(tec27): Implement
}

HRESULT WINAPI DirectGlaw::GetAvailableVidMem(DDSCAPS2* caps, DWORD* total, DWORD* free) {
  if(DIRECTDRAWLOG) { 
    Logger::Log(LogLevel::Verbose, "GetAvailableVidMem called");
  }

  return DDERR_UNSUPPORTED; // TODO(tec27): Implement
}

HRESULT WINAPI DirectGlaw::GetSurfaceFromDC(HDC dc_handle, IDirectDrawSurface7** surface_out) {
  if(DIRECTDRAWLOG) { 
    Logger::Log(LogLevel::Verbose, "GetSurfaceFromDC called");
  }

  return DDERR_UNSUPPORTED; // TODO(tec27): Implement
}

HRESULT WINAPI DirectGlaw::RestoreAllSurfaces() {
  if(DIRECTDRAWLOG) { 
    Logger::Log(LogLevel::Verbose, "RestoreAllSurfaces called");
  }

  return DDERR_UNSUPPORTED; // TODO(tec27): Implement
}

HRESULT WINAPI DirectGlaw::TestCooperativeLevel() {
  if(DIRECTDRAWLOG) { 
    Logger::Log(LogLevel::Verbose, "TestCooperativeLevel called");
  }

  return DDERR_UNSUPPORTED; // TODO(tec27): Implement
}

HRESULT WINAPI DirectGlaw::GetDeviceIdentifier(DDDEVICEIDENTIFIER2* identifier, DWORD flags) {
  if(DIRECTDRAWLOG) { 
    Logger::Logf(LogLevel::Verbose, "GetDeviceIdentifie called with flags: %08x", flags);
  }

  return DDERR_UNSUPPORTED; // TODO(tec27): Implement
}

HRESULT WINAPI DirectGlaw::StartModeTest(SIZE* modes_to_test, DWORD num_entries, DWORD flags) {
  if(DIRECTDRAWLOG) { 
    Logger::Logf(LogLevel::Verbose, "StartModeTest called with %d entries and flags: %08x",
        num_entries, flags);
  }

  return DDERR_UNSUPPORTED; // TODO(tec27): Implement
}

HRESULT WINAPI DirectGlaw::EvaluateMode(DWORD flags, DWORD* timeout_secs) {
  if(DIRECTDRAWLOG) { 
    Logger::Logf(LogLevel::Verbose, "EvaluateMode called with flags: %08x", flags);
  }

  return DDERR_UNSUPPORTED; // TODO(tec27): Implement
}

}  // namespace forge
}  // namespace sbat