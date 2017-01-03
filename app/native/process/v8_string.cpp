#include "v8_string.h"

#include <node.h>
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
  v8_str->Write(reinterpret_cast<uint16_t*>(&result[0]));
  return std::move(result);
}

}  // namespace proc
}  // namespace sbat
