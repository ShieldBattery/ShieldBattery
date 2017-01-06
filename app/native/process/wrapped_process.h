#pragma once

#include <node.h>
#include <nan.h>

namespace sbat {
namespace proc {

class WindowsError {
public:
  WindowsError(std::string location, uint32_t error_code);
  WindowsError() : WindowsError("", 0) {}

  bool is_error() const;
  uint32_t code() const;
  std::string message() const;
  std::string location() const;

private:
  uint32_t code_;
  std::string location_;
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

class ScopedVirtualAlloc {
public:
  ScopedVirtualAlloc(HANDLE process_handle, void* address, size_t size, uint32_t allocation_type,
    uint32_t protection);
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

class Process {
public:
  Process(const std::wstring& app_path, const std::wstring& arguments, bool launch_suspended,
    const std::wstring& current_dir, const std::vector<std::wstring>& environment);
  ~Process();
  bool has_errors() const;
  WindowsError error() const;

  WindowsError InjectDll(const std::wstring& dll_path, const std::string& inject_function_name,
    const std::string& error_dump_path);
  WindowsError Resume();
  WindowsError Terminate();
  WindowsError WaitForExit(uint32_t max_wait_ms = INFINITE, bool* timed_out = nullptr);
  WindowsError GetExitCode(uint32_t* exit_code);
private:
  WindowsError NtForceLdrInitializeThunk();
  // Disable copying
  Process(const Process&) = delete;
  Process& operator=(const Process&) = delete;

  WinHandle process_handle_;
  WinHandle thread_handle_;
  WindowsError error_;
};

class WrappedProcess : public Nan::ObjectWrap {
public:
  static void Init();
  static v8::Local<v8::Value> NewInstance(Process* process);

private:
  WrappedProcess();
  ~WrappedProcess();
  void set_process(Process* process);

  // Disable copying
  WrappedProcess(const WrappedProcess&) = delete;
  WrappedProcess& operator=(const WrappedProcess&) = delete;

  static void New(const Nan::FunctionCallbackInfo<v8::Value>& info);
  static void InjectDll(const Nan::FunctionCallbackInfo<v8::Value>& info);
  static void Resume(const Nan::FunctionCallbackInfo<v8::Value>& info);
  static void Terminate(const Nan::FunctionCallbackInfo<v8::Value>& info);
  static void WaitForExit(const Nan::FunctionCallbackInfo<v8::Value>& info);

  static Nan::Persistent<v8::Function> constructor;

  template <class T>
  static Process* Unwrap(const T &t) {
    WrappedProcess* wrapped_process = Nan::ObjectWrap::Unwrap<WrappedProcess>(t.This());
    return wrapped_process->process_;
  }

  Process* process_;
};

}  // namespace proc
}  // namespace sbat
