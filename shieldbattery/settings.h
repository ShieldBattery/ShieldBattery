#ifndef SHIELDBATTERY_SETTINGS_H_
#define SHIELDBATTERY_SETTINGS_H_

#include <node.h>

namespace sbat {

enum class DisplayMode {
  FullScreen = 0,
  BorderlessWindow,
  Window
};

enum class RenderMode {
  DirectX = 0,
  OpenGl
};

struct Settings {
  int bw_port;
  int width;
  int height;
  DisplayMode display_mode;
  int mouse_sensitivity;
  bool maintain_aspect_ratio;
  RenderMode renderer;
};

NODE_EXTERN void SetSettings(const Settings& settings);
NODE_EXTERN const Settings& GetSettings();

}  // namespace sbat

#endif  // SHIELDBATTERY_SETTINGS_H_
