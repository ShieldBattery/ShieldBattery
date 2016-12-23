#include "node-psi/module.h"

#include <node.h>
#include <nan.h>
#include <uv.h>
#include <Windows.h>
#include <stdlib.h>
#include <memory>
#include <string>
#include <vector>

#include "common/types.h"
#include "common/win_helpers.h"
#include "v8-helpers/helpers.h"
#include "node-psi/wrapped_process.h"
#include "node-psi/wrapped_registry.h"
#include "psi/psi.h"

using Nan::Callback;
using Nan::FunctionCallbackInfo;
using Nan::GetCurrentContext;
using Nan::HandleScope;
using Nan::Null;
using Nan::Set;
using Nan::ThrowError;
using Nan::To;
using std::string;
using std::unique_ptr;
using std::vector;
using std::wstring;
using v8::Array;
using v8::Boolean;
using v8::Exception;
using v8::Function;
using v8::FunctionTemplate;
using v8::Local;
using v8::Object;
using v8::String;
using v8::Value;

const uint32 TICKS_PER_MILISECOND = 10000;
const uint64 MILISECONDS_TO_UNIX_EPOCH = 11644473600000;

namespace sbat {
namespace psi {

struct LaunchContext {
  uv_work_t req;
  unique_ptr<wstring> app_path;
  unique_ptr<wstring> arguments;
  bool launch_suspended;
  unique_ptr<wstring> current_dir;
  unique_ptr<vector<wstring>> environment;
  unique_ptr<Callback> callback;

  Process* process;
};

void LaunchWork(uv_work_t* req) {
  LaunchContext* context = reinterpret_cast<LaunchContext*>(req->data);

  context->process = new Process(*context->app_path, *context->arguments, context->launch_suspended,
      *context->current_dir, *context->environment);
}

void LaunchAfter(uv_work_t* req, int status) {
  HandleScope scope;
  LaunchContext* context = reinterpret_cast<LaunchContext*>(req->data);

  Local<Value> err = Null();
  Local<Value> proc = Null();

  if (context->process->has_errors()) {
    err = Exception::Error(Nan::New(context->process->error().message().c_str()).ToLocalChecked());
  } else {
    proc = WrappedProcess::NewInstance(context->process);
  }

  Local<Value> argv[] = { err, proc };
  context->callback->Call(GetCurrentContext()->Global(), 2, argv);
  delete context;
}

void LaunchProcess(const FunctionCallbackInfo<Value>& info) {
  assert(info.Length() == 6);
  assert(info[5]->IsFunction());

  LaunchContext* context = new LaunchContext;
  context->app_path = ToWstring(To<String>(info[0]).ToLocalChecked());
  context->arguments = ToWstring(To<String>(info[1]).ToLocalChecked());
  context->launch_suspended = To<Boolean>(info[2]).ToLocalChecked()->BooleanValue();
  context->current_dir = ToWstring(To<String>(info[3]).ToLocalChecked());

  Local<Array> js_env = info[4].As<Array>();
  context->environment.reset(new vector<wstring>());
  for (uint32 i = 0; i < js_env->Length(); i++) {
    context->environment->push_back(*ToWstring(To<String>(js_env->Get(i)).ToLocalChecked()));
  }

  context->callback.reset(new Callback(info[5].As<Function>()));
  context->req.data = context;
  uv_queue_work(uv_default_loop(), &context->req, LaunchWork, LaunchAfter);

  return;
}

struct ResContext {
  uv_work_t req;
  unique_ptr<Callback> callback;

  uint32 exit_code;
  WindowsError error;
  ResolutionMessage message;
};

void DetectResolutionWork(uv_work_t* req) {
  ResContext* context = reinterpret_cast<ResContext*>(req->data);

  wchar_t path[MAX_PATH];
  GetModuleFileNameW(NULL, path, sizeof(path) / sizeof(wchar_t));
 
  wstring path_str = path;
  size_t last_slash = path_str.find_last_of(L"/\\");
  wstring dir = path_str.substr(0, last_slash);
  wstring emitter_path = dir + L"\\psi-emitter.exe";

  wchar_t* slot_name = new wchar_t[100];
  int size = _snwprintf_s(
      slot_name, 100, _TRUNCATE, L"\\\\.\\mailslot\\psi-detectres-%I64u", GetTickCount64());

  SECURITY_ATTRIBUTES sa = SECURITY_ATTRIBUTES();
  sa.nLength = sizeof(sa);
  sa.bInheritHandle = false;
  SECURITY_DESCRIPTOR sd = SECURITY_DESCRIPTOR();
  InitializeSecurityDescriptor(&sd, SECURITY_DESCRIPTOR_REVISION);
  SetSecurityDescriptorDacl(&sd, true, NULL, false);
  sa.lpSecurityDescriptor = &sd;

  WinHandle slot_handle(CreateMailslotW(slot_name, sizeof(ResolutionMessage), 5000, &sa));
  if (slot_handle.get() == INVALID_HANDLE_VALUE) {
    context->exit_code = 101;
    context->error = WindowsError("DetectResolutionWork -> CreateMailslot", GetLastError());
    return;
  }

  wstring args = L"\"" + emitter_path + L"\" detectResolution \"" + slot_name + L"\"";
  vector<wstring> environment;
  Process process(emitter_path, args, false, dir, environment);
  if (process.has_errors()) {
    context->exit_code = 101;
    context->error = process.error();
    return;
  }

  bool timed_out;
  WindowsError result = process.WaitForExit(5000, &timed_out);
  if (result.is_error()) {
    context->exit_code = 101;
    context->error = result;
    return;
  } else if (timed_out) {
    context->exit_code = 102;
    return;
  }

  result = process.GetExitCode(&context->exit_code);
  if (result.is_error()) {
    context->exit_code = 101;
    context->error = result;
    return;
  } else if (context->exit_code != 0) {
    return;
  }

  // process exited properly, so it must have written to the mailslot. Read it!
  DWORD bytes_read;
  bool success = ReadFile(slot_handle.get(), &context->message, sizeof(context->message),
      &bytes_read, nullptr) == TRUE;
  if (!success) {
    context->exit_code = 101;
    context->error = WindowsError("DetectResolutionWork -> ReadFile", GetLastError());
    return;
  } else if (bytes_read != sizeof(context->message)) {
    context->exit_code = 103;
    return;
  }
}

void DetectResolutionAfter(uv_work_t* req, int status) {
  HandleScope scope;
  ResContext* context = reinterpret_cast<ResContext*>(req->data);

  Local<Value> err = Null();
  Local<Value> resolution = Null();

  if (context->exit_code == 101) {
    err = Exception::Error(Nan::New(context->error.message().c_str()).ToLocalChecked());
  } else if (context->exit_code != 0) {
    char msg[100];
    _snprintf_s(msg, sizeof(msg), "Non-zero exit code: 0x%08x", context->exit_code);
    err = Exception::Error(Nan::New(msg).ToLocalChecked());
  } else {
    resolution = Nan::New<Object>();
    Local<Object> obj = resolution.As<Object>();
    obj->Set(Nan::New("width").ToLocalChecked(), Nan::New(context->message.width));
    obj->Set(Nan::New("height").ToLocalChecked(), Nan::New(context->message.height));
  }

  Local<Value> argv[] = { err, resolution };
  context->callback->Call(GetCurrentContext()->Global(), 2, argv);
  delete context;
}

void DetectResolution(const FunctionCallbackInfo<Value>& info) {
  assert(info.Length() == 1);
  assert(info[0]->IsFunction());

  ResContext* context = new ResContext();
  context->req.data = context;
  context->callback.reset(new Callback(info[0].As<Function>()));
  uv_queue_work(uv_default_loop(), &context->req, DetectResolutionWork, DetectResolutionAfter);

  return;
}

struct PathCheckContext {
  uv_work_t req;
  unique_ptr<wstring> path;
  unique_ptr<Callback> callback;

  uint32 exit_code;
  WindowsError error;
};

void CheckPathWork(uv_work_t* req) {
  PathCheckContext* context = reinterpret_cast<PathCheckContext*>(req->data);

  wchar_t path[MAX_PATH];
  GetModuleFileNameW(NULL, path, sizeof(path) / sizeof(wchar_t));

  wstring path_str = path;
  size_t last_slash = path_str.find_last_of(L"/\\");
  wstring dir = path_str.substr(0, last_slash);
  wstring emitter_path = dir + L"\\psi-emitter.exe";

  wstring args = L"\"" + emitter_path + L"\" checkPath \"" + *context->path + L"\"";
  vector<wstring> environment;
  Process process(emitter_path, args, false, dir, environment);
  if (process.has_errors()) {
    context->exit_code = 101;
    context->error = process.error();
    return;
  }

  bool timed_out;
  WindowsError result = process.WaitForExit(5000, &timed_out);
  if (result.is_error()) {
    context->exit_code = 101;
    context->error = result;
    return;
  } else if (timed_out) {
    context->exit_code = 102;
    return;
  }

  result = process.GetExitCode(&context->exit_code);
  if (result.is_error()) {
    context->exit_code = 101;
    context->error = result;
    return;
  }
}

void CheckPathAfter(uv_work_t* req, int status) {
  HandleScope scope;
  PathCheckContext* context = reinterpret_cast<PathCheckContext*>(req->data);

  Local<Value> err = Null();

  if (context->exit_code == 101) {
    err = Exception::Error(Nan::New(context->error.message().c_str()).ToLocalChecked());
  } else if (context->exit_code != 0) {
    char msg[100];
    _snprintf_s(msg, sizeof(msg), "Non-zero exit code: 0x%08x", context->exit_code);
    err = Exception::Error(Nan::New(msg).ToLocalChecked());
    if (context->exit_code == ERROR_PRODUCT_VERSION) {
      err->ToObject()->Set(Nan::New("name").ToLocalChecked(),
          Nan::New("ProductVersionError").ToLocalChecked());
    }
  }

  Local<Value> argv[] = {err};
  context->callback->Call(GetCurrentContext()->Global(), 1, argv);
  delete context;
}

void CheckStarcraftPath(const FunctionCallbackInfo<Value>& info) {
  assert(info.Length() == 2);
  assert(info[0]->IsString());
  assert(info[1]->IsFunction());

  PathCheckContext* context = new PathCheckContext();
  context->req.data = context;
  context->path = ToWstring(To<String>(info[0]).ToLocalChecked());
  context->callback.reset(new Callback(info[1].As<Function>()));
  uv_queue_work(uv_default_loop(), &context->req, CheckPathWork, CheckPathAfter);

  return;
}

unique_ptr<Callback> shutdown_callback;

void RegisterShutdownHandler(const FunctionCallbackInfo<Value>& info) {
  assert(info.Length() == 1);
  assert(info[0]->IsFunction());

  shutdown_callback.reset(new Callback(info[0].As<Function>()));

  return;
}

void EmitShutdown() {
  HandleScope scope;
  if (!shutdown_callback) {
    return;
  }

  shutdown_callback->Call(GetCurrentContext()->Global(), 0, nullptr);
}

struct FileObject {
  bool is_folder;
  wstring name;
  wstring path;
  double date;
};

struct FolderContext {
  uv_work_t req;
  unique_ptr<wstring> path;
  unique_ptr<Callback> callback;

  vector<FileObject> files;
  WindowsError error;
};

void ReadFolderAsUserWork(uv_work_t* req) {
  FolderContext* context = reinterpret_cast<FolderContext*>(req->data);
  ActiveUserToken priv_token;
  if (priv_token.has_errors()) {
    context->error = priv_token.error();
    return;
  }

  UserImpersonation impersonate(priv_token.get());
  if (impersonate.has_errors()) {
    context->error = impersonate.error();
    return;
  }

  WIN32_FIND_DATAW file_data;
  HANDLE file_handle = FindFirstFileW((*context->path + L"\\*").c_str(), &file_data);
  if (file_handle != INVALID_HANDLE_VALUE) {
    do {
      wstring name = file_data.cFileName;
      bool is_folder = file_data.dwFileAttributes == FILE_ATTRIBUTE_DIRECTORY;
      wstring path = *context->path + L"\\" + name;
      FILETIME time_created = file_data.ftCreationTime;
      // The FILETIME structure represents the number of 100-nanosecond intervals since January 1,
      // 1601. We convert it to the number of miliseconds since January 1, 1970, so it can be used
      // with the Date API in JS-land
      uint64 date = (static_cast<ULONGLONG>(time_created.dwHighDateTime) << 32) +
          time_created.dwLowDateTime;
      date = date / TICKS_PER_MILISECOND - MILISECONDS_TO_UNIX_EPOCH;

      FileObject file{ is_folder, name, path, static_cast<double>(date) };
      context->files.push_back(file);
    } while (FindNextFileW(file_handle, &file_data) != 0);
  }
  FindClose(file_handle);
}

void ReadFolderAsUserAfter(uv_work_t* req, int status) {
  HandleScope scope;
  FolderContext* context = reinterpret_cast<FolderContext*>(req->data);

  Local<Value> err = Null();
  Local<Value> dir_contents = Null();
  vector<FileObject> files = context->files;

  if (context->error.is_error()) {
    err = Exception::Error(Nan::New(context->error.message().c_str()).ToLocalChecked());
  } else {
    dir_contents = Nan::New<Array>();
    for (unsigned int i = 0; i < files.size(); i++) {
      HandleScope scope;
      Local<Object> replay_object = Nan::New<Object>();
      replay_object->Set(Nan::New("isFolder").ToLocalChecked(), Nan::New(files[i].is_folder));
      replay_object->Set(Nan::New("name").ToLocalChecked(),
          ScopelessWstring::New(files[i].name)->ApplyCurrentScope());
      replay_object->Set(Nan::New("path").ToLocalChecked(),
          ScopelessWstring::New(files[i].path)->ApplyCurrentScope());
      replay_object->Set(Nan::New("date").ToLocalChecked(), Nan::New<v8::Number>(files[i].date));
      Set(dir_contents.As<Object>(), i, replay_object.As<Value>());
    }
  }

  Local<Value> argv[] = { err, dir_contents };
  context->callback->Call(GetCurrentContext()->Global(), 2, argv);
  delete context;
}

void ReadFolderAsUser(const FunctionCallbackInfo<Value>& info) {
  assert(info.Length() == 2);
  assert(info[0]->IsString());
  assert(info[1]->IsFunction());

  FolderContext* context = new FolderContext();
  context->req.data = context;
  context->path = ToWstring(To<String>(info[0]).ToLocalChecked());
  context->callback.reset(new Callback(info[1].As<Function>()));
  uv_queue_work(uv_default_loop(), &context->req, ReadFolderAsUserWork, ReadFolderAsUserAfter);

  return;
}

void GetDocumentsPathAsUser(const FunctionCallbackInfo<Value>& info) {
  ActiveUserToken priv_token;
  if (priv_token.has_errors()) {
    ThrowError(Exception::Error(Nan::New(priv_token.error().message().c_str()).ToLocalChecked()));
    return;
  }

  UserImpersonation impersonate(priv_token.get());
  if (impersonate.has_errors()) {
    ThrowError(Exception::Error(Nan::New(impersonate.error().message().c_str()).ToLocalChecked()));
    return;
  }

  wstring documents_path = GetDocumentsPath();
  if (documents_path.length() == 0) {
    WindowsError error("Unable to retrieve path to user's documents folder", GetLastError());
    ThrowError(Exception::Error(Nan::New(error.message().c_str()).ToLocalChecked()));
    return;
  }
  info.GetReturnValue().Set(
      Nan::New(reinterpret_cast<const uint16_t*>(documents_path.c_str())).ToLocalChecked());
}

void Initialize(Local<Object> exports, Local<Value> unused) {
  HandleScope scope;
  WrappedProcess::Init();
  WrappedRegistry::Init();
  shutdown_callback = unique_ptr<Callback>();
  PsiService::SetShutdownCallback(EmitShutdown);

  Local<Object> active_user_fs = Nan::New<Object>();
  active_user_fs->Set(Nan::New("readFolder").ToLocalChecked(),
      Nan::New<FunctionTemplate>(ReadFolderAsUser)->GetFunction());

  exports->Set(Nan::New("launchProcess").ToLocalChecked(),
      Nan::New<FunctionTemplate>(LaunchProcess)->GetFunction());
  exports->Set(Nan::New("detectResolution").ToLocalChecked(),
      Nan::New<FunctionTemplate>(DetectResolution)->GetFunction());
  exports->Set(Nan::New("checkStarcraftPath").ToLocalChecked(),
      Nan::New<FunctionTemplate>(CheckStarcraftPath)->GetFunction());
  exports->Set(Nan::New("registerShutdownHandler").ToLocalChecked(),
      Nan::New<FunctionTemplate>(RegisterShutdownHandler)->GetFunction());
  exports->Set(Nan::New("activeUserFs").ToLocalChecked(), active_user_fs);
  exports->Set(Nan::New("getDocumentsPath").ToLocalChecked(),
      Nan::New<FunctionTemplate>(GetDocumentsPathAsUser)->GetFunction());
  exports->Set(Nan::New("registry").ToLocalChecked(), WrappedRegistry::NewInstance());
}

}  // namespace psi
}  // namespace sbat

NODE_MODULE(shieldbattery_psi, sbat::psi::Initialize);