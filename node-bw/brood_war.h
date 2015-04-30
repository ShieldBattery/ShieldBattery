#ifndef NODE_BW_BROOD_WAR_H_
#define NODE_BW_BROOD_WAR_H_

#include <assert.h>
#include <Windows.h>
#include <string>
#include "common/func_hook.h"
#include "common/types.h"

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

struct JoinableGameInfo {
  uint32 index;
  char game_name[24];
  // the rest of this is a parsed stat string, see http://www.bnetdocs.org/?op=doc&did=13
  uint32 save_game_checksum;
  uint16 map_width;
  uint16 map_height;
  byte is_not_eight_player;
  byte player_count;  // only matters if the preceding byte is not set
  byte game_speed;
  byte approval;
  uint32 game_type;
  uint32 cdkey_checksum;
  uint16 tileset;
  uint16 is_replay;
  char game_creator[25];
  char map_name[32];
  byte unk1[31];
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

enum class BootReason {
  Booted = 0,
  Banned,
  ClosedAllAvailableSlots,
  HostHasLeft,
  UnableToJoin,
  SaveGameFileNotFound,
  UnableToWriteScenario,
  DifferentVersion,
  SpawnProblem,
  CantAuthenticateMap
};

enum class GameState {
  Intro = 0,
  Initializing,
  Exit,
  Ingame,
  MenuOrLobby,
  Restart,
  Win,
  Loss,
  Credits,
  Epilog,
  Cinematic
};

enum class ChatMessageType : byte {
  Unknown0 = 0,
  Unknown1,
  All,
  Allies,
  Person
};

#pragma pack(1)
struct LobbyGameInitData {
  byte game_init_command;
  uint32 random_seed;
  byte player_bytes[8];
};
#pragma pack()

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
  FUNCDEF(uint32, ProcessLobbyTurn, void* unused);
  FUNCDEF(uint32, JoinGame);
  FUNCDEF(void, ShowLobbyChatMessage, char* message);
  FUNCDEF(uint32, LobbySendRaceChange, uint32 slot);
  FUNCDEF(void, SendMultiplayerChatMessage);
  FUNCDEF(uint32, CheckForMultiplayerChatCommand, char* message);
  FUNCDEF(void, DisplayMessage);
  FUNCDEF(void, CleanUpForExit);
};
#undef FUNCDEF

struct Detours {
  Detour* OnLobbyDownloadStatus;
  Detour* OnLobbySlotChange;
  Detour* OnLobbyStartCountdown;
  Detour* OnLobbyGameInit;
  Detour* OnLobbyMissionBriefing;
  Detour* OnMenuErrorDialog;
  Detour* InitializeSnpList;
  Detour* RenderDuringInitSpritesOne;
  Detour* RenderDuringInitSpritesTwo;
  Detour* GameLoop;
};

struct FuncHooks {
  FuncHook<Functions::ShowLobbyChatMessageFunc>* LobbyChatShowMessage;
  FuncHook<Functions::CheckForMultiplayerChatCommandFunc>* CheckForMultiplayerChatCommand;
};

struct EventHandlers {
  void (*OnLobbyDownloadStatus)(byte slot, byte download_percent);
  void (*OnLobbySlotChange)(byte slot, byte storm_id, byte type, byte race, byte team);
  void (*OnLobbyStartCountdown)();
  void (*OnLobbyGameInit)(uint32 random_seed, byte player_bytes[8]);
  void (*OnLobbyMissionBriefing)(byte slot);
  void (*OnLobbyChatMessage)(byte slot, const std::string& message);
  void (*OnMenuErrorDialog)(const std::string& message);
  void (*OnGameLoopIteration)();
  void (*OnCheckForChatCommand)(const std::string& message, ChatMessageType message_type,
      byte recipients);
};

struct Offsets {
  PlayerInfo* players;
  char* current_map_path;
  char* current_map_name;
  char* current_map_folder_path;
  uint32* local_player_id0;
  uint32* local_player_id1;
  uint32* local_lobby_id;
  char* local_player_name;
  uint32* current_game_speed;
  uint8* is_brood_war;
  uint8* is_multiplayer;
  uint8* is_hosting_game;
  MapListEntry* maps_list_root;
  uint32* was_booted;
  int32* boot_reason;
  uint32* lobby_dirty_flag;
  uint32* game_info_dirty_flag;
  uint16* game_state;
  byte* chat_message_recipients;
  byte* chat_message_type;

  Functions functions;
  Detours detours;
  FuncHooks func_hooks;

  byte* start_from_any_glue_patch;
  uint32* game_countdown_delay_patch;
};

enum class Version {
  v1161
};

template <Version version>
Offsets* GetOffsets();

class BroodWar {
  typedef void (__stdcall *MapListEntryCallback)(MapListEntry* map_data, char* map_name,
      uint32 file_type);

public:
  static BroodWar* Get();
  ~BroodWar();

  void set_event_handlers(const EventHandlers& handlers);

  bool CreateGame(const std::string& game_name, const std::string& password,
      const std::string& map_path, const uint32 game_type, const GameSpeed game_speed);
  bool JoinGame(const JoinableGameInfo& game_info);

  PlayerInfo* players() const;
  std::string current_map_path() const;
  std::string current_map_name() const;
  std::string current_map_folder_path() const;
  uint32 local_player_id() const;
  uint32 local_lobby_id() const;
  std::string local_player_name() const;
  void set_local_player_name(const std::string& name);
  GameSpeed current_game_speed() const;
  bool is_brood_war() const;
  void set_is_brood_war(bool is_brood_war);
  bool is_multiplayer() const;
  void set_is_multiplayer(bool is_multiplayer);
  bool is_hosting_game() const;
  bool was_booted() const;
  BootReason boot_reason() const;
  bool lobby_dirty_flag() const;
  void set_lobby_dirty_flag(bool dirty);
  GameState game_state() const;
  void set_game_state(GameState state);
  inline byte chat_message_recipients() const {
    return *offsets_->chat_message_recipients;
  }
  inline void set_chat_message_recipients(byte recipients) {
    *offsets_->chat_message_recipients = recipients;
  }
  inline ChatMessageType chat_message_type() const {
    return static_cast<ChatMessageType>(*offsets_->chat_message_type);
  }
  inline void set_chat_message_type(ChatMessageType type) {
    *offsets_->chat_message_type = static_cast<byte>(type);
  }

  void InitSprites();
  void InitPlayerInfo();
  bool ChooseNetworkProvider(uint32 provider = 'SBAT');
  void InitGameNetwork();
  bool AddComputer(uint32 slot_num);
  bool SetRace(uint32 slot_num, uint32 race);
  uint32 ProcessLobbyTurn();
  bool StartGameCountdown();
  void RunGameLoop();
  void CleanUpForExit();

  // !!! The functions below should ONLY be called on the game loop thread !!!

  // recipients is a bitfield, 0th bit = send to first player, 1st = send to second, etc.
  // Only applies if type >= Person (Allies will result in recipients being set to something else)
  void SendMultiplayerChatMessage(const std::string& message, byte recipients,
      ChatMessageType type);
  void DisplayMessage(const std::string& message, uint32 timeout);

  // Detour hook functions
  static void __stdcall OnLobbyDownloadStatus(uint32 slot, uint32 download_percent);
  static void __stdcall OnLobbySlotChange(byte data[6]);
  static void __stdcall OnLobbyStartCountdown();
  static void __stdcall OnLobbyGameInit(LobbyGameInitData* data);
  static void __stdcall OnLobbyMissionBriefing(uint32 slot);
  static void __stdcall OnMenuErrorDialog(char* message);
  static void __stdcall OnInitializeSnpList(char* snp_directory);
  static void __stdcall OnGameLoopIteration();
  static void __stdcall NoOp() { }

  // FuncHooks
  static void __stdcall ShowLobbyChatHook(char* message);
  static uint32 __stdcall CheckForChatCommandHook(char* message);

private:
  BroodWar();
  explicit BroodWar(Offsets* broodWarOffsets);
  void ApplyPatches();
  void InjectDetours();
  void GetMapsList(const MapListEntryCallback callback);
  bool SelectMapOrDirectory(const std::string& game_name, const std::string& password,
      uint32 game_type, GameSpeed game_speed, MapListEntry* map_data);

  Offsets* offsets_;
  EventHandlers* event_handlers_;

  static BroodWar* instance_;
  // flag specifying whether a multiplayer chat message is triggered by us (so we know not to try
  // and pass it to other code to try to interpret as a command)
  static bool is_programmatic_chat_;
};

template <> inline
Offsets* GetOffsets<Version::v1161>() {
  Offsets* offsets = new Offsets;

  byte* storm_base = reinterpret_cast<byte*>(GetModuleHandle("storm.dll"));
  assert(storm_base != nullptr);

  offsets->players = reinterpret_cast<PlayerInfo*>(0x0057EEE0);
  offsets->current_map_path = reinterpret_cast<char*>(0x0057FD3C);
  offsets->current_map_name = reinterpret_cast<char*>(0x0057FE40);
  offsets->current_map_folder_path = reinterpret_cast<char*>(0x0059BB70);
  offsets->local_player_id0 = reinterpret_cast<uint32*>(0x00512684);
  offsets->local_player_id1 = reinterpret_cast<uint32*>(0x00512688);
  offsets->local_lobby_id = reinterpret_cast<uint32*>(0x0051268C);
  offsets->local_player_name = reinterpret_cast<char*>(0x0057EE9C);
  offsets->current_game_speed = reinterpret_cast<uint32*>(0x006CDFD4);
  offsets->is_brood_war = reinterpret_cast<uint8*>(0x0058F440);
  offsets->is_multiplayer = reinterpret_cast<uint8*>(0x0057F0B4);
  offsets->is_hosting_game = reinterpret_cast<uint8*>(0x00596888);
  offsets->maps_list_root = reinterpret_cast<MapListEntry*>(0x0051A278);
  offsets->was_booted = reinterpret_cast<uint32*>(0x005999E8);
  offsets->boot_reason = reinterpret_cast<int32*>(0x005999E0);
  offsets->lobby_dirty_flag = reinterpret_cast<uint32*>(0x005999D4);
  offsets->game_state = reinterpret_cast<uint16*>(0x00596904);
  offsets->chat_message_recipients = reinterpret_cast<byte*>(0x0057F1DA);
  offsets->chat_message_type = reinterpret_cast<byte*>(0x0068C144);

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
  offsets->functions.JoinGame =
      reinterpret_cast<Functions::JoinGameFunc>(0x004D3B50);
  offsets->functions.ShowLobbyChatMessage =
      reinterpret_cast<Functions::ShowLobbyChatMessageFunc>(0x004B91C0);
  offsets->functions.LobbySendRaceChange =
      reinterpret_cast<Functions::LobbySendRaceChangeFunc>(0x00452370);
  offsets->functions.SendMultiplayerChatMessage =
      reinterpret_cast<Functions::SendMultiplayerChatMessageFunc>(0x004F3280);
  offsets->functions.CheckForMultiplayerChatCommand =
      reinterpret_cast<Functions::CheckForMultiplayerChatCommandFunc>(0x0047F8F0);
  offsets->functions.DisplayMessage = reinterpret_cast<Functions::DisplayMessageFunc>(0x0048D0C0);
  offsets->functions.CleanUpForExit =
      reinterpret_cast<Functions::CleanUpForExitFunc>(0x004207B0);

  offsets->detours.OnLobbyDownloadStatus = new Detour(Detour::Builder()
      .At(0x004860BD).To(BroodWar::OnLobbyDownloadStatus)
      .WithArgument(RegisterArgument::Ecx).WithArgument(RegisterArgument::Eax)
      .RunningOriginalCodeBefore());
  offsets->detours.OnLobbySlotChange = new Detour(Detour::Builder()
      .At(0x0047148B).To(BroodWar::OnLobbySlotChange)
      .WithArgument(RegisterArgument::Esi)
      .RunningOriginalCodeAfter());
  offsets->detours.OnLobbyStartCountdown = new Detour(Detour::Builder()
      .At(0x0047208E).To(BroodWar::OnLobbyStartCountdown)
      .RunningOriginalCodeAfter());
  offsets->detours.OnLobbyGameInit = new Detour(Detour::Builder()
      .At(0x0047211D).To(BroodWar::OnLobbyGameInit)
      .WithArgument(RegisterArgument::Edx)
      .RunningOriginalCodeAfter());
  offsets->detours.OnLobbyMissionBriefing = new Detour(Detour::Builder()
      .At(0x00486462).To(BroodWar::OnLobbyMissionBriefing)
      .WithArgument(RegisterArgument::Eax)
      .RunningOriginalCodeBefore());
  offsets->detours.OnMenuErrorDialog = new Detour(Detour::Builder()
      .At(0x004BB0FF).To(BroodWar::OnMenuErrorDialog)
      .WithArgument(RegisterArgument::Edx)
      .RunningOriginalCodeAfter());
  offsets->detours.InitializeSnpList = new Detour(Detour::Builder()
      .At(storm_base + 0x0003DED9).To(BroodWar::OnInitializeSnpList)
      .WithArgument(RegisterArgument::Esi)
      .RunningOriginalCodeAfter());
  // Rendering during InitSprites is useless and wastes a bunch of time, so we no-op it
  offsets->detours.RenderDuringInitSpritesOne = new Detour(Detour::Builder()
      .At(0x0047AEB1).To(BroodWar::NoOp)
      .NotRunningOriginalCode());
  offsets->detours.RenderDuringInitSpritesTwo = new Detour(Detour::Builder()
      .At(0x0047AFB1).To(BroodWar::NoOp)
      .NotRunningOriginalCode());
  offsets->detours.GameLoop = new Detour(Detour::Builder()
      .At(0x004D98EC).To(BroodWar::OnGameLoopIteration)
      // The function call we're overwriting is a no-op (just a ret), so we can skip it
      .NotRunningOriginalCode());

  offsets->func_hooks.LobbyChatShowMessage = new FuncHook<Functions::ShowLobbyChatMessageFunc>(
      offsets->functions.ShowLobbyChatMessage, BroodWar::ShowLobbyChatHook);
  offsets->func_hooks.CheckForMultiplayerChatCommand =
      new FuncHook<Functions::CheckForMultiplayerChatCommandFunc>(
      offsets->functions.CheckForMultiplayerChatCommand, BroodWar::CheckForChatCommandHook);


  offsets->start_from_any_glue_patch = reinterpret_cast<byte*>(0x00487076);
  offsets->game_countdown_delay_patch = reinterpret_cast<uint32*>(0x004720C5);

  return offsets;
}
}  // namespace bw
}  // namespace sbat
#endif  // NODE_BW_BROOD_WAR_H_
