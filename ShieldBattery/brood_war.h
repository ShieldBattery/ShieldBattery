#ifndef SHIELDBATTERY_BROOD_WAR_H_
#define SHIELDBATTERY_BROOD_WAR_H_

#include <Windows.h>
#include <cassert>
#include <string>
#include "../common/func_hook.h"
#include "../common/types.h"

#define CURRENT_BROOD_WAR_VERSION sbat::bw::Version::v1161

namespace sbat {
namespace bw {
// TODO(tec27): move everything but the BroodWar class outta this file (and *maybe* namespace)
struct PlayerInfo {
  uint32 player_id;
  uint32 storm_id;
  uint8 type;
  uint8 race;
  uint8 team;
  char name[25];
};

struct MapListEntry {
  MapListEntry* prev;
  MapListEntry* next;
  char filename[32];
};

enum class GameSpeed {
  Slowest = 0,
  Slower,
  Slow,
  Normal,
  Fast,
  Faster,
  Fastest
};

#define FUNCDEF(RetType, Name, ...) typedef RetType (__stdcall *##Name##Func)(__VA_ARGS__); \
    ##Name##Func Name;
struct Functions {
  FUNCDEF(void, InitSprites);
  FUNCDEF(void, InitPlayerInfo);
  FUNCDEF(void, ChooseNetworkProvider);
  FUNCDEF(void, InitGameNetwork);
  FUNCDEF(void, GameLoop);
  FUNCDEF(uint32, GetMapsList, uint32 unk1, char* path, char* last_map_name);
  FUNCDEF(uint32, SelectMapOrDirectory, char* game_name, char* password, int game_type,
      int game_speed, char* map_folder_path);
  FUNCDEF(uint32, AddComputer, uint32 slot_num);
  FUNCDEF(uint32, StartGameCountdown);
  FUNCDEF(void, ProcessLobbyTurn, void* unused);
  FUNCDEF(void, ShowLobbyChatMessage, char* message);
};
#undef FUNCDEF

struct Offsets {
  PlayerInfo* players;
  char* current_map_path;
  char* current_map_name;
  char* current_map_folder_path;
  uint32* local_player_id0;
  uint32* local_player_id1;
  uint32* local_player_id2;
  char* local_player_name;
  uint32* current_game_speed;
  uint8* is_brood_war;
  uint8* is_multiplayer;
  uint8* is_game_created;
  MapListEntry* maps_list_root;

  Functions functions;

  byte* start_from_any_glue_patch;
  byte* storm_unsigned_snp_patch;
  uint32* game_countdown_delay_patch;
};

enum class Version {
  v1161
};

template <Version version>
Offsets* GetOffsets();

template <> inline
Offsets* GetOffsets<Version::v1161>() {
  Offsets* offsets = new Offsets;

  offsets->players = reinterpret_cast<PlayerInfo*>(0x0057EEE0);
  offsets->current_map_path = reinterpret_cast<char*>(0x0057FD3C);
  offsets->current_map_name = reinterpret_cast<char*>(0x0057FE40);
  offsets->current_map_folder_path = reinterpret_cast<char*>(0x0059BB70);
  offsets->local_player_id0 = reinterpret_cast<uint32*>(0x00512684);
  offsets->local_player_id1 = reinterpret_cast<uint32*>(0x00512688);
  offsets->local_player_id2 = reinterpret_cast<uint32*>(0x0051268C);
  offsets->local_player_name = reinterpret_cast<char*>(0x0057EE9C);
  offsets->current_game_speed = reinterpret_cast<uint32*>(0x006CDFD4);
  offsets->is_brood_war = reinterpret_cast<uint8*>(0x0058F440);
  offsets->is_multiplayer = reinterpret_cast<uint8*>(0x0057F0B4);
  offsets->is_game_created = reinterpret_cast<uint8*>(0x00596888);
  offsets->maps_list_root = reinterpret_cast<MapListEntry*>(0x0051A278);

  offsets->functions.InitSprites = reinterpret_cast<Functions::InitSpritesFunc>(0x004D7390);
  offsets->functions.InitPlayerInfo = reinterpret_cast<Functions::InitPlayerInfoFunc>(0x004A91E0);
  offsets->functions.ChooseNetworkProvider =
    reinterpret_cast<Functions::ChooseNetworkProviderFunc>(0x004D3CC0);
  offsets->functions.InitGameNetwork =
      reinterpret_cast<Functions::InitGameNetworkFunc>(0x004D4130);
  offsets->functions.GameLoop = reinterpret_cast<Functions::GameLoopFunc>(0x004E0710);
  offsets->functions.GetMapsList = reinterpret_cast<Functions::GetMapsListFunc>(0x004A73C0);
  offsets->functions.SelectMapOrDirectory =
      reinterpret_cast<Functions::SelectMapOrDirectoryFunc>(0x004A8050);
  offsets->functions.AddComputer = reinterpret_cast<Functions::AddComputerFunc>(0x00452720);
  offsets->functions.StartGameCountdown =
      reinterpret_cast<Functions::StartGameCountdownFunc>(0x00452460);
  offsets->functions.ProcessLobbyTurn =
      reinterpret_cast<Functions::ProcessLobbyTurnFunc>(0x004D4340);
  offsets->functions.ShowLobbyChatMessage =
      reinterpret_cast<Functions::ShowLobbyChatMessageFunc>(0x004B91C0);

  offsets->start_from_any_glue_patch = reinterpret_cast<unsigned char*>(0x00487076);
  offsets->storm_unsigned_snp_patch = reinterpret_cast<unsigned char*>(0x0003DDD8);
  offsets->game_countdown_delay_patch = reinterpret_cast<unsigned int*>(0x004720C5);

  return offsets;
}

class BroodWar {
  typedef void (__stdcall *MapListEntryCallback)(MapListEntry* map_data, char* map_name,
      uint32 file_type);

public:
  BroodWar();
  explicit BroodWar(Offsets* broodWarOffsets);
  ~BroodWar();

  bool CreateGame(const std::string& game_name, const std::string& password,
      const std::string& map_path, const uint32 game_type, const GameSpeed game_speed);

  PlayerInfo* players() const;
  std::string current_map_path() const;
  std::string current_map_name() const;
  std::string current_map_folder_path() const;
  uint32 local_player_id() const;
  std::string local_player_name() const;
  void set_local_player_name(const std::string& name);
  GameSpeed current_game_speed() const;
  bool is_brood_war() const;
  void set_is_brood_war(bool is_brood_war);
  bool is_multiplayer() const;
  void set_is_multiplayer(bool is_multiplayer);
  bool is_game_created() const;
  void set_is_game_created(bool is_created);

  void InitSprites();
  void InitPlayerInfo();
  bool ChooseNetworkProvider(uint32 provider = 'SBAT');
  void InitGameNetwork();
  bool AddComputer(uint32 slot_num);
  void ProcessLobbyTurn();
  bool StartGameCountdown();
  void RunGameLoop();

private:
  void ApplyPatches(void);
  void GetMapsList(const MapListEntryCallback callback);
  void SelectMapOrDirectory(const std::string& game_name, const std::string& password,
      uint32 game_type, GameSpeed game_speed, MapListEntry* map_data);

  Offsets* offsets_;
  // TODO(tec27): really need a class that lets me detour to member functions
  FuncHook<Functions::ShowLobbyChatMessageFunc>* lobby_chat_hook_;
};
}  // namespace bw
}  // namespace sbat
#endif  // SHIELDBATTERY_BROOD_WAR_H_
