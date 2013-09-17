#include "forge/direct_glaw.h"

namespace sbat {
namespace forge {

HRESULT WINAPI DirectGlawCreate(GUID* guid_ptr, IDirectDraw7** direct_draw_out, IUnknown* unused) {
  // You want a DirectDraw? Here, have a DirectGlaw. You'll never know the difference!
  *direct_draw_out = new DirectGlaw();
  return DD_OK;
}

DirectGlaw::DirectGlaw() {
}

DirectGlaw::~DirectGlaw(){
}

HRESULT WINAPI DirectGlaw::QueryInterface(REFIID riid, void** obj_out) {
  return DDERR_UNSUPPORTED; // TODO(tec27): Implement
}

ULONG WINAPI DirectGlaw::AddRef() {
  return DDERR_UNSUPPORTED; // TODO(tec27): Implement
}

ULONG WINAPI DirectGlaw::Release() {
  return DDERR_UNSUPPORTED; // TODO(tec27): Implement
}

HRESULT WINAPI DirectGlaw::Compact() {
  return DDERR_UNSUPPORTED; // TODO(tec27): Implement
}

HRESULT WINAPI DirectGlaw::CreateClipper(DWORD flags, IDirectDrawClipper** clipper_out,
    IUnknown* unused) {
  return DDERR_UNSUPPORTED; // TODO(tec27): Implement
}

HRESULT WINAPI DirectGlaw::CreatePalette(DWORD flags, PALETTEENTRY* color_array,
    IDirectDrawPalette** palette_out, IUnknown* unused) {
  return DDERR_UNSUPPORTED; // TODO(tec27): Implement
}

HRESULT WINAPI DirectGlaw::CreateSurface(DDSURFACEDESC2* surface_desc, 
    IDirectDrawSurface7** surface_out, IUnknown* unused) {
  return DDERR_UNSUPPORTED; // TODO(tec27): Implement
}

HRESULT WINAPI DirectGlaw::DuplicateSurface(IDirectDrawSurface7* surface,
    IDirectDrawSurface7** duped_out) {
  return DDERR_UNSUPPORTED; // TODO(tec27): Implement
}

HRESULT WINAPI DirectGlaw::EnumDisplayModes(DWORD flags, DDSURFACEDESC2* surface_desc,
    void* context, LPDDENUMMODESCALLBACK2 callback) {
  return DDERR_UNSUPPORTED; // TODO(tec27): Implement
}

HRESULT WINAPI DirectGlaw::EnumSurfaces(DWORD flags, DDSURFACEDESC2* surface_desc, void* context,
    LPDDENUMSURFACESCALLBACK7 callback) {
  return DDERR_UNSUPPORTED; // TODO(tec27): Implement
}

HRESULT WINAPI DirectGlaw::FlipToGDISurface() {
  return DDERR_UNSUPPORTED; // TODO(tec27): Implement
}

HRESULT WINAPI DirectGlaw::GetCaps(DDCAPS* driver_caps, DDCAPS* hel_caps) {
  return DDERR_UNSUPPORTED; // TODO(tec27): Implement
}

HRESULT WINAPI DirectGlaw::GetDisplayMode(DDSURFACEDESC2* surface_desc) {
  return DDERR_UNSUPPORTED; // TODO(tec27): Implement
}

HRESULT WINAPI DirectGlaw::GetFourCCCodes(DWORD* num_codes, DWORD* codes) {
  return DDERR_UNSUPPORTED; // TODO(tec27): Implement
}

HRESULT WINAPI DirectGlaw::GetGDISurface(IDirectDrawSurface7** surface_out) {
  return DDERR_UNSUPPORTED; // TODO(tec27): Implement
}

HRESULT WINAPI DirectGlaw::GetMonitorFrequency(DWORD* freq) {
  return DDERR_UNSUPPORTED; // TODO(tec27): Implement
}

HRESULT WINAPI DirectGlaw::GetScanLine(DWORD* scanline) {
  return DDERR_UNSUPPORTED; // TODO(tec27): Implement
}

HRESULT WINAPI DirectGlaw::GetVerticalBlankStatus(BOOL* is_in_vertical_blank) {
  return DDERR_UNSUPPORTED; // TODO(tec27): Implement
}

HRESULT WINAPI DirectGlaw::Initialize(GUID* guid) {
  return DDERR_UNSUPPORTED; // TODO(tec27): Implement
}

HRESULT WINAPI DirectGlaw::RestoreDisplayMode() {
  return DDERR_UNSUPPORTED; // TODO(tec27): Implement
}

HRESULT WINAPI DirectGlaw::SetCooperativeLevel(HWND window_handle, DWORD flags) {
  return DDERR_UNSUPPORTED; // TODO(tec27): Implement
}

HRESULT WINAPI DirectGlaw::SetDisplayMode(DWORD width, DWORD height, DWORD bpp, DWORD refresh_rate,
    DWORD flags) {
  return DDERR_UNSUPPORTED; // TODO(tec27): Implement
}

HRESULT WINAPI DirectGlaw::WaitForVerticalBlank(DWORD flags, HANDLE event_handle) {
  return DDERR_UNSUPPORTED; // TODO(tec27): Implement
}

HRESULT WINAPI DirectGlaw::GetAvailableVidMem(DDSCAPS2* caps, DWORD* total, DWORD* free) {
  return DDERR_UNSUPPORTED; // TODO(tec27): Implement
}

HRESULT WINAPI DirectGlaw::GetSurfaceFromDC(HDC dc_handle, IDirectDrawSurface7** surface_out) {
  return DDERR_UNSUPPORTED; // TODO(tec27): Implement
}

HRESULT WINAPI DirectGlaw::RestoreAllSurfaces() {
  return DDERR_UNSUPPORTED; // TODO(tec27): Implement
}

HRESULT WINAPI DirectGlaw::TestCooperativeLevel() {
  return DDERR_UNSUPPORTED; // TODO(tec27): Implement
}

HRESULT WINAPI DirectGlaw::GetDeviceIdentifier(DDDEVICEIDENTIFIER2* identifier, DWORD flags) {
  return DDERR_UNSUPPORTED; // TODO(tec27): Implement
}

HRESULT WINAPI DirectGlaw::StartModeTest(SIZE* modes_to_test, DWORD num_entries, DWORD flags) {
  return DDERR_UNSUPPORTED; // TODO(tec27): Implement
}

HRESULT WINAPI DirectGlaw::EvaluateMode(DWORD flags, DWORD* timeout_secs) {
  return DDERR_UNSUPPORTED; // TODO(tec27): Implement
}

}  // namespace forge
}  // namespace sbat