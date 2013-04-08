#ifndef SHARED_FUNC_HOOK_H_
#define SHARED_FUNC_HOOK_H_

#include <array>
#include <Windows.h>
#include "./types.h"

namespace sbat {
// Type for simpler VirtualProtect -> restore old protection usage.
class ScopedVirtualProtect {
public:
  ScopedVirtualProtect(void* address, size_t size, uint32 new_protection)
      : address_(address),
        size_(size),
        old_protection_(0),
        has_errors_(false) {
    has_errors_ = VirtualProtect(address_, size_, new_protection,
        reinterpret_cast<PDWORD>(&old_protection_)) == 0;
  }

  ~ScopedVirtualProtect() {
    VirtualProtect(address_, size_, old_protection_, reinterpret_cast<PDWORD>(&old_protection_));
  }

  bool has_errors() const {
    return has_errors_;
  }
private:
  void* address_;
  size_t size_;
  uint32 old_protection_;
  bool has_errors_;
};

// Type for hooking a function at a specific memory location, with methods for replacing and
// restoring the original code. Function pointer type is specified by F, to allow for hooks of
// varying parameter lists.
template<typename F>
class FuncHook {
public:
  FuncHook(F func, F hook_func)
      : callable_(func),
        hook_func_(hook_func),
        function_(reinterpret_cast<byte*>(func)),
        original_mem_(),
        hooked_mem_(),
        injected_(false) {
    LoadFunctionMemory();
  }

  ~FuncHook() {
    if (injected_) {
      Restore();
    }
  }

  bool Inject() {
    if (injected_) return false;

    ScopedVirtualProtect protect(function_, original_mem_.size(), PAGE_EXECUTE_READWRITE);
    if (protect.has_errors()) return false;

    for (size_t i = 0; i < hooked_mem_.size(); i++) {
      function_[i] = hooked_mem_[i];
    }
    injected_ = true;
    return true;
  }

  bool Restore() {
    if (!injected_) return false;

    ScopedVirtualProtect protect(function_, original_mem_.size(), PAGE_EXECUTE_READWRITE);
    if (protect.has_errors()) return false;

    for (size_t i = 0; i < original_mem_.size(); i++) {
      function_[i] = original_mem_[i];
    }
    injected_ = false;
    return true;
  }

  F callable() const {
    return callable_;
  }

private:
  void LoadFunctionMemory() {
    ScopedVirtualProtect protect(function_, original_mem_.size(), PAGE_EXECUTE_READ);

    // get a pointer to the address pointer at the second byte of hooked_mem_ (param for push)
    F* ret_target_ptr = reinterpret_cast<F*>(&hooked_mem_[1]);
    *ret_target_ptr = hook_func_;  // set parameter of push to the address of our hook function
    hooked_mem_[0] = 0x68;  // push (address provided through hookFunc)
    hooked_mem_[5] = 0xc3;  // return

    for (size_t i = 0; i < original_mem_.size(); i++) {
      original_mem_[i] = function_[i];
    }
  }

  F callable_;
  F hook_func_;
  byte* function_;
  std::array<byte,6> original_mem_;
  std::array<byte,6> hooked_mem_;
  bool injected_;
};
}  // namespace sbat
#endif  // SHARED_FUNC_HOOK_H_