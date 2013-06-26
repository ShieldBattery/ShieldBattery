#ifndef NODE_PSI_SRC_WRAPPED_PROCESS_H_
#define NODE_PSI_SRC_WRAPPED_PROCESS_H_

#include <node.h>
#include "psi/psi.h"

class WrappedProcess : public node::ObjectWrap {
public:
  static void Init();
  static v8::Handle<v8::Value> NewInstance(const v8::Arguments& args);

private:
  WrappedProcess(const v8::Arguments& args);
  ~WrappedProcess();

  static v8::Persistent<v8::Function> constructor;
  static v8::Handle<v8::Value> New(const v8::Arguments& args);
};

#endif  // NODE_PSI_SRC_WRAPPED_PROCESS_H_