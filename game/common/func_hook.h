#pragma once

#include <Windows.h>
#include <array>
#include <memory>
#include <vector>
#include <string>
#include <assert.h>

#include "common/types.h"
#include "common/win_helpers.h"

namespace sbat {

// Implementation details which need to be exposed for the template code :l
struct InstructionSizes {
  uintptr_t hook_size;
  uintptr_t replaced_size;
};
void ReplaceRelativeOffsets(byte* hook_location, uint32 hook_size, byte* output,
    uint32 output_size);
InstructionSizes CountInstructionSizes(byte* position, size_t min_length);

// Types that are excepted to be passed as FuncHook::InitCustom template parameters to
// define the calling convention.
namespace hook_registers {
#define REGISTER(name, num, preserved) \
  struct name { \
    static bool IsStack() { \
      return false; \
    } \
    static void WritePush(std::vector<byte>* buf, uintptr_t stack_pos) { \
      buf->push_back(0x50 + num); \
    } \
    static intptr_t WritePushPopIfPreserved(std::vector<byte>* buf, bool pop) { \
      if (!preserved) { \
        return 0; \
      } else if (pop) { \
        buf->push_back(0x58 + num); \
        return -4; \
      } else { \
        buf->push_back(0x50 + num); \
        return 4; \
      } \
    } \
    static void WriteMoveFromStack(std::vector<byte>* buf, uintptr_t stack_pos) { \
      assert(stack_pos < 0x80); \
      buf->push_back(0x8b); \
      buf->push_back(0x44 + num * 8); \
      buf->push_back(0xe4); \
      buf->push_back(stack_pos); \
    } \
  };

REGISTER(Eax, 0, false);
REGISTER(Ecx, 1, false);
REGISTER(Edx, 2, false);
REGISTER(Ebx, 3, true);
REGISTER(Ebp, 5, true);
REGISTER(Esi, 6, true);
REGISTER(Edi, 7, true);
#undef REGISTER
  struct Stack {
    static bool IsStack() {
      return true;
    }

    static void WritePush(std::vector<byte>* buf, uintptr_t stack_pos) {
      // Needs different instruction if larger stack_pos would ever happen
      assert(stack_pos < 0x80);
      buf->push_back(0xff);
      buf->push_back(0x74);
      buf->push_back(0xe4);
      buf->push_back(stack_pos);
    }

    static intptr_t WritePushPopIfPreserved(std::vector<byte>* buf, bool pop) {
      return 0;
    }

    static void WriteMoveFromStack(std::vector<byte>* buf, uintptr_t stack_pos) {
      WritePush(buf, stack_pos);
    }
  };
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

class ExecutableMemory {
public:
  ExecutableMemory() : block_(nullptr), pointer_(nullptr), size_(0) { }
  static ExecutableMemory Allocate(size_t size);

  byte& operator[](size_t offset) const {
    // Add a bit of overflow checking... Not too reliable though as the reference is just
    // recast to pointer at some places.
    assert(offset < size_);
    return pointer_[offset];
  }

private:
  class Block {
  public:
    Block();
    ~Block();
    uintptr_t GetBytesLeft();

    byte* block_start_;
    byte* pos_;
    static uintptr_t page_size_;
  };

  ExecutableMemory(std::shared_ptr<Block> block, byte* pos, size_t size)
      : block_(std::move(block)),
        pointer_(pos),
        size_(size) {
  }
  std::shared_ptr<Block> block_;
  byte* pointer_;
  size_t size_;

  static thread_local std::shared_ptr<Block> current_block_;
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

    Builder& At(byte* hook_location);
    Builder& At(uint32 hook_location);
    Builder& At(void* hook_location);

    Builder& To(DetourTarget target_function);
    Builder& To(void* target_function);

    Builder& WithArgument(RegisterArgument argument);

    Builder& RunningOriginalCodeAfter();
    Builder& RunningOriginalCodeBefore();
    Builder& NotRunningOriginalCode();
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
  // disallow copying
  Detour(const Detour&) = delete;
  Detour& operator=(const Detour&) = delete;

  byte* hook_location_;
  uint32 hook_size_;
  ExecutableMemory trampoline_;
  std::unique_ptr<byte> original_;
  std::unique_ptr<byte> hooked_;
  bool injected_;

  static const byte TRAMPOLINE_PREAMBLE[];
  static const byte TRAMPOLINE_POSTSCRIPT[];
};

// Adds stdcall pointer to a (pointerless) function type
// MakeStdcallPtr<void(int)>::Type -> void (__stdcall *)(int);
template <typename Signature>
struct MakeStdcallPtr {
};
template <typename Ret, typename... Args>
struct MakeStdcallPtr<Ret (Args...)> {
  using Type = Ret (__stdcall *)(Args...);
};

inline uintptr_t WritePush(byte* addr, uint32 constant) {
  addr[0] = 0x68;
  memcpy(addr + 1, &constant, 4);
  return 5;
}

// Generates the following code, that functions as a jump to `target`:
//   push target
//   ret
inline uintptr_t WritePushRetJump(byte* addr, byte* target) {
  auto pos = WritePush(addr, reinterpret_cast<uint32>(target));
  addr[pos] = 0xc3;  // return
  return pos + 1;
}

inline uintptr_t WriteRelativeCall(byte *addr, byte *target) {
  uintptr_t offset = reinterpret_cast<uintptr_t>(target) - reinterpret_cast<uintptr_t>(addr) - 5;
  addr[0] = 0xe8;
  memcpy(addr + 1, &offset, 4);
  return 5;
}

inline uintptr_t WriteReturn(byte* addr, uintptr_t stack_pop_amount) {
  if (stack_pop_amount == 0) {
    addr[0] = 0xc3;
    return 1;
  } else {
    addr[0] = 0xc2;
    *reinterpret_cast<uint16*>(addr + 1) = stack_pop_amount;
    return 3;
  }
}

// Count how many `Stack`s there are in `Args`
template <typename... Args>
typename std::enable_if_t<(sizeof...(Args) == 0), uintptr_t>
    CountStackArgs() {
  return 0;
}

template <typename C, typename... Args>
uintptr_t CountStackArgs() {
  return (C::IsStack() ? 1 : 0) + CountStackArgs<Args...>();
}

// stack_index is for counting multiple `Stack` types
// in `Args`
template <typename... Args>
typename std::enable_if_t<(sizeof...(Args) == 0), void>
    WriteArgumentPushes(std::vector<byte>* buffer, uintptr_t stack_index) {
}

template <typename C, typename... Args>
void WriteArgumentPushes(std::vector<byte>* buffer, uintptr_t stack_index) {
  stack_index += C::IsStack() ? 1 : 0;
  WriteArgumentPushes<Args...>(buffer, stack_index);
  uintptr_t stack_pos = sizeof...(Args) * 4;
  C::WritePush(buffer, stack_pos + stack_index * 4);
}

template<typename... Args>
void WriteCustomCallingConventionEntry(std::vector<byte>* buffer) {
  WriteArgumentPushes<Args...>(buffer, 0);
}

// Preserves/restores edi/esi/ebp. Returns the stack change (in bytes). If the bool is false,
// pushes, otherwise pops.
template <typename... Args>
typename std::enable_if_t<(sizeof...(Args) == 0), intptr_t>
    WritePreservedRegisterPushPop(std::vector<byte>* buffer, bool pop) {
  return 0;
}

template <typename C, typename... Args>
intptr_t WritePreservedRegisterPushPop(std::vector<byte>* buffer, bool pop) {
  intptr_t stack_diff = C::WritePushPopIfPreserved(buffer, pop);
  return stack_diff + WritePreservedRegisterPushPop<Args...>(buffer, pop);
}

// Either 'mov register, [esp + pos]' or 'push dword [esp + pos]'
// The args are pushed in reverse order.
template <typename... Args>
typename std::enable_if_t<(sizeof...(Args) == 0), intptr_t>
    WriteMoveIntoArgument(std::vector<byte>* buffer, intptr_t stack_offset) {
  return stack_offset - 4;
}

template <typename C, typename... Args>
intptr_t WriteMoveIntoArgument(std::vector<byte>* buffer, intptr_t stack_offset) {
  intptr_t stack_pos = WriteMoveIntoArgument<Args...>(buffer, stack_offset + 4);
  C::WriteMoveFromStack(buffer, stack_pos);
  return stack_pos + (C::IsStack() ? 0 : -4);
}

template<typename... Args>
void WriteOriginalCallableEntry(std::vector<byte>* buffer) {
  intptr_t stack_pos = WritePreservedRegisterPushPop<Args...>(buffer, false);
  WriteMoveIntoArgument<Args...>(buffer, stack_pos + 4);
}

template<typename... Args>
void WriteOriginalCallableReturn(std::vector<byte>* buffer) {
  WritePreservedRegisterPushPop<Args...>(buffer, true);
  auto pos = buffer->size();
  buffer->resize(pos + 3);
  pos += WriteReturn(&(*buffer)[pos], sizeof...(Args) * 4);
  buffer->resize(pos);
}

// Type for hooking a function at a specific memory location, with methods for replacing and
// restoring the original code. Function pointer type is specified by F, to allow for hooks of
// varying parameter lists.
template<typename F>
class FuncHook {
public:
  using FnPtr = typename MakeStdcallPtr<F>::Type;
  FuncHook()
      : hook_func_(nullptr),
        function_(nullptr),
        original_mem_(),
        hooked_mem_(),
        injected_(false) {
  }

  FuncHook(const FuncHook&) = delete;
  FuncHook &operator=(const FuncHook&) = delete;

  void InitStdcall(uintptr_t func, FnPtr hook_func) {
    // There shouldn't be any reason to call an Init function twice, so not going to write code
    // to handle the cleanup of old state if it happens.
    assert(!Initialized());
    function_ = reinterpret_cast<byte*>(func);
    hook_func_ = hook_func;

    WritePushRetJump(&hooked_mem_[0], reinterpret_cast<byte*>(hook_func_));

    for (size_t i = 0; i < original_mem_.size(); i++) {
      original_mem_[i] = function_[i];
    }

    auto ins_sizes = CountInstructionSizes(function_, 6);
    uintptr_t hook_size = ins_sizes.hook_size;
    uintptr_t replaced_size = ins_sizes.replaced_size;
    // The original_callable_ will contain the few bytes we needed to write over, and a
    // 6-byte "push address; return" to jump back to untouched code.
    original_callable_ = ExecutableMemory::Allocate(replaced_size + 6);

    ReplaceRelativeOffsets(function_, hook_size, &original_callable_[0], replaced_size);
    WritePushRetJump(&original_callable_[hook_size], function_ + hook_size);
  }

  // Any stack arguments are considered stdcall-like (callee pops)
  template<typename... Args>
  void InitCustom(uintptr_t func, FnPtr hook_func) {
    assert(!Initialized());
    function_ = reinterpret_cast<byte*>(func);
    hook_func_ = hook_func;

    std::vector<byte> instruction_buffer;
    instruction_buffer.reserve(64);
    byte* target = reinterpret_cast<byte*>(hook_func);
    WriteCustomCallingConventionEntry<Args...>(&instruction_buffer);
    uintptr_t trampoline_size = instruction_buffer.size() + 5 + 3;
    trampoline_ = ExecutableMemory::Allocate(trampoline_size);
    memcpy(&trampoline_[0], &instruction_buffer[0], instruction_buffer.size());
    uintptr_t pos = instruction_buffer.size();
    pos += WriteRelativeCall(&trampoline_[pos], target);
    pos += WriteReturn(&trampoline_[pos], CountStackArgs<Args...>() * 4);
    // <= since WriteReturn can save some bytes if there is nothing to pop
    assert(pos <= trampoline_size);
    WritePushRetJump(&hooked_mem_[0], &trampoline_[0]);

    // The original_callable_'s assembly will look like this:
    //
    // WriteOriginalCallableEntry and WriteOriginalCallableReturn write to a vector (Instead of
    // calculating the code size statically, and writing instructions directly to
    // ExecutableMemory), in order to reduce amount of the jump-around logic that comes with
    // variadic templates.
    // The call itself is written in-place so that addresses can be hardcoded, as that's
    // simpler than writing position-independent code/taking address changes into account
    // when moving the code from a temp buffer :/
    //
    // WriteOriginalCallableEntry {
    //   push esi ; Push esi/edi/ebp if they are used
    //   mov esi, [esp + 4]
    //   push dword [esp + 8]
    // }
    // Call {
    //   push &Return
    //   push ebp     ; The few initial instructions that were overwritten by the hooking jump
    //   mov ebp, esp
    //   cmp esi, 500
    //   push (function_ + len) ; Jump to the original function
    //   ret
    // Return:
    // }
    // WriteOriginalCallableReturn {
    //   pop esi ; Restore esi/edi/ebp
    //   ret 8 ; Return to the caller, pop args as this uses stdcall
    // }
    auto ins_sizes = CountInstructionSizes(function_, 6);
    uintptr_t hook_size = ins_sizes.hook_size;
    uintptr_t replaced_size = ins_sizes.replaced_size;
    instruction_buffer.clear();
    WriteOriginalCallableEntry<Args...>(&instruction_buffer);
    auto entry_instructions_size = instruction_buffer.size();
    // Might as well store the entry and exit instructions to a same vector
    WriteOriginalCallableReturn<Args...>(&instruction_buffer);
    byte* return_instructions = instruction_buffer.data() + entry_instructions_size;
    auto return_instructions_size = instruction_buffer.size() - entry_instructions_size;

    uintptr_t call_section_size = 5 + replaced_size + 6;
    uintptr_t orig_callable_size =
        entry_instructions_size + call_section_size + return_instructions_size;
    original_callable_ = ExecutableMemory::Allocate(orig_callable_size);
    memcpy(&original_callable_[0], &instruction_buffer[0], entry_instructions_size);
    pos = entry_instructions_size;

    // Write the "Call" section
    // push &return_instructions
    auto return_offset = reinterpret_cast<uintptr_t>(&original_callable_[pos + call_section_size]);
    pos += WritePush(&original_callable_[pos], return_offset);
    // Copy instructions that are overwritten on inject
    ReplaceRelativeOffsets(function_, hook_size, &original_callable_[pos], replaced_size);
    pos += replaced_size;
    // Jump back to the original code
    pos += WritePushRetJump(&original_callable_[pos], function_ + replaced_size);

    // Return instructions
    memcpy(&original_callable_[pos], return_instructions, return_instructions_size);
    assert(pos + return_instructions_size == orig_callable_size);
    // Done! yay
  }

  ~FuncHook() {
    if (injected_) {
      Restore();
    }
  }

  bool Initialized() const {
    return function_ != nullptr;
  }

  // TODO(tec27): This should probably update its original memory directly on hooking, so that its
  // more amenable to things hooking the same locations. On the other hand, fuck it, JS everything!
  bool Inject() {
    assert(Initialized());
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

  FnPtr callable() const {
    return reinterpret_cast<FnPtr>(&original_callable_[0]);
  }

private:
  FnPtr hook_func_;
  byte* function_;
  std::array<byte, 6> original_mem_;
  std::array<byte, 6> hooked_mem_;
  // For now, the trampoline is only used when using InitCustom(), as stdcall functions can
  // be directly hooked.
  ExecutableMemory trampoline_;
  ExecutableMemory original_callable_;
  bool injected_;
};

// Hook type that rewrites the import table of a module (IAT hook), construct using HookedModule
class ImportHookBase {
public:
  virtual ~ImportHookBase() {}
  virtual bool Inject() = 0;
  virtual bool Restore() = 0;
};

class HookedModule;

template<typename Signature>
class ImportHook;

template<typename Ret, typename... Args>
class ImportHook<Ret(Args...)> : public ImportHookBase {
  friend class HookedModule;
  using FuncType = Ret (__stdcall *)(Args...);

public:
  virtual ~ImportHook() {
    if (injected_) {
      Restore();
    }
  }

  virtual bool Inject() {
    if (injected_ || import_entry_ == nullptr) {
      return false;
    }

    ScopedVirtualProtect protect(import_entry_, sizeof(FuncType), PAGE_EXECUTE_READWRITE);
    if (protect.has_errors()) {
      return false;
    }

    original_func_ = *import_entry_;
    *import_entry_ = hook_func_;
    injected_ = true;
    return true;
  }

  virtual bool Restore() {
    if (!injected_ || import_entry_ == nullptr) {
      return false;
    }
    assert(*import_entry_ == hook_func_);

    ScopedVirtualProtect protect(import_entry_, sizeof(FuncType), PAGE_EXECUTE_READWRITE);
    if (protect.has_errors()) {
      return false;
    }

    *import_entry_ = original_func_;
    original_func_ = nullptr;
    injected_ = false;
    return true;
  }

private:
  ImportHook(HMODULE module_handle, const std::string import_module_name,
    const std::string import_func_name, FuncType hook_func)
    : original_func_(nullptr),
    hook_func_(hook_func),
    import_entry_(nullptr),
    injected_(false) {
    import_entry_ = GetImportEntry(module_handle, import_module_name, import_func_name);
  }

  ImportHook(ImportHook<Ret(Args...)>&& other)
    : original_func_(other.original_func_),
      hook_func_(other.hook_func_),
      import_entry_(other.import_entry_),
      injected_(other.injected_) {
    other.injected_ = false;
  }

  // disallow copying
  ImportHook(const ImportHook<Ret(Args...)>&) = delete;
  ImportHook& operator=(const ImportHook<Ret(Args...)>&) = delete;

  PIMAGE_NT_HEADERS GetNtHeaders(HMODULE module_handle) {
    assert(module_handle != nullptr);
    // HMODULES are a pointer to the start of the module in memory, so we can just use that as a
    // pointer to the image header and traverse it to get to the PIMAGE_NT_HEADER
    PIMAGE_DOS_HEADER dos_header = reinterpret_cast<PIMAGE_DOS_HEADER>(module_handle);
    if (dos_header->e_magic != IMAGE_DOS_SIGNATURE) {
      return nullptr;
    }

    PIMAGE_NT_HEADERS nt_header = reinterpret_cast<PIMAGE_NT_HEADERS>(
        reinterpret_cast<byte*>(module_handle) + dos_header->e_lfanew);
    if (nt_header->Signature != IMAGE_NT_SIGNATURE) {
      return nullptr;
    }

    return nt_header;
  }

  FuncType* GetImportEntry(HMODULE module_handle, const std::string import_module_name,
      const std::string import_func_name) {
    PIMAGE_NT_HEADERS header = GetNtHeaders(module_handle);
    if (header == nullptr) {
      return nullptr;
    }

    uint32 module_offset = reinterpret_cast<uint32>(module_handle);
    // get the first import
    PIMAGE_IMPORT_DESCRIPTOR import = reinterpret_cast<PIMAGE_IMPORT_DESCRIPTOR>(
        header->OptionalHeader.DataDirectory[IMAGE_DIRECTORY_ENTRY_IMPORT].VirtualAddress +
        module_offset);
    // loop over the imports until we either find the one we want, or reach the end of the table
    while (import->FirstThunk) {
      char* mod_name = reinterpret_cast<char*>(module_offset + import->Name);
      if (lstrcmpiA(mod_name, import_module_name.c_str()) == 0) {
        // this is the correct module, try to find the right function in its table
        PIMAGE_THUNK_DATA import_first = reinterpret_cast<PIMAGE_THUNK_DATA>(
            module_offset + import->FirstThunk);
        PIMAGE_THUNK_DATA import_original = reinterpret_cast<PIMAGE_THUNK_DATA>(
            module_offset + import->OriginalFirstThunk);

        // loop over all the functions until we find the right one, or reach the end of the table
        while (import_first->u1.Function) {
          if (!IMAGE_SNAP_BY_ORDINAL(import_original->u1.Ordinal)) {
            // the import is referenced by name, not by ordinal, so we can do a proper comparison
            PIMAGE_IMPORT_BY_NAME import_by_name = reinterpret_cast<PIMAGE_IMPORT_BY_NAME>(
                module_offset + import_original->u1.AddressOfData);
            if (lstrcmpiA(reinterpret_cast<char*>(import_by_name->Name),
                import_func_name.c_str()) == 0) {
              // we found the correct function entry, return it
              return reinterpret_cast<FuncType*>(&import_first->u1.Function);
            }
          }

          import_first++;
          import_original++;
        }
      }

      import++;  // move to the next import
    }

    // we couldn't find the right import
    return nullptr;
  }

  FuncType original_func_;
  FuncType hook_func_;
  FuncType* import_entry_;
  bool injected_;
};

class HookedModule {
public:
  explicit HookedModule(HMODULE module_handle);
  ~HookedModule();

  template<typename Ret, typename... Args>
  void AddHook(
      std::string import_module, std::string func_name, Ret(__stdcall *hook_func)(Args...)) {
    std::unique_ptr<ImportHookBase> hook(
        new ImportHook<Ret(Args...)>(module_handle_, import_module, func_name, hook_func));
    if (injected_) {
      hook->Inject();
    }
    hooks_.push_back(std::move(hook));
  }

  bool Inject();
  bool Restore();
private:
  // disallow copying
  HookedModule(const HookedModule&) = delete;
  HookedModule& operator=(const HookedModule&) = delete;

  HMODULE module_handle_;
  bool injected_;
  std::vector<std::unique_ptr<ImportHookBase>> hooks_;
};

}  // namespace sbat
