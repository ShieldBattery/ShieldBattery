import cuid from 'cuid'
import { Record } from 'immutable'
import { RaceChar } from '../../../common/races'

const createSlot = Record({
  type: 'open',
  userId: null as number | null,
  name: null as string | null,
  race: 'r' as RaceChar,
  id: '',
  joinedAt: null as number | null,
  controlledBy: null as string | null,
  hasForcedRace: false,
  playerId: null as number | null,
  typeId: 0,
})

export type Slot = ReturnType<typeof createSlot>

export function createOpen(
  race: RaceChar = 'r',
  hasForcedRace = false,
  playerId: number | null = null,
): Slot {
  return createSlot({
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

export function createClosed(
  race: RaceChar = 'r',
  hasForcedRace = false,
  playerId: number | null = null,
): Slot {
  return createSlot({
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

export function createHuman(
  name: string,
  userId: number,
  race: RaceChar = 'r',
  hasForcedRace = false,
  playerId: number | null = null,
): Slot {
  return createSlot({
    type: 'human',
    userId,
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

export function createComputer(race: RaceChar = 'r'): Slot {
  return createSlot({
    type: 'computer',
    name: 'Computer',
    race,
    id: cuid(),
  })
}

// Creates a slot that is open (can still be used for joining players), but is controlled by a
// particular player for as long as it is unoccupied. These are used for Team games (e.g.
// Team Melee), where open slots still affect the composition of starting units.
export function createControlledOpen(race: RaceChar, controllerId: string): Slot {
  return createSlot({
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
export function createControlledClosed(race: RaceChar, controllerId: string): Slot {
  return createSlot({
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
export function createUmsComputer(race: RaceChar, playerId: number, typeId: number): Slot {
  return createSlot({
    type: 'umsComputer',
    name: 'Computer',
    race,
    id: cuid(),
    hasForcedRace: true,
    playerId,
    typeId,
  })
}

// Creates an observer slot, which is a human in a lobby who is not playing, but rather watching
// other people play.
export function createObserver(name: string, userId: number) {
  return createSlot({
    type: 'observer',
    userId,
    name,
    id: cuid(),
    joinedAt: Date.now(),
  })
}
