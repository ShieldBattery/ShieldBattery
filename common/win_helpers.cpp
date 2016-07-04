#include "common/win_helpers.h"

#include <dbghelp.h>
#include <Windows.h>
#include <UserEnv.h>
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

static WindowsError CreateMiniDump(HANDLE process, const string& path) {
  HANDLE handle = CreateFileA(path.c_str(), GENERIC_READ | GENERIC_WRITE, 0, NULL, CREATE_ALWAYS,
      FILE_ATTRIBUTE_NORMAL, NULL);
  if (handle == INVALID_HANDLE_VALUE) {
    return WindowsError("CreateMiniDump -> CreateFile", GetLastError());
  }
  WinHandle file(handle);

  BOOL success = MiniDumpWriteDump(process, GetProcessId(process), file.get(),
      MiniDumpNormal, NULL, NULL, NULL);
  if (!success) {
    return WindowsError("CreateMiniDump -> MiniDumpWriteDump", GetLastError());
  }
  return WindowsError();
}

struct InjectContext {
  wchar_t dll_path[MAX_PATH];
  char inject_proc_name[256];

  HMODULE (WINAPI* LoadLibraryW)(LPCWSTR lib_filename);
  FARPROC (WINAPI* GetProcAddress)(HMODULE module_handle, LPCSTR proc_name);
  DWORD (WINAPI* GetLastError)();
};

// Thread proc function for injecting, looks like:
// int InjectProc(InjectContext* context);
const byte inject_proc[] = {
  0x55,                                 // PUSH EBP
  0x8B, 0xEC,                           // MOV EBP, ESP
  0x83, 0xEC, 0x08,                     // SUB ESP, 8
  0x8B, 0x45, 0x08,                     // MOV EAX, &context->dll_path
  0x50,                                 // PUSH EAX
  0x8B, 0x4D, 0x08,                     // MOV ECX, context
  0x8B, 0x91, 0x08, 0x03, 0x00, 0x00,   // MOV EDX, context->LoadLibraryW
  0xFF, 0xD2,                           // CALL LoadLibraryW(&context->dll_path)
  0x89, 0x45, 0xFC,                     // MOV [LOCAL.1], EAX (module_handle)
  0x83, 0x7D, 0xFC, 0x00,               // CMP [LOCAL.1], 0
  0x75, 0x0D,                           // JNZ LOADLIB_SUCCESS
  0x8B, 0x45, 0x08,                     // MOV EAX, context
  0x8B, 0x88, 0x10, 0x03, 0x00, 0x00,   // MOV ECX, context->GetLasttError
  0xFF, 0xD1,                           // CALL GetLastError()
  0xEB, 0x34,                           // JMP EXIT
// LOADLIB_SUCCESS:
  0x8B, 0x55, 0x08,                     // MOV EDX, context
  0x81, 0xC2, 0x08, 0x02, 0x00, 0x00,   // ADD EDX, 208 (EDX = &context->inject_proc_name)
  0x52,                                 // PUSH EDX
  0x8B, 0x45, 0xFC,                     // MOV EAX, module_handle
  0x50,                                 // PUSH EAX
  0x8B, 0x4D, 0x08,                     // MOV ECX, context
  0x8B, 0x91, 0x0C, 0x03, 0x00, 0x00,   // MOV EDX, context->GetProcAddress
  0xFF, 0xD2,                           // CALL GetProcAddress(module_handle, inject_proc_name)
  0x89, 0x45, 0xF8,                     // MOV [LOCAL.2], EAX (func)
  0x83, 0x7D, 0xF8, 0x00,               // CMP [LOCAL.2], 0
  0x75, 0x0D,                           // JNZ GETPROC_SUCCESS
  0x8B, 0x45, 0x08,                     // MOV EAX, context
  0x8B, 0x88, 0x10, 0x03, 0x00, 0x00,   // MOV ECX, context->GetLastError
  0xFF, 0xD1,                           // CALL GetLastError()
  0xEB, 0x05,                           // JMP EXIT
// GETPROC_SUCCESS:
  0xFF, 0x55, 0xF8,                     // CALL func
  0x33, 0xC0,                           // XOR EAX, EAX (return value = 0)
// EXIT:
  0x8B, 0xE5,                           // MOV ESP, EBP
  0x5D,                                 // POP EBP
  0xC2, 0x04, 0x00                      // RETN 4
};

Process::Process(const wstring& app_path, const wstring& arguments, bool launch_suspended,
    const wstring& current_dir, const vector<wstring>& environment)
    : process_handle_(),
      thread_handle_(),
      error_() {

  HANDLE token;
  uint32 result = WTSQueryUserToken(WTSGetActiveConsoleSessionId(), &token);
  if (result == 0) {
    error_ = WindowsError("Process -> WTSQueryUserToken", GetLastError());
    return;
  }
  WinHandle active_session_token(token);

  result = DuplicateTokenEx(active_session_token.get(), TOKEN_ASSIGN_PRIMARY | TOKEN_DUPLICATE |
      TOKEN_QUERY | TOKEN_ADJUST_DEFAULT | TOKEN_ADJUST_SESSIONID, nullptr,
      SecurityImpersonation, TokenPrimary, &token);
  if (result == 0) {
    error_ = WindowsError("Process -> DuplicateTokenEx", GetLastError());
    return;
  }
  WinHandle priv_token(token);
  
  wchar_t* env_block;
  CreateEnvironmentBlock(reinterpret_cast<void**>(&env_block), active_session_token.get(), false);
  size_t block_length = 0;
  bool was_null = false;
  for (size_t i = 0;; i++) {
    if (env_block[i] == NULL) {
      if (was_null) {
        break;
      }
      was_null = true;
    } else {
      was_null = false;
    }
    block_length++;
  }

  size_t env_length = 0;
  for (auto e : environment) {
    env_length += e.length() + 1;
  }
  vector<wchar_t> env_param;
  env_param.reserve(block_length + env_length + 1);
  std::copy(env_block, env_block + block_length, std::back_inserter(env_param));
  for (auto e : environment) {
    std::copy(e.begin(), e.end(), std::back_inserter(env_param));
    env_param.push_back(L'\0');
  }
  env_param.push_back(L'\0');
  DestroyEnvironmentBlock(env_block);

  STARTUPINFOW startup_info = { 0 };
  // CreateProcessW claims to sometimes modify arguments, no fucking clue why
  vector<wchar_t> arguments_writable(arguments.length() + 1);
  std::copy(arguments.begin(), arguments.end(), arguments_writable.begin());

  ImpersonateLoggedOnUser(priv_token.get());
  PROCESS_INFORMATION process_info;
  if (!CreateProcessAsUserW(priv_token.get(), app_path.c_str(), &arguments_writable[0], nullptr,
      nullptr, false,
      launch_suspended ? CREATE_SUSPENDED | CREATE_UNICODE_ENVIRONMENT : CREATE_UNICODE_ENVIRONMENT,
      &env_param[0], current_dir.c_str(),
      &startup_info, &process_info)) {
    error_ = WindowsError("Process -> CreateProcessAsUserW", GetLastError());
    RevertToSelf();
    return;
  }
  RevertToSelf();

  process_handle_.Reset(process_info.hProcess);
  thread_handle_.Reset(process_info.hThread);
}

Process::~Process() {
}

bool Process::has_errors() const {
  return error_.is_error();
}

WindowsError Process::error() const {
  return error_;
}

WindowsError Process::InjectDll(const wstring& dll_path, const string& inject_function_name,
    const string& error_dump_path) {
  if (has_errors()) {
    return error();
  }

  InjectContext context;
  lstrcpynW(context.dll_path, dll_path.c_str(), MAX_PATH);
  strcpy_s(context.inject_proc_name, inject_function_name.c_str());
  context.LoadLibraryW = LoadLibraryW;
  context.GetProcAddress = GetProcAddress;
  context.GetLastError = GetLastError;

  SIZE_T alloc_size = sizeof(context) + sizeof(inject_proc);
  ScopedVirtualAlloc remote_context(process_handle_.get(), nullptr, alloc_size, MEM_COMMIT,
      PAGE_EXECUTE_READWRITE);
  if (remote_context.has_errors()) {
    return WindowsError("InjectDll -> VirtualAllocEx", GetLastError());
  }

  SIZE_T bytes_written;
  BOOL success = WriteProcessMemory(process_handle_.get(), remote_context.get(), &context,
      sizeof(context), &bytes_written);
  if (!success || bytes_written != sizeof(context)) {
    return WindowsError("InjectDll -> WriteProcessMemory(InjectContext)", GetLastError());
  }

  void* remote_proc = reinterpret_cast<byte*>(remote_context.get()) + sizeof(context);
  success = WriteProcessMemory(process_handle_.get(), remote_proc, inject_proc,
      sizeof(inject_proc), &bytes_written);
  if (!success || bytes_written != sizeof(inject_proc)) {
    return WindowsError("InjectDll -> WriteProcessMemory(Proc)", GetLastError());
  }

  WinHandle thread_handle(CreateRemoteThread(process_handle_.get(), NULL, 0,
      reinterpret_cast<LPTHREAD_START_ROUTINE>(remote_proc), remote_context.get(), 0,  nullptr));
  if (thread_handle.get() == nullptr) {
    return WindowsError("InjectDll -> CreateRemoteThread", GetLastError());
  }

  uint32 wait_result = WaitForSingleObject(thread_handle.get(), 15000);
  if (wait_result == WAIT_TIMEOUT) {
    auto err = CreateMiniDump(process_handle_.get(), error_dump_path);
    if (err.is_error()) {
      return err;
    }
    return WindowsError("InjectDll -> WaitForSingleObject", WAIT_TIMEOUT);
  } else if (wait_result == WAIT_FAILED) {
    return WindowsError("InjectDll -> WaitForSingleObject", GetLastError());
  }

  DWORD exit_code;
  uint32 exit_result = GetExitCodeThread(thread_handle.get(), &exit_code);
  if (exit_result == 0) {
    return WindowsError("InjectDll -> GetExitCodeThread", GetLastError());
  }

  return WindowsError("InjectDll -> injection proc exit code", exit_code);
}

WindowsError Process::Resume() {
  if (has_errors()) {
    return error();
  }

  if (ResumeThread(thread_handle_.get()) == -1) {
    return WindowsError("Process Resume -> ResumeThread", GetLastError());
  }

  return WindowsError();
}

WindowsError Process::Terminate() {
  if (has_errors()) {
    return error();
  }

  if (TerminateProcess(process_handle_.get(), 0) == 0) {
    return WindowsError("Process Terminate -> TerminateThread", GetLastError());
  }

  return WindowsError();
}

WindowsError Process::WaitForExit(uint32 max_wait_ms, bool* timed_out) {
  if (has_errors()) {
    return error();
  }

  if (timed_out != nullptr) {
    *timed_out = false;
  }

  DWORD result = WaitForSingleObject(process_handle_.get(), max_wait_ms);
  if (result == WAIT_TIMEOUT && timed_out != nullptr) {
    *timed_out = true;
    return WindowsError("WaitForExit -> WaitForSingleObject", WAIT_TIMEOUT);
  } else if (result == WAIT_FAILED) {
    return WindowsError("WaitForExit -> WaitForSingleObject", GetLastError());
  }

  return WindowsError();
}

WindowsError Process::GetExitCode(uint32* exit_code) {
  if (has_errors()) {
    return error();
  }

  BOOL result = GetExitCodeProcess(process_handle_.get(), reinterpret_cast<LPDWORD>(exit_code));
  if (result == FALSE) {
    return WindowsError("GetExitCode -> GetExitCodeProcess", GetLastError());
  }

  return WindowsError();
}
}  // namespace sbat