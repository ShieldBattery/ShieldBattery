#ifndef COMMON_WIN_HELPERS_H_
#define COMMON_WIN_HELPERS_H_

#include <Windows.h>
#include <Wtsapi32.h>
#include <string>
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

class WindowsError {
public:
  WindowsError();
  explicit WindowsError(uint32 error_code);

  bool is_error() const;
  uint32 code() const;
  std::wstring message() const;

private:
  uint32 code_;
  std::wstring message_;
};

class Process {
public:
  Process(const std::wstring& app_path, const std::wstring& arguments, bool launch_suspended,
    const std::wstring& current_dir);
  ~Process();
  bool has_errors() const;
  WindowsError error() const;

  WindowsError InjectDll(const std::wstring& dll_path, const std::string& inject_function_name);
  WindowsError Resume();
private:
  bool EnableSeDebug();

  static bool se_debug_enabled_;
  PROCESS_INFORMATION process_info_;
  WindowsError* error_;
};
}  // namespace sbat
#endif  // COMMON_WIN_HELPERS_H_