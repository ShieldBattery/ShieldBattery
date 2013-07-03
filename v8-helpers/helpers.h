#ifndef V8_HELPERS_HELPERS_H_
#define V8_HELPERS_HELPERS_H_

#include <v8.h>
#include <string>

namespace sbat {

std::wstring* ToWstring(const v8::Handle<v8::String>& v8_str);

}  // namespace sbat

#endif  // V8_HELPERS_HELPERS_H_