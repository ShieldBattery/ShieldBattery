#ifndef SHIELDBATTERY_SETTINGS_H_
#define SHIELDBATTERY_SETTINGS_H_

#include <node.h>

namespace sbat {

struct Settings {
  int bw_port;
  int width;
  int height;
};

NODE_EXTERN void SetSettings(const Settings& settings);
NODE_EXTERN const Settings& GetSettings();

}  // namespace sbat

#endif  // SHIELDBATTERY_SETTINGS_H_
