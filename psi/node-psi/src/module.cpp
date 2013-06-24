#include <node.h>
#include <v8.h>

using v8::Handle;
using v8::Object;

void Initialize(Handle<Object> exports, Handle<Object> module) {
}

NODE_MODULE(psi, Initialize);
