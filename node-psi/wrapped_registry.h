#ifndef NODE_PSI_WRAPPED_REGISTRY_H_
#define NODE_PSI_WRAPPED_REGISTRY_H_

#include <node.h>
#include <nan.h>

namespace sbat {
namespace psi {

class WrappedRegistry : public node::ObjectWrap {
public:
  static void Init();
  static v8::Handle<v8::Value> NewInstance();

  static NAN_METHOD(New);
  static NAN_METHOD(ReadString);
private:
  WrappedRegistry();
  ~WrappedRegistry();
  // Disable copying
  WrappedRegistry(const WrappedRegistry&);
  WrappedRegistry& operator=(const WrappedRegistry&);

  static v8::Persistent<v8::Function> constructor;
};

}  // namespace psi
}  // namespace sbat

#endif  // NODE_PSI_WRAPPED_REGISTRY_H_