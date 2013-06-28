#ifndef NODE_PSI_SRC_WRAPPED_PROCESS_H_
#define NODE_PSI_SRC_WRAPPED_PROCESS_H_

#include <node.h>
#include "common/win_helpers.h"

namespace sbat {
namespace psi {

class WrappedProcess : public node::ObjectWrap {
public:
  static void Init();
  static v8::Handle<v8::Value> NewInstance(Process* process);

private:
  WrappedProcess();
  ~WrappedProcess();
  void set_process(Process* process);

  // Disable copying
  WrappedProcess(const WrappedProcess&);
  WrappedProcess& operator=(const WrappedProcess&);

  static v8::Persistent<v8::Function> constructor;
  static v8::Handle<v8::Value> New(const v8::Arguments& args);
  static v8::Handle<v8::Value> InjectDll(const v8::Arguments& args);
  static v8::Handle<v8::Value> Resume(const v8::Arguments& args);

  template <class T>
  static Process* Unwrap(const T &t) {
    WrappedProcess* wrapped_process = ObjectWrap::Unwrap<WrappedProcess>(t.This());
    return wrapped_process->process_;
  }

  Process* process_;
};

}  // namespace psi
}  // namespace sbat

#endif  // NODE_PSI_SRC_WRAPPED_PROCESS_H_