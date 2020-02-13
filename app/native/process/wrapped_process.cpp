#define _WIN32_WINNT 0x601 // Win7; Needed for Wow64GetThreadSelectorEntry
#include "wrapped_process.h"

#include <node.h>
#include <assert.h>
#include <DbgHelp.h>
#include <nan.h>
#include <TlHelp32.h>
#include <windows.h>
#include <stdio.h>
#include <array>
#include <condition_variable>
#include <iterator>
#include <memory>
#include <mutex>
#include <string>
#include <thread>
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
using std::array;
using std::string;
using std::tuple;
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
    MiniDumpWithFullMemory, NULL, NULL, NULL);
  if (!success) {
    return WindowsError("CreateMiniDump -> MiniDumpWriteDump", GetLastError());
  }
  return WindowsError();
}

static WindowsError GetRemoteModuleHandle(uint32_t process_id, const string& module,
    HMODULE* handle_out) {
  *handle_out = nullptr;
  MODULEENTRY32 mod_entry = {};
  WinHandle tlh(CreateToolhelp32Snapshot(TH32CS_SNAPMODULE | TH32CS_SNAPMODULE32, process_id));
  uint32_t tries = 1;
  while (tlh.get() == INVALID_HANDLE_VALUE && tries < 100) {
    Sleep(10);
    tlh.Reset(CreateToolhelp32Snapshot(TH32CS_SNAPMODULE | TH32CS_SNAPMODULE32, process_id));
    tries++;
  }

  if (tlh.get() == INVALID_HANDLE_VALUE) {
    return WindowsError("GetRemoteModuleHandle -> CreateToolhelp32Snapshot", GetLastError());
  }

  mod_entry.dwSize = sizeof(MODULEENTRY32);
  Module32First(tlh.get(), &mod_entry);
  do {
    if (!_stricmp(mod_entry.szModule, module.c_str())) {
      *handle_out = mod_entry.hModule;
      return WindowsError();
    }
    mod_entry.dwSize = sizeof(MODULEENTRY32);
  } while (Module32Next(tlh.get(), &mod_entry));

  return WindowsError("GetRemoteModuleHandle -> End of search", ERROR_MOD_NOT_FOUND);
}

static WindowsError GetRemoteModuleExportDirectory(HANDLE proc_handle, HMODULE remote_module,
    const IMAGE_DOS_HEADER& dos_header, const IMAGE_NT_HEADERS32& nt_headers,
    IMAGE_EXPORT_DIRECTORY* export_directory_out) {
  *export_directory_out = IMAGE_EXPORT_DIRECTORY();

  uintptr_t remote_base = reinterpret_cast<uintptr_t>(remote_module);

  vector<byte> pe_header(1000);
  if (!ReadProcessMemory(proc_handle, reinterpret_cast<void*>(remote_base), &pe_header[0],
      1000, nullptr)) {
    return WindowsError("GetRemoteModuleExportDirectory -> Read PE header", GetLastError());
  }

  IMAGE_SECTION_HEADER* image_section_header = reinterpret_cast<IMAGE_SECTION_HEADER*>(
      &pe_header[dos_header.e_lfanew + sizeof(IMAGE_NT_HEADERS32)]);

  for (uint32_t i = 0; i < nt_headers.FileHeader.NumberOfSections; i++, image_section_header++) {
    if (!image_section_header)
      continue;

    if (_stricmp(reinterpret_cast<char*>(image_section_header->Name), ".edata") == 0) {
      if (!ReadProcessMemory(proc_handle,
          reinterpret_cast<void*>(static_cast<uintptr_t>(image_section_header->VirtualAddress)),
          export_directory_out, sizeof(IMAGE_EXPORT_DIRECTORY), nullptr)) {
        continue;
      }

      return WindowsError();
    }

  }

  uintptr_t eat_address =
      static_cast<uintptr_t>(nt_headers.OptionalHeader.DataDirectory[0].VirtualAddress);
  if (!eat_address) {
    return WindowsError("GetRemoteModuleExportDirectory -> Get EAT address", ERROR_MOD_NOT_FOUND);
  }

  if (!ReadProcessMemory(proc_handle, reinterpret_cast<void*>(remote_base + eat_address),
      export_directory_out, sizeof(IMAGE_EXPORT_DIRECTORY), nullptr)) {
    return WindowsError("GetRemoteModuleExportDirectory -> Read EAT address", GetLastError());
  }

  return WindowsError();
}

// TODO(tec27): if this were split out differently (e.g. if reading the export table and such were
// separate), this could be more efficient about how many times it reads from the remote proc for a
// multi-function search in the same module
static WindowsError GetRemoteFuncAddress(HANDLE proc_handle, const string& module,
    const string& func_name, void** func_address_out) {
  *func_address_out = nullptr;
  uint32_t proc_id = GetProcessId(proc_handle);
  HMODULE remote_module;
  WindowsError result = GetRemoteModuleHandle(proc_id, module, &remote_module);
  if (result.is_error()) {
    return result;
  }

  uintptr_t remote_base = reinterpret_cast<uintptr_t>(remote_module);

  IMAGE_DOS_HEADER dos_header = {};
  if (!ReadProcessMemory(proc_handle, reinterpret_cast<void*>(remote_base), &dos_header,
      sizeof(IMAGE_DOS_HEADER), nullptr) || dos_header.e_magic != IMAGE_DOS_SIGNATURE) {
    return WindowsError("GetRemoteFuncAddress -> Read DOS Header", GetLastError());
  }

  IMAGE_NT_HEADERS32 nt_headers = {};
  if (!ReadProcessMemory(proc_handle, reinterpret_cast<void*>(remote_base + dos_header.e_lfanew),
      &nt_headers, sizeof(IMAGE_NT_HEADERS32), nullptr) ||
      nt_headers.Signature != IMAGE_NT_SIGNATURE) {
    return WindowsError("GetRemoteFuncAddress -> Read NT Headers", GetLastError());
  }

  IMAGE_EXPORT_DIRECTORY export_dir = {};
  result = GetRemoteModuleExportDirectory(proc_handle, remote_module, dos_header,
      nt_headers, &export_dir);
  if (result.is_error()) {
    return result;
  }

  vector<uint32_t> function_addresses(export_dir.NumberOfFunctions);
  vector<uint32_t> name_addresses(export_dir.NumberOfNames);
  vector<uint16_t> ordinals(export_dir.NumberOfNames);

  if (!ReadProcessMemory(proc_handle,
      reinterpret_cast<void*>(remote_base + export_dir.AddressOfFunctions),
      &function_addresses[0], export_dir.NumberOfFunctions * sizeof(uint32_t), nullptr)) {
    return WindowsError("GetRemoteFuncAddress -> Read AddressOfFunctions", GetLastError());
  }

  if (!ReadProcessMemory(proc_handle,
      reinterpret_cast<void*>(remote_base + export_dir.AddressOfNames),
      &name_addresses[0], export_dir.NumberOfNames * sizeof(uint32_t), nullptr)) {
    return WindowsError("GetRemoteFuncAddress -> Read AddressOfNames", GetLastError());
  }

  if (!ReadProcessMemory(proc_handle,
      reinterpret_cast<void*>(remote_base + export_dir.AddressOfNameOrdinals),
      &ordinals[0], export_dir.NumberOfNames * sizeof(uint16_t), nullptr)) {
    return WindowsError("GetRemoteFuncAddress -> Read AddressOfNameOrdinals", GetLastError());
  }

  uintptr_t export_base = remote_base +
      nt_headers.OptionalHeader.DataDirectory[IMAGE_DIRECTORY_ENTRY_EXPORT].VirtualAddress;
  uintptr_t export_end = export_base +
      nt_headers.OptionalHeader.DataDirectory[IMAGE_DIRECTORY_ENTRY_EXPORT].Size;

  vector<char> cur_func_name(256);
  vector<char> cur_module_name(256);
  vector<char> cur_func_redirect(256);

  for (uint32_t i = 0; i < export_dir.NumberOfNames; i++) {
    uintptr_t func_address = remote_base + function_addresses[i];
    uintptr_t name_address = remote_base + name_addresses[i];

    std::fill(cur_func_name.begin(), cur_func_name.end(), 0);

    if (!ReadProcessMemory(proc_handle, reinterpret_cast<void*>(name_address), &cur_func_name[0],
        256, nullptr)) {
      continue;
    }

    if (_stricmp(&cur_func_name[0], func_name.c_str()) != 0) {
      continue;
    }

    // Check if address of function is found in another module
    if (func_address >= export_base && func_address <= export_end) {
      std::fill(cur_func_name.begin(), cur_func_name.end(), 0);

      if (!ReadProcessMemory(proc_handle, reinterpret_cast<void*>(func_address), &cur_func_name[0],
          256, nullptr)) {
        continue;
      }

      std::fill(cur_module_name.begin(), cur_module_name.end(), 0);
      std::fill(cur_func_redirect.begin(), cur_func_redirect.end(), 0);

      uint32_t j = 0;
      for (; cur_func_name[j] != '.' && j < cur_func_name.size(); j++)
        cur_module_name[j] = cur_func_name[j];
      j++;
      if (j >= cur_func_name.size()) {
        continue;
      }
      cur_module_name[j] = '\0';

      uint32_t k = 0;
      for (; cur_func_name[j] != '\0' && j < cur_func_name.size(); j++, k++)
        cur_func_redirect[k] = cur_func_name[j];
      k++;
      if (k >= cur_func_redirect.size()) {
        continue;
      }
      cur_func_redirect[k] = '\0';

      strcat_s(&cur_module_name[0], cur_module_name.size(), ".dll");

      return GetRemoteFuncAddress(
          proc_handle, cur_module_name.data(), cur_func_redirect.data(), func_address_out);
    }

    WORD ordinal_value = ordinals[i];
    if (ordinal_value >= export_dir.NumberOfNames) {
      return WindowsError("GetRemoteFuncAddress -> Ordinal lookup", ERROR_INVALID_DATA);
    }

    *func_address_out = ordinal_value == i ?
      reinterpret_cast<void*>(func_address) :
      reinterpret_cast<void*>(remote_base + function_addresses[ordinal_value]);
    return WindowsError();
  }

  return WindowsError("GetRemoteFuncAddress -> End of search", ERROR_PROC_NOT_FOUND);
}

struct InjectContext {
  wchar_t dll_path[MAX_PATH];
  char inject_proc_name[256];

  // Note that these are explicitly made 32-bit so they work in our 32-bit target without adjustment
  // for the injector's 64-bit-ness
  uint32_t LoadLibraryW;
  uint32_t GetProcAddress;
  uint32_t GetLastError;
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

// Using WaitForDebugEvent requires calling it from same thread as
// CreateProcessW was called, so we need another thread separate
// from libuv threads.
//
// There's no function to clean the one thread that will be started.
// Shouldn't matter.
static std::thread *worker_thread = nullptr;
static std::once_flag worker_thread_init;
// Maybe having separate worker/parent ones isn't necessary, but
// I don't really want to think about this more than this.
static std::mutex worker_lock;
static std::mutex parent_lock;
static std::condition_variable worker_signal;
static std::condition_variable parent_signal;
static unique_ptr<std::function<void()>> thread_queue_task;

static void WorkerThread() {
  std::unique_lock<std::mutex> lock(worker_lock);
  while (true) {
    if (thread_queue_task.get() == nullptr) {
      worker_signal.wait(lock);
      continue;
    }
    std::function<void()> *task = thread_queue_task.get();
    lock.unlock();
    (*task)();
    parent_signal.notify_one();
    lock.lock();
    thread_queue_task.reset(nullptr);
  }
}

// Blocks until the work is complete.
void DoWorkOnWorkerThread(std::function<void()> task) {
  std::call_once(worker_thread_init, [](){ worker_thread = new std::thread(WorkerThread); });
  {
    std::lock_guard<std::mutex> lock(worker_lock);
    thread_queue_task.reset(new std::function<void()>(task));
  }
  std::unique_lock<std::mutex> lock(parent_lock);
  worker_signal.notify_one();
  parent_signal.wait(lock);
}

Process::Process(const wstring& app_path, const wstring& arguments, bool launch_suspended,
  bool debugger_launch, const wstring& current_dir, const vector<wstring>& environment,
  std::function<void(const std::string &)> log_callback)
  : process_handle_(),
  thread_handle_(),
  error_(),
  debugger_launch_(debugger_launch),
  log_callback_(log_callback) {

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

  auto flags = CREATE_UNICODE_ENVIRONMENT;
  if (launch_suspended) {
    flags |= CREATE_SUSPENDED;
  }
  if (debugger_launch) {
    flags |= DEBUG_PROCESS;
  }
  PROCESS_INFORMATION process_info;
  DoWorkOnWorkerThread([&]() {
    if (!CreateProcessW(app_path.c_str(), &arguments_writable[0], nullptr, nullptr, false, flags,
      &env_param[0], current_dir.c_str(),
      &startup_info, &process_info)) {
      error_ = WindowsError("Process -> CreateProcessW", GetLastError());
      return;
    }

    process_handle_.Reset(process_info.hProcess);
    thread_handle_.Reset(process_info.hThread);
  });
}

Process::~Process() {
}

bool Process::has_errors() const {
  return error_.is_error();
}

WindowsError Process::error() const {
  return error_;
}

void Process::LogMessage(const char *fmt, ...) {
  char buf[256];
  va_list args;
  va_start(args, fmt);
  vsnprintf(buf, sizeof(buf), fmt, args);
  log_callback_(string(buf));
  va_end(args);
}

// Workaround for injecting into suspended processes, where the necessary NT header structures are
// not initialized. By creating a dummy thread that just returns, we get Windows to fill out all the
// things we need, while not actually advancing the threads we want to keep at bay.
WindowsError Process::NtForceLdrInitializeThunk() {
  byte injected_code[] = {0xC3 /* RET */};
  ScopedVirtualAlloc remote_proc(process_handle_.get(), nullptr, sizeof(injected_code), MEM_COMMIT,
      PAGE_EXECUTE_READWRITE);
  if (remote_proc.has_errors()) {
    return WindowsError("NtForceLdrInitializeThunk -> VirtualAllocEx", GetLastError());
  }

  SIZE_T bytes_written;
  BOOL success = WriteProcessMemory(process_handle_.get(), remote_proc.get(), &injected_code,
    sizeof(injected_code), &bytes_written);
  if (!success || bytes_written != sizeof(injected_code)) {
    return WindowsError("NtForceLdrInitializeThunk -> WriteProcessMemory", GetLastError());
  }

  WinHandle thread_handle(CreateRemoteThread(process_handle_.get(), NULL, 0,
    reinterpret_cast<LPTHREAD_START_ROUTINE>(remote_proc.get()), nullptr, 0, nullptr));
  if (thread_handle.get() == NULL) {
    return WindowsError("NtForceLdrInitializeThunk -> CreateRemoteThread", GetLastError());
  }

  uint32_t wait_result = WaitForSingleObject(thread_handle.get(), 5000);
  if (wait_result == WAIT_TIMEOUT) {
    return WindowsError("NtForceLdrInitializeThunk -> WaitForSingleObject", WAIT_TIMEOUT);
  } else if (wait_result == WAIT_FAILED) {
    return WindowsError("NtForceLdrInitializeThunk -> WaitForSingleObject", GetLastError());
  }

  return WindowsError();
}

// Receives the address of Process Environment Block for a process.
static WindowsError NtApi_GetPebAddress(HANDLE process, HANDLE thread, uintptr_t *result) {
  WOW64_CONTEXT context = { 0 };
  context.ContextFlags = WOW64_CONTEXT_SEGMENTS;
  auto ok = Wow64GetThreadContext(thread, &context);
  if (ok == 0) {
    return WindowsError("NtApi_GetPebAddress -> GetThreadContext", GetLastError());
  }
  WOW64_LDT_ENTRY entry = { 0 };
  ok = Wow64GetThreadSelectorEntry(thread, context.SegFs, &entry);
  if (ok == 0) {
    return WindowsError("NtApi_GetPebAddress -> GetThreadSelectorEntry", GetLastError());
  }
  byte entry_bytes[8];
  memcpy(&entry_bytes, &entry, 8);
  uint32_t teb = static_cast<uint32_t>(entry_bytes[2]) |
    (static_cast<uint32_t>(entry_bytes[3]) << 8) |
    (static_cast<uint32_t>(entry_bytes[4]) << 16) |
    (static_cast<uint32_t>(entry_bytes[7]) << 24);

  uint32_t addr = 0;
  SIZE_T bytes_read = 0;
  ok = ReadProcessMemory(process, (void *)((uintptr_t)teb + 0x30), &addr, 4, &bytes_read);
  if (ok == 0 || bytes_read != 4) {
    return WindowsError("NtApi_GetPebAddress -> ReadProcessMemory", GetLastError());
  } else {
    *result = addr;
    return WindowsError();
  }
}

struct UnicodeString {
  uint16_t size;
  uint16_t capacity;
  uint32_t pointer;
};

struct LdrDataTableEntry32 {
  uint32_t reserved1[2];
  uint32_t links[2];
  uint32_t reserved2[2];
  uint32_t dll_base;
  uint32_t entry;
  uint32_t reserved3;
  UnicodeString dll_name;
};

// Effectively GetModuleHandle(NULL) but for a another process,
// works early during process initialization. (Haven't actually confirmed if this
// trickery is necessary or if the Toolhelp32 APIs could be still used)
//
// Can return base == 0 without error if the process needs to initialize further.
WindowsError Process::NtApi_ExeBase(uintptr_t *base) {
  HANDLE process = process_handle_.get();
  HANDLE thread = thread_handle_.get();
  *base = 0;

  uintptr_t peb_address = 0;
  WindowsError error = NtApi_GetPebAddress(process, thread, &peb_address);
  if (error.is_error()) {
    return error;
  }

  uint32_t peb[0x10];
  SIZE_T bytes_read = 0;
  auto ok = ReadProcessMemory(process, (void *)peb_address, peb, 0x40, &bytes_read);
  if (ok == 0 || bytes_read != 0x40) {
    return WindowsError("NtApi_ExeBase -> ReadProcessMemory", GetLastError());
  }
  uint32_t peb_ldr = peb[0x3];
  if (peb_ldr == 0) {
    // Not ready
    return WindowsError();
  }
  uint32_t module = 0;
  ok = ReadProcessMemory(process, (void *)((uintptr_t)peb_ldr + 0x14), &module, 4, &bytes_read);
  if (ok == 0 || bytes_read != 4) {
    return WindowsError("NtApi_ExeBase -> ReadProcessMemory(2)", GetLastError());
  }
  while (module != 0 && module != peb_ldr + 0x14) {
    LdrDataTableEntry32 entry = { 0 };
    ok = ReadProcessMemory(process, (void *)(uintptr_t)(module - 8), &entry, sizeof(entry), &bytes_read);
    if (ok == 0 || bytes_read != sizeof(entry)) {
      return WindowsError("NtApi_ExeBase -> ReadProcessMemory(3)", GetLastError());
    }
    if (entry.dll_base == 0) {
      // Not ready
      return WindowsError();
    }
    vector<uint16_t> dll_name;
    // UNICODE_STRING.size is in bytes, not including last null character
    dll_name.resize(entry.dll_name.size / 2);
    ok = ReadProcessMemory(process, (void *)(uintptr_t)entry.dll_name.pointer, dll_name.data(),
        entry.dll_name.size, &bytes_read);
    if (ok == 0 || bytes_read != entry.dll_name.size) {
      return WindowsError("NtApi_ExeBase -> ReadProcessMemory(4)", GetLastError());
    }
    vector<byte> dll_name_ascii;
    for (uint16_t val : dll_name) {
      dll_name_ascii.push_back(val);
    }
    dll_name_ascii.push_back(0);
    LogMessage("Found module %s, %08x %08x %08x", dll_name_ascii.data(), entry.dll_base, entry.entry, entry.reserved3);
    // Lazy u16 compare case insensitive L".exe"
    if (
        (dll_name.size() > 4) &&
        ((dll_name[dll_name.size() - 1] | 0x20) == 'e') &&
        ((dll_name[dll_name.size() - 2] | 0x20) == 'x') &&
        ((dll_name[dll_name.size() - 3] | 0x20) == 'e') &&
        (dll_name[dll_name.size() - 4] == '.')
    ) {
      *base = entry.dll_base;
      return WindowsError();
    }
    module = entry.links[0];
  }
  return WindowsError();
}

static WindowsError TryHideDebugger(HANDLE process, HANDLE thread, bool *was_hidden) {
  uintptr_t address = 0;
  WindowsError error = NtApi_GetPebAddress(process, thread, &address);
  if (error.is_error()) {
    // This can fail if initialization is too early, just return success + false
    *was_hidden = false;
    return WindowsError();
  }
  SIZE_T bytes_written;
  uint8_t zero = 0;
  BOOL success = WriteProcessMemory(process, (void *)(address + 2), &zero, 1, &bytes_written);
  if (!success || bytes_written != 1) {
    return WindowsError("TryHideDebugger -> WriteProcessMemory", GetLastError());
  }
  *was_hidden = true;
  return WindowsError();
}

static WindowsError IsEipInRange(HANDLE thread, uintptr_t start, unsigned int len, bool *result) {
  *result = false;
  WOW64_CONTEXT context = { 0 };
  context.ContextFlags = WOW64_CONTEXT_INTEGER | WOW64_CONTEXT_CONTROL;
  auto ok = Wow64GetThreadContext(thread, &context);
  if (ok == 0) {
    return WindowsError("IsEipInRange -> GetThreadContext", GetLastError());
  }
  *result = context.Eip >= start && context.Eip < start + len;
  return WindowsError();
}

static uint32_t ReadU32(const vector<byte> &bytes, uintptr_t offset) {
  if (offset > bytes.size() - 4) {
    return 0;
  }
  uint32_t value = 0;
  memcpy(&value, &bytes[offset], 4);
  return value;
}

static uint16_t ReadU16(const vector<byte> &bytes, uintptr_t offset) {
  if (offset > bytes.size() - 2) {
    return 0;
  }
  uint16_t value = 0;
  memcpy(&value, &bytes[offset], 2);
  return value;
}

WindowsError Process::FirstTlsCallback(uintptr_t base, uintptr_t *out) {
  vector<byte> image;
  auto error = ReadModuleImage(base, &image);
  if (error.is_error()) {
    return error;
  }
  auto pe_header = ReadU32(image, 0x3c);
  auto tls_section_rva = ReadU32(image, pe_header + 0xc0);
  auto tls_section_length = ReadU32(image, pe_header + 0xc4);
  if (tls_section_rva == 0 || tls_section_length < 0x10) {
    return WindowsError("No TLS Callbacks", 1);
  }
  auto callbacks = ReadU32(image, tls_section_rva + 0xc);
  if (callbacks == 0) {
    return WindowsError("No TLS Callbacks", 1);
  }
  auto first_cb = ReadU32(image, callbacks - base);
  if (first_cb == 0) {
    return WindowsError("No TLS Callbacks", 1);
  } else {
    *out = first_cb;
    return WindowsError();
  }
}

WindowsError Process::ReadModuleImage(uintptr_t base, vector<byte> *out) {
  vector<byte> buffer;
  buffer.resize(0x1000);
  byte *data = buffer.data();
  WindowsError error = ReadMemoryTo((void *)base, data, 0x1000);
  if (error.is_error()) {
    return error;
  }

  auto pe_header = ReadU32(buffer, 0x3c);
  auto section_count = ReadU16(buffer, pe_header + 6);
  for (uint16_t i = 0; i < section_count; i++) {
    auto address = ReadU32(buffer, pe_header + 0xf8 + 0x28 * i + 0xc);
    auto size = ReadU32(buffer, pe_header + 0xf8 + 0x28 * i + 0x8);
    if (buffer.size() < address + size) {
      buffer.resize(address + size);
    }
    byte *data = buffer.data();
    auto error = ReadMemoryTo((void *)(uintptr_t)(base + address), data + address, size);
    if (error.is_error()) {
      LogMessage("Failed to read %08x : %x", address, size);
      return error;
    }
  }
  *out = std::move(buffer);
  return WindowsError();
}

WindowsError Process::ReadMemory(void *address, size_t length, vector<byte> *out) {
  vector<byte> buffer;
  buffer.resize(length);
  auto error = ReadMemoryTo(address, buffer.data(), length);
  if (error.is_error()) {
    return error;
  } else {
    *out = std::move(buffer);
    return WindowsError();
  }
}

WindowsError Process::ReadMemoryTo(void *address, byte *out, size_t length) {
  SIZE_T bytes_read = 0;
  auto ok = ReadProcessMemory(process_handle_.get(), address, out, length, &bytes_read);
  if (ok == 0 || bytes_read != length) {
    return WindowsError("ReadMemoryTo", GetLastError());
  } else {
    return WindowsError();
  }
}

// This does not work with Wine :(
// Returns TLS callback entry that was hooked and which can be then jumped to.
WindowsError Process::DebugUntilTlsCallback(void **tls_callback_entry) {
  *tls_callback_entry = nullptr;
  bool debugger_hidden = false;
  DEBUG_EVENT debug_event = { 0 };
  // Address, length for additional patch asm that gets injected over TLS callback
  uintptr_t exe_patch_region_start = 0;
  unsigned int exe_patch_region_len = 0;
  // Address, original code for the TLS callback that was written over
  void *tls_callback_address = nullptr;
  vector<uint8_t> tls_callback_orig;
  WindowsError error;
  while (true) {
    if (!debugger_hidden) {
      error = TryHideDebugger(process_handle_.get(), thread_handle_.get(), &debugger_hidden);
      if (error.is_error()) {
        return error;
      }
    }
    // After the TLS callback has been patched, we just want the execution to get
    // stuck on the infinite loop of the patch, even if there aren't debug events.
    unsigned debug_wait_timeout = exe_patch_region_len == 0 ? INFINITE : 5;
    uint32_t debug_event_ok = WaitForDebugEvent(&debug_event, debug_wait_timeout);
    if (debug_event_ok == 0) {
      auto error = GetLastError();
      if (error != ERROR_SEM_TIMEOUT) {
        return WindowsError("DebugUntilTlsCallback -> WaitForDebugEvent", error);
      }
    }
    if (debug_event.dwDebugEventCode == 1) {
      auto record = &debug_event.u.Exception.ExceptionRecord;
      LogMessage("Exception %08x @ %08llx", record->ExceptionCode, (uintptr_t)record->ExceptionAddress);
    }
    // Check if the thread has reached patch infloop
    if (exe_patch_region_len != 0) {
      bool is_at_infloop = false;
      error = IsEipInRange(thread_handle_.get(), exe_patch_region_start, exe_patch_region_len,
          &is_at_infloop);
      if (error.is_error()) {
        return error;
      }
      if (is_at_infloop) {
        // Break while(true) {}
        // If we got a debug event that wasn't for this thread, let that thread continue.
        if (GetThreadId(thread_handle_.get()) != debug_event.dwThreadId) {
          ContinueDebugEvent(debug_event.dwProcessId, debug_event.dwThreadId, 0x00010002);
        }
        LogMessage("Ready to inject");
        break;
      }
    } else {
      // If process intialization has gotten far enough that windows has loaded the
      // main executable it in memory (It isn't initially loaded), find its TLS
      // callbacks and patch over them
      uintptr_t base = 0;
      size_t size = 0;
      error = NtApi_ExeBase(&base);
      if (error.is_error()) {
        return error;
      }
      if (base != 0) {
        LogMessage("Got exe base %08llx", base);
        uintptr_t tls_address = 0;
        error = FirstTlsCallback(base, &tls_address);
        if (error.is_error()) {
          return error;
        }
        LogMessage("TLS callback at %08llx", tls_address);
        const byte infloop_inject[] = {
          0x83, 0x7c, 0xe4, 0x08, 0x01,   // cmp dword [esp + 8], 1
          0x74, 0x06,                     // je loop
                                          // back:
          0x31, 0xc0,                     // xor eax, eax
          0x40,                           // inc eax
          0xc2, 0x0c, 0x00,               // ret 0xc
                                          // loop:
          0xf3, 0x90,                     // pause
          0xeb, 0xfc,                     // jmp ~pause
          0xeb, 0xf4,                     // jmp back
        };
        // Leaking this allocation since it's hard to guarantee no thread is executing this.
        void *infloop_address = VirtualAllocEx(process_handle_.get(), nullptr,
            sizeof(infloop_inject), MEM_COMMIT, PAGE_EXECUTE_READWRITE);
        if (infloop_address == nullptr) {
          return WindowsError("DebugUntilTlsCallback -> VirtualAllocEx", GetLastError());
        }
        SIZE_T bytes_written;
        BOOL success = WriteProcessMemory(process_handle_.get(), infloop_address, infloop_inject,
          sizeof(infloop_inject), &bytes_written);
        if (!success || bytes_written != sizeof(infloop_inject)) {
          return WindowsError("DebugUntilTlsCallback -> WriteProcessMemory(Infloop inject)", GetLastError());
        }
        byte tls_entry_inject[] = {
          0xb8, 0x00, 0x00, 0x00, 0x00, // mov eax, X
          0xff, 0xe0, // jmp eax
        };
        memcpy(tls_entry_inject + 1, &infloop_address, 4);
        vector<byte> orig;
        error = ReadMemory((void *)tls_address, sizeof(tls_entry_inject), &orig);
        if (error.is_error()) {
          return error;
        }
        success = WriteProcessMemory(process_handle_.get(), (void *)tls_address, tls_entry_inject,
          sizeof(tls_entry_inject), &bytes_written);
        if (!success || bytes_written != sizeof(tls_entry_inject)) {
          return WindowsError("DebugUntilTlsCallback -> WriteProcessMemory(TLS entry inject)", GetLastError());
        }
        tls_callback_address = (void *)tls_address;
        tls_callback_orig = orig;
        // The region we want the execution to get stuck is only 4 last bytes of infloop_inject
        exe_patch_region_start = (uintptr_t)infloop_address + sizeof(infloop_inject) - 4;
        exe_patch_region_len = 4;
        LogMessage("TLS callback infloop at %08llx", exe_patch_region_start);
      }
    }
    ContinueDebugEvent(debug_event.dwProcessId, debug_event.dwThreadId, 0x00010002);
  }
  // mov edi, edi - nop over 'jmp ~pause'
  const byte nop[] = { 0x89, 0xff };
  SIZE_T bytes_written;
  BOOL success = WriteProcessMemory(process_handle_.get(), (void *)(exe_patch_region_start + 2),
    nop, sizeof(nop), &bytes_written);
  if (!success || bytes_written != sizeof(nop)) {
    return WindowsError("DebugUntilTlsCallback -> WriteProcessMemory(Nop)", GetLastError());
  }
  success = WriteProcessMemory(process_handle_.get(), tls_callback_address, &tls_callback_orig[0],
    tls_callback_orig.size(), &bytes_written);
  if (!success || bytes_written != tls_callback_orig.size()) {
    return WindowsError("DebugUntilTlsCallback -> WriteProcessMemory(Restore TLS)", GetLastError());
  }
  *tls_callback_entry = tls_callback_address;
  return WindowsError("(No error)", 0);
}

// Sets up a stack frame on thread to call `remote_proc` with `arg` returning to `ret`
WindowsError Process::SetupCall(void *remote_proc, void *arg, void *ret) {
  HANDLE process = process_handle_.get();
  HANDLE thread = thread_handle_.get();
  WOW64_CONTEXT context = { 0 };
  context.ContextFlags = WOW64_CONTEXT_INTEGER | WOW64_CONTEXT_CONTROL;
  auto ok = Wow64GetThreadContext(thread, &context);
  if (ok == 0) {
    return WindowsError("SetupCall -> GetThreadContext", GetLastError());
  }
  uint32_t stack_data[2] = { (uint32_t)(uintptr_t)ret, (uint32_t)(uintptr_t)arg };
  context.Esp -= 8;
  context.Eip = (uint32_t)(uintptr_t)remote_proc;
  LogMessage("Overriding Eip to %08x", context.Eip);
  SIZE_T bytes_written;
  BOOL success = WriteProcessMemory(process, (void *)(uintptr_t)context.Esp, &stack_data, 8,
      &bytes_written);
  if (!success || bytes_written != 8) {
    return WindowsError("SetupCall -> WriteProcessMemory", GetLastError());
  }
  ok = Wow64SetThreadContext(thread, &context);
  if (ok == 0) {
    return WindowsError("SetupCall -> SetThreadContext", GetLastError());
  }
  return WindowsError();
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

  void *tls_callback_entry = nullptr;
  if (debugger_launch_) {
    WindowsError result;
    DoWorkOnWorkerThread([this, &tls_callback_entry, &result]() {
      result = DebugUntilTlsCallback(&tls_callback_entry);
    });
    if (result.is_error()) {
      return result;
    }
  } else {
    // Force Windows to init the data structures necessary to get remote function addresses
    NtForceLdrInitializeThunk();
  }

  uintptr_t temp_ptr;
  WindowsError result = GetRemoteFuncAddress(process_handle_.get(), "kernel32.dll", "LoadLibraryW",
      reinterpret_cast<void**>(&temp_ptr));
  if (result.is_error()) {
    return result;
  }
  if (temp_ptr > 0xFFFFFFFFLLU) {
    return WindowsError("InjectDll -> LoadLibraryW Address", ERROR_BAD_LENGTH);
  }
  context.LoadLibraryW = static_cast<uint32_t>(temp_ptr);

  result = GetRemoteFuncAddress(process_handle_.get(), "kernel32.dll", "GetProcAddress",
    reinterpret_cast<void**>(&temp_ptr));
  if (result.is_error()) {
    return result;
  }
  if (temp_ptr > 0xFFFFFFFFLLU) {
    return WindowsError("InjectDll -> GetProcAddress Address", ERROR_BAD_LENGTH);
  }
  context.GetProcAddress = static_cast<uint32_t>(temp_ptr);

  result = GetRemoteFuncAddress(process_handle_.get(), "kernel32.dll", "GetLastError",
    reinterpret_cast<void**>(&temp_ptr));
  if (result.is_error()) {
    return result;
  }
  if (temp_ptr > 0xFFFFFFFFLLU) {
    return WindowsError("InjectDll -> GetProcAddress Address", ERROR_BAD_LENGTH);
  }
  context.GetLastError = static_cast<uint32_t>(temp_ptr);

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

  if (debugger_launch_) {
    result = SetupCall(remote_proc, remote_context.get(), tls_callback_entry);
    // Will have to leak this as there's no synchronization to guarantee we aren't
    // executing the remote proc whenever we'd want to free this.
    remote_context.forget();
    if (result.is_error()) {
      return result;
    }
    DoWorkOnWorkerThread([this]() {
      auto process_id = GetProcessId(this->process_handle_.get());
      auto thread_id = GetThreadId(this->thread_handle_.get());
      ContinueDebugEvent(process_id, thread_id, 0x00010002);
      DebugActiveProcessStop(process_id);
      LogMessage("Stopped debugging pid %d", process_id);
    });
  } else {
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

    if (exit_code != 0) {
      auto err = CreateMiniDump(process_handle_.get(), error_dump_path);
      if (err.is_error()) {
        return err;
      }
      return WindowsError("InjectDll -> injection proc exit code (error dump saved)", exit_code);
    }
  }
  return WindowsError("(No error)", 0);
}

WindowsError Process::Resume() {
  if (has_errors()) {
    return error();
  }

  // Debugger launch doesn't keep the thread suspended after injection code is run, so
  // this ends up just being a nop. (It could, but would require adding synchronization
  // asm since the injection happens on the main thread.)
  if (!debugger_launch_) {
    if (ResumeThread(thread_handle_.get()) == -1) {
      return WindowsError("Process Resume -> ResumeThread", GetLastError());
    }
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

  constructor.Reset(Nan::GetFunction(tpl).ToLocalChecked());
}

void WrappedProcess::New(const FunctionCallbackInfo<Value>& info) {
  WrappedProcess* process = new WrappedProcess();
  process->Wrap(info.This());

  info.GetReturnValue().Set(info.This());
}

Local<Value> WrappedProcess::NewInstance(Process* process) {
  EscapableHandleScope scope;

  Local<Function> cons = Nan::New<Function>(constructor);
  Local<Object> instance = Nan::NewInstance(cons).ToLocalChecked();
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
  Nan::Call(context->callback, Nan::New<Object>(context->self), 1, argv);

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
  Nan::Call(context->callback, Nan::New<Object>(context->self), 2, argv);

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
