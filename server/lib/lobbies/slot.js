import { Record } from 'immutable'
import cuid from 'cuid'

const Slot = new Record({
  type: null,
  name: null,
  race: null,
  id: null,
  joinedAt: null,
  controlledBy: null,
  hasForcedRace: false,
  playerId: null,
  typeId: 0,
})

export function createOpen(race = 'r', hasForcedRace = false, playerId = null) {
  return new Slot({
    type: 'open',
    name: 'Open',
    race,
    id: cuid(),
    // These last three fields are used in UMS
    hasForcedRace,
    playerId,
    typeId: 6,
  })
}

export function createClosed(race = 'r', hasForcedRace = false, playerId = null) {
  return new Slot({
    type: 'closed',
    name: 'Closed',
    race,
    id: cuid(),
    // These last three fields are used in UMS
    hasForcedRace,
    playerId,
    typeId: 6,
  })
}

export function createHuman(name, race = 'r', hasForcedRace = false, playerId = null) {
  return new Slot({
    type: 'human',
    name,
    race,
    id: cuid(),
    joinedAt: Date.now(),
    // These last three fields are used in UMS
    hasForcedRace,
    playerId,
    typeId: 6,
  })
}

export function createComputer(race = 'r') {
  return new Slot({
    type: 'computer',
    name: 'Computer',
    race,
    id: cuid(),
  })
}

// Creates a slot that is open (can still be used for joining players), but is controlled by a
// particular player for as long as it is unoccupied. These are used for Team games (e.g.
// Team Melee), where open slots still affect the composition of starting units.
export function createControlledOpen(race, controllerId) {
  return new Slot({
    type: 'controlledOpen',
    name: 'Open',
    race,
    id: cuid(),
    controlledBy: controllerId,
  })
}

// Creates a slot that is closed (can't be used for joining players), but is controlled by a certain
// player for as long as it is closed and unoccupied. These are used for Team games (e.g. Team
// Melee), where closed slots can still have a race which affects the composition of starting units.
export function createControlledClosed(race, controllerId) {
  return new Slot({
    type: 'controlledClosed',
    name: 'Closed',
    race,
    id: cuid(),
    controlledBy: controllerId,
  })
}

// Creates a computer slot that is used in UMS lobbies. Computers in UMS lobbies can't be removed
// from the lobby and their race can't be changed. TypeId is the exact type (regular computer,
// rescueable, neutral, etc) which needs to be passed to bw but can otherwise be ignored.
export function createUmsComputer(race, playerId, typeId) {
  return new Slot({
    type: 'umsComputer',
    name: 'Computer',
    race,
    id: cuid(),
    hasForcedRace: true,
    playerId,
    typeId,
  })
}
