#ifndef V8_HELPERS_HELPERS_H_
#define V8_HELPERS_HELPERS_H_

#include <v8.h>
#include <string>

namespace sbat {

std::wstring* ToWstring(const v8::Handle<v8::String>& v8_str);

template <typename target_t>
void SetProtoAccessor(target_t target, const char* name, v8::AccessorGetter getter, 
    v8::AccessorSetter setter = reinterpret_cast<v8::AccessorSetter>(NULL)) {
  target->PrototypeTemplate()->SetAccessor(String::NewSymbol(name), getter, setter);
}

template <typename target_t>
void SetProtoMethod(target_t target, const char* name, v8::InvocationCallback method) {
  v8::Local<v8::FunctionTemplate> func_template = v8::FunctionTemplate::New(method);
  target->PrototypeTemplate()->Set(v8::String::NewSymbol(name), func_template);
}

}  // namespace sbat

#endif  // V8_HELPERS_HELPERS_H_