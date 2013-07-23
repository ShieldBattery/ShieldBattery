#ifndef NODE_PSI_WRAPPED_REGISTRY_H_
#define NODE_PSI_WRAPPED_REGISTRY_H_

#include <node.h>

namespace sbat {
namespace psi {

class WrappedRegistry : public node::ObjectWrap {
public:
  static void Init();
  static v8::Handle<v8::Value> NewInstance();

private:
  WrappedRegistry();
  ~WrappedRegistry();
  // Disable copying
  WrappedRegistry(const WrappedRegistry&);
  WrappedRegistry& operator=(const WrappedRegistry&);

  static v8::Handle<v8::Value> New(const v8::Arguments& args);
  static v8::Handle<v8::Value> ReadString(const v8::Arguments& args);

  static v8::Persistent<v8::Function> constructor;
};

}  // namespace psi
}  // namespace sbat

#endif  // NODE_PSI_WRAPPED_REGISTRY_H_