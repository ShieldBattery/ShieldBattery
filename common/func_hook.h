#ifndef COMMON_FUNC_HOOK_H_
#define COMMON_FUNC_HOOK_H_

#include <array>
#include <Windows.h>
#include "common/types.h"
#include "common/win_helpers.h"

namespace sbat {
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
  std::array<byte, 6> original_mem_;
  std::array<byte, 6> hooked_mem_;
  bool injected_;
};
}  // namespace sbat
#endif  // COMMON_FUNC_HOOK_H_