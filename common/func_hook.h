#ifndef COMMON_FUNC_HOOK_H_
#define COMMON_FUNC_HOOK_H_

#include <Windows.h>
#include <array>
#include <vector>

#include "./types.h"
#include "./win_helpers.h"

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

  // TODO(tec27): This should probably update its original memory directly on hooking, so that its
  // more amenable to things hooking the same locations. On the other hand, fuck it, JS everything!
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

enum class RegisterArgument : byte {
  Eax = 0x50,
  Ecx,
  Edx,
  Ebx,
  Esp,  // note that ESP will not be the same as it was prior to the trampoline
  Ebp,
  Esi,
  Edi
};

enum class RunOriginalCodeType {
  After = 0,
  Before,
  Never
};

// Type for hooking in the middle of a function (e.g. if you only want to have your hook fire some
// of the time when a function is called, or you want to capture some in-function state in it. These
// sorts of hooks do not require you to restore on each call to get the original functionality, and
// instead reproduce the overwritten opcodes in a trampoline.
class Detour {
  typedef void (__stdcall* DetourTarget)();
public:
  class Builder {
    friend class Detour;

  public:
    Builder();

    Builder& SetHookLocation(byte* hook_location);
    Builder& SetHookLocation(uint32 hook_location);
    Builder& SetHookLocation(void* hook_location);

    Builder& SetTargetFunction(DetourTarget target_function);
    Builder& SetTargetFunction(void* target_function);

    Builder& AddArgument(RegisterArgument argument);

    Builder& RunOriginalCodeAfter();
    Builder& RunOriginalCodeBefore();
    Builder& DontRunOriginalCode();
  private:
    byte* hook_location_;
    DetourTarget target_;
    std::vector<RegisterArgument> arguments_;
    RunOriginalCodeType run_original_;
  };

  explicit Detour(const Builder& builder);
  ~Detour();

  bool Inject();
  bool Restore();

private:
  Detour(const Detour&);
  Detour& operator=(const Detour&);

  byte* hook_location_;
  uint32 hook_size_;
  byte* trampoline_;
  byte* original_;
  byte* hooked_;
  bool injected_;

  static const byte TRAMPOLINE_PREAMBLE[];
  static const byte TRAMPOLINE_POSTSCRIPT[];
};
}  // namespace sbat
#endif  // COMMON_FUNC_HOOK_H_
