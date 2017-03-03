#pragma once

#include <node.h>
#include <Windows.h>
#include <dwrite_2.h>
#include <memory>

#include "forge/com_utils.h"

namespace sbat {
namespace forge {

class DirectWriteManager {
public:
  static std::unique_ptr<DirectWriteManager> Create();

private:
  explicit DirectWriteManager(IDWriteFactory* factory);

  SafeComPtr<IDWriteFactory> factory_;
};

}  // namespace forge
}  // namespace sbat