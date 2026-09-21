#include <BWAPI.h>
#include <BWAPI/Client.h>

#include <algorithm>
#include <chrono>
#include <cstdlib>
#include <iostream>
#include <map>
#include <memory>
#include <thread>

extern "C" void gameInit(BWAPI::Game* game);
extern "C" BWAPI::AIModule* newAIModule();

namespace {

using Module = std::unique_ptr<BWAPI::AIModule>;

bool diagnosticsEnabled() {
  char* value = nullptr;
  size_t size = 0;
  if (_dupenv_s(&value, &size, "BWAPI_HOST_DIAGNOSTICS") != 0) {
    return false;
  }

  const bool enabled = value != nullptr;
  std::free(value);
  return enabled;
}

void logStart() {
  const auto self = BWAPI::Broodwar->self();
  if (!self) {
    std::cout << "Match started without a self player." << std::endl;
    return;
  }

  const auto start = self->getStartLocation();
  std::cout << "Match started: self=" << self->getName()
            << " race=" << self->getRace()
            << " start=(" << start.x << ',' << start.y << ')'
            << " units=" << self->getUnits().size()
            << " minerals=" << self->minerals() << std::endl;
}

void logFrame() {
  const auto self = BWAPI::Broodwar->self();
  const auto* data = BWAPI::BWAPIClient.data;
  if (!self || !data) {
    return;
  }

  const int command_count = std::max(0, std::min(data->unitCommandCount, 256));
  for (int i = 0; i < command_count; ++i) {
    const auto& command = data->unitCommands[i];
    if (command.type != BWAPI::UnitCommandTypes::Build &&
        command.type != BWAPI::UnitCommandTypes::Morph) {
      continue;
    }

    std::cout << "Frame " << BWAPI::Broodwar->getFrameCount()
              << ": submitted " << command.type.getName()
              << " unit=" << command.unitIndex
              << " target_type=" << BWAPI::UnitType(command.extra).getName()
              << " tile=(" << command.x << ',' << command.y << ')' << std::endl;
  }

  if (BWAPI::Broodwar->getFrameCount() % 240 != 0) {
    return;
  }

  std::map<int, int> kinds;
  for (int i = 0; i < command_count; ++i) {
    ++kinds[data->unitCommands[i].type.getID()];
  }

  std::cout << "Frame " << BWAPI::Broodwar->getFrameCount()
            << ": minerals=" << self->minerals()
            << " gas=" << self->gas()
            << " own_units=" << self->getUnits().size()
            << " unit_commands=" << command_count;
  if (!kinds.empty()) {
    std::cout << " kinds=";
    bool first = true;
    for (const auto& [kind, count] : kinds) {
      std::cout << (first ? "" : ",") << kind << ':' << count;
      first = false;
    }
  }
  std::cout << std::endl;

  if (!diagnosticsEnabled()) {
    return;
  }

  const auto pool = BWAPI::UnitTypes::Zerg_Spawning_Pool;
  const bool unit_available = self->isUnitAvailable(pool);
  const bool can_make = BWAPI::Broodwar->canMake(pool);
  const auto can_make_error = BWAPI::Broodwar->getLastError();

  BWAPI::Unit builder = nullptr;
  for (const auto unit : self->getUnits()) {
    if (!builder && unit->getType() == BWAPI::UnitTypes::Zerg_Drone &&
        unit->isCompleted()) {
      builder = unit;
    }
  }

  BWAPI::TilePosition build_location = BWAPI::TilePositions::None;
  bool can_build_type = false;
  BWAPI::Error can_build_type_error = BWAPI::Errors::None;
  bool can_build_location = false;
  BWAPI::Error can_build_location_error = BWAPI::Errors::None;
  int footprint_creep = 0;
  int footprint_buildable = 0;
  int footprint_explored = 0;
  if (builder) {
    build_location = BWAPI::Broodwar->getBuildLocation(pool, builder->getTilePosition());
    can_build_type = builder->canBuild(pool);
    can_build_type_error = BWAPI::Broodwar->getLastError();
    if (build_location.isValid()) {
      can_build_location = builder->canBuild(pool, build_location);
      can_build_location_error = BWAPI::Broodwar->getLastError();
      for (int y = 0; y < pool.tileHeight(); ++y) {
        for (int x = 0; x < pool.tileWidth(); ++x) {
          const BWAPI::TilePosition tile(build_location.x + x, build_location.y + y);
          footprint_creep += BWAPI::Broodwar->hasCreep(tile);
          footprint_buildable += BWAPI::Broodwar->isBuildable(tile, true);
          footprint_explored += BWAPI::Broodwar->isExplored(tile);
        }
      }
    }
  }

  std::cout << "  Pool diagnostic: available=" << unit_available
            << " can_make=" << can_make
            << " can_make_error=" << can_make_error.getName()
            << " builder=" << (builder ? builder->getID() : -1)
            << " idle=" << (builder && builder->isIdle())
            << " gathering_minerals=" << (builder && builder->isGatheringMinerals())
            << " carrying="
            << (builder && (builder->isCarryingMinerals() || builder->isCarryingGas()))
            << " constructing=" << (builder && builder->isConstructing())
            << " last_command="
            << (builder ? builder->getLastCommand().getType().getName() : "None")
            << " last_command_frame=" << (builder ? builder->getLastCommandFrame() : -1)
            << " build_location=(" << build_location.x << ',' << build_location.y << ')'
            << " can_build_type=" << can_build_type
            << " can_build_type_error=" << can_build_type_error.getName()
            << " can_build_location=" << can_build_location
            << " can_build_location_error=" << can_build_location_error.getName()
            << " footprint_creep=" << footprint_creep << '/'
            << pool.tileWidth() * pool.tileHeight()
            << " footprint_buildable=" << footprint_buildable << '/'
            << pool.tileWidth() * pool.tileHeight()
            << " footprint_explored=" << footprint_explored << '/'
            << pool.tileWidth() * pool.tileHeight() << std::endl;
}

void connect() {
  std::cout << "Waiting for a BWAPI 4.4 server..." << std::endl;
  while (!BWAPI::BWAPIClient.connect()) {
    std::this_thread::sleep_for(std::chrono::seconds(1));
  }

  // Native modules receive this pointer from BWAPI.dll before any callbacks.
  gameInit(BWAPI::BroodwarPtr);
  std::cout << "Connected." << std::endl;
}

void dispatch(const BWAPI::Event& event, Module& module) {
  if (event.getType() == BWAPI::EventType::MatchStart) {
    module.reset(newAIModule());
  }

  if (!module) {
    return;
  }

  switch (event.getType()) {
    case BWAPI::EventType::MatchStart:
      logStart();
      module->onStart();
      break;
    case BWAPI::EventType::MatchEnd:
      module->onEnd(event.isWinner());
      std::cout << "Match ended: winner=" << event.isWinner()
                << " frame=" << BWAPI::Broodwar->getFrameCount() << std::endl;
      module.reset();
      break;
    case BWAPI::EventType::MatchFrame:
      module->onFrame();
      logFrame();
      break;
    case BWAPI::EventType::MenuFrame:
      break;
    case BWAPI::EventType::SendText:
      module->onSendText(event.getText());
      break;
    case BWAPI::EventType::ReceiveText:
      module->onReceiveText(event.getPlayer(), event.getText());
      break;
    case BWAPI::EventType::PlayerLeft:
      module->onPlayerLeft(event.getPlayer());
      break;
    case BWAPI::EventType::NukeDetect:
      module->onNukeDetect(event.getPosition());
      break;
    case BWAPI::EventType::UnitDiscover:
      module->onUnitDiscover(event.getUnit());
      break;
    case BWAPI::EventType::UnitEvade:
      module->onUnitEvade(event.getUnit());
      break;
    case BWAPI::EventType::UnitShow:
      module->onUnitShow(event.getUnit());
      break;
    case BWAPI::EventType::UnitHide:
      module->onUnitHide(event.getUnit());
      break;
    case BWAPI::EventType::UnitCreate:
      module->onUnitCreate(event.getUnit());
      break;
    case BWAPI::EventType::UnitDestroy:
      module->onUnitDestroy(event.getUnit());
      break;
    case BWAPI::EventType::UnitMorph:
      module->onUnitMorph(event.getUnit());
      break;
    case BWAPI::EventType::UnitRenegade:
      module->onUnitRenegade(event.getUnit());
      break;
    case BWAPI::EventType::SaveGame:
      module->onSaveGame(event.getText());
      break;
    case BWAPI::EventType::UnitComplete:
      module->onUnitComplete(event.getUnit());
      break;
    case BWAPI::EventType::None:
      break;
  }
}

}  // namespace

int main() {
  Module module;

  for (;;) {
    connect();

    while (BWAPI::BWAPIClient.isConnected()) {
      BWAPI::BWAPIClient.update();
      if (!BWAPI::BWAPIClient.isConnected()) {
        break;
      }

      for (const auto& event : BWAPI::Broodwar->getEvents()) {
        dispatch(event, module);
      }
    }

    module.reset();
    std::cout << "Disconnected; reconnecting..." << std::endl;
  }
}
