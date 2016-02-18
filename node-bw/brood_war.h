#pragma once

#include <assert.h>
#include <Windows.h>
#include <atomic>
#include <string>
#include "common/func_hook.h"
#include "common/types.h"

#define CURRENT_BROOD_WAR_VERSION sbat::bw::Version::v1161

namespace sbat {
namespace snp {
struct SNetSnpListEntry;
};

namespace bw {
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

#pragma pack(1)
struct GameTemplate {
  uint16 game_type;
  uint16 game_subtype;
  uint16 game_subtype_display;
  uint16 game_subtype_label;
  byte victory_condition;
  byte resource_type;
  byte use_standard_unit_stats;
  byte fog_of_war;
  byte starting_units;
  byte use_fixed_position;
  byte restriction_flags;
  byte allies_enabled;
  byte teams_enabled;
  byte cheats_enabled;
  byte tournament_mode;
  uint32 victory_condition_value;
  uint32 mineral_value;
  uint32 gas_value;
};

struct JoinableGameInfo {
  uint32 index;
  char game_name[24];
  // the rest of this is a parsed stat string, see http://www.bnetdocs.org/?op=doc&did=13
  uint32 save_game_checksum;
  uint16 map_width;
  uint16 map_height;
  byte active_player_count;
  byte max_player_count;  // only matters if the preceding byte is not set
  byte game_speed;
  byte approval;
  uint16 game_type;
  uint16 game_subtype;
  uint32 cdkey_checksum;
  uint16 tileset;
  uint16 is_replay;
  char game_creator[25];
  char map_name[32];
  GameTemplate game_template;
};

struct LobbyGameInitData {
  byte game_init_command;
  uint32 random_seed;
  byte player_bytes[8];
};

struct SEvent {
  uint32 flags;
  uint32 storm_id;
  byte* data;
  uint32 size;
};
#pragma pack()

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

enum class MapResult : uint32 {
  OK = 0,
  GenericError = 0x80000000,
  Invalid,                    // This scenario is intended for use with a StarCraft Expansion Set.
  WrongGameType,              // This map can only be played with the "Use Map Settings" game type.
  LadderBadAuth,              // You must select an authenticated ladder map to start a ladder game.
  AlreadyExists,              // A game by that name already exists!
  TooManyNames,               // Unable to create game because there are too many games already running on this network.
  BadParameters,              // An error occurred while trying to create the game.
  InvalidPlayerCount,         // The selected scenario is not valid.
  UnsupportedGameType,        // The selected map does not support the selected game type and options.
  MissingSaveGamePassword,    // You must enter a password to start a saved game.
  MissingReplayPassword,      // You must enter a password to start a replay.
  IsDirectory,                // (Changes the directory)
  NoHumanSlots,               // This map does not have a slot for a human participant.
  NoComputerSlots,            // You must have at least one computer opponent.
  InvalidLeagueMap,           // You must select an official league map to start a league game.
  GameTypeUnavailable,        // Unable to create game because the selected game type is currently unavailable.
  NotEnoughSlots,             // The selected map does not have enough player slots for the selected game type.
  LeagueMissingBroodwar,      // Brood War is required to play league games.
  LeagueBadAuth,              // You must select an authenticated ladder map to start a ladder game.

  // And some we invented:
  CustomError = 0x90000000,
  MapNotFound
};

// The win/loss/draw/etc. state that BW stores during and after a game
enum class PlayerVictoryState : byte {
  Default = 0,
  Dropped,
  Defeat,
  Victory,
  Unknown, // This means something, we're not quite sure what
  Draw
};

enum class PlayerLoseType : byte {
  UnknownChecksumMismatch = 1,
  UnknownDisconnect = 2,
};

// The result of a game (per player), converted from PlayerVictoryState and other data
enum class GameResult : uint32 {
  Playing = 0,
  Disconnected,
  Defeat,
  Victory
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
  FUNCDEF(MapResult, SelectMapOrDirectory, char* game_name, char* password, int game_type,
      int game_speed, char* map_folder_path);
  FUNCDEF(uint32, JoinGame);
  FUNCDEF(void, OnLobbyGameInit);
  FUNCDEF(void, SendMultiplayerChatMessage);
  FUNCDEF(uint32, CheckForMultiplayerChatCommand, char* message);
  FUNCDEF(void, DisplayMessage);
  FUNCDEF(void, CleanUpForExit);
  FUNCDEF(void, PollInput);
  FUNCDEF(BOOL, InitializeSnpList);
  FUNCDEF(BOOL, UnloadSnp, BOOL clear_list);
  FUNCDEF(BOOL, InitNetworkPlayerInfo, byte storm_id, uint16 flags, uint16 version_hi,
      uint16 version_lo);
  FUNCDEF(BOOL, InitMapFromPath, const char* map_path, DWORD* data_out, BOOL is_campaign);
  FUNCDEF(void, OnSNetPlayerJoined, SEvent* evt);
  FUNCDEF(BOOL, MaybeReceiveTurns);

  FUNCDEF(uint32, SErrGetLastError);
  FUNCDEF(BOOL, SNetReceiveMessage, uint32* storm_id, byte** data, size_t* data_len);
  FUNCDEF(BOOL, SNetReceiveTurn, uint32 start_player, uint32 total_players, byte** data_ptrs,
      uint32* data_lens, DWORD* player_statuses);
  FUNCDEF(BOOL, SNetSendMessage, uint32 storm_id, const byte* data, size_t data_len);
  FUNCDEF(BOOL, SNetSendTurn, const byte* data, size_t data_len);
  FUNCDEF(BOOL, SNetGetPlayerNames, char** names);
};
#undef FUNCDEF

struct Detours {
  Detour* RenderDuringInitSpritesOne;
  Detour* RenderDuringInitSpritesTwo;
  Detour* GameLoop;
};

struct FuncHooks {
  FuncHook<Functions::CheckForMultiplayerChatCommandFunc>* CheckForMultiplayerChatCommand;
  FuncHook<Functions::PollInputFunc>* PollInput;
  FuncHook<Functions::InitializeSnpListFunc>* InitializeSnpList;
  FuncHook<Functions::UnloadSnpFunc>* UnloadSnp;
  FuncHook<Functions::OnSNetPlayerJoinedFunc>* OnSNetPlayerJoined;
};

struct EventHandlers {
  void (*OnGameLoopIteration)();
  void (*OnCheckForChatCommand)(const std::string& message, ChatMessageType message_type,
      byte recipients);
  void(*OnNetPlayerJoin)(uint32 storm_id);
};

struct Offsets {
  PlayerInfo* players;
  char* current_map_path;
  char* current_map_name;
  char* current_map_folder_path;

  // Nation is the player that is being controlled. For example in Team Melee, several players are
  // controlling one "nation".
  uint32* local_nation_id;

  // The player slot that is being used by this player.
  uint32* local_human_id;

  // The storm id for the player. This is the id to use with storm function calls.
  uint32* local_storm_id;

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
  uint32* lobby_state;
  byte* chat_message_recipients;
  byte* chat_message_type;
  PlayerVictoryState* victory_state;
  PlayerLoseType* player_lose_type;
  bool* player_has_left;
  uint32* player_nation_ids;
  uint32* game_time;
  bool* storm_snp_list_initialized;
  sbat::snp::SNetSnpListEntry* storm_snp_list;

  Functions functions;
  Detours detours;
  FuncHooks func_hooks;

  byte* start_from_any_glue_patch;
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

  
  MapResult CreateGame(const std::string& game_name, const std::string& map_path,
      const uint32 game_type, const GameSpeed game_speed);
  bool JoinGame(const JoinableGameInfo& game_info, const std::string& map_path);

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
  uint32 lobby_state() const;
  void set_lobby_state(uint32 state);
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
  inline std::array<GameResult, 8> game_results() const {
    return game_results_;
  }
  inline uint32 game_time() const {
    return *offsets_->game_time * 42; // Convert to milliseconds, assumes fastest speed
  }

  void InitSprites();
  void InitPlayerInfo();
  bool ChooseNetworkProvider(uint32 provider = 'SBAT');
  void InitGameNetwork();
  void TickleLobbyNetwork();
  bool NetSendTurn(const byte* data, size_t data_len);
  bool NetSendMessage(uint32 storm_id, const byte* data, size_t data_len);
  bool NetGetPlayerNames(std::array<char*, 8>& names);
  void DoLobbyGameInit(uint32 seed, const std::array<byte, 8>& player_bytes);
  void RunGameLoop();
  void CleanUpForExit();
  uint32 GetLastStormError();

  // !!! The functions below should ONLY be called on the game loop thread !!!

  // recipients is a bitfield, 0th bit = send to first player, 1st = send to second, etc.
  // Only applies if type >= Person (Allies will result in recipients being set to something else)
  void SendMultiplayerChatMessage(const std::string& message, byte recipients,
      ChatMessageType type);
  void DisplayMessage(const std::string& message, uint32 timeout);
  void ConvertGameResults();

  // Detour hook functions
  static void __stdcall OnGameLoopIteration();
  static void __stdcall NoOp() { }

  // FuncHooks
  static uint32 __stdcall CheckForChatCommandHook(char* message);
  static void __stdcall PollInputHook();
  static BOOL __stdcall InitializeSnpListHook();
  static BOOL __stdcall UnloadSnpHook(BOOL clear_list);
  static void __stdcall OnSNetPlayerJoinedHook(SEvent* evt);

  // Static externally callable methods
  static void SetInputDisabled(bool disabled);

private:
  BroodWar();
  explicit BroodWar(Offsets* broodWarOffsets);
  void ApplyPatches();
  void InjectDetours();
  void GetMapsList(const MapListEntryCallback callback);
  MapResult SelectMapOrDirectory(const std::string& game_name, uint32 game_type,
      GameSpeed game_speed, MapListEntry* map_data);
  MapListEntry* FindMapWithPath(const std::string& map_path);

  Offsets* offsets_;
  EventHandlers* event_handlers_;
  std::array<GameResult, 8> game_results_;

  static BroodWar* instance_;
  // flag specifying whether a multiplayer chat message is triggered by us (so we know not to try
  // and pass it to other code to try to interpret as a command)
  static bool is_programmatic_chat_;
  // flag specifying whether or not we should ignore input/scrolling for the time being
  static std::atomic<bool> input_disabled_;
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
  offsets->local_nation_id = reinterpret_cast<uint32*>(0x00512684);
  offsets->local_human_id = reinterpret_cast<uint32*>(0x00512688);
  offsets->local_storm_id = reinterpret_cast<uint32*>(0x0051268C);
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
  offsets->lobby_state = reinterpret_cast<uint32*>(0x0066FBFA);
  offsets->chat_message_recipients = reinterpret_cast<byte*>(0x0057F1DA);
  offsets->chat_message_type = reinterpret_cast<byte*>(0x0068C144);
  offsets->victory_state = reinterpret_cast<PlayerVictoryState*>(0x0058D700);
  offsets->player_lose_type = reinterpret_cast<PlayerLoseType*>(0x00581D61);
  offsets->player_has_left = reinterpret_cast<bool*>(0x00581D62);
  offsets->player_nation_ids = reinterpret_cast<uint32*>(0x0057EEC0);
  offsets->game_time = reinterpret_cast<uint32*>(0x0057F23C);
  offsets->storm_snp_list_initialized = reinterpret_cast<bool*>(storm_base + 0x5E630);
  offsets->storm_snp_list = reinterpret_cast<sbat::snp::SNetSnpListEntry*>(storm_base + 0x5AD6C);

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
  offsets->functions.JoinGame =
      reinterpret_cast<Functions::JoinGameFunc>(0x004D3B50);
  offsets->functions.OnLobbyGameInit =
      reinterpret_cast<Functions::OnLobbyGameInitFunc>(0x0047211D);
  offsets->functions.SendMultiplayerChatMessage =
      reinterpret_cast<Functions::SendMultiplayerChatMessageFunc>(0x004F3280);
  offsets->functions.CheckForMultiplayerChatCommand =
      reinterpret_cast<Functions::CheckForMultiplayerChatCommandFunc>(0x0047F8F0);
  offsets->functions.DisplayMessage = reinterpret_cast<Functions::DisplayMessageFunc>(0x0048D0C0);
  offsets->functions.CleanUpForExit =
      reinterpret_cast<Functions::CleanUpForExitFunc>(0x004207B0);
  offsets->functions.PollInput = reinterpret_cast<Functions::PollInputFunc>(0x0047F0E0);
  offsets->functions.InitNetworkPlayerInfo =
      reinterpret_cast<Functions::InitNetworkPlayerInfoFunc>(0x00470D10);
  offsets->functions.InitMapFromPath =
      reinterpret_cast<Functions::InitMapFromPathFunc>(0x004BF5D0);
  offsets->functions.OnSNetPlayerJoined =
      reinterpret_cast<Functions::OnSNetPlayerJoinedFunc>(0x004C4980);
  offsets->functions.MaybeReceiveTurns =
      reinterpret_cast<Functions::MaybeReceiveTurnsFunc>(0x00486580);
  offsets->functions.InitializeSnpList =
      reinterpret_cast<Functions::InitializeSnpListFunc>(storm_base + 0x0003DE90);
  offsets->functions.UnloadSnp =
      reinterpret_cast<Functions::UnloadSnpFunc>(storm_base + 0x000380A0);
  offsets->functions.SErrGetLastError = reinterpret_cast<Functions::SErrGetLastErrorFunc>(
      GetProcAddress(reinterpret_cast<HMODULE>(storm_base), MAKEINTRESOURCE(463)));
  offsets->functions.SNetReceiveMessage = reinterpret_cast<Functions::SNetReceiveMessageFunc>(
      GetProcAddress(reinterpret_cast<HMODULE>(storm_base), MAKEINTRESOURCE(121)));
  offsets->functions.SNetReceiveTurn = reinterpret_cast<Functions::SNetReceiveTurnFunc>(
      GetProcAddress(reinterpret_cast<HMODULE>(storm_base), MAKEINTRESOURCE(122)));
  offsets->functions.SNetSendMessage = reinterpret_cast<Functions::SNetSendMessageFunc>(
      GetProcAddress(reinterpret_cast<HMODULE>(storm_base), MAKEINTRESOURCE(127)));
  offsets->functions.SNetSendTurn = reinterpret_cast<Functions::SNetSendTurnFunc>(
      GetProcAddress(reinterpret_cast<HMODULE>(storm_base), MAKEINTRESOURCE(128)));
  offsets->functions.SNetGetPlayerNames = reinterpret_cast<Functions::SNetGetPlayerNamesFunc>(
      GetProcAddress(reinterpret_cast<HMODULE>(storm_base), MAKEINTRESOURCE(144)));

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

  offsets->func_hooks.CheckForMultiplayerChatCommand =
      new FuncHook<Functions::CheckForMultiplayerChatCommandFunc>(
      offsets->functions.CheckForMultiplayerChatCommand, BroodWar::CheckForChatCommandHook);
  offsets->func_hooks.PollInput = new FuncHook<Functions::PollInputFunc>(
      offsets->functions.PollInput, BroodWar::PollInputHook);
  offsets->func_hooks.InitializeSnpList = new FuncHook<Functions::InitializeSnpListFunc>(
      offsets->functions.InitializeSnpList, BroodWar::InitializeSnpListHook);
  offsets->func_hooks.UnloadSnp = new FuncHook<Functions::UnloadSnpFunc>(
      offsets->functions.UnloadSnp, BroodWar::UnloadSnpHook);
  offsets->func_hooks.OnSNetPlayerJoined = new FuncHook<Functions::OnSNetPlayerJoinedFunc>(
    offsets->functions.OnSNetPlayerJoined, BroodWar::OnSNetPlayerJoinedHook);

  offsets->start_from_any_glue_patch = reinterpret_cast<byte*>(0x00487076);

  return offsets;
}
}  // namespace bw
}  // namespace sbat
