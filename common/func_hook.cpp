#include "common/func_hook.h"

#include <array>
#include <Windows.h>
#include "common/types.h"
#include "common/win_helpers.h"

namespace sbat {
MidHook::MidHook(void* hook_location, MidHookTarget target)
    : hook_location_(reinterpret_cast<byte*>(hook_location)),
      target_(target),
      trampoline_(),
      trampoline_protect_(&trampoline_, sizeof(trampoline_), PAGE_EXECUTE_READWRITE),
      original_mem_(),
      hooked_mem_(),
      injected_(false) {
  SetupHook();
}

MidHook::~MidHook() {
  if (injected_) {
    Restore();
  }
}

bool MidHook::Inject() {
  if (injected_) return false;

  ScopedVirtualProtect protect(hook_location_, original_mem_.size(), PAGE_EXECUTE_READWRITE);
  if (protect.has_errors()) return false;

  for (size_t i = 0; i < hooked_mem_.size(); i++) {
    hook_location_[i] = hooked_mem_[i];
  }
  injected_ = true;
  return true;
}

bool MidHook::Restore() {
  if (!injected_) return false;

  ScopedVirtualProtect protect(hook_location_, original_mem_.size(), PAGE_EXECUTE_READWRITE);
  if (protect.has_errors()) return false;

  for (size_t i = 0; i < original_mem_.size(); i++) {
    hook_location_[i] = original_mem_[i];
  }
  injected_ = false;
  return true;
}

void MidHook::SetupHook() {
  trampoline_.pushad = 0x60;
  trampoline_.call = 0xE8;
  trampoline_.offset =
      reinterpret_cast<byte*>(&trampoline_.offset) - reinterpret_cast<byte*>(target_);
  trampoline_.popad = 0x61;
  trampoline_.retn = 0xC3;

  for (size_t i = 0; i < original_mem_.size(); i++) {
    original_mem_[i] = hook_location_[i];
  }

  hooked_mem_[0] = 0xE8; // call
  int32* hook_offset = reinterpret_cast<int32*>(&hooked_mem_[1]);
  *hook_offset = hook_location_ - reinterpret_cast<byte*>(&trampoline_);
}

}  // namespace sbat
