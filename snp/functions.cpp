#include "./functions.h"

#include <Windows.h>
#include <io.h>
#include <stdio.h>
#include <fcntl.h>

namespace sbat {
namespace snp {
bool need_to_free_console = false;

int __stdcall Unbind() {
  //printf("Unbind called.\n");
  if (need_to_free_console) {
    FreeConsole();
    need_to_free_console = false;
  }

  // TODO(tec27): Free NetManager object (see Initialize)

  return true;
}

int __stdcall FreePacket(sockaddr* from, void* packet, size_t packet_len) {
  //printf("FreePacket called for packet at: 0x%p\n", from);

  return true;
}

int __stdcall FreeServerPacket(sockaddr* from, void* packet, size_t packet_len) {
  //printf("FreeServerPacket called for packet at: 0x%p\n", from);

  return true;
}

int __stdcall GetGameInfo(int unk1, char* game_name, char* password, void* unk2) {
  // unk2 looks like its meant to be filled with the game info of the game being queried

  //printf("GetGameInfo(unk1 = %d, game_name = '%s', password = '%s', unk2 = 0x%p) called.\n",
  //    unk1, game_name, password, unk2);

  return false;
}

int __stdcall Initialize(void* version_info, void* user_data, void* battle_info,
    void* module_data, HANDLE event_handle) {
  // the parameters here I think are the same things that get passed into SNetInitializeProvider,
  // except without the provider name and added module_data

  // version info structure: -- looks to be _clientInfo in storm.h?
  // int unknown (3C) -- probably size?
  // char* game_title (Brood War)
  // char* version_str (Version 1.16.1)
  // unsigned long version_code ('PXES')
  // int unknown (D3) -- something to do with version code, there's code for printing "PXESD3"
  // int unknown (0)
  // int unknown (8) -- this value maxes out at 256
  // ... rest unknown if it continues, don't seem to be used

  // battle_info is some kind of structure as well: -- looks to be _battleInfo in storm.h?
  // int unknown (5C) -- probably size?
  // int unknown (1)
  // void* unknown (points to something starting with 0x558BEC81)
  // ... rest unknown/unused if it continues

  // event_handle used in SetEvent, signaling something about sockets/service provider interface?

  //if (AllocConsole()) {
  //  *stdout = *_fdopen(_open_osfhandle(reinterpret_cast<__int32>(GetStdHandle(STD_OUTPUT_HANDLE)),
  //      _O_TEXT), "w");  // correct stdout to point to new console
  //  *stdin = *_fdopen(_open_osfhandle(reinterpret_cast<__int32>(GetStdHandle(STD_INPUT_HANDLE)),
  //      _O_TEXT), "r");  // correct stdin to point to new console
  //  need_to_free_console = true;
  //}
  //printf("Initialize called.\n");

  // TODO(tec27): create a NetManager object

  return true;
}

int __stdcall EnumDevices(void** device_data) {
  // this function appears unnecessary in modern protocols.
  // the important thing here is to zero out the pointer returned in modem_data,
  // and return true (no error)

  //printf("EnumDevices called.\n");

  *device_data = NULL;
  return true;
}

int __stdcall ReceiveGamesList(int unk1, int unk2, void** games_list) {
  // this seems to set the games_list pointer to a list of all the games it last received.
  // if no games list has been received since the last call to this, the pointer is set to null.
  // usually this is followed up by a call to FindGames which sends out a search packet.

  //printf("ReceiveGamesList(%d, %d, ...) called.\n", unk1, unk2);

  *games_list = NULL;
  return true;
}

int __stdcall ReceivePacket(sockaddr** from_location, void** packet_location, size_t* packet_len) {
  if (from_location == nullptr) {
    return false;
  }
  *from_location = nullptr;

  if (packet_location == nullptr) {
    return false;
  }
  *packet_location = nullptr;

  if (packet_len == nullptr) {
    return false;
  }
  *packet_len = 0;

  return false;   // what do we say to ReceivePacket? not today
}

int __stdcall ReceiveServerPacket(sockaddr** from_location, void** packet_location,
    size_t* packet_len) {
  if (from_location == nullptr) {
    return false;
  }
  *from_location = nullptr;

  if (packet_location == nullptr) {
    return false;
  }
  *packet_location = nullptr;

  if (packet_len == nullptr) {
    return false;
  }
  *packet_len = 0;

  return false;
}

int __stdcall SendPacket(size_t num_targets, sockaddr* targets, void* data, size_t data_len) {
  //printf("SendPacket called for %u targets with packet of %u bytes\n", num_targets, data_len);

  return true;
}

int __stdcall SendCommand(char* unk1, char* player_name, void* unk2, void* unk3, char* command) {
  // battle.snp checks that the data at unk2 and unk3 is 0 or it doesn't send
  // unk1 seems to always be '\\.\\game\<game name>'
  //printf("SendCommand called for player %s with command `%s` [%s]\n", player_name, command, unk1);

  return true;
}

int __stdcall BroadcastGame(char* game_name, char* password, char* game_data, int game_state,
    size_t elapsed_time, int game_type, int unk1, int unk2, void* player_data,
    size_t player_count) {
  //printf("BroadcastGame(name = '%s', password = '%s', game_data = '%s') called.\n",
  //    game_name, password, game_data);

  return true;
}

int __stdcall StopBroadcastingGame() {
  //printf("StopBroadcastingGame called.\n");

  return true;
}

int __stdcall FreeDeviceData(void* device_data) {
  // we never allocate modem data, so the pointer passed in will always be NULL.
  // thus, we can simply return true.

  //printf("FreeDeviceData called.\n");

  return true;
}

int __stdcall FindGames(int unk1, void* games_list) {
  // sends out a packet that I think is used for finding games.
  // in UDP this packet contains version info (SEXP + version word)
  // this is often called directly after GetGamesList()

  //printf("FindGames(%d, 0x%p) called.\n", unk1, games_list);

  return true;
}

int __stdcall ReportGameResult(int unk1, int player_slots_len, char* player_name, int* unk2,
    char* map_name, char* results) {
  //printf("Reporting game result for player '%s' [%d slots] on map '%s':\n%s\n", player_name,
  //    player_slots_len, map_name, results);

  return true;
}

int __stdcall GetLeagueId(int* league_id) {
  //printf("GetLeagueId called.\n");
  *league_id = 0;

  return false;  // this function always returns false it seems
}

int __stdcall DoLeagueLogout(const char* player_name) {
  //printf("DoLeagueLogout('%s') called.\n", player_name);

  return true;
}

int __stdcall GetReplyTarget(char* dest, size_t dest_len) {
  //printf("GetReplyTarget called.\n");

  return true;
}
}  // namespace snp
}  // namespace sbat