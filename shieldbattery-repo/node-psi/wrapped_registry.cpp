#include "node-psi/wrapped_registry.h"

#include <node.h>
#include <nan.h>
#include <sddl.h>
#include <Windows.h>
#include <memory>


#include "common/types.h"
#include "common/win_helpers.h"
#include "v8-helpers/helpers.h"

using Nan::EscapableHandleScope;
using Nan::FunctionCallbackInfo;
using Nan::Persistent;
using Nan::SetPrototypeMethod;
using Nan::ThrowError;
using Nan::To;
using std::unique_ptr;
using std::vector;
using std::wstring;
using v8::Array;
using v8::Exception;
using v8::Function;
using v8::FunctionTemplate;
using v8::Local;
using v8::Object;
using v8::String;
using v8::Value;


namespace sbat {
namespace psi {

WrappedRegistry::WrappedRegistry() {}

WrappedRegistry::~WrappedRegistry() {}

Persistent<Function> WrappedRegistry::constructor;

void WrappedRegistry::Init() {
  Local<FunctionTemplate> tpl = Nan::New<FunctionTemplate>(New);
  tpl->SetClassName(Nan::New("Registry").ToLocalChecked());

  SetPrototypeMethod(tpl, "readString", ReadString);
  SetPrototypeMethod(tpl, "readMultiString", ReadMultiString);

  constructor.Reset(tpl->GetFunction());
}

void WrappedRegistry::New(const FunctionCallbackInfo<Value>& info) {
  info.GetReturnValue().Set(info.This());
}

Local<Value> WrappedRegistry::NewInstance() {
  EscapableHandleScope scope;

  Local<Function> cons = Nan::New<Function>(constructor);
  Local<Object> instance = cons->NewInstance();

  return scope.Escape(instance);
}

WindowsError GetActiveSessionId(wstring* out_sid) {
  out_sid->clear();
  HANDLE token;
  uint32 result = WTSQueryUserToken(WTSGetActiveConsoleSessionId(), &token);
  if (result == 0) {
    return WindowsError("GetActiveSessionId -> WTSGetActiveConsoleSessionId", GetLastError());
  }
  WinHandle active_session_token(token);

  DWORD user_size = 0;
  // Call GetTokenInformation to get the buffer size
  result = GetTokenInformation(token, TokenUser, NULL, user_size, &user_size);
  if (result == 0 && GetLastError() != ERROR_INSUFFICIENT_BUFFER) {
    return WindowsError("ReadString -> GetTokenInformation1", GetLastError());
  }

  vector<byte> user(user_size);
  result = GetTokenInformation(token, TokenUser, reinterpret_cast<void*>(user.data()), user_size,
      &user_size);
  if (result == 0) {
    return WindowsError("ReadString -> GetTokenInformation2", GetLastError());
  }

  // Convert SID to string
  wchar_t* sid;
  auto token_user = reinterpret_cast<TOKEN_USER*>(user.data());
  result = ConvertSidToStringSidW(token_user->User.Sid, &sid);
  if (result == 0) {
    return WindowsError("ReadString -> ConvertSidToStringSidW", GetLastError());
  }

  out_sid->assign(sid);
  LocalFree(sid);
  return WindowsError();
}

void WrappedRegistry::ReadString(const FunctionCallbackInfo<Value>& info) {
  assert(info.Length() == 3);

  unique_ptr<wstring> root_key_str(ToWstring(To<String>(info[0]).ToLocalChecked()));
  unique_ptr<wstring> sub_key(ToWstring(To<String>(info[1]).ToLocalChecked()));
  unique_ptr<wstring> value_name(ToWstring(To<String>(info[2]).ToLocalChecked()));

  HKEY root_key = NULL;
  WindowsError error;
  if (root_key_str->compare(L"hkcr") == 0) {
    root_key = HKEY_CLASSES_ROOT;
  } else if (root_key_str->compare(L"hkcc") == 0) {
    root_key = HKEY_CURRENT_CONFIG;
  } else if (root_key_str->compare(L"hkcu") == 0) {
    root_key = HKEY_USERS;
    
    wstring sid;
    error = GetActiveSessionId(&sid);
    if (error.is_error()) {
      ThrowError(Exception::Error(Nan::New(error.message().c_str()).ToLocalChecked()));
      return;
    }

    sid.append(L"\\");
    sub_key->insert(0, sid);
  } else if (root_key_str->compare(L"hklm") == 0) {
    root_key = HKEY_LOCAL_MACHINE;
  } else if (root_key_str->compare(L"hku") == 0) {
    root_key = HKEY_USERS;
  }
  if (root_key == NULL) {
    return ThrowError("Invalid root key.");
  }

  HKEY key;
  error = WindowsError("ReadString -> RegOpenKey", RegOpenKeyW(root_key, sub_key->c_str(), &key));
  if (error.is_error()) {
    ThrowError(Exception::Error(Nan::New(error.message().c_str()).ToLocalChecked()));
    return;
  }

  DWORD value_size = 0;
  // Get the size
  error = WindowsError("ReadString -> RegQueryValueEx", RegQueryValueExW(key, value_name->c_str(),
      NULL, NULL, nullptr, &value_size));
  

  if (error.is_error()) {
    RegCloseKey(key);
    ThrowError(Exception::Error(Nan::New(error.message().c_str()).ToLocalChecked()));
    return;
  }
  if (value_size == 0) {
    RegCloseKey(key);
    return;
  }

  wchar_t* value = new wchar_t[value_size];
  error = WindowsError("ReadString -> RegQueryValueEx", RegQueryValueExW(key, value_name->c_str(),
    NULL, NULL, reinterpret_cast<byte*>(value), &value_size));

  info.GetReturnValue().Set(Nan::New(reinterpret_cast<const uint16_t*>(value)).ToLocalChecked());
  delete[] value;
  RegCloseKey(key);
}

void WrappedRegistry::ReadMultiString(const FunctionCallbackInfo<Value>& info) {
  assert(info.Length() == 3);

  unique_ptr<wstring> root_key_str(ToWstring(To<String>(info[0]).ToLocalChecked()));
  unique_ptr<wstring> sub_key(ToWstring(To<String>(info[1]).ToLocalChecked()));
  unique_ptr<wstring> value_name(ToWstring(To<String>(info[2]).ToLocalChecked()));

  HKEY root_key = NULL;
  WindowsError error;
  if (root_key_str->compare(L"hkcr") == 0) {
    root_key = HKEY_CLASSES_ROOT;
  } else if (root_key_str->compare(L"hkcc") == 0) {
    root_key = HKEY_CURRENT_CONFIG;
  } else if (root_key_str->compare(L"hkcu") == 0) {
    root_key = HKEY_USERS;

    wstring sid;
    error = GetActiveSessionId(&sid);
    if (error.is_error()) {
      ThrowError(Exception::Error(Nan::New(error.message().c_str()).ToLocalChecked()));
      return;
    }

    sid.append(L"\\");
    sub_key->insert(0, sid);
  } else if (root_key_str->compare(L"hklm") == 0) {
    root_key = HKEY_LOCAL_MACHINE;
  } else if (root_key_str->compare(L"hku") == 0) {
    root_key = HKEY_USERS;
  }
  if (root_key == NULL) {
    return ThrowError("Invalid root key.");
  }

  HKEY key;
  error = WindowsError("ReadString -> RegOpenKey", RegOpenKeyW(root_key, sub_key->c_str(), &key));
  if (error.is_error()) {
    ThrowError(Exception::Error(Nan::New(error.message().c_str()).ToLocalChecked()));
    return;
  }

  DWORD value_size = 0;
  // Get the size
  error = WindowsError("ReadString -> RegQueryValueEx", RegQueryValueExW(key, value_name->c_str(),
    NULL, NULL, nullptr, &value_size));


  if (error.is_error()) {
    RegCloseKey(key);
    ThrowError(Exception::Error(Nan::New(error.message().c_str()).ToLocalChecked()));
    return;
  }
  if (value_size == 0) {
    RegCloseKey(key);
    return;
  }

  wchar_t* value = new wchar_t[value_size];
  error = WindowsError("ReadString -> RegQueryValueEx", RegQueryValueExW(key, value_name->c_str(),
    NULL, NULL, reinterpret_cast<byte*>(value), &value_size));
  if (error.is_error()) {
    RegCloseKey(key);
    ThrowError(Exception::Error(Nan::New(error.message().c_str()).ToLocalChecked()));
    return;
  }

  Local<Array> result = Nan::New<Array>();
  uint32 start = 0;
  uint32 index = 0;
  for (uint32 i = 0; i < value_size; i++) {
    if (value[i] == L'\0') {
      if (i == start) {
        // 2 nulls in a row, we're at the end of the string
        break;
      }
      result->Set(index,
          Nan::New(reinterpret_cast<const uint16_t*>(&value[start])).ToLocalChecked());
      index++;
      start = i + 1;
    }
  }

  info.GetReturnValue().Set(result);
  RegCloseKey(key);
}

}  // namespace psi
}  // namespace sbat