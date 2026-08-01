import { produce } from 'immer'
import { randomUUID } from 'node:crypto'
import { assertUnreachable } from '../../../common/assert-unreachable'
import { GameServerRegionId } from '../../../common/game-server-regions'
import { GameType, isTeamType } from '../../../common/games/game-type'
import {
  BenchedUser,
  Lobby,
  LobbyVisibility,
  MAX_OBSERVERS,
  SlotWithIndexes,
  Team,
  getLobbySlots,
  getObserverTeam,
  hasObservers,
  isLobbyEmpty,
  isSlotUnoccupied,
  isUms,
  slotCount,
  takenSlotCount,
  teamTakenSlotCount,
} from '../../../common/lobbies'
import {
  LobbyPreviewJson,
  LobbySummaryJson,
  LobbySummarySlotJson,
  LobbySummaryTeamJson,
} from '../../../common/lobbies/lobby-network'
import { makeSbLobbyId } from '../../../common/lobbies/sb-lobby-id'
import {
  Slot,
  SlotType,
  createClosed,
  createComputer,
  createControlledClosed,
  createControlledOpen,
  createHuman,
  createObserver,
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
 * Maps a slot to how lobby browsers see it: just enough about the occupant to render a preview row.
 * Controlled open/closed slots (team melee/FFA) read as plain open/closed, and UMS computers read as
 * computers, matching `LobbySummarySlotJson`'s narrower shape.
 */
function toSummarySlotJson(slot: Slot): LobbySummarySlotJson {
  switch (slot.type) {
    case SlotType.Human:
      return { type: 'human', userId: slot.userId!, race: slot.race }
    case SlotType.Observer:
      return { type: 'observer', userId: slot.userId! }
    case SlotType.Computer:
    case SlotType.UmsComputer:
      return { type: 'computer', race: slot.race }
    case SlotType.Open:
    case SlotType.ControlledOpen:
      return { type: 'open' }
    case SlotType.Closed:
    case SlotType.ControlledClosed:
      return { type: 'closed' }
    default:
      return assertUnreachable(slot.type)
  }
}

/** Maps a team to how lobby browsers see it. */
function toSummaryTeamJson(team: Team): LobbySummaryTeamJson {
  return {
    name: team.name,
    isObserver: team.isObserver,
    slots: team.slots.map(toSummarySlotJson),
  }
}

/**
 * Tallies a lobby's seats the way browsers count them. Every slot is read through
 * `toSummarySlotJson` so the counts can't drift from the layout the preview channel carries (e.g.
 * a team-melee `controlledOpen` counts as an open seat, exactly as it renders).
 */
function toSummarySlotCounts(
  lobby: Lobby,
): Pick<LobbySummaryJson, 'playerSlots' | 'observerSlots' | 'hasObserverTeam' | 'occupantIds'> {
  const playerSlots = { taken: 0, total: 0, open: 0 }
  const observerSlots = { taken: 0, open: 0 }
  let hasObserverTeam = false
  const occupantIds: SbUserId[] = []
  const seenOccupants = new Set<SbUserId>()

  for (const team of lobby.teams) {
    hasObserverTeam ||= team.isObserver

    for (const slot of team.slots) {
      const summarySlot = toSummarySlotJson(slot)

      if (summarySlot.type === 'human' || summarySlot.type === 'observer') {
        if (!seenOccupants.has(summarySlot.userId)) {
          seenOccupants.add(summarySlot.userId)
          occupantIds.push(summarySlot.userId)
        }
      }

      if (team.isObserver) {
        if (summarySlot.type === 'observer') {
          observerSlots.taken += 1
        } else if (summarySlot.type === 'open') {
          observerSlots.open += 1
        }
      } else {
        playerSlots.total += 1
        if (summarySlot.type === 'human' || summarySlot.type === 'computer') {
          playerSlots.taken += 1
        } else if (summarySlot.type === 'open') {
          playerSlots.open += 1
        }
      }
    }
  }

  return { playerSlots, observerSlots, hasObserverTeam, occupantIds }
}

/**
 * Serializes a lobby to the summary form the public lobby list carries: what a browser row shows,
 * with the seat-by-seat layout left to {@link toPreviewJson}.
 *
 * Two calls on structurally equal lobbies produce identical JSON (the fields are written in a fixed
 * order), so callers can compare serialized summaries to tell whether a change is one the list
 * would show at all.
 */
export function toSummaryJson(lobby: Lobby): LobbySummaryJson {
  return {
    id: lobby.id,
    name: lobby.name,
    map: toMapInfoJson(lobby.map!),
    gameType: lobby.gameType,
    gameSubType: lobby.gameSubType,
    host: { id: lobby.host.userId! },
    useLegacyLimits: lobby.useLegacyLimits,
    ...toSummarySlotCounts(lobby),
    createdAt: lobby.createdAt,
  }
}

/**
 * Serializes a lobby for the people previewing it specifically: its summary plus who is sitting in
 * which seat. Callers that have already serialized the lobby's summary can pass it in to avoid
 * walking every slot a second time.
 */
export function toPreviewJson(lobby: Lobby, summary = toSummaryJson(lobby)): LobbyPreviewJson {
  return {
    ...summary,
    teams: lobby.teams.map(toSummaryTeamJson),
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
        ? [teamIndex!, slotIndex, observerTeam!.slots[slotIndex]]
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
    .filter(team => !team.isObserver)
    .map<[index: number, team: Team]>((team, teamIndex) => [teamIndex, team])
    .filter(([, team]) => teamTakenSlotCount(team) < team.slots.length)
    .sort(([, a], [, b]) => {
      const availableCountA = a.slots.length - teamTakenSlotCount(a)
      const availableCountB = b.slots.length - teamTakenSlotCount(b)
      if (availableCountA > availableCountB) return -1
      else if (availableCountA < availableCountB) return 1
      else return 0
    })[0]

  const [teamIndex, team] = availableTeam
  // After finding the available team, find the first available slot in that team and return its
  // team index, slot index, and slot
  const slotIndex = team.slots.findIndex(
    slot => slot.type === SlotType.Open || slot.type === SlotType.ControlledOpen,
  )
  return [teamIndex, slotIndex, team.slots[slotIndex]]
}

function createInitialTeams(
  map: MapInfo,
  gameType: GameType,
  gameSubType: number,
  numSlots: number,
): Team[] {
  // When creating a lobby, we first create all the individual slots for the lobby, and then we
  // distribute each of the slots into their respective teams. The number of slots in each team is
  // fixed for the lifetime of the lobby; only the contents of the slots ever change.
  const slotsPerTeam = getSlotsPerTeam(gameType, gameSubType, numSlots, map.mapData.umsForces)
  let slots: Slot[]
  if (!isUms(gameType)) {
    slots = Array.from({ length: numSlots }, () => createOpen())
  } else {
    slots = map.mapData.umsForces.flatMap(force =>
      force.players.map(player => {
        const playerId = player.id
        const playerRace = player.race
        const race = playerRace !== 'any' ? playerRace : 'r'
        const hasForcedRace = playerRace !== 'any'
        return player.computer
          ? createUmsComputer(race, playerId, player.typeId)
          : createOpen(race, hasForcedRace, playerId)
      }),
    )
  }

  const teamNames = getTeamNames({ gameType, gameSubType, umsForces: map.mapData.umsForces })
  const teamCount = numTeams(gameType, gameSubType, map.mapData.umsForces)
  const teams: Team[] = []
  let slotIndex = 0
  for (let teamIndex = 0; teamIndex < teamCount; teamIndex++) {
    let teamSlots = slots.slice(slotIndex, slotIndex + slotsPerTeam[teamIndex])
    let hiddenSlots: Slot[]
    slotIndex += slotsPerTeam[teamIndex]
    // Game types whose teams aren't named (melee, FFA, 1v1) have no entry for this team
    const teamName = teamNames[teamIndex] ?? ''
    let teamId: number
    if (isUms(gameType)) {
      // Player type 5 means regular computer and 6 means human
      const isHiddenSlot = (player: Slot) => player.typeId !== 5 && player.typeId !== 6
      teamId = map.mapData.umsForces[teamIndex].teamId
      hiddenSlots = teamSlots.filter(isHiddenSlot)
      teamSlots = teamSlots.filter(slot => !isHiddenSlot(slot))
    } else {
      hiddenSlots = []
      teamId = isTeamType(gameType) ? teamIndex + 1 : teamIndex
    }

    teams.push({
      name: teamName,
      teamId,
      isObserver: false,
      slots: teamSlots,
      hiddenSlots,
    })
  }

  return teams
}

/**
 * Creates the observer team a lobby that allows observers has. Observer slots sit alongside the
 * map's player slots rather than being taken from them, so every game type gets the same fixed-size
 * team. They start closed, so a lobby only takes on observers once someone deliberately opens a
 * slot or is moved into one.
 */
function createObserverTeam(): Team {
  return {
    name: 'Observers',
    teamId: 0,
    isObserver: true,
    slots: Array.from({ length: MAX_OBSERVERS }, () => createClosed()),
    hiddenSlots: [],
  }
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
  const teams = createInitialTeams(map, gameType, gameSubType, numSlots)
  if (allowObservers) {
    teams.push(createObserverTeam())
  }

  const [hostTeamIndex, hostSlotIndex, hostSlot] = teams
    .flatMap((team, teamIndex) =>
      team.slots.map((slot, slotIndex): SlotWithIndexes => [teamIndex, slotIndex, slot]),
    )
    .find(([, , slot]) => slot.type === SlotType.Open)!

  let host: Slot
  if (!isUms(gameType)) {
    host = createHuman(hostUserId, hostRace)
  } else {
    host = createHuman(hostUserId, hostSlot.race, hostSlot.hasForcedRace, hostSlot.playerId)
  }
  host = { ...host, region: hostRegion }

  const lobby: Lobby = {
    id: makeSbLobbyId(encodePrettyId(randomUUID())),
    name,
    map,
    gameType,
    gameSubType: +gameSubType,
    teams,
    bench: [],
    host,
    useLegacyLimits,
    visibility,
    createdAt: Date.now(),
  }
  return addPlayer(lobby, hostTeamIndex, hostSlotIndex, host)
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
  const team = lobby.teams[teamIndex]
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
  return produce(lobby, draft => {
    draft.teams[teamIndex].slots = slots
  })
}

export function addPlayer(lobby: Lobby, teamIndex: number, slotIndex: number, player: Slot): Lobby {
  const team = lobby.teams[teamIndex]
  // The observer team never holds controlled slots, so someone arriving in an observer slot of a
  // team game must not trigger the controlled-slot fill an empty player team would get.
  return hasControlledOpens(lobby.gameType) && !team.isObserver && isTeamEmpty(team)
    ? addPlayerAndControlledSlots(lobby, teamIndex, slotIndex, player)
    : produce(lobby, draft => {
        draft.teams[teamIndex].slots[slotIndex] = player
      })
}

/** Updates the race of a particular player, returning the updated lobby. */
export function setRace(
  lobby: Lobby,
  teamIndex: number,
  slotIndex: number,
  newRace: RaceChar,
): Lobby {
  const team = lobby.teams[teamIndex]
  if (
    hasControlledOpens(lobby.gameType) &&
    team.slots.some(slot => slot.type === SlotType.Computer)
  ) {
    // BW doesn't support computer teams in team melee having different races. Change all races
    // of a computer team at once.
    // The exact limitation is with some but not all slots being random, we could allow multiple
    // non-random races but the AI won't be able to take advantage of it anyway.
    return produce(lobby, draft => {
      for (const slot of draft.teams[teamIndex].slots) {
        slot.race = newRace
      }
    })
  } else {
    return produce(lobby, draft => {
      draft.teams[teamIndex].slots[slotIndex].race = newRace
    })
  }
}

/**
 * A helper function that is used when a player leaves a team in team melee/ffa game types. Leave
 * can be triggered by player leaving the lobby, being kicked/banned, moving the slot etc. Returns
 * the updated lobby.
 */
function removePlayerAndControlledSlots(lobby: Lobby, teamIndex: number, playerIndex: number) {
  const team = lobby.teams[teamIndex]
  const id = team.slots[playerIndex].id
  if (
    team.slots.filter(slot => slot.type === SlotType.Human).length === 1 ||
    team.slots.some(slot => slot.type === SlotType.Computer)
  ) {
    // The player that is leaving is alone in this team, so to remove them we replace the whole team
    // with either opened or closed slots. Same goes if we're removing a computer in team melee/ffa
    // lobby.
    const slots = team.slots.map(currentSlot => {
      return currentSlot.type === SlotType.ControlledClosed ? createClosed() : createOpen()
    })
    return produce(lobby, draft => {
      draft.teams[teamIndex].slots = slots
    })
  } else {
    // The team which the player is leaving has other human players in it; find the new oldest human
    // player in the team and:
    //  1) create a new controlled open with controlledBy set to their ID
    //  2) update any controlled slots with controlledBy set to the leaver's ID to that ID
    const oldestInTeam = team.slots
      .filter(slot => slot.type === SlotType.Human && slot.id !== id)
      .sort((a, b) => a.joinedAt - b.joinedAt)[0]
    const slots = team.slots.map(slot => {
      if (slot.id === id) {
        return createControlledOpen(slot.race, oldestInTeam.id)
      } else if (slot.controlledBy === id) {
        return { ...slot, controlledBy: oldestInTeam.id }
      } else {
        return slot
      }
    })
    return produce(lobby, draft => {
      draft.teams[teamIndex].slots = slots
    })
  }
}

/**
 * Points a lobby's `host` at the slot it describes, choosing the longest-seated occupant instead
 * when that slot is gone. Returns the lobby untouched when the host already refers to the right
 * slot, and when nobody is seated to take over (the caller is expected to seat someone, e.g. from
 * the bench, and call this again).
 */
export function reassignHost(lobby: Lobby): Lobby {
  const slots = getLobbySlots(lobby)
  const newHost =
    slots.find(slot => slot.id === lobby.host.id) ??
    slots
      .filter(slot => slot.type === SlotType.Human || slot.type === SlotType.Observer)
      .sort((a, b) => a.joinedAt - b.joinedAt)[0]
  if (!newHost || newHost === lobby.host) {
    return lobby
  }
  return produce(lobby, draft => {
    draft.host = newHost
  })
}

/**
 * Removes the player at the specified `teamIndex` and `slotIndex` from a lobby, returning the
 * updated lobby. If the lobby is closed (e.g. because it no longer has anyone in it),
 * `undefined` will be returned. Note that if the host is being removed, a new, suitable host will
 * be chosen; if only benched members remain, the lobby is returned with its host still naming the
 * removed slot, for the caller to resolve by seating one of them.
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
  const team = lobby.teams[teamIndex]
  // A vacated slot is always left open for the next joiner; the host can close it if unwanted.
  // Observer slots carry no map data, so they get a plain open slot even in UMS. The observer
  // team also never holds controlled slots, so a departing observer skips the controlled-team
  // cleanup even in game types whose player teams need it.
  const vacatedSlot =
    isUms(lobby.gameType) && !team.isObserver
      ? createOpen(toRemove.race, toRemove.hasForcedRace, toRemove.playerId)
      : createOpen()
  const updated =
    hasControlledOpens(lobby.gameType) && !team.isObserver
      ? removePlayerAndControlledSlots(lobby, teamIndex, slotIndex)
      : produce(lobby, draft => {
          draft.teams[teamIndex].slots[slotIndex] = vacatedSlot
        })

  if (isLobbyEmpty(updated)) {
    return undefined
  }

  return reassignHost(updated)
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
/**
 * Returns what an occupant looks like once they are in `destSlot` of `destTeam`, having come from
 * `sourceTeam`: in UMS lobbies a slot's `playerId` and forced race come from the map, so they take
 * on the destination's, and crossing the observer team's boundary retypes them, since the observer
 * team holds `observer` slots and every other team holds `human` ones.
 */
function occupantInSlot(
  gameType: GameType,
  occupant: Slot,
  sourceTeam: Team,
  destTeam: Team,
  destSlot: Slot,
): Slot {
  let moved = occupant
  if (isUms(gameType)) {
    moved = { ...moved, playerId: destSlot.playerId }
    moved = destSlot.hasForcedRace
      ? { ...moved, race: destSlot.race, hasForcedRace: true }
      : { ...moved, hasForcedRace: false }
  }
  if (destTeam.isObserver) {
    moved = { ...moved, type: SlotType.Observer }
  } else if (sourceTeam.isObserver) {
    moved = { ...moved, type: SlotType.Human }
  }
  return moved
}

export function movePlayerToSlot(
  lobby: Lobby,
  sourceTeamIndex: number,
  sourceSlotIndex: number,
  destTeamIndex: number,
  destSlotIndex: number,
): Lobby {
  const sourceTeam = lobby.teams[sourceTeamIndex]
  const destTeam = lobby.teams[destTeamIndex]
  const originalSlot = sourceTeam.slots[sourceSlotIndex]
  const destSlot = destTeam.slots[destSlotIndex]

  const movedSlot = occupantInSlot(lobby.gameType, originalSlot, sourceTeam, destTeam, destSlot)

  let updated = lobby
  if (originalSlot.id === lobby.host.id) {
    // The lobby's host is a copy of their slot, so it has to follow along with any changes the move
    // made to it.
    updated = produce(updated, draft => {
      draft.host = movedSlot
    })
  }

  if (hasControlledOpens(lobby.gameType) && !destTeam.isObserver && isTeamEmpty(destTeam)) {
    updated = addPlayerAndControlledSlots(updated, destTeamIndex, destSlotIndex, movedSlot)
  } else {
    updated = produce(updated, draft => {
      draft.teams[destTeamIndex].slots[destSlotIndex] = movedSlot
    })
  }

  if (hasControlledOpens(lobby.gameType) && !sourceTeam.isObserver) {
    if (sourceTeamIndex === destTeamIndex) {
      const controlledOpen = createControlledOpen('r', destSlot.controlledBy!)
      updated = produce(updated, draft => {
        draft.teams[sourceTeamIndex].slots[sourceSlotIndex] = controlledOpen
      })
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
    updated = produce(updated, draft => {
      draft.teams[sourceTeamIndex].slots[sourceSlotIndex] = vacated
    })
  }

  return updated
}

/** Returns whether a slot holds someone who could be moved to (or swapped into) another slot. */
function isSlotOccupied(slot: Slot): boolean {
  return (
    slot.type === SlotType.Human ||
    slot.type === SlotType.Observer ||
    slot.type === SlotType.Computer
  )
}

/**
 * Hands the controlled slots of a team whose controller is no longer in it to the team's
 * longest-seated remaining player, leaving the slots themselves (and their races) as they are.
 */
function reassignControlledSlots(lobby: Lobby, teamIndex: number): Lobby {
  const team = lobby.teams[teamIndex]
  const humans = team.slots.filter(slot => slot.type === SlotType.Human)
  const humanIds = new Set(humans.map(slot => slot.id))
  if (team.slots.every(slot => !slot.controlledBy || humanIds.has(slot.controlledBy))) {
    return lobby
  }
  const controller = [...humans].sort((a, b) => a.joinedAt - b.joinedAt)[0]
  if (!controller) {
    return lobby
  }

  return produce(lobby, draft => {
    for (const slot of draft.teams[teamIndex].slots) {
      if (slot.controlledBy && !humanIds.has(slot.controlledBy)) {
        slot.controlledBy = controller.id
      }
    }
  })
}

/**
 * Exchanges the occupants of two slots, each of which must hold a `human`, `observer`, or
 * `computer`. Each occupant takes on the other slot's position with the same adjustments a move
 * into it would make: UMS slot data comes from the map, and crossing the observer team's boundary
 * retypes them. A computer has no in-game counterpart in an observer slot, so it cannot be swapped
 * into one.
 *
 * Team melee/ffa lobbies build their player teams out of slots controlled by whoever occupies them,
 * so only two humans can be exchanged there — any other combination would leave a team's controlled
 * slots without a player to belong to. Control of those slots follows the swap: a team whose
 * controller was swapped out hands them to its longest-seated remaining player.
 */
export function swapSlots(
  lobby: Lobby,
  sourceTeamIndex: number,
  sourceSlotIndex: number,
  destTeamIndex: number,
  destSlotIndex: number,
): Lobby {
  const sourceTeam = lobby.teams[sourceTeamIndex]
  const destTeam = lobby.teams[destTeamIndex]
  const sourceSlot = sourceTeam.slots[sourceSlotIndex]
  const destSlot = destTeam.slots[destSlotIndex]

  if (sourceSlot.id === destSlot.id) {
    throw new Error('trying to swap a slot with itself')
  }
  if (!isSlotOccupied(sourceSlot) || !isSlotOccupied(destSlot)) {
    throw new Error('trying to swap an unoccupied slot: ' + sourceSlot.type + ', ' + destSlot.type)
  }
  if (
    (destTeam.isObserver && sourceSlot.type === SlotType.Computer) ||
    (sourceTeam.isObserver && destSlot.type === SlotType.Computer)
  ) {
    throw new Error('trying to swap a computer into the observer team')
  }
  if (
    hasControlledOpens(lobby.gameType) &&
    (sourceSlot.type !== SlotType.Human || destSlot.type !== SlotType.Human)
  ) {
    throw new Error('only players can be swapped in this game type: ' + lobby.gameType)
  }

  const intoDest = occupantInSlot(lobby.gameType, sourceSlot, sourceTeam, destTeam, destSlot)
  const intoSource = occupantInSlot(lobby.gameType, destSlot, destTeam, sourceTeam, sourceSlot)

  let updated = produce(lobby, draft => {
    draft.teams[destTeamIndex].slots[destSlotIndex] = intoDest
    draft.teams[sourceTeamIndex].slots[sourceSlotIndex] = intoSource
  })

  if (hasControlledOpens(lobby.gameType)) {
    updated = reassignControlledSlots(updated, sourceTeamIndex)
    if (destTeamIndex !== sourceTeamIndex) {
      updated = reassignControlledSlots(updated, destTeamIndex)
    }
  }

  return reassignHost(updated)
}

/**
 * "Opens" a particular slot. This function is only possible to use to open a `closed` and
 * `controlledClosed` slot types. If you want to open a player slot, use the `removePlayer` function
 * instead, as that operation has side-effects, unlike this one.
 */
export function openSlot(lobby: Lobby, teamIndex: number, slotIndex: number): Lobby {
  const slotToOpen = lobby.teams[teamIndex].slots[slotIndex]

  const openSlot = isUms(lobby.gameType)
    ? createOpen(slotToOpen.race, slotToOpen.hasForcedRace, slotToOpen.playerId)
    : createOpen()
  if (slotToOpen.type === SlotType.Closed) {
    return produce(lobby, draft => {
      draft.teams[teamIndex].slots[slotIndex] = openSlot
    })
  } else if (slotToOpen.type === SlotType.ControlledClosed) {
    const controlledOpen = createControlledOpen(slotToOpen.race, slotToOpen.controlledBy!)
    return produce(lobby, draft => {
      draft.teams[teamIndex].slots[slotIndex] = controlledOpen
    })
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
  const slotToClose = lobby.teams[teamIndex].slots[slotIndex]

  const closedSlot = isUms(lobby.gameType)
    ? createClosed(slotToClose.race, slotToClose.hasForcedRace, slotToClose.playerId)
    : createClosed()
  if (slotToClose.type === SlotType.Open) {
    return produce(lobby, draft => {
      draft.teams[teamIndex].slots[slotIndex] = closedSlot
    })
  } else if (slotToClose.type === SlotType.ControlledOpen) {
    const controlledClosed = createControlledClosed(slotToClose.race, slotToClose.controlledBy!)
    return produce(lobby, draft => {
      draft.teams[teamIndex].slots[slotIndex] = controlledClosed
    })
  } else {
    throw new Error('trying to close an invalid slot type: ' + slotToClose.type)
  }
}

/** Returns whether a slot is one a player could join directly, without the host opening it. */
function isSlotJoinable(slot: Slot): boolean {
  return slot.type === SlotType.Open || slot.type === SlotType.ControlledOpen
}

/**
 * Finds the index of the slot in `slots` that a player should be moved into: the first one that
 * can be joined directly, or failing that the first unoccupied one. Returns -1 if every slot is
 * occupied.
 */
function findSlotToMoveInto(slots: ReadonlyArray<Slot>): number {
  const openIndex = slots.findIndex(isSlotJoinable)
  return openIndex !== -1 ? openIndex : slots.findIndex(isSlotUnoccupied)
}

/**
 * Returns the item of `items` with the highest `score`, keeping the earlier item when two items
 * score the same. Returns `undefined` if `items` is empty.
 */
function maxBy<T>(items: ReadonlyArray<T>, score: (item: T) => number): T | undefined {
  let best: T | undefined
  let bestScore = -Infinity
  for (const item of items) {
    const itemScore = score(item)
    if (itemScore > bestScore) {
      best = item
      bestScore = itemScore
    }
  }
  return best
}

/**
 * Moves the player in a regular slot into a free slot of the observer team, opening the slot they
 * came from.
 */
export function makeObserver(lobby: Lobby, teamIndex: number, slotIndex: number): Lobby {
  const team = lobby.teams[teamIndex]
  if (team.isObserver) {
    throw new Error("Trying to make an observer from obs team's slot")
  }
  const slot = team.slots[slotIndex]
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
 * Moves an observer back into a player slot, leaving the observer slot they came from open. The
 * destination is the team with the most joinable slots; only when no team has one does the
 * observer take (and thereby re-open) a slot the host had closed, from the team with the most
 * unoccupied slots.
 */
export function removeObserver(lobby: Lobby, slotIndex: number): Lobby {
  const [obsTeamIndex, obsTeam] = getObserverTeam(lobby)
  if (obsTeamIndex === undefined) {
    throw new Error('Lobby does not allow observers')
  }
  const slot = obsTeam!.slots[slotIndex]
  if (slot.type !== SlotType.Observer) {
    throw new Error('Trying to remove an observer from an invalid slot type: ' + slot.type)
  }

  const candidates = lobby.teams
    .map<[teamIndex: number, team: Team]>((team, teamIndex) => [teamIndex, team])
    .filter(([, team]) => !team.isObserver && team.slots.some(isSlotUnoccupied))
  const destTeam =
    maxBy(
      candidates.filter(([, team]) => team.slots.some(isSlotJoinable)),
      ([, team]) => team.slots.filter(isSlotJoinable).length,
    ) ?? maxBy(candidates, ([, team]) => team.slots.filter(isSlotUnoccupied).length)
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

/** Adds a member to the end of the bench, behind everyone already waiting for a seat. */
export function addToBench(lobby: Lobby, user: BenchedUser): Lobby {
  return produce(lobby, draft => {
    draft.bench.push(user)
  })
}

/** Removes a member from the bench, e.g. because they left the lobby. */
export function removeFromBench(lobby: Lobby, userId: SbUserId): Lobby {
  if (!lobby.bench.some(benched => benched.userId === userId)) {
    return lobby
  }
  return produce(lobby, draft => {
    draft.bench = draft.bench.filter(benched => benched.userId !== userId)
  })
}

/**
 * What a lobby member carries with them when they change seats: everything about them that isn't
 * described by the slot they are in. An `id` is present for anyone who currently holds a slot, so
 * that reusing it lets clients recognize the result as a move rather than a departure and an
 * arrival.
 */
interface Occupant {
  userId: SbUserId
  race: RaceChar
  joinedAt: number
  region?: GameServerRegionId
  id?: string
}

function occupantOf(slot: Slot): Occupant {
  return {
    userId: slot.userId!,
    race: slot.race,
    joinedAt: slot.joinedAt,
    region: slot.region,
    id: slot.id,
  }
}

function occupantOfBenched(benched: BenchedUser): Occupant {
  return {
    userId: benched.userId,
    race: benched.race,
    joinedAt: benched.joinedAt,
    region: benched.region,
  }
}

function benchedFromOccupant(occupant: Occupant): BenchedUser {
  return {
    userId: occupant.userId,
    race: occupant.race,
    joinedAt: occupant.joinedAt,
    region: occupant.region,
  }
}

/**
 * Builds the `human` slot an occupant gets when they are seated in `destSlot`. A UMS map's slots
 * define their own race and player id, so those win over what the occupant brought with them.
 */
function humanSlotFor(occupant: Occupant, destSlot: Slot, gameType: GameType): Slot {
  const base = destSlot.hasForcedRace
    ? createHuman(occupant.userId, destSlot.race, true, destSlot.playerId)
    : createHuman(
        occupant.userId,
        occupant.race,
        false,
        isUms(gameType) ? destSlot.playerId : undefined,
      )
  return {
    ...base,
    id: occupant.id ?? base.id,
    joinedAt: occupant.joinedAt,
    region: occupant.region,
  }
}

/** Builds the `observer` slot an occupant gets when they are seated in the observer team. */
function observerSlotFor(occupant: Occupant): Slot {
  const base = createObserver(occupant.userId)
  return {
    ...base,
    race: occupant.race,
    id: occupant.id ?? base.id,
    joinedAt: occupant.joinedAt,
    region: occupant.region,
  }
}

/**
 * Moves a member off the bench and into the given slot, keeping the race, region, and join time
 * they were waiting with. Their new slot is built the same way it would be for someone joining
 * directly into it, so UMS map data and the observer team still decide what it looks like.
 */
export function seatBenchedUser(
  lobby: Lobby,
  userId: SbUserId,
  teamIndex: number,
  slotIndex: number,
): Lobby {
  const benched = lobby.bench.find(entry => entry.userId === userId)
  if (!benched) {
    throw new Error('user is not waiting on the bench')
  }
  const team = lobby.teams[teamIndex]
  const destSlot = team.slots[slotIndex]
  if (!isSlotJoinable(destSlot)) {
    throw new Error('trying to seat someone in an invalid slot type: ' + destSlot.type)
  }

  const occupant = occupantOfBenched(benched)
  const slot = team.isObserver
    ? observerSlotFor(occupant)
    : humanSlotFor(occupant, destSlot, lobby.gameType)
  return addPlayer(removeFromBench(lobby, userId), teamIndex, slotIndex, slot)
}

/**
 * Finds the player slot someone should be seated in, spread across the teams the same way a joiner
 * would be. Returns `undefined` once every player team is full, since the observer team is only
 * ever a destination for the people a new layout has no room for.
 */
function findPlayerSeat(lobby: Lobby): [teamIndex: number, slotIndex: number] | undefined {
  const [teamIndex, slotIndex] = findAvailableSlot(lobby)
  if (teamIndex === undefined || slotIndex === undefined || lobby.teams[teamIndex].isObserver) {
    return undefined
  }
  return [teamIndex, slotIndex]
}

/**
 * Finds the observer slot someone displaced out of a player slot should be put in: a closed one if
 * there is any, so that a slot the host opened stays available to joiners. Returns -1 if the
 * observer team is full.
 */
function findObserverSlotToFill(team: Team): number {
  const closedIndex = team.slots.findIndex(slot => slot.type === SlotType.Closed)
  return closedIndex !== -1 ? closedIndex : team.slots.findIndex(isSlotUnoccupied)
}

function countComputers(lobby: Lobby): number {
  return getLobbySlots(lobby).filter(slot => slot.type === SlotType.Computer).length
}

/** The settings of a lobby that its host can change while it is gathering. */
export interface LobbySettings {
  map: MapInfo
  gameType: GameType
  gameSubType: number
  /** How many player slots the lobby has, as derived from the map and the game type. */
  numSlots: number
  allowObservers: boolean
  useLegacyLimits: boolean
}

/**
 * Applies a change to a lobby's settings, rebuilding its slot layout and reconciling everyone in it
 * into the result. Returns the updated lobby.
 *
 * A change that leaves the layout alone (a different unit limit, or a map with exactly the same
 * team sizes) keeps every slot as it is, so nobody moves. Turning observers on or off only adds or
 * removes the observer team, leaving the player slots — including any the host has closed — as they
 * are, and finding the people who were observing a seat.
 *
 * Any other change gives the lobby the layout the new settings describe, and pours its members back
 * into it in order of who has the strongest claim to a seat: the host first (a host is never left
 * without one), then the players by how long they have been here, then any observers the change
 * unseats, and finally whoever was waiting on the bench. Anyone left over goes to the observer team
 * if there is one, and to the bench if there isn't: a settings change never removes anyone from the
 * lobby. Computers are added back last, and only as far as the new layout has room for them.
 *
 * Members keep the slot ids they had, so clients can tell that someone moved rather than that one
 * member left and another arrived.
 */
export function applySettingsChange(lobby: Lobby, next: LobbySettings): Lobby {
  const keepsLayout =
    lobby.gameType === next.gameType &&
    lobby.gameSubType === next.gameSubType &&
    (lobby.map!.id === next.map.id || keepsSlotsPerTeam(lobby, next))
  if (keepsLayout && hasObservers(lobby) === next.allowObservers) {
    return { ...lobby, map: next.map, useLegacyLimits: next.useLegacyLimits }
  }

  const byJoinedAt = (a: Slot, b: Slot) => a.joinedAt - b.joinedAt
  const [, currentObserverTeam] = getObserverTeam(lobby)
  // Observers who already have a slot keep it, since the observer team is the same size whatever
  // the player teams look like. Only turning observers off unseats them.
  const unseatedObservers = next.allowObservers
    ? []
    : (currentObserverTeam?.slots.filter(slot => slot.type === SlotType.Observer) ?? []).sort(
        byJoinedAt,
      )

  let teams: Team[]
  let needSeats: Occupant[]
  let observerTeamIndex: number | undefined
  if (keepsLayout) {
    teams = next.allowObservers
      ? [...lobby.teams, createObserverTeam()]
      : lobby.teams.filter(team => !team.isObserver)
    needSeats = unseatedObservers.map(occupantOf)
  } else {
    teams = createInitialTeams(next.map, next.gameType, next.gameSubType, next.numSlots)
    if (next.allowObservers) {
      teams.push(currentObserverTeam ?? createObserverTeam())
      observerTeamIndex = teams.length - 1
    }
    const seatedPlayers = lobby.teams
      .filter(team => !team.isObserver)
      .flatMap(team => team.slots)
      .filter(slot => slot.type === SlotType.Human)
      .sort(byJoinedAt)
    needSeats = [...seatedPlayers, ...unseatedObservers].map(occupantOf)
  }
  const hostIndex = needSeats.findIndex(occupant => occupant.id === lobby.host.id)
  if (hostIndex > 0) {
    needSeats.unshift(...needSeats.splice(hostIndex, 1))
  }
  needSeats.push(...lobby.bench.map(occupantOfBenched))

  let updated: Lobby = {
    ...lobby,
    map: next.map,
    gameType: next.gameType,
    gameSubType: next.gameSubType,
    useLegacyLimits: next.useLegacyLimits,
    teams,
    bench: [],
  }

  const withoutSeats: Occupant[] = []
  for (const occupant of needSeats) {
    const seat = findPlayerSeat(updated)
    if (!seat) {
      withoutSeats.push(occupant)
      continue
    }
    const [teamIndex, slotIndex] = seat
    const destSlot = updated.teams[teamIndex].slots[slotIndex]
    updated = addPlayer(
      updated,
      teamIndex,
      slotIndex,
      humanSlotFor(occupant, destSlot, next.gameType),
    )
  }

  const bench: BenchedUser[] = []
  for (const occupant of withoutSeats) {
    const observerSlotIndex =
      observerTeamIndex !== undefined
        ? findObserverSlotToFill(updated.teams[observerTeamIndex])
        : -1
    if (observerSlotIndex === -1) {
      bench.push(benchedFromOccupant(occupant))
      continue
    }
    updated = addPlayer(updated, observerTeamIndex!, observerSlotIndex, observerSlotFor(occupant))
  }
  updated = { ...updated, bench }

  if (!keepsLayout && !isUms(next.gameType)) {
    // UMS computers are part of the map, so they come back with the layout rather than from the
    // lobby that preceded it.
    const races = getLobbySlots(lobby)
      .filter(slot => slot.type === SlotType.Computer)
      .map(slot => slot.race)
    let placed = 0
    while (placed < races.length) {
      const seat = findPlayerSeat(updated)
      if (!seat) {
        break
      }
      const before = countComputers(updated)
      updated = addPlayer(updated, seat[0], seat[1], createComputer(races[placed]))
      // Adding a computer to an empty team in team melee/ffa fills the rest of that team with
      // computers, which stands in for as many of the ones still to be placed.
      placed += Math.max(1, countComputers(updated) - before)
    }
  }

  const withHost = reassignHost(updated)
  if (!getLobbySlots(withHost).some(slot => slot.id === withHost.host.id)) {
    throw new Error('the new settings leave no slot for the lobby host')
  }
  return withHost
}

/** Returns whether the new settings describe teams of exactly the same sizes the lobby has now. */
function keepsSlotsPerTeam(lobby: Lobby, next: LobbySettings): boolean {
  if (isUms(next.gameType)) {
    // A UMS map decides the races, player ids, and computers of every slot, so two of them having
    // the same team sizes doesn't make their layouts interchangeable.
    return false
  }
  const current = lobby.teams.filter(team => !team.isObserver).map(team => team.slots.length)
  const wanted = getSlotsPerTeam(
    next.gameType,
    next.gameSubType,
    next.numSlots,
    next.map.mapData.umsForces,
  )
  return current.length === wanted.length && current.every((count, i) => count === wanted[i])
}
