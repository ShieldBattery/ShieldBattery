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
      window_handle_(NULL),
      original_wndproc_(nullptr),
      direct_glaw_(nullptr),
      vertex_shader_src_(nullptr),
      fragment_shader_src_(nullptr),
      client_x_(0),
      client_y_(0),
      cursor_x_(0),
      cursor_y_(0) {
  assert(instance_ == nullptr);
  instance_ = this;

  HMODULE process = GetModuleHandle(NULL);
  hooks_.CreateWindowExA = new ImportHook<ImportHooks::CreateWindowExAFunc>(
      process, "user32.dll", "CreateWindowExA", CreateWindowExAHook);
  hooks_.GetSystemMetrics = new ImportHook<ImportHooks::GetSystemMetricsFunc>(
      process, "user32.dll", "GetSystemMetrics", GetSystemMetricsHook);
  hooks_.GetProcAddress = new ImportHook<ImportHooks::GetProcAddressFunc>(
      process, "kernel32.dll", "GetProcAddress", GetProcAddressHook);
  hooks_.IsIconic = new ImportHook<ImportHooks::IsIconicFunc>(
      process, "user32.dll", "IsIconic", IsIconicHook);
  hooks_.ClientToScreen = new ImportHook<ImportHooks::ClientToScreenFunc>(
      process, "user32.dll", "ClientToScreen", ClientToScreenHook);
  hooks_.ScreenToClient = new ImportHook<ImportHooks::ScreenToClientFunc>(
      process, "user32.dll", "ScreenToClient", ScreenToClientHook);
  hooks_.GetClientRect = new ImportHook<ImportHooks::GetClientRectFunc>(
      process, "user32.dll", "GetClientRect", GetClientRectHook);
  hooks_.GetCursorPos = new ImportHook<ImportHooks::GetCursorPosFunc>(
      process, "user32.dll", "GetCursorPos", GetCursorPosHook);
  hooks_.SetCursorPos = new ImportHook<ImportHooks::SetCursorPosFunc>(
      process, "user32.dll", "SetCursorPos", SetCursorPosHook);
  hooks_.ClipCursor = new ImportHook<ImportHooks::ClipCursorFunc>(
      process, "user32.dll", "ClipCursor", ClipCursorHook);
}

Forge::~Forge() {
  #define DELETE_(name) \
      delete hooks_.##name##; \
      hooks_.##name## = nullptr;
  DELETE_(CreateWindowExA);
  DELETE_(GetSystemMetrics);
  DELETE_(GetProcAddress);
  DELETE_(IsIconic);
  DELETE_(ClientToScreen);
  DELETE_(ScreenToClient);
  DELETE_(GetClientRect);
  DELETE_(GetCursorPos);
  DELETE_(SetCursorPos);
  DELETE_(ClipCursor);
  #undef DELETE_

  if (direct_glaw_) {
    direct_glaw_->Release();
    direct_glaw_ = nullptr;
  }
  delete[] vertex_shader_src_;
  vertex_shader_src_ = nullptr;
  delete[] fragment_shader_src_;
  fragment_shader_src_ = nullptr;

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
  SetProtoMethod(tpl, "setVertexShader", SetVertexShader);
  SetProtoMethod(tpl, "setFragmentShader", SetFragmentShader);

  constructor = Persistent<Function>::New(tpl->GetFunction());
}

void Forge::RegisterDirectGlaw(DirectGlaw* direct_glaw) {
  assert(instance_->direct_glaw_ == nullptr);
  assert(instance_->vertex_shader_src_);
  assert(instance_->fragment_shader_src_);

  direct_glaw->AddRef();
  instance_->direct_glaw_ = direct_glaw;
  direct_glaw->SetVertexShader(instance_->vertex_shader_src_);
  direct_glaw->SetFragmentShader(instance_->fragment_shader_src_);
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
  result &= instance_->hooks_.IsIconic->Inject();
  result &= instance_->hooks_.ClientToScreen->Inject();
  result &= instance_->hooks_.ScreenToClient->Inject();
  result &= instance_->hooks_.GetClientRect->Inject();
  result &= instance_->hooks_.GetCursorPos->Inject();
  result &= instance_->hooks_.SetCursorPos->Inject();
  result &= instance_->hooks_.ClipCursor->Inject();

  return scope.Close(Boolean::New(result));
}

Handle<Value> Forge::Restore(const Arguments& args) {
  HandleScope scope;
  bool result = true;

  result &= instance_->hooks_.CreateWindowExA->Restore();
  result &= instance_->hooks_.GetSystemMetrics->Restore();
  result &= instance_->hooks_.GetProcAddress->Restore();
  result &= instance_->hooks_.IsIconic->Restore();
  result &= instance_->hooks_.ClientToScreen->Restore();
  result &= instance_->hooks_.ScreenToClient->Restore();
  result &= instance_->hooks_.GetClientRect->Restore();
  result &= instance_->hooks_.GetCursorPos->Restore();
  result &= instance_->hooks_.SetCursorPos->Restore();
  result &= instance_->hooks_.ClipCursor->Restore();

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

  // TODO(tec27): deal with this quit flag
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

Handle<Value> Forge::SetVertexShader(const Arguments& args) {
  HandleScope scope;
  assert(instance_->window_handle_ == NULL);
  assert(args.Length() >= 1);
  String::AsciiValue shader_src(args[0]);
  if (instance_->vertex_shader_src_) {
    delete[] instance_->vertex_shader_src_;
  }
  instance_->vertex_shader_src_ = new char[shader_src.length() + 1];
  strcpy_s(instance_->vertex_shader_src_, shader_src.length() + 1, *shader_src);
  
  return scope.Close(v8::Undefined());
}

Handle<Value> Forge::SetFragmentShader(const Arguments& args) {
  HandleScope scope;
  assert(instance_->window_handle_ == NULL);
  assert(args.Length() >= 1);
  String::AsciiValue shader_src(args[0]);
  if (instance_->fragment_shader_src_) {
    delete[] instance_->fragment_shader_src_;
  }
  instance_->fragment_shader_src_ = new char[shader_src.length() + 1];
  strcpy_s(instance_->fragment_shader_src_, shader_src.length() + 1, *shader_src);
  
  return scope.Close(v8::Undefined());
}

LRESULT WINAPI Forge::WndProc(HWND window_handle, UINT msg, WPARAM wparam, LPARAM lparam) {  
  bool call_orig = true;
  switch(msg) {
  case WM_NCACTIVATE:  
  case WM_NCHITTEST:
  case WM_NCLBUTTONDOWN:
  case WM_NCLBUTTONUP:
  case WM_NCMOUSEMOVE:
  case WM_NCPAINT:
  case WM_PAINT:
  case WM_ACTIVATE:
  case WM_ACTIVATEAPP:
  case WM_KILLFOCUS:
  case WM_SETFOCUS:
  case WM_SHOWWINDOW:
  case WM_SIZE:
    return DefWindowProc(window_handle, msg, wparam, lparam);
  case WM_SYSCOMMAND:
    if (wparam == SC_KEYMENU || wparam == SC_MOUSEMENU) {
      return 0;
    } else {
      return DefWindowProc(window_handle, msg, wparam, lparam);
    }
  case WM_MOVE:
    instance_->client_x_ = GetX(lparam);
    instance_->client_y_ = GetY(lparam);
    return DefWindowProc(window_handle, msg, wparam, lparam);
  case WM_MOUSEMOVE:
    // cache the actual mouse position for GetCursorPos
    instance_->cursor_x_ = GetX(lparam);
    instance_->cursor_y_ = GetY(lparam);
  }

  if (!call_orig) {
    return 0;
  }

  if (!instance_->original_wndproc_) {
    return DefWindowProc(window_handle, msg, wparam, lparam);
  } else {
    return instance_->original_wndproc_(window_handle, msg, wparam, lparam);
  }
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
  assert(instance_->window_handle_ == NULL);
  // Modify the passed parameters so that they create a properly sized window instead of trying to
  // be full-screen
  int width = 640;
  int height = 480;
  int left = (GetSystemMetrics(SM_CXSCREEN) - width) / 2;  // for now, we'll just center the window
  int top = (GetSystemMetrics(SM_CYSCREEN) - height) / 2;
  DWORD style = WS_POPUP | WS_VISIBLE | WS_CAPTION | WS_SYSMENU;

  // set our initial cached client rect positions
  instance_->client_x_ = left;
  instance_->client_y_ = top;

  // we want the *client rect* to be 640x480, not the actual window size
  RECT window_rect;
  window_rect.left = left;
  window_rect.top =  top;
  window_rect.right = left + width;
  window_rect.bottom = top + height;
  AdjustWindowRect(&window_rect, style, FALSE);

  Logger::Logf(LogLevel::Verbose, "Rewriting CreateWindowExA call to (%d, %d), %dx%d)",
      window_rect.left, window_rect.top,
      window_rect.right - window_rect.left, window_rect.bottom - window_rect.top);
  instance_->window_handle_ = instance_->hooks_.CreateWindowExA->original()(dwExStyle, lpClassName,
      lpWindowName, style, window_rect.left, window_rect.top, window_rect.right - window_rect.left,
      window_rect.bottom - window_rect.top, hWndParent, hMenu, hInstance, lpParam);
  instance_->original_wndproc_ = reinterpret_cast<WNDPROC>(
      GetWindowLong(instance_->window_handle_, GWL_WNDPROC));
  SetWindowLong(instance_->window_handle_, GWL_WNDPROC, reinterpret_cast<LONG>(Forge::WndProc));

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

BOOL __stdcall Forge::IsIconicHook(HWND hWnd) {
  if (hWnd == instance_->window_handle_) {
    return FALSE;
  } else {
    return instance_->hooks_.IsIconic->original()(hWnd);
  }
}

BOOL __stdcall Forge::ClientToScreenHook(HWND hWnd, LPPOINT lpPoint) {
  if (hWnd != instance_->window_handle_) {
    return  instance_->hooks_.ClientToScreen->original()(hWnd, lpPoint);
  }

  // We want BW to think its full screen, and therefore any coordinates it wants in screenspace
  // would be the same as the ones its passing in
  return TRUE;
}

BOOL __stdcall Forge::ScreenToClientHook(HWND hWnd, LPPOINT lpPoint) {
  if (hWnd != instance_->window_handle_) {
    return instance_->hooks_.ScreenToClient->original()(hWnd, lpPoint);
  }

  Logger::Logf(LogLevel::Verbose, "ScreenToClient(%d, %d)", lpPoint->x, lpPoint->y);
  RECT window_rect;
  RECT client_rect;
  GetWindowRect(hWnd, &window_rect);
  GetClientRect(hWnd, &client_rect);
  LONG border_size_x = ((window_rect.right - window_rect.left) - client_rect.right) / 2;
  int border_size_y = GetSystemMetrics(SM_CYCAPTION);
  lpPoint->x += window_rect.left + border_size_x;
  lpPoint->y += window_rect.top + border_size_y;
  assert((window_rect.bottom - window_rect.top) ==
      (client_rect.bottom + border_size_y + border_size_x));

  BOOL result = instance_->hooks_.ScreenToClient->original()(hWnd, lpPoint);
  Logger::Logf(LogLevel::Verbose, "=> (%d, %d)", lpPoint->x, lpPoint->y);
  return result;
}

BOOL __stdcall Forge::GetClientRectHook(HWND hWnd, LPRECT lpRect) {
  if (hWnd != instance_->window_handle_) {
    return instance_->hooks_.GetClientRect->original()(hWnd, lpRect);
  }

  lpRect->left = 0;
  lpRect->top = 0;
  lpRect->right = 640;
  lpRect->bottom = 480;
  return TRUE;
}

BOOL __stdcall Forge::GetCursorPosHook(LPPOINT lpPoint) {
  // BW thinks its running full screen in 640x480, so we give it our client area coords
  lpPoint->x = instance_->cursor_x_;
  lpPoint->y = instance_->cursor_y_;
  return TRUE;
}

BOOL __stdcall Forge::SetCursorPosHook(int x, int y) {
  // BW thinks its running full screen in 640x480, so we take the coords it gives us and tack on
  // the additional top/left space it doesn't know about
  x += instance_->client_x_;
  y += instance_->client_y_;
  return instance_->hooks_.SetCursorPos->original()(x, y);
}

BOOL __stdcall Forge::ClipCursorHook(const LPRECT lpRect) {
  if (lpRect == NULL) {
    // if they're clearing the clip, we just call through because there's nothing to adjust
    return instance_->hooks_.ClipCursor->original()(lpRect);
  }
  // BW thinks its running full screen 640x480, so it will request a 640x480 clip
  // Instead, we'll request our window's actual client area
  RECT actual_rect;
  actual_rect.left = lpRect->left + instance_->client_x_;
  actual_rect.top = lpRect->top + instance_->client_y_;
  actual_rect.right = actual_rect.left + 640;
  actual_rect.bottom = actual_rect.top + 480;
  return instance_->hooks_.ClipCursor->original()(&actual_rect);
}

}  // namespace forge
}  // namespace sbat