#include "node-psi/src/wrapped_process.h"

#include <node.h>
#include <string>

#include "common/win_helpers.h"
#include "node-psi/src/module.h"

using std::string;
using std::wstring;
using v8::Arguments;
using v8::Exception;
using v8::Function;
using v8::FunctionTemplate;
using v8::Handle;
using v8::HandleScope;
using v8::Local;
using v8::Object;
using v8::Persistent;
using v8::String;
using v8::ThrowException;
using v8::TryCatch;
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
  Local<FunctionTemplate> tpl = FunctionTemplate::New(New);
  tpl->SetClassName(String::NewSymbol("CProcess"));
  tpl->InstanceTemplate()->SetInternalFieldCount(1);

  // functions
  tpl->PrototypeTemplate()->Set(String::NewSymbol("injectDll"),
      FunctionTemplate::New(InjectDll)->GetFunction());
  tpl->PrototypeTemplate()->Set(String::NewSymbol("resume"),
      FunctionTemplate::New(Resume)->GetFunction());

  constructor = Persistent<Function>::New(tpl->GetFunction());
}

Handle<Value> WrappedProcess::New(const Arguments& args) {
  HandleScope scope;

  WrappedProcess* process = new WrappedProcess();
  process->Wrap(args.This());

  return scope.Close(args.This());
}

Handle<Value> WrappedProcess::NewInstance(Process* process) {
  HandleScope scope;

  Local<Object> instance = constructor->NewInstance();
  WrappedProcess* wrapped = ObjectWrap::Unwrap<WrappedProcess>(instance);
  wrapped->set_process(process);

  return scope.Close(instance);
}

struct InjectDllContext {
  uv_work_t req;
  wstring* dll_path;
  string* inject_func;
  Persistent<Function> callback;
  Persistent<Object> self;
  Process* process;

  WindowsError* error;
};

void InjectDllWork(uv_work_t* req) {
  InjectDllContext* context = reinterpret_cast<InjectDllContext*>(req->data);

  context->error = 
      new WindowsError(context->process->InjectDll(*context->dll_path, *context->inject_func));
}

void InjectDllAfter(uv_work_t* req, int status) {
  HandleScope scope;
  InjectDllContext* context = reinterpret_cast<InjectDllContext*>(req->data);

  Local<Value> err = Local<Value>::New(v8::Null());
  if (context->error->is_error()) {
    err = Exception::Error(
        String::New(reinterpret_cast<const uint16_t*>(context->error->message().c_str())));
  }

  Local<Value> argv[] = { err };
  TryCatch try_catch;
  context->callback->Call(context->self, 1, argv);

  context->callback.Dispose();
  context->self.Dispose();
  delete context->dll_path;
  delete context->inject_func;
  delete context->error;
  delete context;

  if (try_catch.HasCaught()) {
    node::FatalException(try_catch);
  }
}

Handle<Value> WrappedProcess::InjectDll(const Arguments& args) {
  HandleScope scope;

  if (args.Length() < 3) {
    ThrowException(Exception::Error(String::New("Incorrect number of arguments")));
    return scope.Close(v8::Undefined());
  }
  if (!args[0]->IsString() && !args[0]->IsStringObject()) {
    ThrowException(Exception::TypeError(String::New("dllPath must be a string")));
    return scope.Close(v8::Undefined());
  }
  if (!args[1]->IsString() && !args[1]->IsStringObject()) {
    ThrowException(Exception::TypeError(String::New("injectFuncName must be a string")));
    return scope.Close(v8::Undefined());
  }
  if (!args[2]->IsFunction()) {
    ThrowException(Exception::TypeError(String::New("callback must be a function")));
    return scope.Close(v8::Undefined());
  }

  InjectDllContext* context = new InjectDllContext;
  context->dll_path = ToWstring(args[0].As<String>());
  String::AsciiValue ascii_value(args[1].As<String>());
  context->inject_func = new string(*ascii_value);
  context->callback = Persistent<Function>::New(args[2].As<Function>());
  context->self = Persistent<Object>::New(args.This());
  context->process = WrappedProcess::Unwrap(args);
  context->req.data = context;
  uv_queue_work(uv_default_loop(), &context->req, InjectDllWork, InjectDllAfter);

  return scope.Close(v8::Undefined());
}

Handle<Value> WrappedProcess::Resume(const Arguments& args) {
  HandleScope scope;
  Process* process = WrappedProcess::Unwrap(args);

  WindowsError error = WindowsError(process->Resume());
  if (error.is_error()) {
    return scope.Close(Exception::Error(
        String::New(reinterpret_cast<const uint16_t*>(error.message().c_str()))));
  }

  return scope.Close(v8::Undefined());
}

}  // namespace psi
}  // namespace sbat