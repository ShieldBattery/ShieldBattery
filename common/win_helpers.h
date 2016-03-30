#pragma once

#include <Windows.h>
#include <Wtsapi32.h>
#include <string>
#include "common/macros.h"
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
  // Disable copying
  ScopedVirtualProtect(const ScopedVirtualProtect&) = delete;
  ScopedVirtualProtect& operator=(const ScopedVirtualProtect&) = delete;

  void* address_;
  size_t size_;
  uint32 old_protection_;
  bool has_errors_;
};

class ScopedVirtualAlloc {
public:
  ScopedVirtualAlloc(HANDLE process_handle, void* address, size_t size, uint32 allocation_type,
     uint32 protection);
  ~ScopedVirtualAlloc();

  bool has_errors() const { return alloc_ == nullptr; }
  void* get() const { return alloc_; }
private:
  // Disable copying
  ScopedVirtualAlloc(const ScopedVirtualAlloc&) = delete;
  ScopedVirtualAlloc& operator=(const ScopedVirtualAlloc&) = delete;

  HANDLE process_handle_;
  void* alloc_;
};

class WinHdc {
public:
  explicit WinHdc(HWND window);
  ~WinHdc();

  HDC get() const { return hdc_; }
private:
  // Disable copying
  WinHdc(const WinHdc&) = delete;
  WinHdc& operator=(const WinHdc&) = delete;

  HWND window_;
  HDC hdc_;
};

class WinHandle {
public:
  WinHandle() : WinHandle(INVALID_HANDLE_VALUE) {}
  explicit WinHandle(HANDLE handle);
  ~WinHandle();

  HANDLE get() const { return handle_; }
  // Sets a new handle for this container, closing the previous one if one was set
  void Reset(HANDLE handle);
private:
  // Disable copying
  WinHandle(const WinHandle&) = delete;
  WinHandle& operator=(const WinHandle&) = delete;

  HANDLE handle_;
};

class WindowsError {
public:
  WindowsError(std::string location, uint32 error_code);
  WindowsError() : WindowsError("", 0) {}

  bool is_error() const;
  uint32 code() const;
  std::string message() const;
  std::string location() const;

private:
  uint32 code_;
  std::string location_;
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
  WindowsError Terminate();
  WindowsError WaitForExit(uint32 max_wait_ms = INFINITE, bool* timed_out = nullptr);
  WindowsError GetExitCode(uint32* exit_code);
private:
  // Disable copying
  Process(const Process&) = delete;
  Process& operator=(const Process&) = delete;

  WindowsError EnableSeDebug();

  static bool se_debug_enabled_;
  WinHandle process_handle_;
  WinHandle thread_handle_;
  WindowsError error_;
};

// Used to pass messages between processes about the current monitor resolution
struct ResolutionMessage {
  uint32 width;
  uint32 height;
};
}  // namespace sbat
