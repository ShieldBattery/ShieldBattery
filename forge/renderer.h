#ifndef FORGE_RENDERER_H_
#define FORGE_RENDERER_H_

#include <vector>

namespace sbat {
namespace forge {

class IndirectDrawPalette;

class Renderer {
public:
  virtual ~Renderer() {}
  virtual void Render(const IndirectDrawPalette& indirect_draw_palette,
      const std::vector<byte>& surface_data) = 0;
};

}  // namespace forge
}  // namespace sbat

#endif  // FORGE_RENDERER_H_
