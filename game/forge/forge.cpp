#include "forge/forge.h"

#include <node.h>
#include <nan.h>
#include <v8.h>
#include <Windows.h>
#include <ShellScalingAPI.h>
#include <VersionHelpers.h>
#include <assert.h>
#include <map>
#include <memory>
#include <string>

#include "common/func_hook.h"
#include "common/types.h"
#include "forge/direct_x.h"
#include "forge/indirect_draw.h"
#include "forge/open_gl.h"
#include "logger/logger.h"
#include "node-bw/forge_interface.h"
#include "shieldbattery/settings.h"
#include "shieldbattery/shieldbattery.h"
#include "v8-helpers/helpers.h"

namespace sbat {
namespace forge {

using Nan::Callback;
using Nan::EscapableHandleScope;
using Nan::FunctionCallbackInfo;
using Nan::GetCurrentContext;
using Nan::HandleScope;
using Nan::Null;
using Nan::Persistent;
using Nan::SetPrototypeMethod;
using Nan::Utf8String;
using std::map;
using std::pair;
using std::shared_ptr;
using std::unique_ptr;
using std::wstring;
using v8::Function;
using v8::FunctionTemplate;
using v8::Local;
using v8::Object;
using v8::String;
using v8::Value;

Persistent<Function> Forge::constructor;
Forge* Forge::instance_ = nullptr;

Forge::Forge()
    : process_hooks_(GetModuleHandle(NULL)),
      storm_hooks_(GetModuleHandle("storm.dll")),
      create_sound_buffer_hook_(nullptr),
      render_screen_hook_(),
      window_handle_(NULL),
      original_wndproc_(nullptr),
      dx_shaders(),
      gl_shaders(),
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
      should_clip_cursor_(false),
      window_active_(false),
      bw_window_active_(false),
      captured_window_(NULL),
      stored_cursor_rect_(nullptr),
      active_bitmap_(NULL),
      indirect_draw_(nullptr),
      event_publish_mutex_(), 
      event_publish_async_(),
      event_publish_queue_() {
  assert(instance_ == nullptr);
  instance_ = this;

  uv_mutex_init(&event_publish_mutex_);
  uv_async_init(uv_default_loop(), &event_publish_async_, [](uv_async_t* handle) {
    Forge::instance_->PublishQueuedEvents();
  });

  process_hooks_.AddHook("user32.dll", "CreateWindowExA", CreateWindowExAHook);
  process_hooks_.AddHook("user32.dll", "RegisterClassExA", RegisterClassExAHook);
  process_hooks_.AddHook("user32.dll", "GetSystemMetrics", GetSystemMetricsHook);
  process_hooks_.AddHook("kernel32.dll", "GetProcAddress", GetProcAddressHook);
  process_hooks_.AddHook("user32.dll", "IsIconic", IsIconicHook);
  process_hooks_.AddHook("user32.dll", "ClientToScreen", ClientToScreenHook);
  process_hooks_.AddHook("user32.dll", "ScreenToClient", ScreenToClientHook);
  process_hooks_.AddHook("user32.dll", "GetClientRect", GetClientRectHook);
  process_hooks_.AddHook("user32.dll", "GetCursorPos", GetCursorPosHook);
  process_hooks_.AddHook("user32.dll", "SetCursorPos", SetCursorPosHook);
  process_hooks_.AddHook("user32.dll", "ClipCursor", ClipCursorHook);
  process_hooks_.AddHook("user32.dll", "SetCapture", SetCaptureHook);
  process_hooks_.AddHook("user32.dll", "ReleaseCapture", ReleaseCaptureHook);
  process_hooks_.AddHook("user32.dll", "ShowWindow", ShowWindowHook);
  process_hooks_.AddHook("user32.dll", "GetKeyState", GetKeyStateHook);
  process_hooks_.AddHook("gdi32.dll", "CreateCompatibleBitmap", CreateCompatibleBitmapHook);
  process_hooks_.AddHook("gdi32.dll", "DeleteObject", DeleteObjectHook);
  process_hooks_.AddHook("gdi32.dll", "GetObjectA", GetObjectHook);
  process_hooks_.AddHook("gdi32.dll", "GetBitmapBits", GetBitmapBitsHook);

  storm_hooks_.AddHook("user32.dll", "IsIconic", IsIconicHook);
  storm_hooks_.AddHook("user32.dll", "IsWindowVisible", IsWindowVisibleHook);

  // TODO(tec27): move this hook into brood_war?
  render_screen_hook_.reset(new FuncHook<RenderScreenFunc>(
      reinterpret_cast<RenderScreenFunc>(0x41E280), RenderScreenHook));
}

Forge::~Forge() {
  if (create_sound_buffer_hook_) {
    delete create_sound_buffer_hook_;
    // we use LoadLibrary in DirectSoundCreateHook, so we need to free the library here if its still
    // loaded
    HMODULE dsound = GetModuleHandle("dsound.dll");
    if (dsound != NULL) {
      FreeLibrary(dsound);
    }
  }

  if (indirect_draw_) {
    indirect_draw_->Release();
  }

  uv_close(reinterpret_cast<uv_handle_t*>(&event_publish_async_), NULL);
  uv_mutex_destroy(&event_publish_mutex_);

  instance_ = nullptr;
}

void Forge::SendJsEvent(const wstring& type, const shared_ptr<ScopelessValue>& payload) {
  ScopelessObject* obj = ScopelessObject::New();

  obj->Set(L"type", shared_ptr<ScopelessValue>(ScopelessWstring::New(type)));
  obj->Set(L"payload", payload);

  uv_mutex_lock(&event_publish_mutex_);
  event_publish_queue_.push(shared_ptr<ScopelessValue>(obj));
  uv_async_send(&event_publish_async_);
  uv_mutex_unlock(&event_publish_mutex_);
}

void Forge::PublishQueuedEvents() {
  HandleScope scope;

  Local<Object> self = this->handle();
  Local<String> event_prop = Nan::New("onPublishEvent").ToLocalChecked();
  if (!(Nan::HasOwnProperty(self, event_prop).ToChecked())) {
    Logger::Log(LogLevel::Error, "onPublishEvent not set on Forge, unable to publish events");
    return;
  }

  Local<Function> event_func = Nan::Get(self, event_prop).ToLocalChecked().As<Function>();

  uv_mutex_lock(&event_publish_mutex_);
  while (!event_publish_queue_.empty()) {
    auto value = event_publish_queue_.front();
    event_publish_queue_.pop();
    uv_mutex_unlock(&event_publish_mutex_);

    Local<Value> args[] = { value->ApplyCurrentScope() };
    event_func->Call(self, 1, args);
    uv_mutex_lock(&event_publish_mutex_);
  }
  uv_mutex_unlock(&event_publish_mutex_);
}

void Forge::Init() {
  Local<FunctionTemplate> tpl = Nan::New<FunctionTemplate>(New);
  tpl->SetClassName(Nan::New("Forge").ToLocalChecked());
  tpl->InstanceTemplate()->SetInternalFieldCount(1);

  SetPrototypeMethod(tpl, "inject", Inject);
  SetPrototypeMethod(tpl, "restore", Restore);
  SetPrototypeMethod(tpl, "runWndProc", RunWndProc);
  SetPrototypeMethod(tpl, "endWndProc", EndWndProc);
  SetPrototypeMethod(tpl, "setShaders", SetShaders);

  constructor.Reset(tpl->GetFunction());
}

RendererDisplayMode ConvertDisplayMode(DisplayMode display_mode) {
  switch (display_mode) {
  case DisplayMode::BorderlessWindow: return RendererDisplayMode::BorderlessWindow;
  case DisplayMode::Window: return RendererDisplayMode::Window;
  case DisplayMode::FullScreen:
  default:
    return RendererDisplayMode::FullScreen;
  }
}

bool UsesSwapBuffers(RenderMode render_mode) {
  switch (render_mode) {
  case RenderMode::OpenGl:
    return true;
  case RenderMode::DirectX:
  default:
    return false;
  }
}

unique_ptr<Renderer> Forge::CreateRenderer(HWND window, uint32 ddraw_width, uint32 ddraw_height) {
  assert(!instance_->gl_shaders.empty());
  assert(!instance_->dx_shaders.empty());

  const Settings& settings = GetSettings();
  switch (settings.renderer) {
  case RenderMode::OpenGl:
  {
    unique_ptr<OpenGl> open_gl = OpenGl::Create(window, ddraw_width, ddraw_height,
        ConvertDisplayMode(settings.display_mode), settings.maintain_aspect_ratio,
        instance_->gl_shaders);

    if (!open_gl) {
      // TODO(tec27): We could/should probably send this through JS-land instead, and display an error
      // on the website (since that's where they'll be looking at this point)
      MessageBoxA(NULL, OpenGl::GetLastError().c_str(), "Shieldbattery Error", MB_OK);
      ExitProcess(1);
    }

    return unique_ptr<Renderer>(std::move(open_gl));
  }
  case RenderMode::DirectX:
  default:
  {
    unique_ptr<DirectXRenderer> direct_x = DirectXRenderer::Create(window, ddraw_width,
        ddraw_height, ConvertDisplayMode(settings.display_mode), settings.maintain_aspect_ratio,
        instance_->dx_shaders);

    if (!direct_x) {
      // TODO(tec27): We could/should probably send this through JS-land instead, and display an error
      // on the website (since that's where they'll be looking at this point)
      MessageBoxA(NULL, DirectXRenderer::GetLastError().c_str(), "Shieldbattery Error", MB_OK);
      ExitProcess(1);
    }

    return unique_ptr<Renderer>(std::move(direct_x));
  }
  }
}

void Forge::RegisterIndirectDraw(IndirectDraw* indirect_draw) {
  if (instance_->indirect_draw_) {
    instance_->indirect_draw_->Release();
  }

  instance_->indirect_draw_ = indirect_draw;
  indirect_draw->AddRef();
}

void Forge::New(const FunctionCallbackInfo<Value>& info) {
  Forge* forge = new Forge();
  forge->Wrap(info.This());

  info.GetReturnValue().Set(info.This());
}

Local<Value> Forge::NewInstance() {
  EscapableHandleScope scope;

  Local<Function> cons = Nan::New<Function>(constructor);
  Local<Object> instance = cons->NewInstance();

  return scope.Escape(instance);
}

void Forge::Inject(const FunctionCallbackInfo<Value>& info) {
  bool result = true;

  result &= instance_->process_hooks_.Inject();
  result &= instance_->storm_hooks_.Inject();
  result &= instance_->render_screen_hook_->Inject();

  info.GetReturnValue().Set(Nan::New(result));
}

void Forge::Restore(const FunctionCallbackInfo<Value>& info) {
  bool result = true;

  result &= instance_->process_hooks_.Restore();
  result &= instance_->storm_hooks_.Restore();
  result &= instance_->render_screen_hook_->Restore();

  info.GetReturnValue().Set(Nan::New(result));
}

#define WM_END_WND_PROC_WORKER (WM_USER + 27)
#define WM_GAME_STARTED (WM_USER + 7)

struct WndProcContext {
  unique_ptr<Callback> cb;
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
  Local<Value> argv[] = { Null(), Nan::New(context->quit) };
  context->cb->Call(GetCurrentContext()->Global(), 2, argv);

  delete context;
}

void Forge::RunWndProc(const FunctionCallbackInfo<Value>& info) {
  assert(instance_->window_handle_ != NULL);
  assert(info.Length() > 0);
  Local<Function> cb = info[0].As<Function>();

  WndProcContext* context = new WndProcContext();
  context->cb.reset(new Callback(cb));

  sbat::QueueWorkForUiThread(context, WndProcWorker, WndProcWorkerAfter);

  return;
}

void Forge::EndWndProc(const FunctionCallbackInfo<Value>& info) {
  assert(instance_->window_handle_ != NULL);

  PostMessage(instance_->window_handle_, WM_END_WND_PROC_WORKER, NULL, NULL);
  return;
}

void Forge::SetShaders(const FunctionCallbackInfo<Value>& info) {
  assert(instance_->window_handle_ == NULL);
  assert(info.Length() >= 1);

  Local<Object> dx_vert_shaders = Local<Object>::Cast(info[0]);
  Local<Object> dx_pixel_shaders = Local<Object>::Cast(info[1]);
  Local<Object> gl_vert_shaders = Local<Object>::Cast(info[2]);
  Local<Object> gl_frag_shaders = Local<Object>::Cast(info[3]);

  Local<String> depalettizing = Nan::New("depalettizing").ToLocalChecked();
  Local<String> scaling = Nan::New("scaling").ToLocalChecked();
  instance_->dx_shaders["depalettizing"] = std::make_pair(
      *Utf8String(dx_vert_shaders->Get(depalettizing)->ToString()),
      *Utf8String(dx_pixel_shaders->Get(depalettizing)->ToString()));
  instance_->dx_shaders["scaling"] = std::make_pair(
      *Utf8String(dx_vert_shaders->Get(depalettizing)->ToString()),
      *Utf8String(dx_pixel_shaders->Get(scaling)->ToString()));

  instance_->gl_shaders["depalettizing"] = std::make_pair(
      *Utf8String(gl_vert_shaders->Get(depalettizing)->ToString()),
      *Utf8String(gl_frag_shaders->Get(depalettizing)->ToString()));
  instance_->gl_shaders["scaling"] = std::make_pair(
      *Utf8String(gl_vert_shaders->Get(scaling)->ToString()),
      *Utf8String(gl_frag_shaders->Get(scaling)->ToString()));

  return;
}

void Forge::ReleaseHeldKey(HWND window, int key) {
  LPARAM mouse_lparam = MakePositionParam(ScreenToGameX(cursor_x_), ScreenToGameY(cursor_y_));
  if (original_wndproc_ != nullptr && GetAsyncKeyState(key) & 0x8000) {
    switch (key) {
    case VK_LBUTTON:
      original_wndproc_(window, WM_LBUTTONUP, 0, mouse_lparam);
      break;
    case VK_RBUTTON:
      original_wndproc_(window, WM_RBUTTONUP, 0, mouse_lparam);
      break;
    case VK_MBUTTON:
      original_wndproc_(window, WM_MBUTTONUP, 0, mouse_lparam);
      break;
    default:
      // lparam could be better, but bw shouldn't even look at it..
      original_wndproc_(window, WM_KEYUP, key, 0xc0000001);
      break;
    }
  }
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
  case WM_CAPTURECHANGED:
  case WM_KILLFOCUS:
  case WM_PAINT:
  case WM_SETFOCUS:
  case WM_SHOWWINDOW:
  case WM_SIZE:
  case WM_WINDOWPOSCHANGED:
  case WM_WINDOWPOSCHANGING:
    return DefWindowProc(window_handle, msg, wparam, lparam);
  case WM_DISPLAYCHANGE:
    // TODO(tec27): we might need to do something with this, swallowing DISPLAYCHANGE is the first
    // attempt at fixing the "Launch fullscreen BW while in ShieldBattery game = OMFG WHY IS ALL MY
    // RENDERING MESSED UP?" bug
    return DefWindowProc(window_handle, msg, wparam, lparam);
  case WM_ACTIVATEAPP:
    // BW needs to receive the initial WM_ACTIVATEAPP to function properly.
    if (instance_->bw_window_active_) {
      return DefWindowProc(window_handle, msg, wparam, lparam);
    }
    instance_->bw_window_active_ = true;
    break;
  case WM_SYSCOMMAND:
    if (wparam == SC_KEYMENU || wparam == SC_MOUSEMENU) {
      return 0;
    } else if (wparam != SC_CLOSE) {
      return DefWindowProc(window_handle, msg, wparam, lparam);
    }
    break;
  case WM_MOVE:
    instance_->client_x_ = GetX(lparam);
    instance_->client_y_ = GetY(lparam);
    return DefWindowProc(window_handle, msg, wparam, lparam);
  case WM_EXITSIZEMOVE:
  {
    ScopelessObject* coords = ScopelessObject::New();
    coords->Set(L"x", shared_ptr<ScopelessValue>(ScopelessInteger::New(instance_->client_x_)));
    coords->Set(L"y", shared_ptr<ScopelessValue>(ScopelessInteger::New(instance_->client_y_)));
    instance_->SendJsEvent(L"windowMove", shared_ptr<ScopelessValue>(coords));
    return DefWindowProc(window_handle, msg, wparam, lparam);
  }
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
        instance_->ScreenToGameX(GetX(lparam)),
        instance_->ScreenToGameY(GetY(lparam)));

    if (instance_->should_clip_cursor_) {
      // Window is active and the cursor is over the BW window, clip the cursor
      RECT clip_rect;
      if (instance_->stored_cursor_rect_ != nullptr) {
        clip_rect = *instance_->stored_cursor_rect_;
      } else {
        clip_rect.left = 0;
        clip_rect.top = 0;
        clip_rect.right = 640;
        clip_rect.bottom = 480;
      }
      instance_->PerformScaledClipCursor(&clip_rect);
      instance_->should_clip_cursor_ = false;
    }
    break;
  case WM_SYSKEYDOWN:
    if (wparam == VK_MENU) {
      instance_->should_clip_cursor_ = false;
      instance_->PerformScaledClipCursor(nullptr);
    }
    break;
  // WM_KEYUP is sent for alt if the user pressed another key while holding alt,
  // while WM_SYSKEYUP is sent if alt was just pressed by itself.
  case WM_KEYUP:
  case WM_SYSKEYUP:
    if (wparam == VK_MENU) {
      instance_->should_clip_cursor_ = true;
      instance_->HandleAltRelease();
    }
    break;
  case WM_NCACTIVATE:
  {
    const auto& settings = GetSettings();
    if (instance_->is_started_ &&
        UsesSwapBuffers(settings.renderer) && settings.display_mode == DisplayMode::FullScreen) {
      // Since we avoid Windows' SwapBuffer full-screen heuristics, it doesn't keep the task bar
      // from appearing over our app, so we have to try to solve this ourselves. This is non-ideal,
      // as it can make it hard to get out of the game (e.g. it breaks Win+D), so if we can find
      // some other, better solution to this that would be great =/
      SetWindowPos(window_handle, (wparam == TRUE ? HWND_TOPMOST : HWND_NOTOPMOST),
          0, 0, 0, 0, SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE);
    }

    instance_->window_active_ = wparam == TRUE;
    if (wparam) {
      // Window is now active
      instance_->should_clip_cursor_ = true;
    } else {
      // Window is now inactive, unclip the mouse (and disable input)
      instance_->should_clip_cursor_ = false;
      instance_->PerformScaledClipCursor(nullptr);

      // As we don't give the activation messages to bw, send some key release
      // messages to prevent them from staying down once the window is activated again.
      instance_->ReleaseHeldKey(window_handle, VK_MENU);
      instance_->ReleaseHeldKey(window_handle, VK_CONTROL);
      instance_->ReleaseHeldKey(window_handle, VK_SHIFT);
      instance_->ReleaseHeldKey(window_handle, VK_LBUTTON);
      instance_->ReleaseHeldKey(window_handle, VK_MBUTTON);
      instance_->ReleaseHeldKey(window_handle, VK_RBUTTON);
    }
    return DefWindowProc(window_handle, msg, wparam, lparam);
  }
  case WM_GAME_STARTED:
    instance_->is_started_ = true;
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
    return 0;
  case WM_HOTKEY:
  case WM_TIMER:
    if (wparam == FOREGROUND_HOTKEY_ID) {
      // remove hotkey and timer
      UnregisterHotKey(window_handle, FOREGROUND_HOTKEY_ID);
      KillTimer(window_handle, FOREGROUND_HOTKEY_ID);

      // Set the final window title for scene switchers to key off of. Note that this is different
      // from BW's "typical" title so that people don't have to reconfigure scene switchers when
      // moving between our service and others.
      SetWindowText(window_handle, "Brood War - ShieldBattery");

      // Show the window and bring it to the front
      ShowWindow(window_handle, SW_SHOWNORMAL);
      SetForegroundWindow(window_handle);

      const auto& settings = GetSettings();
      if (UsesSwapBuffers(settings.renderer) && settings.display_mode == DisplayMode::FullScreen) {
        // Since we avoid Windows' SwapBuffer full-screen heuristics, it doesn't keep the task bar
        // from appearing over our app, so we have to try to solve this ourselves. This is
        // non-ideal, as it can make it hard to get out of the game (e.g. it breaks Win+D), so if
        // we can find some other, better solution to this that would be great =/
        SetWindowPos(window_handle, HWND_TOPMOST,
          0, 0, 0, 0, SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE);
      }

      // Clip the cursor
      RECT clip_rect;
      clip_rect.left = 0;
      clip_rect.top = 0;
      clip_rect.right = 640;
      clip_rect.bottom = 480;
      instance_->PerformScaledClipCursor(&clip_rect);
      // Move the cursor to the middle of the window
      SetCursorPosHook(320, 240);
      ShowCursor(TRUE);
    }
    break;
  case WM_SETCURSOR:
    if ((lparam & 0xffff) != HTCLIENT) {
      return DefWindowProc(window_handle, msg, wparam, lparam);
    } else {
      SetCursor(NULL);
      return 0;
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

typedef void(__stdcall *SetProcessDpiAwarenessFunc)(PROCESS_DPI_AWARENESS);

HWND __stdcall Forge::CreateWindowExAHook(DWORD dwExStyle, LPCSTR lpClassName,
    LPCSTR lpWindowName, DWORD dwStyle, int x, int y, int nWidth, int nHeight, HWND hWndParent,
    HMENU hMenu, HINSTANCE hInstance, LPVOID lpParam) {
  Logger::Logf(LogLevel::Verbose, "CreateWindowExA called for class %s (%d,%d), %dx%d",
      lpClassName, x, y, nWidth, nHeight);
  if (strcmp(lpClassName, "SWarClass") != 0) {
    return CreateWindowExA(dwExStyle, lpClassName, lpWindowName, dwStyle, x, y, nWidth, nHeight,
        hWndParent, hMenu, hInstance, lpParam);
  }
  assert(instance_->window_handle_ == NULL);

  // Mark this process as DPI-aware, since we just render to the resolution that was set (and don't
  // want Windows scaling our rendering)
  bool dpiAwareSet = false;
  if (IsWindows8Point1OrGreater()) {
    HMODULE shcore = LoadLibrary("shcore.dll");
    if (shcore != NULL) {
      auto SetProcessDpiAwareness = reinterpret_cast<SetProcessDpiAwarenessFunc>(
        GetProcAddress(shcore, "SetProcessDpiAwareness"));
      SetProcessDpiAwareness(PROCESS_PER_MONITOR_DPI_AWARE);
      dpiAwareSet = true;
      FreeLibrary(shcore);
    }
  }
  if (!dpiAwareSet) {
    SetProcessDPIAware();
  }

  // Modify the passed parameters so that they create a properly sized window instead of trying to
  // be full-screen
  const Settings& settings = GetSettings();
  DWORD style;
  switch (settings.display_mode) {
  case DisplayMode::FullScreen:
    instance_->width_ = GetSystemMetrics(SM_CXSCREEN);
    instance_->height_ = GetSystemMetrics(SM_CYSCREEN);
    style = UsesSwapBuffers(settings.renderer) ? BORDERLESS_WINDOW_SWAP : BORDERLESS_WINDOW_NOSWAP;
    break;
  case DisplayMode::BorderlessWindow:
    instance_->width_ = settings.width;
    instance_->height_ = settings.height;
    style = UsesSwapBuffers(settings.renderer) ? BORDERLESS_WINDOW_SWAP : BORDERLESS_WINDOW_NOSWAP;
    break;
  case DisplayMode::Window:
  default:
    instance_->width_ = settings.width;
    instance_->height_ = settings.height;
    style = WINDOW;
    break;
  }

  instance_->CalculateMouseResolution(instance_->width_, instance_->height_);

  RECT work_area;
  SystemParametersInfo(SPI_GETWORKAREA, 0, &work_area, 0);

  // Use the saved window coordinates (if available/applicable), or center the window otherwise
  // TODO(tec27): Check that the saved coordinates are still visible before we apply them
  int left = settings.display_mode == DisplayMode::FullScreen ? 0 : settings.window_x;
  int top = settings.display_mode == DisplayMode::FullScreen ? 0 : settings.window_y;

  if (left == INT_MAX) {
    left = ((work_area.right - work_area.left) - instance_->width_) / 2;
  }
  if (top == INT_MAX) {
    top = ((work_area.bottom - work_area.top) - instance_->height_) / 2;
  }

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
  instance_->window_handle_ = CreateWindowExA(dwExStyle, lpClassName,
      // We change the window name here to make scene switching at the right time easier (we set a
      // different title just as we bring the window into the foreground)
      "ShieldBattery initializing...", style,
      window_rect.left, window_rect.top,
      window_rect.right - window_rect.left, window_rect.bottom - window_rect.top,
      hWndParent, hMenu, hInstance, lpParam);
  // In some cases, Windows seems to not give us a window of the size we requested, so we also
  // re-apply the size and position here just in case
  SetWindowPos(instance_->window_handle_, HWND_BOTTOM,
      window_rect.left, window_rect.top,
      window_rect.right - window_rect.left, window_rect.bottom - window_rect.top,
      SWP_NOACTIVATE | SWP_HIDEWINDOW);
  ShowWindow(instance_->window_handle_, SW_HIDE);

  if (UsesSwapBuffers(GetSettings().renderer) &&
      (GetSettings().display_mode == DisplayMode::FullScreen ||
      GetSettings().display_mode == DisplayMode::BorderlessWindow)) {
    // Remove the border
    left = instance_->client_x_ - window_rect.left;
    top = instance_->client_y_ - window_rect.top;
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
    return RegisterClassExA(lpwcx);
  }

  instance_->original_wndproc_ = lpwcx->lpfnWndProc;
  WNDCLASSEX rewritten = *lpwcx;
  rewritten.style |= CS_OWNDC;
  rewritten.lpfnWndProc = Forge::WndProc;
  Logger::Log(LogLevel::Verbose, "Rewrote SWarClass to have CS_OWNDC");
  return RegisterClassExA(&rewritten);
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
  default: return GetSystemMetrics(nIndex);
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
    return GetProcAddress(hModule, lpProcName);
  }
}

BOOL __stdcall Forge::IsIconicHook(HWND hWnd) {
  if (hWnd == instance_->window_handle_) {
    return FALSE;
  } else {
    return IsIconic(hWnd);
  }
}

BOOL __stdcall Forge::IsWindowVisibleHook(HWND hWnd) {
  if (hWnd == instance_->window_handle_) {
    return TRUE;
  } else {
    return IsWindowVisible(hWnd);
  }
}


BOOL __stdcall Forge::ClientToScreenHook(HWND hWnd, LPPOINT lpPoint) {
  if (hWnd != instance_->window_handle_) {
    return  ClientToScreen(hWnd, lpPoint);
  }

  // We want BW to think its full screen, and therefore any coordinates it wants in screenspace
  // would be the same as the ones its passing in
  return TRUE;
}

BOOL __stdcall Forge::ScreenToClientHook(HWND hWnd, LPPOINT lpPoint) {
  if (hWnd != instance_->window_handle_) {
    return ScreenToClient(hWnd, lpPoint);
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

  BOOL result = ScreenToClient(hWnd, lpPoint);
  Logger::Logf(LogLevel::Verbose, "=> (%d, %d)", lpPoint->x, lpPoint->y);
  return result;
}

BOOL __stdcall Forge::GetClientRectHook(HWND hWnd, LPRECT lpRect) {
  if (hWnd != instance_->window_handle_) {
    return GetClientRect(hWnd, lpRect);
  }

  lpRect->left = 0;
  lpRect->top = 0;
  lpRect->right = 640;
  lpRect->bottom = 480;
  return TRUE;
}

BOOL __stdcall Forge::GetCursorPosHook(LPPOINT lpPoint) {
  // BW thinks its running full screen in 640x480, so we give it our mouse_resolution-scaled coords
  lpPoint->x = instance_->ScreenToGameX(instance_->cursor_x_);
  lpPoint->y = instance_->ScreenToGameY(instance_->cursor_y_);
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
  return SetCursorPos(x, y);
}

BOOL Forge::PerformScaledClipCursor(const RECT* lpRect) {
  if (lpRect == NULL) {
    sbat::bw::SetBroodWarInputDisabled(true);
    // if they're clearing the clip, we just call through because there's nothing to adjust
    return ClipCursor(lpRect);
  }

  sbat::bw::SetBroodWarInputDisabled(false);
  if (!is_started_) {
    // if we're not actually in the game yet, just ignore any requests to lock the cursor
    return TRUE;
  }
  // BW thinks its running full screen 640x480, so it will request a 640x480 clip
  // Instead, we'll request a mouse_resolution-sized rect at the top-left of our client area
  double x_scale = mouse_resolution_width_ / 640.0;
  double y_scale = mouse_resolution_height_ / 480.0;

  RECT actual_rect;
  actual_rect.left = static_cast<int>(lpRect->left * x_scale + 0.5) + client_x_;
  actual_rect.top = static_cast<int>(lpRect->top * y_scale + 0.5) + client_y_;
  actual_rect.right = static_cast<int>(lpRect->right * x_scale + 0.5) + client_x_;
  actual_rect.bottom = static_cast<int>(lpRect->bottom * y_scale + 0.5) + client_y_;

  return ClipCursor(&actual_rect);
}

BOOL __stdcall Forge::ClipCursorHook(const RECT* lpRect) {
  if (lpRect == NULL) {
    instance_->stored_cursor_rect_ = nullptr;
    return instance_->PerformScaledClipCursor(lpRect);
  }

  instance_->stored_cursor_rect_ = unique_ptr<RECT>(new RECT(*lpRect));

  if (instance_->IsCursorInWindow()) {
    return instance_->PerformScaledClipCursor(lpRect);
  } else {
    return TRUE;
  }
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
    Logger::Logf(LogLevel::Verbose, "DirectSound creation failed: %d", result);
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

void __stdcall Forge::RenderScreenHook() {
  auto& hook = *instance_->render_screen_hook_;
  hook.Restore();
  hook.callable()();
  hook.Inject();

  if (instance_->is_started_ && instance_->indirect_draw_) {
    instance_->indirect_draw_->Render();
  }
}

BOOL __stdcall Forge::ShowWindowHook(HWND hwnd, int nCmdShow) {
  // We handle the window showing around here, Brood War.
  if (hwnd == instance_->window_handle_) {
    return TRUE;
  } else {
    return ShowWindow(hwnd, nCmdShow);
  }
}

SHORT __stdcall Forge::GetKeyStateHook(int nVirtKey) {
  if (instance_->window_active_) {
    return GetKeyState(nVirtKey);
  } else {
    // This will get run at least from WM_NCACTIVATE handler's key
    // releasing code, as bw checks the state of modifier keys.
    // If bw checks key state for some other reason while the window
    // is not active, it shouldn't be acting on it anyways.
    return 0;
  }
}

HBITMAP __stdcall Forge::CreateCompatibleBitmapHook(HDC dc, int width, int height) {
  // We have to track the one bitmap BW creates, so we can tell BW it's 8 bits per pixel when it
  // calls GetObject on it.
  HBITMAP result = CreateCompatibleBitmap(dc, width, height);
  if (instance_->active_bitmap_ != NULL) {
    Logger::Log(LogLevel::Warning, "BW is using multiple bitmaps at once?");
  }
  instance_->active_bitmap_ = result;
  return result;
}

BOOL __stdcall Forge::DeleteObjectHook(HGDIOBJ object) {
  if (object == instance_->active_bitmap_) {
    instance_->active_bitmap_ = NULL;
  }
  return DeleteObject(object);
}

int __stdcall Forge::GetObjectHook(HGDIOBJ object, int cbBuffer, LPVOID lpvObject) {
  int result = GetObject(object, cbBuffer, lpvObject);
  if (result != 0 && object == instance_->active_bitmap_) {
    auto bitmap = reinterpret_cast<BITMAP*>(lpvObject);
    bitmap->bmWidthBytes = bitmap->bmWidth;
    bitmap->bmBitsPixel = 1;
    // Fortunately BW doesn't care about the data pointer.
  }
  return result;
}

LONG __stdcall Forge::GetBitmapBitsHook(HBITMAP hbmp, LONG cbBuffer, LPVOID lpvBits) {
  // BW 1.16.1 calls GetBitmapBits only when drawing korean text.
  // (It uses Gdi32 DrawText to draw it to a bitmap DC, and then reads it from there)
  // Since BW believes it has told Windows it is using 8-bit video mode, it assumes that
  // GetBitmapBits returns 8bpp bitmap, so we have to fix it up.
  // This hook assumes that the text is always drawn as simple white-on-black text (which it is).
  //
  // Technically, it seems that it should be possible to just make windows use 8bpp bitmaps, but
  // I wasn't able to make it work.

  // Maybe the DC isn't always 32-bit? I'm not trusting Windows being consistent or sensible.
  if (instance_->window_handle_ == NULL) {
    return 0;
  }
  auto dc = GetDC(instance_->window_handle_);
  if (dc == NULL) {
    Logger::Log(LogLevel::Error, "GetBitmapBitsHook: Couldn't access default DC");
    // BW actually doesn't check the return value D:
    return 0;
  }
  int bpp = GetDeviceCaps(dc, BITSPIXEL);
  ReleaseDC(instance_->window_handle_, dc);

  if (bpp % 8 != 0 || bpp > 32 || bpp == 0) {
    Logger::Logf(LogLevel::Error, "Nonsensical value for DC bit depth: %d", bpp);
    return 0;
  }

  // 0xff, 0xffff, etc
  int pixel_mask = (1LL << static_cast<uint64>(bpp)) - 1;
  int bytes_per_pixel = bpp / 8;

  auto buffer = unique_ptr<uint8[]>(new uint8[cbBuffer * bytes_per_pixel]);
  int bytes_read = GetBitmapBits(hbmp, cbBuffer * bytes_per_pixel, buffer.get());
  auto bw_buffer = reinterpret_cast<uint8*>(lpvBits);
  for (int pos = 0; pos < bytes_read; pos += bytes_per_pixel) {
    uint32 val = *reinterpret_cast<uint32_t*>(buffer.get() + pos) & pixel_mask;
    *bw_buffer = val == 0 ? 0x00 : 0xff;
    bw_buffer += 1;
  }
  return bytes_read / bytes_per_pixel;
}

const int MOUSE_SETTING_MAX = 10;
void Forge::CalculateMouseResolution(uint32 width, uint32 height) {
  const Settings& settings = GetSettings();
  double delta;

  double original_ratio = 640.0 / 480.0;
  double actual_ratio = static_cast<double>(width) / height;

  if ((actual_ratio - original_ratio) >= 0.001) {
    // Means the screen has a wider aspect ration than 4:3 (typical)
    delta = (height - 480.0) / MOUSE_SETTING_MAX;
    mouse_resolution_height_ = static_cast<int>(
        (height - (delta * settings.mouse_sensitivity)) + 0.5);
    mouse_resolution_width_ = static_cast<int>((mouse_resolution_height_ * 4.0 / 3) + 0.5);
  } else {
    // Means the screen has a narrower aspect ratio than 4:3 (usually means 1280x1024)
    delta = (width - 640.0) / MOUSE_SETTING_MAX;
    mouse_resolution_width_ = static_cast<int>(
        (width - (delta * settings.mouse_sensitivity)) + 0.5);
    mouse_resolution_height_ = static_cast<int>((mouse_resolution_width_ * 3.0 / 4) + 0.5);
  }

  Logger::Logf(LogLevel::Verbose, "Mouse Resolution: %dx%d",
      mouse_resolution_width_, mouse_resolution_height_);
}

void Forge::HandleAltRelease() {
  if (IsCursorInWindow()) {
    PerformScaledClipCursor(stored_cursor_rect_.get());
  }
}

void Forge::ClientRectToScreenRect(LPRECT client_rect) {
  POINT top_left;
  top_left.x = client_rect->left;
  top_left.y = client_rect->top;
  ClientToScreen(window_handle_, &top_left);
  POINT bottom_right;
  bottom_right.x = client_rect->right;
  bottom_right.y = client_rect->bottom;
  ClientToScreen(window_handle_, &bottom_right);
  client_rect->left = top_left.x;
  client_rect->top = top_left.y;
  client_rect->right = bottom_right.x;
  client_rect->bottom = bottom_right.y;
}

bool Forge::IsCursorInWindow() {
  RECT client_rect;
  GetClientRect(window_handle_, &client_rect);
  ClientRectToScreenRect(&client_rect);
  POINT cursor_position;
  GetCursorPos(&cursor_position);

  return window_active_ && PtInRect(&client_rect, cursor_position) != FALSE;
}

}  // namespace forge
}  // namespace sbat
