#include "common/func_hook.h"

#include <assert.h>
#include <udis86.h>
#include <Windows.h>
#include <array>

#include "common/types.h"
#include "common/win_helpers.h"

namespace sbat {
Detour::Builder::Builder()
  : hook_location_(nullptr),
    target_(nullptr),
    arguments_(),
    run_original_(RunOriginalCodeType::After) {
}

Detour::Builder& Detour::Builder::SetHookLocation(byte* hook_location) {
  hook_location_ = hook_location;
  return *this;
}

Detour::Builder& Detour::Builder::SetHookLocation(uint32 hook_location) {
  return SetHookLocation(reinterpret_cast<byte*>(hook_location));
}

Detour::Builder& Detour::Builder::SetHookLocation(void* hook_location) {
  return SetHookLocation(reinterpret_cast<byte*>(hook_location));
}

Detour::Builder& Detour::Builder::SetTargetFunction(Detour::DetourTarget target_function) {
  target_ = target_function;
  return *this;
}

Detour::Builder& Detour::Builder::SetTargetFunction(void* target_function) {
  return SetTargetFunction(reinterpret_cast<DetourTarget>(target_function));
}

Detour::Builder& Detour::Builder::AddArgument(RegisterArgument argument) {
  arguments_.push_back(argument);
  return *this;
}

Detour::Builder& Detour::Builder::RunOriginalCodeAfter() {
  run_original_ = RunOriginalCodeType::After;
  return *this;
}

Detour::Builder& Detour::Builder::RunOriginalCodeBefore() {
  run_original_ = RunOriginalCodeType::Before;
  return *this;
}

Detour::Builder& Detour::Builder::DontRunOriginalCode() {
  run_original_ = RunOriginalCodeType::Never;
  return *this;
}

const byte Detour::TRAMPOLINE_PREAMBLE[] = {
  0x60  // PUSHAD
};
const byte Detour::TRAMPOLINE_POSTSCRIPT[] = {
  0x61  // POPAD
};

Detour::Detour(const Detour::Builder& builder)
  : hook_location_(builder.hook_location_),
    hook_size_(0),
    trampoline_(nullptr),
    original_(nullptr),
    hooked_(nullptr),
    injected_(false) {
  assert(builder.hook_location_ != nullptr);
  assert(builder.target_ != nullptr);

  ud_t udis;
  ud_init(&udis);
  ud_set_mode(&udis, 32);
  ud_set_syntax(&udis, NULL);  // we don't care about readable output!
  // According to http://onlinedisassembler.com/blog/?p=23, modern day implementations throw a
  // general protection fault at any instructions > 15 bytes, so 20 bytes (4 byte instruction
  // followed by at 15 byte instruction = 19 bytes) should be safe here
  ud_set_input_buffer(&udis, hook_location_, 20);
  ud_set_pc(&udis, static_cast<uint64_t>(reinterpret_cast<uint32>(hook_location_)));

  uint32 instruction_size;
  do {
    instruction_size = ud_disassemble(&udis);
    hook_size_ += instruction_size;
  } while (hook_size_ < 5 && instruction_size != 0);
  assert(hook_size_ >= 5);

  size_t trampoline_size = sizeof(Detour::TRAMPOLINE_PREAMBLE) +
      sizeof(Detour::TRAMPOLINE_POSTSCRIPT) +
      1 + sizeof(int32) +  // jmp <after_hook>  NOLINT
      1 + sizeof(int32) +  // call <target>  NOLINT
      builder.arguments_.size() +  // push for each register
      (builder.run_original_ != RunOriginalCodeType::Never ? hook_size_ : 0);
  trampoline_ = reinterpret_cast<byte*>(  // have to use VirtualAlloc so that we can execute on it
      VirtualAlloc(NULL, trampoline_size, MEM_COMMIT, PAGE_EXECUTE_READWRITE));

  original_ = new byte[hook_size_];
  hooked_ = new byte[hook_size_];
  memcpy_s(original_, hook_size_, hook_location_, hook_size_);
  if (hook_size_ > 5) {
    memset(hooked_ + 5, 0x90, hook_size_ - 5);  // fill with NOPs to account for extra bytes
  }
  hooked_[0] = 0xE9;  // relative jump
  *(reinterpret_cast<int32*>(&hooked_[1])) =  // offset from end of command
      reinterpret_cast<int32>(trampoline_) - (reinterpret_cast<int32>(hook_location_) + 5);

  uint32 pos = 0;
  // add the original code if we are meant to run it before
  if (builder.run_original_ == RunOriginalCodeType::Before) {
    memcpy_s(&trampoline_[pos], trampoline_size - pos, original_, hook_size_);
    pos += hook_size_;
  }

  // copy in our trampoline preamble
  memcpy_s(&trampoline_[pos], trampoline_size - pos, Detour::TRAMPOLINE_PREAMBLE,
      sizeof(Detour::TRAMPOLINE_PREAMBLE));
  pos += sizeof(Detour::TRAMPOLINE_PREAMBLE);

  // add any necessary PUSH instructions for our arguments; handily they have values equal to their
  // PUSH opcode
  for (auto it = builder.arguments_.rbegin(); it != builder.arguments_.rend(); ++it) {
    trampoline_[pos++] = static_cast<byte>(*it);
  }

  // generate the call code
#pragma warning(suppress: 6386)
  trampoline_[pos] = 0xE8;  // relative call
  *(reinterpret_cast<int32*>(&trampoline_[pos+1])) =  // offset from end of command
      reinterpret_cast<int32>(builder.target_) - (reinterpret_cast<int32>(&trampoline_[pos]) + 5);
  pos += 5;

  // copy in our trampoline postscript
  memcpy_s(&trampoline_[pos], trampoline_size - pos, Detour::TRAMPOLINE_POSTSCRIPT,
      sizeof(Detour::TRAMPOLINE_POSTSCRIPT));
  pos += sizeof(Detour::TRAMPOLINE_POSTSCRIPT);

  // add the original code if we are meant to run it after
  if (builder.run_original_ == RunOriginalCodeType::After) {
    memcpy_s(&trampoline_[pos], trampoline_size - pos, original_, hook_size_);
    pos += hook_size_;
  }

  // jmp to after the hook spot
  trampoline_[pos] = 0xE9;  // relative jmp
  *(reinterpret_cast<int32*>(&trampoline_[pos+1])) =  // offset from end of command
      (reinterpret_cast<int32>(hook_location_) + hook_size_) -
      (reinterpret_cast<int32>(&trampoline_[pos]) + 5);
  pos += 5;

  assert(pos == trampoline_size);
  // TODO(tec27): ideally we'd be able to pass VirtualProtect errors out of here, not quite sure the
  // best way atm
}

Detour::~Detour() {
  if (injected_) {
    Restore();
  }

  if (trampoline_ != nullptr) {
    VirtualFree(trampoline_, 0, MEM_RELEASE);
    trampoline_ = nullptr;
  }
  delete original_;
  original_ = nullptr;
  delete hooked_;
  hooked_ = nullptr;
}

bool Detour::Inject() {
  if (injected_) {
    return false;
  }

  ScopedVirtualProtect protect(hook_location_, hook_size_, PAGE_EXECUTE_READWRITE);
  if (protect.has_errors()) {
    return false;
  }

  memcpy_s(hook_location_, hook_size_, hooked_, hook_size_);
  injected_ = true;
  return true;
}

bool Detour::Restore() {
  if (!injected_) {
    return false;
  }

  ScopedVirtualProtect protect(hook_location_, hook_size_, PAGE_EXECUTE_READWRITE);
  if (protect.has_errors()) {
    return false;
  }

  memcpy_s(hook_location_, hook_size_, original_, hook_size_);
  injected_ = false;
  return true;
}

}  // namespace sbat