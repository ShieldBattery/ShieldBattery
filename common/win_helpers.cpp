#include "common/win_helpers.h"

#include <Windows.h>
#include <string>
#include "common/types.h"

using std::wstring;

namespace sbat {
ScopedVirtualProtect::ScopedVirtualProtect(void* address, size_t size, uint32 new_protection)
    : address_(address),
      size_(size),
      old_protection_(0),
      has_errors_(false) {
  has_errors_ = VirtualProtect(address_, size_, new_protection,
      reinterpret_cast<PDWORD>(&old_protection_)) == 0;
}

ScopedVirtualProtect::~ScopedVirtualProtect() {
  if (!has_errors_) {
    VirtualProtect(address_, size_, old_protection_, reinterpret_cast<PDWORD>(&old_protection_));
  }
}

bool ScopedVirtualProtect::has_errors() const {
  return has_errors_;
}

WindowsError::WindowsError()
    : error_code_(0),
      error_message_() {
}

WindowsError::WindowsError(uint32 error_code) 
    : error_code_(error_code),
      error_message_() {
  if (error_code_ == 0) {
    return;
  }

  wchar_t* message_buffer;
  FormatMessageW(FORMAT_MESSAGE_ALLOCATE_BUFFER | FORMAT_MESSAGE_FROM_SYSTEM |
      FORMAT_MESSAGE_IGNORE_INSERTS, nullptr, error_code, MAKELANGID(LANG_NEUTRAL, SUBLANG_DEFAULT),
      reinterpret_cast<wchar_t*>(&message_buffer), 0, nullptr);
  error_message_ = message_buffer;
  LocalFree(message_buffer);
}

bool WindowsError::is_error() const {
  return error_code_ != 0;
}

uint32 WindowsError::error_code() const {
  return error_code_;
}

wstring WindowsError::error_message() const {
  return error_message_;
}
}  // namespace sbat