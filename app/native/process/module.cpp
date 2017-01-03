#include <node.h>
#include <nan.h>
#include <uv.h>
#include <Windows.h>
#include <stdlib.h>
#include <memory>
#include <string>
#include <vector>

#include "v8_string.h"
#include "wrapped_process.h"

using Nan::Callback;
using Nan::FunctionCallbackInfo;
using Nan::GetCurrentContext;
using Nan::HandleScope;
using Nan::Null;
using Nan::Set;
using Nan::ThrowError;
using Nan::To;
using std::string;
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
namespace proc {

struct LaunchContext {
  uv_work_t req;
  wstring app_path;
  wstring arguments;
  bool launch_suspended;
  wstring current_dir;
  vector<wstring> environment;
  Callback callback;

  Process* process;
};

void LaunchWork(uv_work_t* req) {
  LaunchContext* context = reinterpret_cast<LaunchContext*>(req->data);

  context->process = new Process(context->app_path, context->arguments, context->launch_suspended,
      context->current_dir, context->environment);
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
  context->callback.Call(GetCurrentContext()->Global(), 2, argv);
  delete context;
}

void LaunchProcess(const FunctionCallbackInfo<Value>& info) {
  assert(info.Length() == 6);
  assert(info[5]->IsFunction());

  LaunchContext* context = new LaunchContext();
  context->app_path = ToWstring(To<String>(info[0]).ToLocalChecked());
  context->arguments = ToWstring(To<String>(info[1]).ToLocalChecked());
  context->launch_suspended = To<Boolean>(info[2]).ToLocalChecked()->BooleanValue();
  context->current_dir = ToWstring(To<String>(info[3]).ToLocalChecked());

  Local<Array> js_env = info[4].As<Array>();
  for (uint32_t i = 0; i < js_env->Length(); i++) {
    context->environment.push_back(ToWstring(To<String>(js_env->Get(i)).ToLocalChecked()));
  }

  context->callback.Reset(info[5].As<Function>());
  context->req.data = context;
  uv_queue_work(uv_default_loop(), &context->req, LaunchWork, LaunchAfter);

  return;
}

void Initialize(Local<Object> exports, Local<Value> unused) {
  HandleScope scope;
  WrappedProcess::Init();

  exports->Set(Nan::New("launchProcess").ToLocalChecked(),
      Nan::New<FunctionTemplate>(LaunchProcess)->GetFunction());
}

}  // namespace proc
}  // namespace sbat

NODE_MODULE(shieldbattery_psi, sbat::proc::Initialize);