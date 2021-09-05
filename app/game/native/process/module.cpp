#include <node.h>
#include <nan.h>
#include <uv.h>
#include <Windows.h>
#include <stdlib.h>
#include <memory>
#include <mutex>
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
using std::shared_ptr;
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

namespace sbat
{
  namespace proc
  {

    struct LogQueue
    {
      shared_ptr<Callback> callback;
      string line;
    };
    std::mutex log_queue_mutex;
    std::vector<LogQueue> queued_log_calls;
    uv_async_t log_queue_async;

    static void OnLogQueue(uv_async_t *handle)
    {
      log_queue_mutex.lock();
      auto logs = std::move(queued_log_calls);
      log_queue_mutex.unlock();
      for (const auto &entry : logs)
      {
        Local<Value> line = Nan::Encode(entry.line.data(), entry.line.size(), Nan::UTF8);
        Local<Value> argv[] = {line};
        Nan::Call(*entry.callback.get(), GetCurrentContext()->Global(), 1, argv);
      }
    }

    // Expected to be called on JS thread
    static void InitLogQueue()
    {
      uv_async_init(uv_default_loop(), &log_queue_async, OnLogQueue);
    }

    struct LaunchContext
    {
      uv_work_t req;
      wstring app_path;
      wstring arguments;
      bool launch_suspended;
      bool debugger_launch;
      wstring current_dir;
      vector<wstring> environment;
      Callback callback;
      shared_ptr<Callback> log_callback;

      Process *process;
    };

    void LaunchWork(uv_work_t *req)
    {
      LaunchContext *context = reinterpret_cast<LaunchContext *>(req->data);

      shared_ptr<Callback> log_js = context->log_callback;
      std::function<void(const string &)> log_callback([log_js](const string &text)
                                                       {
                                                         if (log_js)
                                                         {
                                                           log_queue_mutex.lock();
                                                           queued_log_calls.emplace_back(LogQueue{log_js, text});
                                                           log_queue_mutex.unlock();
                                                           uv_async_send(&log_queue_async);
                                                         }
                                                       });
      context->process = new Process(context->app_path, context->arguments, context->launch_suspended,
                                     context->debugger_launch, context->current_dir, context->environment, log_callback);
    }

    void LaunchAfter(uv_work_t *req, int status)
    {
      HandleScope scope;
      LaunchContext *context = reinterpret_cast<LaunchContext *>(req->data);

      Local<Value> err = Null();
      Local<Value> proc = Null();

      if (context->process->has_errors())
      {
        err = Exception::Error(Nan::New(context->process->error().message().c_str()).ToLocalChecked());
      }
      else
      {
        proc = WrappedProcess::NewInstance(context->process);
      }

      Local<Value> argv[] = {err, proc};
      Nan::Call(context->callback, GetCurrentContext()->Global(), 2, argv);
      delete context;
    }

    void LaunchProcess(const FunctionCallbackInfo<Value> &info)
    {
      assert(info.Length() == 8);
      assert(info[7]->IsFunction());

      LaunchContext *context = new LaunchContext();
      context->app_path = ToWstring(To<String>(info[0]).ToLocalChecked());
      context->arguments = ToWstring(To<String>(info[1]).ToLocalChecked());
      context->launch_suspended = To<bool>(info[2]).FromJust();
      context->current_dir = ToWstring(To<String>(info[3]).ToLocalChecked());

      Local<Array> js_env = info[4].As<Array>();
      for (uint32_t i = 0; i < js_env->Length(); i++)
      {
        context->environment.push_back(
            ToWstring(To<String>(Nan::Get(js_env, i).ToLocalChecked()).ToLocalChecked()));
      }

      context->debugger_launch = To<bool>(info[5]).FromJust();

      if (info[6]->IsFunction())
      {
        context->log_callback.reset(new Callback(info[6].As<Function>()));
      }
      context->callback.Reset(info[7].As<Function>());
      context->req.data = context;
      uv_queue_work(uv_default_loop(), &context->req, LaunchWork, LaunchAfter);

      return;
    }

    void Initialize(Local<Object> exports)
    {
      HandleScope scope;
      WrappedProcess::Init();
      InitLogQueue();

      Nan::SetMethod(exports, "launchProcess", LaunchProcess);
    }

  } // namespace proc
} // namespace sbat

NAN_MODULE_WORKER_ENABLED(shieldbattery_psi, sbat::proc::Initialize);
