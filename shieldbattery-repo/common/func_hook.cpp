#include "common/func_hook.h"

#include <assert.h>
#include <udis86.h>
#include <Windows.h>
#include <algorithm>
#include <memory>
#include <string>
#include <vector>

#include "common/types.h"
#include "common/win_helpers.h"

namespace sbat {
using std::shared_ptr;
using std::string;
using std::vector;

Detour::Builder::Builder()
  : hook_location_(nullptr),
    target_(nullptr),
    arguments_(),
    run_original_(RunOriginalCodeType::After) {
}

Detour::Builder& Detour::Builder::At(byte* hook_location) {
  hook_location_ = hook_location;
  return *this;
}

Detour::Builder& Detour::Builder::At(uint32 hook_location) {
  return At(reinterpret_cast<byte*>(hook_location));
}

Detour::Builder& Detour::Builder::At(void* hook_location) {
  return At(reinterpret_cast<byte*>(hook_location));
}

Detour::Builder& Detour::Builder::To(Detour::DetourTarget target_function) {
  target_ = target_function;
  return *this;
}

Detour::Builder& Detour::Builder::To(void* target_function) {
  return To(reinterpret_cast<DetourTarget>(target_function));
}

Detour::Builder& Detour::Builder::WithArgument(RegisterArgument argument) {
  arguments_.push_back(argument);
  return *this;
}

Detour::Builder& Detour::Builder::RunningOriginalCodeAfter() {
  run_original_ = RunOriginalCodeType::After;
  return *this;
}

Detour::Builder& Detour::Builder::RunningOriginalCodeBefore() {
  run_original_ = RunOriginalCodeType::Before;
  return *this;
}

Detour::Builder& Detour::Builder::NotRunningOriginalCode() {
  run_original_ = RunOriginalCodeType::Never;
  return *this;
}

const byte Detour::TRAMPOLINE_PREAMBLE[] = {
  0x60  // PUSHAD
};
const byte Detour::TRAMPOLINE_POSTSCRIPT[] = {
  0x61  // POPAD
};

int32 GetRewrittenInstructionLength(ud_mnemonic_code code, uint32 current_len) {
  switch (code) {
    case UD_Ijo:
    case UD_Ijno:
    case UD_Ijb:
    case UD_Ijae:
    case UD_Ijz:
    case UD_Ijnz:
    case UD_Ijbe:
    case UD_Ija:
    case UD_Ijs:
    case UD_Ijns:
    case UD_Ijp:
    case UD_Ijnp:
    case UD_Ijl:
    case UD_Ijge:
    case UD_Ijle:
    case UD_Ijg:
      return 6;  // 0F XX YY YY YY YY
    case UD_Ijmp:
    case UD_Icall:
      return 5;  // XX YY YY YY YY
    default:
      return current_len;
  }
}

uint32 ConstructRelativeOpcode(ud_mnemonic_code code, uint32 pc, uint32 instruction_len,
    const ud_operand_t* operand, byte* output) {
  int32 orig_offset;
  switch (operand->size) {
  case 8:
    orig_offset = static_cast<int32>(operand->lval.sbyte);
    break;
  case 16:
    orig_offset = static_cast<int32>(operand->lval.sword);
    break;
  case 32:
    orig_offset = operand->lval.sdword;
    break;
  default:
    // a jump/call relative offset should never exceed 32 bits
    assert(false);
    return -1;
  }

  int64 orig_target = static_cast<int64>(
    static_cast<int32>(pc + instruction_len) + orig_offset);
  int32 new_instruction_len = GetRewrittenInstructionLength(code, instruction_len);
  int32 new_offset = static_cast<int32>(orig_target -
      static_cast<int64>(reinterpret_cast<uint32>(output) + new_instruction_len));

  uint32 pos = 0;
  // write the new opcode
  switch (code) {
    case UD_Ijo: output[pos++] = 0x0F; output[pos++] = 0x80; break;
    case UD_Ijno: output[pos++] = 0x0F; output[pos++] = 0x81; break;
    case UD_Ijb: output[pos++] = 0x0F; output[pos++] = 0x82; break;
    case UD_Ijae: output[pos++] = 0x0F; output[pos++] = 0x83; break;
    case UD_Ijz: output[pos++] = 0x0F; output[pos++] = 0x84; break;
    case UD_Ijnz: output[pos++] = 0x0F; output[pos++] = 0x85; break;
    case UD_Ijbe: output[pos++] = 0x0F; output[pos++] = 0x86; break;
    case UD_Ija: output[pos++] = 0x0F; output[pos++] = 0x87; break;
    case UD_Ijs: output[pos++] = 0x0F; output[pos++] = 0x88; break;
    case UD_Ijns: output[pos++] = 0x0F; output[pos++] = 0x89; break;
    case UD_Ijp: output[pos++] = 0x0F; output[pos++] = 0x8A; break;
    case UD_Ijnp: output[pos++] = 0x0F; output[pos++] = 0x8B; break;
    case UD_Ijl: output[pos++] = 0x0F; output[pos++] = 0x8C; break;
    case UD_Ijge: output[pos++] = 0x0F; output[pos++] = 0x8D; break;
    case UD_Ijle: output[pos++] = 0x0F; output[pos++] = 0x8E; break;
    case UD_Ijg: output[pos++] = 0x0F; output[pos++] = 0x8F; break;
    case UD_Ijmp: output[pos++] = 0xE9; break;
    case UD_Icall: output[pos++] = 0xE8; break;
    default:
      assert(false);  // no other opcodes should be found in calls to this
      return -1;
  }

  *(reinterpret_cast<int32*>(&output[pos])) = new_offset;
  pos += 4;
  assert(pos == new_instruction_len);
  return new_instruction_len;
}

void ReplaceRelativeOffsets(byte* hook_location, uint32 hook_size, byte* output,
    uint32 output_size) {
  ud_t udis;
  ud_init(&udis);
  ud_set_mode(&udis, 32);
  ud_set_syntax(&udis, NULL);
  ud_set_input_buffer(&udis, hook_location, 20);
  ud_set_pc(&udis, static_cast<uint64_t>(reinterpret_cast<uint32>(hook_location)));

  const ud_operand_t* operand;
  uint32 i = 0;
  uint32 pos = 0;
  do {
    i += ud_disassemble(&udis);
    switch (udis.mnemonic) {
    case UD_Ijo:
    case UD_Ijno:
    case UD_Ijb:
    case UD_Ijae:
    case UD_Ijz:
    case UD_Ijnz:
    case UD_Ijbe:
    case UD_Ija:
    case UD_Ijs:
    case UD_Ijns:
    case UD_Ijp:
    case UD_Ijnp:
    case UD_Ijl:
    case UD_Ijge:
    case UD_Ijle:
    case UD_Ijg:
    case UD_Ijmp:
    case UD_Icall:
      operand = ud_insn_opr(&udis, 0);
      if (operand != nullptr && operand->type == UD_OP_JIMM) {
        pos += ConstructRelativeOpcode(udis.mnemonic, static_cast<uint32>(ud_insn_off(&udis)),
            ud_insn_len(&udis), operand, &output[pos]);
        break;
      }
      // haven't implemented register handling yet, so better to crash in these cases instead of
      // failing in weird ways later on
      assert(operand == nullptr || operand->type != UD_OP_REG);

      // if it wasn't relative/register, continue on and just copy it over as any other opcode
    default:  // not a relative instruction, no correction needed
      byte* instruction_ptr = reinterpret_cast<byte*>(ud_insn_off(&udis));
      std::copy(instruction_ptr, instruction_ptr + ud_insn_len(&udis),
          &output[pos]);
      pos += ud_insn_len(&udis);
      break;
    }
  } while (i < hook_size);
  assert(pos == output_size);
}

uint32 Detour::page_size_ = 0;
shared_ptr<Detour::AllocBlock> Detour::current_block_ = shared_ptr<Detour::AllocBlock>();

Detour::AllocBlock::AllocBlock()
  : block_start_(nullptr),
    pos_(nullptr) {
  if (page_size_ == 0) {
    SYSTEM_INFO info;
    GetSystemInfo(&info);
    page_size_ = info.dwPageSize;
  }
  block_start_ = pos_ = VirtualAlloc(nullptr, page_size_, MEM_COMMIT, PAGE_EXECUTE_READWRITE);
}

Detour::AllocBlock::~AllocBlock() {
  VirtualFree(block_start_, 0, MEM_RELEASE);
}

uint32 Detour::AllocBlock::GetBytesLeft() {
  return page_size_ - (reinterpret_cast<byte*>(pos_) - reinterpret_cast<byte*>(block_start_));
}

shared_ptr<Detour::AllocBlock> Detour::AllocSpace(size_t trampoline_size) {
  if (!current_block_ || current_block_->GetBytesLeft() < trampoline_size) {
    current_block_.reset(new AllocBlock());
  }

  return current_block_;
}

Detour::Detour(const Detour::Builder& builder)
  : hook_location_(builder.hook_location_),
    hook_size_(0),
    trampoline_block_(nullptr),
    original_(nullptr),
    hooked_(nullptr),
    injected_(false) {
  assert(builder.hook_location_ != nullptr);
  assert(builder.target_ != nullptr);

  ud_t udis;
  ud_init(&udis);
  ud_set_mode(&udis, 32);
  ud_set_syntax(&udis, NULL);  // we don't care about readable output!
  // According to http://blog.onlinedisassembler.com/blog/?p=23, modern day implementations throw a
  // general protection fault at any instructions > 15 bytes, so 20 bytes (4 byte instruction
  // followed by at 15 byte instruction = 19 bytes) should be safe here
  ud_set_input_buffer(&udis, hook_location_, 20);
  ud_set_pc(&udis, static_cast<uint64_t>(reinterpret_cast<uint32>(hook_location_)));
  size_t replaced_size = 0;

  // we do 2 passes:
  // first we figure out how big the trampoline needs to be, then iterate back over the opcodes
  // we're replacing and rewrite any relative offsets. The second pass happens only if we want to
  // run the original code, and only when we go to write it into the trampoline
  uint32 instruction_size;
  do {
    instruction_size = ud_disassemble(&udis);
    hook_size_ += instruction_size;
    replaced_size += GetRewrittenInstructionLength(udis.mnemonic, instruction_size);
  } while (hook_size_ < 5 && instruction_size != 0);
  assert(hook_size_ >= 5);

  // Allocate our trampoline
  size_t trampoline_size = sizeof(Detour::TRAMPOLINE_PREAMBLE) +
      sizeof(Detour::TRAMPOLINE_POSTSCRIPT) +
      1 + sizeof(int32) +  // jmp <after_hook>  NOLINT
      1 + sizeof(int32) +  // call <target>  NOLINT
      builder.arguments_.size() +  // push for each register
      (builder.run_original_ != RunOriginalCodeType::Never ? replaced_size : 0);
  trampoline_block_ = AllocSpace(trampoline_size);
  byte* trampoline = reinterpret_cast<byte*>(trampoline_block_->pos_);
  trampoline_block_->pos_ = reinterpret_cast<byte*>(trampoline_block_->pos_) + trampoline_size;

  original_.reset(new byte[hook_size_]);
  hooked_.reset(new byte[hook_size_]);
  memcpy_s(original_.get(), hook_size_, hook_location_, hook_size_);
  if (hook_size_ > 5) {
    memset(hooked_.get() + 5, 0x90, hook_size_ - 5);  // fill with NOPs to account for extra bytes
  }
  hooked_.get()[0] = 0xE9;  // relative jump
  *(reinterpret_cast<int32*>(&hooked_.get()[1])) =  // offset from end of command
      reinterpret_cast<int32>(trampoline) - (reinterpret_cast<int32>(hook_location_) + 5);

  uint32 pos = 0;
  // add the original code if we are meant to run it before
  if (builder.run_original_ == RunOriginalCodeType::Before) {
    ReplaceRelativeOffsets(hook_location_, hook_size_, &trampoline[pos], replaced_size);
    pos += replaced_size;
  }

  // copy in our trampoline preamble
  memcpy_s(&trampoline[pos], trampoline_size - pos, Detour::TRAMPOLINE_PREAMBLE,
      sizeof(Detour::TRAMPOLINE_PREAMBLE));
  pos += sizeof(Detour::TRAMPOLINE_PREAMBLE);

  // add any necessary PUSH instructions for our arguments; handily they have values equal to their
  // PUSH opcode
  for (auto it = builder.arguments_.rbegin(); it != builder.arguments_.rend(); ++it) {
    trampoline[pos++] = static_cast<byte>(*it);
  }

  // generate the call code
#pragma warning(suppress: 6386)
  trampoline[pos] = 0xE8;  // relative call
  *(reinterpret_cast<int32*>(&trampoline[pos+1])) =  // offset from end of command
      reinterpret_cast<int32>(builder.target_) - (reinterpret_cast<int32>(&trampoline[pos]) + 5);
  pos += 5;

  // copy in our trampoline postscript
  memcpy_s(&trampoline[pos], trampoline_size - pos, Detour::TRAMPOLINE_POSTSCRIPT,
      sizeof(Detour::TRAMPOLINE_POSTSCRIPT));
  pos += sizeof(Detour::TRAMPOLINE_POSTSCRIPT);

  // add the original code if we are meant to run it after
  if (builder.run_original_ == RunOriginalCodeType::After) {
    ReplaceRelativeOffsets(hook_location_, hook_size_, &trampoline[pos], replaced_size);
    pos += replaced_size;
  }

  // jmp to after the hook spot
  trampoline[pos] = 0xE9;  // relative jmp
  *(reinterpret_cast<int32*>(&trampoline[pos+1])) =  // offset from end of command
      (reinterpret_cast<int32>(hook_location_) + hook_size_) -
      (reinterpret_cast<int32>(&trampoline[pos]) + 5);
  pos += 5;

  assert(pos == trampoline_size);
  // TODO(tec27): ideally we'd be able to pass VirtualProtect errors out of here, not quite sure the
  // best way atm
}

Detour::~Detour() {
  if (injected_) {
    Restore();
  }
}

bool Detour::Inject() {
  if (injected_) {
    return false;
  }

  ScopedVirtualProtect protect(hook_location_, hook_size_, PAGE_EXECUTE_READWRITE);
  if (protect.has_errors()) {
    return false;
  }

  memcpy_s(hook_location_, hook_size_, hooked_.get(), hook_size_);
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

  memcpy_s(hook_location_, hook_size_, original_.get(), hook_size_);
  injected_ = false;
  return true;
}

HookedModule::HookedModule(HMODULE module_handle)
  : module_handle_(module_handle),
    injected_(false),
    hooks_() {
}

HookedModule::~HookedModule() {
}

bool HookedModule::Inject() {
  bool result = true;
  for (const auto& hook : hooks_) {
    result &= hook->Inject();
  }
  injected_ = true;
  return result;
}

bool HookedModule::Restore() {
  bool result = true;
  for (const auto& hook : hooks_) {
    result &= hook->Restore();
  }
  injected_ = false;
  return result;
}

}  // namespace sbat