#include "forge/renderer_utils.h"

#include "logger/logger.h"

namespace sbat {
namespace forge {

RenderSkipper::RenderSkipper(HWND window)
  : window_(window),
    min_millis_per_frame_(),
    counter_frequency_(),
    last_frame_time_() {
  QueryPerformanceFrequency(&counter_frequency_);
  counter_frequency_.QuadPart /= 1000LL;  // convert to ticks per millisecond

  DEVMODE devmode;
  EnumDisplaySettings(NULL, ENUM_CURRENT_SETTINGS, &devmode);
  if (devmode.dmDisplayFrequency <= 1) {
    // "Default" setting for the device. I don't know what that means, but the docs say this can
    // happen, so we'll assume 60hz since that's fairly common and non-problematic
    min_millis_per_frame_ = 16;
  } else {
    min_millis_per_frame_ = 1000 / devmode.dmDisplayFrequency;
  }
  Logger::Logf(LogLevel::Verbose, "RenderSkipper selected min delay per frame: %dms",
      min_millis_per_frame_);
}

bool RenderSkipper::ShouldSkipRender() {
  // BW has a nasty habit of trying to render ridiculously fast (like in the middle of a tight 7k
  // iteration loop during data intialization when there's nothing to actually render) and this
  // causes issues when the graphics card decides it doesn't want to queue commands any more. To
  // avoid these issues, we attempt to kill vsync, but also try to help BW out by not actually
  // making rendering calls this fast. The monitor's refresh rate seems reasonable (and by
  // reasonable, I mean unlikely to cause weird issues), even though BW will generally never update
  // any state that fast.
  LARGE_INTEGER frame_time;
  QueryPerformanceCounter(&frame_time);
  if (((frame_time.QuadPart - last_frame_time_.QuadPart) / counter_frequency_.QuadPart) <
      min_millis_per_frame_) {
    return true;
  }
  // Don't render while minimized (we tell BW its never minimized, so even though it has a check for
  // this, it will be rendering anyway)
  if (IsIconic(window_)) {
    return true;
  }

  return false;
}

void RenderSkipper::UpdateLastFrameTime() {
  QueryPerformanceCounter(&last_frame_time_);
}

RECT GetOutputSize(RendererDisplayMode mode, bool maintain_aspect_ratio, const RECT& client_rect,
    uint32 ddraw_width, uint32 ddraw_height) {
  RECT result = RECT();
  result.right = client_rect.right;
  result.bottom = client_rect.bottom;

  if (mode == RendererDisplayMode::FullScreen && maintain_aspect_ratio) {
    float original_ratio = static_cast<float>(ddraw_width) / ddraw_height;
    float actual_ratio = static_cast<float>(result.right) / result.bottom;
    if (original_ratio > actual_ratio) {
      float height_unrounded = result.right / original_ratio;
      while (height_unrounded - (static_cast<int>(height_unrounded)) > 0.0001f) {
        // we want to avoid having fractional parts to avoid weird alignments in linear filtering,
        // so we decrease the width until no fractions are necessary. Since BW is 4:3, this can be
        // done in 3 steps or less
        result.right--;
        height_unrounded = result.right / original_ratio;
      }
      result.bottom = static_cast<int>(height_unrounded);
    } else {
      float width_unrounded = result.bottom * original_ratio;
      while (width_unrounded - (static_cast<int>(width_unrounded)) > 0.0001f) {
        // same as above, we decrease the height to avoid rounding errors
        result.bottom--;
        width_unrounded = result.bottom * original_ratio;
      }
      result.right = static_cast<int>(width_unrounded);
    }

    // Center the frame in the screen
    if (result.right < client_rect.right) {
      result.left =
        static_cast<int>(((client_rect.right - result.right) / 2.) + 0.5);
      result.right += result.left;
    }
    if (result.bottom < client_rect.bottom) {
      result.top =
        static_cast<int>(((client_rect.bottom - result.bottom) / 2.) + 0.5);
      result.bottom += result.top;
    }
  }


  return result;
}

}  // namespace forge
}  // namespace sbat