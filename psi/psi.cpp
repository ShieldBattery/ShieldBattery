#include "psi/psi.h"

#include <node.h>
#include <Windows.h>
#include <string>

#include "common/win_helpers.h"

using std::string;
using std::wstring;

namespace sbat {
namespace psi {

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
  0x55,                               // PUSH EBP
  0x8B, 0xEC,                         // MOV EBP, ESP
  0x83, 0xEC, 0x08,                   // SUB ESP, 8
  0x8B, 0x45, 0x08,                   // MOV EAX, &context->dll_path
  0x50,                               // PUSH EAX
  0x8B, 0x4D, 0x08,                   // MOV ECX, context
  0x8B, 0x91, 0x08, 0x03, 0x00, 0x00, // MOV EDX, context->LoadLibraryW
  0xFF, 0xD2,                         // CALL LoadLibraryW(&context->dll_path)
  0x89, 0x45, 0xFC,                   // MOV [LOCAL.1], EAX (module_handle)
  0x83, 0x7D, 0xFC, 0x00,             // CMP [LOCAL.1], 0
  0x75, 0x0D,                         // JNZ LOADLIB_SUCCESS
  0x8B, 0x45, 0x08,                   // MOV EAX, context
  0x8B, 0x88, 0x10, 0x03, 0x00, 0x00, // MOV ECX, context->GetLasttError
  0xFF, 0xD1,                         // CALL GetLastError()
  0xEB, 0x34,                         // JMP EXIT
// LOADLIB_SUCCESS:
  0x8B, 0x55, 0x08,                   // MOV EDX, context
  0x81, 0xC2, 0x08, 0x02, 0x00, 0x00, // ADD EDX, 208 (EDX = &context->inject_proc_name)
  0x52,                               // PUSH EDX
  0x8B, 0x45, 0xFC,                   // MOV EAX, module_handle
  0x50,                               // PUSH EAX
  0x8B, 0x4D, 0x08,                   // MOV ECX, context
  0x8B, 0x91, 0x0C, 0x03, 0x00, 0x00, // MOV EDX, context->GetProcAddress
  0xFF, 0xD2,                         // CALL GetProcAddress(module_handle, inject_proc_name)
  0x89, 0x45, 0xF8,                   // MOV [LOCAL.2], EAX (func)
  0x83, 0x7D, 0xF8, 0x00,             // CMP [LOCAL.2], 0
  0x75, 0x0D,                         // JNZ GETPROC_SUCCESS
  0x8B, 0x45, 0x08,                   // MOV EAX, context
  0x8B, 0x88, 0x10, 0x03, 0x00, 0x00, // MOV ECX, context->GetLastError
  0xFF, 0xD1,                         // CALL GetLastError()
  0xEB, 0x05,                         // JMP EXIT
// GETPROC_SUCCESS:
  0xFF, 0x55, 0xF8,                   // CALL func
  0x33, 0xC0,                         // XOR EAX, EAX (return value = 0)
// EXIT:
  0x8B, 0xE5,                         // MOV ESP, EBP
  0x5D,                               // POP EBP
  0xC2, 0x04, 0x00                    // RETN 4
};

bool Process::se_debug_enabled_ = false;

Process::Process(const wstring& app_path, const wstring& arguments, bool launch_suspended,
    const wstring& current_dir)
    : process_info_(),
      error_(nullptr) {
  if (!se_debug_enabled_) {
    if (!EnableSeDebug()) {
      return;
    }
  }

  STARTUPINFOW startup_info = { 0 };
  // CreateProcessW claims to sometimes modify arguments, no fucking clue why
  wchar_t* arguments_cstr = new wchar_t[arguments.length() + 1];
  std::copy(arguments.begin(), arguments.end(), arguments_cstr);
  if (!CreateProcessW(app_path.c_str(),  arguments_cstr, nullptr, nullptr, false,
      launch_suspended ? CREATE_SUSPENDED : 0, nullptr, current_dir.c_str(), &startup_info,
      &process_info_)) {
    error_ = new WindowsError(GetLastError());
    return;
  }
}

Process::~Process() {
  if (error_ != nullptr) {
    delete error_;
    error_ = nullptr;
  } else {
    CloseHandle(process_info_.hProcess);
    CloseHandle(process_info_.hThread);
  }
}

bool Process::EnableSeDebug() {
  HANDLE token;
  if (!OpenProcessToken(GetCurrentProcess(), TOKEN_ADJUST_PRIVILEGES | TOKEN_QUERY, &token)) {
    error_ = new WindowsError(GetLastError());
    return false;
  }

  TOKEN_PRIVILEGES privs;
  if (!LookupPrivilegeValue(nullptr, SE_DEBUG_NAME, &privs.Privileges[0].Luid)) {
    error_ = new WindowsError(GetLastError());
    CloseHandle(token);
    return false;
  }

  privs.Privileges[0].Attributes = SE_PRIVILEGE_ENABLED;
  privs.PrivilegeCount = 1;

  if (!AdjustTokenPrivileges(token, FALSE, &privs, 0, nullptr, nullptr) ||
      GetLastError() != ERROR_SUCCESS) {
    error_ = new WindowsError(GetLastError());
    CloseHandle(token);
    return false;
  }

  se_debug_enabled_ = true;
  CloseHandle(token);
  return true;
}

bool Process::has_errors() const {
  return error_ != nullptr && error_->is_error();
}

WindowsError Process::error() const {
  return *error_;
}

WindowsError Process::InjectDll(const wstring& dll_path, const string& inject_function_name) {
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
  void* remote_context = VirtualAllocEx(process_info_.hProcess, nullptr, alloc_size, MEM_COMMIT,
      PAGE_EXECUTE_READWRITE);
  if (remote_context == nullptr) {
    return WindowsError(GetLastError());
  }

  SIZE_T bytes_written;
  BOOL success = WriteProcessMemory(process_info_.hProcess, remote_context, &context,
      sizeof(context), &bytes_written);
  if (!success || bytes_written != sizeof(context)) {
    uint32 error = GetLastError();
    VirtualFreeEx(process_info_.hProcess, remote_context, alloc_size, MEM_RELEASE);
    return WindowsError(error);
  }

  void* remote_proc = reinterpret_cast<byte*>(remote_context) + sizeof(context);
  success = WriteProcessMemory(process_info_.hProcess, remote_proc, inject_proc,
      sizeof(inject_proc), &bytes_written);
  if (!success || bytes_written != sizeof(inject_proc)) {
    uint32 error = GetLastError();
    VirtualFreeEx(process_info_.hProcess, remote_context, alloc_size, MEM_RELEASE);
    return WindowsError(error);
  }

  HANDLE thread_handle = CreateRemoteThread(process_info_.hProcess, NULL, 0,
      reinterpret_cast<LPTHREAD_START_ROUTINE>(remote_proc), remote_context, 0,  nullptr);
  if (thread_handle == nullptr) {
    uint32 error = GetLastError();
    VirtualFreeEx(process_info_.hProcess, remote_context, alloc_size, MEM_RELEASE);
    return WindowsError(error);
  }

  WaitForSingleObject(thread_handle, 5000);
  DWORD exit_code;
  GetExitCodeThread(thread_handle, &exit_code);
  
  VirtualFreeEx(process_info_.hProcess, remote_context, alloc_size, MEM_RELEASE);

  return WindowsError(exit_code);
}

WindowsError Process::Resume() {
  if (has_errors()) {
    return error();
  }

  if (ResumeThread(process_info_.hThread) == -1) {
    return WindowsError(GetLastError());
  }

  return WindowsError();
}

}  // namespace psi
}  // namespace sbat

int wmain(int argc, wchar_t *argv[]) {
  if (AllocConsole()) {
    // correct stdout/stderr/stdin to point to new console
    FILE* fp;
    freopen_s(&fp, "CONOUT$", "w", stdout);
    freopen_s(&fp, "CONOUT$", "w", stderr);
    freopen_s(&fp, "CONIN$", "r", stdin);
  }

  HMODULE module_handle;
  char path[MAX_PATH];
  GetModuleHandleExA(
      GET_MODULE_HANDLE_EX_FLAG_FROM_ADDRESS | GET_MODULE_HANDLE_EX_FLAG_UNCHANGED_REFCOUNT,
      reinterpret_cast<LPCSTR>(&wmain), &module_handle);
  GetModuleFileNameA(module_handle, path, sizeof(path));

  char** node_argv = new char*[1];
  node_argv[0] = path;
  node::Start(1, node_argv);
}