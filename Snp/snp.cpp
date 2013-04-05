#include "snp.h"

#define WIN32_LEAN_AND_MEAN
#include <Windows.h>
#include "functions.h"
#include "snp_packets.h"

using namespace sbat::snp;

// These have to match what's in the caps.dat file in the MPQ that gets appended to this DLL
const unsigned long snp_identifier = 'SBAT';
const char* snp_name = "ShieldBattery";
const char* snp_description = "Life of lively to live to life of full life thx to shield battery";
const SnpCapabilities snp_capabilities = {
  sizeof(SnpCapabilities),
  0x0,
  SNP_PACKET_SIZE,
  0x10,
  0x100,
  0x05DC,
  0x100,
  0x08,
  0x02
};
SnpFunctions snp_functions;

void Init() {
  snp_functions.size = sizeof(snp_functions);

  // Some of these functions have temporary addresses that make it easier to tell what function was
  // being called in stack traces and error messages
  snp_functions.func1 = (void*)-1;
  snp_functions.Unbind = Unbind;
  snp_functions.FreePacket = FreePacket;
  snp_functions.FreeServerPacket = FreeServerPacket;
  snp_functions.GetGameInfo = GetGameInfo;
  snp_functions.func6 = (void*)-6;
  snp_functions.Initialize = Initialize;
  snp_functions.func8 = (void*)-8;
  snp_functions.EnumDevices = EnumDevices;
  snp_functions.ReceiveGamesList = ReceiveGamesList;
  snp_functions.ReceivePacket = ReceivePacket;
  snp_functions.ReceiveServerPacket = ReceiveServerPacket;
  snp_functions.func13 = (void*)-13;
  snp_functions.SendPacket = SendPacket;
  snp_functions.SendCommand = SendCommand;
  snp_functions.BroadcastGame = BroadcastGame;
  snp_functions.StopBroadcastingGame = StopBroadcastingGame;
  snp_functions.FreeDeviceData = FreeDeviceData;
  snp_functions.FindGames = FindGames;
  snp_functions.func20 = (void*)-20;
  snp_functions.ReportGameResult = ReportGameResult;
  snp_functions.func22 = (void*)-22;
  snp_functions.func23 = (void*)-23;
  snp_functions.func24 = (void*)-24;
  snp_functions.GetLeagueId = GetLeagueId;
  snp_functions.DoLeagueLogout = DoLeagueLogout;
  snp_functions.GetReplyTarget = GetReplyTarget;
}

BOOL __stdcall SnpQuery(int index, unsigned long* identifier, const char** name,
    const char** description, const SnpCapabilities** capabilities) {
  if(index > 0) return false;
  if(!identifier || !name || !description || !capabilities) return false;

  *identifier = snp_identifier;
  *name = snp_name;
  *description = snp_description;
  *capabilities = &snp_capabilities;

  return true;
}

BOOL __stdcall SnpBind(int index, SnpFunctions** functions) {
  if(index > 0) return false; // we only have one provider, so any index over that is an error
  if(functions == NULL) return false;

  *functions = &snp_functions;

  return true;
}

extern "C" BOOL WINAPI DllMain(HINSTANCE dllInstance, DWORD reason, LPVOID reserved) {
  switch(reason) {
    case DLL_PROCESS_ATTACH: {
      Init();
      break;
    }
    case DLL_PROCESS_DETACH: {
      break;
    }
    case DLL_THREAD_ATTACH: {
      break;
    }
    case DLL_THREAD_DETACH: {
      break;
    }
  }

  return true;
}