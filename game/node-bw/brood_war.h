#pragma once

#include <assert.h>
#include <Windows.h>
#include <atomic>
#include <string>
#include "common/func_hook.h"
#include "common/types.h"
#include "observing_patches.h"

#define CURRENT_BROOD_WAR_VERSION sbat::bw::Version::v1161

namespace sbat {
namespace snp {
struct SNetSnpListEntry;
};

namespace bw {
#pragma pack(1)
struct PlayerInfo {
  uint32 player_id;
  uint32 storm_id;
  uint8 type;
  uint8 race;
  uint8 team;
  char name[25];
};

struct StormPlayerInfo {
  uint8 state;
  uint8 unk1;
  uint16 flags;
  uint16 unk4;
  // Always 5, not useful for us
  uint16 protocol_version;
  char name[0x19];
  uint8 padding;
};
static_assert(sizeof(StormPlayerInfo) == 0x22, "sizeof StormPlayerInfo");

struct MapListEntry {
  MapListEntry* prev;
  MapListEntry* next;
  char filename[32];
};

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
  byte num_teams;
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

struct Dialog;
struct Control {
  Control* next;
  uint16 area[0x4];
  byte whatever8[0x8];
  const char* label;
  uint32 flags;
  byte whatever1c[0x4];
  uint16 id;
  byte whatever22[0x10];
  Dialog* parent;
};

static_assert(sizeof(Control) == 0x36, "sizeof Control");

struct UiEvent {
  uint32 extended_type;
  uint32 extended_param;
  uint32 value;
  uint16 type;
  uint16 x;
  uint16 y;
};

struct Dialog {
  Control base;
  byte whatever36[0xc];
  Control* first_child;
};

struct Unit {
  byte whatever[0x4c];
  byte player;
};

// Feel free to add the fields if they are ever needed.
struct ReplayData;
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
  FUNCDEF(uint8, UpdateNationAndHumanIds);
  FUNCDEF(void, SendMultiplayerChatMessage);
  FUNCDEF(uint32, CheckForMultiplayerChatCommand, char* message);
  FUNCDEF(void, DisplayMessage);
  FUNCDEF(void, AddToReplayData);
  FUNCDEF(void, CleanUpForExit);
  FUNCDEF(BOOL, InitNetworkPlayerInfo, byte storm_id, uint16 flags, uint16 version_hi,
      uint16 version_lo);
  FUNCDEF(BOOL, InitMapFromPath, const char* map_path, DWORD* data_out, BOOL is_campaign);
  FUNCDEF(void, InitTeamGamePlayableSlots);
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
  FuncHook<uint32(char* message)> CheckForMultiplayerChatCommand;
  FuncHook<void()> PollInput;
  FuncHook<BOOL()> InitializeSnpList;
  FuncHook<BOOL(BOOL clear_list)> UnloadSnp;
  FuncHook<void(SEvent* evt)> OnSNetPlayerJoined;
  FuncHook<void(Control *ctrl)> MinimapCtrl_InitButton;
  FuncHook<void()> MinimapCtrl_ShowAllianceDialog;
  FuncHook<void()> DrawMinimap;
  FuncHook<void()> Minimap_TimerRefresh;
  FuncHook<void()> RedrawScreen;
  FuncHook<void(Control *ctrl, void *event)> AllianceDialog_EventHandler;
  FuncHook<void(void *event)> GameScreenLeftClick;
  FuncHook<void(int sound, uint32 xy, int actually_play_something, int min_volume)> PlaySoundAtPos;
  FuncHook<void(void *data, int len, int replay)> ProcessCommands;
  FuncHook<int(void *data)> Command_Sync;
  FuncHook<int(int net_player, const char *message, int length)> ChatMessage;
  FuncHook<void(Dialog *dialog, void *base, void *event_handler, const char *source_file,
      int source_line)> LoadDialog;
  FuncHook<void()> InitUiVariables;
  FuncHook<void()> DrawStatusScreen;
  FuncHook<void()> UpdateCommandCard;
  FuncHook<int(Control*, UiEvent*)> CmdBtn_EventHandler;
  FuncHook<void(Control*, int, int, void*)> DrawCommandButton;
  FuncHook<void(Control*, void*)> DrawResourceCounts;
};

struct EventHandlers {
  void (*OnGameLoopIteration)();
  void (*OnCheckForChatCommand)(const std::string& message, ChatMessageType message_type,
      byte recipients);
  void(*OnNetPlayerJoin)(uint32 storm_id);
  void(*OnReplaySave)(const std::wstring& replay_path);
};

struct Offsets {
  PlayerInfo* players;
  StormPlayerInfo* storm_players;
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

  uint32* storm_id_to_human_id;

  char* local_player_name;
  uint32* current_game_speed;
  uint8* is_brood_war;
  uint8* is_multiplayer;
  uint32* is_replay;
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
  uint32* current_command_player;
  ReplayData** replay_data;
  uint32* replay_visions;
  uint32* player_visions;
  // Ingame player id or 8 for all or 9 for allies
  uint8* chat_dialog_recipent;
  Unit** primary_selected;

  bool* storm_snp_list_initialized;
  sbat::snp::SNetSnpListEntry* storm_snp_list;

  Functions functions;
  Detours detours;
  FuncHooks func_hooks;
};

enum class Version {
  v1161
};

template <Version version>
Offsets* GetOffsets();

class BroodWar {
  friend struct ObservingPatches;
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
  void DoLobbyGameInit(uint32 seed, const std::vector<byte>& storm_ids_to_init,
      const std::array<byte, 8>& player_bytes);
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

  // Adds a command (such as a chat message) to replay data.
  void AddToReplayData(int player, void *command, int command_length);

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
  void InjectDetours();
  void GetMapsList(const MapListEntryCallback callback);
  MapResult SelectMapOrDirectory(const std::string& game_name, uint32 game_type,
      GameSpeed game_speed, MapListEntry* map_data);
  MapListEntry* FindMapWithPath(const std::string& map_path);
  void DoUpdateNationAndHumanIds();

  // hooks
  static HANDLE __stdcall CreateFileAHook(LPCSTR lpFileName, DWORD dwDesiredAccess,
      DWORD dwShareMode, LPSECURITY_ATTRIBUTES lpSecurityAttributes, DWORD dwCreationDisposition,
      DWORD dwFlagsAndAttributes, HANDLE hTemplateFile);
  static BOOL __stdcall CloseHandleHook(HANDLE hObject);
  static BOOL __stdcall DeleteFileAHook(LPCSTR lpFileName);

  Offsets* offsets_;
  HookedModule process_hooks_;
  EventHandlers* event_handlers_;
  std::array<GameResult, 8> game_results_;
  HANDLE last_replay_handle_;
  std::wstring replay_path_;

  static BroodWar* instance_;
  // flag specifying whether a multiplayer chat message is triggered by us (so we know not to try
  // and pass it to other code to try to interpret as a command)
  static bool is_programmatic_chat_;
  // flag specifying whether or not we should ignore input/scrolling for the time being
  static std::atomic<bool> input_disabled_;
};

template <> inline
Offsets* GetOffsets<Version::v1161>() {
  using namespace sbat::hook_registers;
  Offsets* offsets = new Offsets;

  uintptr_t storm_base = reinterpret_cast<uintptr_t>(GetModuleHandle("storm.dll"));
  assert(storm_base != 0);

  offsets->players = reinterpret_cast<PlayerInfo*>(0x0057EEE0);
  offsets->storm_players = reinterpret_cast<StormPlayerInfo*>(0x0066FE20);
  offsets->current_map_path = reinterpret_cast<char*>(0x0057FD3C);
  offsets->current_map_name = reinterpret_cast<char*>(0x0057FE40);
  offsets->current_map_folder_path = reinterpret_cast<char*>(0x0059BB70);
  offsets->local_nation_id = reinterpret_cast<uint32*>(0x00512684);
  offsets->local_human_id = reinterpret_cast<uint32*>(0x00512688);
  offsets->local_storm_id = reinterpret_cast<uint32*>(0x0051268C);
  offsets->storm_id_to_human_id = reinterpret_cast<uint32*>(0x0057EE7C);
  offsets->local_player_name = reinterpret_cast<char*>(0x0057EE9C);
  offsets->current_game_speed = reinterpret_cast<uint32*>(0x006CDFD4);
  offsets->is_brood_war = reinterpret_cast<uint8*>(0x0058F440);
  offsets->is_multiplayer = reinterpret_cast<uint8*>(0x0057F0B4);
  offsets->is_replay = reinterpret_cast<uint32*>(0x006D0F14);
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
  offsets->current_command_player = reinterpret_cast<uint32*>(0x00512678);
  offsets->replay_data = reinterpret_cast<ReplayData**>(0x00596BBC);
  offsets->replay_visions = reinterpret_cast<uint32*>(0x006D0F18);
  offsets->player_visions = reinterpret_cast<uint32*>(0x0057F0B0);
  offsets->chat_dialog_recipent = reinterpret_cast<uint8*>(0x00581D60);
  offsets->primary_selected = reinterpret_cast<Unit**>(0x00597248);
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
  offsets->functions.UpdateNationAndHumanIds =
      reinterpret_cast<Functions::UpdateNationAndHumanIdsFunc>(0x004A8D40);
  offsets->functions.SendMultiplayerChatMessage =
      reinterpret_cast<Functions::SendMultiplayerChatMessageFunc>(0x004F3280);
  offsets->functions.DisplayMessage = reinterpret_cast<Functions::DisplayMessageFunc>(0x0048D0C0);
  offsets->functions.AddToReplayData =
      reinterpret_cast<Functions::AddToReplayDataFunc>(0x004CDE70);
  offsets->functions.CleanUpForExit =
      reinterpret_cast<Functions::CleanUpForExitFunc>(0x004207B0);
  offsets->functions.InitNetworkPlayerInfo =
      reinterpret_cast<Functions::InitNetworkPlayerInfoFunc>(0x00470D10);
  offsets->functions.InitMapFromPath =
      reinterpret_cast<Functions::InitMapFromPathFunc>(0x004BF5D0);
  offsets->functions.InitTeamGamePlayableSlots =
      reinterpret_cast<Functions::InitTeamGamePlayableSlotsFunc>(0x00470150);
  offsets->functions.MaybeReceiveTurns =
      reinterpret_cast<Functions::MaybeReceiveTurnsFunc>(0x00486580);
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

  offsets->func_hooks.CheckForMultiplayerChatCommand.InitStdcall(
      0x0047F8F0, BroodWar::CheckForChatCommandHook);
  offsets->func_hooks.PollInput.InitStdcall(
      0x0047F0E0, BroodWar::PollInputHook);
  offsets->func_hooks.InitializeSnpList.InitStdcall(
      storm_base + 0x0003DE90, BroodWar::InitializeSnpListHook);
  offsets->func_hooks.UnloadSnp.InitStdcall(
      storm_base + 0x000380A0, BroodWar::UnloadSnpHook);
  offsets->func_hooks.OnSNetPlayerJoined.InitStdcall(
      0x004C4980, BroodWar::OnSNetPlayerJoinedHook);

  offsets->func_hooks.MinimapCtrl_InitButton.InitCustom<Eax>(
      0x004A5230, ObservingPatches::MinimapCtrl_InitButtonHook);
  offsets->func_hooks.MinimapCtrl_ShowAllianceDialog.InitStdcall(
      0x004913D0, ObservingPatches::MinimapCtrl_ShowAllianceDialogHook);
  offsets->func_hooks.DrawMinimap.InitStdcall(
      0x004A5200, ObservingPatches::DrawMinimapHook);
  offsets->func_hooks.Minimap_TimerRefresh.InitStdcall(
      0x004A4E00, ObservingPatches::Minimap_TimerRefreshHook);
  offsets->func_hooks.RedrawScreen.InitStdcall(
      0x0041CA00, ObservingPatches::RedrawScreenHook);
  offsets->func_hooks.AllianceDialog_EventHandler.InitCustom<Ecx, Edx>(
      0x00491310 , ObservingPatches::AllianceDialog_EventHook);
  offsets->func_hooks.GameScreenLeftClick.InitCustom<Ecx>(
      0x0046FEA0, ObservingPatches::GameScreenLeftClickHook);
  offsets->func_hooks.PlaySoundAtPos.InitCustom<Ebx, Stack, Stack, Stack>(
      0x0048EC10, ObservingPatches::PlaySoundAtPosHook);
  offsets->func_hooks.ProcessCommands.InitCustom<Eax, Stack, Stack>(
      0x004865D0, ObservingPatches::ProcessCommandsHook);
  offsets->func_hooks.Command_Sync.InitCustom<Edi>(
      0x0047CDD0, ObservingPatches::Command_SyncHook);
  offsets->func_hooks.ChatMessage.InitCustom<Ecx, Edx, Stack>(
      0x00485F50, ObservingPatches::ChatMessageHook);
  offsets->func_hooks.LoadDialog.InitCustom<Eax, Ebx, Stack, Stack, Stack>(
      0x004194E0, ObservingPatches::LoadDialogHook);
  offsets->func_hooks.InitUiVariables.InitStdcall(
      0x004EE180, ObservingPatches::InitUiVariablesHook);
  offsets->func_hooks.DrawStatusScreen.InitStdcall(
      0x00458120, ObservingPatches::DrawStatusScreenHook);
  offsets->func_hooks.UpdateCommandCard.InitStdcall(
      0x004591D0, ObservingPatches::UpdateCommandCardHook);
  offsets->func_hooks.CmdBtn_EventHandler.InitCustom<Ecx, Edx>(
      0x004598D0, ObservingPatches::CmdBtn_EventHandlerHook);
  offsets->func_hooks.DrawCommandButton.InitCustom<Ecx, Edx, Stack, Stack>(
      0x00458900, ObservingPatches::DrawCommandButtonHook);
  offsets->func_hooks.DrawResourceCounts.InitCustom<Ecx, Edx>(
      0x004E5640, ObservingPatches::DrawResourceCountsHook);

  return offsets;
}
}  // namespace bw
}  // namespace sbat
