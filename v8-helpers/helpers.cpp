#include "v8-helpers/helpers.h"

#include <v8.h>
#include <string>

using std::wstring;
using v8::Handle;
using v8::String;

namespace sbat {

wstring* ToWstring(const Handle<String>& v8_str) {
  wchar_t* temp = new wchar_t[v8_str->Length() + 1];
  v8_str->Write(reinterpret_cast<uint16_t*>(temp));
  wstring* result = new wstring(temp);
  delete temp;

  return result;
}

}  // namespace sbat