#pragma once

#include "common/types.h"

namespace sbat {
namespace bw {

struct Control;
struct Dialog;
struct UiEvent;
struct PreplacedUnit;
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
  static void __stdcall
    PlaySoundAtPosHook(int sound, uint32 xy, int actually_play_something, int min_volume);
  static void __stdcall ProcessCommandsHook(void *data, int len, int replay);
  static int __stdcall Command_SyncHook(void *data);
  static int __stdcall ChatMessageHook(int net_player, const char *message, int length);
  static void __stdcall LoadDialogHook(Dialog *dialog, void *base, void *event_handler,
      const char* source_file, int source_line);
  static void __stdcall InitUiVariablesHook();
  static void __stdcall DrawStatusScreenHook();
  static void __stdcall UpdateCommandCardHook();
  static int __stdcall CmdBtn_EventHandlerHook(Control* control, UiEvent* event);
  static void __stdcall DrawCommandButtonHook(Control* control, int x, int y, void *area);
  static void __stdcall DrawResourceCountsHook(Control *control, void *param);
  static const char* __stdcall GetGluAllStringHook(int string_id);
  static void __stdcall UpdateNetTimeoutPlayersHook();
  static int __stdcall CenterScreenOnOwnStartLocationHook(PreplacedUnit* unit, void* b);

  static bool IsObserver(BroodWar *bw);

  template <typename Hook, typename... Args>
  static void CallWithReplayFlagIfObserver(BroodWar *bw, Hook &hook, Args... args);
};

}  // namespace bw
}  // namespace sbat
