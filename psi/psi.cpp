#include "psi/psi.h"

#include <node.h>
#include <Windows.h>
#include <string>

#include "common/win_helpers.h"

int wmain(int argc, wchar_t *argv[]) {
  if (AllocConsole()) {
    // correct stdout/stderr/stdin to point to new console
    FILE* fp;
    freopen_s(&fp, "CONOUT$", "w", stdout);
    freopen_s(&fp, "CONOUT$", "w", stderr);
    freopen_s(&fp, "CONIN$", "r", stdin);
  }

  HMODULE module_handle;
  char path[MAX_PATH];
  GetModuleHandleExA(
      GET_MODULE_HANDLE_EX_FLAG_FROM_ADDRESS | GET_MODULE_HANDLE_EX_FLAG_UNCHANGED_REFCOUNT,
      reinterpret_cast<LPCSTR>(&wmain), &module_handle);
  GetModuleFileNameA(module_handle, path, sizeof(path));

  char** node_argv = new char*[1];
  node_argv[0] = path;
  node::Start(1, node_argv);
}