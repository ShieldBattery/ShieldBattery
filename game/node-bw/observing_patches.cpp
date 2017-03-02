#include "observing_patches.h"

#include "brood_war.h"

namespace sbat {
namespace bw {

bool ObservingPatches::IsObserver(BroodWar *bw) {
  return *bw->offsets_->local_nation_id == -1;
}

// Setting is_replay for the duration of certain calls is really nice way of making
// observing work automagically.
template <typename Hook, typename... Args>
void ObservingPatches::CallWithReplayFlagIfObserver(BroodWar *bw, Hook &hook, Args... args) {
  auto was_replay = *bw->offsets_->is_replay;
  if (IsObserver(bw)) {
    *bw->offsets_->is_replay = true;
  }
  hook.callable()(args...);
  *bw->offsets_->is_replay = was_replay;
}

void __stdcall ObservingPatches::MinimapCtrl_InitButtonHook(Control *ctrl) {
  auto bw = BroodWar::Get();
  auto &hook = bw->offsets_->func_hooks.MinimapCtrl_InitButton;
  CallWithReplayFlagIfObserver(bw, hook, ctrl);
}

void __stdcall ObservingPatches::MinimapCtrl_ShowAllianceDialogHook() {
  auto bw = BroodWar::Get();
  auto &hook = bw->offsets_->func_hooks.MinimapCtrl_ShowAllianceDialog;
  CallWithReplayFlagIfObserver(bw, hook);
}

void __stdcall ObservingPatches::DrawMinimapHook() {
  auto bw = BroodWar::Get();
  auto &hook = bw->offsets_->func_hooks.DrawMinimap;
  CallWithReplayFlagIfObserver(bw, hook);
}

// Bw force refreshes the minimap every second?? why
// And of course the DrawMinimap call in it is inlined so it has to be hooked separately.
void __stdcall ObservingPatches::Minimap_TimerRefreshHook() {
  auto bw = BroodWar::Get();
  auto &hook = bw->offsets_->func_hooks.Minimap_TimerRefresh;
  CallWithReplayFlagIfObserver(bw, hook);
}

void __stdcall ObservingPatches::AllianceDialog_EventHook(Control *ctrl, void *event) {
  auto bw = BroodWar::Get();
  auto &hook = bw->offsets_->func_hooks.AllianceDialog_EventHandler;
  CallWithReplayFlagIfObserver(bw, hook, ctrl, event);
}

void __stdcall ObservingPatches::RedrawScreenHook() {
  auto bw = BroodWar::Get();
  auto &hook = bw->offsets_->func_hooks.RedrawScreen;
  CallWithReplayFlagIfObserver(bw, hook);
}

void __stdcall ObservingPatches::GameScreenLeftClickHook(void *event) {
  auto bw = BroodWar::Get();
  auto &hook = bw->offsets_->func_hooks.GameScreenLeftClick;
  CallWithReplayFlagIfObserver(bw, hook, event);
}

// Don't validate sync commands when observing or if they are sent by observers. As the sync
// contains visibility info, observers are out of sync from everyone else, as their vision
// settings are not sent to other players.
int __stdcall ObservingPatches::Command_SyncHook(void *data) {
  auto bw = BroodWar::Get();
  if (!IsObserver(bw) && *bw->offsets_->current_command_player < 8) {
    auto &hook = bw->offsets_->func_hooks.Command_Sync;
    return hook.callable()(data);
  } else {
    return 1;
  }
}

}  // namespace bw
}  // namespace sbat
