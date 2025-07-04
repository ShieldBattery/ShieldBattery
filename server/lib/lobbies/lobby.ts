import { List, Range } from 'immutable'
import { GameType, isTeamType } from '../../../common/games/game-type'
import {
  Lobby,
  MAX_OBSERVERS,
  Team,
  canAddObservers,
  canRemoveObservers,
  getLobbySlots,
  getLobbySlotsWithIndexes,
  getObserverTeam,
  hasObservers,
  humanSlotCount,
  isInObserverTeam,
  isUms,
  openSlotCount,
  slotCount,
  takenSlotCount,
  teamTakenSlotCount,
} from '../../../common/lobbies'
import { LobbySummaryJson } from '../../../common/lobbies/lobby-network'
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
import { BwTurnRate } from '../../../common/network'
import { RaceChar } from '../../../common/races'
import { SbUserId } from '../../../common/users/sb-user-id'

export function hasControlledOpens(gameType: GameType) {
  return gameType === GameType.TeamMelee || gameType === GameType.TeamFreeForAll
}

export function hasDynamicObsSlots(gameType: GameType) {
  return gameType === GameType.Melee
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
  // distribute each of the slots into their respective teams. This distribution of slots shouldn't
  // change at all during the lifetime of a lobby, except when creating/deleting observer slots,
  // which will be handled separately
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
        originalSize: teamSlots.size,
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
  allowObservers,
  turnRate,
  useLegacyLimits = false,
}: {
  name: string
  map: MapInfo
  gameType: GameType
  gameSubType?: number
  numSlots: number
  hostUserId: SbUserId
  hostRace?: RaceChar
  allowObservers: boolean
  turnRate?: BwTurnRate | 0
  useLegacyLimits?: boolean
}) {
  let teams = createInitialTeams(map, gameType, gameSubType, numSlots)
  if (gameType === GameType.Melee && allowObservers) {
    const observerCount = Math.min(
      8 - teams.reduce((sum, team) => sum + team.slots.size, 0),
      MAX_OBSERVERS,
    )
    const observerSlots = Range(0, observerCount)
      .map(() => createClosed())
      .toList()
    const observerTeam = new Team({
      name: 'Observers',
      isObserver: true,
      slots: observerSlots,
    })
    teams = teams.concat(List.of(observerTeam))
  }

  const lobby = new Lobby({
    name,
    map,
    gameType,
    gameSubType: +gameSubType,
    teams,
    host: new Slot(),
    turnRate,
    useLegacyLimits,
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
  return hasControlledOpens(lobby.gameType) && isTeamEmpty(team)
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
  const openSlot = isUms(lobby.gameType)
    ? createOpen(toRemove.race, toRemove.hasForcedRace, toRemove.playerId)
    : createOpen()
  let updated = hasControlledOpens(lobby.gameType)
    ? removePlayerAndControlledSlots(lobby, teamIndex, slotIndex)
    : lobby.setIn(['teams', teamIndex, 'slots', slotIndex], openSlot)

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
 * "Moves" one slot to another. For now it's only possible to move a `human` type slot to `open` or
 * `controlledOpen` type slot. Once the player is moved, there can be multiple side-effects:
 *
 * 1) in melee/ffa/tvb lobby, there are no side-effects
 * 2) in ums lobby, dest slot might have forced race, while the source slot did not or is different
 * 3) in team melee/ffa lobby
 *  3.1) the source and dest slots are in the same team, no side-effects
 *  3.2) the source and dest slots are in different teams
 *    3.2.1) the team of source slot will become empty after move
 *    3.2.2) the team of source slot will have remaining players
 *      3.2.2.1) the slot that moved was the "controller" of that team
 *      3.2.2.2) the slot that moved was not the "controller" of that team
 *    3.2.3) the team of dest slot was empty before the move
 *    3.2.4) the team of dest slot was not empty before the move
 */
export function movePlayerToSlot(
  lobby: Lobby,
  sourceTeamIndex: number,
  sourceSlotIndex: number,
  destTeamIndex: number,
  destSlotIndex: number,
): Lobby {
  let sourceSlot = lobby.teams.get(sourceTeamIndex)!.slots.get(sourceSlotIndex)!
  const destSlot = lobby.teams.get(destTeamIndex)!.slots.get(destSlotIndex)!
  if (!hasControlledOpens(lobby.gameType)) {
    let openSlot: Slot
    let updated = lobby
    if (!isUms(lobby.gameType)) {
      // 1) case - move the source slot to the destination slot and create an `open` slot at the
      // source slot
      openSlot = createOpen()
    } else {
      // 2) case - in UMS games, when player moves to a different slot, it's possible that the
      // destination slot has a forced race, while the source slot didn't. Also, `playerId` of the
      // moving player needs to change to the value of the destination slot.
      const orig = sourceSlot
      sourceSlot = sourceSlot.set('playerId', destSlot.playerId)
      sourceSlot = destSlot.hasForcedRace
        ? sourceSlot.set('race', destSlot.race).set('hasForcedRace', true)
        : sourceSlot.set('hasForcedRace', false)
      openSlot = createOpen(orig.race, orig.hasForcedRace, orig.playerId)
      if (orig === lobby.host) {
        // It was the host who moved to a different slot; update the lobby host record because it
        // now has a different `playerId` and potentially a different `race`
        updated = updated.set('host', sourceSlot)
      }
    }

    const hasObs = hasObservers(updated)
    if (hasObs && isInObserverTeam(updated, destSlot) && sourceSlot.type !== SlotType.Observer) {
      // If the destination slot is in the observer team, and the source slot is not already an
      // observer, update the player to an `observer` type slot
      sourceSlot = sourceSlot.set('type', SlotType.Observer)
    }

    if (hasObs && isInObserverTeam(updated, sourceSlot) && !isInObserverTeam(updated, destSlot)) {
      // If the source slot is in the observer team and the destination slot is not, change the
      // observer to a `human` type slot
      sourceSlot = sourceSlot.set('type', SlotType.Human)
    }

    return updated
      .setIn(['teams', destTeamIndex, 'slots', destSlotIndex], sourceSlot)
      .setIn(['teams', sourceTeamIndex, 'slots', sourceSlotIndex], openSlot)
  } else {
    // 3) case - in team melee/ffa lobbies, there can be quite a few side-effects; handle them below
    if (sourceTeamIndex === destTeamIndex) {
      // 3.1) case - move the source slot to the destination slot and create a `controlledOpen` slot
      // at the source
      return lobby
        .setIn(['teams', destTeamIndex, 'slots', destSlotIndex], sourceSlot)
        .setIn(
          ['teams', sourceTeamIndex, 'slots', sourceSlotIndex],
          createControlledOpen('r', destSlot.controlledBy!),
        )
    } else {
      let updated: Lobby
      if (isTeamEmpty(lobby.teams.get(destTeamIndex)!)) {
        // 3.2.3) case - move the source slot (player) to the destination team and fill out the rest
        // of its slots properly
        updated = addPlayerAndControlledSlots(lobby, destTeamIndex, destSlotIndex, sourceSlot)
      } else {
        // 3.2.4) case - move the source slot to the destination slot
        updated = lobby.setIn(['teams', destTeamIndex, 'slots', destSlotIndex], sourceSlot)
      }
      // 3.2.1) and 3.2.2) case - clean up the controlled team which the player is leaving
      return removePlayerAndControlledSlots(updated, sourceTeamIndex, sourceSlotIndex)
    }
  }
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

/** Moves a regular slot to the observer team. */
export function makeObserver(lobby: Lobby, teamIndex: number, slotIndex: number): Lobby {
  if (!hasDynamicObsSlots(lobby.gameType)) {
    throw new Error('Lobby type not supported')
  }
  if (!canAddObservers(lobby)) {
    throw new Error('Cannot add more observers')
  }
  const team = lobby.teams.get(teamIndex)!
  if (team.isObserver) {
    throw new Error("Trying to make an observer from obs team's slot")
  }
  if (team.slots.size <= 1) {
    throw new Error('Cannot make observer from the last slot in team')
  }
  const slot = team.slots.get(slotIndex)!
  if (
    slot.type !== SlotType.Open &&
    slot.type !== SlotType.Closed &&
    slot.type !== SlotType.Human
  ) {
    throw new Error('Trying to make observer from an invalid slot type: ' + slot.type)
  }
  const [obsTeamIndex, obsTeam] = getObserverTeam(lobby)
  // We create a new slot in obs team and move human to it, or just replicate the slot there,
  // and then delete the original slot.
  if (slot.type === SlotType.Human) {
    const newSlot = createOpen()
    lobby = lobby.setIn(['teams', obsTeamIndex, 'slots'], obsTeam!.slots.push(newSlot))
    lobby = movePlayerToSlot(lobby, teamIndex, slotIndex, obsTeamIndex!, obsTeam!.slots.size)
  } else {
    const newSlot = slot.type === SlotType.Open ? createOpen() : createClosed()
    lobby = lobby.setIn(['teams', obsTeamIndex, 'slots'], obsTeam!.slots.push(newSlot))
  }
  return lobby.deleteIn(['teams', teamIndex, 'slots', slotIndex])
}

/**
 * Moves a slot from the observer team to players. The team that the slot gets moved to is the
 * smallest one with space for players.
 */
export function removeObserver(lobby: Lobby, slotIndex: number): Lobby {
  if (!hasDynamicObsSlots(lobby.gameType)) {
    throw new Error('Lobby type not supported')
  }
  if (!canRemoveObservers(lobby)) {
    throw new Error('Cannot remove more observers')
  }
  const [obsTeamIndex, obsTeam] = getObserverTeam(lobby)

  const slot = obsTeam!.slots.get(slotIndex)!
  const [newTeam, newTeamIndex] = lobby.teams
    .filter(team => !team.isObserver && team.slots.size !== team.originalSize)
    .map<[team: Team, index: number]>((team, index) => [team, index])
    .minBy(([team]) => team.slots.size)!

  // We create a new slot in the team and move human to it, or just replicate the slot there,
  // and then delete the original slot.
  if (slot.type === SlotType.Observer) {
    const newSlot = createOpen()
    lobby = lobby.setIn(['teams', newTeamIndex, 'slots'], newTeam.slots.push(newSlot))
    lobby = movePlayerToSlot(lobby, obsTeamIndex!, slotIndex, newTeamIndex, newTeam.slots.size)
  } else {
    const newSlot = slot.type === SlotType.Open ? createOpen() : createClosed()
    lobby = lobby.setIn(['teams', newTeamIndex, 'slots'], newTeam.slots.push(newSlot))
  }
  return lobby.deleteIn(['teams', obsTeamIndex, 'slots', slotIndex])
}
