#include "node-psi/wrapped_registry.h"

#include <node.h>
#include <Windows.h>

#include "common/types.h"
#include "common/win_helpers.h"
#include "v8-helpers/helpers.h"

using std::wstring;
using v8::Arguments;
using v8::Exception;
using v8::Function;
using v8::FunctionTemplate;
using v8::Handle;
using v8::HandleScope;
using v8::Local;
using v8::Object;
using v8::Persistent;
using v8::String;
using v8::Value;

namespace sbat {
namespace psi {

Persistent<Function> WrappedRegistry::constructor;

void WrappedRegistry::Init() {
  Local<FunctionTemplate> tpl = FunctionTemplate::New(New);
  tpl->SetClassName(String::NewSymbol("Registry"));

  SetProtoMethod(tpl, "readString", ReadString);

  constructor = Persistent<Function>::New(tpl->GetFunction());
}

Handle<Value> WrappedRegistry::New(const Arguments& args) {
  HandleScope scope;
  return scope.Close(args.This());
}

Handle<Value> WrappedRegistry::NewInstance() {
  HandleScope scope;
  Local<Object> instance = constructor->NewInstance();
  return scope.Close(instance);
}

Handle<Value> WrappedRegistry::ReadString(const Arguments& args) {
  HandleScope scope;
  assert(args.Length() == 3);

  wstring* root_key_str = ToWstring(args[0]->ToString());
  wstring* sub_key = ToWstring(args[1]->ToString());
  wstring* value_name = ToWstring(args[2]->ToString());

  HKEY root_key = NULL;
  if (root_key_str->compare(L"hkcr") == 0) {
    root_key = HKEY_CLASSES_ROOT;
  } else if (root_key_str->compare(L"hkcc") == 0) {
    root_key = HKEY_CURRENT_CONFIG;
  } else if (root_key_str->compare(L"hkcu") == 0) {
    root_key = HKEY_CURRENT_USER;
  } else if (root_key_str->compare(L"hklm") == 0) {
    root_key = HKEY_LOCAL_MACHINE;
  } else if (root_key_str->compare(L"hku") == 0) {
    root_key = HKEY_USERS;
  }
  assert(root_key != NULL);

  HKEY key;
  WindowsError result = WindowsError(RegOpenKeyW(root_key, sub_key->c_str(), &key));
  if (result.is_error()) {
    delete root_key_str;
    delete sub_key;
    delete value_name;
    return ThrowException(Exception::Error(
        String::New(reinterpret_cast<const uint16_t*>(result.message().c_str()))));
  }

  wchar_t value[MAX_PATH];
  DWORD value_size = sizeof(value);
  result = WindowsError(
      RegGetValueW(key, NULL, value_name->c_str(), RRF_RT_REG_SZ, NULL, value, &value_size));
  RegCloseKey(key);

  delete root_key_str;
  delete sub_key;
  delete value_name;

  if (result.is_error()) {
    return ThrowException(Exception::Error(
        String::New(reinterpret_cast<const uint16_t*>(result.message().c_str()))));
  } else {
    if (value_size == 0) {
      return scope.Close(v8::Undefined());
    }

    return scope.Close(String::New(reinterpret_cast<const uint16_t*>(value)));
  }
}

}  // namespace psi
}  // namespace sbat