#include "node-psi/wrapped_process.h"

#include <assert.h>
#include <node.h>
#include <nan.h>
#include <memory>
#include <string>

#include "common/win_helpers.h"
#include "v8-helpers/helpers.h"
#include "node-psi/module.h"

using Nan::Callback;
using Nan::EscapableHandleScope;
using Nan::FunctionCallbackInfo;
using Nan::HandleScope;
using Nan::Null;
using Nan::Persistent;
using Nan::SetPrototypeMethod;
using Nan::To;
using Nan::Utf8String;
using std::string;
using std::unique_ptr;
using std::wstring;
using v8::Exception;
using v8::Function;
using v8::FunctionTemplate;
using v8::Local;
using v8::Object;
using v8::String;
using v8::Value;

namespace sbat {
namespace psi {

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
  
  constructor.Reset(tpl->GetFunction());
}

void WrappedProcess::New(const FunctionCallbackInfo<Value>& info) {
  HandleScope scope;

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
  unique_ptr<wstring> dll_path;
  unique_ptr<string> inject_func;
  unique_ptr<Callback> callback;
  Persistent<Object> self;
  Process* process;

  unique_ptr<WindowsError> error;
};

void InjectDllWork(uv_work_t* req) {
  InjectDllContext* context = reinterpret_cast<InjectDllContext*>(req->data);

  context->error.reset(
      new WindowsError(context->process->InjectDll(*context->dll_path, *context->inject_func)));
}

void InjectDllAfter(uv_work_t* req, int status) {
  HandleScope scope;
  InjectDllContext* context = reinterpret_cast<InjectDllContext*>(req->data);

  Local<Value> err = Null();
  if (context->error->is_error()) {
    err = Exception::Error(Nan::New(
        reinterpret_cast<const uint16_t*>(context->error->message().c_str())).ToLocalChecked());
  }

  Local<Value> argv[] = { err };
  context->callback->Call(Nan::New<Object>(context->self), 1, argv);

  context->self.Reset();
  delete context;
}

void WrappedProcess::InjectDll(const FunctionCallbackInfo<Value>& info) {
  HandleScope scope;

  assert(info.Length() == 3);
  assert(info[2]->IsFunction());

  InjectDllContext* context = new InjectDllContext;
  context->dll_path = ToWstring(To<String>(info[0]).ToLocalChecked());
  context->inject_func.reset(
      new string(*Utf8String(To<String>(info[1]).ToLocalChecked())));
  context->callback.reset(new Callback(info[2].As<Function>()));
  context->self.Reset(info.This());
  context->process = WrappedProcess::Unwrap(info);
  context->req.data = context;
  uv_queue_work(uv_default_loop(), &context->req, InjectDllWork, InjectDllAfter);

  return;
}

void WrappedProcess::Resume(const FunctionCallbackInfo<Value>& info) {
  HandleScope scope;
  Process* process = WrappedProcess::Unwrap(info);

  WindowsError error = WindowsError(process->Resume());
  if (error.is_error()) {
    info.GetReturnValue().Set(Exception::Error(Nan::New(
        reinterpret_cast<const uint16_t*>(error.message().c_str())).ToLocalChecked()));
  }

  return;
}

}  // namespace psi
}  // namespace sbat