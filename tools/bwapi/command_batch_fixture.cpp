// A supervised local client that puts a movement order beyond the 256th wire command.
// It uses the pinned BWAPI SDK for the shared-memory layout and never prints discovery tokens.
#define NOMINMAX
#include <windows.h>

#include <algorithm>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <string>

#include <BWAPI/Client/GameData.h>
#include <BWAPI/Client/GameTable.h>

namespace {
struct Handle {
  HANDLE value = nullptr;
  ~Handle() {
    if (value && value != INVALID_HANDLE_VALUE) CloseHandle(value);
  }
};
struct View {
  void* value = nullptr;
  ~View() {
    if (value) UnmapViewOfFile(value);
  }
};

bool receive(HANDLE pipe) {
  int code = 0;
  DWORD count = 0;
  return ReadFile(pipe, &code, sizeof(code), &count, nullptr) && count == sizeof(code) && code == 2;
}
bool exchange(HANDLE pipe) {
  const int code = 1;
  DWORD count = 0;
  return WriteFile(pipe, &code, sizeof(code), &count, nullptr) && count == sizeof(code) && receive(pipe);
}
}  // namespace

int main() {
  char* instance = nullptr;
  size_t instance_size = 0;
  if (_dupenv_s(&instance, &instance_size, "SB_BWAPI_INSTANCE") || !instance || instance_size < 2) {
    std::free(instance);
    return 1;
  }
  const auto table_name = std::string("Local\\bwapi_shared_memory_game_list_") + instance;
  std::free(instance);
  Handle table;
  View table_view;
  DWORD pid = 0;
  const auto deadline = GetTickCount64() + 60000;
  while (GetTickCount64() < deadline && !pid) {
    if (!table.value) table.value = OpenFileMappingA(FILE_MAP_READ, FALSE, table_name.c_str());
    if (table.value && !table_view.value) table_view.value = MapViewOfFile(table.value, FILE_MAP_READ, 0, 0, sizeof(BWAPI::GameTable));
    if (table_view.value) {
      for (const auto& game : static_cast<BWAPI::GameTable*>(table_view.value)->gameInstances) {
        if (game.serverProcessID && !game.isConnected) { pid = game.serverProcessID; break; }
      }
    }
    if (!pid) Sleep(20);
  }
  if (!pid) return 2;
  Handle mapping, pipe;
  View view;
  const auto data_name = std::string("Local\\bwapi_shared_memory_") + std::to_string(pid);
  mapping.value = OpenFileMappingA(FILE_MAP_READ | FILE_MAP_WRITE, FALSE, data_name.c_str());
  if (!mapping.value) return 3;
  view.value = MapViewOfFile(mapping.value, FILE_MAP_READ | FILE_MAP_WRITE, 0, 0, sizeof(BWAPI::GameData));
  if (!view.value) return 4;
  auto* data = static_cast<BWAPI::GameData*>(view.value);
  if (data->client_version != 10003) return 5;
  const auto pipe_name = std::string("\\\\.\\pipe\\bwapi_pipe_") + std::to_string(pid);
  pipe.value = CreateFileA(pipe_name.c_str(), GENERIC_READ | GENERIC_WRITE, 0, nullptr, OPEN_EXISTING, 0, nullptr);
  if (pipe.value == INVALID_HANDLE_VALUE || !receive(pipe.value)) return 6;
  int actor = -1, initial_x = 0, initial_y = 0;
  bool submitted = false, observed = false;
  static_assert(sizeof(BWAPIC::UnitCommand) == 24);
  static_assert(sizeof(BWAPI::GameData) == 33017048);
  while (true) {
    if (data->isInGame && !submitted) {
      for (int i = 0; i < 10000; ++i) {
        const auto& unit = data->units[i];
        if (unit.exists && unit.player == data->self && unit.type == 41) { actor = i; break; }
      }
      if (actor < 0) return 7;
      initial_x = data->units[actor].positionX;
      initial_y = data->units[actor].positionY;
      for (int i = 0; i < 300; ++i) {
        const bool last = i == 299;
        const int values[6] = {last ? 10 : 13, actor, -1,
          last ? std::clamp(initial_x + 64, 0, data->mapWidth * 32 - 1) : 0,
          last ? initial_y : 0, 0};
        std::memcpy(&data->unitCommands[i], values, sizeof(values));
      }
      data->unitCommandCount = 300;
      submitted = true;
      std::printf("batch submitted=300 last_kind=10 actor_type=41 initial_x=%d initial_y=%d\n", initial_x, initial_y);
      std::fflush(stdout);
    }
    if (submitted && !observed && data->frameCount >= 240) {
      const auto& unit = data->units[actor];
      std::printf("batch observed frame=%d x=%d y=%d delta_x=%d delta_y=%d\n", data->frameCount,
        unit.positionX, unit.positionY, unit.positionX - initial_x, unit.positionY - initial_y);
      std::fflush(stdout);
      observed = true;
    }
    if (!exchange(pipe.value)) return observed ? 0 : 8;
  }
}
