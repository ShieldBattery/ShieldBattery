#include "wrapped_process.h"

#include <node.h>
#include <assert.h>
#include <DbgHelp.h>
#include <nan.h>
#include <iterator>
#include <memory>
#include <string>
#include <vector>

#include "v8_string.h"

using Nan::Callback;
using Nan::EscapableHandleScope;
using Nan::FunctionCallbackInfo;
using Nan::HandleScope;
using Nan::Null;
using Nan::Persistent;
using Nan::SetPrototypeMethod;
using Nan::To;
using Nan::Undefined;
using Nan::Utf8String;
using std::string;
using std::unique_ptr;
using std::vector;
using std::wstring;
using v8::Exception;
using v8::Function;
using v8::FunctionTemplate;
using v8::Local;
using v8::Object;
using v8::String;
using v8::Value;

namespace sbat {
namespace proc {

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

WindowsError::WindowsError(string location, uint32_t error_code)
  : code_(error_code),
  location_(std::move(location)) {
}

bool WindowsError::is_error() const {
  return code_ != 0;
}

uint32_t WindowsError::code() const {
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
  uint32_t buffer_len = FormatMessageA(FORMAT_MESSAGE_ALLOCATE_BUFFER | FORMAT_MESSAGE_FROM_SYSTEM |
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

ScopedVirtualAlloc::ScopedVirtualAlloc(HANDLE process_handle, void* address, size_t size,
  uint32_t allocation_type, uint32_t protection)
  : process_handle_(process_handle),
  alloc_(VirtualAllocEx(process_handle, address, size, allocation_type, protection)) {
}

ScopedVirtualAlloc::~ScopedVirtualAlloc() {
  if (alloc_ != nullptr) {
    VirtualFreeEx(process_handle_, alloc_, 0, MEM_FREE);
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

  HMODULE(WINAPI* LoadLibraryW)(LPCWSTR lib_filename);
  FARPROC(WINAPI* GetProcAddress)(HMODULE module_handle, LPCSTR proc_name);
  DWORD(WINAPI* GetLastError)();
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

  wchar_t* env_strings = GetEnvironmentStringsW();
  if (env_strings == nullptr) {
    error_ = WindowsError("Process -> GetEnvironmentStringsW", GetLastError());
    return;
  }
  size_t block_length = 0;
  bool was_null = false;
  for (size_t i = 0;; i++) {
    if (env_strings[i] == NULL) {
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
  std::copy(env_strings, env_strings + block_length, std::back_inserter(env_param));
  for (auto e : environment) {
    std::copy(e.begin(), e.end(), std::back_inserter(env_param));
    env_param.push_back(L'\0');
  }
  env_param.push_back(L'\0');
  FreeEnvironmentStringsW(env_strings);

  STARTUPINFOW startup_info = {0};
  // CreateProcessW claims to sometimes modify arguments, no fucking clue why
  vector<wchar_t> arguments_writable(arguments.length() + 1);
  std::copy(arguments.begin(), arguments.end(), arguments_writable.begin());

  PROCESS_INFORMATION process_info;
  if (!CreateProcessW(app_path.c_str(), &arguments_writable[0], nullptr, nullptr, false,
    launch_suspended ? CREATE_SUSPENDED | CREATE_UNICODE_ENVIRONMENT : CREATE_UNICODE_ENVIRONMENT,
    &env_param[0], current_dir.c_str(),
    &startup_info, &process_info)) {
    error_ = WindowsError("Process -> CreateProcessW", GetLastError());
    return;
  }

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
  wchar_t* buf = lstrcpynW(context.dll_path, dll_path.c_str(), MAX_PATH);
  if (buf == nullptr) {
    return WindowsError("InjectDll -> lstrcpynW", ERROR_NOT_ENOUGH_MEMORY);
  }
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
    reinterpret_cast<LPTHREAD_START_ROUTINE>(remote_proc), remote_context.get(), 0, nullptr));
  if (thread_handle.get() == nullptr) {
    return WindowsError("InjectDll -> CreateRemoteThread", GetLastError());
  }

  uint32_t wait_result = WaitForSingleObject(thread_handle.get(), 15000);
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
  uint32_t exit_result = GetExitCodeThread(thread_handle.get(), &exit_code);
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

WindowsError Process::WaitForExit(uint32_t max_wait_ms, bool* timed_out) {
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

WindowsError Process::GetExitCode(uint32_t* exit_code) {
  if (has_errors()) {
    return error();
  }

  BOOL result = GetExitCodeProcess(process_handle_.get(), reinterpret_cast<LPDWORD>(exit_code));
  if (result == FALSE) {
    return WindowsError("GetExitCode -> GetExitCodeProcess", GetLastError());
  }

  return WindowsError();
}

WrappedProcess::WrappedProcess() : process_(nullptr) {
}

WrappedProcess::~WrappedProcess() {
  if (process_ != nullptr) {
    delete process_;
    process_ = nullptr;
  }
}

void WrappedProcess::set_process(Process* process) {
  if (process_ != nullptr) {
    delete process_;
  }
  process_ = process;
}

Persistent<Function> WrappedProcess::constructor;

void WrappedProcess::Init() {
  Local<FunctionTemplate> tpl = Nan::New<FunctionTemplate>(New);
  tpl->SetClassName(Nan::New("CProcess").ToLocalChecked());
  tpl->InstanceTemplate()->SetInternalFieldCount(1);

  // functions
  SetPrototypeMethod(tpl, "injectDll", InjectDll);
  SetPrototypeMethod(tpl, "resume", Resume);
  SetPrototypeMethod(tpl, "terminate", Terminate);
  SetPrototypeMethod(tpl, "waitForExit", WaitForExit);
  
  constructor.Reset(tpl->GetFunction());
}

void WrappedProcess::New(const FunctionCallbackInfo<Value>& info) {
  WrappedProcess* process = new WrappedProcess();
  process->Wrap(info.This());

  info.GetReturnValue().Set(info.This());
}

Local<Value> WrappedProcess::NewInstance(Process* process) {
  EscapableHandleScope scope;

  Local<Function> cons = Nan::New<Function>(constructor);
  Local<Object> instance = cons->NewInstance();
  WrappedProcess* wrapped = ObjectWrap::Unwrap<WrappedProcess>(instance);
  wrapped->set_process(process);

  return scope.Escape(instance);
}

struct InjectDllContext {
  uv_work_t req;
  wstring dll_path;
  string inject_func;
  string error_dump_file;
  Callback callback;
  Persistent<Object> self;
  Process* process;

  WindowsError error;
};

void InjectDllWork(uv_work_t* req) {
  InjectDllContext* context = reinterpret_cast<InjectDllContext*>(req->data);

  context->error = context->process->InjectDll(context->dll_path, context->inject_func,
      context->error_dump_file);
}

void InjectDllAfter(uv_work_t* req, int status) {
  HandleScope scope;
  InjectDllContext* context = reinterpret_cast<InjectDllContext*>(req->data);

  Local<Value> err = Null();
  if (context->error.is_error()) {
    err = Exception::Error(Nan::New(context->error.message().c_str()).ToLocalChecked());
  }

  Local<Value> argv[] = { err };
  context->callback.Call(Nan::New<Object>(context->self), 1, argv);

  context->self.Reset();
  delete context;
}

void WrappedProcess::InjectDll(const FunctionCallbackInfo<Value>& info) {
  assert(info.Length() == 4);
  assert(info[3]->IsFunction());

  InjectDllContext* context = new InjectDllContext();
  context->dll_path = ToWstring(To<String>(info[0]).ToLocalChecked());
  context->inject_func = *Utf8String(To<String>(info[1]).ToLocalChecked());
  context->error_dump_file = *Utf8String(To<String>(info[2]).ToLocalChecked());
  context->callback.Reset(info[3].As<Function>());
  context->self.Reset(info.This());
  context->process = WrappedProcess::Unwrap(info);
  context->req.data = context;
  uv_queue_work(uv_default_loop(), &context->req, InjectDllWork, InjectDllAfter);
}

void WrappedProcess::Resume(const FunctionCallbackInfo<Value>& info) {
  Process* process = WrappedProcess::Unwrap(info);

  WindowsError error = process->Resume();
  if (error.is_error()) {
    info.GetReturnValue().Set(
        Exception::Error(Nan::New(error.message().c_str()).ToLocalChecked()));
  }
}

void WrappedProcess::Terminate(const FunctionCallbackInfo<Value>& info) {
  Process* process = WrappedProcess::Unwrap(info);

  WindowsError error = process->Terminate();
  if (error.is_error()) {
    info.GetReturnValue().Set(
      Exception::Error(Nan::New(error.message().c_str()).ToLocalChecked()));
  }
}

struct WaitForExitContext {
  uv_work_t req;
  Callback callback;
  Persistent<Object> self;
  Process* process;

  unique_ptr<WindowsError> error;
  uint32_t exit_code;
};

void WaitForExitWork(uv_work_t* req) {
  WaitForExitContext* context = reinterpret_cast<WaitForExitContext*>(req->data);

  context->error.reset(new WindowsError(context->process->WaitForExit()));
  if (context->error->is_error()) {
    return;
  }

  context->error.reset(new WindowsError(context->process->GetExitCode(&context->exit_code)));
}

void WaitForExitAfter(uv_work_t* req, int status) {
  HandleScope scope;
  WaitForExitContext* context = reinterpret_cast<WaitForExitContext*>(req->data);

  Local<Value> err = Null();
  Local<Value> code = Undefined();
  if (context->error->is_error()) {
    err = Exception::Error(Nan::New(
      reinterpret_cast<const uint16_t*>(context->error->message().c_str())).ToLocalChecked());
  } else {
    code = Nan::New(context->exit_code);
  }

  Local<Value> argv[] = { err, code };
  context->callback.Call(Nan::New<Object>(context->self), 2, argv);

  context->self.Reset();
  delete context;
}

void WrappedProcess::WaitForExit(const FunctionCallbackInfo<Value>& info) {
  assert(info.Length() == 1);
  assert(info[0]->IsFunction());

  WaitForExitContext* context = new WaitForExitContext;
  context->callback.Reset(info[0].As<Function>());
  context->self.Reset(info.This());
  context->process = WrappedProcess::Unwrap(info);
  context->req.data = context;
  uv_queue_work(uv_default_loop(), &context->req, WaitForExitWork, WaitForExitAfter);
}

}  // namespace proc
}  // namespace sbat