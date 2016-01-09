#include "./functions.h"

#include <node.h>
#include <uv.h>
#include <Windows.h>
#include <string>

#include "logger/logger.h"
#include "snp/sockets.h"
#include "shieldbattery/settings.h"
#include "shieldbattery/snp_interface.h"

using std::string;

namespace sbat {
namespace snp {
static ClientInfo* cur_client_info = nullptr;

static uv_mutex_t spoofed_game_mutex;
static bool spoofed_game_dirty;

static GameInfo* spoofed_game;
static GameInfo game_list;

int __stdcall Unbind() {
  UnbindSnp();

  uv_mutex_destroy(&spoofed_game_mutex);
  delete spoofed_game;
  spoofed_game = nullptr;

  delete cur_client_info;
  cur_client_info = nullptr;

  return true;
}

int __stdcall FreePacket(sockaddr* from, void* packet, uint32 packet_len) {
  FreeStormPacket(reinterpret_cast<StormPacket*>(packet));
  return true;
}

int __stdcall FreeServerPacket(sockaddr* from, void* packet, uint32 packet_len) {
  return true;
}

int __stdcall GetGameInfo(uint32 index, char* game_name, char* password, GameInfo* result_info) {
  if (index != 1) {
    return false;
  }

  uv_mutex_lock(&spoofed_game_mutex);
  if (spoofed_game != nullptr) {
    memcpy_s(result_info, sizeof(GameInfo), spoofed_game, sizeof(GameInfo));
    uv_mutex_unlock(&spoofed_game_mutex);
    return true;
  }

  uv_mutex_unlock(&spoofed_game_mutex);
  return false;
}

int __stdcall Initialize(ClientInfo* client_info, void* user_data, void* battle_info,
    void* module_data, HANDLE receive_event) {
  cur_client_info = new ClientInfo(*client_info);

  uv_mutex_init(&spoofed_game_mutex);
  spoofed_game_dirty = false;
  spoofed_game = nullptr;

  int result = BeginSocketLoop(receive_event, GetSettings());
  if (result != 0) {
    Logger::Logf(LogLevel::Error, "BeginSocketLoop failed [%d], snp not initialized",
        result);
    return false;
  }

  SnpInterface funcs;
  funcs.SpoofGame = SpoofGame;
  funcs.StopSpoofingGame = StopSpoofingGame;

  BindSnp(funcs);
  return true;
}

int __stdcall EnumDevices(void** device_data) {
  // this function appears unnecessary in modern protocols.
  // the important thing here is to zero out the pointer returned in modem_data,
  // and return true (no error)
  *device_data = nullptr;
  return true;
}

int __stdcall ReceiveGamesList(int unk1, int unk2, GameInfo** received_list) {
  uv_mutex_lock(&spoofed_game_mutex);
  if (spoofed_game == nullptr) {
    *received_list = nullptr;
  } else {
    *received_list = &game_list;
    if (spoofed_game_dirty) {
      memcpy_s(&game_list, sizeof(game_list), spoofed_game, sizeof(game_list));
      spoofed_game_dirty = false;
    }
  }
  uv_mutex_unlock(&spoofed_game_mutex);
  
  return true;
}

int __stdcall ReceivePacket(sockaddr** from_location, void** packet_location, uint32* packet_len) {
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

  StormPacket* packet = GetStormPacket();
  if (packet == nullptr) {
    return false;
  }

  *from_location = reinterpret_cast<sockaddr*>(&packet->from_address);
  *packet_location = packet;
  *packet_len = packet->size;

  return true;
}

int __stdcall ReceiveServerPacket(sockaddr** from_location, void** packet_location,
    uint32* packet_len) {
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

int __stdcall SendPacket(uint32 num_targets, sockaddr_in** targets, byte* data, uint32 data_len) {
  QueuedPacket packet = QueuedPacket();
  packet.num_targets = num_targets;
  packet.targets = targets;
  packet.data = data;
  packet.data_len = data_len;
  SendStormPacket(packet);

  return true;
}

int __stdcall SendCommand(char* unk1, char* player_name, void* unk2, void* unk3, char* command) {
  // battle.snp checks that the data at unk2 and unk3 is 0 or it doesn't send
  // unk1 seems to always be '\\.\\game\<game name>'
  return true;
}

int __stdcall BroadcastGame(char* game_name, char* password, char* game_data, int game_state,
    uint32 elapsed_time, int game_type, int unk1, int unk2, void* player_data,
    uint32 player_count) {
  return true;
}

int __stdcall StopBroadcastingGame() {
  return true;
}

int __stdcall FreeDeviceData(void* device_data) {
  // we never allocate modem data, so the pointer passed in will always be NULL.
  // thus, we can simply return true.
  return true;
}

int __stdcall FindGames(int unk1, void* games_list) {
  return true;
}

int __stdcall ReportGameResult(int unk1, int player_slots_len, char* player_name, int* unk2,
    char* map_name, char* results) {
  return true;
}

int __stdcall GetLeagueId(int* league_id) {
  *league_id = 0;
  return false;  // this function always returns false it seems
}

int __stdcall DoLeagueLogout(const char* player_name) {
  return true;
}

int __stdcall GetReplyTarget(char* dest, uint32 dest_len) {
  return true;
}

void SpoofGame(const string& game_name, const sockaddr_in& host_addr, bool is_replay) {
  GameInfo* info = new GameInfo();

  info->index = 1;
  info->game_state = is_replay ? GameState::ReplayActive : GameState::Active;
  memcpy_s(&info->host_addr, sizeof(info->host_addr), &host_addr, sizeof(host_addr));
#pragma warning(suppress: 28159)
  info->update_time = GetTickCount();
  strcpy_s(info->game_name, game_name.c_str());
  info->product_code = cur_client_info->product_code;
  info->version_code = cur_client_info->version_code;
  info->unk2 = 0x50;
  info->unk3 = 0xa7;

  char host_name[20];
  uv_ip4_name(&info->host_addr, host_name, sizeof(host_name));
  Logger::Logf(LogLevel::Verbose, "Spoofing game for address %s (isReplay: %s)",
      host_name, is_replay ? "true" : "false");

  uv_mutex_lock(&spoofed_game_mutex);
  delete spoofed_game;
  spoofed_game = info;
  spoofed_game_dirty = true;
  uv_mutex_unlock(&spoofed_game_mutex);
}

void StopSpoofingGame() {
  uv_mutex_lock(&spoofed_game_mutex);
  delete spoofed_game;
  spoofed_game = nullptr;
  uv_mutex_unlock(&spoofed_game_mutex);
}

}  // namespace snp
}  // namespace sbat