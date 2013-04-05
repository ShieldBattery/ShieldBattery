#ifndef SHIELDBATTERY_BROODWAR_H_
#define SHIELDBATTERY_BROODWAR_H_

#include <string>
#include <Windows.h>

#define CURRENT_BROOD_WAR_VERSION BroodWarVersion::v1161

// TODO(tec27): rename this namespace or the class inside it, having them the same name makes some
// things ambiguous without explicit namespace usage :(
namespace BroodWar {
// TODO(tec27): move everything but the BroodWar class outta this file (and *maybe* namespace)
struct PlayerInfo {
  int player_id;
  int storm_id;
  unsigned char type;
  unsigned char race;
  unsigned char team;
  char name[25];
};

struct MapListEntry {
  MapListEntry* prev;
  MapListEntry* next;
  char filename[32];
};

namespace BroodWarSpeed {
  enum Enum {
    Slowest = 0,
    Slower,
    Slow,
    Normal,
    Fast,
    Faster,
    Fastest
  };
}

typedef void (*Func)();
typedef int (__stdcall *GetMapsListFunc)(int unk1, char* path, char* last_map_name);
typedef void (__stdcall *MapListEntryCallback)(MapListEntry* map_data, char* map_name,
    int file_type);
typedef int (__stdcall *SelectMapOrDirectoryFunc)(char* game_name, char* password, int game_type,
    int game_speed, char* map_folder_path);
typedef int (__stdcall *AddComputerFunc)(int slot_num);
typedef int (__stdcall *StartGameFunc)();
typedef void (__stdcall *ProcessLobbyTurnFunc)(int unused);
typedef char* (*GetGameTemplateFunc)();
#define FUNCDEF(RetType, Name, ...) typedef RetType (__stdcall *##Name##Func)(__VA_ARGS__); \
    ##Name##Func Name;
struct Functions {
  FUNCDEF(void, InitSprites);
  
};
#undef FUNCDEF

struct Offsets {
  PlayerInfo* players;
  char* current_map_path;
  char* current_map_name;
  char* current_map_folder_path;
  int* local_player_id0;
  int* local_player_id1;
  int* local_player_id2;
  char* local_player_name;
  int* current_game_speed;
  unsigned char* is_brood_war;
  unsigned char* is_multiplayer;
  unsigned char* is_game_created;
  MapListEntry* maps_list_root;

  Functions functions;

  Func InitPlayerInfo;
  Func ChooseNetworkProvider;
  Func InitGameNetwork;
  GetMapsListFunc GetMapsList;
  SelectMapOrDirectoryFunc SelectMapOrDirectory;
  AddComputerFunc AddComputer;
  StartGameFunc StartGame;
  ProcessLobbyTurnFunc ProcessLobbyTurn;
  Func BeginGameplay;
  GetGameTemplateFunc GetGameTemplate;

  unsigned char* start_from_any_glue_patch;
  unsigned char* storm_unsigned_snp_patch;
  unsigned int* game_countdown_delay_patch;
};

namespace BroodWarVersion {
  enum Enum {
    v1161
  };
}

template <BroodWarVersion::Enum version> Offsets* GetOffsets();

template <> inline Offsets* GetOffsets<BroodWarVersion::v1161>() {
  Offsets* offsets = new Offsets;

  offsets->players = reinterpret_cast<PlayerInfo*>(0x0057EEE0);
  offsets->current_map_path = reinterpret_cast<char*>(0x0057FD3C);
  offsets->current_map_name = reinterpret_cast<char*>(0x0057FE40);
  offsets->current_map_folder_path = reinterpret_cast<char*>(0x0059BB70);
  offsets->local_player_id0 = reinterpret_cast<int*>(0x00512684);
  offsets->local_player_id1 = reinterpret_cast<int*>(0x00512688);
  offsets->local_player_id2 = reinterpret_cast<int*>(0x0051268C);
  offsets->local_player_name = reinterpret_cast<char*>(0x0057EE9C);
  offsets->current_game_speed = reinterpret_cast<int*>(0x006CDFD4);
  offsets->is_brood_war = reinterpret_cast<unsigned char*>(0x0058F440);
  offsets->is_multiplayer = reinterpret_cast<unsigned char*>(0x0057F0B4);
  offsets->is_game_created = reinterpret_cast<unsigned char*>(0x00596888);
  offsets->maps_list_root = reinterpret_cast<MapListEntry*>(0x0051A278);

  offsets->functions.InitSprites = reinterpret_cast<Functions::InitSpritesFunc>(0x004D7390);

  offsets->InitPlayerInfo = reinterpret_cast<Func>(0x004A91E0);
  offsets->ChooseNetworkProvider = reinterpret_cast<Func>(0x004D3CC0);
  offsets->InitGameNetwork = reinterpret_cast<Func>(0x004D4130);
  offsets->GetMapsList = reinterpret_cast<GetMapsListFunc>(0x004A73C0);
  offsets->SelectMapOrDirectory = reinterpret_cast<SelectMapOrDirectoryFunc>(0x004A8050);
  offsets->AddComputer = reinterpret_cast<AddComputerFunc>(0x00452720);
  offsets->StartGame = reinterpret_cast<StartGameFunc>(0x00452460);
  offsets->ProcessLobbyTurn = reinterpret_cast<ProcessLobbyTurnFunc>(0x004D4340);
  offsets->BeginGameplay = reinterpret_cast<Func>(0x004E0710);
  offsets->GetGameTemplate = reinterpret_cast<GetGameTemplateFunc>(0x004AAC90);

  offsets->start_from_any_glue_patch = reinterpret_cast<unsigned char*>(0x00487076);
  offsets->storm_unsigned_snp_patch = reinterpret_cast<unsigned char*>(0x0003DDD8);
  offsets->game_countdown_delay_patch = reinterpret_cast<unsigned int*>(0x004720C5);

  return offsets;
}

class BroodWar {
public:
  BroodWar();
  explicit BroodWar(Offsets* broodWarOffsets);
  ~BroodWar();

  bool CreateGame(const std::string& game_name, const std::string& password,
      const std::string& map_path, int game_type, BroodWarSpeed::Enum game_speed);

  PlayerInfo* players() const { return offsets_->players; }
  // TODO(tec27): I'd ideally like some easy way of setting these as well that conveys their max
  // length, not sure what the best way of doing that is yet
  char* current_map_path() const { return offsets_->current_map_path; }
  char* current_map_name() const { return offsets_->current_map_name; }
  char* current_map_folder_path() const { return offsets_->current_map_folder_path; }
  int local_player_id() const { return *offsets_->local_player_id1; }
  char* local_player_name() const { return offsets_->local_player_name; }
  BroodWarSpeed::Enum current_game_speed() const { 
    return static_cast<BroodWarSpeed::Enum>(*offsets_->current_game_speed); 
  }
  bool is_brood_war() const { return *offsets_->is_brood_war == 1; }
  bool is_multiplayer() const { return *offsets_->is_multiplayer == 1; }
  bool is_game_created() const { return *offsets_->is_game_created == 1; }

  void InitSprites() { offsets_->functions.InitSprites(); }
  void InitPlayerInfo() { offsets_->InitPlayerInfo(); }
  void ChooseNetworkProvider() {
    Func choose_network = offsets_->ChooseNetworkProvider;
    _asm {
      push eax;
      push ebx;
      mov eax, choose_network;
      mov ebx, 'SBAT'; // network provider identifier, we'll use our custom provider
      call eax; // TODO(tec27): returns 1 if it fails, we can probably return this somehow
      pop ebx;
      pop eax;
    }
  }
  void InitGameNetwork() { offsets_->InitGameNetwork(); }
  
  char* GetGameTemplate(const unsigned char game_type, const unsigned char secondary_type) {
    GetGameTemplateFunc get_template = offsets_->GetGameTemplate;
    char* result = nullptr;
    _asm {
      push ebx;
      push edx;
      push ecx;
      push eax;
      movzx ebx, game_type;
      mov dl, 0;
      movzx ecx, secondary_type;
      mov eax, get_template
      call eax;
      mov result, eax;
      pop eax;
      pop ecx;
      pop edx;
      pop ebx;
    }

    return result;
  }
  // TODO: these are setters and as such aren't styled properly
  void SetLocalPlayer(int player_id) {
    *offsets_->local_player_id0 = player_id;
    *offsets_->local_player_id1 = player_id;
    *offsets_->local_player_id2 = player_id;
    strcpy_s(offsets_->local_player_name, 25, this->players()[player_id].name);
  }
  void SetGameSpeed(BroodWarSpeed::Enum game_speed) {
    *offsets_->current_game_speed = game_speed;
  }
  void ToggleBroodWar(bool toggle_to) {
    *offsets_->is_brood_war = toggle_to ? 1 : 0;
  }
  void ToggleMultiplayer(bool is_multiplayer) {
    *offsets_->is_multiplayer = is_multiplayer ? 1 : 0;
  }
  void set_game_created(bool is_created) {
    *offsets_->is_game_created = is_created ? 1 : 0;
  }
  bool AddComputer(int slot_num) {
    return offsets_->AddComputer(slot_num) == 1;
  }
  void ProcessLobbyTurns(int num_turns = 1) {
    // Probably need to either sleep or fuck with the last_tick_count at 66FF48
    // Or we could call in lower into the function
    for(int i = 0; i < num_turns; i++) {
      Sleep(260); // ensure that we actually process a turn! See above.
      offsets_->ProcessLobbyTurn(0);
    }
  }
  bool StartGame() {
    return offsets_->StartGame() == 1;
  }
  void BeginGameplay() {
    // #StartGame() simply requests that the game start in the lobby (initiates countdown)
    // This function actually runs the gameplay (both are badly named, TODO(tec27): fix names)
    offsets_->BeginGameplay();
  }
private:
  void ApplyPatches(void);
  void GetMapsList(const MapListEntryCallback callback);
  void SelectMapOrDirectory(const std::string& game_name, const std::string& password,
      int game_type, BroodWarSpeed::Enum game_speed, MapListEntry* map_data);

  Offsets* offsets_;
};

}
#endif // SHIELDBATTERY_BROODWAR_H_