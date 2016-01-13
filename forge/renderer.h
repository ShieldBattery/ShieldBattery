#pragma once

#include <vector>

#include "../common/types.h"

namespace sbat {
namespace forge {

class IndirectDrawPalette;

enum class RendererDisplayMode {
  FullScreen = 0,
  BorderlessWindow,
  Window
};

class Renderer {
public:
  virtual ~Renderer() {}
  virtual void Render(const std::vector<byte>& surface_data) = 0;
  virtual void UpdatePalette(const IndirectDrawPalette& palette) = 0;
};

}  // namespace forge
}  // namespace sbat
