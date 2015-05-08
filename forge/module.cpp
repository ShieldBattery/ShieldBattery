#include <node.h>
#include <nan.h>
#include <v8.h>

#include "forge/forge.h"

namespace sbat {
namespace forge {

using v8::Handle;
using v8::Object;
using v8::String;

void Initialize(Handle<Object> exports, Handle<Object> module) {
  Forge::Init();
  module->Set(NanNew("exports"), Forge::NewInstance());
}

NODE_MODULE(forge, Initialize);

}  // namespace forge
}  // namespace sbat