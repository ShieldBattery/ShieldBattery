#ifndef FORGE_FORGE_H_
#define FORGE_FORGE_H_

#include <node.h>
#include <v8.h>
#include <dsound.h>

#include "common/func_hook.h"
#include "forge/direct_glaw.h"
#include "forge/open_gl.h"

namespace sbat {
namespace forge {

const DWORD BORDERLESS_WINDOW = WS_POPUP | WS_VISIBLE;
const DWORD WINDOW = WS_POPUP | WS_VISIBLE | WS_CAPTION | WS_SYSMENU;

enum class DisplayMode {
  FullScreen = 0,
  BorderlessWindow,
  Window
};

#define HOOKABLE(RetType, Name, ...) typedef RetType (__stdcall *##Name##Func)(__VA_ARGS__); \
      ImportHook<##Name##Func>* Name;
struct ImportHooks {
  HOOKABLE(HWND, CreateWindowExA, DWORD dwExStyle, LPCSTR lpClassName, LPCSTR lpWindowName,
      DWORD dwStyle, int x, int y, int nWidth, int nHeight, HWND hWndParent, HMENU hMenu,
      HINSTANCE hInstance, LPVOID lpParam);
  HOOKABLE(int, GetSystemMetrics, int nIndex);
  HOOKABLE(FARPROC, GetProcAddress, HMODULE hModule, LPCSTR lpProcName);
  HOOKABLE(BOOL, IsIconic, HWND hWnd);
  HOOKABLE(BOOL, ClientToScreen, HWND hWnd, LPPOINT lpPoint);
  HOOKABLE(BOOL, ScreenToClient, HWND hWnd, LPPOINT lpPoint);
  HOOKABLE(BOOL, GetClientRect, HWND hWnd, LPRECT lpRect);
  HOOKABLE(BOOL, GetCursorPos, LPPOINT lpPoint);
  HOOKABLE(BOOL, SetCursorPos, int x, int y);
  HOOKABLE(BOOL, ClipCursor, const LPRECT lpRect);
};
#undef HOOKABLE

typedef HRESULT (__stdcall *CreateSoundBufferFunc)(IDirectSound8* this_ptr, 
    const DSBUFFERDESC* buffer_desc, IDirectSoundBuffer** buffer_out, IUnknown* unused);

class Forge : public node::ObjectWrap {
public:
  static void Init();
  static v8::Handle<v8::Value> NewInstance();
  static void RegisterDirectGlaw(OpenGl* open_gl, DirectGlaw* direct_glaw);

private:
  Forge();
  ~Forge();
  // Disable copying
  Forge(const Forge&);
  Forge& operator=(const Forge&);

  static LRESULT WINAPI WndProc(HWND window_handle, UINT msg, WPARAM wparam, LPARAM lparam);
  static inline int GetX(LPARAM lparam) {
    return (int) (short) LOWORD(lparam);
  }
  static inline int GetY(LPARAM lparam) {
    return (int) (short) HIWORD(lparam);
  }
  static inline LPARAM MakePositionParam(int x, int y) {
    return (LPARAM) (((int) ((short) x)) | ((y) << 16));
  }

  // hooks
  static HWND __stdcall CreateWindowExAHook(DWORD dwExStyle, LPCSTR lpClassName,
      LPCSTR lpWindowName, DWORD dwStyle, int x, int y, int nWidth, int nHeight, HWND hWndParent,
      HMENU hMenu, HINSTANCE hInstance, LPVOID lpParam);
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
  DirectGlaw* direct_glaw_;
  std::string* vertex_shader_src_;
  std::string* fragment_shader_src_;
  std::string* fbo_vertex_shader_src_;
  std::string* fbo_fragment_shader_src_;

  int client_x_;
  int client_y_;
  int cursor_x_;
  int cursor_y_;
  int width_;
  int height_;
  int display_mode_;
};

}  // namespace forge
}  // namespace sbat

#endif  // FORGE_FORGE_H_
