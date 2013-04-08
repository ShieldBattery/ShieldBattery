#include <Windows.h>
#include <io.h>
#include <fcntl.h>
#include "../common/types.h"
#include "../common/func_hook.h"
#include "../common/win_helpers.h"
#include "./brood_war.h"

namespace sbat {
using bw::BroodWar;

void InitNetworkInfo(BroodWar* brood_war);
bool MainLoop(BroodWar* brood_war);

typedef void (*GameInitFunc)();
sbat::FuncHook<GameInitFunc>* gameInitHook;
void HOOK_gameInit() {
  if (AllocConsole()) {
    // correct stdout to point to new console
    *stdout = *_fdopen(_open_osfhandle(reinterpret_cast<__int32>(
        GetStdHandle(STD_OUTPUT_HANDLE)), _O_TEXT), "w");
  }

  BroodWar brood_war;
  brood_war.set_is_brood_war(true);
  brood_war.InitSprites();

  while (true) {
    InitNetworkInfo(&brood_war);
    bool start_game = MainLoop(&brood_war);
    if (!start_game) break;

    brood_war.RunGameLoop();
    printf("Game completed...\n");
  }

  delete gameInitHook;
  gameInitHook = nullptr;
  // TODO(tec27): exit cleanly?
}

void InitNetworkInfo(BroodWar* brood_war) {
  brood_war->ChooseNetworkProvider();
  brood_war->set_is_multiplayer(true);
}

// this function loops until we're ready to exit, responding to both game (via memory and function
// hooks) and user (via console) input
bool MainLoop(BroodWar* brood_war) {
  while (true) {
    // we have to set the local player name or storm will call a different advertising function
    brood_war->set_local_player_name("life of lively 2 live");
    brood_war->CreateGame("SHIELDBATTERY", "MOTHERFUCKER",
        "C:\\Program Files (x86)\\StarCraft\\Maps\\BroodWar\\(2)Astral Balance.scm", 0x10002,
        bw::GameSpeed::Fastest);

    brood_war->InitGameNetwork();
    brood_war->ProcessLobbyTurns(4);

    if (brood_war->AddComputer(1)) {
      printf("Computer added succesfully in slot 1!\n");
    } else {
      printf("Adding computer FAILED!\n");
    }
    brood_war->ProcessLobbyTurns(8);

    if (brood_war->StartGameCountdown()) {
      printf("Game countdown started, gl hf gg!\n");
    } else {
      printf("Starting game countdown FAILED!\n");
    }
    brood_war->ProcessLobbyTurns(12);

    break;
  }

  return true;
}

void WriteMem(void* dest, void* src, uint32 data_len) {
  ScopedVirtualProtect dest_protect(dest, data_len, PAGE_EXECUTE_READWRITE);
  ScopedVirtualProtect src_protect(src, data_len, PAGE_EXECUTE_READWRITE);
  CopyMemory(dest, src, data_len);
}

// TODO(tec27): get rid of this
void killMultiInstanceCheck() {
  byte multiInstanceFix[] = { 0xC2, 0x04, 0x00 };
  WriteMem(reinterpret_cast<void*>(0x004E0380), multiInstanceFix, 3);
}

extern "C" __declspec(dllexport) void scout_onInject() {
  killMultiInstanceCheck();
  gameInitHook = new sbat::FuncHook<GameInitFunc>(reinterpret_cast<GameInitFunc>(0x004E08A5),
      HOOK_gameInit);
  gameInitHook->Inject();
}
}  // namespace sbat