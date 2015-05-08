#include "node-psi/module.h"

#include <node.h>
#include <nan.h>
#include <uv.h>
#include <Windows.h>
#include <stdlib.h>
#include <memory>
#include <string>

#include "common/win_helpers.h"
#include "v8-helpers/helpers.h"
#include "node-psi/wrapped_process.h"
#include "node-psi/wrapped_registry.h"
#include "psi/psi.h"

using std::unique_ptr;
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
  unique_ptr<wstring> app_path;
  unique_ptr<wstring> arguments;
  bool launch_suspended;
  unique_ptr<wstring> current_dir;
  unique_ptr<NanCallback> callback;

  Process* process;
};

void LaunchWork(uv_work_t* req) {
  LaunchContext* context = reinterpret_cast<LaunchContext*>(req->data);

  context->process = new Process(*context->app_path, *context->arguments, context->launch_suspended,
      *context->current_dir);
}

void LaunchAfter(uv_work_t* req, int status) {
  NanScope();
  LaunchContext* context = reinterpret_cast<LaunchContext*>(req->data);

  Local<Value> err = NanNull();
  Handle<Value> proc = NanNull();

  if (context->process->has_errors()) {
    err = Exception::Error(NanNew<String>(
        reinterpret_cast<const uint16_t*>(context->process->error().message().c_str())));
  } else {
    proc = WrappedProcess::NewInstance(context->process);
  }

  Handle<Value> argv[] = { err, proc };
  context->callback->Call(NanGetCurrentContext()->Global(), 2, argv);
  delete context;
}

NAN_METHOD(LaunchProcess) {
  NanScope();

  assert(args.Length() == 5);
  assert(args[4]->IsFunction());

  LaunchContext* context = new LaunchContext;
  context->app_path = ToWstring(args[0]->ToString());
  context->arguments = ToWstring(args[1]->ToString());
  context->launch_suspended = args[2]->ToBoolean()->BooleanValue();
  context->current_dir = ToWstring(args[3]->ToString());
  context->callback.reset(new NanCallback(args[4].As<Function>()));
  context->req.data = context;
  uv_queue_work(uv_default_loop(), &context->req, LaunchWork, LaunchAfter);

  NanReturnUndefined();
}

struct ResContext {
  uv_work_t req;
  unique_ptr<NanCallback> callback;

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
  NanScope();
  ResContext* context = reinterpret_cast<ResContext*>(req->data);

  Local<Value> err = NanNull();
  Handle<Value> resolution = NanNull();

  if (context->exit_code == 101) {
    err = Exception::Error(NanNew<String>(
        reinterpret_cast<const uint16_t*>(context->error.message().c_str())));
  } else if (context->exit_code != 0) {
    char msg[100];
    _snprintf(msg, sizeof(msg), "Non-zero exit code: %d", context->exit_code);
    err = Exception::Error(NanNew(msg));
  } else {
    resolution = NanNew<Object>();
    Handle<Object> obj = resolution.As<Object>();
    obj->Set(NanNew("width"), NanNew(context->message.width));
    obj->Set(NanNew("height"), NanNew(context->message.height));
  }

  Handle<Value> argv[] = { err, resolution };
  context->callback->Call(Context::GetCurrent()->Global(), 2, argv);
  delete context;
}

NAN_METHOD(DetectResolution) {
  NanScope();

  assert(args.Length() == 1);
  assert(args[0]->IsFunction());

  ResContext* context = new ResContext();
  context->req.data = context;
  context->callback.reset(new NanCallback(args[0].As<Function>()));
  uv_queue_work(uv_default_loop(), &context->req, DetectResolutionWork, DetectResolutionAfter);

  NanReturnUndefined();
}

unique_ptr<NanCallback> shutdown_callback;

NAN_METHOD(RegisterShutdownHandler) {
  NanScope();
  assert(args.Length() == 1);
  assert(args[0]->IsFunction());

  shutdown_callback.reset(new NanCallback(args[0].As<Function>()));
  NanReturnUndefined();
}

void EmitShutdown() {
  if (!shutdown_callback) {
    return;
  }

  shutdown_callback->Call(NanGetCurrentContext()->Global(), 0, nullptr);
}

void Initialize(Handle<Object> exports, Handle<Object> module) {
  WrappedProcess::Init();
  WrappedRegistry::Init();
  shutdown_callback = unique_ptr<NanCallback>();
  PsiService::SetShutdownCallback(EmitShutdown);

  exports->Set(NanNew("launchProcess"),
    NanNew<FunctionTemplate>(LaunchProcess)->GetFunction());
  exports->Set(NanNew("detectResolution"),
    NanNew<FunctionTemplate>(DetectResolution)->GetFunction());
  exports->Set(NanNew("registerShutdownHandler"),
    NanNew<FunctionTemplate>(RegisterShutdownHandler)->GetFunction());
  exports->Set(NanNew("registry"), WrappedRegistry::NewInstance());
}

NODE_MODULE(psi, Initialize);

}  // namespace psi
}  // namespace sbat