#include "./brood_war.h"

#include <Windows.h>
#include <cassert>
#include <string>
#include "common/types.h"
#include "common/win_helpers.h"

namespace sbat {
namespace bw {
BroodWar* BroodWar::instance_ = nullptr;

BroodWar* BroodWar::Get() {
  if (instance_ == nullptr) {
    instance_ = new BroodWar();
  }

  return instance_;
}

BroodWar::BroodWar()
    : offsets_(GetOffsets<CURRENT_BROOD_WAR_VERSION>()),
      event_handlers_(nullptr) {
  ApplyPatches();
  InjectDetours();
}

BroodWar::BroodWar(Offsets* broodWarOffsets)
    : offsets_(broodWarOffsets),
      event_handlers_(nullptr) {
  ApplyPatches();
  InjectDetours();
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
void __stdcall BroodWar::ShowLobbyChatHook(char* message) {
  uint32 slot;
  __asm {
    mov slot, eax;
  }

  if (HAVE_HANDLER_FOR(OnLobbyChatMessage)) {
    instance_->event_handlers_->OnLobbyChatMessage(static_cast<byte>(slot), message);
  }
}

void __stdcall BroodWar::OnLobbyDownloadStatus(uint32 slot, uint32 download_percent) {
  if (HAVE_HANDLER_FOR(OnLobbyDownloadStatus)) {
    instance_->event_handlers_->OnLobbyDownloadStatus(static_cast<byte>(slot), download_percent);
  }
}

void __stdcall BroodWar::OnLobbySlotChange(byte data[6]) {
  // 3E <b Slot> <b StormId> <b Type> <b Race> <b Team>
  if (HAVE_HANDLER_FOR(OnLobbySlotChange)) {
    instance_->event_handlers_->OnLobbySlotChange(data[1], data[2], data[3], data[4], data[5]);
  }
}

void __stdcall BroodWar::OnLobbyStartCountdown() {
  if (HAVE_HANDLER_FOR(OnLobbyStartCountdown)) {
    instance_->event_handlers_->OnLobbyStartCountdown();
  }
}

void __stdcall BroodWar::OnLobbyGameInit(LobbyGameInitData* data) {
  if (HAVE_HANDLER_FOR(OnLobbyGameInit)) {
    instance_->event_handlers_->OnLobbyGameInit(data->random_seed, data->player_bytes);
  }
}

void __stdcall BroodWar::OnLobbyMissionBriefing(uint32 slot) {
  if (HAVE_HANDLER_FOR(OnLobbyMissionBriefing)) {
    instance_->event_handlers_->OnLobbyMissionBriefing(static_cast<byte>(slot));
  }
}
#undef HAVE_HANDLER_FOR

void __stdcall BroodWar::OnInitializeSnpList(char* snp_directory) {
  // rewrite the snp_directory to be shieldbattery's directory instead, so that we can place custom
  // SNPs in our own directory instead of Starcraft's. Note that this will prevent us from using a
  // standard snp file without copying it to our dir
  GetModuleFileNameA(GetModuleHandle("shieldbattery.dll"), snp_directory, MAX_PATH);
}

void BroodWar::InjectDetours() {
  offsets_->detours.OnLobbyDownloadStatus->Inject();
  offsets_->detours.OnLobbySlotChange->Inject();
  offsets_->detours.OnLobbyStartCountdown->Inject();
  offsets_->detours.OnLobbyGameInit->Inject();
  offsets_->detours.OnLobbyMissionBriefing->Inject();
  offsets_->detours.InitializeSnpList->Inject();
  offsets_->detours.RenderDuringInitSpritesOne->Inject();
  offsets_->detours.RenderDuringInitSpritesTwo->Inject();

  offsets_->func_hooks.LobbyChatShowMessage->Inject();
}

void BroodWar::ApplyPatches() {
  // TODO(tec27): yeah... write a better way to do patches
  // Avoid restrictions that only let games start from certain menus
  ScopedVirtualProtect glue_protect(offsets_->start_from_any_glue_patch, 9, PAGE_EXECUTE_READWRITE);
  if (!glue_protect.has_errors()) {
    // 9x NOP
    memset(offsets_->start_from_any_glue_patch, 0x90, 9);
  }

  // Allow loading of any SNP's (even unsigned)
  ScopedVirtualProtect snp_protect(offsets_->storm_unsigned_snp_patch, 26, PAGE_EXECUTE_READWRITE);
  if (!snp_protect.has_errors()) {
    // 26x NOP
    memset(offsets_->storm_unsigned_snp_patch, 0x90, 26);
  }

  // Avoid doing a long countdown, and skip dialog-specific countdown code (that will crash)
  ScopedVirtualProtect countdown_protect(offsets_->game_countdown_delay_patch, 4,
      PAGE_EXECUTE_READWRITE);
  if (!countdown_protect.has_errors()) {
    *offsets_->game_countdown_delay_patch = 0x05;  // 5 ticks! for justice! (this is the minimum)
  }
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
  return *offsets_->local_player_id1;
}

uint32 BroodWar::local_lobby_id() const {
  return *offsets_->local_lobby_id;
}

std::string BroodWar::local_player_name() const {
  return std::string(offsets_->local_player_name);
}

void BroodWar::set_local_player_name(const std::string& name) {
  assert(name.length() <= 25);
  strcpy_s(offsets_->local_player_name, 25, name.c_str());
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

bool BroodWar::AddComputer(uint32 slot_num) {
  return offsets_->functions.AddComputer(slot_num) == 1;
}

bool BroodWar::SetRace(uint32 slot_num, uint32 race) {
  auto set_race = offsets_->functions.LobbySendRaceChange;
  int result;
  _asm {
    push eax;
    push ecx;
    mov ecx, race;
    push ecx;
    mov ecx, set_race;
    mov eax, slot_num;
    call ecx;
    mov result, eax;
    pop ecx;
    pop eax;
  }

  return result == 1;
}

// Returns a value indicating the data message that was processed, if any.
// Particularly useful ones (that the game itself uses) are: 0x4B (Force Name Transfer) and
// 0x53 (Entered Briefing Room). You should probably also check the was_booted variable to ensure
// you haven't been kicked from the game.
uint32 BroodWar::ProcessLobbyTurn() {
  return offsets_->functions.ProcessLobbyTurn(nullptr);
}

bool BroodWar::StartGameCountdown() {
  return offsets_->functions.StartGameCountdown() == 1;
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

bool BroodWar::SelectMapOrDirectory(const std::string& game_name, const std::string& password,
      uint32 game_type, GameSpeed game_speed, MapListEntry* map_data) {
  auto select = offsets_->functions.SelectMapOrDirectory;

  const char* game_name_param = game_name.c_str();
  const char* password_param = password.c_str();
  const char* map_folder_path = offsets_->current_map_folder_path;
  uint32 result;

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

  // this function returns an error code on failure, so 0 is good here
  return result == 0;
}

// TODO(tec27): see above, return what SelectMapOrDirectory returns?
bool BroodWar::CreateGame(const std::string& game_name, const std::string& password,
      const std::string& map_path, const uint32 game_type, const GameSpeed game_speed) {
  std::string map_dir;
  std::string map_file;

  size_t slash_pos = map_path.find_last_of("\\");
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
  while (current_map != NULL) {
    if (map_file.compare(current_map->filename) == 0) {
      break;
    }

    current_map = current_map->next;
  }

  if (current_map == NULL) {
    // map could not be found, unable to create game
    return false;
  }

  return SelectMapOrDirectory(game_name, password, game_type, game_speed, current_map);
}

bool BroodWar::JoinGame(const JoinableGameInfo& game_info) {
  // while (!IsDebuggerPresent()) { }
  // DebugBreak();
  auto join = offsets_->functions.JoinGame;
  const JoinableGameInfo* arg = &game_info;
  uint32 result;
  __asm {
    mov eax, join;
    mov ebx, arg;
    call eax;
    mov result, eax;
  }

  return result == 1;
}
}  // namespace bw
}  // namespace sbat