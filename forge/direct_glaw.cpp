#include "forge/direct_glaw.h"

#include <gl/glew.h>
#include <gl/wglew.h>
#include <gl/gl.h>

#include "forge/forge.h"
#include "forge/open_gl.h"
#include "logger/logger.h"

namespace sbat {
namespace forge {

using std::array;

HRESULT WINAPI DirectGlawCreate(GUID* guid_ptr, IDirectDraw7** direct_draw_out, IUnknown* unused) {
  if (DIRECTDRAWLOG) {
    Logger::Log(LogLevel::Verbose, "DirectGlawCreate called");
  }

  // You want a DirectDraw? Here, have a DirectGlaw. You'll never know the difference!
  *direct_draw_out = new DirectGlaw();
  return DD_OK;
}

DirectGlaw::DirectGlaw()
  : refcount_(1),
    window_(NULL),
    open_gl_(nullptr),
    display_width_(0),
    display_height_(0),
    display_bpp_(0) {
  
}

DirectGlaw::~DirectGlaw() {
  delete open_gl_;
  open_gl_ = nullptr;
}

HRESULT WINAPI DirectGlaw::QueryInterface(REFIID riid, void** obj_out) {
  if (DIRECTDRAWLOG) {
    Logger::Log(LogLevel::Verbose, "DirectGlaw::QueryInterface called");
  }

  // I don't really wanna link against ddraw to get its GUIDs properly, and BW should never actually
  // use this to deal with creation, so just not going to implement this
  return DDERR_UNSUPPORTED;
}

ULONG WINAPI DirectGlaw::AddRef() {
  if (DIRECTDRAWLOG) {
    Logger::Log(LogLevel::Verbose, "DirectGlaw::AddRef called");
  }

  refcount_++;
  return refcount_;
}

ULONG WINAPI DirectGlaw::Release() {
  if (DIRECTDRAWLOG) {
    Logger::Log(LogLevel::Verbose, "DirectGlaw::Release called");
  }
  refcount_--;
  if (refcount_ <= 0) {
    delete this;
    return 0;
  } else {
    return refcount_;
  }
}

HRESULT WINAPI DirectGlaw::Compact() {
  if (DIRECTDRAWLOG) {
    Logger::Log(LogLevel::Verbose, "DirectGlaw::Compact called");
  }

  return DDERR_UNSUPPORTED;  // TODO(tec27): Implement
}

HRESULT WINAPI DirectGlaw::CreateClipper(DWORD flags, IDirectDrawClipper** clipper_out,
    IUnknown* unused) {
  if (DIRECTDRAWLOG) {
    Logger::Logf(LogLevel::Verbose, "DirectGlaw::CreateClipper called with flags: %08x", flags);
  }

  return DDERR_UNSUPPORTED;  // TODO(tec27): Implement
}

HRESULT WINAPI DirectGlaw::CreatePalette(DWORD flags, PALETTEENTRY* color_array,
    IDirectDrawPalette** palette_out, IUnknown* unused) {
  if (DIRECTDRAWLOG) {
    Logger::Logf(LogLevel::Verbose, "DirectGlaw::CreatePalette called with flags: %08x", flags);
  }

  *palette_out = new DirectGlawPalette(flags, color_array);
  return DD_OK;
}

HRESULT WINAPI DirectGlaw::CreateSurface(DDSURFACEDESC2* surface_desc,
    IDirectDrawSurface7** surface_out, IUnknown* unused) {
  if (DIRECTDRAWLOG) {
    Logger::Logf(LogLevel::Verbose,
        "DirectGlaw::CreateSurface called with flags: %08x, height: %d, width: %d, pitch: %d, "
        "backBufferCount: %d, caps1: %08x, caps2: %08x", surface_desc->dwFlags,
        surface_desc->dwHeight, surface_desc->dwWidth, surface_desc->lPitch,
        surface_desc->dwBackBufferCount, surface_desc->ddsCaps.dwCaps,
        surface_desc->ddsCaps.dwCaps2);
  }

  *surface_out = new DirectGlawSurface(this, surface_desc);
  return DD_OK;
}

HRESULT WINAPI DirectGlaw::DuplicateSurface(IDirectDrawSurface7* surface,
    IDirectDrawSurface7** duped_out) {
  if (DIRECTDRAWLOG) {
    Logger::Log(LogLevel::Verbose, "DirectGlaw::DuplicateSurface called");
  }

  return DDERR_UNSUPPORTED;  // TODO(tec27): Implement
}

HRESULT WINAPI DirectGlaw::EnumDisplayModes(DWORD flags, DDSURFACEDESC2* surface_desc,
    void* context, LPDDENUMMODESCALLBACK2 callback) {
  if (DIRECTDRAWLOG) {
    Logger::Logf(LogLevel::Verbose, "DirectGlaw::EnumDisplayModes called with flags: %08x", flags);
  }

  return DDERR_UNSUPPORTED;  // TODO(tec27): Implement
}

HRESULT WINAPI DirectGlaw::EnumSurfaces(DWORD flags, DDSURFACEDESC2* surface_desc, void* context,
    LPDDENUMSURFACESCALLBACK7 callback) {
  if (DIRECTDRAWLOG) {
    Logger::Logf(LogLevel::Verbose, "DirectGlaw::EnumSurfaces called with flags: %08x", flags);
  }

  return DDERR_UNSUPPORTED;  // TODO(tec27): Implement
}

HRESULT WINAPI DirectGlaw::FlipToGDISurface() {
  if (DIRECTDRAWLOG) {
    Logger::Log(LogLevel::Verbose, "DirectGlaw::FlipToGDISurface called");
  }

  return DDERR_UNSUPPORTED;  // TODO(tec27): Implement
}

HRESULT WINAPI DirectGlaw::GetCaps(DDCAPS* driver_caps, DDCAPS* hel_caps) {
  if (DIRECTDRAWLOG) {
    Logger::Log(LogLevel::Verbose, "DirectGlaw::GetCaps called");
  }

  return DDERR_UNSUPPORTED;  // TODO(tec27): Implement
}

HRESULT WINAPI DirectGlaw::GetDisplayMode(DDSURFACEDESC2* surface_desc) {
  if (DIRECTDRAWLOG) {
    Logger::Log(LogLevel::Verbose, "DirectGlaw::GetDisplayMode called");
  }

  return DDERR_UNSUPPORTED;  // TODO(tec27): Implement
}

HRESULT WINAPI DirectGlaw::GetFourCCCodes(DWORD* num_codes, DWORD* codes) {
  if (DIRECTDRAWLOG) {
    Logger::Log(LogLevel::Verbose, "DirectGlaw::GetFourCCCodes called");
  }

  return DDERR_UNSUPPORTED;  // TODO(tec27): Implement
}

HRESULT WINAPI DirectGlaw::GetGDISurface(IDirectDrawSurface7** surface_out) {
  if (DIRECTDRAWLOG) {
    Logger::Log(LogLevel::Verbose, "DirectGlaw::DirectGlawCreate called");
  }

  return DDERR_UNSUPPORTED;  // TODO(tec27): Implement
}

HRESULT WINAPI DirectGlaw::GetMonitorFrequency(DWORD* freq) {
  if (DIRECTDRAWLOG) {
    Logger::Log(LogLevel::Verbose, "DirectGlaw::GetMonitorFrequency called");
  }

  return DDERR_UNSUPPORTED;  // TODO(tec27): Implement
}

HRESULT WINAPI DirectGlaw::GetScanLine(DWORD* scanline) {
  if (DIRECTDRAWLOG) {
    Logger::Log(LogLevel::Verbose, "DirectGlaw::GetScanLine called");
  }

  return DDERR_UNSUPPORTED;  // TODO(tec27): Implement
}

HRESULT WINAPI DirectGlaw::GetVerticalBlankStatus(BOOL* is_in_vertical_blank) {
  if (DIRECTDRAWLOG) {
    Logger::Log(LogLevel::Verbose, "DirectGlaw::GetVerticalBlankStatus called");
  }

  return DDERR_UNSUPPORTED;  // TODO(tec27): Implement
}

HRESULT WINAPI DirectGlaw::Initialize(GUID* guid) {
  if (DIRECTDRAWLOG) {
    Logger::Log(LogLevel::Verbose, "DirectGlaw::Initialize called");
  }

  return DDERR_UNSUPPORTED;  // TODO(tec27): Implement
}

HRESULT WINAPI DirectGlaw::RestoreDisplayMode() {
  if (DIRECTDRAWLOG) {
    Logger::Log(LogLevel::Verbose, "DirectGlaw::RestoreDisplayMode called");
  }

  return DDERR_UNSUPPORTED;  // TODO(tec27): Implement
}

HRESULT WINAPI DirectGlaw::SetCooperativeLevel(HWND window_handle, DWORD flags) {
  if (DIRECTDRAWLOG) {
    Logger::Logf(LogLevel::Verbose,
        "DirectGlaw::SetCooperativeLevel called with flags: %08x", flags);
  }

  window_ = window_handle;
  return DD_OK;
}

HRESULT WINAPI DirectGlaw::SetDisplayMode(DWORD width, DWORD height, DWORD bpp, DWORD refresh_rate,
    DWORD flags) {
  if (DIRECTDRAWLOG) {
    Logger::Logf(LogLevel::Verbose,
        "DirectGlaw::SetDisplayMode called (%d,%d), %d, %d with flags: %08x",
        width, height, bpp, refresh_rate, flags);
  }

  display_width_ = width;
  display_height_ = height;
  display_bpp_ = bpp;

  open_gl_ = new OpenGl(window_, display_width_, display_height_);

  return DD_OK;
}

HRESULT WINAPI DirectGlaw::WaitForVerticalBlank(DWORD flags, HANDLE event_handle) {
  if (DIRECTDRAWLOG) {
    Logger::Logf(LogLevel::Verbose,
        "DirectGlaw::WaitForVerticalBlank called with flags: %08x", flags);
  }

  return DDERR_UNSUPPORTED;  // TODO(tec27): Implement
}

HRESULT WINAPI DirectGlaw::GetAvailableVidMem(DDSCAPS2* caps, DWORD* total, DWORD* free) {
  if (DIRECTDRAWLOG) {
    Logger::Log(LogLevel::Verbose, "DirectGlaw::GetAvailableVidMem called");
  }

  return DDERR_UNSUPPORTED;  // TODO(tec27): Implement
}

HRESULT WINAPI DirectGlaw::GetSurfaceFromDC(HDC dc_handle, IDirectDrawSurface7** surface_out) {
  if (DIRECTDRAWLOG) {
    Logger::Log(LogLevel::Verbose, "DirectGlaw::GetSurfaceFromDC called");
  }

  return DDERR_UNSUPPORTED;  // TODO(tec27): Implement
}

HRESULT WINAPI DirectGlaw::RestoreAllSurfaces() {
  if (DIRECTDRAWLOG) {
    Logger::Log(LogLevel::Verbose, "DirectGlaw::RestoreAllSurfaces called");
  }

  return DDERR_UNSUPPORTED;  // TODO(tec27): Implement
}

HRESULT WINAPI DirectGlaw::TestCooperativeLevel() {
  if (DIRECTDRAWLOG) {
    Logger::Log(LogLevel::Verbose, "DirectGlaw::TestCooperativeLevel called");
  }

  return DDERR_UNSUPPORTED;  // TODO(tec27): Implement
}

HRESULT WINAPI DirectGlaw::GetDeviceIdentifier(DDDEVICEIDENTIFIER2* identifier, DWORD flags) {
  if (DIRECTDRAWLOG) {
    Logger::Logf(LogLevel::Verbose,
        "DirectGlaw::GetDeviceIdentifie called with flags: %08x", flags);
  }

  return DDERR_UNSUPPORTED;  // TODO(tec27): Implement
}

HRESULT WINAPI DirectGlaw::StartModeTest(SIZE* modes_to_test, DWORD num_entries, DWORD flags) {
  if (DIRECTDRAWLOG) {
    Logger::Logf(LogLevel::Verbose,
        "DirectGlaw::StartModeTest called with %d entries and flags: %08x", num_entries, flags);
  }

  return DDERR_UNSUPPORTED;  // TODO(tec27): Implement
}

HRESULT WINAPI DirectGlaw::EvaluateMode(DWORD flags, DWORD* timeout_secs) {
  if (DIRECTDRAWLOG) {
    Logger::Logf(LogLevel::Verbose, "DirectGlaw::EvaluateMode called with flags: %08x", flags);
  }

  return DDERR_UNSUPPORTED;  // TODO(tec27): Implement
}

void DirectGlaw::InitializeOpenGl() {
  assert(open_gl_ != nullptr);

  open_gl_->InitializeOpenGl(this);
}

void DirectGlaw::Render(const DirectGlawPalette &direct_glaw_palette, const std::vector<byte> &surface_data) {
  open_gl_->Render(direct_glaw_palette, surface_data);
}

}  // namespace forge
}  // namespace sbat