#include "node-psi/wrapped_registry.h"

#include <node.h>
#include <nan.h>
#include <Windows.h>
#include <memory>

#include "common/types.h"
#include "common/win_helpers.h"
#include "v8-helpers/helpers.h"

using Nan::EscapableHandleScope;
using Nan::FunctionCallbackInfo;
using Nan::HandleScope;
using Nan::Persistent;
using Nan::SetPrototypeMethod;
using Nan::ThrowError;
using Nan::To;
using std::unique_ptr;
using std::wstring;
using v8::Exception;
using v8::Function;
using v8::FunctionTemplate;
using v8::Local;
using v8::Object;
using v8::String;
using v8::Value;


namespace sbat {
namespace psi {

Persistent<Function> WrappedRegistry::constructor;

void WrappedRegistry::Init() {
  Local<FunctionTemplate> tpl = Nan::New<FunctionTemplate>(New);
  tpl->SetClassName(Nan::New("Registry").ToLocalChecked());

  SetPrototypeMethod(tpl, "readString", ReadString);

  constructor.Reset(tpl->GetFunction());
}

void WrappedRegistry::New(const FunctionCallbackInfo<Value>& info) {
  HandleScope scope;
  info.GetReturnValue().Set(info.This());
}

Local<Value> WrappedRegistry::NewInstance() {
  EscapableHandleScope scope;

  Local<Function> cons = Nan::New<Function>(constructor);
  Local<Object> instance = cons->NewInstance();

  return scope.Escape(instance);
}

void WrappedRegistry::ReadString(const FunctionCallbackInfo<Value>& info) {
  HandleScope scope;
  assert(info.Length() == 3);

  unique_ptr<wstring> root_key_str(ToWstring(To<String>(info[0]).ToLocalChecked()));
  unique_ptr<wstring> sub_key(ToWstring(To<String>(info[1]).ToLocalChecked()));
  unique_ptr<wstring> value_name(ToWstring(To<String>(info[2]).ToLocalChecked()));

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
  if (root_key == NULL) {
    return ThrowError("Invalid root key.");
  }

  HKEY key;
  WindowsError result = WindowsError(RegOpenKeyW(root_key, sub_key->c_str(), &key));
  if (result.is_error()) {
    ThrowError(Exception::Error(Nan::New(
        reinterpret_cast<const uint16_t*>(result.message().c_str())).ToLocalChecked()));
    return;
  }

  wchar_t value[MAX_PATH];
  DWORD value_size = sizeof(value);
  result = WindowsError(RegQueryValueExW(key, value_name->c_str(), NULL, NULL,
    reinterpret_cast<LPBYTE>(value), &value_size));
  RegCloseKey(key);

  if (result.is_error()) {
    ThrowError(Exception::Error(Nan::New(
        reinterpret_cast<const uint16_t*>(result.message().c_str())).ToLocalChecked()));
    return;
  } else {
    if (value_size == 0) {
      return;
    }

    info.GetReturnValue().Set(Nan::New(reinterpret_cast<const uint16_t*>(value)).ToLocalChecked());
  }
}

}  // namespace psi
}  // namespace sbat