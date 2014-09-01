#include "forge/indirect_draw.h"

#include <gl/glew.h>
#include <gl/wglew.h>
#include <gl/gl.h>
#include <vector>

#include "forge/forge.h"
#include "forge/open_gl.h"
#include "logger/logger.h"

namespace sbat {
namespace forge {

using std::array;

HRESULT WINAPI IndirectDrawCreate(GUID* guid_ptr, IDirectDraw7** direct_draw_out, IUnknown* unused) {
  if (DIRECTDRAWLOG) {
    Logger::Log(LogLevel::Verbose, "IndirectDrawCreate called");
  }

  // You want a DirectDraw? Here, have a IndirectDraw. You'll never know the difference!
  *direct_draw_out = new IndirectDraw();
  return DD_OK;
}

IndirectDraw::IndirectDraw()
  : refcount_(1),
    window_(NULL),
    renderer_(),
    display_width_(0),
    display_height_(0),
    display_bpp_(0) {
}

IndirectDraw::~IndirectDraw() {
}

HRESULT WINAPI IndirectDraw::QueryInterface(REFIID riid, void** obj_out) {
  if (DIRECTDRAWLOG) {
    Logger::Log(LogLevel::Verbose, "IndirectDraw::QueryInterface called");
  }

  // I don't really wanna link against ddraw to get its GUIDs properly, and BW should never actually
  // use this to deal with creation, so just not going to implement this
  return DDERR_UNSUPPORTED;
}

ULONG WINAPI IndirectDraw::AddRef() {
  if (DIRECTDRAWLOG) {
    Logger::Log(LogLevel::Verbose, "IndirectDraw::AddRef called");
  }

  refcount_++;
  return refcount_;
}

ULONG WINAPI IndirectDraw::Release() {
  if (DIRECTDRAWLOG) {
    Logger::Log(LogLevel::Verbose, "IndirectDraw::Release called");
  }
  refcount_--;
  if (refcount_ <= 0) {
    delete this;
    return 0;
  } else {
    return refcount_;
  }
}

HRESULT WINAPI IndirectDraw::Compact() {
  if (DIRECTDRAWLOG) {
    Logger::Log(LogLevel::Verbose, "IndirectDraw::Compact called");
  }

  return DDERR_UNSUPPORTED;  // TODO(tec27): Implement
}

HRESULT WINAPI IndirectDraw::CreateClipper(DWORD flags, IDirectDrawClipper** clipper_out,
    IUnknown* unused) {
  if (DIRECTDRAWLOG) {
    Logger::Logf(LogLevel::Verbose, "IndirectDraw::CreateClipper called with flags: %08x", flags);
  }

  return DDERR_UNSUPPORTED;  // TODO(tec27): Implement
}

HRESULT WINAPI IndirectDraw::CreatePalette(DWORD flags, PALETTEENTRY* color_array,
    IDirectDrawPalette** palette_out, IUnknown* unused) {
  if (DIRECTDRAWLOG) {
    Logger::Logf(LogLevel::Verbose, "IndirectDraw::CreatePalette called with flags: %08x", flags);
  }

  *palette_out = new IndirectDrawPalette(this, flags, color_array);
  UpdatePalette(*reinterpret_cast<IndirectDrawPalette*>(*palette_out));
  return DD_OK;
}

HRESULT WINAPI IndirectDraw::CreateSurface(DDSURFACEDESC2* surface_desc,
    IDirectDrawSurface7** surface_out, IUnknown* unused) {
  if (DIRECTDRAWLOG) {
    Logger::Logf(LogLevel::Verbose,
        "IndirectDraw::CreateSurface called with flags: %08x, height: %d, width: %d, pitch: %d, "
        "backBufferCount: %d, caps1: %08x, caps2: %08x", surface_desc->dwFlags,
        surface_desc->dwHeight, surface_desc->dwWidth, surface_desc->lPitch,
        surface_desc->dwBackBufferCount, surface_desc->ddsCaps.dwCaps,
        surface_desc->ddsCaps.dwCaps2);
  }

  *surface_out = new IndirectDrawSurface(this, surface_desc);
  return DD_OK;
}

HRESULT WINAPI IndirectDraw::DuplicateSurface(IDirectDrawSurface7* surface,
    IDirectDrawSurface7** duped_out) {
  if (DIRECTDRAWLOG) {
    Logger::Log(LogLevel::Verbose, "IndirectDraw::DuplicateSurface called");
  }

  return DDERR_UNSUPPORTED;  // TODO(tec27): Implement
}

HRESULT WINAPI IndirectDraw::EnumDisplayModes(DWORD flags, DDSURFACEDESC2* surface_desc,
    void* context, LPDDENUMMODESCALLBACK2 callback) {
  if (DIRECTDRAWLOG) {
    Logger::Logf(LogLevel::Verbose, "IndirectDraw::EnumDisplayModes called with flags: %08x", flags);
  }

  return DDERR_UNSUPPORTED;  // TODO(tec27): Implement
}

HRESULT WINAPI IndirectDraw::EnumSurfaces(DWORD flags, DDSURFACEDESC2* surface_desc, void* context,
    LPDDENUMSURFACESCALLBACK7 callback) {
  if (DIRECTDRAWLOG) {
    Logger::Logf(LogLevel::Verbose, "IndirectDraw::EnumSurfaces called with flags: %08x", flags);
  }

  return DDERR_UNSUPPORTED;  // TODO(tec27): Implement
}

HRESULT WINAPI IndirectDraw::FlipToGDISurface() {
  if (DIRECTDRAWLOG) {
    Logger::Log(LogLevel::Verbose, "IndirectDraw::FlipToGDISurface called");
  }

  return DDERR_UNSUPPORTED;  // TODO(tec27): Implement
}

HRESULT WINAPI IndirectDraw::GetCaps(DDCAPS* driver_caps, DDCAPS* hel_caps) {
  if (DIRECTDRAWLOG) {
    Logger::Log(LogLevel::Verbose, "IndirectDraw::GetCaps called");
  }

  return DDERR_UNSUPPORTED;  // TODO(tec27): Implement
}

HRESULT WINAPI IndirectDraw::GetDisplayMode(DDSURFACEDESC2* surface_desc) {
  if (DIRECTDRAWLOG) {
    Logger::Log(LogLevel::Verbose, "IndirectDraw::GetDisplayMode called");
  }

  return DDERR_UNSUPPORTED;  // TODO(tec27): Implement
}

HRESULT WINAPI IndirectDraw::GetFourCCCodes(DWORD* num_codes, DWORD* codes) {
  if (DIRECTDRAWLOG) {
    Logger::Log(LogLevel::Verbose, "IndirectDraw::GetFourCCCodes called");
  }

  return DDERR_UNSUPPORTED;  // TODO(tec27): Implement
}

HRESULT WINAPI IndirectDraw::GetGDISurface(IDirectDrawSurface7** surface_out) {
  if (DIRECTDRAWLOG) {
    Logger::Log(LogLevel::Verbose, "IndirectDraw::IndirectDrawCreate called");
  }

  return DDERR_UNSUPPORTED;  // TODO(tec27): Implement
}

HRESULT WINAPI IndirectDraw::GetMonitorFrequency(DWORD* freq) {
  if (DIRECTDRAWLOG) {
    Logger::Log(LogLevel::Verbose, "IndirectDraw::GetMonitorFrequency called");
  }

  return DDERR_UNSUPPORTED;  // TODO(tec27): Implement
}

HRESULT WINAPI IndirectDraw::GetScanLine(DWORD* scanline) {
  if (DIRECTDRAWLOG) {
    Logger::Log(LogLevel::Verbose, "IndirectDraw::GetScanLine called");
  }

  return DDERR_UNSUPPORTED;  // TODO(tec27): Implement
}

HRESULT WINAPI IndirectDraw::GetVerticalBlankStatus(BOOL* is_in_vertical_blank) {
  if (DIRECTDRAWLOG) {
    Logger::Log(LogLevel::Verbose, "IndirectDraw::GetVerticalBlankStatus called");
  }

  return DDERR_UNSUPPORTED;  // TODO(tec27): Implement
}

HRESULT WINAPI IndirectDraw::Initialize(GUID* guid) {
  if (DIRECTDRAWLOG) {
    Logger::Log(LogLevel::Verbose, "IndirectDraw::Initialize called");
  }

  return DDERR_UNSUPPORTED;  // TODO(tec27): Implement
}

HRESULT WINAPI IndirectDraw::RestoreDisplayMode() {
  if (DIRECTDRAWLOG) {
    Logger::Log(LogLevel::Verbose, "IndirectDraw::RestoreDisplayMode called");
  }

  return DDERR_UNSUPPORTED;  // TODO(tec27): Implement
}

HRESULT WINAPI IndirectDraw::SetCooperativeLevel(HWND window_handle, DWORD flags) {
  if (DIRECTDRAWLOG) {
    Logger::Logf(LogLevel::Verbose,
        "IndirectDraw::SetCooperativeLevel called with flags: %08x", flags);
  }

  window_ = window_handle;
  MaybeInitializeRenderer();

  return DD_OK;
}

HRESULT WINAPI IndirectDraw::SetDisplayMode(DWORD width, DWORD height, DWORD bpp,
    DWORD refresh_rate, DWORD flags) {
  if (DIRECTDRAWLOG) {
    Logger::Logf(LogLevel::Verbose,
        "IndirectDraw::SetDisplayMode called (%d,%d), %d, %d with flags: %08x",
        width, height, bpp, refresh_rate, flags);
  }

  display_width_ = width;
  display_height_ = height;
  display_bpp_ = bpp;
  MaybeInitializeRenderer();

  return DD_OK;
}

HRESULT WINAPI IndirectDraw::WaitForVerticalBlank(DWORD flags, HANDLE event_handle) {
  if (DIRECTDRAWLOG) {
    Logger::Logf(LogLevel::Verbose,
        "IndirectDraw::WaitForVerticalBlank called with flags: %08x", flags);
  }

  return DDERR_UNSUPPORTED;  // TODO(tec27): Implement
}

HRESULT WINAPI IndirectDraw::GetAvailableVidMem(DDSCAPS2* caps, DWORD* total, DWORD* free) {
  if (DIRECTDRAWLOG) {
    Logger::Log(LogLevel::Verbose, "IndirectDraw::GetAvailableVidMem called");
  }

  return DDERR_UNSUPPORTED;  // TODO(tec27): Implement
}

HRESULT WINAPI IndirectDraw::GetSurfaceFromDC(HDC dc_handle, IDirectDrawSurface7** surface_out) {
  if (DIRECTDRAWLOG) {
    Logger::Log(LogLevel::Verbose, "IndirectDraw::GetSurfaceFromDC called");
  }

  return DDERR_UNSUPPORTED;  // TODO(tec27): Implement
}

HRESULT WINAPI IndirectDraw::RestoreAllSurfaces() {
  if (DIRECTDRAWLOG) {
    Logger::Log(LogLevel::Verbose, "IndirectDraw::RestoreAllSurfaces called");
  }

  return DDERR_UNSUPPORTED;  // TODO(tec27): Implement
}

HRESULT WINAPI IndirectDraw::TestCooperativeLevel() {
  if (DIRECTDRAWLOG) {
    Logger::Log(LogLevel::Verbose, "IndirectDraw::TestCooperativeLevel called");
  }

  return DDERR_UNSUPPORTED;  // TODO(tec27): Implement
}

HRESULT WINAPI IndirectDraw::GetDeviceIdentifier(DDDEVICEIDENTIFIER2* identifier, DWORD flags) {
  if (DIRECTDRAWLOG) {
    Logger::Logf(LogLevel::Verbose,
        "IndirectDraw::GetDeviceIdentifie called with flags: %08x", flags);
  }

  return DDERR_UNSUPPORTED;  // TODO(tec27): Implement
}

HRESULT WINAPI IndirectDraw::StartModeTest(SIZE* modes_to_test, DWORD num_entries, DWORD flags) {
  if (DIRECTDRAWLOG) {
    Logger::Logf(LogLevel::Verbose,
        "IndirectDraw::StartModeTest called with %d entries and flags: %08x", num_entries, flags);
  }

  return DDERR_UNSUPPORTED;  // TODO(tec27): Implement
}

HRESULT WINAPI IndirectDraw::EvaluateMode(DWORD flags, DWORD* timeout_secs) {
  if (DIRECTDRAWLOG) {
    Logger::Logf(LogLevel::Verbose, "IndirectDraw::EvaluateMode called with flags: %08x", flags);
  }

  return DDERR_UNSUPPORTED;  // TODO(tec27): Implement
}

void IndirectDraw::MaybeInitializeRenderer() {
  if (window_ != NULL && display_width_ != 0) {
    assert(!renderer_);
    renderer_ = Forge::CreateRenderer(window_, display_width_, display_height_);
  }
}

void IndirectDraw::Render(const std::vector<byte>& surface_data) {
  if (renderer_) {
    renderer_->Render(surface_data);
  }
}

void IndirectDraw::UpdatePalette(const IndirectDrawPalette& palette) {
  if (renderer_) {
    renderer_->UpdatePalette(palette);
  }
}

}  // namespace forge
}  // namespace sbat