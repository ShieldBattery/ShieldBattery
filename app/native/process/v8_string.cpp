#include "v8_string.h"

#include <node.h>
#include <nan.h>
#include <string>
#include <utility>

using std::wstring;
using v8::Local;
using v8::String;

namespace sbat {
namespace proc {

wstring ToWstring(const Local<String>& v8_str) {
  wstring result;
  result.resize(v8_str->Length());
  Nan::DecodeWrite(reinterpret_cast<char*>(&result[0]), v8_str->Length() * 2, v8_str,
    Nan::Encoding::UCS2);
  return result;
}

}  // namespace proc
}  // namespace sbat
