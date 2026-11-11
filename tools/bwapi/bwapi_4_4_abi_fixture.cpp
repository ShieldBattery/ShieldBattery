// Compile with the v4.4.0 SDK include directory and run on both Windows targets.
// It emits the record sizes used by game/src/bwapi/wire.rs.
#include <cstddef>
#include <cstdio>

#include <BWAPI/Client/GameData.h>
#include <BWAPI/Client/GameTable.h>

#define RECORD(T) std::printf("\"" #T "\":%zu,", sizeof(T))
#define FIELD(T, F) std::printf("\"" #T "." #F "\":%zu,", offsetof(T, F))

int main() {
  std::printf("{");
  RECORD(BWAPI::GameInstance);
  RECORD(BWAPI::GameTable);
  RECORD(BWAPI::ForceData);
  RECORD(BWAPI::PlayerData);
  RECORD(BWAPI::UnitData);
  RECORD(BWAPI::BulletData);
  RECORD(BWAPI::RegionData);
  RECORD(BWAPIC::Event);
  RECORD(BWAPIC::Shape);
  RECORD(BWAPIC::Command);
  RECORD(BWAPIC::UnitCommand);
  RECORD(BWAPI::unitFinder);
  RECORD(BWAPI::GameData);
  FIELD(BWAPI::GameData, client_version);
  FIELD(BWAPI::GameData, players);
  FIELD(BWAPI::GameData, units);
  FIELD(BWAPI::GameData, isWalkable);
  FIELD(BWAPI::GameData, events);
  FIELD(BWAPI::GameData, strings);
  FIELD(BWAPI::GameData, commands);
  FIELD(BWAPI::GameData, unitCommands);
  std::printf("\"end\":0}\n");
}
