#pragma once

#include <Windows.h>
#include <Wtsapi32.h>
#include <string>
#include <vector>
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

std::wstring GetDocumentsPath();
bool EndsWith(const std::string checked, const std::string suffix);

}  // namespace sbat
