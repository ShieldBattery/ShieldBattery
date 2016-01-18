#pragma once

#include <node.h>
#include <Windows.h>
#include <string>
#include <winsock2.h>

#include "common/types.h"
#include "shieldbattery/snp_interface.h"

namespace sbat {
namespace snp {

enum class GameState : uint32 {
  Private = 0x01,
  Full = 0x02,
  Active = 0x04,
  Started = 0x08,
  Replay = 0x80,
  ReplayActive = 0x84,
};

#pragma pack(push)
#pragma pack(1)
struct GameInfo {
  uint32 index;
  GameState game_state;
  uint32 unk1;
  sockaddr_in host_addr;
  uint32 unk2;
  uint32 update_time;
  uint32 unk3;
  char game_name[128];
  char game_stats[128];
  GameInfo* next;
  void* extra;
  uint32 extra_size;
  uint32 product_code;
  uint32 version_code;
};

struct ClientInfo {
  uint32 size;
  char* product_name;
  char* version_str;
  uint32 product_code;
  uint32 version_code;
  uint32 unk1;
  uint32 max_players;
  uint32 unk2;
  uint32 unk3;
  uint32 unk4;
  uint32 unk5;
  char* cd_key;
  char* owner_name;
  uint32 is_shareware;
  uint32 language_id;
};
#pragma pack(pop)

#define SNPFUNC(Name, ...) typedef int (__stdcall *##Name##Func)(__VA_ARGS__); \
int __stdcall Name(__VA_ARGS__);

// func1
SNPFUNC(Unbind);
SNPFUNC(FreePacket, sockaddr_in* from, char* packet, uint32 packet_len);
SNPFUNC(FreeServerPacket, sockaddr* from, void* packet, uint32 packet_len);
SNPFUNC(GetGameInfo, uint32 index, char* game_name, char* password, GameInfo* result_info);
// func6
SNPFUNC(Initialize, ClientInfo* client_info, void* user_data, void* battle_info, void* module_data,
    HANDLE receive_event);
// func8
SNPFUNC(EnumDevices, void** device_data);
SNPFUNC(ReceiveGamesList, int unk1, int unk2, GameInfo** received_list);
SNPFUNC(ReceivePacket, sockaddr_in** from_location, char** packet_location, uint32* packet_len);
SNPFUNC(ReceiveServerPacket, sockaddr** from_location, void** packet_location, uint32* packet_len);
// func13 -- SelectGame
SNPFUNC(SendPacket, uint32 num_targets, sockaddr_in** targets, char* data, uint32 data_len);
SNPFUNC(SendCommand, char* unk1, char* player_name, void* unk2, void* unk3, char* command);
SNPFUNC(BroadcastGame, char* game_name, char* password, char* game_data, int game_state,
    uint32 elapsed_time, int game_type, int unk1, int unk2, void* player_data,
    uint32 player_count);
SNPFUNC(StopBroadcastingGame);
SNPFUNC(FreeDeviceData, void* device_data);
SNPFUNC(FindGames, int unk1, void* games_list);
// func20
SNPFUNC(ReportGameResult, int unk1, int player_slots_len, char* player_name, int* unk2,
    char* map_name, char* results);
// func22
// func23
// func24
SNPFUNC(GetLeagueId, int* league_id);
SNPFUNC(DoLeagueLogout, const char* player_name);
SNPFUNC(GetReplyTarget, char* dest, uint32 dest_len);

#undef SNPFUNC

void SpoofGame(const std::string& game_name, const sockaddr_in& host_addr, bool is_replay);
void StopSpoofingGame();
}  // namespace snp
}  // namespace sbat
