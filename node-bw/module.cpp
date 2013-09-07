#include <node.h>
#include <v8.h>

#include "node-bw/immediate.h"
#include "node-bw/wrapped_brood_war.h"

using v8::Arguments;
using v8::FunctionTemplate;
using v8::Handle;
using v8::HandleScope;
using v8::Local;
using v8::Object;
using v8::String;
using v8::Value;

Handle<Value> CreateBroodWar(const Arguments& args) {
  HandleScope scope;
  return scope.Close(sbat::bw::WrappedBroodWar::NewInstance(args));
}

void Initialize(Handle<Object> exports, Handle<Object> module) {
  sbat::bw::InitImmediate();
  sbat::bw::BwPlayerSlot::Init();
  sbat::bw::WrappedBroodWar::Init();

  module->Set(String::NewSymbol("exports"), FunctionTemplate::New(CreateBroodWar)->GetFunction());
}

NODE_MODULE(bw, Initialize);