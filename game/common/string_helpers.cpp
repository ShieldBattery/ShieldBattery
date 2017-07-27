#include "common/string_helpers.h"

using std::string;

namespace sbat {
  bool EndsWith(const string checked, const string suffix) {
    if (suffix.length() > checked.length()) {
      return false;
    }

    int index = checked.rfind(suffix);
    return index != string::npos && (index + suffix.length() == checked.length());
  }

}  // namespace sbat