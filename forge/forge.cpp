#include "forge/forge.h"

#include <node.h>
#include <v8.h>
#include <Windows.h>
#include <assert.h>

#include "common/func_hook.h"
#include "common/types.h"
#include "forge/direct_glaw.h"
#include "logger/logger.h"
#include "shieldbattery/shieldbattery.h"
#include "v8-helpers/helpers.h"

namespace sbat {
namespace forge {

using v8::Arguments;
using v8::Boolean;
using v8::Context;
using v8::Function;
using v8::FunctionTemplate;
using v8::Handle;
using v8::HandleScope;
using v8::Local;
using v8::Object;
using v8::Persistent;
using v8::String;
using v8::TryCatch;
using v8::Value;

Persistent<Function> Forge::constructor;
Forge* Forge::instance_ = nullptr;

Forge::Forge()
    : hooks_(),
      window_handle_(NULL) {
  assert(instance_ == nullptr);
  instance_ = this;

  HMODULE process = GetModuleHandle(NULL);
  hooks_.CreateWindowExA = new ImportHook<ImportHooks::CreateWindowExAFunc>(
      process, "user32.dll", "CreateWindowExA", CreateWindowExAHook);
  hooks_.GetSystemMetrics = new ImportHook<ImportHooks::GetSystemMetricsFunc>(
      process, "user32.dll", "GetSystemMetrics", GetSystemMetricsHook);
  hooks_.GetProcAddress = new ImportHook<ImportHooks::GetProcAddressFunc>(
      process, "kernel32.dll", "GetProcAddress", GetProcAddressHook);
}

Forge::~Forge() {
  #define DELETE_(name) \
      delete hooks_.##name##; \
      hooks_.##name## = nullptr;
  DELETE_(CreateWindowExA);
  DELETE_(GetSystemMetrics);
  DELETE_(GetProcAddress);
  #undef DELETE_

  instance_ = nullptr;
}

void Forge::Init() {
  Local<FunctionTemplate> tpl = FunctionTemplate::New(New);
  tpl->SetClassName(String::NewSymbol("Forge"));
  tpl->InstanceTemplate()->SetInternalFieldCount(1);

  SetProtoMethod(tpl, "inject", Inject);
  SetProtoMethod(tpl, "restore", Restore);
  SetProtoMethod(tpl, "runWndProc", RunWndProc);
  SetProtoMethod(tpl, "endWndProc", EndWndProc);

  constructor = Persistent<Function>::New(tpl->GetFunction());
}

Handle<Value> Forge::New(const Arguments& args) {
  HandleScope scope;
  Forge* forge = new Forge();
  forge->Wrap(args.This());
  return scope.Close(args.This());
}

Handle<Value> Forge::NewInstance() {
  HandleScope scope;
  Local<Object> instance = constructor->NewInstance();
  return scope.Close(instance);
}

Handle<Value> Forge::Inject(const Arguments& args) {
  HandleScope scope;
  bool result = true;

  result &= instance_->hooks_.CreateWindowExA->Inject();
  result &= instance_->hooks_.GetSystemMetrics->Inject();
  result &= instance_->hooks_.GetProcAddress->Inject();

  return scope.Close(Boolean::New(result));
}

Handle<Value> Forge::Restore(const Arguments& args) {
  HandleScope scope;
  bool result = true;

  result &= instance_->hooks_.CreateWindowExA->Restore();
  result &= instance_->hooks_.GetSystemMetrics->Restore();
  result &= instance_->hooks_.GetProcAddress->Restore();

  return scope.Close(Boolean::New(result));
}

#define WM_END_WND_PROC_WORKER (WM_USER + 27)

struct WndProcContext {
  Persistent<Function> cb;
  bool quit;
};

void WndProcWorker(void* arg) {
  WndProcContext* context = reinterpret_cast<WndProcContext*>(arg);
  context->quit = false;

  MSG msg;
  while (GetMessage(&msg, NULL, 0, 0)) {
    if (msg.message == WM_END_WND_PROC_WORKER) {
      return;
    }

    TranslateMessage(&msg);
    DispatchMessage(&msg);
  }

  context->quit = true;
}

void WndProcWorkerAfter(void* arg) {
  HandleScope scope;

  WndProcContext* context = reinterpret_cast<WndProcContext*>(arg);
  TryCatch try_catch;
  Handle<Value> argv[] = { v8::Null(), Boolean::New(context->quit) };
  context->cb->Call(Context::GetCurrent()->Global(), 2, argv);

  context->cb.Dispose();
  delete context;
  if (try_catch.HasCaught()) {
    node::FatalException(try_catch);
  }
}

Handle<Value> Forge::RunWndProc(const Arguments& args) {
  HandleScope scope;
  assert(instance_->window_handle_ != NULL);
  assert(args.Length() > 0);
  Local<Function> cb = args[0].As<Function>();

  WndProcContext* context = new WndProcContext();
  context->cb = Persistent<Function>::New(cb);

  sbat::QueueWorkForUiThread(context, WndProcWorker, WndProcWorkerAfter);

  return scope.Close(v8::Undefined());
}

Handle<Value> Forge::EndWndProc(const Arguments& args) {
  HandleScope scope;
  assert(instance_->window_handle_ != NULL);

  PostMessage(instance_->window_handle_, WM_END_WND_PROC_WORKER, NULL, NULL);
  return scope.Close(v8::Undefined());
}

HWND __stdcall Forge::CreateWindowExAHook(DWORD dwExStyle, LPCSTR lpClassName,
    LPCSTR lpWindowName, DWORD dwStyle, int x, int y, int nWidth, int nHeight, HWND hWndParent,
    HMENU hMenu, HINSTANCE hInstance, LPVOID lpParam) {
  Logger::Logf(LogLevel::Verbose, "CreateWindowExA called for class %s (%d,%d), %dx%d",
      lpClassName, x, y, nWidth, nHeight);
  if (strcmp(lpClassName, "SWarClass") != 0) {
    return instance_->hooks_.CreateWindowExA->original()(dwExStyle, lpClassName, lpWindowName,
        dwStyle, x, y, nWidth, nHeight, hWndParent, hMenu, hInstance, lpParam);
  }
  // Modify the passed parameters so that they create a properly sized window instead of trying to
  // be full-screen
  int width = 640;
  int height = 480;
  // TODO(tec27): should we call through to GetSystemMetricsHook->original() instead? Might be good
  // for compatibility with any other windowed mode stuff that expects to be able to modify the IAT
  // entries and have an affect, although I don't think we really care
  int left = (GetSystemMetrics(SM_CXSCREEN) - 640) / 2;  // for now, we'll just center the window
  int top = (GetSystemMetrics(SM_CYSCREEN) - 480) / 2;
  DWORD style = dwStyle & ~WS_SYSMENU;
  Logger::Logf(LogLevel::Verbose, "Rewriting CreateWindowExA call to (%d, %d), %dx%d)",
      left, top, width, height);
  instance_->window_handle_ = instance_->hooks_.CreateWindowExA->original()(dwExStyle, lpClassName,
      lpWindowName, style, left, top, width, height, hWndParent, hMenu, hInstance, lpParam);
  return instance_->window_handle_;
}

int __stdcall Forge::GetSystemMetricsHook(int nIndex) {
  // if BW asks what the resolution is, we tell it 640x480. Because its 1998, goddamnit.
  switch (nIndex) {
  // widths
  case SM_CXSCREEN:
  case SM_CXFULLSCREEN: return 640;
  // heights
  case SM_CYSCREEN:
  case SM_CYFULLSCREEN: return 480;
  default: return instance_->hooks_.GetSystemMetrics->original()(nIndex);
  }
}

FARPROC __stdcall Forge::GetProcAddressHook(HMODULE hModule, LPCSTR lpProcName) {
  if (strcmp(lpProcName, "DirectDrawCreate") == 0) {
    Logger::Log(LogLevel::Verbose, "Injecting custom DirectDrawCreate");
    return reinterpret_cast<FARPROC>(DirectGlawCreate);
  } else {
    return instance_->hooks_.GetProcAddress->original()(hModule, lpProcName);
  }
}

}  // namespace forge
}  // namespace sbat