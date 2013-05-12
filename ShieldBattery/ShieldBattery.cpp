#include <conio.h>
#include <fcntl.h>
#include <io.h>
#include <Windows.h>

#include <iostream>
#include <string>

#include "deps/node/src/node.h"
#include "common/func_hook.h"
#include "common/types.h"
#include "common/win_helpers.h"
#include "shieldbattery/brood_war.h"

namespace sbat {
using bw::BroodWar;

char* null_arg = "";

void InitNetworkInfo(BroodWar* brood_war);
bool MainLoop(BroodWar* brood_war);

typedef void (*GameInitFunc)();
sbat::FuncHook<GameInitFunc>* gameInitHook;
void HOOK_gameInit() {
  if (AllocConsole()) {
    // correct stdout/stderr/stdin to point to new console
    FILE* fp;
    freopen_s(&fp, "CONOUT$", "w", stdout);
    freopen_s(&fp, "CONOUT$", "w", stderr);
    freopen_s(&fp, "CONIN$", "r", stdin);
    // make cout, wcout, cin, wcin, wcerr, cerr, wclog and clog
    // point to console as well
    std::ios::sync_with_stdio();
  }

  BroodWar brood_war;
  brood_war.set_is_brood_war(true);
  brood_war.InitSprites();

  printf("What's your name, soldier?\n");
  std::string name;
  std::getline(std::cin, name);
  brood_war.set_local_player_name(name);

  while (true) {
    InitNetworkInfo(&brood_war);

    char** argv = new char*[1];
    argv[0] = null_arg;
    node::Start(0, argv);

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
  if (!brood_war->ChooseNetworkProvider('UDPN'))  {
    printf("Could not choose network provider!\n");
  }
  brood_war->set_is_multiplayer(true);
}

void HandleCreateGame(BroodWar* brood_war) {
  brood_war->CreateGame("SHIELDBATTERY", "",
      "C:\\Program Files (x86)\\StarCraft\\Maps\\BroodWar\\(2)Astral Balance.scm", 0x10002,
      bw::GameSpeed::Fastest);
  brood_war->InitGameNetwork();

  printf("Game created.\n");
}

void HandleAddAi(BroodWar* brood_war, char slot_num) {
  if (brood_war->AddComputer(slot_num - '0')) {
    printf("Computer added succesfully in slot %c!\n", slot_num);
  } else {
    printf("Adding computer FAILED!\n");
  }
}

void HandleStartGame(BroodWar* brood_war) {
  if (brood_war->StartGameCountdown()) {
    printf("Game countdown started, gl hf gg!\n");
  } else {
    printf("Starting game countdown FAILED!\n");
  }
}

// this function loops until we're ready to exit, responding to both game (via memory and function
// hooks) and user (via console) input
bool MainLoop(BroodWar* brood_war) {
  bool adding_ai = false;

  printf("\nPress a key to perform an action (%s)\n",
      "c = Create Game, a# = Add AI in slot #, s = Start countdown, ! = Run Game, q = Quit");
  while (true) {
    if (!_kbhit()) {
      brood_war->ProcessLobbyTurn();
      Sleep(250);
      continue;
    }

    char key = _getch();
    switch (key) {
      case 'c': adding_ai = false; HandleCreateGame(brood_war); break;
      case 'a': adding_ai = true; break;
      case '0':
      case '1':
      case '2':
      case '3':
      case '4':
      case '5':
      case '6':
      case '7': adding_ai = false; HandleAddAi(brood_war, key); break;
      case 's': adding_ai = false; HandleStartGame(brood_war); break;
      case '!': return true;
      case 'q': return false;
    }
  }
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