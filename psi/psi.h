#ifndef PSI_PSI_H_
#define PSI_PSI_H_

#include <node.h>
#include <Windows.h>
#include <string>

#include "common/win_helpers.h"

namespace sbat {
namespace psi {

class NODE_EXTERN Process {
public:
  Process(const std::wstring& app_path, const std::wstring& arguments, bool launch_suspended,
    const std::wstring& current_dir);
  ~Process();
  bool has_errors() const;
  WindowsError error() const;

  WindowsError InjectDll(const std::wstring& dll_path, const std::string& inject_function_name);
  WindowsError Resume();
private:
  bool EnableSeDebug();

  static bool se_debug_enabled_;
  PROCESS_INFORMATION process_info_;
  WindowsError* error_;
};

}  // namespace psi
}  // namespace sbat

#endif  // PSI_PSI_H_