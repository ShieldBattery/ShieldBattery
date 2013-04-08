#include "./brood_war.h"

#include <Windows.h>
#include <string>
#include "../common/types.h"

namespace BW {
BroodWar::BroodWar() {
  offsets_ = GetOffsets<CURRENT_BROOD_WAR_VERSION>();
  ApplyPatches();
}

BroodWar::BroodWar(Offsets* broodWarOffsets) {
  offsets_ = broodWarOffsets;
  ApplyPatches();
}

BroodWar::~BroodWar() {
}

void BroodWar::ApplyPatches() {  // TODO(tec27): yeah....
  // Avoid restrictions that only let games start from certain menus
  DWORD old_protect;
  if (VirtualProtect(offsets_->start_from_any_glue_patch, 9, PAGE_EXECUTE_READWRITE,
      &old_protect) == FALSE) {
    return;
  }

  for (int i = 0; i < 9; i++) {
    offsets_->start_from_any_glue_patch[i] = 0x90;  // NOP
  }
  if (VirtualProtect(offsets_->start_from_any_glue_patch, 9, old_protect, &old_protect)
      == FALSE) {
    return;
  }

  // Allow loading of any SNP's (even unsigned)
  HMODULE storm = LoadLibrary(L"storm.dll");
  byte* snp_patch =
      reinterpret_cast<byte*>(reinterpret_cast<uint32>(storm) +
      reinterpret_cast<uint32>(offsets_->storm_unsigned_snp_patch));
  if (VirtualProtect(snp_patch, 26, PAGE_EXECUTE_READWRITE, &old_protect) == FALSE) {
    return;
  }

  for (int i = 0; i < 26; i++) {
    snp_patch[i] = 0x90;  // NOP
  }
  if (VirtualProtect(snp_patch, 26, old_protect, &old_protect) == FALSE) {
    return;
  }

  // Avoid doing a long countdown, and skip dialog-specific countdown code (that will crash)
  if (VirtualProtect(offsets_->game_countdown_delay_patch, 4, PAGE_EXECUTE_READWRITE,
      &old_protect) == FALSE) {
    return;
  }
  *offsets_->game_countdown_delay_patch = 0x05;  // 5 ticks! for justice!
  if (VirtualProtect(offsets_->game_countdown_delay_patch, 4, old_protect,
      &old_protect) == FALSE) {
    return;
  }
}

void __stdcall DummyMapListEntryCallback(MapListEntry* map_data, char* map_name, uint32 file_type) {
}

void BroodWar::GetMapsList(const MapListEntryCallback callback) {
  // callback is passed in through eax because blizzard's compiler hates me
  Functions::GetMapsListFunc get_list = offsets_->functions.GetMapsList;
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

void BroodWar::SelectMapOrDirectory(const std::string& game_name, const std::string& password,
      uint32 game_type, GameSpeed game_speed, MapListEntry* map_data) {
  Functions::SelectMapOrDirectoryFunc select = offsets_->functions.SelectMapOrDirectory;

  const char* game_name_param = game_name.c_str();
  const char* password_param = password.c_str();
  const char* map_folder_path = offsets_->current_map_folder_path;

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
    pop edx;
    pop eax;
  }
}

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
    if (current_map->filename[0] != '\0') {
      printf("Iterating map list: %s\n", current_map->filename);
    }
    if (map_file.compare(current_map->filename) == 0) {
      break;
    }

    current_map = current_map->next;
  }

  if (current_map == NULL) {
    // map could not be found, unable to create game
    return false;
  }

  SelectMapOrDirectory(game_name, password, game_type, game_speed, current_map);
  return true;
}
}  // namespace BW