#ifndef NODE_PSI_WRAPPED_REGISTRY_H_
#define NODE_PSI_WRAPPED_REGISTRY_H_

#include <node.h>
#include <nan.h>

namespace sbat {
namespace psi {

class WrappedRegistry : public Nan::ObjectWrap {
public:
  static void Init();
  static v8::Local<v8::Value> NewInstance();

  static void New(const Nan::FunctionCallbackInfo<v8::Value>& info);
  static void ReadString(const Nan::FunctionCallbackInfo<v8::Value>& info);
private:
  WrappedRegistry();
  ~WrappedRegistry();
  // Disable copying
  WrappedRegistry(const WrappedRegistry&);
  WrappedRegistry& operator=(const WrappedRegistry&);

  static Nan::Persistent<v8::Function> constructor;
};

}  // namespace psi
}  // namespace sbat

#endif  // NODE_PSI_WRAPPED_REGISTRY_H_