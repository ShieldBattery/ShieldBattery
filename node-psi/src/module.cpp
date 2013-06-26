#include <node.h>
#include <uv.h>
#include <v8.h>
#include <string>

#include "psi/psi.h"

using sbat::psi::Process;

using std::wstring;

using v8::Arguments;
using v8::Boolean;
using v8::Context;
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

struct LaunchContext {
  uv_work_t req;
  wstring* app_path;
  wstring* arguments;
  bool launch_suspended;
  wstring* current_dir;
  Persistent<Function> callback;

  Process* process;
};

wstring* ToWstring(const Handle<String>& v8_str) {
  wchar_t* temp = new wchar_t[v8_str->Length() + 1];
  v8_str->Write(reinterpret_cast<uint16_t*>(temp));
  wstring* result = new wstring(temp);
  delete temp;

  return result;
}

void LaunchWork(uv_work_t* req) {
  LaunchContext* context = reinterpret_cast<LaunchContext*>(req->data);

  context->process = new Process(*context->app_path, *context->arguments, context->launch_suspended,
      *context->current_dir);
}

void LaunchAfter(uv_work_t* req, int status) {
  HandleScope scope;
  LaunchContext* context = reinterpret_cast<LaunchContext*>(req->data);

  Local<Value> err = Local<Value>::New(v8::Null());
  Local<Value> proc = Local<Value>::New(v8::Null());
  
  if (context->process->has_errors()) {
    err = Exception::Error(String::New(
        reinterpret_cast<const uint16_t*>(context->process->error().error_message().c_str())));
  } else {
    // TODO(tec27): proc = WrappedProcess
    proc = String::New("This'll be a process soon l;o;l");
  }

  Local<Value> argv[] = { err, proc };
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

  if (args.Length() < 5) {
    ThrowException(Exception::Error(String::New("Incorrect number of arguments")));
    return scope.Close(v8::Undefined());
  }
  if (!args[0]->IsString() && !args[0]->IsStringObject()) {
    ThrowException(Exception::TypeError(String::New("appPath must be a string")));
    return scope.Close(v8::Undefined());
  }
  if (!args[1]->IsString() && !args[1]->IsStringObject()) {
    ThrowException(Exception::TypeError(String::New("argsStr must be a string")));
    return scope.Close(v8::Undefined());
  }
  if (!args[2]->IsBoolean() && !args[2]->IsBooleanObject()) {
    ThrowException(Exception::TypeError(String::New("launchSuspended must be a bool")));
    return scope.Close(v8::Undefined());
  }
  if (!args[3]->IsString() && !args[3]->IsStringObject()) {
    ThrowException(Exception::TypeError(String::New("currentDir must be a string")));
    return scope.Close(v8::Undefined());
  }
  if (!args[4]->IsFunction()) {
    ThrowException(Exception::TypeError(String::New("cb must be a function")));
    return scope.Close(v8::Undefined());
  }

  LaunchContext* context = new LaunchContext;
  context->app_path = ToWstring(args[0].As<String>());
  context->arguments  = ToWstring(args[1].As<String>());
  context->launch_suspended = args[2]->BooleanValue();
  context->current_dir = ToWstring(args[3].As<String>());
  context->callback = Persistent<Function>::New(args[4].As<Function>());
  context->req.data = context;
  uv_queue_work(uv_default_loop(), &context->req, LaunchWork, LaunchAfter);

  return scope.Close(v8::Undefined());
}

void Initialize(Handle<Object> exports, Handle<Object> module) {
  exports->Set(String::NewSymbol("launchProcess"), 
    FunctionTemplate::New(LaunchProcess)->GetFunction());
}

NODE_MODULE(psi, Initialize);
