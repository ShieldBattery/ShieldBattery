import { PlayerInfo } from '../games/game-launch-config'
import { GameType, isTeamType } from '../games/game-type'
import { MapInfo } from '../maps'
import { SbUserId } from '../users/sb-user-id'
import { LobbyVisibility } from './lobby-visibility'
import { SbLobbyId } from './sb-lobby-id'
import { Slot, SlotType } from './slot'

/**
 * The number of observer slots a lobby that allows observers has. These are in addition to the
 * map's player slots, and this is the most observers a game can hold.
 */
export const MAX_OBSERVERS = 4

/** The most recent maps kept in a user's lobby preferences, newest first. */
export const NUM_RECENT_MAPS = 5

/** States that a lobby can be in. These are the possible return values of `getLobbyState`. */
export type LobbyState = 'nonexistent' | 'exists' | 'countingDown' | 'hasStarted'

export * from './lobby-visibility'

export interface Team {
  readonly name: string
  readonly teamId: number
  readonly isObserver: boolean
  /** Slots that belong to a particular team. */
  readonly slots: ReadonlyArray<Slot>
  /** UMS maps can have slots which are not shown in lobby but get initialized in game. */
  readonly hiddenSlots: ReadonlyArray<Slot>
}

export interface Lobby {
  readonly id: SbLobbyId
  readonly name: string
  readonly map?: MapInfo
  readonly gameType: GameType
  readonly gameSubType: number
  /** All lobbies have at least one team (even Melee and FFA). */
  readonly teams: ReadonlyArray<Team>
  readonly host: Slot
  readonly useLegacyLimits: boolean
  readonly visibility: LobbyVisibility
  /** When the lobby was created (Unix millis). */
  readonly createdAt: number
}

export function isUms(gameType: GameType): gameType is GameType.UseMapSettings {
  return gameType === GameType.UseMapSettings
}

/**
 * Returns an array of all the slots in a lobby.
 *
 * Since we don't keep a separate list just for the slots, this function iterates over all of the
 * teams in a lobby and accumulates the slots into a new array. Keep in mind that you lose the team
 * index and slot index, so use this function only when you care about the slots themselves, not
 * their indexes; otherwise, use the `getLobbySlotsWithIndexes`.
 */
export function getLobbySlots(lobby: Lobby): Slot[] {
  return lobby.teams.flatMap(team => team.slots)
}

/**
 * Gets all the player slots for a lobby, which for now are: `human`, `computer` and `umsComputer`
 * type slots.
 */
export function getPlayerSlots(lobby: Lobby): Slot[] {
  return getLobbySlots(lobby).filter(
    slot =>
      slot.type === SlotType.Human ||
      slot.type === SlotType.Computer ||
      slot.type === SlotType.UmsComputer,
  )
}

/** Gets all the human slots in a lobby. This includes both the players and the observers. */
export function getHumanSlots(lobby: Lobby): Slot[] {
  return getLobbySlots(lobby).filter(
    slot => slot.type === SlotType.Human || slot.type === SlotType.Observer,
  )
}

export type SlotWithIndexes = [teamIndex: number, slotIndex: number, slot: Slot]

/**
 * Returns an array of tuples with info for each slot in the lobby.
 *
 * This function is similar to the `getLobbySlots`, only it preserves the team index and slot index
 * after flat mapping the team, and as a result returns an array where each element is in the
 * following form: [teamIndex, slotIndex, slot]
 */
export function getLobbySlotsWithIndexes(lobby: Lobby): SlotWithIndexes[] {
  return lobby.teams.flatMap((team, teamIndex) =>
    team.slots.map((slot, slotIndex): SlotWithIndexes => [teamIndex, slotIndex, slot]),
  )
}

/**
 * Returns an array of tuples with info for each slot in the lobby, including possible UMS hidden
 * slots that are necessary for game initialization.
 */
export function getIngameLobbySlotsWithIndexes(lobby: Lobby): SlotWithIndexes[] {
  return lobby.teams.flatMap((team, teamIndex) =>
    team.slots
      .concat(team.hiddenSlots)
      .map((slot, slotIndex): SlotWithIndexes => [teamIndex, slotIndex, slot]),
  )
}

/**
 * Returns an array of `PlayerInfo` objects that can be used to initialize a game from this lobby.
 */
export function getPlayerInfos(lobby: Lobby): PlayerInfo[] {
  return getIngameLobbySlotsWithIndexes(lobby)
    .filter(
      ([teamIndex, , slot]) =>
        // An observer slot with nobody in it has no in-game counterpart — the game reserves its
        // observer slots unconditionally — and emitting one would claim a game slot meant for a
        // player.
        !lobby.teams[teamIndex].isObserver || slot.type === SlotType.Observer,
    )
    .map(([teamIndex, _slotIndex, slot]) => ({
      id: slot.id,
      userId: slot.userId,
      race: slot.race,
      playerId: slot.playerId,
      type: slot.type,
      typeId: slot.typeId,
      teamId: lobby.teams[teamIndex]?.teamId ?? 0,
    }))
}

/**
 * Finds the slot with the specified user ID in the lobby. Only works for `human` type slots (other
 * type of slots do not have valid user IDs). Returns the [teamIndex, slotIndex, slot] tuple if the
 * player is found; otherwise returns an empty array.
 */
export function findSlotByUserId(lobby: Lobby, userId: SbUserId): SlotWithIndexes | [] {
  const slot = getLobbySlotsWithIndexes(lobby).find(([, , slot]) => slot.userId === userId)
  return slot ? slot : []
}

/**
 * Finds the slot with the specified id in the lobby. Returns the [teamIndex, slotIndex, slot] tuple
 * if the slot is found; otherwise returns an empty array.
 */
export function findSlotById(lobby: Lobby, id: string): SlotWithIndexes | [] {
  const slot = getLobbySlotsWithIndexes(lobby).find(([, , slot]) => slot.id === id)
  return slot ? slot : []
}

/**
 * Returns the total number of slots for a particular lobby. This function excludes the observer
 * team.
 */
export function slotCount(lobby: Lobby): number {
  return lobby.teams
    .filter(team => !team.isObserver)
    .reduce((slots, team) => slots + team.slots.length, 0)
}

/**
 * Returns the number of `human` type slots for a particular lobby. Useful for determining if the
 * lobby should be closed, for example, if there are no human players in it.
 */
export function humanSlotCount(lobby: Lobby): number {
  return lobby.teams.reduce(
    (humanSlots, team) =>
      humanSlots +
      team.slots.filter(slot => slot.type === SlotType.Human || slot.type === SlotType.Observer)
        .length,
    0,
  )
}

/**
 * Returns the number of "player" slots for a particular team, ie. are considered when determining
 * if the game can start.
 *
 * Player slot types for now are: `human`, `computer`, `umsComputer`
 */
export function teamPlayerSlotCount(team: Team): number {
  return team.slots.filter(
    slot =>
      slot.type === SlotType.Human ||
      slot.type === SlotType.Computer ||
      slot.type === SlotType.UmsComputer,
  ).length
}

/**
 * Returns the number of "taken" slots for a particular lobby, ie. all the slots that are not `open`
 * or `controlledOpen`. This function excludes the observer team.
 */
export function takenSlotCount(lobby: Lobby): number {
  return lobby.teams
    .filter(team => !team.isObserver)
    .reduce((takenSlots, team) => takenSlots + teamTakenSlotCount(team), 0)
}

/**
 * Returns the number of "taken" slots for a particular team, ie. all the slots that are not `open`
 * or `controlledOpen`.
 */
export function teamTakenSlotCount(team: Team): number {
  return team.slots.filter(
    slot => slot.type !== SlotType.Open && slot.type !== SlotType.ControlledOpen,
  ).length
}

/**
 * Returns the number of "open" slots for a particular lobby, ie. available for someone to join in.
 *
 * Open slot types for now are: `open`, `controlledOpen`
 */
export function openSlotCount(lobby: Lobby): number {
  return lobby.teams.reduce(
    (openSlots, team) =>
      openSlots +
      team.slots.filter(
        slot => slot.type === SlotType.Open || slot.type === SlotType.ControlledOpen,
      ).length,
    0,
  )
}

/**
 * Returns whether or not a lobby has 2 or more opposing sides (and thus would be suitable for
 * starting a game from).
 */
export function hasOpposingSides(lobby: Lobby): boolean {
  return !isTeamType(lobby.gameType)
    ? getPlayerSlots(lobby).length > 1
    : lobby.teams.filter(team => !team.isObserver && teamPlayerSlotCount(team) > 0).length > 1
}

/** Returns true if the lobby has an observer team; false otherwise. */
export function hasObservers(lobby: Lobby): boolean {
  return lobby.teams.reduce<boolean>((hasObserver, team) => hasObserver || team.isObserver, false)
}

/**
 * Returns a [teamIndex, team] tuple if the observer team is found.
 *
 * If the observer team is not found, it returns a [undefined, undefined] tuple, so you should
 * always check the return value of this function to make sure you actually received the observer
 * team.
 */
export function getObserverTeam(lobby: Lobby): [teamIndex?: number, team?: Team] {
  return hasObservers(lobby)
    ? lobby.teams
        .map<[teamIndex: number, team: Team]>((team, teamIndex) => [teamIndex, team])
        .find(([, team]) => team.isObserver)!
    : [undefined, undefined]
}

/**
 * Returns whether a slot has nobody in it, and can therefore receive someone moving into it. Note
 * that this includes closed slots: they are unoccupied, they just can't be joined into directly.
 */
export function isSlotUnoccupied(slot: Slot): boolean {
  return (
    slot.type === SlotType.Open ||
    slot.type === SlotType.Closed ||
    slot.type === SlotType.ControlledOpen ||
    slot.type === SlotType.ControlledClosed
  )
}

/** Checks if the lobby has an observer slot free for someone to be moved into. */
export function canAddObservers(lobby: Lobby): boolean {
  const [, observerTeam] = getObserverTeam(lobby)
  return !!observerTeam?.slots.some(isSlotUnoccupied)
}

/** Checks if the lobby has an observer that could be moved into a free player slot. */
export function canRemoveObservers(lobby: Lobby): boolean {
  const [, observerTeam] = getObserverTeam(lobby)
  if (!observerTeam?.slots.some(slot => slot.type === SlotType.Observer)) {
    return false
  }
  return lobby.teams.some(team => !team.isObserver && team.slots.some(isSlotUnoccupied))
}
