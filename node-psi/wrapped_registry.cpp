#include "node-psi/wrapped_registry.h"

#include <node.h>
#include <nan.h>
#include <Windows.h>
#include <memory>

#include "common/types.h"
#include "common/win_helpers.h"
#include "v8-helpers/helpers.h"

using node::SetPrototypeMethod;
using std::unique_ptr;
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
  Local<FunctionTemplate> tpl = NanNew<FunctionTemplate>(New);
  tpl->SetClassName(NanNew("Registry"));

  SetPrototypeMethod(tpl, "readString", ReadString);

  NanAssignPersistent(constructor, tpl->GetFunction());
}

NAN_METHOD(WrappedRegistry::New) {
  NanScope();
  NanReturnThis();
}

Handle<Value> WrappedRegistry::NewInstance() {
  NanEscapableScope();
  Local<Object> instance = constructor->NewInstance();
  return NanEscapeScope(instance);
}

NAN_METHOD(WrappedRegistry::ReadString) {
  NanScope();
  assert(args.Length() == 3);

  unique_ptr<wstring> root_key_str(ToWstring(args[0]->ToString()));
  unique_ptr<wstring> sub_key(ToWstring(args[1]->ToString()));
  unique_ptr<wstring> value_name(ToWstring(args[2]->ToString()));

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
    return NanThrowError("Invalid root key.");
  }

  HKEY key;
  WindowsError result = WindowsError(RegOpenKeyW(root_key, sub_key->c_str(), &key));
  if (result.is_error()) {
    return ThrowException(Exception::Error(
        NanNew<String>(reinterpret_cast<const uint16_t*>(result.message().c_str()))));
  }

  wchar_t value[MAX_PATH];
  DWORD value_size = sizeof(value);
  result = WindowsError(RegQueryValueExW(key, value_name->c_str(), NULL, NULL,
    reinterpret_cast<LPBYTE>(value), &value_size));
  RegCloseKey(key);

  if (result.is_error()) {
    return ThrowException(Exception::Error(
        NanNew<String>(reinterpret_cast<const uint16_t*>(result.message().c_str()))));
  } else {
    if (value_size == 0) {
      NanReturnUndefined();
    }

    NanReturnValue(NanNew<String>(reinterpret_cast<const uint16_t*>(value)));
  }
}

}  // namespace psi
}  // namespace sbat