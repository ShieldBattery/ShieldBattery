import { nanoid } from 'nanoid'
import { GameServerRegionId } from '../game-server-regions'
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

export interface Slot {
  readonly type: SlotType
  readonly userId?: SbUserId
  readonly race: RaceChar
  readonly id: string
  readonly joinedAt: number
  readonly controlledBy?: string
  readonly hasForcedRace: boolean
  readonly playerId: number
  readonly typeId: number
  /**
   * The home game-server region this occupant selected when they joined, if any. Set only on slots
   * a human occupies (`human`/`observer`); used to home their netcode v2 relay at session create.
   * Absent when the occupant reported no region (e.g. no coordinator-configured regions) or for
   * non-occupant slot types (open, computer, etc.).
   */
  readonly region?: GameServerRegionId
}

/** Every field of a `Slot` is JSON-safe, so the interface is also its own JSON form. */
export type SlotJson = Slot

export function createOpen(race: RaceChar = 'r', hasForcedRace = false, playerId = 0): Slot {
  return {
    type: SlotType.Open,
    race,
    id: nanoid(),
    joinedAt: 0,
    // These last three fields are used in UMS
    hasForcedRace,
    playerId,
    typeId: 6,
  }
}

export function createClosed(race: RaceChar = 'r', hasForcedRace = false, playerId = 0): Slot {
  return {
    type: SlotType.Closed,
    race,
    id: nanoid(),
    joinedAt: 0,
    // These last three fields are used in UMS
    hasForcedRace,
    playerId,
    typeId: 6,
  }
}

export function createHuman(
  userId: SbUserId,
  race: RaceChar = 'r',
  hasForcedRace = false,
  playerId = 0,
): Slot {
  return {
    type: SlotType.Human,
    userId,
    race,
    id: nanoid(),
    joinedAt: Date.now(),
    // These last three fields are used in UMS
    hasForcedRace,
    playerId,
    typeId: 6,
  }
}

export function createComputer(race: RaceChar = 'r'): Slot {
  return {
    type: SlotType.Computer,
    race,
    id: nanoid(),
    joinedAt: 0,
    hasForcedRace: false,
    playerId: 0,
    typeId: 0,
  }
}

// Creates a slot that is open (can still be used for joining players), but is controlled by a
// particular player for as long as it is unoccupied. These are used for Team games (e.g.
// Team Melee), where open slots still affect the composition of starting units.
export function createControlledOpen(race: RaceChar, controllerId: string): Slot {
  return {
    type: SlotType.ControlledOpen,
    race,
    id: nanoid(),
    controlledBy: controllerId,
    joinedAt: 0,
    hasForcedRace: false,
    playerId: 0,
    typeId: 0,
  }
}

// Creates a slot that is closed (can't be used for joining players), but is controlled by a certain
// player for as long as it is closed and unoccupied. These are used for Team games (e.g. Team
// Melee), where closed slots can still have a race which affects the composition of starting units.
export function createControlledClosed(race: RaceChar, controllerId: string): Slot {
  return {
    type: SlotType.ControlledClosed,
    race,
    id: nanoid(),
    controlledBy: controllerId,
    joinedAt: 0,
    hasForcedRace: false,
    playerId: 0,
    typeId: 0,
  }
}

// Creates a computer slot that is used in UMS lobbies. Computers in UMS lobbies can't be removed
// from the lobby and their race can't be changed. TypeId is the exact type (regular computer,
// rescueable, neutral, etc) which needs to be passed to bw but can otherwise be ignored.
export function createUmsComputer(race: RaceChar, playerId: number, typeId: number): Slot {
  return {
    type: SlotType.UmsComputer,
    race,
    id: nanoid(),
    joinedAt: 0,
    hasForcedRace: true,
    playerId,
    typeId,
  }
}

// Creates an observer slot, which is a human in a lobby who is not playing, but rather watching
// other people play.
export function createObserver(userId: SbUserId): Slot {
  return {
    type: SlotType.Observer,
    userId,
    race: 'r',
    id: nanoid(),
    joinedAt: Date.now(),
    hasForcedRace: false,
    playerId: 0,
    typeId: 0,
  }
}
