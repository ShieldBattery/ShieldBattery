#include "forge/forge.h"

#include <node.h>
#include <v8.h>
#include <Windows.h>
#include <assert.h>
#include <string>

#include "common/func_hook.h"
#include "common/types.h"
#include "forge/indirect_draw.h"
#include "logger/logger.h"
#include "shieldbattery/settings.h"
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
      create_sound_buffer_hook_(nullptr),
      window_handle_(NULL),
      original_wndproc_(nullptr),
      indirect_draw_(nullptr),
      vertex_shader_src_(nullptr),
      fragment_shader_src_(nullptr),
      fbo_vertex_shader_src_(nullptr),
      fbo_fragment_shader_src_(nullptr),
      client_x_(0),
      client_y_(0),
      cursor_x_(0),
      cursor_y_(0),
      width_(0),
      height_(0),
      display_mode_(0),
      mouse_resolution_width_(0),
      mouse_resolution_height_(0),
      is_started_(false),
      captured_window_(NULL) {
  assert(instance_ == nullptr);
  instance_ = this;

  HMODULE process = GetModuleHandle(NULL);
  hooks_.CreateWindowExA = new ImportHook<ImportHooks::CreateWindowExAFunc>(
      process, "user32.dll", "CreateWindowExA", CreateWindowExAHook);
  hooks_.RegisterClassExA = new ImportHook<ImportHooks::RegisterClassExAFunc>(
      process, "user32.dll", "RegisterClassExA", RegisterClassExAHook);
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
  hooks_.SetCapture = new ImportHook<ImportHooks::SetCaptureFunc>(
      process, "user32.dll", "SetCapture", SetCaptureHook);
  hooks_.ReleaseCapture = new ImportHook<ImportHooks::ReleaseCaptureFunc>(
      process, "user32.dll", "ReleaseCapture", ReleaseCaptureHook);
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
  DELETE_(SetCapture);
  DELETE_(ReleaseCapture);
  #undef DELETE_

  if (create_sound_buffer_hook_) {
    delete create_sound_buffer_hook_;
    create_sound_buffer_hook_ = nullptr;
    // we use LoadLibrary in DirectSoundCreateHook, so we need to free the library here if its still
    // loaded
    HMODULE dsound = GetModuleHandle("dsound.dll");
    if (dsound != NULL) {
      FreeLibrary(dsound);
    }
  }
  if (indirect_draw_) {
    indirect_draw_->Release();
    indirect_draw_ = nullptr;
  }
  delete vertex_shader_src_;
  vertex_shader_src_ = nullptr;
  delete fragment_shader_src_;
  fragment_shader_src_ = nullptr;
  delete fbo_vertex_shader_src_;
  fbo_vertex_shader_src_ = nullptr;
  delete fbo_fragment_shader_src_;
  fbo_fragment_shader_src_ = nullptr;

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
  SetProtoMethod(tpl, "setShaders", SetShaders);

  constructor = Persistent<Function>::New(tpl->GetFunction());
}

void Forge::RegisterIndirectDraw(OpenGl* open_gl, IndirectDraw* indirect_draw) {
  assert(instance_->indirect_draw_ == nullptr);
  assert(instance_->vertex_shader_src_);
  assert(instance_->fragment_shader_src_);
  assert(instance_->fbo_vertex_shader_src_);
  assert(instance_->fbo_fragment_shader_src_);

  indirect_draw->AddRef();
  instance_->indirect_draw_ = indirect_draw;
  open_gl->SetShaders(instance_->vertex_shader_src_, instance_->fragment_shader_src_, "main");
  open_gl->SetShaders(
      instance_->fbo_vertex_shader_src_, instance_->fbo_fragment_shader_src_, "fbo");
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
  result &= instance_->hooks_.RegisterClassExA->Inject();
  result &= instance_->hooks_.GetSystemMetrics->Inject();
  result &= instance_->hooks_.GetProcAddress->Inject();
  result &= instance_->hooks_.IsIconic->Inject();
  result &= instance_->hooks_.ClientToScreen->Inject();
  result &= instance_->hooks_.ScreenToClient->Inject();
  result &= instance_->hooks_.GetClientRect->Inject();
  result &= instance_->hooks_.GetCursorPos->Inject();
  result &= instance_->hooks_.SetCursorPos->Inject();
  result &= instance_->hooks_.ClipCursor->Inject();
  result &= instance_->hooks_.SetCapture->Inject();
  result &= instance_->hooks_.ReleaseCapture->Inject();

  return scope.Close(Boolean::New(result));
}

Handle<Value> Forge::Restore(const Arguments& args) {
  HandleScope scope;
  bool result = true;

  result &= instance_->hooks_.CreateWindowExA->Restore();
  result &= instance_->hooks_.RegisterClassExA->Restore();
  result &= instance_->hooks_.GetSystemMetrics->Restore();
  result &= instance_->hooks_.GetProcAddress->Restore();
  result &= instance_->hooks_.IsIconic->Restore();
  result &= instance_->hooks_.ClientToScreen->Restore();
  result &= instance_->hooks_.ScreenToClient->Restore();
  result &= instance_->hooks_.GetClientRect->Restore();
  result &= instance_->hooks_.GetCursorPos->Restore();
  result &= instance_->hooks_.SetCursorPos->Restore();
  result &= instance_->hooks_.ClipCursor->Restore();
  result &= instance_->hooks_.SetCapture->Restore();
  result &= instance_->hooks_.ReleaseCapture->Restore();

  return scope.Close(Boolean::New(result));
}

#define WM_END_WND_PROC_WORKER (WM_USER + 27)
#define WM_GAME_STARTED (WM_USER + 7)

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

Handle<Value> Forge::SetShaders(const Arguments& args) {
  HandleScope scope;
  assert(instance_->window_handle_ == NULL);
  assert(args.Length() >= 1);
  String::Utf8Value vert(args[0]->ToString());
  std::string* vertex_src = new std::string(*vert);
  String::Utf8Value frag(args[1]->ToString());
  std::string* fragment_src = new std::string(*frag);
  std::wstring* shader_type = ToWstring(args[2]->ToString());

  if (*shader_type == L"main") {
    if (instance_->vertex_shader_src_) {
      delete instance_->vertex_shader_src_;
    }
    instance_->vertex_shader_src_ = vertex_src;

    if (instance_->fragment_shader_src_) {
      delete instance_->fragment_shader_src_;
    }
    instance_->fragment_shader_src_ = fragment_src;
  } else if (*shader_type == L"fbo") {
    if (instance_->fbo_vertex_shader_src_) {
      delete instance_->fbo_vertex_shader_src_;
    }
    instance_->fbo_vertex_shader_src_ = vertex_src;

    if (instance_->fbo_fragment_shader_src_) {
      delete instance_->fbo_fragment_shader_src_;
    }
    instance_->fbo_fragment_shader_src_ = fragment_src;
  }

  return scope.Close(v8::Undefined());
}

const int FOREGROUND_HOTKEY_ID = 1337;
const int FOREGROUND_HOTKEY_TIMEOUT = 1000;
LRESULT WINAPI Forge::WndProc(HWND window_handle, UINT msg, WPARAM wparam, LPARAM lparam) {
  bool call_orig = true;
  switch (msg) {
  case WM_NCHITTEST:
    if (GetSettings().display_mode != DisplayMode::Window) {
      return HTCLIENT;
    }
  case WM_NCLBUTTONDOWN:
  case WM_NCLBUTTONUP:
  case WM_NCMOUSEMOVE:
  case WM_NCPAINT:
  case WM_ACTIVATE:
  case WM_ACTIVATEAPP:
  case WM_CAPTURECHANGED:
  case WM_KILLFOCUS:
  case WM_PAINT:
  case WM_SETFOCUS:
  case WM_SHOWWINDOW:
  case WM_SIZE:
  case WM_WINDOWPOSCHANGED:
  case WM_WINDOWPOSCHANGING:
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
  case WM_GETMINMAXINFO:
    DefWindowProc(window_handle, msg, wparam, lparam);
    {
      // Make it so Windows doesn't limit this window to the display resolution, so we can size the
      // client area to precisely match the display resolution (with borders hanging over)
      MINMAXINFO* min_max = reinterpret_cast<MINMAXINFO*>(lparam);
      min_max->ptMaxTrackSize.x = 999999;
      min_max->ptMaxTrackSize.y = 999999;
    }
    return 0;
  case WM_LBUTTONDBLCLK:
  case WM_LBUTTONDOWN:
  case WM_LBUTTONUP:
  case WM_MBUTTONDBLCLK:
  case WM_MBUTTONDOWN:
  case WM_MBUTTONUP:
  case WM_RBUTTONDBLCLK:
  case WM_RBUTTONDOWN:
  case WM_RBUTTONUP:
  case WM_XBUTTONDBLCLK:
  case WM_XBUTTONDOWN:
  case WM_XBUTTONUP:
  case WM_MOUSEMOVE:
    // cache the actual mouse position for GetCursorPos
    instance_->cursor_x_ = GetX(lparam);
    instance_->cursor_y_ = GetY(lparam);
    lparam = MakePositionParam(
        static_cast<int>((GetX(lparam) * (640.0 / instance_->mouse_resolution_width_)) + 0.5),
        static_cast<int>((GetY(lparam) * (480.0 / instance_->mouse_resolution_height_)) + 0.5));
    break;
  case WM_NCACTIVATE:
    if (instance_->is_started_ && GetSettings().display_mode != DisplayMode::FullScreen) {
      SetWindowPos(window_handle, (wparam ? HWND_TOPMOST : HWND_NOTOPMOST),
        0, 0, 0, 0, SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE);
    }
    return DefWindowProc(window_handle, msg, wparam, lparam);
  case WM_GAME_STARTED:
    // Windows Vista+ likes to prevent you from bringing yourself into the foreground, but will
    // allow you to do so if you're handling a global hotkey. So... we register a global hotkey and
    // then press it ourselves, then bring ourselves into the foreground while handling it.
    RegisterHotKey(window_handle, FOREGROUND_HOTKEY_ID, NULL, VK_F22);
    {
      INPUT key_input = INPUT();
      key_input.type = INPUT_KEYBOARD;
      key_input.ki.wVk = VK_F22;
      key_input.ki.wScan = MapVirtualKey(VK_F22, 0);
      SendInput(1, &key_input, sizeof(key_input));
      key_input.ki.dwFlags |= KEYEVENTF_KEYUP;
      SendInput(1, &key_input, sizeof(key_input));
      // Set a timer just in case the input doesn't get dispatched in a reasonable timeframe
      SetTimer(window_handle, FOREGROUND_HOTKEY_ID, FOREGROUND_HOTKEY_TIMEOUT, NULL);
    }

    instance_->is_started_ = true;
    break;
  case WM_HOTKEY:
  case WM_TIMER:
    if (wparam == FOREGROUND_HOTKEY_ID) {
      // remove hotkey and timer
      UnregisterHotKey(window_handle, FOREGROUND_HOTKEY_ID);
      KillTimer(window_handle, FOREGROUND_HOTKEY_ID);

      // Show the window and bring it to the front
      ShowWindow(window_handle, SW_SHOWNORMAL);
      SetForegroundWindow(window_handle);

      // Clip the cursor
      RECT clip_rect;
      clip_rect.left = 0;
      clip_rect.top = 0;
      clip_rect.right = 640;
      clip_rect.bottom = 480;
      ClipCursorHook(&clip_rect);
      // Move the cursor to the middle of the window
      SetCursorPosHook(320, 240);
    }
    break;
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
  const Settings& settings = GetSettings();
  DWORD style;
  switch (settings.display_mode) {
  case DisplayMode::FullScreen:
    instance_->width_ = GetSystemMetrics(SM_CXSCREEN);
    instance_->height_ = GetSystemMetrics(SM_CYSCREEN);
    style = BORDERLESS_WINDOW;
    break;
  case DisplayMode::BorderlessWindow:
    instance_->width_ = settings.width;
    instance_->height_ = settings.height;
    style = BORDERLESS_WINDOW;
    break;
  case DisplayMode::Window:
    instance_->width_ = settings.width;
    instance_->height_ = settings.height;
    style = WINDOW;
    break;
  }

  instance_->CalculateMouseResolution(instance_->width_, instance_->height_);

  // for now, we'll just center the window
  int left = (GetSystemMetrics(SM_CXSCREEN) - instance_->width_) / 2;
  int top = (GetSystemMetrics(SM_CYSCREEN) - instance_->height_) / 2;

  // set our initial cached client rect positions
  instance_->client_x_ = left;
  instance_->client_y_ = top;

  // we want the *client rect* to be our width/height, not the actual window size
  RECT window_rect;
  window_rect.left = left;
  window_rect.top =  top;
  window_rect.right = left + instance_->width_;
  window_rect.bottom = top + instance_->height_;
  AdjustWindowRect(&window_rect, style, FALSE);

  Logger::Logf(LogLevel::Verbose, "Rewriting CreateWindowExA call to (%d, %d), %dx%d)",
      window_rect.left, window_rect.top,
      window_rect.right - window_rect.left, window_rect.bottom - window_rect.top);
  instance_->window_handle_ = instance_->hooks_.CreateWindowExA->original()(dwExStyle,
      lpClassName, lpWindowName, style, window_rect.left, window_rect.top,
      window_rect.right - window_rect.left, window_rect.bottom - window_rect.top, hWndParent, hMenu,
      hInstance, lpParam);
  instance_->original_wndproc_ = reinterpret_cast<WNDPROC>(
      GetWindowLong(instance_->window_handle_, GWL_WNDPROC));
  SetWindowLong(instance_->window_handle_, GWL_WNDPROC, reinterpret_cast<LONG>(Forge::WndProc));
  // In some cases, Windows seems to not give us a window of the size we requested, so we also
  // re-apply the size and position here just in case
  SetWindowPos(instance_->window_handle_, HWND_BOTTOM,
      window_rect.left, window_rect.top,
      window_rect.right - window_rect.left, window_rect.bottom - window_rect.top,
      SWP_NOACTIVATE | SWP_HIDEWINDOW);

  if (GetSettings().display_mode == DisplayMode::FullScreen ||
      GetSettings().display_mode == DisplayMode::BorderlessWindow) {
    // Remove the border
    int left = instance_->client_x_ - window_rect.left;
    int top = instance_->client_y_ - window_rect.top;
    Logger::Logf(LogLevel::Verbose, "Setting window region to: %d,%d - %d,%d",
        left, top, left + instance_->width_, top + instance_->height_);

    RECT created_rect;
    GetWindowRect(instance_->window_handle_, &created_rect);
    assert(left + instance_->width_ <= created_rect.right - created_rect.left);
    // we add left here because its the border width, and the height is caption + client + border
    assert(top + instance_->height_ + left <= created_rect.bottom - created_rect.top);
    SetWindowRgn(instance_->window_handle_,
        CreateRectRgn(left, top, left + instance_->width_, top + instance_->height_), TRUE);
  }

  return instance_->window_handle_;
}

ATOM __stdcall Forge::RegisterClassExAHook(const WNDCLASSEX* lpwcx) {
  if (strcmp(lpwcx->lpszClassName, "SWarClass") != 0) {
    return instance_->hooks_.RegisterClassExA->original()(lpwcx);
  }

  WNDCLASSEX rewritten = *lpwcx;
  rewritten.style |= CS_OWNDC;
  Logger::Log(LogLevel::Verbose, "Rewrote SWarClass to have CS_OWNDC");
  return instance_->hooks_.RegisterClassExA->original()(&rewritten);
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
    return reinterpret_cast<FARPROC>(IndirectDrawCreate);
  } else if (strcmp(lpProcName, "DirectSoundCreate8")) {
    Logger::Log(LogLevel::Verbose, "Injecting custom DirectSoundCreate8");
    return reinterpret_cast<FARPROC>(DirectSoundCreate8Hook);
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

  // TODO(tec27): I don't think BW even actually uses this, and this implementation is wrong given
  // our different window types. Figure out if BW calls this, and if not, delete it.

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
  // BW thinks its running full screen in 640x480, so we give it our mouse_resolution-scaled coords
  lpPoint->x = static_cast<int>(
      (instance_->cursor_x_ * (640.0 / instance_->mouse_resolution_width_)) + 0.5);
  lpPoint->y = static_cast<int>(
      (instance_->cursor_y_ * (480.0 / instance_->mouse_resolution_height_)) + 0.5);
  return TRUE;
}

BOOL __stdcall Forge::SetCursorPosHook(int x, int y) {
  if (!instance_->is_started_) {
    // if we're not actually in the game yet, just ignore any requests to reposition the cursor
    return TRUE;
  }
  // BW thinks its running full screen in 640x480, so we take the coords it gives us and scale by
  // our mouse resolution, then tack on the additional top/left space it doesn't know about
  x = static_cast<int>(((x * (instance_->mouse_resolution_width_ / 640.0)) + 0.5)) +
      instance_->client_x_;
  y = static_cast<int>(((y * (instance_->mouse_resolution_height_ / 480.0)) + 0.5)) +
      instance_->client_y_;
  return instance_->hooks_.SetCursorPos->original()(x, y);
}

BOOL __stdcall Forge::ClipCursorHook(const LPRECT lpRect) {
  if (lpRect == NULL) {
    // if they're clearing the clip, we just call through because there's nothing to adjust
    return instance_->hooks_.ClipCursor->original()(lpRect);
  }

  if (!instance_->is_started_) {
    // if we're not actually in the game yet, just ignore any requests to lock the cursor
    return TRUE;
  }

  // BW thinks its running full screen 640x480, so it will request a 640x480 clip
  // Instead, we'll request a mouse_resolution-sized rect at the top-left of our client area
  RECT actual_rect;
  actual_rect.left = static_cast<int>(
    (lpRect->left * (instance_->mouse_resolution_width_ / 640.0)) + 0.5) + instance_->client_x_;
  actual_rect.top = static_cast<int>(
    (lpRect->top * (instance_->mouse_resolution_height_ / 480.0)) + 0.5) + instance_->client_y_;
  actual_rect.right = actual_rect.left + instance_->mouse_resolution_width_;
  actual_rect.bottom = actual_rect.top + instance_->mouse_resolution_height_;
  return instance_->hooks_.ClipCursor->original()(&actual_rect);
}

typedef HRESULT (__stdcall *DirectSoundCreateFunc)(const GUID* device,
    IDirectSound8** direct_sound_out, IUnknown* unused);
HRESULT __stdcall Forge::DirectSoundCreate8Hook(const GUID* device,
    IDirectSound8** direct_sound_out, IUnknown* unused) {
  HMODULE dsound = LoadLibrary("dsound.dll");
  assert(dsound != NULL);
  DirectSoundCreateFunc real_create = reinterpret_cast<DirectSoundCreateFunc>(
      GetProcAddress(dsound, "DirectSoundCreate8"));
  assert(real_create != NULL);
  HRESULT result = real_create(device, direct_sound_out, unused);
  if (result != DS_OK) {
    Logger::Log(LogLevel::Verbose, "DirectSound creation failed");
    return result;
  }

  Logger::Log(LogLevel::Verbose, "DirectSound created");
  if (instance_->create_sound_buffer_hook_ == nullptr) {
    Logger::Log(LogLevel::Verbose, "Hooking CreateSoundBuffer");
    // the vtable isn't really full of CreateSoundBufferFuncs, but close enough ;)
    CreateSoundBufferFunc* vtable = *reinterpret_cast<CreateSoundBufferFunc**>(*direct_sound_out);
    CreateSoundBufferFunc create_sound_buffer = vtable[3];  // 4th function is CSB
    instance_->create_sound_buffer_hook_ = new FuncHook<CreateSoundBufferFunc>(
        create_sound_buffer, Forge::CreateSoundBufferHook);
    instance_->create_sound_buffer_hook_->Inject();
    Logger::Logf(LogLevel::Verbose, "CreateSoundBuffer hooked.", create_sound_buffer);
  }

  return result;
}

HRESULT __stdcall Forge::CreateSoundBufferHook(IDirectSound8* this_ptr,
    const DSBUFFERDESC* buffer_desc, IDirectSoundBuffer** buffer_out, IUnknown* unused) {
  HRESULT result;
  instance_->create_sound_buffer_hook_->Restore();

  if (buffer_desc->dwFlags & DSBCAPS_GLOBALFOCUS || buffer_desc->dwFlags & DSBCAPS_PRIMARYBUFFER) {
    result = this_ptr->CreateSoundBuffer(buffer_desc, buffer_out, unused);
  } else {
    DSBUFFERDESC rewritten_desc = *buffer_desc;
    rewritten_desc.dwFlags |= DSBCAPS_GLOBALFOCUS;
    result = this_ptr->CreateSoundBuffer(&rewritten_desc, buffer_out, unused);
  }

  instance_->create_sound_buffer_hook_->Inject();
  return result;
}

HWND __stdcall Forge::SetCaptureHook(HWND hWnd) {
  if (instance_->captured_window_) {
    PostMessage(instance_->captured_window_, WM_CAPTURECHANGED, NULL, LPARAM(hWnd));
  }

  instance_->captured_window_ = hWnd;

  return instance_->captured_window_;
}

BOOL __stdcall Forge::ReleaseCaptureHook() {
  instance_->captured_window_ = NULL;

  return TRUE;
}

void Forge::CalculateMouseResolution(uint32 width, uint32 height) {
  const Settings& settings = GetSettings();
  double delta;

  if (width > height) {
    delta = (height - 480.0) / 4;
    mouse_resolution_height_ = static_cast<int>(
        (height - (delta * settings.mouse_sensitivity)) + 0.5);
    mouse_resolution_width_ = static_cast<int>((mouse_resolution_height_ * 4.0 / 3) + 0.5);
  } else {
    delta = (width - 640.0) / 4;
    mouse_resolution_width_ = static_cast<int>(
        (width - (delta * settings.mouse_sensitivity)) + 0.5);
    mouse_resolution_height_ = static_cast<int>((mouse_resolution_width_ * 3.0 / 4) + 0.5);
  }

  Logger::Logf(LogLevel::Verbose, "Mouse Resolution: %dx%d",
      mouse_resolution_width_, mouse_resolution_height_);
}

}  // namespace forge
}  // namespace sbat
