import { Record } from 'immutable'
import { nanoid } from 'nanoid'
import { RaceChar } from '../races'
import { SbUserId } from '../users/sb-user-id'

export enum SlotType {
  Human = 'human',
  Observer = 'observer',
  Computer = 'computer',
  ControlledOpen = 'controlledOpen',
  ControlledClosed = 'controlledClosed',
  UmsComputer = 'umsComputer',
  Open = 'open',
  Closed = 'closed',
}

export class Slot extends Record({
  type: SlotType.Open,
  userId: undefined as SbUserId | undefined,
  race: 'r' as RaceChar,
  id: '',
  joinedAt: 0,
  controlledBy: undefined as string | undefined,
  hasForcedRace: false,
  playerId: 0,
  typeId: 0,
}) {}

export type SlotJson = ReturnType<Slot['toJSON']>

export function createOpen(race: RaceChar = 'r', hasForcedRace = false, playerId = 0): Slot {
  return new Slot({
    type: SlotType.Open,
    race,
    id: nanoid(),
    // These last three fields are used in UMS
    hasForcedRace,
    playerId,
    typeId: 6,
  })
}

export function createClosed(race: RaceChar = 'r', hasForcedRace = false, playerId = 0): Slot {
  return new Slot({
    type: SlotType.Closed,
    race,
    id: nanoid(),
    // These last three fields are used in UMS
    hasForcedRace,
    playerId,
    typeId: 6,
  })
}

export function createHuman(
  userId: SbUserId,
  race: RaceChar = 'r',
  hasForcedRace = false,
  playerId = 0,
): Slot {
  return new Slot({
    type: SlotType.Human,
    userId,
    race,
    id: nanoid(),
    joinedAt: Date.now(),
    // These last three fields are used in UMS
    hasForcedRace,
    playerId,
    typeId: 6,
  })
}

export function createComputer(race: RaceChar = 'r'): Slot {
  return new Slot({
    type: SlotType.Computer,
    race,
    id: nanoid(),
  })
}

// Creates a slot that is open (can still be used for joining players), but is controlled by a
// particular player for as long as it is unoccupied. These are used for Team games (e.g.
// Team Melee), where open slots still affect the composition of starting units.
export function createControlledOpen(race: RaceChar, controllerId: string): Slot {
  return new Slot({
    type: SlotType.ControlledOpen,
    race,
    id: nanoid(),
    controlledBy: controllerId,
  })
}

// Creates a slot that is closed (can't be used for joining players), but is controlled by a certain
// player for as long as it is closed and unoccupied. These are used for Team games (e.g. Team
// Melee), where closed slots can still have a race which affects the composition of starting units.
export function createControlledClosed(race: RaceChar, controllerId: string): Slot {
  return new Slot({
    type: SlotType.ControlledClosed,
    race,
    id: nanoid(),
    controlledBy: controllerId,
  })
}

// Creates a computer slot that is used in UMS lobbies. Computers in UMS lobbies can't be removed
// from the lobby and their race can't be changed. TypeId is the exact type (regular computer,
// rescueable, neutral, etc) which needs to be passed to bw but can otherwise be ignored.
export function createUmsComputer(race: RaceChar, playerId: number, typeId: number): Slot {
  return new Slot({
    type: SlotType.UmsComputer,
    race,
    id: nanoid(),
    hasForcedRace: true,
    playerId,
    typeId,
  })
}

// Creates an observer slot, which is a human in a lobby who is not playing, but rather watching
// other people play.
export function createObserver(userId: SbUserId) {
  return new Slot({
    type: SlotType.Observer,
    userId,
    id: nanoid(),
    joinedAt: Date.now(),
  })
}
