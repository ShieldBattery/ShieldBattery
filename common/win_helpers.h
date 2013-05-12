#ifndef COMMON_WIN_HELPERS_H_
#define COMMON_WIN_HELPERS_H_

#include <Windows.h>
#include "common/types.h"

// Helper Types/Functions for Windows things, to make them easier/safer to use

namespace sbat {
// Type for simpler VirtualProtect -> restore old protection usage.
class ScopedVirtualProtect {
public:
  ScopedVirtualProtect(void* address, size_t size, uint32 new_protection);
  ~ScopedVirtualProtect();
  bool has_errors() const;
private:
  void* address_;
  size_t size_;
  uint32 old_protection_;
  bool has_errors_;
};
}  // namespace sbat
#endif  // COMMON_WIN_HELPERS_H_