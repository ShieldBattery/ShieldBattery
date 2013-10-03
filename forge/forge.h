#ifndef FORGE_FORGE_H_
#define FORGE_FORGE_H_

#include <node.h>
#include <v8.h>

#include "common/func_hook.h"

namespace sbat {
namespace forge {

#define HOOKABLE(RetType, Name, ...) typedef RetType (__stdcall *##Name##Func)(__VA_ARGS__); \
      ImportHook<##Name##Func>* Name;
struct ImportHooks {
  HOOKABLE(HWND, CreateWindowExA, DWORD dwExStyle, LPCSTR lpClassName, LPCSTR lpWindowName,
      DWORD dwStyle, int x, int y, int nWidth, int nHeight, HWND hWndParent, HMENU hMenu,
      HINSTANCE hInstance, LPVOID lpParam);
  HOOKABLE(int, GetSystemMetrics, int nIndex);
  HOOKABLE(FARPROC, GetProcAddress, HMODULE hModule, LPCSTR lpProcName);
};
#undef HOOKABLE

class Forge : public node::ObjectWrap {
public:
  static void Init();
  static v8::Handle<v8::Value> NewInstance();

private:
  Forge();
  ~Forge();
  // Disable copying
  Forge(const Forge&);
  Forge& operator=(const Forge&);

  static LRESULT WINAPI WndProc(HWND window_handle, UINT msg, WPARAM wparam, LPARAM lparam);

  // hooks
  static HWND __stdcall CreateWindowExAHook(DWORD dwExStyle, LPCSTR lpClassName,
      LPCSTR lpWindowName, DWORD dwStyle, int x, int y, int nWidth, int nHeight, HWND hWndParent,
      HMENU hMenu, HINSTANCE hInstance, LPVOID lpParam);
  static int __stdcall GetSystemMetricsHook(int nIndex);
  static FARPROC __stdcall GetProcAddressHook(HMODULE hModule, LPCSTR lpProcName);

  // callable from JS
  static v8::Handle<v8::Value> New(const v8::Arguments& args);
  static v8::Handle<v8::Value> Inject(const v8::Arguments& args);
  static v8::Handle<v8::Value> Restore(const v8::Arguments& args);
  static v8::Handle<v8::Value> RunWndProc(const v8::Arguments& args);
  static v8::Handle<v8::Value> EndWndProc(const v8::Arguments& args);

  static v8::Persistent<v8::Function> constructor;
  static Forge* instance_;

  ImportHooks hooks_;
  HWND window_handle_;
  WNDPROC original_wndproc_;
};

}  // namespace forge
}  // namespace sbat

#endif  // FORGE_FORGE_H_