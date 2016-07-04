#include "psi-emitter/psi-emitter.h"

#include <Windows.h>
#include <string>
#include <vector>

#include "common/types.h"
#include "common/win_helpers.h"

using sbat::psiemitter::DetectResolution;
using sbat::psiemitter::CheckStarcraftPath;
using std::vector;
using std::wstring;

const wstring CMD_DETECT_RESOLUTION = L"detectResolution";
const wstring CMD_CHECK_STARCRAFT_PATH = L"checkPath";

int WINAPI WinMain(HINSTANCE instance, HINSTANCE prev_instance, LPSTR cmd_line, int cmd_show) {
  int argc;
  wchar_t** argv;
  argv = CommandLineToArgvW(GetCommandLineW(), &argc);

  if (argc < 3) {
    LocalFree(argv);
    return ERROR_BAD_ARGUMENTS;
  }

  wchar_t* command = argv[1];
  int result = 0;
  if (CMD_DETECT_RESOLUTION.compare(command) == 0) {
    result = DetectResolution(&argv[2], argc - 2);
  } else if (CMD_CHECK_STARCRAFT_PATH.compare(command) == 0) {
    result = CheckStarcraftPath(&argv[2], argc - 2);
  } else {
    result = ERROR_INVALID_PARAMETER;
  }
  
  LocalFree(argv);
  return result;
  
}

namespace sbat {
namespace psiemitter {

int DetectResolution(wchar_t** argv, int argc) {
  if (argc < 1) {
    return ERROR_BAD_ARGUMENTS;
  }

  wchar_t* slot_name = argv[0];
  HANDLE slot_handle = OpenSlot(slot_name);

  if (slot_handle == INVALID_HANDLE_VALUE) {
    return ERROR_INVALID_HANDLE;
  }

  bool result = WriteResolution(slot_handle,
    GetSystemMetrics(SM_CXSCREEN), GetSystemMetrics(SM_CYSCREEN));
  CloseHandle(slot_handle);

  if (!result) {
    return ERROR_WRITE_FAULT;
  }

  return 0;
}

// This matches what Windows Explorer's properties view shows as "File version", for whatever reason
const int DESIRED_VERSION_MAJOR_HI = 1;
const int DESIRED_VERSION_MAJOR_LO = 16;
const int DESIRED_VERSION_MINOR_HI = 1;
const int DESIRED_VERSION_MINOR_LO = 1;

int CheckStarcraftPath(wchar_t** argv, int argc) {
  if (argc < 1) {
    return ERROR_BAD_ARGUMENTS;
  }

  wchar_t* exe_path = argv[0];
  int attributes = GetFileAttributesW(exe_path);
  if (attributes == INVALID_FILE_ATTRIBUTES) {
    return GetLastError();
  }
  if ((attributes & (FILE_ATTRIBUTE_DIRECTORY | FILE_ATTRIBUTE_OFFLINE)) != 0) {
    return ERROR_INVALID_DATA;
  }

  int32 info_size = GetFileVersionInfoSizeW(exe_path, nullptr);
  if (info_size == 0) {
    return GetLastError();
  }
  vector<byte> info_data(info_size);
  int result = GetFileVersionInfoW(exe_path, 0, info_data.size(), &info_data[0]);
  if (result == 0) {
    return GetLastError();
  }

  uint32 length;
  VS_FIXEDFILEINFO* file_info;
  result = VerQueryValueW(&info_data[0], L"\\", reinterpret_cast<void**>(&file_info), &length);
  if (result == 0 || length == 0) {
    return ERROR_VERSION_PARSE_ERROR;
  }

  if (HIWORD(file_info->dwProductVersionMS) != DESIRED_VERSION_MAJOR_HI ||
      LOWORD(file_info->dwProductVersionMS) != DESIRED_VERSION_MAJOR_LO ||
      HIWORD(file_info->dwProductVersionLS) != DESIRED_VERSION_MINOR_HI ||
      LOWORD(file_info->dwProductVersionLS) != DESIRED_VERSION_MINOR_LO) {
    return ERROR_PRODUCT_VERSION;
  }

  return 0;
}

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