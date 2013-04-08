#include "./win_helpers.h"

#include <Windows.h>
#include "./types.h"

namespace sbat {
ScopedVirtualProtect::ScopedVirtualProtect(void* address, size_t size, uint32 new_protection)
    : address_(address),
      size_(size),
      old_protection_(0),
      has_errors_(false) {
  has_errors_ = VirtualProtect(address_, size_, new_protection,
      reinterpret_cast<PDWORD>(&old_protection_)) == 0;
}

ScopedVirtualProtect::~ScopedVirtualProtect() {
  if (!has_errors_) {
    VirtualProtect(address_, size_, old_protection_, reinterpret_cast<PDWORD>(&old_protection_));
  }
}

bool ScopedVirtualProtect::has_errors() const {
  return has_errors_;
}
}  // namespace sbat