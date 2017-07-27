#include "common/win_helpers.h"

#include <Windows.h>
#include <Shlobj.h>
#include <algorithm>
#include <iterator>
#include <string>
#include <vector>

#include "common/types.h"

using std::string;
using std::wstring;
using std::vector;

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

ScopedVirtualAlloc::ScopedVirtualAlloc(HANDLE process_handle, void* address, size_t size,
  uint32 allocation_type, uint32 protection)
    : process_handle_(process_handle),
      alloc_(VirtualAllocEx(process_handle, address, size, allocation_type, protection)) {
}

ScopedVirtualAlloc::~ScopedVirtualAlloc() {
  if (alloc_ != nullptr) {
    VirtualFreeEx(process_handle_, alloc_, 0, MEM_FREE);
  }
}

WinHdc::WinHdc(HWND window)
  : window_(window),
    hdc_(GetDC(window)) {
}

WinHdc::~WinHdc() {
  ReleaseDC(window_, hdc_);
}

WinHandle::WinHandle(HANDLE handle)
   : handle_(handle) {
}

WinHandle::~WinHandle() {
  if (handle_ != NULL && handle_ != INVALID_HANDLE_VALUE) {
    CloseHandle(handle_);
  }
}

void WinHandle::Reset(HANDLE handle) {
  if (handle_ != NULL && handle_ != INVALID_HANDLE_VALUE) {
    CloseHandle(handle_);
  }
  handle_ = handle;
}

WindowsError::WindowsError(string location, uint32 error_code)
    : code_(error_code),
      location_(std::move(location)) {
}

bool WindowsError::is_error() const {
  return code_ != 0;
}

uint32 WindowsError::code() const {
  return code_;
}

string WindowsError::location() const {
  return location_;
}

string WindowsError::message() const {
  if (code_ == 0) {
    return "No error";
  }

  char* message_buffer;
  uint32 buffer_len = FormatMessageA(FORMAT_MESSAGE_ALLOCATE_BUFFER | FORMAT_MESSAGE_FROM_SYSTEM |
    FORMAT_MESSAGE_IGNORE_INSERTS, nullptr, code_, MAKELANGID(LANG_NEUTRAL, SUBLANG_DEFAULT),
    reinterpret_cast<char*>(&message_buffer), 0, nullptr);
  if (message_buffer != nullptr) {
    size_t total_len = buffer_len + location_.size() + 3 + 1;
    char* out_buffer = new char[total_len];
    _snprintf_s(out_buffer, total_len, _TRUNCATE, "[%s] %s", location_.c_str(), message_buffer);
    string result(out_buffer);
    #pragma warning(suppress: 6280)
    LocalFree(message_buffer);
    delete[] out_buffer;

    return result;
  } else {
    // In some cases, the code we have is not actually a system code. For these, we will simply
    // print the error code to a string
    size_t total_len = 10 + location_.size() + 3 + 1;
    message_buffer = new char[total_len];
    _snprintf_s(message_buffer, total_len, _TRUNCATE, "[%s] 0x%08x", location_.c_str(), code_);
    string result(message_buffer);
    delete[] message_buffer;
    return message_buffer;
  }
}

wstring GetDocumentsPath() {
  wchar_t* path = nullptr;
  HRESULT result = SHGetKnownFolderPath(FOLDERID_Documents, 0, NULL, &path);
  if (result != S_OK) {
    SetLastError(result);
    return L"";
  }
  wstring documents_path(path);
  CoTaskMemFree(reinterpret_cast<void*>(path));
  return documents_path;
}

bool EndsWith(const string checked, const string suffix) {
  if (suffix.length() > checked.length()) {
    return false;
  }

  int index = checked.rfind(suffix);
  return index != string::npos && (index + suffix.length() == checked.length());
}

}  // namespace sbat