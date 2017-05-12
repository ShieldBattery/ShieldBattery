#pragma once

#include <node.h>
#include <nan.h>
#include <mmsystem.h>
#include <dsound.h>
#include <map>
#include <queue>
#include <string>

#include "common/func_hook.h"
#include "forge/indirect_draw.h"
#include "forge/renderer.h"
#include "v8-helpers/helpers.h"

namespace sbat {
namespace forge {

// Annoyingly, Windows makes assumptions that if you SwapBuffer, have no borders, and are the same
// size as the monitor you're on, you want exclusive fullscreen. There doesn't seem to be a way to
// turn this off, so we trick Windows by having a border (even for borderless windows!) and stopping
// it from drawing with SetWindowRgn. Bill Gates whyyyyyyy?
const DWORD BORDERLESS_WINDOW_SWAP = WS_CAPTION | WS_VISIBLE;
const DWORD BORDERLESS_WINDOW_NOSWAP = WS_POPUP | WS_VISIBLE;
const DWORD WINDOW = WS_POPUP | WS_VISIBLE | WS_CAPTION | WS_SYSMENU;

typedef HRESULT (__stdcall *CreateSoundBufferFunc)(IDirectSound8* this_ptr,
    const DSBUFFERDESC* buffer_desc, IDirectSoundBuffer** buffer_out, IUnknown* unused);
typedef void(__stdcall *RenderScreenFunc)();

class Forge : public Nan::ObjectWrap {
public:
  static void Init();
  static v8::Local<v8::Value> NewInstance();
  static std::unique_ptr<Renderer> CreateRenderer(
      HWND window, uint32 ddraw_width, uint32 ddraw_height);

  static void RegisterIndirectDraw(IndirectDraw* indirect_draw);

  // Should only be called from the JS thread
  void PublishQueuedEvents();
  // Can be called from any thread
  void SendJsEvent(const std::wstring& type, const std::shared_ptr<ScopelessValue>& value);

private:
  Forge();
  ~Forge();

  // Disable copying
  Forge(const Forge&) = delete;
  Forge& operator=(const Forge&) = delete;

  BOOL PerformScaledClipCursor(const RECT* lpRect);
  void HandleAltRelease();
  bool IsCursorInWindow();
  void ClientRectToScreenRect(const LPRECT client_rect);
  void CalculateMouseResolution(uint32 width, uint32 height);

  static LRESULT WINAPI WndProc(HWND window_handle, UINT msg, WPARAM wparam, LPARAM lparam);
  void ReleaseHeldKey(HWND window_handle, int key);
  static inline int GetX(LPARAM lparam) {
    return static_cast<int32>(static_cast<int16>(LOWORD(lparam)));
  }
  static inline int GetY(LPARAM lparam) {
    return static_cast<int32>(static_cast<int16>(HIWORD(lparam)));
  }
  static inline LPARAM MakePositionParam(int x, int y) {
    return static_cast<LPARAM>(static_cast<int32>(static_cast<int16>(x)) | (y << 16));
  }
  int ScreenToGameX(int val) {
    return static_cast<int>((val * (640.0 / mouse_resolution_width_)) + 0.5);
  }
  int ScreenToGameY(int val) {
    return static_cast<int>((val * (480.0 / mouse_resolution_height_)) + 0.5);
  }



  // hooks
  static HWND __stdcall CreateWindowExAHook(DWORD dwExStyle, LPCSTR lpClassName,
      LPCSTR lpWindowName, DWORD dwStyle, int x, int y, int nWidth, int nHeight, HWND hWndParent,
      HMENU hMenu, HINSTANCE hInstance, LPVOID lpParam);
  static ATOM __stdcall RegisterClassExAHook(const WNDCLASSEX* lpwcx);
  static int __stdcall GetSystemMetricsHook(int nIndex);
  static FARPROC __stdcall GetProcAddressHook(HMODULE hModule, LPCSTR lpProcName);
  static BOOL __stdcall IsIconicHook(HWND hWnd);
  static BOOL __stdcall IsWindowVisibleHook(HWND hWnd);
  static BOOL __stdcall ClientToScreenHook(HWND hWnd, LPPOINT lpPoint);
  static BOOL __stdcall ScreenToClientHook(HWND hWnd, LPPOINT lpPoint);
  static BOOL __stdcall GetClientRectHook(HWND hWnd, LPRECT lpRect);
  static BOOL __stdcall GetCursorPosHook(LPPOINT lpPoint);
  static BOOL __stdcall SetCursorPosHook(int x, int y);
  static BOOL __stdcall ClipCursorHook(const RECT* lpRect);
  static HRESULT __stdcall DirectSoundCreate8Hook(
      const GUID* device, IDirectSound8** direct_sound_out, IUnknown* unused);
  static HRESULT __stdcall CreateSoundBufferHook(IDirectSound8* this_ptr,
      const DSBUFFERDESC* buffer_desc, IDirectSoundBuffer** buffer_out, IUnknown* unused);
  static HWND __stdcall SetCaptureHook(HWND hWnd);
  static BOOL __stdcall ReleaseCaptureHook();
  static BOOL __stdcall ShowWindowHook(HWND hwnd, int nCmdShow);
  static SHORT __stdcall GetKeyStateHook(int nVirtKey);
  static LONG __stdcall GetBitmapBitsHook(HBITMAP hbmp, LONG cbBuffer, LPVOID lpvBits);
  static HBITMAP __stdcall CreateCompatibleBitmapHook(HDC dc, int width, int height);
  static BOOL __stdcall DeleteObjectHook(HGDIOBJ object);
  static int __stdcall GetObjectHook(HGDIOBJ object, int cbBuffer, LPVOID lpvObject);
  static void __stdcall RenderScreenHook();

  // callable from JS
  static void New(const Nan::FunctionCallbackInfo<v8::Value>& info);
  static void Inject(const Nan::FunctionCallbackInfo<v8::Value>& info);
  static void Restore(const Nan::FunctionCallbackInfo<v8::Value>& info);
  static void RunWndProc(const Nan::FunctionCallbackInfo<v8::Value>& info);
  static void EndWndProc(const Nan::FunctionCallbackInfo<v8::Value>& info);
  static void SetShaders(const Nan::FunctionCallbackInfo<v8::Value>& info);

  static Nan::Persistent<v8::Function> constructor;
  static Forge* instance_;

  HookedModule process_hooks_;
  HookedModule storm_hooks_;
  FuncHook<CreateSoundBufferFunc>* create_sound_buffer_hook_;
  std::unique_ptr<FuncHook<RenderScreenFunc>> render_screen_hook_;
  HWND window_handle_;
  WNDPROC original_wndproc_;
  std::map<std::string, std::pair<std::string, std::string>> dx_shaders;
  std::map<std::string, std::pair<std::string, std::string>> gl_shaders;

  int client_x_;
  int client_y_;
  int cursor_x_;
  int cursor_y_;
  int width_;
  int height_;
  int display_mode_;
  int mouse_resolution_width_;
  int mouse_resolution_height_;
  bool is_started_;
  bool should_clip_cursor_;
  bool window_active_;
  bool bw_window_active_;
  HWND captured_window_;
  std::unique_ptr<RECT> stored_cursor_rect_;
  HBITMAP active_bitmap_;
  IndirectDraw* indirect_draw_;

  uv_mutex_t event_publish_mutex_;
  uv_async_t event_publish_async_;
  std::queue<std::shared_ptr<ScopelessValue>> event_publish_queue_;
};

}  // namespace forge
}  // namespace sbat
