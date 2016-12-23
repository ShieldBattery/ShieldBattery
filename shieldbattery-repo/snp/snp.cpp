#include "snp/snp.h"

#include <Windows.h>
#include "snp/functions.h"
#include "common/types.h"

namespace sbat {
namespace snp {
const uint32 snp_identifier = 'SBAT';

SNetSnpListEntry snp_list_entry;
SnpFunctions snp_functions;

void InitSnpStructs() {
  snp_functions.size = sizeof(snp_functions);

  // Some of these functions have temporary addresses that make it easier to tell what function was
  // being called in stack traces and error messages
  snp_functions.func1 = reinterpret_cast<void*>(-1);
  snp_functions.Unbind = Unbind;
  snp_functions.FreePacket = FreePacket;
  snp_functions.FreeServerPacket = FreeServerPacket;
  snp_functions.GetGameInfo = GetGameInfo;
  snp_functions.func6 = reinterpret_cast<void*>(-6);
  snp_functions.Initialize = Initialize;
  snp_functions.func8 = reinterpret_cast<void*>(-8);
  snp_functions.EnumDevices = EnumDevices;
  snp_functions.ReceiveGamesList = ReceiveGamesList;
  snp_functions.ReceivePacket = ReceivePacket;
  snp_functions.ReceiveServerPacket = ReceiveServerPacket;
  snp_functions.func13 = reinterpret_cast<void*>(-13);
  snp_functions.SendPacket = SendPacket;
  snp_functions.SendCommand = SendCommand;
  snp_functions.BroadcastGame = BroadcastGame;
  snp_functions.StopBroadcastingGame = StopBroadcastingGame;
  snp_functions.FreeDeviceData = FreeDeviceData;
  snp_functions.FindGames = FindGames;
  snp_functions.func20 = reinterpret_cast<void*>(-20);
  snp_functions.ReportGameResult = ReportGameResult;
  snp_functions.func22 = reinterpret_cast<void*>(-22);
  snp_functions.func23 = reinterpret_cast<void*>(-23);
  snp_functions.func24 = reinterpret_cast<void*>(-24);
  snp_functions.GetLeagueId = GetLeagueId;
  snp_functions.DoLeagueLogout = DoLeagueLogout;
  snp_functions.GetReplyTarget = GetReplyTarget;

  // Since we don't actually use the list, its fine not to set this
  snp_list_entry.prev = nullptr;
  snp_list_entry.next = reinterpret_cast<SNetSnpListEntry*>(-1);  // Ensure the list ends
  GetModuleFileNameA(GetModuleHandle("shieldbattery.dll"),
      snp_list_entry.file_path, sizeof(snp_list_entry.file_path));
  snp_list_entry.index = 0;
  snp_list_entry.identifier = snp_identifier;
  // Name/Description don't matter since we don't show the normal network UI
  snp_list_entry.name[0] = '\0';
  snp_list_entry.description[0] = '\0';
  snp_list_entry.capabilities = {
    sizeof(SnpCapabilities),
    // As far as I can see, only the 1 bit matters here, and seems to affect how storm allocates
    // for packet data. Only UDP LAN sets it. Doesn't look particularly useful to us. All of the
    // network modes set at least 0x20000000 though, so we'll set it as well.
    0x20000000,  // unknown1
    SNP_PACKET_SIZE - 16,  // max_packet_size, minus 16 because Storm normally does that (overhead?)
    16,  // unknown3
    256,  // displayed_player_count
    // This value is related to timeouts in some way (it's always used alongside GetTickCount, and
    // always as the divisor). The value here matches the one used by UDP LAN and new
    // (post-lan-lat-changes) BNet.
    100000,  // unknown 5
    // This value is seemingly related to timeouts as well (and does not affect action latency under
    // normal conditions). The value chosen here sits between UDP LAN (50, minimum) and BNet (500).
    384,  // player_latency
    // This is not really an accurate naming, it's more related to the rate at which packets will be
    // sent. This value matches UDP LAN and new (post-lan-lat-changes) BNet.
    8,  //  max_player_count
    // Matches UDP LAN
    2  //  turn_delay
  };
}

const SNetSnpListEntry* GetSnpListEntry() {
  return &snp_list_entry;
}

}  // namespace snp
}  // namespace sbat

__declspec(dllexport) BOOL __stdcall SnpBind(uint32 index, sbat::snp::SnpFunctions** functions) {
  if (index > 0) return false;  // we only have one provider, so any index over that is an error
  if (functions == NULL) return false;

  *functions = &sbat::snp::snp_functions;

  return true;
}