#include "psi-emitter/psi-emitter.h"

#include <Windows.h>

#include "common/types.h"
#include "common/win_helpers.h"

using sbat::psiemitter::OpenSlot;
using sbat::psiemitter::WriteResolution;

int WINAPI WinMain(HINSTANCE instance, HINSTANCE prev_instance, LPSTR cmd_line, int cmd_show) {
  int argc;
  wchar_t** argv;
  argv = CommandLineToArgvW(GetCommandLineW(), &argc);

  if (argc < 2) {
    return 1;
  }

  wchar_t* slot_name = argv[1];
  HANDLE slot_handle = OpenSlot(slot_name);

  if (slot_handle == INVALID_HANDLE_VALUE) {
    return 2;
  }

  bool result = WriteResolution(slot_handle,
      GetSystemMetrics(SM_CXSCREEN), GetSystemMetrics(SM_CYSCREEN));
  CloseHandle(slot_handle);

  if (!result) {
    return 3;
  }

  return 0;
}

namespace sbat {
namespace psiemitter {

HANDLE OpenSlot(wchar_t* slot_name) {
  return CreateFileW(slot_name, GENERIC_WRITE, FILE_SHARE_READ, NULL, OPEN_EXISTING,
      FILE_ATTRIBUTE_NORMAL, NULL);
}

bool WriteResolution(HANDLE slot_handle, uint32 width, uint32 height) {
  ResolutionMessage message;
  message.width = width;
  message.height = height;

  DWORD bytes_written;
  bool result = WriteFile(slot_handle, &message, sizeof(message), &bytes_written, nullptr) != FALSE;

  return result && (bytes_written == sizeof(message));
}

}  // namespace psiemitter
}  // namespace sbat