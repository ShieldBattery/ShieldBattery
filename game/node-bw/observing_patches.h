#pragma once

namespace sbat {
namespace bw {

struct Control;
class BroodWar;

// These are just grouped into a struct so they can be befriended by BroodWar
struct ObservingPatches {
  static void __stdcall MinimapCtrl_InitButtonHook(Control *ctrl);
  static void __stdcall MinimapCtrl_ShowAllianceDialogHook();
  static void __stdcall DrawMinimapHook();
  static void __stdcall Minimap_TimerRefreshHook();
  static void __stdcall AllianceDialog_EventHook(Control *ctrl, void *event);
  static void __stdcall RedrawScreenHook();
  static void __stdcall GameScreenLeftClickHook(void *event);
  static int __stdcall Command_SyncHook(void *data);

  static bool IsObserver(BroodWar *bw);

  template <typename Hook, typename... Args>
  static void CallWithReplayFlagIfObserver(BroodWar *bw, Hook &hook, Args... args);
};

}  // namespace bw
}  // namespace sbat
