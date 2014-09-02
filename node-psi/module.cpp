#include "node-psi/module.h"

#include <node.h>
#include <uv.h>
#include <v8.h>
#include <Windows.h>
#include <stdlib.h>
#include <string>

#include "common/win_helpers.h"
#include "v8-helpers/helpers.h"
#include "node-psi/wrapped_process.h"
#include "node-psi/wrapped_registry.h"
#include "psi/psi.h"

using std::wstring;
using v8::Arguments;
using v8::Boolean;
using v8::Context;
using v8::Exception;
using v8::Function;
using v8::FunctionTemplate;
using v8::Handle;
using v8::HandleScope;
using v8::Integer;
using v8::Local;
using v8::Object;
using v8::Persistent;
using v8::String;
using v8::ThrowException;
using v8::TryCatch;
using v8::Value;

namespace sbat {
namespace psi {

struct LaunchContext {
  uv_work_t req;
  wstring* app_path;
  wstring* arguments;
  bool launch_suspended;
  wstring* current_dir;
  Persistent<Function> callback;

  Process* process;
};

void LaunchWork(uv_work_t* req) {
  LaunchContext* context = reinterpret_cast<LaunchContext*>(req->data);

  context->process = new Process(*context->app_path, *context->arguments, context->launch_suspended,
      *context->current_dir);
}

void LaunchAfter(uv_work_t* req, int status) {
  HandleScope scope;
  LaunchContext* context = reinterpret_cast<LaunchContext*>(req->data);

  Local<Value> err = Local<Value>::New(v8::Null());
  Handle<Value> proc = Local<Value>::New(v8::Null());

  if (context->process->has_errors()) {
    err = Exception::Error(String::New(
        reinterpret_cast<const uint16_t*>(context->process->error().message().c_str())));
  } else {
    proc = WrappedProcess::NewInstance(context->process);
  }

  Handle<Value> argv[] = { err, proc };
  TryCatch try_catch;
  context->callback->Call(Context::GetCurrent()->Global(), 2, argv);

  context->callback.Dispose();
  delete context->app_path;
  delete context->arguments;
  delete context->current_dir;
  delete context;

  if (try_catch.HasCaught()) {
    node::FatalException(try_catch);
  }
}

Handle<Value> LaunchProcess(const Arguments& args) {
  HandleScope scope;

  assert(args.Length() == 5);
  assert(args[4]->IsFunction());

  LaunchContext* context = new LaunchContext;
  context->app_path = ToWstring(args[0]->ToString());
  context->arguments  = ToWstring(args[1]->ToString());
  context->launch_suspended = args[2]->ToBoolean()->BooleanValue();
  context->current_dir = ToWstring(args[3]->ToString());
  context->callback = Persistent<Function>::New(args[4].As<Function>());
  context->req.data = context;
  uv_queue_work(uv_default_loop(), &context->req, LaunchWork, LaunchAfter);

  return scope.Close(v8::Undefined());
}

struct ResContext {
  uv_work_t req;
  Persistent<Function> callback;

  uint32 exit_code;
  WindowsError error;
  ResolutionMessage message;
};

void DetectResolutionWork(uv_work_t* req) {
  ResContext* context = reinterpret_cast<ResContext*>(req->data);

  wchar_t path[MAX_PATH];
  GetModuleFileNameW(NULL, path, sizeof(path));

  wchar_t dir[_MAX_DIR];  //NOLINT
  _wsplitpath_s(path,
      nullptr, 0,
      dir, _MAX_DIR,
      nullptr, 0,
      nullptr, 0);
  wstring emitter_path = wstring(dir) + L"\\psi-emitter.exe";

  wchar_t* slot_name = new wchar_t[100];
  int size = _snwprintf(slot_name, 100, L"\\\\.\\mailslot\\psi-detectres-%d", GetTickCount());

  SECURITY_ATTRIBUTES sa = SECURITY_ATTRIBUTES();
  sa.nLength = sizeof(sa);
  sa.bInheritHandle = false;
  SECURITY_DESCRIPTOR sd = SECURITY_DESCRIPTOR();
  InitializeSecurityDescriptor(&sd, SECURITY_DESCRIPTOR_REVISION);
  SetSecurityDescriptorDacl(&sd, true, NULL, false);
  sa.lpSecurityDescriptor = &sd;

  HANDLE slot_handle = CreateMailslotW(slot_name, sizeof(ResolutionMessage), 5000, &sa);
  if (slot_handle == INVALID_HANDLE_VALUE) {
    context->exit_code = 101;
    context->error = WindowsError(GetLastError());
    return;
  }

  wstring args = L"\"" + emitter_path + L"\" \"" + slot_name + L"\"";
  Process process(emitter_path, args, false, dir);
  if (process.has_errors()) {
    CloseHandle(slot_handle);
    context->exit_code = 101;
    context->error = process.error();
    return;
  }

  bool timed_out;
  WindowsError result = process.WaitForExit(5000, &timed_out);
  if (result.is_error()) {
    CloseHandle(slot_handle);
    context->exit_code = 101;
    context->error = result;
    return;
  } else if (timed_out) {
    CloseHandle(slot_handle);
    context->exit_code = 102;
    return;
  }

  result = process.GetExitCode(&context->exit_code);
  if (result.is_error()) {
    CloseHandle(slot_handle);
    context->exit_code = 101;
    context->error = result;
    return;
  } else if (context->exit_code != 0) {
    CloseHandle(slot_handle);
    return;
  }

  // process exited properly, so it must have written to the mailslot. Read it!
  DWORD bytes_read;
  bool success = ReadFile(slot_handle, &context->message, sizeof(context->message), &bytes_read,
      nullptr) == TRUE;
  if (!success) {
    CloseHandle(slot_handle);
    context->exit_code = 101;
    context->error = WindowsError(GetLastError());
    return;
  } else if (bytes_read != sizeof(context->message)) {
    CloseHandle(slot_handle);
    context->exit_code = 103;
    return;
  }

  CloseHandle(slot_handle);
}

void DetectResolutionAfter(uv_work_t* req, int status) {
  HandleScope scope;
  ResContext* context = reinterpret_cast<ResContext*>(req->data);

  Local<Value> err = Local<Value>::New(v8::Null());
  Handle<Value> resolution = Local<Value>::New(v8::Null());

  if (context->exit_code == 101) {
    err = Exception::Error(String::New(
        reinterpret_cast<const uint16_t*>(context->error.message().c_str())));
  } else if (context->exit_code != 0) {
    char msg[100];
    _snprintf(msg, sizeof(msg), "Non-zero exit code: %d", context->exit_code);
    err = Exception::Error(String::New(msg));
  } else {
    resolution = Object::New();
    Handle<Object> obj = resolution.As<Object>();
    obj->Set(String::New("width"), Integer::New(context->message.width));
    obj->Set(String::New("height"), Integer::New(context->message.height));
  }

  Handle<Value> argv[] = { err, resolution };
  TryCatch try_catch;
  context->callback->Call(Context::GetCurrent()->Global(), 2, argv);

  context->callback.Dispose();
  delete context;

  if (try_catch.HasCaught()) {
    node::FatalException(try_catch);
  }
}

Handle<Value> DetectResolution(const Arguments& args) {
  HandleScope scope;

  assert(args.Length() == 1);
  assert(args[0]->IsFunction());

  ResContext* context = new ResContext();
  context->req.data = context;
  context->callback = Persistent<Function>::New(args[0].As<Function>());
  uv_queue_work(uv_default_loop(), &context->req, DetectResolutionWork, DetectResolutionAfter);

  return scope.Close(v8::Undefined());
}

Persistent<Function> callback;

Handle<Value> ShutdownHandler(const Arguments& args) {
  HandleScope scope;
  assert(args.Length() == 1);
  assert(args[0]->IsFunction());

  if (!callback.IsEmpty()) {
    callback.Dispose();
  }

  callback = Persistent<Function>::New(args[0].As<Function>());
  return scope.Close(v8::Undefined());
}

void EmitShutdown() {
  if (callback.IsEmpty()) {
    return;
  }

  callback->Call(Context::GetCurrent()->Global(), 0, nullptr);
}

void Initialize(Handle<Object> exports, Handle<Object> module) {
  WrappedProcess::Init();
  WrappedRegistry::Init();
  PsiService::SetShutdownCallback(EmitShutdown);

  exports->Set(String::NewSymbol("launchProcess"),
    FunctionTemplate::New(LaunchProcess)->GetFunction());
  exports->Set(String::NewSymbol("detectResolution"),
    FunctionTemplate::New(DetectResolution)->GetFunction());
  exports->Set(String::NewSymbol("registerShutdownHandler"),
    FunctionTemplate::New(ShutdownHandler)->GetFunction());
  exports->Set(String::NewSymbol("registry"), WrappedRegistry::NewInstance());
}

NODE_MODULE(psi, Initialize);

}  // namespace psi
}  // namespace sbat