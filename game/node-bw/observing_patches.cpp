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

void __stdcall ObservingPatches::PlaySoundAtPosHook(int sound, uint32 xy,
    int actually_play_something, int min_volume) {
  auto bw = BroodWar::Get();
  auto &hook = bw->offsets_->func_hooks.PlaySoundAtPos;
  CallWithReplayFlagIfObserver(bw, hook, sound, xy, actually_play_something, min_volume);
}

void __stdcall ObservingPatches::ProcessCommandsHook(void *data, int len, int replay) {
  auto bw = BroodWar::Get();
  auto &hook = bw->offsets_->func_hooks.ProcessCommands;
  if (!replay && *bw->offsets_->current_command_player >= 8) {
    // Replace anything sent by observers with a keep alive command, I'm quite sure there will
    // be buffer overflows otherwise.
    uint8 buf[] = { 0x05 };
    hook.callable()(buf, 1, replay);
  } else {
    hook.callable()(data, len, replay);
  }
}
// Don't validate sync commands when observing. As the sync contains visibility info, observers
// are out of sync from everyone else, as their vision settings are not sent to other players.
int __stdcall ObservingPatches::Command_SyncHook(void *data) {
  auto bw = BroodWar::Get();
  if (!IsObserver(bw)) {
    auto &hook = bw->offsets_->func_hooks.Command_Sync;
    return hook.callable()(data);
  } else {
    return 1;
  }
}

int __stdcall ObservingPatches::ChatMessageHook(int net_player, const char *message, int length) {
  auto bw = BroodWar::Get();
  if (bw->offsets_->storm_id_to_human_id[net_player] >= 8) {
    // Observer message, we'll have to manually print text and add to replay recording.

    // There's some unnecessary control information at the start of message
    if (length < 2 || message[length - 1] != 0) {
      return 0;
    }
    message += 2;
    char *name = bw->offsets_->storm_players[net_player].name;
    char buf[512];
    // 0x1f is the neutral cyan color and 0x02 is the regular chat message one.
    snprintf(buf, sizeof buf, "\x1f%s: \x02%s", name, message);

    uint8 replay_command[0x52] = { 0 };
    replay_command[0] = 0x5c; // Replay chat
    replay_command[1] = 0x8; // Player
    memcpy(replay_command + 2, buf, min(0x50, strlen(buf)));
    replay_command[0x51] = 0;
    bw->AddToReplayData(net_player, replay_command, sizeof replay_command);

    if (net_player == *bw->offsets_->local_storm_id) {
      // Switch the message to be green to show it's player's own message
      snprintf(buf, sizeof buf, "\x1f%s: \x07%s", name, message);
    }
    bw->DisplayMessage(buf, 0);

    return length;
  } else {
    auto &hook = bw->offsets_->func_hooks.ChatMessage;
    return hook.callable()(net_player, message, length);
  }
}

}  // namespace bw
}  // namespace sbat
