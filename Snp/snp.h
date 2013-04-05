#ifndef SHIELDBATTERY_SNP_SNP_H_
#define SHIELDBATTERY_SNP_SNP_H_

#include "functions.h"

namespace sbat {
namespace snp {

struct SnpCapabilities {
  DWORD size;
  DWORD unknown1;
  DWORD max_packet_size;
  DWORD unknown3;
  DWORD displayed_player_count;
  DWORD unknown4;
  DWORD player_latency;
  DWORD max_player_count;
  DWORD turn_delay;
};

// TODO(tec27): update the names/types here as you figure out what they are
struct SnpFunctions {
  DWORD size;

  void* func1;
  UnbindFunc Unbind;
  FreePacketFunc FreePacket;
  FreeServerPacketFunc FreeServerPacket;
  GetGameInfoFunc GetGameInfo;
  void* func6;
  InitializeFunc Initialize;
  void* func8;
  EnumDevicesFunc EnumDevices;
  ReceiveGamesListFunc ReceiveGamesList;
  ReceivePacketFunc ReceivePacket;
  ReceiveServerPacketFunc ReceiveServerPacket;
  void* func13; // called from SNetSelectGame - does something with loading resources, 
                // look at this in non-bnet snp
                // this actually does a similar thing to login, it creates a dialog and doesn't
                // return until exit/a game is selected to join/create
  SendPacketFunc SendPacket;
  SendCommandFunc SendCommand;
  BroadcastGameFunc BroadcastGame;
  StopBroadcastingGameFunc StopBroadcastingGame;
  FreeDeviceDataFunc FreeDeviceData;
  FindGamesFunc FindGames;
  void* func20;
  ReportGameResultFunc ReportGameResult;
  void* func22;
  void* func23;
  void* func24;
  GetLeagueIdFunc GetLeagueId;
  DoLeagueLogoutFunc DoLeagueLogout;
  GetReplyTargetFunc GetReplyTarget;
};

} // namespace snp
} // namespace shieldbattery

extern "C" BOOL WINAPI DllMain(HINSTANCE dllInstance, DWORD reason, LPVOID reserved);

BOOL __stdcall SnpQuery(int index, unsigned long* identifier, const char** name,
    const char** description, const sbat::snp::SnpCapabilities** capabilities);
BOOL __stdcall SnpBind(int index, sbat::snp::SnpFunctions** functions);


#endif