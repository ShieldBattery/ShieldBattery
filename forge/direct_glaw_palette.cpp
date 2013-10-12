#include "forge/direct_glaw.h"

#include <array>
#include <algorithm>

#include "logger/logger.h"

namespace sbat {
namespace forge {

using std::array;

DirectGlawPalette::DirectGlawPalette(DWORD flags, PALETTEENTRY* color_array)
    : refcount_(1),
      entries_(),
      texture_data_(),
      texture_(0),
      is_opengl_inited(false) {
  // BW calls this initially with DDPCAPS_8BIT (8-bit entries) and DDPCAPS_ALLOW256 (allow all 256
  // entries to be defined). To make things simple, we will only accept those values
  assert(flags == (DDPCAPS_8BIT | DDPCAPS_ALLOW256));
  std::copy(&color_array[0], &color_array[entries_.size()], entries_.begin());
  std::transform(entries_.begin(), entries_.end(), texture_data_.begin(),
      ConvertToPaletteTextureEntry);
}

DirectGlawPalette::~DirectGlawPalette() {
}

HRESULT WINAPI DirectGlawPalette::QueryInterface(REFIID riid, void** obj_out) {
  if (DIRECTDRAWLOG) {
    Logger::Log(LogLevel::Verbose, "DirectGlawPalette::QueryInterface called");
  }

  *obj_out = nullptr;
  return DDERR_UNSUPPORTED;
}

ULONG WINAPI DirectGlawPalette::AddRef() {
  if (DIRECTDRAWLOG) {
    Logger::Log(LogLevel::Verbose, "DirectGlawPalette::AddRef called");
  }

  refcount_++;
  return refcount_;
}

ULONG WINAPI DirectGlawPalette::Release() {
  if (DIRECTDRAWLOG) {
    Logger::Log(LogLevel::Verbose, "DirectGlawPalette::Release called");
  }
  refcount_--;
  if (refcount_ <= 0) {
    delete this;
    return 0;
  } else {
    return refcount_;
  }
}

HRESULT WINAPI DirectGlawPalette::GetCaps(DWORD* caps) {
  if (DIRECTDRAWLOG) {
    Logger::Log(LogLevel::Verbose, "DirectGlawPalette::GetCaps called");
  }
  // we assert above what the caps are, so we can just return those here
  *caps = DDPCAPS_8BIT | DDPCAPS_ALLOW256;
  return DD_OK;
}

HRESULT WINAPI DirectGlawPalette::GetEntries(DWORD unused, DWORD start, DWORD count,
    PALETTEENTRY* palette_out) {
  if (DIRECTDRAWLOG) {
    Logger::Logf(LogLevel::Verbose,
        "DirectGlawPalette::GetEntries called with start: %d, count: %d", start, count);
  }
  assert(start >= 0);
  assert(count > 0);
  assert(start + count <= entries_.size());

  std::copy(entries_.begin() + start, entries_.begin() + count, palette_out);
  return DD_OK;
}

HRESULT WINAPI DirectGlawPalette::Initialize(IDirectDraw* owner, DWORD flags,
    PALETTEENTRY* color_array) {
  if (DIRECTDRAWLOG) {
    Logger::Log(LogLevel::Verbose, "DirectGlawPalette::Initialize called");
  }
  return DDERR_ALREADYINITIALIZED;  // this is how this is meant to work, apparently.
}

HRESULT WINAPI DirectGlawPalette::SetEntries(DWORD unused, DWORD start, DWORD count,
    PALETTEENTRY* entries) {
  if (DIRECTDRAWLOG) {
    Logger::Logf(LogLevel::Verbose,
        "DirectGlawPalette::SetEntries called with start: %d, count: %d", start, count);
  }
  assert(start >= 0);
  assert(count > 0);
  assert(start + count <= entries_.size());

  std::copy(&entries[0], &entries[count], entries_.begin() + start);
  std::transform(&entries[0], &entries[count], texture_data_.begin() + start,
      ConvertToPaletteTextureEntry);

  if (is_opengl_inited) {
    glBindTexture(GL_TEXTURE_2D, texture_);
    glTexSubImage2D(GL_TEXTURE_2D, 0, 0, 0, texture_data_.size(), 1, GL_BGRA, GL_UNSIGNED_BYTE,
        &texture_data_[0]);
  }
  return DD_OK;
}

void DirectGlawPalette::InitForOpenGl() {
  if (is_opengl_inited) {
    return;
  }

  glGenTextures(1, &texture_);
  glBindTexture(GL_TEXTURE_2D, texture_);
  glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MIN_FILTER, GL_NEAREST);
  glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MAG_FILTER, GL_NEAREST);
  glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_BASE_LEVEL, 0);
  glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MAX_LEVEL, 0);
  glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_WRAP_S, GL_CLAMP_TO_EDGE);
  glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_WRAP_T, GL_CLAMP_TO_EDGE);
  glTexImage2D(GL_TEXTURE_2D, 0, GL_RGBA8, texture_data_.size(), 1, 0, GL_BGRA, GL_UNSIGNED_BYTE,
      &texture_data_[0]);

  is_opengl_inited = true;
}

}  // namespace forge
}  // namespace sbat