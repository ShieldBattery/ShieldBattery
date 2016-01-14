#pragma once

#include <Windows.h>
#include <array>
#include <memory>
#include <vector>
#include <string>

#include "common/types.h"
#include "common/win_helpers.h"

namespace sbat {
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
  class AllocBlock {
    friend class Detour;
  public:
    AllocBlock();
    ~AllocBlock();
    uint32 GetBytesLeft();
  private:
    void* block_start_;
    void* pos_;
  };

  // disallow copying
  Detour(const Detour&) = delete;
  Detour& operator=(const Detour&) = delete;

  static std::shared_ptr<AllocBlock> AllocSpace(size_t trampoline_size);

  static uint32 page_size_;
  static std::shared_ptr<AllocBlock> current_block_;

  byte* hook_location_;
  uint32 hook_size_;
  std::shared_ptr<AllocBlock> trampoline_block_;
  std::unique_ptr<byte> original_;
  std::unique_ptr<byte> hooked_;
  bool injected_;

  static const byte TRAMPOLINE_PREAMBLE[];
  static const byte TRAMPOLINE_POSTSCRIPT[];
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

// Hook type that rewrites the import table of a module (IAT hook)
template<typename F>
class ImportHook {
public:
  ImportHook(HMODULE module_handle, const std::string import_module_name,
      const std::string import_func_name, F hook_func)
      : original_func_(nullptr),
        hook_func_(hook_func),
        import_entry_(nullptr),
        injected_(false) {
    import_entry_ = GetImportEntry(module_handle, import_module_name, import_func_name);
  }

  ~ImportHook() {
    if (injected_) {
      Restore();
    }
  }

  bool Inject() {
    if (injected_ || import_entry_ == nullptr) {
      return false;
    }

    ScopedVirtualProtect protect(import_entry_, sizeof(F), PAGE_EXECUTE_READWRITE);
    if (protect.has_errors()) {
      return false;
    }

    original_func_ = *import_entry_;
    *import_entry_ = hook_func_;
    injected_ = true;
    return true;
  }

  bool Restore() {
    if (!injected_ || import_entry_ == nullptr) {
      return false;
    }
    assert(*import_entry_ == hook_func_);

    ScopedVirtualProtect protect(import_entry_, sizeof(F), PAGE_EXECUTE_READWRITE);
    if (protect.has_errors()) {
      return false;
    }

    *import_entry_ = original_func_;
    original_func_ = nullptr;
    injected_ = false;
    return true;
  }

  F original() {
    assert(import_entry_ != nullptr);
    if (injected_) {
      return original_func_;
    } else {
      return *import_entry_;
    }
  }

private:
  // disallow copying
  ImportHook(const ImportHook&) = delete;
  ImportHook& operator=(const ImportHook&) = delete;

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

  F* GetImportEntry(HMODULE module_handle, const std::string import_module_name,
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
              return reinterpret_cast<F*>(&import_first->u1.Function);
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

  F original_func_;
  F hook_func_;
  F* import_entry_;
  bool injected_;
};

}  // namespace sbat
