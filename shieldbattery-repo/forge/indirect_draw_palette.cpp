#include "forge/indirect_draw.h"

#include <array>
#include <algorithm>

#include "logger/logger.h"

namespace sbat {
namespace forge {

using std::array;

IndirectDrawPalette::IndirectDrawPalette(IndirectDraw* owner, DWORD flags,
    PALETTEENTRY* color_array)
    : owner_(owner),
      refcount_(1),
      entries_() {
  // BW calls this initially with DDPCAPS_8BIT (8-bit entries) and DDPCAPS_ALLOW256 (allow all 256
  // entries to be defined). To make things simple, we will only accept those values
  assert(flags == (DDPCAPS_8BIT | DDPCAPS_ALLOW256));
  owner_->AddRef();
  std::copy(&color_array[0], &color_array[entries_.size()], entries_.begin());
}

IndirectDrawPalette::~IndirectDrawPalette() {
  owner_->Release();
}

HRESULT WINAPI IndirectDrawPalette::QueryInterface(REFIID riid, void** obj_out) {
  if (DIRECTDRAWLOG) {
    Logger::Log(LogLevel::Verbose, "IndirectDrawPalette::QueryInterface called");
  }

  *obj_out = nullptr;
  return DDERR_UNSUPPORTED;
}

ULONG WINAPI IndirectDrawPalette::AddRef() {
  if (DIRECTDRAWLOG) {
    Logger::Log(LogLevel::Verbose, "IndirectDrawPalette::AddRef called");
  }

  refcount_++;
  return refcount_;
}

ULONG WINAPI IndirectDrawPalette::Release() {
  if (DIRECTDRAWLOG) {
    Logger::Log(LogLevel::Verbose, "IndirectDrawPalette::Release called");
  }
  refcount_--;
  if (refcount_ <= 0) {
    delete this;
    return 0;
  } else {
    return refcount_;
  }
}

HRESULT WINAPI IndirectDrawPalette::GetCaps(DWORD* caps) {
  if (DIRECTDRAWLOG) {
    Logger::Log(LogLevel::Verbose, "IndirectDrawPalette::GetCaps called");
  }
  // we assert above what the caps are, so we can just return those here
  *caps = DDPCAPS_8BIT | DDPCAPS_ALLOW256;
  return DD_OK;
}

HRESULT WINAPI IndirectDrawPalette::GetEntries(DWORD unused, DWORD start, DWORD count,
    PALETTEENTRY* palette_out) {
  if (DIRECTDRAWLOG) {
    Logger::Logf(LogLevel::Verbose,
        "IndirectDrawPalette::GetEntries called with start: %d, count: %d", start, count);
  }
  assert(start >= 0);
  assert(count > 0);
  assert(start + count <= entries_.size());

  std::copy(entries_.begin() + start, entries_.begin() + count, palette_out);
  return DD_OK;
}

HRESULT WINAPI IndirectDrawPalette::Initialize(IDirectDraw* owner, DWORD flags,
    PALETTEENTRY* color_array) {
  if (DIRECTDRAWLOG) {
    Logger::Log(LogLevel::Verbose, "IndirectDrawPalette::Initialize called");
  }
  return DDERR_ALREADYINITIALIZED;  // this is how this is meant to work, apparently.
}

HRESULT WINAPI IndirectDrawPalette::SetEntries(DWORD unused, DWORD start, DWORD count,
    PALETTEENTRY* entries) {
  if (DIRECTDRAWLOG) {
    Logger::Logf(LogLevel::Verbose,
        "IndirectDrawPalette::SetEntries called with start: %d, count: %d", start, count);
  }
  assert(start >= 0);
  assert(count > 0);
  assert(start + count <= entries_.size());

  std::copy(&entries[0], &entries[count], entries_.begin() + start);

  owner_->UpdatePalette(*this);
  return DD_OK;
}

}  // namespace forge
}  // namespace sbat