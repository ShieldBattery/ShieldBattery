#ifndef SNP_FUNCTIONS_H_
#define SNP_FUNCTIONS_H_

#include <WinSock2.h>
#include <Windows.h>

namespace sbat {
namespace snp {
#define SNPFUNC(Name, ...) typedef int (__stdcall *##Name##Func)(__VA_ARGS__); \
int __stdcall Name(__VA_ARGS__);

// func1
SNPFUNC(Unbind);
SNPFUNC(FreePacket, sockaddr* from, void* packet, size_t packet_len);
SNPFUNC(FreeServerPacket, sockaddr* from, void* packet, size_t packet_len);
SNPFUNC(GetGameInfo, int unk1, char* game_name, char* password, void* unk2);
// func6
SNPFUNC(Initialize, void* version_info, void* user_data, void* battle_info, void* module_data,
    HANDLE event_handle);
// func8
SNPFUNC(EnumDevices, void** device_data);
SNPFUNC(ReceiveGamesList, int unk1, int unk2, void** games_list);
SNPFUNC(ReceivePacket, sockaddr** from_location, void** packet_location, size_t* packet_len);
SNPFUNC(ReceiveServerPacket, sockaddr** from_location, void** packet_location, size_t* packet_len);
// func13 -- SelectGame
SNPFUNC(SendPacket, size_t num_targets, sockaddr* targets, void* data, size_t data_len);
SNPFUNC(SendCommand, char* unk1, char* player_name, void* unk2, void* unk3, char* command);
SNPFUNC(BroadcastGame, char* game_name, char* password, char* game_data, int game_state,
    size_t elapsed_time, int game_type, int unk1, int unk2, void* player_data,
    size_t player_count);
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
SNPFUNC(GetReplyTarget, char* dest, size_t dest_len);

#undef SNPFUNC
}  // namespace snp
}  // namespace sbat

#endif  // SNP_FUNCTIONS_H_