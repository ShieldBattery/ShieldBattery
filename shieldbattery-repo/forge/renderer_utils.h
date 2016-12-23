#pragma once

#include <node.h>
#include <Windows.h>

#include "renderer.h"
#include "common/macros.h"
#include "common/types.h"

namespace sbat {
namespace forge {

class RenderSkipper {
public:
  explicit RenderSkipper(HWND window);
  bool ShouldSkipRender();
  void UpdateLastFrameTime();

private:
  HWND window_;
  uint32 min_millis_per_frame_;
  LARGE_INTEGER counter_frequency_;
  LARGE_INTEGER last_frame_time_;

  DISALLOW_COPY_AND_ASSIGN(RenderSkipper);
};

RECT GetOutputSize(RendererDisplayMode mode, bool maintain_aspect_ratio, const RECT& client_rect,
    uint32 ddraw_width, uint32 ddraw_height);

}  // namespace forge
}  // namespace sbat
