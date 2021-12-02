import { List, Record } from 'immutable'
import { GameType, isTeamType } from '../games/configuration'
import { MapInfo } from '../maps'
import { Slot } from './slot'

/**
 * The maximum number of observers allowed in a game, regardless of how many slots can be
 * converted.
 */
export const MAX_OBSERVERS = 4

export class Team extends Record({
  name: '',
  teamId: 0,
  isObserver: false,
  /** Slots that belong to a particular team. */
  slots: List<Slot>(),
  /**
   * Since slots can be made obs slots and that can be reverted, keep track of how many slots
   * there were originally.
   */
  originalSize: 0,
  /** UMS maps can have slots which are not shown in lobby but get initialized in game. */
  hiddenSlots: List<Slot>(),
}) {}

export class Lobby extends Record({
  name: '',
  map: undefined as MapInfo | undefined,
  gameType: GameType.Melee,
  gameSubType: 0,
  /** All lobbies have at least one team (even Melee and FFA). */
  teams: List<Team>(),
  host: new Slot(),
}) {}

export function isUms(gameType: GameType): gameType is GameType.UseMapSettings {
  return gameType === GameType.UseMapSettings
}

/**
 * Returns a List of all the slots in a lobby.
 *
 * Since we don't keep a separate list just for the slots, this function iterates over all of the
 * teams in a lobby and accumulates the slots into a new list. Keep in mind that you lose the team
 * index and slot index, so use this function only when you care about the slots themselves, not
 * their indexes; otherwise, use the `getLobbySlotsWithIndexes`.
 */
export function getLobbySlots(lobby: Lobby): List<Slot> {
  return lobby.teams.flatMap(team => team.slots)
}

/**
 * Gets all the player slots for a lobby, which for now are: `human`, `computer` and `umsComputer`
 * type slots.
 */
export function getPlayerSlots(lobby: Lobby): List<Slot> {
  return getLobbySlots(lobby).filter(
    slot => slot.type === 'human' || slot.type === 'computer' || slot.type === 'umsComputer',
  )
}

/** Gets all the human slots in a lobby. This includes both the players and the observers. */
export function getHumanSlots(lobby: Lobby): List<Slot> {
  return getLobbySlots(lobby).filter(slot => slot.type === 'human' || slot.type === 'observer')
}

type SlotWithIndexes = [teamIndex: number, slotIndex: number, slot: Slot]

/**
 * Returns a List of tuples with info for each slot in the lobby.
 *
 * This function is similar to the `getLobbySlots`, only it preserves the team index and slot index
 * after flat mapping the team, and as a result returns an immutable list where each element is in
 * the following form: [teamIndex, slotIndex, slot]
 */
export function getLobbySlotsWithIndexes(lobby: Lobby): List<SlotWithIndexes> {
  return lobby.teams.flatMap((team, teamIndex) =>
    team.slots.map((slot, slotIndex) => [teamIndex, slotIndex, slot]),
  )
}

/**
 * Returns a List of tuples with info for each slot in the lobby, including possible UMS hidden
 * slots that are necessary for game initialization.
 */
export function getIngameLobbySlotsWithIndexes(lobby: Lobby): List<SlotWithIndexes> {
  return lobby.teams.flatMap((team, teamIndex) =>
    team.slots.concat(team.hiddenSlots).map((slot, slotIndex) => [teamIndex, slotIndex, slot]),
  )
}

// TODO(tec27): Make this use user IDs, and also make the return types not dumb af lol
/**
 * Finds the slot with the specified name in the lobby. Only works for `human` type slots (other
 * type of slots do not have unique names). Returns the [teamIndex, slotIndex, slot] tuple if the
 * player is found; otherwise returns an empty array.
 */
export function findSlotByName(lobby: Lobby, name: string): SlotWithIndexes | [] {
  const slot = getLobbySlotsWithIndexes(lobby).find(
    ([, , slot]) => (slot.type === 'human' || slot.type === 'observer') && slot.name === name,
  )
  return slot ? slot : []
}

/**
 * Finds the slot with the specified id in the lobby. Returns the [teamIndex, slotIndex, slot] list
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
    .filterNot(team => team.isObserver)
    .reduce((slots, team) => slots + team.slots.size, 0)
}

/**
 * Returns the number of `human` type slots for a particular lobby. Useful for determining if the
 * lobby should be closed, for example, if there are no human players in it.
 */
export function humanSlotCount(lobby: Lobby): number {
  return lobby.teams.reduce(
    (humanSlots, team) =>
      humanSlots + team.slots.count(slot => slot.type === 'human' || slot.type === 'observer'),
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
  return team.slots.count(
    slot => slot.type === 'human' || slot.type === 'computer' || slot.type === 'umsComputer',
  )
}

/**
 * Returns the number of "taken" slots for a particular lobby, ie. all the slots that are not `open`
 * or `controlledOpen`. This function excludes the observer team.
 */
export function takenSlotCount(lobby: Lobby): number {
  return lobby.teams
    .filterNot(team => team.isObserver)
    .reduce((takenSlots, team) => takenSlots + teamTakenSlotCount(team), 0)
}

/**
 * Returns the number of "taken" slots for a particular team, ie. all the slots that are not `open`
 * or `controlledOpen`.
 */
export function teamTakenSlotCount(team: Team): number {
  return team.slots.count(slot => slot.type !== 'open' && slot.type !== 'controlledOpen')
}

/**
 * Returns the number of "open" slots for a particular lobby, ie. available for someone to join in.
 *
 * Open slot types for now are: `open`, `controlledOpen`
 */
export function openSlotCount(lobby: Lobby): number {
  return lobby.teams.reduce(
    (openSlots, team) =>
      openSlots + team.slots.count(slot => slot.type === 'open' || slot.type === 'controlledOpen'),
    0,
  )
}

/**
 * Returns whether or not a lobby has 2 or more opposing sides (and thus would be suitable for
 * starting a game from).
 */
export function hasOpposingSides(lobby: Lobby): boolean {
  return !isTeamType(lobby.gameType)
    ? getPlayerSlots(lobby).size > 1
    : lobby.teams.filter(team => !team.isObserver && teamPlayerSlotCount(team) > 0).size > 1
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

/** Checks whether a particular slot is inside the observer team. */
export function isInObserverTeam(lobby: Lobby, slot: Slot): boolean {
  const [, observerTeam] = getObserverTeam(lobby)
  return !!(observerTeam && observerTeam.slots.find(s => s.id === slot.id))
}

/** Checks if the lobby has any slots that can be made observers. */
export function canAddObservers(lobby: Lobby): boolean {
  const [, observerTeam] = getObserverTeam(lobby)
  return !!(observerTeam && observerTeam.slots.size < MAX_OBSERVERS)
}

/** Checks if the lobby has space for moving observers to players. */
export function canRemoveObservers(lobby: Lobby): boolean {
  if (!hasObservers(lobby)) return false
  return (
    lobby.teams.find(team => {
      return !team.isObserver && team.slots.size !== team.originalSize
    }) !== undefined
  )
}
