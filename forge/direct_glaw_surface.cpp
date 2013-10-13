#include "forge/direct_glaw.h"

#include <gl/gl.h>
#include <vector>

#include "logger/logger.h"


namespace sbat {
namespace forge {

using std::array;
using std::vector;

DirectGlawSurface::DirectGlawSurface(DirectGlaw* owner, DDSURFACEDESC2* surface_desc)
  : refcount_(1),
    owner_(owner),
    palette_(nullptr),
    surface_desc_(*surface_desc),
    width_(owner->display_width()),
    height_(owner->display_height()),
    pitch_(0),
    texture_internal_format_(GL_RGBA8),
    texture_format_(GL_LUMINANCE),
    surface_data_(),
    textures_(),
    texture_in_use_(0),
    vertex_buffer_(),
    element_buffer_(),
    counter_frequency_(),
    last_frame_time_() {
  owner_->AddRef();

  if (GLEW_VERSION_3_0) {
    texture_internal_format_ = GL_R8;
    texture_format_ = GL_RED;
  }

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

      owner_->InitializeOpenGl();
    }
  }

  surface_desc_.dwWidth = width_;
  surface_desc_.dwHeight = height_;
  surface_desc_.lPitch = pitch_;
  surface_desc_.dwFlags |= DDSD_WIDTH | DDSD_HEIGHT | DDSD_PITCH;

  surface_data_ = vector<byte>(height_ * pitch_, 0);
  
  // X, Y, U, V -- this flips the texture vertically so it matches the orientation of DDraw surfaces
  const array<GLfloat, 16> vertex_data =
      { -1.0f, -1.0f, 0.0f, 1.0f,
        1.0f, -1.0f, 1.0f, 1.0f,
        -1.0f, 1.0f, 0.0f, 0.0f,
        1.0f, 1.0f, 1.0f, 0.0f };
  vertex_buffer_.reset(new GlStaticBuffer<GLfloat, 16>(GL_ARRAY_BUFFER, vertex_data));
  const array<GLushort, 4> element_data = { 0, 1, 2, 3 };
  element_buffer_.reset(new GlStaticBuffer<GLushort, 4>(GL_ELEMENT_ARRAY_BUFFER, element_data));

  glGenTextures(textures_.size(), &textures_[0]);
  for (uint32 i = 0; i < textures_.size(); ++i) {
    glActiveTexture(GL_TEXTURE0 + i);
    glBindTexture(GL_TEXTURE_2D, textures_[i]);
    glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MIN_FILTER, GL_NEAREST);
    glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MAG_FILTER, GL_NEAREST);
    glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_BASE_LEVEL, 0);
    glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MAX_LEVEL, 0);
    glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_WRAP_S, GL_CLAMP_TO_EDGE);
    glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_WRAP_T, GL_CLAMP_TO_EDGE);
    glTexImage2D(GL_TEXTURE_2D, 0, texture_internal_format_, width_, height_, 0,
        texture_format_, GL_UNSIGNED_BYTE, NULL);
  }

  QueryPerformanceFrequency(&counter_frequency_);
  counter_frequency_.QuadPart /= 1000LL; // convert to ticks per millisecond
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
  if (DIRECTDRAWLOG) {
    Logger::Log(LogLevel::Verbose, "DirectGlawSurface::Lock called");
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
  palette_->AddRef();
  palette_->InitForOpenGl();
  return DD_OK;
}

HRESULT WINAPI DirectGlawSurface::Unlock(RECT* locked_rect) {
  if (DIRECTDRAWLOG) {
    Logger::Log(LogLevel::Verbose, "DirectGlawSurface::Unlock called");
  }

  if (is_primary_surface()) {
    Render();
  }

  // we don't actually lock anything, so we can just say this was fine
  return DD_OK;
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

void DirectGlawSurface::Render() {
  // BW has a nasty habit of trying to render ridiculously fast (like in the middle of a tight 7k
  // iteration loop during data intialization when there's nothing to actually render) and this
  // causes issues when the graphics card decides it doesn't want to queue commands any more. To
  // avoid these issues, we attempt to kill vsync, but also try to help BW out by not actually
  // making rendering calls this fast. 120Hz seems like a "reasonable" limit to me (and by
  // reasonable, I mean unlikely to cause weird issues), even though BW will never actually update
  // any state that fast.
  LARGE_INTEGER frame_time;
  QueryPerformanceCounter(&frame_time);
  if ((frame_time.QuadPart - last_frame_time_.QuadPart) / counter_frequency_.QuadPart < 8) {
    return;
  }

  if (DIRECTDRAWLOG) {
    Logger::Log(LogLevel::Verbose, "DirectGlawSurface rendering");
  }

  glBindTexture(GL_TEXTURE_2D, textures_[texture_in_use_]);
  glTexSubImage2D(GL_TEXTURE_2D, 0, 0, 0, width_, height_, texture_format_, GL_UNSIGNED_BYTE,
      &surface_data_[0]);
  if (DIRECTDRAWLOG) {
    Logger::Log(LogLevel::Verbose, "DirectGlawSurface rendering - after screen texture copied");
  }
  // flip our texture so we don't have to wait for the graphics card in order to render the next
  // frame
  ++texture_in_use_;
  if (texture_in_use_ >= textures_.size()) {
    texture_in_use_ = 0;
  }

  GLuint shader_program = owner_->shader_program();
  if (!shader_program) {
    return;
  }
  const ShaderResources* resources = owner_->shader_resources();
  glUseProgram(shader_program);

  if (DIRECTDRAWLOG) {
    Logger::Log(LogLevel::Verbose, "DirectGlawSurface rendering - after use program");
  }

  glClearColor(0.0f, 0.0f, 0.0f, 0.0f);
  glClear(GL_COLOR_BUFFER_BIT | GL_DEPTH_BUFFER_BIT);

  if (DIRECTDRAWLOG) {
    Logger::Log(LogLevel::Verbose, "DirectGlawSurface rendering - after clear");
  }

  glActiveTexture(GL_TEXTURE0 + texture_in_use_);
  glBindTexture(GL_TEXTURE_2D, textures_[texture_in_use_]);
  glUniform1i(resources->uniforms.bw_screen, texture_in_use_);
  palette_->BindTexture(resources->uniforms.palette, GL_TEXTURE10, 10);
  if (DIRECTDRAWLOG) {
    Logger::Log(LogLevel::Verbose, "DirectGlawSurface rendering - after textures bound");
  }

  glBindBuffer(GL_ARRAY_BUFFER, vertex_buffer_->buffer());
  glEnableVertexAttribArray(resources->attributes.position);
  glVertexAttribPointer(resources->attributes.position, 2, GL_FLOAT, GL_FALSE, sizeof(GLfloat) * 4,
      reinterpret_cast<void*>(0));
  glEnableVertexAttribArray(resources->attributes.texpos);
  glVertexAttribPointer(resources->attributes.texpos, 2, GL_FLOAT, GL_TRUE, sizeof(GLfloat) * 4,
      reinterpret_cast<void*>(sizeof(GLfloat) * 2));
  glBindBuffer(GL_ELEMENT_ARRAY_BUFFER, element_buffer_->buffer());
  glDrawElements(GL_TRIANGLE_STRIP, 4, GL_UNSIGNED_SHORT, reinterpret_cast<void*>(0));

  glDisableVertexAttribArray(resources->attributes.texpos);
  glDisableVertexAttribArray(resources->attributes.position);

  owner_->SwapBuffers();

  QueryPerformanceCounter(&last_frame_time_);
  if (DIRECTDRAWLOG) {
    Logger::Logf(LogLevel::Verbose,
        "DirectGlawSurface rendering completed [perf counter: %lld]",
        last_frame_time_.QuadPart / counter_frequency_.QuadPart);
  }
}

}  // namespace forge
}  // namespace sbat