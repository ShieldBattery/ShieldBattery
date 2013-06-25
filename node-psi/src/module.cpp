#include <node.h>
#include <v8.h>

using v8::Arguments;
using v8::FunctionTemplate;
using v8::Handle;
using v8::HandleScope;
using v8::Object;
using v8::String;
using v8::Value;

Handle<Value> CreatePsiInterface(const Arguments& args) {
  HandleScope scope;
  return scope.Close(v8::Undefined());
}

void Initialize(Handle<Object> exports, Handle<Object> module) {
  module->Set(String::NewSymbol("exports"),
      FunctionTemplate::New(CreatePsiInterface)->GetFunction());
}

NODE_MODULE(psi, Initialize);
