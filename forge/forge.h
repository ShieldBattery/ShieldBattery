#ifndef FORGE_FORGE_H_
#define FORGE_FORGE_H_

#include <node.h>
#include <v8.h>
#include <dsound.h>
#include <string>

#include "common/func_hook.h"
#include "forge/indirect_draw.h"
#include "forge/direct_x.h"
#include "forge/open_gl.h"
#include "forge/renderer.h"

namespace sbat {
namespace forge {

// Annoyingly, Windows makes assumptions that if you SwapBuffer, have no borders, and are the same
// size as the monitor you're on, you want exclusive fullscreen. There doesn't seem to be a way to
// turn this off, so we trick Windows by having a border (even for borderless windows!) and stopping
// it from drawing with SetWindowRgn. Bill Gates whyyyyyyy?
const DWORD BORDERLESS_WINDOW = WS_CAPTION | WS_VISIBLE;
const DWORD WINDOW = WS_POPUP | WS_VISIBLE | WS_CAPTION | WS_SYSMENU;

#define HOOKABLE(RetType, Name, ...) typedef RetType (__stdcall *##Name##Func)(__VA_ARGS__); \
      ImportHook<##Name##Func>* Name;
struct ImportHooks {
  HOOKABLE(HWND, CreateWindowExA, DWORD dwExStyle, LPCSTR lpClassName, LPCSTR lpWindowName,
      DWORD dwStyle, int x, int y, int nWidth, int nHeight, HWND hWndParent, HMENU hMenu,
      HINSTANCE hInstance, LPVOID lpParam);
  HOOKABLE(ATOM, RegisterClassExA, const WNDCLASSEX* lpwcx);
  HOOKABLE(int, GetSystemMetrics, int nIndex);
  HOOKABLE(FARPROC, GetProcAddress, HMODULE hModule, LPCSTR lpProcName);
  HOOKABLE(BOOL, IsIconic, HWND hWnd);
  HOOKABLE(BOOL, ClientToScreen, HWND hWnd, LPPOINT lpPoint);
  HOOKABLE(BOOL, ScreenToClient, HWND hWnd, LPPOINT lpPoint);
  HOOKABLE(BOOL, GetClientRect, HWND hWnd, LPRECT lpRect);
  HOOKABLE(BOOL, GetCursorPos, LPPOINT lpPoint);
  HOOKABLE(BOOL, SetCursorPos, int x, int y);
  HOOKABLE(BOOL, ClipCursor, const LPRECT lpRect);
  HOOKABLE(HWND, SetCapture, HWND hWnd);
  HOOKABLE(BOOL, ReleaseCapture)
};
#undef HOOKABLE

typedef HRESULT (__stdcall *CreateSoundBufferFunc)(IDirectSound8* this_ptr,
    const DSBUFFERDESC* buffer_desc, IDirectSoundBuffer** buffer_out, IUnknown* unused);

class Forge : public node::ObjectWrap {
public:
  static void Init();
  static v8::Handle<v8::Value> NewInstance();
  static std::unique_ptr<Renderer> CreateRenderer(
      HWND window, uint32 ddraw_width, uint32 ddraw_height);

private:
  Forge();
  ~Forge();
  // Disable copying
  Forge(const Forge&);
  Forge& operator=(const Forge&);
  void CalculateMouseResolution(uint32 width, uint32 height);

  static LRESULT WINAPI WndProc(HWND window_handle, UINT msg, WPARAM wparam, LPARAM lparam);
  static inline int GetX(LPARAM lparam) {
    return static_cast<int32>(static_cast<int16>(LOWORD(lparam)));
  }
  static inline int GetY(LPARAM lparam) {
    return static_cast<int32>(static_cast<int16>(HIWORD(lparam)));
  }
  static inline LPARAM MakePositionParam(int x, int y) {
    return static_cast<LPARAM>(static_cast<int32>(static_cast<int16>(x)) | (y << 16));
  }

  // hooks
  static HWND __stdcall CreateWindowExAHook(DWORD dwExStyle, LPCSTR lpClassName,
      LPCSTR lpWindowName, DWORD dwStyle, int x, int y, int nWidth, int nHeight, HWND hWndParent,
      HMENU hMenu, HINSTANCE hInstance, LPVOID lpParam);
  static ATOM __stdcall RegisterClassExAHook(const WNDCLASSEX* lpwcx);
  static int __stdcall GetSystemMetricsHook(int nIndex);
  static FARPROC __stdcall GetProcAddressHook(HMODULE hModule, LPCSTR lpProcName);
  static BOOL __stdcall IsIconicHook(HWND hWnd);
  static BOOL __stdcall ClientToScreenHook(HWND hWnd, LPPOINT lpPoint);
  static BOOL __stdcall ScreenToClientHook(HWND hWnd, LPPOINT lpPoint);
  static BOOL __stdcall GetClientRectHook(HWND hWnd, LPRECT lpRect);
  static BOOL __stdcall GetCursorPosHook(LPPOINT lpPoint);
  static BOOL __stdcall SetCursorPosHook(int x, int y);
  static BOOL __stdcall ClipCursorHook(const LPRECT lpRect);
  static HRESULT __stdcall DirectSoundCreate8Hook(
      const GUID* device, IDirectSound8** direct_sound_out, IUnknown* unused);
  static HRESULT __stdcall CreateSoundBufferHook(IDirectSound8* this_ptr,
      const DSBUFFERDESC* buffer_desc, IDirectSoundBuffer** buffer_out, IUnknown* unused);
  static HWND __stdcall SetCaptureHook(HWND hWnd);
  static BOOL __stdcall ReleaseCaptureHook();

  // callable from JS
  static v8::Handle<v8::Value> New(const v8::Arguments& args);
  static v8::Handle<v8::Value> Inject(const v8::Arguments& args);
  static v8::Handle<v8::Value> Restore(const v8::Arguments& args);
  static v8::Handle<v8::Value> RunWndProc(const v8::Arguments& args);
  static v8::Handle<v8::Value> EndWndProc(const v8::Arguments& args);
  static v8::Handle<v8::Value> SetShaders(const v8::Arguments& args);

  static v8::Persistent<v8::Function> constructor;
  static Forge* instance_;

  ImportHooks hooks_;
  FuncHook<CreateSoundBufferFunc>* create_sound_buffer_hook_;
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
  HWND captured_window_;
};

}  // namespace forge
}  // namespace sbat

#endif  // FORGE_FORGE_H_
