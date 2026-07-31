import { List, Range } from 'immutable'
import { randomUUID } from 'node:crypto'
import { GameServerRegionId } from '../../../common/game-server-regions'
import { GameType, isTeamType } from '../../../common/games/game-type'
import {
  Lobby,
  LobbyVisibility,
  MAX_OBSERVERS,
  Team,
  getLobbySlots,
  getLobbySlotsWithIndexes,
  getObserverTeam,
  hasObservers,
  humanSlotCount,
  isSlotUnoccupied,
  isUms,
  openSlotCount,
  slotCount,
  takenSlotCount,
  teamTakenSlotCount,
} from '../../../common/lobbies'
import { LobbySummaryJson } from '../../../common/lobbies/lobby-network'
import { makeSbLobbyId } from '../../../common/lobbies/sb-lobby-id'
import {
  Slot,
  SlotType,
  createClosed,
  createComputer,
  createControlledClosed,
  createControlledOpen,
  createHuman,
  createOpen,
  createUmsComputer,
} from '../../../common/lobbies/slot'
import { MapForce, MapInfo, getTeamNames, numTeams, toMapInfoJson } from '../../../common/maps'
import { encodePrettyId } from '../../../common/pretty-id'
import { RaceChar } from '../../../common/races'
import { SbUserId } from '../../../common/users/sb-user-id'

export function hasControlledOpens(gameType: GameType) {
  return gameType === GameType.TeamMelee || gameType === GameType.TeamFreeForAll
}

export function isTeamEmpty(team: Team) {
  // Team is deemed empty if it's only consisted of open and/or closed type of slots
  return team.slots.every(slot => slot.type === SlotType.Open || slot.type === SlotType.Closed)
}

export function getSlotsPerControlledTeam(gameSubType: number) {
  switch (gameSubType) {
    case 2:
      return [4, 4]
    case 3:
      return [3, 3, 2]
    case 4:
      return [2, 2, 2, 2]
    default:
      throw new Error('Unknown game sub-type: ' + gameSubType)
  }
}

export function getSlotsPerTeam(
  gameType: GameType,
  gameSubType: number,
  numSlots: number,
  umsForces: MapForce[],
) {
  switch (gameType) {
    case 'melee':
    case 'ffa':
    case 'oneVOne':
      return [numSlots]
    case 'topVBottom':
      return [gameSubType, numSlots - gameSubType]
    case 'teamMelee':
    case 'teamFfa':
      return getSlotsPerControlledTeam(gameSubType)
    case 'ums':
      return umsForces.map(f => f.players.length)
    default:
      throw new Error('Unknown game type: ' + gameType)
  }
}

/**
 * Serializes a lobby to a summary-form in JSON, suitable for e.g. displaying a list of all the open
 * lobbies.
 */
export function toSummaryJson(lobby: Lobby): LobbySummaryJson {
  return {
    id: lobby.id,
    name: lobby.name,
    map: toMapInfoJson(lobby.map!),
    gameType: lobby.gameType,
    gameSubType: lobby.gameSubType,
    host: { id: lobby.host.userId! },
    openSlotCount: openSlotCount(lobby),
  }
}

/**
 * Finds the next available slot in the lobby (ie. `open` or `controlledOpen` slot type).
 *
 * @returns the `[teamIndex, slotIndex, slot]` tuple of the available slot if found. If there are no
 * available slots, it returns a [undefined, undefined, undefined] tuple.
 */
export function findAvailableSlot(
  lobby: Lobby,
):
  | [teamIndex: undefined, slotIndex: undefined, slot: undefined]
  | [teamIndex: number, slotIndex: number, slot: Slot] {
  const slotsCount = slotCount(lobby)
  const takenCount = takenSlotCount(lobby)
  if (slotsCount <= takenCount) {
    // There are no available slots in the regular teams. Check if there is an observer team and see
    // if there is available space there.
    if (hasObservers(lobby)) {
      const [teamIndex, observerTeam] = getObserverTeam(lobby)
      // Find the first available slot in the observer team
      const slotIndex = observerTeam!.slots.findIndex(slot => slot.type === SlotType.Open)
      return slotIndex !== -1
        ? [teamIndex!, slotIndex, observerTeam!.slots.get(slotIndex)!]
        : [undefined, undefined, undefined]
    } else {
      // There is no available slot in the lobby
      return [undefined, undefined, undefined]
    }
  }

  // To choose the team of the empty slot, first filter out any teams that are full, then sort the
  // remaining teams such that first team in the resulting list is the one with the least number of
  // players (ie. the highest number of available slots). Note that we're excluding the observer
  // team from this algorithm, because we've handled the observer team above.
  const availableTeam = lobby.teams
    .filterNot(team => team.isObserver)
    .map<[index: number, team: Team]>((team, teamIndex) => [teamIndex, team])
    .filter(([, team]) => teamTakenSlotCount(team) < team.slots.size)
    .sort(([, a], [, b]) => {
      const availableCountA = a.slots.size - teamTakenSlotCount(a)
      const availableCountB = b.slots.size - teamTakenSlotCount(b)
      if (availableCountA > availableCountB) return -1
      else if (availableCountA < availableCountB) return 1
      else return 0
    })
    .first()!

  const [teamIndex, team] = availableTeam
  // After finding the available team, find the first available slot in that team and return its
  // team index, slot index, and slot
  const slotIndex = team.slots.findIndex(
    slot => slot.type === SlotType.Open || slot.type === SlotType.ControlledOpen,
  )
  return [teamIndex, slotIndex, team.slots.get(slotIndex)!]
}

function createInitialTeams(
  map: MapInfo,
  gameType: GameType,
  gameSubType: number,
  numSlots: number,
) {
  // When creating a lobby, we first create all the individual slots for the lobby, and then we
  // distribute each of the slots into their respective teams. The number of slots in each team is
  // fixed for the lifetime of the lobby; only the contents of the slots ever change.
  const slotsPerTeam = getSlotsPerTeam(gameType, gameSubType, numSlots, map.mapData.umsForces)
  let slots: List<Slot>
  if (!isUms(gameType)) {
    slots = Range(0, numSlots)
      .map(() => createOpen())
      .toList()
  } else {
    slots = List(
      map.mapData.umsForces.flatMap(force =>
        force.players.map(player => {
          const playerId = player.id
          const playerRace = player.race
          const race = playerRace !== 'any' ? playerRace : 'r'
          const hasForcedRace = playerRace !== 'any'
          return player.computer
            ? createUmsComputer(race, playerId, player.typeId)
            : createOpen(race, hasForcedRace, playerId)
        }),
      ),
    )
  }

  const teamNames = getTeamNames({ gameType, gameSubType, umsForces: map.mapData.umsForces })
  let slotIndex = 0
  return Range(0, numTeams(gameType, gameSubType, map.mapData.umsForces))
    .map(teamIndex => {
      let teamSlots = slots.slice(slotIndex, slotIndex + slotsPerTeam[teamIndex])
      let hiddenSlots
      slotIndex += slotsPerTeam[teamIndex]
      const teamName = teamNames[teamIndex]
      let teamId
      if (isUms(gameType)) {
        // Player type 5 means regular computer and 6 means human
        const isHiddenSlot = (player: Slot) => player.typeId !== 5 && player.typeId !== 6
        teamId = map.mapData.umsForces[teamIndex].teamId
        hiddenSlots = teamSlots.filter(isHiddenSlot)
        teamSlots = teamSlots.filterNot(isHiddenSlot)
      } else {
        hiddenSlots = List<Slot>()
        teamId = isTeamType(gameType) ? teamIndex + 1 : teamIndex
      }

      return new Team({
        name: teamName,
        teamId,
        slots: teamSlots,
        hiddenSlots,
      })
    })
    .toList()
}

/** Creates a new lobby, and an initial host player in the first slot. */
export function createLobby({
  name,
  map,
  gameType,
  gameSubType = 0,
  numSlots,
  hostUserId,
  hostRace = 'r',
  hostRegion,
  allowObservers,
  useLegacyLimits = false,
  visibility = 'listed',
}: {
  name: string
  map: MapInfo
  gameType: GameType
  gameSubType?: number
  numSlots: number
  hostUserId: SbUserId
  hostRace?: RaceChar
  /** The host's chosen home game-server region, stored on their slot for session-create placement. */
  hostRegion?: GameServerRegionId
  allowObservers: boolean
  useLegacyLimits?: boolean
  visibility?: LobbyVisibility
}) {
  let teams = createInitialTeams(map, gameType, gameSubType, numSlots)
  if (allowObservers) {
    // Observer slots sit alongside the map's player slots rather than being taken from them, so
    // every game type gets the same fixed-size observer team. They start closed, so a lobby only
    // takes on observers once someone deliberately opens a slot or is moved into one.
    const observerTeam = new Team({
      name: 'Observers',
      isObserver: true,
      slots: Range(0, MAX_OBSERVERS)
        .map(() => createClosed())
        .toList(),
    })
    teams = teams.push(observerTeam)
  }

  const lobby = new Lobby({
    id: makeSbLobbyId(encodePrettyId(randomUUID())),
    name,
    map,
    gameType,
    gameSubType: +gameSubType,
    teams,
    host: new Slot(),
    useLegacyLimits,
    visibility,
  })
  let host
  const [hostTeamIndex, hostSlotIndex, hostSlot] = getLobbySlotsWithIndexes(lobby)
    .filter(([teamIndex, slotIndex, slot]) => slot.type === SlotType.Open)
    .min()!

  if (!isUms(gameType)) {
    host = createHuman(hostUserId, hostRace)
  } else {
    host = createHuman(hostUserId, hostSlot.race, hostSlot.hasForcedRace, hostSlot.playerId)
  }
  host = host.set('region', hostRegion)
  return addPlayer(lobby, hostTeamIndex, hostSlotIndex, host).set('host', host)
}

/**
 * A helper function that is used when a player joins an empty team in team melee/ffa game types.
 * Join can be triggered by player joining the lobby, adding a computer to the empty controlled team
 * or moving to the slot of an empty controlled team. Returns the updated lobby.
 */
function addPlayerAndControlledSlots(
  lobby: Lobby,
  teamIndex: number,
  slotIndex: number,
  player: Slot,
): Lobby {
  // The team which the new player is joining is empty (ie. it has only open and/or closed slots);
  // fill the whole team with either computer slots or controlled slots (leaving the slot of the new
  // player as is)
  const team = lobby.teams.get(teamIndex)!
  const slots = team.slots.map((currentSlot, currentSlotIndex) => {
    if (currentSlotIndex === slotIndex) return player
    if (player.type === SlotType.Computer) {
      return createComputer(player.race)
    } else {
      // If the human player is joining empty controlled team, check if the currentSlot is `closed`,
      // in which case create a `controlledClosed` type of slot in its place. This type of slot is
      // used in team melee/ffa game types where a closed slot still have its race set, which
      // affects race composition in the game, but no one can join that slot.
      return currentSlot.type === SlotType.Closed
        ? // TODO(2Pac): Set the races of these slots to 'r' instead?
          createControlledClosed(player.race, player.id)
        : createControlledOpen(player.race, player.id)
    }
  })
  return lobby.setIn(['teams', teamIndex, 'slots'], slots)
}

export function addPlayer(lobby: Lobby, teamIndex: number, slotIndex: number, player: Slot): Lobby {
  const team = lobby.teams.get(teamIndex)!
  // The observer team never holds controlled slots, so someone arriving in an observer slot of a
  // team game must not trigger the controlled-slot fill an empty player team would get.
  return hasControlledOpens(lobby.gameType) && !team.isObserver && isTeamEmpty(team)
    ? addPlayerAndControlledSlots(lobby, teamIndex, slotIndex, player)
    : lobby.setIn(['teams', teamIndex, 'slots', slotIndex], player)
}

/** Updates the race of a particular player, returning the updated lobby. */
export function setRace(
  lobby: Lobby,
  teamIndex: number,
  slotIndex: number,
  newRace: RaceChar,
): Lobby {
  const team = lobby.teams.get(teamIndex)!
  if (
    hasControlledOpens(lobby.gameType) &&
    team.slots.count(slot => slot.type === SlotType.Computer) > 0
  ) {
    // BW doesn't support computer teams in team melee having different races. Change all races
    // of a computer team at once.
    // The exact limitation is with some but not all slots being random, we could allow multiple
    // non-random races but the AI won't be able to take advantage of it anyway.
    const slots = team.slots.map(slot => slot.set('race', newRace))
    return lobby.setIn(['teams', teamIndex, 'slots'], slots)
  } else {
    return lobby.setIn(['teams', teamIndex, 'slots', slotIndex, 'race'], newRace)
  }
}

/**
 * A helper function that is used when a player leaves a team in team melee/ffa game types. Leave
 * can be triggered by player leaving the lobby, being kicked/banned, moving the slot etc. Returns
 * the updated lobby.
 */
function removePlayerAndControlledSlots(lobby: Lobby, teamIndex: number, playerIndex: number) {
  const team = lobby.teams.get(teamIndex)!
  const id = team.slots.get(playerIndex)!.id
  if (
    team.slots.count(slot => slot.type === SlotType.Human) === 1 ||
    team.slots.count(slot => slot.type === SlotType.Computer) > 0
  ) {
    // The player that is leaving is alone in this team, so to remove them we replace the whole team
    // with either opened or closed slots. Same goes if we're removing a computer in team melee/ffa
    // lobby.
    const slots = team.slots.map(currentSlot => {
      return currentSlot.type === SlotType.ControlledClosed ? createClosed() : createOpen()
    })
    return lobby.setIn(['teams', teamIndex, 'slots'], slots)
  } else {
    // The team which the player is leaving has other human players in it; find the new oldest human
    // player in the team and:
    //  1) create a new controlled open with controlledBy set to their ID
    //  2) update any controlled slots with controlledBy set to the leaver's ID to that ID
    const oldestInTeam = team.slots
      .filter(slot => slot.type === SlotType.Human && slot.id !== id)
      .sortBy(p => p.joinedAt)
      .first()!
    return lobby.updateIn(['teams', teamIndex, 'slots'], slotsUntyped => {
      const slots = slotsUntyped as List<Slot>
      return slots.map(slot => {
        if (slot.id === id) {
          return createControlledOpen(slot.race, oldestInTeam.id)
        } else if (slot.controlledBy === id) {
          return slot.set('controlledBy', oldestInTeam.id)
        } else {
          return slot
        }
      })
    })
  }
}

/**
 * Removes the player at the specified `teamIndex` and `slotIndex` from a lobby, returning the
 * updated lobby. If the lobby is closed (e.g. because it no longer has any human players),
 * `undefined` will be returned. Note that if the host is being removed, a new, suitable host will
 * be chosen.
 */
export function removePlayer(
  lobby: Lobby,
  teamIndex: number,
  slotIndex: number,
  toRemove: Slot,
): Lobby | undefined {
  if (!toRemove) {
    // nothing removed, e.g. player wasn't in the lobby
    return lobby
  }
  const team = lobby.teams.get(teamIndex)!
  // A vacated slot is always left open for the next joiner; the host can close it if unwanted.
  // Observer slots carry no map data, so they get a plain open slot even in UMS. The observer
  // team also never holds controlled slots, so a departing observer skips the controlled-team
  // cleanup even in game types whose player teams need it.
  const vacatedSlot =
    isUms(lobby.gameType) && !team.isObserver
      ? createOpen(toRemove.race, toRemove.hasForcedRace, toRemove.playerId)
      : createOpen()
  let updated =
    hasControlledOpens(lobby.gameType) && !team.isObserver
      ? removePlayerAndControlledSlots(lobby, teamIndex, slotIndex)
      : lobby.setIn(['teams', teamIndex, 'slots', slotIndex], vacatedSlot)

  if (humanSlotCount(updated) < 1) {
    return undefined
  }

  if (lobby.host.id === toRemove.id) {
    // The player we removed was the host, find a new host (the "oldest" player in lobby)
    const newHost = getLobbySlots(updated)
      .filter(slot => slot.type === SlotType.Human || slot.type === SlotType.Observer)
      .sortBy(p => p.joinedAt)
      .first()!
    updated = updated.set('host', newHost)
  }

  return updated
}

/**
 * "Moves" the occupant of one slot into another slot, leaving an unoccupied slot behind. The
 * source is expected to hold a `human` or `observer`, and the destination to be unoccupied. Team
 * sizes never change; only slot contents do.
 *
 * Depending on the game type and the teams involved, the move has additional effects:
 *
 * - In UMS lobbies, a slot's `playerId` and forced race come from the map, so the occupant takes on
 *   the destination slot's values and leaves the source slot's behind.
 * - Crossing the observer team's boundary retypes the occupant, since the observer team holds
 *   `observer` slots and every other team holds `human` ones.
 * - In team melee/ffa lobbies, the player teams are made of slots controlled by whoever is in them,
 *   so leaving a team can empty it or hand control of its slots to a remaining player, and entering
 *   an empty team fills the rest of it with slots the arriving player controls. The observer team
 *   never holds controlled slots, so a move into or out of it skips that handling on that side.
 */
export function movePlayerToSlot(
  lobby: Lobby,
  sourceTeamIndex: number,
  sourceSlotIndex: number,
  destTeamIndex: number,
  destSlotIndex: number,
): Lobby {
  const sourceTeam = lobby.teams.get(sourceTeamIndex)!
  const destTeam = lobby.teams.get(destTeamIndex)!
  const originalSlot = sourceTeam.slots.get(sourceSlotIndex)!
  const destSlot = destTeam.slots.get(destSlotIndex)!

  let movedSlot = originalSlot
  if (isUms(lobby.gameType)) {
    movedSlot = movedSlot.set('playerId', destSlot.playerId)
    movedSlot = destSlot.hasForcedRace
      ? movedSlot.set('race', destSlot.race).set('hasForcedRace', true)
      : movedSlot.set('hasForcedRace', false)
  }
  if (destTeam.isObserver) {
    movedSlot = movedSlot.set('type', SlotType.Observer)
  } else if (sourceTeam.isObserver) {
    movedSlot = movedSlot.set('type', SlotType.Human)
  }

  let updated = lobby
  if (originalSlot.id === lobby.host.id) {
    // The lobby's host is a copy of their slot, so it has to follow along with any changes the move
    // made to it.
    updated = updated.set('host', movedSlot)
  }

  if (hasControlledOpens(lobby.gameType) && !destTeam.isObserver && isTeamEmpty(destTeam)) {
    updated = addPlayerAndControlledSlots(updated, destTeamIndex, destSlotIndex, movedSlot)
  } else {
    updated = updated.setIn(['teams', destTeamIndex, 'slots', destSlotIndex], movedSlot)
  }

  if (hasControlledOpens(lobby.gameType) && !sourceTeam.isObserver) {
    if (sourceTeamIndex === destTeamIndex) {
      updated = updated.setIn(
        ['teams', sourceTeamIndex, 'slots', sourceSlotIndex],
        createControlledOpen('r', destSlot.controlledBy!),
      )
    } else {
      updated = removePlayerAndControlledSlots(updated, sourceTeamIndex, sourceSlotIndex)
    }
  } else {
    // A vacated slot is always left open for the next joiner; the host can close it if unwanted.
    // Observer slots carry no map data, so they get a plain open slot even in UMS.
    const vacated =
      isUms(lobby.gameType) && !sourceTeam.isObserver
        ? createOpen(originalSlot.race, originalSlot.hasForcedRace, originalSlot.playerId)
        : createOpen()
    updated = updated.setIn(['teams', sourceTeamIndex, 'slots', sourceSlotIndex], vacated)
  }

  return updated
}

/**
 * "Opens" a particular slot. This function is only possible to use to open a `closed` and
 * `controlledClosed` slot types. If you want to open a player slot, use the `removePlayer` function
 * instead, as that operation has side-effects, unlike this one.
 */
export function openSlot(lobby: Lobby, teamIndex: number, slotIndex: number): Lobby {
  const slotToOpen = lobby.teams.get(teamIndex)!.slots.get(slotIndex)!

  const openSlot = isUms(lobby.gameType)
    ? createOpen(slotToOpen.race, slotToOpen.hasForcedRace, slotToOpen.playerId)
    : createOpen()
  if (slotToOpen.type === SlotType.Closed) {
    return lobby.setIn(['teams', teamIndex, 'slots', slotIndex], openSlot)
  } else if (slotToOpen.type === SlotType.ControlledClosed) {
    return lobby.setIn(
      ['teams', teamIndex, 'slots', slotIndex],
      createControlledOpen(slotToOpen.race, slotToOpen.controlledBy!),
    )
  } else {
    throw new Error('trying to open an invalid slot type: ' + slotToOpen.type)
  }
}

/**
 * "Closes" a particular slot. This function is only possible to use to close an `open` and
 * `controlledOpen` slot types. If you want to close a player slot, make sure to first remove the
 * player from the slot and then close their slot with this function.
 */
export function closeSlot(lobby: Lobby, teamIndex: number, slotIndex: number) {
  const slotToClose = lobby.teams.get(teamIndex)!.slots.get(slotIndex)!

  const closedSlot = isUms(lobby.gameType)
    ? createClosed(slotToClose.race, slotToClose.hasForcedRace, slotToClose.playerId)
    : createClosed()
  if (slotToClose.type === SlotType.Open) {
    return lobby.setIn(['teams', teamIndex, 'slots', slotIndex], closedSlot)
  } else if (slotToClose.type === SlotType.ControlledOpen) {
    return lobby.setIn(
      ['teams', teamIndex, 'slots', slotIndex],
      createControlledClosed(slotToClose.race, slotToClose.controlledBy!),
    )
  } else {
    throw new Error('trying to close an invalid slot type: ' + slotToClose.type)
  }
}

/**
 * Finds the index of the slot in `slots` that a player should be moved into: the first one that
 * can be joined directly, or failing that the first unoccupied one. Returns -1 if every slot is
 * occupied.
 */
function findSlotToMoveInto(slots: List<Slot>): number {
  const openIndex = slots.findIndex(
    slot => slot.type === SlotType.Open || slot.type === SlotType.ControlledOpen,
  )
  return openIndex !== -1 ? openIndex : slots.findIndex(isSlotUnoccupied)
}

/**
 * Moves the player in a regular slot into a free slot of the observer team, opening the slot they
 * came from.
 */
export function makeObserver(lobby: Lobby, teamIndex: number, slotIndex: number): Lobby {
  const team = lobby.teams.get(teamIndex)!
  if (team.isObserver) {
    throw new Error("Trying to make an observer from obs team's slot")
  }
  const slot = team.slots.get(slotIndex)!
  if (slot.type !== SlotType.Human) {
    throw new Error('Trying to make observer from an invalid slot type: ' + slot.type)
  }
  const [obsTeamIndex, obsTeam] = getObserverTeam(lobby)
  if (obsTeamIndex === undefined) {
    throw new Error('Lobby does not allow observers')
  }
  // A closed observer slot is the preferred destination (the host asking for this is what opens
  // it up), so that a slot the host opened for joiners stays available to them.
  const obsSlots = obsTeam!.slots
  let obsSlotIndex = obsSlots.findIndex(s => s.type === SlotType.Closed)
  if (obsSlotIndex === -1) {
    obsSlotIndex = obsSlots.findIndex(isSlotUnoccupied)
  }
  if (obsSlotIndex === -1) {
    throw new Error('Cannot add more observers')
  }

  return movePlayerToSlot(lobby, teamIndex, slotIndex, obsTeamIndex, obsSlotIndex)
}

/**
 * Moves an observer back into a player slot. The team they get moved to is the one with the most
 * unoccupied slots, and the observer slot they came from is left open.
 */
export function removeObserver(lobby: Lobby, slotIndex: number): Lobby {
  const [obsTeamIndex, obsTeam] = getObserverTeam(lobby)
  if (obsTeamIndex === undefined) {
    throw new Error('Lobby does not allow observers')
  }
  const slot = obsTeam!.slots.get(slotIndex)!
  if (slot.type !== SlotType.Observer) {
    throw new Error('Trying to remove an observer from an invalid slot type: ' + slot.type)
  }

  const destTeam = lobby.teams
    .map<[teamIndex: number, team: Team]>((team, teamIndex) => [teamIndex, team])
    .filter(([, team]) => !team.isObserver && team.slots.some(isSlotUnoccupied))
    .maxBy(([, team]) => team.slots.count(isSlotUnoccupied))
  if (!destTeam) {
    throw new Error('Cannot remove more observers')
  }
  const [destTeamIndex, team] = destTeam

  return movePlayerToSlot(
    lobby,
    obsTeamIndex,
    slotIndex,
    destTeamIndex,
    findSlotToMoveInto(team.slots),
  )
}
