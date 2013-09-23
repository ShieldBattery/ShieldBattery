#include "forge/direct_glaw.h"

#include <vector>

#include "logger/logger.h"


namespace sbat {
namespace forge {

using std::vector;

DirectGlawSurface::DirectGlawSurface(DirectGlaw* owner, DDSURFACEDESC2* surface_desc)
  : refcount_(1),
    owner_(owner),
    palette_(nullptr),
    surface_desc_(*surface_desc),
    width_(owner->display_width()),
    height_(owner->display_height()),
    pitch_(0),
    surface_data_() {
  owner_->AddRef();

  if (surface_desc_.dwFlags & DDSD_WIDTH) {
    width_ = surface_desc_.dwWidth;
  }
  if (surface_desc_.dwFlags & DDSD_WIDTH) {
    height_ = surface_desc_.dwWidth;
  }

  if (surface_desc_.dwFlags & DDSD_PITCH) {
    pitch_ = surface_desc_.lPitch;
  } else {
    pitch_ = width_ * owner->display_bpp() / 8;
  }

  if(surface_desc_.dwFlags & DDSD_CAPS) {
    if (surface_desc_.ddsCaps.dwCaps & DDSCAPS_PRIMARYSURFACE) {
      if (DIRECTDRAWLOG) {
        Logger::Log(LogLevel::Verbose, "DirectGlaw: primary surface created");
      }
    }
  }

  surface_desc_.dwWidth = width_;
  surface_desc_.dwHeight = height_;
  surface_desc_.lPitch = pitch_;
  surface_desc_.dwFlags |= DDSD_WIDTH | DDSD_HEIGHT | DDSD_PITCH;

  surface_data_ = vector<byte>(height_ * pitch_, 0);
}

DirectGlawSurface::~DirectGlawSurface() {
  if (palette_ != nullptr) {
    palette_->Release();
    palette_ = nullptr;
  }
  if (owner_ != nullptr) {
    owner_->Release();
    owner_ = nullptr;
  }
}

HRESULT WINAPI DirectGlawSurface::QueryInterface(REFIID riid, void** obj_out) {
  if (DIRECTDRAWLOG) {
    Logger::Log(LogLevel::Verbose, "DirectGlawSurface::QueryInterface called");
  }

  *obj_out = nullptr;
  return DDERR_UNSUPPORTED;
}

ULONG WINAPI DirectGlawSurface::AddRef() {
  if (DIRECTDRAWLOG) {
    Logger::Log(LogLevel::Verbose, "DirectGlawSurface::AddRef called");
  }

  refcount_++;
  return refcount_;
}

ULONG WINAPI DirectGlawSurface::Release() {
  if (DIRECTDRAWLOG) {
    Logger::Log(LogLevel::Verbose, "DirectGlawSurface::Release called");
  }
  refcount_--;
  if (refcount_ <= 0) {
    delete this;
    return 0;
  } else {
    return refcount_;
  }
}

HRESULT WINAPI DirectGlawSurface::AddAttachedSurface(IDirectDrawSurface7* surface) {
  if (DIRECTDRAWLOG) {
    Logger::Log(LogLevel::Verbose, "DirectGlawSurface::AddAttachedSurface called");
  }

  return DDERR_UNSUPPORTED;  // TODO(tec27): Implement
}

HRESULT WINAPI DirectGlawSurface::AddOverlayDirtyRect(RECT* dirty_rect) {
  if (DIRECTDRAWLOG) {
    Logger::Log(LogLevel::Verbose, "DirectGlawSurface::AddOverlayDirtyRect called");
  }

  return DDERR_UNSUPPORTED;  // TODO(tec27): Implement
}

HRESULT WINAPI DirectGlawSurface::Blt(RECT* dest_rect, IDirectDrawSurface7* src, RECT* src_rect,
    DWORD flags, DDBLTFX* fx) {
  if (DIRECTDRAWLOG) {
    Logger::Logf(LogLevel::Verbose, "DirectGlawSurface::Blt called with flags: %08x", flags);
  }

  return DDERR_UNSUPPORTED;  // TODO(tec27): Implement
}

HRESULT WINAPI DirectGlawSurface::BltBatch(DDBLTBATCH* operations, DWORD count, DWORD unused) {
  if (DIRECTDRAWLOG) {
    Logger::Logf(LogLevel::Verbose, "DirectGlawSurface::BltBatch called with %d operations", count);
  }

  return DDERR_UNSUPPORTED;  // TODO(tec27): Implement
}

HRESULT WINAPI DirectGlawSurface::BltFast(DWORD x, DWORD y, IDirectDrawSurface7* src,
    RECT* src_rect, DWORD flags) {
  if (DIRECTDRAWLOG) {
    Logger::Logf(LogLevel::Verbose, "DirectGlawSurface::BltFast called for %d,%d with flags: %08x",
        x, y, flags);
  }

  return DDERR_UNSUPPORTED;  // TODO(tec27): Implement
}

HRESULT WINAPI DirectGlawSurface::DeleteAttachedSurface(DWORD flags,
    IDirectDrawSurface7* attached) {
  if (DIRECTDRAWLOG) {
    Logger::Logf(LogLevel::Verbose,
        "DirectGlawSurface::DeleteAttachedSurface called with flags: %08x", flags);
  }

  return DDERR_UNSUPPORTED;  // TODO(tec27): Implement
}

HRESULT WINAPI DirectGlawSurface::EnumAttachedSurfaces(void* context,
    LPDDENUMSURFACESCALLBACK7 callback) {
  if (DIRECTDRAWLOG) {
    Logger::Log(LogLevel::Verbose, "DirectGlawSurface::EnumAttachedSurfaces called");
  }

  return DDERR_UNSUPPORTED;  // TODO(tec27): Implement
}

HRESULT WINAPI DirectGlawSurface::EnumOverlayZOrders(DWORD flags, void* context,
    LPDDENUMSURFACESCALLBACK7 callback) {
  if (DIRECTDRAWLOG) {
    Logger::Logf(LogLevel::Verbose, "DirectGlawSurface::EnumOverlayZOrders called with flags: %08x",
        flags);
  }

  return DDERR_UNSUPPORTED;  // TODO(tec27): Implement
}

HRESULT WINAPI DirectGlawSurface::Flip(IDirectDrawSurface7* target_override, DWORD flags) {
  if (DIRECTDRAWLOG) {
    Logger::Logf(LogLevel::Verbose, "DirectGlawSurface::Flip called with flags: %08x", flags);
  }

  return DDERR_UNSUPPORTED;  // TODO(tec27): Implement
}

HRESULT WINAPI DirectGlawSurface::GetAttachedSurface(DDSCAPS2* caps,
    IDirectDrawSurface7** surface_out) {
  if (DIRECTDRAWLOG) {
    Logger::Log(LogLevel::Verbose, "DirectGlawSurface::GetAttachedSurface called");
  }

  return DDERR_UNSUPPORTED;  // TODO(tec27): Implement
}

HRESULT WINAPI DirectGlawSurface::GetBltStatus(DWORD flags) {
  if (DIRECTDRAWLOG) {
    Logger::Logf(LogLevel::Verbose, "DirectGlawSurface::GetBltStatus called with flags: %08x",
        flags);
  }

  return DDERR_UNSUPPORTED;  // TODO(tec27): Implement
}

HRESULT WINAPI DirectGlawSurface::GetCaps(DDSCAPS2* caps_out) {
  if (DIRECTDRAWLOG) {
    Logger::Log(LogLevel::Verbose, "DirectGlawSurface::GetCaps called");
  }

  return DDERR_UNSUPPORTED;  // TODO(tec27): Implement
}

HRESULT WINAPI DirectGlawSurface::GetClipper(IDirectDrawClipper** clipper_out) {
  if (DIRECTDRAWLOG) {
    Logger::Log(LogLevel::Verbose, "DirectGlawSurface::GetClipper called");
  }

  return DDERR_UNSUPPORTED;  // TODO(tec27): Implement
}

HRESULT WINAPI DirectGlawSurface::GetColorKey(DWORD flags, DDCOLORKEY* color_key_out) {
  if (DIRECTDRAWLOG) {
    Logger::Logf(LogLevel::Verbose, "DirectGlawSurface::GetColorKey called with flags: %08x",
        flags);
  }

  return DDERR_UNSUPPORTED;  // TODO(tec27): Implement
}

HRESULT WINAPI DirectGlawSurface::GetDC(HDC* dc_out) {
  if (DIRECTDRAWLOG) {
    Logger::Log(LogLevel::Verbose, "DirectGlawSurface::GetDC called");
  }

  return DDERR_UNSUPPORTED;  // TODO(tec27): Implement
}

HRESULT WINAPI DirectGlawSurface::GetFlipStatus(DWORD flags) {
  if (DIRECTDRAWLOG) {
    Logger::Logf(LogLevel::Verbose, "DirectGlawSurface::GetFlipStatus called with flags: %08x",
        flags);
  }

  return DDERR_UNSUPPORTED;  // TODO(tec27): Implement
}

HRESULT WINAPI DirectGlawSurface::GetOverlayPosition(LONG* x_out, LONG* y_out) {
  if (DIRECTDRAWLOG) {
    Logger::Log(LogLevel::Verbose, "DirectGlawSurface::GetOverlayPosition called");
  }

  return DDERR_UNSUPPORTED;  // TODO(tec27): Implement
}

HRESULT WINAPI DirectGlawSurface::GetPalette(IDirectDrawPalette** palette_out) {
  if (DIRECTDRAWLOG) {
    Logger::Log(LogLevel::Verbose, "DirectGlawSurface::GetPalette called");
  }

  return DDERR_UNSUPPORTED;  // TODO(tec27): Implement
}

HRESULT WINAPI DirectGlawSurface::GetPixelFormat(DDPIXELFORMAT* pixel_format_out) {
  if (DIRECTDRAWLOG) {
    Logger::Log(LogLevel::Verbose, "DirectGlawSurface::GetPixelFormat called");
  }

  return DDERR_UNSUPPORTED;  // TODO(tec27): Implement
}

HRESULT WINAPI DirectGlawSurface::GetSurfaceDesc(DDSURFACEDESC2* surface_desc_out) {
  if (DIRECTDRAWLOG) {
    Logger::Log(LogLevel::Verbose, "DirectGlawSurface::GetSurfaceDesc called");
  }

  return DDERR_UNSUPPORTED;  // TODO(tec27): Implement
}

HRESULT WINAPI DirectGlawSurface::Initialize(IDirectDraw* direct_draw,
    DDSURFACEDESC2* surface_desc) {
  if (DIRECTDRAWLOG) {
    Logger::Log(LogLevel::Verbose, "DirectGlawSurface::Initialize called");
  }
  return DDERR_ALREADYINITIALIZED;  // this is how this is meant to work, apparently.
}

HRESULT WINAPI DirectGlawSurface::IsLost() {
  if (DIRECTDRAWLOG) {
    Logger::Log(LogLevel::Verbose, "DirectGlawSurface::IsLost called");
  }

  return DDERR_UNSUPPORTED;  // TODO(tec27): Implement
}

HRESULT WINAPI DirectGlawSurface::Lock(RECT* dest_rect, DDSURFACEDESC2* surface_desc, DWORD flags,
    HANDLE unused) {
  // Lock is incredibly spammy, so we never log this call out, even when set to log DirectDraw calls

  // Ensure our assumptions are correct across all lock calls, if this ever fails, please fix or
  // file a bug :)
  assert(flags == DDLOCK_WAIT);  

  return DDERR_UNSUPPORTED;  // TODO(tec27): Implement
}

HRESULT WINAPI DirectGlawSurface::ReleaseDC(HDC dc) {
  if (DIRECTDRAWLOG) {
    Logger::Log(LogLevel::Verbose, "DirectGlawSurface::ReleaseDC called");
  }

  return DDERR_UNSUPPORTED;  // TODO(tec27): Implement
}

HRESULT WINAPI DirectGlawSurface::Restore() {
  if (DIRECTDRAWLOG) {
    Logger::Log(LogLevel::Verbose, "DirectGlawSurface::Restore called");
  }

  return DDERR_UNSUPPORTED;  // TODO(tec27): Implement
}

HRESULT WINAPI DirectGlawSurface::SetClipper(IDirectDrawClipper* clipper) {
  if (DIRECTDRAWLOG) {
    Logger::Log(LogLevel::Verbose, "DirectGlawSurface::SetClipper called");
  }

  return DDERR_UNSUPPORTED;  // TODO(tec27): Implement
}

HRESULT WINAPI DirectGlawSurface::SetColorKey(DWORD flags, DDCOLORKEY* color_key) {
  if (DIRECTDRAWLOG) {
    Logger::Logf(LogLevel::Verbose, "DirectGlawSurface::SetColorKey called with flags: %08x",
        flags);
  }

  return DDERR_UNSUPPORTED;  // TODO(tec27): Implement
}

HRESULT WINAPI DirectGlawSurface::SetOverlayPosition(LONG x, LONG y) {
  if (DIRECTDRAWLOG) {
    Logger::Log(LogLevel::Verbose, "DirectGlawSurface::SetOverlayPosition called");
  }

  return DDERR_UNSUPPORTED;  // TODO(tec27): Implement
}

HRESULT WINAPI DirectGlawSurface::SetPalette(IDirectDrawPalette* palette) {
  if (DIRECTDRAWLOG) {
    Logger::Log(LogLevel::Verbose, "DirectGlawSurface::SetPalette called");
  }

  if (palette_ != nullptr) {
    palette_->Release();
  }

  palette_ = reinterpret_cast<DirectGlawPalette*>(palette);
  return DD_OK;
}

HRESULT WINAPI DirectGlawSurface::Unlock(RECT* locked_rect) {
  if (DIRECTDRAWLOG) {
    Logger::Log(LogLevel::Verbose, "DirectGlawSurface::Unlock called");
  }

  return DDERR_UNSUPPORTED;  // TODO(tec27): Implement
}

HRESULT WINAPI DirectGlawSurface::UpdateOverlay(RECT* src_rect, IDirectDrawSurface7* dest_surface,
    RECT* dest_rect, DWORD flags, DDOVERLAYFX* overlay_fx) {
  if (DIRECTDRAWLOG) {
    Logger::Logf(LogLevel::Verbose, "DirectGlawSurface::UpdateOverlay called with flags: %08x",
        flags);
  }

  return DDERR_UNSUPPORTED;  // TODO(tec27): Implement
}

HRESULT WINAPI DirectGlawSurface::UpdateOverlayDisplay(DWORD unused) {
  if (DIRECTDRAWLOG) {
    Logger::Log(LogLevel::Verbose, "DirectGlawSurface::UpdateOverlayDisplay called");
  }

  return DDERR_UNSUPPORTED;  // TODO(tec27): Implement
}

HRESULT WINAPI DirectGlawSurface::UpdateOverlayZOrder(DWORD flags,
    IDirectDrawSurface7* surface_ref) {
  if (DIRECTDRAWLOG) {
    Logger::Logf(LogLevel::Verbose,
        "DirectGlawSurface::UpdateOverlayZOrder called with flags: %08x", flags);
  }

  return DDERR_UNSUPPORTED;  // TODO(tec27): Implement
}

HRESULT WINAPI DirectGlawSurface::GetDDInterface(void** direct_draw) {
  if (DIRECTDRAWLOG) {
    Logger::Log(LogLevel::Verbose, "DirectGlawSurface::GetDDInterface called");
  }

  return DDERR_UNSUPPORTED;  // TODO(tec27): Implement
}

HRESULT WINAPI DirectGlawSurface::PageLock(DWORD unused) {
  if (DIRECTDRAWLOG) {
    Logger::Log(LogLevel::Verbose, "DirectGlawSurface::PageLock called");
  }

  return DDERR_UNSUPPORTED;  // TODO(tec27): Implement
}

HRESULT WINAPI DirectGlawSurface::PageUnlock(DWORD unused) {
  if (DIRECTDRAWLOG) {
    Logger::Log(LogLevel::Verbose, "DirectGlawSurface::PageUnlock called");
  }

  return DDERR_UNSUPPORTED;  // TODO(tec27): Implement
}

HRESULT WINAPI DirectGlawSurface::SetSurfaceDesc(DDSURFACEDESC2* surface_desc, DWORD unused) {
  if (DIRECTDRAWLOG) {
    Logger::Log(LogLevel::Verbose, "DirectGlawSurface::SetSurfaceDesc called");
  }

  return DDERR_UNSUPPORTED;  // TODO(tec27): Implement
}

HRESULT WINAPI DirectGlawSurface::SetPrivateData(REFGUID tag, void* data, DWORD data_size,
    DWORD flags) {
  if (DIRECTDRAWLOG) {
    Logger::Logf(LogLevel::Verbose,
        "DirectGlawSurface::SetPrivateData called with size: %d flags: %08x", data_size, flags);
  }

  return DDERR_UNSUPPORTED;  // TODO(tec27): Implement
}

HRESULT WINAPI DirectGlawSurface::GetPrivateData(REFGUID tag, void* buffer, DWORD* buffer_size) {
  if (DIRECTDRAWLOG) {
    Logger::Logf(LogLevel::Verbose, "DirectGlawSurface::GetPrivateData called with size: %d",
        buffer_size);
  }

  return DDERR_UNSUPPORTED;  // TODO(tec27): Implement
}

HRESULT WINAPI DirectGlawSurface::FreePrivateData(REFGUID tag) {
  if (DIRECTDRAWLOG) {
    Logger::Log(LogLevel::Verbose, "DirectGlawSurface::FreePrivateData called");
  }

  return DDERR_UNSUPPORTED;  // TODO(tec27): Implement
}

HRESULT WINAPI DirectGlawSurface::GetUniquenessValue(DWORD* value) {
  if (DIRECTDRAWLOG) {
    Logger::Log(LogLevel::Verbose, "DirectGlawSurface::GetUniquenessValue called");
  }

  return DDERR_UNSUPPORTED;  // TODO(tec27): Implement
}

HRESULT WINAPI DirectGlawSurface::ChangeUniquenessValue() {
  if (DIRECTDRAWLOG) {
    Logger::Log(LogLevel::Verbose, "DirectGlawSurface::ChangeUniquenessValue called");
  }

  return DDERR_UNSUPPORTED;  // TODO(tec27): Implement
}

HRESULT WINAPI DirectGlawSurface::SetPriority(DWORD priority) {
  if (DIRECTDRAWLOG) {
    Logger::Logf(LogLevel::Verbose, "DirectGlawSurface::SetPriority called with priority: %d",
        priority);
  }

  return DDERR_UNSUPPORTED;  // TODO(tec27): Implement
}

HRESULT WINAPI DirectGlawSurface::GetPriority(DWORD* priority_out) {
  if (DIRECTDRAWLOG) {
    Logger::Log(LogLevel::Verbose, "DirectGlawSurface::GetPriority called");
  }

  return DDERR_UNSUPPORTED;  // TODO(tec27): Implement
}

HRESULT WINAPI DirectGlawSurface::SetLOD(DWORD lod) {
  if (DIRECTDRAWLOG) {
    Logger::Logf(LogLevel::Verbose, "DirectGlawSurface::SetLOD called with lod: %d", lod);
  }

  return DDERR_UNSUPPORTED;  // TODO(tec27): Implement
}

HRESULT WINAPI DirectGlawSurface::GetLOD(DWORD* lod_out) {
  if (DIRECTDRAWLOG) {
    Logger::Log(LogLevel::Verbose, "DirectGlawSurface::GetLOD called");
  }

  return DDERR_UNSUPPORTED;  // TODO(tec27): Implement
}


}  // namespace forge
}  // namespace sbat