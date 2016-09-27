#include "./brood_war.h"

#include <Windows.h>
#include <algorithm>
#include <atomic>
#include <cassert>
#include <ctime>
#include <iomanip>
#include <string>
#include <Shlobj.h>
#include "common/types.h"
#include "common/win_helpers.h"
#include "snp/snp.h"

namespace sbat {
namespace bw {
using sbat::snp::SNetSnpListEntry;
using std::atomic;
using std::localtime;
using std::max;
using std::string;
using std::time;
using std::to_wstring;
using std::wcsftime;
using std::wcstombs;
using std::wstring;

BroodWar* BroodWar::instance_ = nullptr;
bool BroodWar::is_programmatic_chat_ = false;
atomic<bool> BroodWar::input_disabled_(false);

BroodWar* BroodWar::Get() {
  if (instance_ == nullptr) {
    instance_ = new BroodWar();
  }

  return instance_;
}

BroodWar::BroodWar(): BroodWar(GetOffsets<CURRENT_BROOD_WAR_VERSION>()) {
}

BroodWar::BroodWar(Offsets* broodWarOffsets)
    : offsets_(broodWarOffsets),
      process_hooks_(GetModuleHandle(NULL)),
      event_handlers_(nullptr),
      game_results_(),
      last_replay_handle_(INVALID_HANDLE_VALUE),
      replay_path_() {
  InjectDetours();

  process_hooks_.AddHook("kernel32.dll", "CloseHandle", CloseHandleHook);
  process_hooks_.AddHook("kernel32.dll", "CreateFileA", CreateFileAHook);
  process_hooks_.AddHook("kernel32.dll", "DeleteFileA", DeleteFileAHook);
}

BroodWar::~BroodWar() {
  delete offsets_;
  offsets_ = nullptr;
  delete event_handlers_;
  event_handlers_ = nullptr;

  instance_ = nullptr;
}

void BroodWar::set_event_handlers(const EventHandlers& handlers) {
  delete event_handlers_;
  event_handlers_ = new EventHandlers(handlers);
}

#define HAVE_HANDLER_FOR(handler) \
    (instance_ != nullptr && instance_->event_handlers_ != nullptr && \
    instance_->event_handlers_->##handler != nullptr)
void __stdcall BroodWar::OnGameLoopIteration() {
  if (HAVE_HANDLER_FOR(OnGameLoopIteration)) {
    instance_->event_handlers_->OnGameLoopIteration();
  }
}

uint32 __stdcall BroodWar::CheckForChatCommandHook(char* message) {
  if (!is_programmatic_chat_ && HAVE_HANDLER_FOR(OnCheckForChatCommand)) {
    byte recipients = instance_->chat_message_recipients();
    ChatMessageType type = instance_->chat_message_type();
    instance_->event_handlers_->OnCheckForChatCommand(message, type, recipients);
    // We act like a command was always parsed in order to give the event handler time to deal with
    // it asynchronously. If a command was not actually parsed, it should re-send the message with
    // the programmatic flag set, so that we let it pass through
    return TRUE;
  }

  return FALSE;
}

void __stdcall BroodWar::OnSNetPlayerJoinedHook(SEvent* evt) {
  if (HAVE_HANDLER_FOR(OnNetPlayerJoin)) {
    instance_->event_handlers_->OnNetPlayerJoin(evt->storm_id);
  }
}
#undef HAVE_HANDLER_FOR


void __stdcall BroodWar::PollInputHook() {
  if (input_disabled_.load()) {
    return;
  }

  auto hook = instance_->offsets_->func_hooks.PollInput;
  hook->Restore();
  hook->callable()();
  hook->Inject();
}

BOOL __stdcall BroodWar::InitializeSnpListHook() {
  // Set up Storm's SNP list ourselves, so that we don't have to worry about having an MPQ file
  // appended to this one and don't have to worry about passing signature checks.

  if (!*instance_->offsets_->storm_snp_list_initialized) {
    *instance_->offsets_->storm_snp_list_initialized = TRUE;
    auto list = instance_->offsets_->storm_snp_list;
    auto entry = sbat::snp::GetSnpListEntry();
    // This will never actually be modified, but declaring it as const in the type is problematic
    list->prev = const_cast<SNetSnpListEntry*>(entry);
    list->next = const_cast<SNetSnpListEntry*>(entry);
  }
  return TRUE;
}

BOOL __stdcall BroodWar::UnloadSnpHook(BOOL clear_list) {
  // Never pass clear_list = true, as we initialized the list and Storm can't free the memory
  auto hook = instance_->offsets_->func_hooks.UnloadSnp;
  hook->Restore();
  BOOL result = hook->callable()(FALSE);
  hook->Inject();

  if (*instance_->offsets_->storm_snp_list_initialized) {
    *instance_->offsets_->storm_snp_list_initialized = FALSE;
    auto list = instance_->offsets_->storm_snp_list;
    list->next = 0;
    list->prev = 0;
  }

  return result;
}

void BroodWar::InjectDetours() {
  offsets_->detours.RenderDuringInitSpritesOne->Inject();
  offsets_->detours.RenderDuringInitSpritesTwo->Inject();
  offsets_->detours.GameLoop->Inject();

  offsets_->func_hooks.CheckForMultiplayerChatCommand->Inject();
  offsets_->func_hooks.PollInput->Inject();
  offsets_->func_hooks.InitializeSnpList->Inject();
  offsets_->func_hooks.UnloadSnp->Inject();
  offsets_->func_hooks.OnSNetPlayerJoined->Inject();

  process_hooks_.Inject();
}

bool EndsWith(const string checked, const string suffix) {
  if (suffix.length() > checked.length()) {
    return false;
  }

  int index = checked.rfind(suffix);
  return index != string::npos && (index + suffix.length() == checked.length());
}

HANDLE __stdcall BroodWar::CreateFileAHook(LPCSTR lpFileName, DWORD dwDesiredAccess,
    DWORD dwShareMode, LPSECURITY_ATTRIBUTES lpSecurityAttributes, DWORD dwCreationDisposition,
    DWORD dwFlagsAndAttributes, HANDLE hTemplateFile) {
  if (!EndsWith(lpFileName, "LastReplay.rep")) {
    return CreateFileA(lpFileName, dwDesiredAccess, dwShareMode, lpSecurityAttributes,
        dwCreationDisposition, dwFlagsAndAttributes, hTemplateFile);
  }

  assert(instance_->last_replay_handle_ == INVALID_HANDLE_VALUE);

  wchar_t* documents_path = { 0 };
  SHGetKnownFolderPath(FOLDERID_Documents, 0, NULL, &documents_path);
  wstring replay_folder = wstring(documents_path) + L"\\Starcraft\\maps\\replays\\Auto\\";
  CoTaskMemFree(static_cast<void*>(documents_path));
  // Create the replay folder if it doesn't exist
  SHCreateDirectoryExW(NULL, replay_folder.c_str(), NULL);

  int counter = 0;
  WIN32_FIND_DATAW replay_data;
  HANDLE replay_handle = FindFirstFileW((replay_folder + L"\\*.rep").c_str(), &replay_data);
  if (replay_handle != INVALID_HANDLE_VALUE) {
    do {
      wstring file_name = replay_data.cFileName;
      if (file_name.length() < 4) {
        continue;
      }
      if (iswdigit(file_name[0]) && iswdigit(file_name[1]) &&
          iswdigit(file_name[2]) && iswdigit(file_name[3])) {
        int result = stoi(file_name.substr(0, 4));
        counter = max(counter, result);
      }
    } while (FindNextFileW(replay_handle, &replay_data) != 0);
  }
  FindClose(replay_handle);

  counter++;
  wstring counter_string;
  if (counter < 10) {
    counter_string = L"000" + to_wstring(counter);
  } else if (counter < 100) {
    counter_string = L"00" + to_wstring(counter);
  } else if (counter < 1000) {
    counter_string = L"0" + to_wstring(counter);
  } else {
    counter_string = to_wstring(counter);
  }

  auto current_time = time(nullptr);
  wchar_t formatted_date[MAX_PATH];
  size_t size = wcsftime(formatted_date, MAX_PATH, L"%Y-%m-%d", localtime(&current_time));
  if (size == 0) {
    return INVALID_HANDLE_VALUE;
  }
  instance_->replay_path_ = replay_folder + counter_string + L"_" + formatted_date + L".rep";

  instance_->last_replay_handle_ = CreateFileW(instance_->replay_path_.c_str(),
      dwDesiredAccess, dwShareMode, lpSecurityAttributes, dwCreationDisposition,
      dwFlagsAndAttributes, hTemplateFile);
  return instance_->last_replay_handle_;
}

BOOL __stdcall BroodWar::DeleteFileAHook(LPCSTR lpFileName) {
  if (EndsWith(lpFileName, "LastReplay.rep")) {
    // Before saving the last replay BW first tries to delete it, which can fail. We no-op it since
    // we're saving the last replay ourselves.
    return true;
  }

  return DeleteFileA(lpFileName);
}

BOOL __stdcall BroodWar::CloseHandleHook(HANDLE hObject) {
  BOOL result = CloseHandle(hObject);
  if (instance_->last_replay_handle_ != INVALID_HANDLE_VALUE &&
      hObject == instance_->last_replay_handle_) {
    if (instance_->event_handlers_ != nullptr &&
        instance_->event_handlers_->OnReplaySave != nullptr) {
      instance_->event_handlers_->OnReplaySave(instance_->replay_path_);
    }
    instance_->last_replay_handle_ = INVALID_HANDLE_VALUE;
    instance_->replay_path_.clear();
  }

  return result;
}

PlayerInfo* BroodWar::players() const {
  return offsets_->players;
}

std::string BroodWar::current_map_path() const {
  return std::string(offsets_->current_map_path);
}

std::string BroodWar::current_map_name() const {
  return std::string(offsets_->current_map_name);
}

std::string BroodWar::current_map_folder_path() const {
  return std::string(offsets_->current_map_folder_path);
}

uint32 BroodWar::local_player_id() const {
  return *offsets_->local_human_id;
}

uint32 BroodWar::local_lobby_id() const {
  return *offsets_->local_storm_id;
}

std::string BroodWar::local_player_name() const {
  return std::string(offsets_->local_player_name);
}

void BroodWar::set_local_player_name(const std::string& name) {
  strncpy_s(offsets_->local_player_name, 25, name.c_str(), _TRUNCATE);
}

GameSpeed BroodWar::current_game_speed() const {
  return static_cast<GameSpeed>(*offsets_->current_game_speed);
}

bool BroodWar::is_brood_war() const {
  return *offsets_->is_brood_war == 1;
}

void BroodWar::set_is_brood_war(bool is_brood_war) {
  *offsets_->is_brood_war = is_brood_war ? 1 : 0;
}

bool BroodWar::is_multiplayer() const {
  return *offsets_->is_multiplayer == 1;
}

void BroodWar::set_is_multiplayer(bool is_multiplayer) {
  *offsets_->is_multiplayer = is_multiplayer ? 1 : 0;
}

bool BroodWar::is_hosting_game() const {
  return *offsets_->is_hosting_game == 1;
}

bool BroodWar::was_booted() const {
  return *offsets_->was_booted == 1;
}

BootReason BroodWar::boot_reason() const {
  return static_cast<BootReason>(*offsets_->boot_reason);
}

bool BroodWar::lobby_dirty_flag() const {
  return *offsets_->lobby_dirty_flag == 1;
}

void BroodWar::set_lobby_dirty_flag(bool dirty) {
  *offsets_->lobby_dirty_flag = dirty ? 1 : 0;
}

GameState BroodWar::game_state() const {
  return static_cast<GameState>(*offsets_->game_state);
}

void BroodWar::set_game_state(GameState state) {
  *offsets_->game_state = static_cast<uint16>(state);
}

uint32 BroodWar::lobby_state() const {
  return *offsets_->lobby_state;
}

void BroodWar::set_lobby_state(uint32 state) {
  *offsets_->lobby_state = state;
}

void BroodWar::InitSprites() {
  offsets_->functions.InitSprites();
}

void BroodWar::InitPlayerInfo() {
  offsets_->functions.InitPlayerInfo();
}

bool BroodWar::ChooseNetworkProvider(uint32 provider) {
  auto choose_network = offsets_->functions.ChooseNetworkProvider;
  int result;
  _asm {
    push eax;
    push ebx;
    mov eax, choose_network;
    mov ebx, provider;
    call eax;
    mov result, eax;
    pop ebx;
    pop eax;
  }

  return result == 1;
}

void BroodWar::InitGameNetwork() {
  offsets_->functions.InitGameNetwork();
}

void BroodWar::TickleLobbyNetwork() {
  // Trigger Storm to deal with connecting clients and other such packets, but since we don't
  // actually use messages/turns for lobby initialization, ignore whatever it returns
  offsets_->functions.MaybeReceiveTurns();
}

bool BroodWar::NetSendMessage(uint32 storm_id, const byte* data, size_t data_len) {
  return offsets_->functions.SNetSendMessage(storm_id, data, data_len) == TRUE;
}

bool BroodWar::NetSendTurn(const byte* data, size_t data_len) {
  return offsets_->functions.SNetSendTurn(data, data_len) == TRUE;
}

bool BroodWar::NetGetPlayerNames(std::array<char*, 8>& names) {
  return offsets_->functions.SNetGetPlayerNames(&names[0]) == TRUE;
}

void BroodWar::DoLobbyGameInit(uint32 seed, const std::array<byte, 8>& player_bytes) {
  for (int i = 0; i < 8; i++) {
    if (players()[i].storm_id < 8) {
      offsets_->functions.InitNetworkPlayerInfo(static_cast<byte>(players()[i].storm_id), 0, 1, 5);
    }
  }

  DoUpdateNationAndHumanIds();

  set_lobby_state(8);
  LobbyGameInitData data;
  data.game_init_command = 0x48;
  data.random_seed = seed;
  std::copy(std::begin(player_bytes), std::end(player_bytes), std::begin(data.player_bytes));
  const LobbyGameInitData* data_ptr = &data;

  auto func = offsets_->functions.OnLobbyGameInit;
  _asm {
    push eax;
    push edx;
    push ecx;
    xor eax, eax; // storm_id
    mov edx, data_ptr; // data
    mov ecx, func;
    call ecx;
    pop ecx;
    pop edx;
    pop eax;
  }

  set_lobby_state(9);
  set_game_state(GameState::Initializing);
}

void BroodWar::DoUpdateNationAndHumanIds() {
  auto func = offsets_->functions.UpdateNationAndHumanIds;
  uint32 storm_id = *offsets_->local_storm_id;
  _asm {
    push esi;
    push ecx;
    mov esi, storm_id;
    mov ecx, func;
    call ecx;
    pop ecx;
    pop esi;
  }
}

void BroodWar::RunGameLoop() {
  offsets_->functions.GameLoop();
}

void __stdcall DummyMapListEntryCallback(MapListEntry* map_data, char* map_name, uint32 file_type) {
}

void BroodWar::GetMapsList(const MapListEntryCallback callback) {
  // callback is passed in through eax because blizzard's compiler hates me
  auto get_list = offsets_->functions.GetMapsList;
  uint32 unk1 = 0x28;  // 0x10 can be used for a recent maps list instead
  char* base_path = offsets_->current_map_folder_path;
  char* last_map_name = "";
  _asm {
    push eax;
    push edx;
    push last_map_name;
    push base_path;
    push unk1;
    mov eax, callback;
    mov edx, get_list;
    call edx;
    pop edx;
    pop eax;
  }
}

MapResult BroodWar::SelectMapOrDirectory(const std::string& game_name, uint32 game_type,
      GameSpeed game_speed, MapListEntry* map_data) {
  auto select = offsets_->functions.SelectMapOrDirectory;

  const char* game_name_param = game_name.c_str();
  // password needs to be nullptr so replays can work
  const char* password_param = nullptr;
  const char* map_folder_path = offsets_->current_map_folder_path;
  MapResult result;

  __asm {
    push eax;
    push edx;
    push map_folder_path;
    push game_speed;
    push game_type;
    push password_param;
    push game_name_param;
    mov eax, map_data;
    mov edx, select;
    call edx;
    mov result, eax;
    pop edx;
    pop eax;
  }

  return result;
}

MapListEntry* BroodWar::FindMapWithPath(const std::string& map_path) {  
  std::string map_dir;
  std::string map_file;

  size_t slash_pos = map_path.find_last_of("\\/");
  if (slash_pos != std::string::npos) {
    map_dir.assign(map_path.begin(), map_path.begin() + slash_pos);
    map_file.assign(map_path.begin() + slash_pos + 1, map_path.end());
  } else {
    char buffer[MAX_PATH];
    GetCurrentDirectoryA(MAX_PATH, buffer);
    map_dir = buffer;
    map_file = map_path;
  }

  strcpy_s(offsets_->current_map_folder_path, MAX_PATH, map_dir.c_str());
  GetMapsList(DummyMapListEntryCallback);

  // iterate through the maps list until we find the map we want
  MapListEntry* current_map = offsets_->maps_list_root;
  while (reinterpret_cast<intptr_t>(current_map) > 0) {
    if (map_file.compare(current_map->filename) == 0) {
      break;
    }

    current_map = current_map->next;
  }

  return current_map;
}

MapResult BroodWar::CreateGame(const std::string& game_name, const std::string& map_path,
      const uint32 game_type, const GameSpeed game_speed) {
  MapListEntry* map = FindMapWithPath(map_path);
  if (map == nullptr) {
    // map could not be found, unable to create game
    return MapResult::MapNotFound;
  }

  return SelectMapOrDirectory(game_name, game_type, game_speed, map);
}

bool BroodWar::JoinGame(const JoinableGameInfo& game_info, const std::string& map_path) {
  auto join = offsets_->functions.JoinGame;
  const JoinableGameInfo* arg = &game_info;
  uint32 result;
  __asm {
    mov eax, join;
    mov ebx, arg;
    call eax;
    mov result, eax;
  }

  if (result != 1) {
    return false;
  }

  DWORD map_data[8];
  if (offsets_->functions.InitMapFromPath(map_path.c_str(), map_data, FALSE) != TRUE) {
    return false;
  }

  offsets_->functions.InitTeamGamePlayableSlots();
  return true;
}

void BroodWar::SendMultiplayerChatMessage(const std::string& message, byte recipients,
    ChatMessageType type) {
  byte backup_recipients = chat_message_recipients();
  ChatMessageType backup_type = chat_message_type();
  is_programmatic_chat_ = true;
  set_chat_message_recipients(recipients);
  set_chat_message_type(type);

  const char* c_message = message.c_str();
  auto send = offsets_->functions.SendMultiplayerChatMessage;
  __asm {
    mov ecx, send;
    mov eax, c_message;
    call ecx;
  }

  set_chat_message_type(backup_type);
  set_chat_message_recipients(backup_recipients);
  is_programmatic_chat_ = false;
}

// pass 0 to get the default timeout (7 seconds)
void BroodWar::DisplayMessage(const std::string& message, uint32 timeout) {
  auto display = offsets_->functions.DisplayMessage;
  const char* c_message = message.c_str();
  __asm {
    mov ecx, display;
    mov eax, timeout;  // I believe this is the display time (defaults to 7 seconds)
    mov edi, c_message;
    call ecx;
  }
}

static GameResult VictoryStateToGameResult(PlayerVictoryState state) {
  switch (state) {
  case PlayerVictoryState::Dropped: return GameResult::Disconnected;
  case PlayerVictoryState::Defeat: return GameResult::Defeat;
  case PlayerVictoryState::Victory: return GameResult::Victory;
  default: return GameResult::Playing;
  }
}

void BroodWar::ConvertGameResults() {
  PlayerVictoryState* victory_state = offsets_->victory_state;
  PlayerLoseType* player_lose_type = offsets_->player_lose_type;
  bool* player_has_left = offsets_->player_has_left;
  uint32* player_nation_ids = offsets_->player_nation_ids;
  uint32* local_storm_id = offsets_->local_storm_id;

  for (size_t i = 0; i < 8; ++i) {
    instance_->game_results_[i] = GameResult::Playing;
    uint32 nation_id = player_nation_ids[i];
    if (nation_id < 8) {
      instance_->game_results_[i] = VictoryStateToGameResult(victory_state[nation_id]);
    }
  }

  if (instance_->game_results_[*local_storm_id] == GameResult::Playing) {
    instance_->game_results_[*local_storm_id] = GameResult::Defeat;
  }

  if (*player_lose_type == PlayerLoseType::UnknownDisconnect) {
    for (int i = 0; i < 8; ++i) {
      if (player_has_left[i]) {
        instance_->game_results_[i] = GameResult::Playing;
      }
    }
    instance_->game_results_[*local_storm_id] = GameResult::Disconnected;
  } else {
    for (int i = 0; i < 8; ++i) {
      if (player_has_left[i]) {
        instance_->game_results_[i] = GameResult::Disconnected;
      }
    }
    if (*player_lose_type == PlayerLoseType::UnknownChecksumMismatch) {
      instance_->game_results_[*local_storm_id] = GameResult::Playing;
    }
  }
}

void BroodWar::CleanUpForExit() {
  auto clean_up = offsets_->functions.CleanUpForExit;
  __asm {
    push ecx;
    push ebx;
    xor bl, bl;
    mov ecx, clean_up;
    call ecx;
    pop ebx;
    pop ecx;
  }
}

uint32 BroodWar::GetLastStormError() {
  return offsets_->functions.SErrGetLastError();
}

void BroodWar::SetInputDisabled(bool disabled) {
  input_disabled_ = disabled;
}

}  // namespace bw
}  // namespace sbat