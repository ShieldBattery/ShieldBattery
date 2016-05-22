#include "node-psi/module.h"

#include <node.h>
#include <nan.h>
#include <uv.h>
#include <Windows.h>
#include <stdlib.h>
#include <memory>
#include <string>
#include <vector>

#include "common/win_helpers.h"
#include "v8-helpers/helpers.h"
#include "node-psi/wrapped_process.h"
#include "node-psi/wrapped_registry.h"
#include "psi/psi.h"

using Nan::Callback;
using Nan::FunctionCallbackInfo;
using Nan::GetCurrentContext;
using Nan::HandleScope;
using Nan::Null;
using Nan::To;
using std::unique_ptr;
using std::vector;
using std::wstring;
using v8::Array;
using v8::Boolean;
using v8::Exception;
using v8::Function;
using v8::FunctionTemplate;
using v8::Local;
using v8::Object;
using v8::String;
using v8::Value;

namespace sbat {
namespace psi {

struct LaunchContext {
  uv_work_t req;
  unique_ptr<wstring> app_path;
  unique_ptr<wstring> arguments;
  bool launch_suspended;
  unique_ptr<wstring> current_dir;
  unique_ptr<vector<wstring>> environment;
  unique_ptr<Callback> callback;

  Process* process;
};

void LaunchWork(uv_work_t* req) {
  LaunchContext* context = reinterpret_cast<LaunchContext*>(req->data);

  context->process = new Process(*context->app_path, *context->arguments, context->launch_suspended,
      *context->current_dir, *context->environment);
}

void LaunchAfter(uv_work_t* req, int status) {
  HandleScope scope;
  LaunchContext* context = reinterpret_cast<LaunchContext*>(req->data);

  Local<Value> err = Null();
  Local<Value> proc = Null();

  if (context->process->has_errors()) {
    err = Exception::Error(Nan::New(context->process->error().message().c_str()).ToLocalChecked());
  } else {
    proc = WrappedProcess::NewInstance(context->process);
  }

  Local<Value> argv[] = { err, proc };
  context->callback->Call(GetCurrentContext()->Global(), 2, argv);
  delete context;
}

void LaunchProcess(const FunctionCallbackInfo<Value>& info) {
  assert(info.Length() == 6);
  assert(info[5]->IsFunction());

  LaunchContext* context = new LaunchContext;
  context->app_path = ToWstring(To<String>(info[0]).ToLocalChecked());
  context->arguments = ToWstring(To<String>(info[1]).ToLocalChecked());
  context->launch_suspended = To<Boolean>(info[2]).ToLocalChecked()->BooleanValue();
  context->current_dir = ToWstring(To<String>(info[3]).ToLocalChecked());

  Local<Array> js_env = info[4].As<Array>();
  context->environment.reset(new vector<wstring>());
  for (uint32 i = 0; i < js_env->Length(); i++) {
    context->environment->push_back(*ToWstring(To<String>(js_env->Get(i)).ToLocalChecked()));
  }

  context->callback.reset(new Callback(info[5].As<Function>()));
  context->req.data = context;
  uv_queue_work(uv_default_loop(), &context->req, LaunchWork, LaunchAfter);

  return;
}

struct ResContext {
  uv_work_t req;
  unique_ptr<Callback> callback;

  uint32 exit_code;
  WindowsError error;
  ResolutionMessage message;
};

void DetectResolutionWork(uv_work_t* req) {
  ResContext* context = reinterpret_cast<ResContext*>(req->data);

  wchar_t path[MAX_PATH];
  GetModuleFileNameW(NULL, path, sizeof(path));
 
  wstring path_str = path;
  size_t last_slash = path_str.find_last_of(L"/\\");
  wstring dir = path_str.substr(0, last_slash);
  wstring emitter_path = dir + L"\\psi-emitter.exe";

  wchar_t* slot_name = new wchar_t[100];
  int size = _snwprintf(slot_name, 100, L"\\\\.\\mailslot\\psi-detectres-%d", GetTickCount());

  SECURITY_ATTRIBUTES sa = SECURITY_ATTRIBUTES();
  sa.nLength = sizeof(sa);
  sa.bInheritHandle = false;
  SECURITY_DESCRIPTOR sd = SECURITY_DESCRIPTOR();
  InitializeSecurityDescriptor(&sd, SECURITY_DESCRIPTOR_REVISION);
  SetSecurityDescriptorDacl(&sd, true, NULL, false);
  sa.lpSecurityDescriptor = &sd;

  WinHandle slot_handle(CreateMailslotW(slot_name, sizeof(ResolutionMessage), 5000, &sa));
  if (slot_handle.get() == INVALID_HANDLE_VALUE) {
    context->exit_code = 101;
    context->error = WindowsError("DetectResolutionWork -> CreateMailslot", GetLastError());
    return;
  }

  wstring args = L"\"" + emitter_path + L"\" \"" + slot_name + L"\"";
  vector<wstring> environment;
  Process process(emitter_path, args, false, dir, environment);
  if (process.has_errors()) {
    context->exit_code = 101;
    context->error = process.error();
    return;
  }

  bool timed_out;
  WindowsError result = process.WaitForExit(5000, &timed_out);
  if (result.is_error()) {
    context->exit_code = 101;
    context->error = result;
    return;
  } else if (timed_out) {
    context->exit_code = 102;
    return;
  }

  result = process.GetExitCode(&context->exit_code);
  if (result.is_error()) {
    context->exit_code = 101;
    context->error = result;
    return;
  } else if (context->exit_code != 0) {
    return;
  }

  // process exited properly, so it must have written to the mailslot. Read it!
  DWORD bytes_read;
  bool success = ReadFile(slot_handle.get(), &context->message, sizeof(context->message),
      &bytes_read, nullptr) == TRUE;
  if (!success) {
    context->exit_code = 101;
    context->error = WindowsError("DetectResolutionWork -> ReadFile", GetLastError());
    return;
  } else if (bytes_read != sizeof(context->message)) {
    context->exit_code = 103;
    return;
  }
}

void DetectResolutionAfter(uv_work_t* req, int status) {
  HandleScope scope;
  ResContext* context = reinterpret_cast<ResContext*>(req->data);

  Local<Value> err = Null();
  Local<Value> resolution = Null();

  if (context->exit_code == 101) {
    err = Exception::Error(Nan::New(context->error.message().c_str()).ToLocalChecked());
  } else if (context->exit_code != 0) {
    char msg[100];
    _snprintf_s(msg, sizeof(msg), "Non-zero exit code: %d", context->exit_code);
    err = Exception::Error(Nan::New(msg).ToLocalChecked());
  } else {
    resolution = Nan::New<Object>();
    Local<Object> obj = resolution.As<Object>();
    obj->Set(Nan::New("width").ToLocalChecked(), Nan::New(context->message.width));
    obj->Set(Nan::New("height").ToLocalChecked(), Nan::New(context->message.height));
  }

  Local<Value> argv[] = { err, resolution };
  context->callback->Call(GetCurrentContext()->Global(), 2, argv);
  delete context;
}

void DetectResolution(const FunctionCallbackInfo<Value>& info) {
  assert(info.Length() == 1);
  assert(info[0]->IsFunction());

  ResContext* context = new ResContext();
  context->req.data = context;
  context->callback.reset(new Callback(info[0].As<Function>()));
  uv_queue_work(uv_default_loop(), &context->req, DetectResolutionWork, DetectResolutionAfter);

  return;
}

unique_ptr<Callback> shutdown_callback;

void RegisterShutdownHandler(const FunctionCallbackInfo<Value>& info) {
  assert(info.Length() == 1);
  assert(info[0]->IsFunction());

  shutdown_callback.reset(new Callback(info[0].As<Function>()));

  return;
}

void EmitShutdown() {
  HandleScope scope;
  if (!shutdown_callback) {
    return;
  }

  shutdown_callback->Call(GetCurrentContext()->Global(), 0, nullptr);
}

void Initialize(Local<Object> exports, Local<Value> unused) {
  WrappedProcess::Init();
  WrappedRegistry::Init();
  shutdown_callback = unique_ptr<Callback>();
  PsiService::SetShutdownCallback(EmitShutdown);

  exports->Set(Nan::New("launchProcess").ToLocalChecked(),
      Nan::New<FunctionTemplate>(LaunchProcess)->GetFunction());
  exports->Set(Nan::New("detectResolution").ToLocalChecked(),
      Nan::New<FunctionTemplate>(DetectResolution)->GetFunction());
  exports->Set(Nan::New("registerShutdownHandler").ToLocalChecked(),
      Nan::New<FunctionTemplate>(RegisterShutdownHandler)->GetFunction());
  exports->Set(Nan::New("registry").ToLocalChecked(), WrappedRegistry::NewInstance());
}

}  // namespace psi
}  // namespace sbat

NODE_MODULE(shieldbattery_psi, sbat::psi::Initialize);