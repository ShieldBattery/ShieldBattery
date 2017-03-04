#pragma once

#include <node.h>
#include <Windows.h>
#include <dwrite_2.h>
#include <memory>
#include <vector>

#include "forge/com_utils.h"

namespace sbat {
namespace forge {

class DirectWriteManager {
public:
  static std::unique_ptr<DirectWriteManager> Create();

  std::vector<uint32_t> textureData;
  uint32_t textureWidth;
  uint32_t textureHeight;

private:
  explicit DirectWriteManager(IDWriteFactory* factory);

  SafeComPtr<IDWriteFactory> factory_;
};

}  // namespace forge
}  // namespace sbat