#pragma once

#include <node.h>
#include <nan.h>
#include "common/win_helpers.h"

namespace sbat {
namespace psi {

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

  static Nan::Persistent<v8::Function> constructor;

  template <class T>
  static Process* Unwrap(const T &t) {
    WrappedProcess* wrapped_process = Nan::ObjectWrap::Unwrap<WrappedProcess>(t.This());
    return wrapped_process->process_;
  }

  Process* process_;
};

}  // namespace psi
}  // namespace sbat
