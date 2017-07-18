#include "observing_patches.h"

#include <algorithm>
#include <iterator>
#include "logger/logger.h"

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

void __stdcall ObservingPatches::DrawStatusScreenHook() {
  auto bw = BroodWar::Get();
  auto &hook = bw->offsets_->func_hooks.DrawStatusScreen;
  CallWithReplayFlagIfObserver(bw, hook);
}

void __stdcall ObservingPatches::DrawResourceCountsHook(Control *control, void *param) {
  auto bw = BroodWar::Get();
  auto &hook = bw->offsets_->func_hooks.DrawResourceCounts;
  CallWithReplayFlagIfObserver(bw, hook, control, param);
}

int __stdcall ObservingPatches::CenterScreenOnOwnStartLocationHook(PreplacedUnit* unit, void* b) {
  auto bw = BroodWar::Get();
  auto &hook = bw->offsets_->func_hooks.CenterScreenOnOwnStartLocation;
  auto was_replay = *bw->offsets_->is_replay;
  if (IsObserver(bw)) {
    if (bw->players()[unit->player].type != 0) {
      // Center the screen once we get the first active player so observers don't randomly
      // end up staring at unused start location.
      *bw->offsets_->is_replay = true;
    }
  }
  auto result = hook.callable()(unit, b);
  *bw->offsets_->is_replay = was_replay;
  return result;
}

void __stdcall ObservingPatches::DrawCommandButtonHook(Control *control, int x, int y,
    void *area) {
  // Need to disable replay flag being set from DrawScreenHook if observing
  auto bw = BroodWar::Get();
  auto &hook = bw->offsets_->func_hooks.DrawCommandButton;
  auto was_replay = *bw->offsets_->is_replay;
  if (IsObserver(bw)) {
    *bw->offsets_->is_replay = 0;
  }
  hook.callable()(control, x, y, area);
  if (IsObserver(bw)) {
    *bw->offsets_->is_replay = was_replay;
  }
}

void __stdcall ObservingPatches::UpdateCommandCardHook() {
  auto bw = BroodWar::Get();
  auto &hook = bw->offsets_->func_hooks.UpdateCommandCard;
  if (IsObserver(bw) && *bw->offsets_->primary_selected != nullptr) {
    *bw->offsets_->local_nation_id = (*bw->offsets_->primary_selected)->player;
    hook.callable()();
    *bw->offsets_->local_nation_id = -1;
  } else {
    hook.callable()();
  }
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
    memcpy(replay_command + 2, buf, std::min(static_cast<size_t>(0x50), strlen(buf)));
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

static Control *FindDialogChild(Dialog* dialog, int child_id) {
  for (Control *control = dialog->first_child; control != nullptr; control = control->next) {
    if (control->id == child_id) {
      return control;
    }
  }
  return nullptr;
}

void __stdcall ObservingPatches::LoadDialogHook(Dialog *dialog, void *base, void *event_handler,
    const char* source_file, int source_line) {
  auto bw = BroodWar::Get();
  auto &hook = bw->offsets_->func_hooks.LoadDialog;
  hook.callable()(dialog, base, event_handler, source_file, source_line);
  if (!IsObserver(bw)) {
    return;
  }
  if (strcmp(dialog->base.label, "TextBox") == 0) {
    Control *to_allies = FindDialogChild(dialog, 0x2);
    if (to_allies != nullptr) {
      to_allies->label = "To Observers:";
      // Of course the control has to be resized by hand <.<
      // Possibly could also just make it left aligned.
      // This can be determined "easily" by breaking 1.16.1 in debugger at 004F2FFF when opening
      // chat entry while talking to one player, and replacing the "To player:" string, and stepping
      // over the call.
      to_allies->area[2] = 0x55;
    } else {
      Logger::Log(LogLevel::Error, "Couldn't find 'To Allies:' control");
    }
  } else if (strcmp(dialog->base.label, "MsgFltr") == 0) {
    Control *to_allies = FindDialogChild(dialog, 0x3);
    if (to_allies != nullptr) {
      to_allies->label = "Send to observers";
    } else {
      Logger::Log(LogLevel::Error, "Couldn't find 'Send to allies:' control");
    }
  }
  return;
}

void __stdcall ObservingPatches::InitUiVariablesHook() {
  auto bw = BroodWar::Get();
  auto &hook = bw->offsets_->func_hooks.InitUiVariables;
  hook.callable()();
  if (IsObserver(bw)) {
    *bw->offsets_->replay_visions = 0xff;
    *bw->offsets_->player_visions = 0xff;
    // To allies (=observers)
    *bw->offsets_->chat_dialog_recipent = 9;
    // Could also set the race, it currently just does an overflow read to zerg.
  }
}

int __stdcall ObservingPatches::CmdBtn_EventHandlerHook(Control* control, UiEvent* event) {
  auto bw = BroodWar::Get();
  auto &hook = bw->offsets_->func_hooks.CmdBtn_EventHandler;
  if (!IsObserver(bw)) {
    return hook.callable()(control, event);
  } else {
    // Disable clicking on command buttons.
    // Event 4 = Left click, 6 = Double click, Extended 3 = Hotkey
    if (event->type == 0x4 || event->type == 0x6) {
      return 0;
    } else if (event->type == 0xe && event->extended_type == 3) {
      return 1;
    } else {
      return hook.callable()(control, event);
    }
  }
}

const char* __stdcall ObservingPatches::GetGluAllStringHook(int string_id) {
  auto bw = BroodWar::Get();
  auto &hook = bw->offsets_->func_hooks.GetGluAllString;
  // Replace "Replay players" text in the alliance dialog when observing
  if (string_id == 0xb6) {
    if (IsObserver(bw)) {
      return "Players";
    }
  }
  return hook.callable()(string_id);
}

void __stdcall ObservingPatches::UpdateNetTimeoutPlayersHook() {
  auto bw = BroodWar::Get();
  auto &hook = bw->offsets_->func_hooks.UpdateNetTimeoutPlayers;

  // To make observers appear in network timeout dialog, we temporarily write their info to
  // ingame player structure, and revert the change after this function has been called.
  PlayerInfo* players = bw->players();
  StormPlayerInfo* storm_players = bw->offsets_->storm_players;
  auto IsStormPlayerObs = [=](int storm_id) {
    return !std::any_of(players, players + 8, [=](const auto& player) {
      return player.storm_id == storm_id;
    });
  };
  auto FindNonHumanPlayerSlot = [=]() {
    for (int i = 0; i < 8; i++) {
      if (players[i].type != 2) {
        return i;
      }
    }
    return -1;
  };
  auto FindTimeoutDialogPlayerLabel = [&](int bw_id) -> Control* {
    Dialog* timeout_dlg = *bw->offsets_->timeout_bin;
    Control* label = FindDialogChild(timeout_dlg, -10);
    for (int i = 0; i < 8; i++) {
      if (label == nullptr) {
        return nullptr;
      }
      // Flag 0x8 == Shown
      if (label->flags & 0x8 && label->custom_value == reinterpret_cast<void*>(bw_id)) {
        return label;
      }
      label = label->next;
    }
    return nullptr;
  };

  PlayerInfo player_backup[0x8];
  int overwritten_player_id_to_storm[0x8];
  std::copy_n(players, 8, player_backup);
  std::fill_n(overwritten_player_id_to_storm, 8, -1);
  for (int storm_id = 0; storm_id < 8; storm_id++) {
    if (IsStormPlayerObs(storm_id)) {
      int slot = FindNonHumanPlayerSlot();
      if (slot != -1) {
        assert(slot >= 0 && slot < 8);
        overwritten_player_id_to_storm[slot] = storm_id;
        players[slot].storm_id = storm_id;
        players[slot].type = 2; // Human
      } else {
        Logger::Logf(LogLevel::Error,
            "Net timeout dialog: Out of player slots for observer, storm id %d", storm_id);
      }
    }
  }

  hook.callable()();

  for (int bw_id = 0; bw_id < 8; bw_id++) {
    int storm_id = overwritten_player_id_to_storm[bw_id];
    if (storm_id != -1) {
      Control* ctrl = FindTimeoutDialogPlayerLabel(bw_id);
      if (ctrl != nullptr) {
        // We need to redirect the name string to the storm player string, and replace the
        // player value to unused player 10, whose color will be set to neutral resource color.
        // (The neutral player 11 actually can have a different color for neutral buildings)
        //
        // Technically player 10 can actually have units in some odd UMS maps, but we aren't
        // allowing observing UMS games anyways, so whatever. Even if the someone noticed the
        // color changing, I doubt they would care.
        ctrl->label = storm_players[storm_id].name;
        ctrl->custom_value = reinterpret_cast<void*>(10);
        bw->offsets_->player_minimap_color[10] = *bw->offsets_->resource_minimap_color;
      }
    }
  }
  std::copy_n(player_backup, 8, players);
}

}  // namespace bw
}  // namespace sbat
