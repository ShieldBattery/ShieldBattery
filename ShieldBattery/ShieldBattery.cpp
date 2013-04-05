#define WIN32_LEAN_AND_MEAN
#include <Windows.h>
#include <io.h>
#include <fcntl.h>
#include "../Shared/FuncHook.h"

#include "BroodWar.h"

typedef void (__stdcall *SNetGetPlayerNameFunc)(int player_id, char* buffer, size_t buffer_size);
SNetGetPlayerNameFunc SNetGetPlayerName = NULL;

// TODO(tec27): kill this function with fire if possible
void WriteMem(DWORD MemOffset, DWORD DataPtr, DWORD DataLen) {
  DWORD OldProt, OldProt2;

  VirtualProtect((LPVOID)MemOffset, (SIZE_T)DataLen, PAGE_EXECUTE_READWRITE, &OldProt);
  VirtualProtect((LPVOID)DataPtr, (SIZE_T)DataLen, PAGE_EXECUTE_READWRITE, &OldProt2);
  CopyMemory((LPVOID)MemOffset, (LPVOID)DataPtr, DataLen);
  VirtualProtect((LPVOID)DataPtr, DataLen, OldProt2, &OldProt2);
  VirtualProtect((LPVOID)MemOffset, DataLen, OldProt, &OldProt);
}

// TODO(tec27): get rid of this
void killMultiInstanceCheck() {
  unsigned char multiInstanceFix[] = { 0xC2, 0x04, 0x00 };
  WriteMem(0x004E0380, (DWORD)multiInstanceFix, 3);
}

void HOOK_gameInit() {
  if(AllocConsole()) {
    // correct stdout to point to new console
    *stdout = *_fdopen(_open_osfhandle((long) GetStdHandle(STD_OUTPUT_HANDLE), _O_TEXT), "w");
  }

  BroodWar::BroodWar broodWar;
  broodWar.ToggleBroodWar(true);

  // need to initialize 0x006D1200 in some way, its a pointer to some important address, maybe unit
  // list? it gets initialized by 0x004D7390, which gets called a tad further down from our
  // gameInit hook's location. we might need to run some of the functions down there manually
  // For now, I'll just try calling this
  broodWar.InitSprites();

  broodWar.ChooseNetworkProvider();
  broodWar.ToggleMultiplayer(true);

  // we have to set the local player name or storm will call a different advertising function
  strcpy_s(broodWar.local_player_name(), 25, "life of lively 2 live");
  broodWar.CreateGame("SHIELDBATTERY", "MOTHERFUCKER",
      "C:\\Program Files (x86)\\StarCraft\\Maps\\BroodWar\\(2)Astral Balance.scm", 0x10002,
      BroodWar::BroodWarSpeed::Fastest);

  broodWar.InitGameNetwork();
  broodWar.ProcessLobbyTurns(4);

  if(broodWar.AddComputer(1)) {
    printf("Computer added succesfully in slot 1!\n");
  } else {
    printf("Adding computer FAILED!\n");
  }
  broodWar.ProcessLobbyTurns(8);

  char player_name[25];
  SNetGetPlayerName(0, player_name, 25);
  printf("Player[0].name: '%s'\n", player_name);

  if(broodWar.StartGame()) {
    printf("Game started, gl hf gg!\n");
  } else {
    printf("Game starting FAILED!\n");
  }
  broodWar.ProcessLobbyTurns(12);

  broodWar.BeginGameplay();
  printf("Completed...\n");
  // TODO(tec27): exit cleanly?
}

FuncHook gameInitHook; // I love globals lol!
extern "C" __declspec(dllexport) void scout_onInject() {
  killMultiInstanceCheck();
  gameInitHook.setup(reinterpret_cast<FuncPtr>(0x004E08A5),
      reinterpret_cast<FuncPtr>(HOOK_gameInit));
  gameInitHook.inject();

  HMODULE storm = LoadLibrary(L"storm.dll");
  SNetGetPlayerName = reinterpret_cast<SNetGetPlayerNameFunc>(GetProcAddress(storm, (LPCSTR)113));
}