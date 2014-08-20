#include "forge/indirect_draw.h"

#include <gl/gl.h>
#include <vector>

#include "forge/open_gl.h"
#include "logger/logger.h"


namespace sbat {
namespace forge {

using std::array;
using std::vector;

IndirectDrawSurface::IndirectDrawSurface(IndirectDraw* owner, DDSURFACEDESC2* surface_desc)
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

  if (surface_desc_.dwFlags & DDSD_HEIGHT) {
    height_ = surface_desc_.dwHeight;
  }

  if (surface_desc_.dwFlags & DDSD_PITCH) {
    pitch_ = surface_desc_.lPitch;
  } else {
    pitch_ = width_ * owner->display_bpp() / 8;
  }

  if (surface_desc_.dwFlags & DDSD_CAPS) {
    if (surface_desc_.ddsCaps.dwCaps & DDSCAPS_PRIMARYSURFACE) {
      if (DIRECTDRAWLOG) {
        Logger::Log(LogLevel::Verbose, "IndirectDraw: primary surface created");
      }

      owner_->InitializeOpenGl();
    }
  }

  surface_desc_.dwWidth = width_;
  surface_desc_.dwHeight = height_;
  surface_desc_.lPitch = pitch_;
  surface_desc_.dwFlags |= DDSD_WIDTH | DDSD_HEIGHT | DDSD_PITCH;

  surface_data_ = vector<byte>(height_ * pitch_, 0);
}

IndirectDrawSurface::~IndirectDrawSurface() {
  if (palette_ != nullptr) {
    palette_->Release();
    palette_ = nullptr;
  }
  if (owner_ != nullptr) {
    owner_->Release();
    owner_ = nullptr;
  }
}

HRESULT WINAPI IndirectDrawSurface::QueryInterface(REFIID riid, void** obj_out) {
  if (DIRECTDRAWLOG) {
    Logger::Log(LogLevel::Verbose, "IndirectDrawSurface::QueryInterface called");
  }

  *obj_out = nullptr;
  return DDERR_UNSUPPORTED;
}

ULONG WINAPI IndirectDrawSurface::AddRef() {
  if (DIRECTDRAWLOG) {
    Logger::Log(LogLevel::Verbose, "IndirectDrawSurface::AddRef called");
  }

  refcount_++;
  return refcount_;
}

ULONG WINAPI IndirectDrawSurface::Release() {
  if (DIRECTDRAWLOG) {
    Logger::Log(LogLevel::Verbose, "IndirectDrawSurface::Release called");
  }
  refcount_--;
  if (refcount_ <= 0) {
    delete this;
    return 0;
  } else {
    return refcount_;
  }
}

HRESULT WINAPI IndirectDrawSurface::AddAttachedSurface(IDirectDrawSurface7* surface) {
  if (DIRECTDRAWLOG) {
    Logger::Log(LogLevel::Verbose, "IndirectDrawSurface::AddAttachedSurface called");
  }

  return DDERR_UNSUPPORTED;  // TODO(tec27): Implement
}

HRESULT WINAPI IndirectDrawSurface::AddOverlayDirtyRect(RECT* dirty_rect) {
  if (DIRECTDRAWLOG) {
    Logger::Log(LogLevel::Verbose, "IndirectDrawSurface::AddOverlayDirtyRect called");
  }

  return DDERR_UNSUPPORTED;  // TODO(tec27): Implement
}

HRESULT WINAPI IndirectDrawSurface::Blt(RECT* dest_rect, IDirectDrawSurface7* src, RECT* src_rect,
    DWORD flags, DDBLTFX* fx) {
  if (DIRECTDRAWLOG) {
    Logger::Logf(LogLevel::Verbose, "IndirectDrawSurface::Blt called with flags: %08x", flags);
  }

  return DDERR_UNSUPPORTED;  // TODO(tec27): Implement
}

HRESULT WINAPI IndirectDrawSurface::BltBatch(DDBLTBATCH* operations, DWORD count, DWORD unused) {
  if (DIRECTDRAWLOG) {
    Logger::Logf(LogLevel::Verbose, "IndirectDrawSurface::BltBatch called with %d operations", count);
  }

  return DDERR_UNSUPPORTED;  // TODO(tec27): Implement
}

HRESULT WINAPI IndirectDrawSurface::BltFast(DWORD x, DWORD y, IDirectDrawSurface7* src,
    RECT* src_rect, DWORD flags) {
  if (DIRECTDRAWLOG) {
    Logger::Logf(LogLevel::Verbose, "IndirectDrawSurface::BltFast called for %d,%d with flags: %08x",
        x, y, flags);
  }

  return DDERR_UNSUPPORTED;  // TODO(tec27): Implement
}

HRESULT WINAPI IndirectDrawSurface::DeleteAttachedSurface(DWORD flags,
    IDirectDrawSurface7* attached) {
  if (DIRECTDRAWLOG) {
    Logger::Logf(LogLevel::Verbose,
        "IndirectDrawSurface::DeleteAttachedSurface called with flags: %08x", flags);
  }

  return DDERR_UNSUPPORTED;  // TODO(tec27): Implement
}

HRESULT WINAPI IndirectDrawSurface::EnumAttachedSurfaces(void* context,
    LPDDENUMSURFACESCALLBACK7 callback) {
  if (DIRECTDRAWLOG) {
    Logger::Log(LogLevel::Verbose, "IndirectDrawSurface::EnumAttachedSurfaces called");
  }

  return DDERR_UNSUPPORTED;  // TODO(tec27): Implement
}

HRESULT WINAPI IndirectDrawSurface::EnumOverlayZOrders(DWORD flags, void* context,
    LPDDENUMSURFACESCALLBACK7 callback) {
  if (DIRECTDRAWLOG) {
    Logger::Logf(LogLevel::Verbose, "IndirectDrawSurface::EnumOverlayZOrders called with flags: %08x",
        flags);
  }

  return DDERR_UNSUPPORTED;  // TODO(tec27): Implement
}

HRESULT WINAPI IndirectDrawSurface::Flip(IDirectDrawSurface7* target_override, DWORD flags) {
  if (DIRECTDRAWLOG) {
    Logger::Logf(LogLevel::Verbose, "IndirectDrawSurface::Flip called with flags: %08x", flags);
  }

  return DDERR_UNSUPPORTED;  // TODO(tec27): Implement
}

HRESULT WINAPI IndirectDrawSurface::GetAttachedSurface(DDSCAPS2* caps,
    IDirectDrawSurface7** surface_out) {
  if (DIRECTDRAWLOG) {
    Logger::Log(LogLevel::Verbose, "IndirectDrawSurface::GetAttachedSurface called");
  }

  return DDERR_UNSUPPORTED;  // TODO(tec27): Implement
}

HRESULT WINAPI IndirectDrawSurface::GetBltStatus(DWORD flags) {
  if (DIRECTDRAWLOG) {
    Logger::Logf(LogLevel::Verbose, "IndirectDrawSurface::GetBltStatus called with flags: %08x",
        flags);
  }

  return DDERR_UNSUPPORTED;  // TODO(tec27): Implement
}

HRESULT WINAPI IndirectDrawSurface::GetCaps(DDSCAPS2* caps_out) {
  if (DIRECTDRAWLOG) {
    Logger::Log(LogLevel::Verbose, "IndirectDrawSurface::GetCaps called");
  }

  return DDERR_UNSUPPORTED;  // TODO(tec27): Implement
}

HRESULT WINAPI IndirectDrawSurface::GetClipper(IDirectDrawClipper** clipper_out) {
  if (DIRECTDRAWLOG) {
    Logger::Log(LogLevel::Verbose, "IndirectDrawSurface::GetClipper called");
  }

  return DDERR_UNSUPPORTED;  // TODO(tec27): Implement
}

HRESULT WINAPI IndirectDrawSurface::GetColorKey(DWORD flags, DDCOLORKEY* color_key_out) {
  if (DIRECTDRAWLOG) {
    Logger::Logf(LogLevel::Verbose, "IndirectDrawSurface::GetColorKey called with flags: %08x",
        flags);
  }

  return DDERR_UNSUPPORTED;  // TODO(tec27): Implement
}

HRESULT WINAPI IndirectDrawSurface::GetDC(HDC* dc_out) {
  if (DIRECTDRAWLOG) {
    Logger::Log(LogLevel::Verbose, "IndirectDrawSurface::GetDC called");
  }

  return DDERR_UNSUPPORTED;  // TODO(tec27): Implement
}

HRESULT WINAPI IndirectDrawSurface::GetFlipStatus(DWORD flags) {
  if (DIRECTDRAWLOG) {
    Logger::Logf(LogLevel::Verbose, "IndirectDrawSurface::GetFlipStatus called with flags: %08x",
        flags);
  }

  return DDERR_UNSUPPORTED;  // TODO(tec27): Implement
}

HRESULT WINAPI IndirectDrawSurface::GetOverlayPosition(LONG* x_out, LONG* y_out) {
  if (DIRECTDRAWLOG) {
    Logger::Log(LogLevel::Verbose, "IndirectDrawSurface::GetOverlayPosition called");
  }

  return DDERR_UNSUPPORTED;  // TODO(tec27): Implement
}

HRESULT WINAPI IndirectDrawSurface::GetPalette(IDirectDrawPalette** palette_out) {
  if (DIRECTDRAWLOG) {
    Logger::Log(LogLevel::Verbose, "IndirectDrawSurface::GetPalette called");
  }

  return DDERR_UNSUPPORTED;  // TODO(tec27): Implement
}

HRESULT WINAPI IndirectDrawSurface::GetPixelFormat(DDPIXELFORMAT* pixel_format_out) {
  if (DIRECTDRAWLOG) {
    Logger::Log(LogLevel::Verbose, "IndirectDrawSurface::GetPixelFormat called");
  }

  return DDERR_UNSUPPORTED;  // TODO(tec27): Implement
}

HRESULT WINAPI IndirectDrawSurface::GetSurfaceDesc(DDSURFACEDESC2* surface_desc_out) {
  if (DIRECTDRAWLOG) {
    Logger::Log(LogLevel::Verbose, "IndirectDrawSurface::GetSurfaceDesc called");
  }

  return DDERR_UNSUPPORTED;  // TODO(tec27): Implement
}

HRESULT WINAPI IndirectDrawSurface::Initialize(IDirectDraw* direct_draw,
    DDSURFACEDESC2* surface_desc) {
  if (DIRECTDRAWLOG) {
    Logger::Log(LogLevel::Verbose, "IndirectDrawSurface::Initialize called");
  }
  return DDERR_ALREADYINITIALIZED;  // this is how this is meant to work, apparently.
}

HRESULT WINAPI IndirectDrawSurface::IsLost() {
  if (DIRECTDRAWLOG) {
    Logger::Log(LogLevel::Verbose, "IndirectDrawSurface::IsLost called");
  }

  return DDERR_UNSUPPORTED;  // TODO(tec27): Implement
}

HRESULT WINAPI IndirectDrawSurface::Lock(RECT* dest_rect, DDSURFACEDESC2* surface_desc, DWORD flags,
    HANDLE unused) {
  if (DIRECTDRAWLOG) {
    Logger::Log(LogLevel::Verbose, "IndirectDrawSurface::Lock called");
  }

  // Ensure our assumptions are correct across all lock calls, if this ever fails, please fix or
  // file a bug :)
  assert(flags == DDLOCK_WAIT);
  assert(surface_desc->dwSize == surface_desc_.dwSize);
  memcpy(surface_desc, &surface_desc_, surface_desc->dwSize);
  surface_desc->dwFlags |= DDSD_LPSURFACE | DDSD_WIDTH | DDSD_HEIGHT | DDSD_PITCH;
  surface_desc->lpSurface = &surface_data_[0];
  // this should maybe actually implement a lock of some sort, but since I'm not sure of the exact
  // behavior of DDraw here, and we aren't actually shuffling memory, and I trust BW to have few
  // lock stomping issues (ha, ha), I'll leave this out for now

  return DD_OK;
}

HRESULT WINAPI IndirectDrawSurface::ReleaseDC(HDC dc) {
  if (DIRECTDRAWLOG) {
    Logger::Log(LogLevel::Verbose, "IndirectDrawSurface::ReleaseDC called");
  }

  return DDERR_UNSUPPORTED;  // TODO(tec27): Implement
}

HRESULT WINAPI IndirectDrawSurface::Restore() {
  if (DIRECTDRAWLOG) {
    Logger::Log(LogLevel::Verbose, "IndirectDrawSurface::Restore called");
  }

  return DDERR_UNSUPPORTED;  // TODO(tec27): Implement
}

HRESULT WINAPI IndirectDrawSurface::SetClipper(IDirectDrawClipper* clipper) {
  if (DIRECTDRAWLOG) {
    Logger::Log(LogLevel::Verbose, "IndirectDrawSurface::SetClipper called");
  }

  return DDERR_UNSUPPORTED;  // TODO(tec27): Implement
}

HRESULT WINAPI IndirectDrawSurface::SetColorKey(DWORD flags, DDCOLORKEY* color_key) {
  if (DIRECTDRAWLOG) {
    Logger::Logf(LogLevel::Verbose, "IndirectDrawSurface::SetColorKey called with flags: %08x",
        flags);
  }

  return DDERR_UNSUPPORTED;  // TODO(tec27): Implement
}

HRESULT WINAPI IndirectDrawSurface::SetOverlayPosition(LONG x, LONG y) {
  if (DIRECTDRAWLOG) {
    Logger::Log(LogLevel::Verbose, "IndirectDrawSurface::SetOverlayPosition called");
  }

  return DDERR_UNSUPPORTED;  // TODO(tec27): Implement
}

HRESULT WINAPI IndirectDrawSurface::SetPalette(IDirectDrawPalette* palette) {
  if (DIRECTDRAWLOG) {
    Logger::Log(LogLevel::Verbose, "IndirectDrawSurface::SetPalette called");
  }

  if (palette_ != nullptr) {
    palette_->Release();
  }

  palette_ = reinterpret_cast<IndirectDrawPalette*>(palette);
  palette_->AddRef();
  palette_->InitForOpenGl();
  return DD_OK;
}

HRESULT WINAPI IndirectDrawSurface::Unlock(RECT* locked_rect) {
  if (DIRECTDRAWLOG) {
    Logger::Log(LogLevel::Verbose, "IndirectDrawSurface::Unlock called");
  }

  if (is_primary_surface()) {
    owner_->Render(*palette_, surface_data_);
  }

  // we don't actually lock anything, so we can just say this was fine
  return DD_OK;
}

HRESULT WINAPI IndirectDrawSurface::UpdateOverlay(RECT* src_rect, IDirectDrawSurface7* dest_surface,
    RECT* dest_rect, DWORD flags, DDOVERLAYFX* overlay_fx) {
  if (DIRECTDRAWLOG) {
    Logger::Logf(LogLevel::Verbose, "IndirectDrawSurface::UpdateOverlay called with flags: %08x",
        flags);
  }

  return DDERR_UNSUPPORTED;  // TODO(tec27): Implement
}

HRESULT WINAPI IndirectDrawSurface::UpdateOverlayDisplay(DWORD unused) {
  if (DIRECTDRAWLOG) {
    Logger::Log(LogLevel::Verbose, "IndirectDrawSurface::UpdateOverlayDisplay called");
  }

  return DDERR_UNSUPPORTED;  // TODO(tec27): Implement
}

HRESULT WINAPI IndirectDrawSurface::UpdateOverlayZOrder(DWORD flags,
    IDirectDrawSurface7* surface_ref) {
  if (DIRECTDRAWLOG) {
    Logger::Logf(LogLevel::Verbose,
        "IndirectDrawSurface::UpdateOverlayZOrder called with flags: %08x", flags);
  }

  return DDERR_UNSUPPORTED;  // TODO(tec27): Implement
}

HRESULT WINAPI IndirectDrawSurface::GetDDInterface(void** direct_draw) {
  if (DIRECTDRAWLOG) {
    Logger::Log(LogLevel::Verbose, "IndirectDrawSurface::GetDDInterface called");
  }

  return DDERR_UNSUPPORTED;  // TODO(tec27): Implement
}

HRESULT WINAPI IndirectDrawSurface::PageLock(DWORD unused) {
  if (DIRECTDRAWLOG) {
    Logger::Log(LogLevel::Verbose, "IndirectDrawSurface::PageLock called");
  }

  return DDERR_UNSUPPORTED;  // TODO(tec27): Implement
}

HRESULT WINAPI IndirectDrawSurface::PageUnlock(DWORD unused) {
  if (DIRECTDRAWLOG) {
    Logger::Log(LogLevel::Verbose, "IndirectDrawSurface::PageUnlock called");
  }

  return DDERR_UNSUPPORTED;  // TODO(tec27): Implement
}

HRESULT WINAPI IndirectDrawSurface::SetSurfaceDesc(DDSURFACEDESC2* surface_desc, DWORD unused) {
  if (DIRECTDRAWLOG) {
    Logger::Log(LogLevel::Verbose, "IndirectDrawSurface::SetSurfaceDesc called");
  }

  return DDERR_UNSUPPORTED;  // TODO(tec27): Implement
}

HRESULT WINAPI IndirectDrawSurface::SetPrivateData(REFGUID tag, void* data, DWORD data_size,
    DWORD flags) {
  if (DIRECTDRAWLOG) {
    Logger::Logf(LogLevel::Verbose,
        "IndirectDrawSurface::SetPrivateData called with size: %d flags: %08x", data_size, flags);
  }

  return DDERR_UNSUPPORTED;  // TODO(tec27): Implement
}

HRESULT WINAPI IndirectDrawSurface::GetPrivateData(REFGUID tag, void* buffer, DWORD* buffer_size) {
  if (DIRECTDRAWLOG) {
    Logger::Logf(LogLevel::Verbose, "IndirectDrawSurface::GetPrivateData called with size: %d",
        buffer_size);
  }

  return DDERR_UNSUPPORTED;  // TODO(tec27): Implement
}

HRESULT WINAPI IndirectDrawSurface::FreePrivateData(REFGUID tag) {
  if (DIRECTDRAWLOG) {
    Logger::Log(LogLevel::Verbose, "IndirectDrawSurface::FreePrivateData called");
  }

  return DDERR_UNSUPPORTED;  // TODO(tec27): Implement
}

HRESULT WINAPI IndirectDrawSurface::GetUniquenessValue(DWORD* value) {
  if (DIRECTDRAWLOG) {
    Logger::Log(LogLevel::Verbose, "IndirectDrawSurface::GetUniquenessValue called");
  }

  return DDERR_UNSUPPORTED;  // TODO(tec27): Implement
}

HRESULT WINAPI IndirectDrawSurface::ChangeUniquenessValue() {
  if (DIRECTDRAWLOG) {
    Logger::Log(LogLevel::Verbose, "IndirectDrawSurface::ChangeUniquenessValue called");
  }

  return DDERR_UNSUPPORTED;  // TODO(tec27): Implement
}

HRESULT WINAPI IndirectDrawSurface::SetPriority(DWORD priority) {
  if (DIRECTDRAWLOG) {
    Logger::Logf(LogLevel::Verbose, "IndirectDrawSurface::SetPriority called with priority: %d",
        priority);
  }

  return DDERR_UNSUPPORTED;  // TODO(tec27): Implement
}

HRESULT WINAPI IndirectDrawSurface::GetPriority(DWORD* priority_out) {
  if (DIRECTDRAWLOG) {
    Logger::Log(LogLevel::Verbose, "IndirectDrawSurface::GetPriority called");
  }

  return DDERR_UNSUPPORTED;  // TODO(tec27): Implement
}

HRESULT WINAPI IndirectDrawSurface::SetLOD(DWORD lod) {
  if (DIRECTDRAWLOG) {
    Logger::Logf(LogLevel::Verbose, "IndirectDrawSurface::SetLOD called with lod: %d", lod);
  }

  return DDERR_UNSUPPORTED;  // TODO(tec27): Implement
}

HRESULT WINAPI IndirectDrawSurface::GetLOD(DWORD* lod_out) {
  if (DIRECTDRAWLOG) {
    Logger::Log(LogLevel::Verbose, "IndirectDrawSurface::GetLOD called");
  }

  return DDERR_UNSUPPORTED;  // TODO(tec27): Implement
}

}  // namespace forge
}  // namespace sbat