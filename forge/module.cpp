#include <node.h>
#include <nan.h>

#include "forge/forge.h"

namespace sbat {
namespace forge {

using Nan::New;
using v8::Local;
using v8::Object;

void Initialize(Local<Object> exports, Local<Object> module) {
  Forge::Init();
  module->Set(New("exports").ToLocalChecked(), Forge::NewInstance());
}

NODE_MODULE(forge, Initialize);

}  // namespace forge
}  // namespace sbat