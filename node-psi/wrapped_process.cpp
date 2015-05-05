#include "node-psi/wrapped_process.h"

#include <assert.h>
#include <node.h>
#include <nan.h>
#include <memory>
#include <string>

#include "common/win_helpers.h"
#include "v8-helpers/helpers.h"
#include "node-psi/module.h"

using std::string;
using std::unique_ptr;
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
  Local<FunctionTemplate> tpl = NanNew<FunctionTemplate>(New);
  tpl->SetClassName(NanNew("CProcess"));
  tpl->InstanceTemplate()->SetInternalFieldCount(1);

  // functions
  SetProtoMethod(tpl, "injectDll", InjectDll);
  SetProtoMethod(tpl, "resume", Resume);
  
  NanAssignPersistent(constructor, tpl->GetFunction());
}

NAN_METHOD(WrappedProcess::New) {
  NanScope();

  WrappedProcess* process = new WrappedProcess();
  process->Wrap(args.This());

  NanReturnThis();
}

Handle<Value> WrappedProcess::NewInstance(Process* process) {
  NanEscapableScope();

  Local<Object> instance = constructor->NewInstance();
  WrappedProcess* wrapped = ObjectWrap::Unwrap<WrappedProcess>(instance);
  wrapped->set_process(process);

  return NanEscapeScope(instance);
}

struct InjectDllContext {
  uv_work_t req;
  unique_ptr<wstring> dll_path;
  unique_ptr<string> inject_func;
  unique_ptr<NanCallback> callback;
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
  NanScope();
  InjectDllContext* context = reinterpret_cast<InjectDllContext*>(req->data);

  Local<Value> err = NanNull();
  if (context->error->is_error()) {
    err = Exception::Error(
        NanNew<String>(reinterpret_cast<const uint16_t*>(context->error->message().c_str())));
  }

  Local<Value> argv[] = { err };
  TryCatch try_catch;
  context->callback->Call(NanNew<Object>(context->self), 1, argv);

  NanDisposePersistent(context->self);
  delete context;
}

NAN_METHOD(WrappedProcess::InjectDll) {
  NanScope();

  assert(args.Length() == 3);
  assert(args[2]->IsFunction());

  InjectDllContext* context = new InjectDllContext;
  context->dll_path.reset(ToWstring(args[0]->ToString()));
  context->inject_func.reset(new string(*NanUtf8String(args[1]->ToString())));
  context->callback.reset(new NanCallback(args[2].As<Function>()));
  NanAssignPersistent(context->self, args.This());
  context->process = WrappedProcess::Unwrap(args);
  context->req.data = context;
  uv_queue_work(uv_default_loop(), &context->req, InjectDllWork, InjectDllAfter);

  NanReturnUndefined();
}

NAN_METHOD(WrappedProcess::Resume) {
  NanScope();
  Process* process = WrappedProcess::Unwrap(args);

  WindowsError error = WindowsError(process->Resume());
  if (error.is_error()) {
    NanReturnValue(Exception::Error(
        NanNew<String>(reinterpret_cast<const uint16_t*>(error.message().c_str()))));
  }

  NanReturnUndefined();
}

}  // namespace psi
}  // namespace sbat