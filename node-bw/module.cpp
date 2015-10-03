#include <node.h>

#include "node-bw/immediate.h"
#include "node-bw/wrapped_brood_war.h"

using Nan::FunctionCallbackInfo;
using Nan::HandleScope;
using Nan::New;
using v8::FunctionTemplate;
using v8::Local;
using v8::Object;
using v8::Value;

void CreateBroodWar(const FunctionCallbackInfo<Value>& info) {
  HandleScope scope;

  info.GetReturnValue().Set(sbat::bw::WrappedBroodWar::NewInstance(info));
}

void Initialize(Local<Object> exports, Local<Object> module) {
  sbat::bw::InitImmediate();
  sbat::bw::BwPlayerSlot::Init();
  sbat::bw::WrappedBroodWar::Init();

  module->Set(New("exports").ToLocalChecked(),
    New<FunctionTemplate>(CreateBroodWar)->GetFunction());
}

NODE_MODULE(bw, Initialize);