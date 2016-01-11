#include <node.h>
#include <nan.h>

#include "forge/forge.h"

namespace sbat {
namespace forge {

using Nan::New;
using v8::Local;
using v8::Object;
using v8::Value;

void Initialize(Local<Object> exports, Local<Value> unused) {
  Forge::Init();
  exports->Set(New("instance").ToLocalChecked(), Forge::NewInstance());
}

NODE_MODULE(shieldbattery_forge, Initialize);

}  // namespace forge
}  // namespace sbat