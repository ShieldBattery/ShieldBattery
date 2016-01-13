#pragma once

#include <node.h>
#include <nan.h>

namespace sbat {
namespace psi {

class WrappedRegistry : public Nan::ObjectWrap {
public:
  static void Init();
  static v8::Local<v8::Value> NewInstance();

private:
  WrappedRegistry();
  ~WrappedRegistry();
  // Disable copying
  WrappedRegistry(const WrappedRegistry&) = delete;
  WrappedRegistry& operator=(const WrappedRegistry&) = delete;

  static void New(const Nan::FunctionCallbackInfo<v8::Value>& info);
  static void ReadString(const Nan::FunctionCallbackInfo<v8::Value>& info);

  static Nan::Persistent<v8::Function> constructor;
};

}  // namespace psi
}  // namespace sbat
