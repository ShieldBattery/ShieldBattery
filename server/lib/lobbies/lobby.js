import { List, Range, Record } from 'immutable'
import * as Slots from './slot'
import {
  isTeamType,
  getLobbySlots,
  slotCount,
  humanSlotCount,
  takenSlotCount,
  teamTakenSlotCount,
  openSlotCount,
} from '../../../app/common/lobbies'

const Team = new Record({
  name: null,
  teamId: null,
  // Slots that belong to a particular team
  slots: new List(),
})
const Lobby = new Record({
  name: null,
  map: null,
  gameType: 'melee',
  gameSubType: 0,
  // All lobbies have at least one team (even Melee and FFA)
  teams: new List(),
  host: null,
})

export function hasControlledOpens(gameType) {
  return gameType === 'teamMelee' || gameType === 'teamFfa'
}

export function isUms(gameType) {
  return gameType === 'ums'
}

export function isTeamEmpty(team) {
  // Team is deemed empty if it's only consisted of open and/or closed type of slots
  return team.slots.every(slot => slot.type === 'open' || slot.type === 'closed')
}

export function getslotsPerControlledTeam(gameSubType) {
  switch (gameSubType) {
    case 2: return [4, 4]
    case 3: return [3, 3, 2]
    case 4: return [2, 2, 2, 2]
    default: throw new Error('Unknown game sub-type: ' + gameSubType)
  }
}

export function getSlotsPerTeam(gameType, gameSubType, numSlots) {
  switch (gameType) {
    case 'melee':
    case 'ffa':
      return [numSlots]
    case 'topVBottom':
      return [gameSubType, numSlots - gameSubType]
    case 'teamMelee':
    case 'teamFfa':
      return getslotsPerControlledTeam(gameSubType)
    case 'ums':
      throw new Error('Unsupported game type: ' + gameType)
    default:
      throw new Error('Unknown game type: ' + gameType)
  }
}

export function numTeams(gameType, gameSubType) {
  switch (gameType) {
    case 'melee':
    case 'ffa':
      return 1
    case 'topVBottom':
      return 2
    case 'teamMelee':
    case 'teamFfa':
      return gameSubType
    case 'ums':
      throw new Error('Unsupported game type: ' + gameType)
    default:
      throw new Error('Unknown game type: ' + gameType)
  }
}

export function getTeamNames(gameType, gameSubType) {
  switch (gameType) {
    case 'melee':
    case 'ffa':
      return []
    case 'topVBottom':
      return ['Top', 'Bottom']
    case 'teamMelee':
    case 'teamFfa':
      const teamNames = []
      for (let i = 1; i <= numTeams(gameType, gameSubType); i++) {
        teamNames.push('Team ' + i)
      }
      return teamNames
    case 'ums':
      throw new Error('Unsupported game type: ' + gameType)
    default:
      throw new Error('Invalid game type: ' + gameType)
  }
}

// Serializes a lobby to a summary-form in JSON, suitable for e.g. displaying a list of all the open
// lobbies.
export function toSummaryJson(lobby) {
  return {
    name: lobby.name,
    map: lobby.map,
    gameType: lobby.gameType,
    gameSubType: lobby.gameSubType,
    host: { name: lobby.host.name, id: lobby.host.id },
    openSlotCount: openSlotCount(lobby),
  }
}

// Finds the next available slot in the lobby (ie. `open` or `controlledOpen` slot type). Returns
// the [teamIndex, slotIndex] tuple of the available slot if found. If there are no available slots,
// it returns a [-1, -1] tuple.
export function findAvailableSlot(lobby) {
  if (slotCount(lobby) <= takenSlotCount(lobby)) {
    return [-1, -1]
  }

  // To choose the team of the empty slot, first filter out any teams that are full, then sort the
  // remaining teams such that first team in the resulting list is the one with the least number of
  // players (ie. the highest number of available slots).
  const availableTeam = lobby.teams.map((team, teamIndex) => [teamIndex, team])
      .filter(([, team]) => teamTakenSlotCount(team) < team.slots.size)
      .sort(([, a], [, b]) => {
        const availableCountA = a.slots.size - teamTakenSlotCount(a)
        const availableCountB = b.slots.size - teamTakenSlotCount(b)
        if (availableCountA > availableCountB) return -1
        else if (availableCountA < availableCountB) return 1
        else return 0
      })
      .first()

  const [teamIndex, team] = availableTeam
  // After finding the available team, find the first available slot in that team and return its
  // team index and slot index
  const slotIndex =
      team.slots.findIndex(slot => slot.type === 'open' || slot.type === 'controlledOpen')
  return [teamIndex, slotIndex]
}

// Creates a new lobby, and an initial host player in the first slot.
export function create(name, map, gameType, gameSubType = 0, numSlots, hostName, hostRace = 'r') {
  // When creating a lobby, we first create all the individual slots for the lobby, and then we
  // distribute each of the slots into their respective teams. This distribution of slots shouldn't
  // change at all during the lifetime of a lobby, except when creating/deleting observer slots,
  // which will be handled separately
  const slotsPerTeam = getSlotsPerTeam(gameType, gameSubType, numSlots)
  let host
  let slots
  if (!isUms(gameType)) {
    host = Slots.createHuman(hostName, hostRace)
    const controlled = hasControlledOpens(gameType) ?
        Range(1, slotsPerTeam[0]).map(() => Slots.createControlledOpen(hostRace, host.id)) :
        new List()
    const open = Range(1 + controlled.size, numSlots).map(() => Slots.createOpen())
    // TODO(2Pac): Create (8 - numSlots) amount of `observerOpen` type slots
    slots = List.of(host).concat(controlled, open)
  } else {
    // TODO(2Pac): In case of a UMS map, slot layout will be determined by the map data
    throw new Error('Unsupported game type: ' + gameType)
  }

  const teamNames = getTeamNames(gameType, gameSubType)
  let slotIndex = 0
  const teams = Range(0, numTeams(gameType, gameSubType))
    .map(teamIndex => {
      const teamSlots = slots.slice(slotIndex, slotIndex + slotsPerTeam[teamIndex])
      slotIndex += slotsPerTeam[teamIndex]
      const teamName = teamNames[teamIndex]
      let teamId
      if (!isUms(gameType)) {
        teamId = isTeamType(gameType) ? teamIndex + 1 : teamIndex
      } else {
        // TODO(2Pac): In case of a UMS map, `teamId` will be read from the forces layout
      }

      return new Team({
        name: teamName,
        teamId,
        slots: teamSlots,
      })
    }).toList()

  return new Lobby({
    name,
    map,
    gameType,
    gameSubType: +gameSubType,
    teams,
    host,
  })
}

// A helper function that is used when a player joins an empty team in team melee/ffa game types.
// Join can be triggered by player joining the lobby, adding a computer to the empty controlled team
// or moving to the slot of an empty controlled team. Returns the updated lobby.
function addPlayerAndControlledSlots(lobby, teamIndex, slotIndex, player) {
  // The team which the new player is joining is empty (ie. it has only open and/or closed slots);
  // fill the whole team with either computer slots or controlled slots (leaving the slot of the new
  // player as is)
  const team = lobby.teams.get(teamIndex)
  const slots = team.slots.map((currentSlot, currentSlotIndex) => {
    if (currentSlotIndex === slotIndex) return player
    if (player.type === 'computer') {
      return Slots.createComputer(player.race)
    } else {
      // If the human player is joining empty controlled team, check if the currentSlot is `closed`,
      // in which case create a `controlledClosed` type of slot in its place. This type of slot is
      // used in team melee/ffa game types where a closed slot still have its race set, which
      // affects race composition in the game, but no one can join that slot.
      return currentSlot.type === 'closed' ?
          // TODO(2Pac): Set the races of these slots to 'r' instead?
          Slots.createControlledClosed(player.race, player.id) :
          Slots.createControlledOpen(player.race, player.id)
    }
  })
  return lobby.setIn(['teams', teamIndex, 'slots'], slots)
}

export function addPlayer(lobby, teamIndex, slotIndex, player) {
  const team = lobby.teams.get(teamIndex)
  return hasControlledOpens(lobby.gameType) && isTeamEmpty(team) ?
      addPlayerAndControlledSlots(lobby, teamIndex, slotIndex, player) :
      lobby.setIn(['teams', teamIndex, 'slots', slotIndex], player)
}

// Updates the race of a particular player, returning the updated lobby.
export function setRace(lobby, teamIndex, slotIndex, newRace) {
  return lobby.setIn(['teams', teamIndex, 'slots', slotIndex, 'race'], newRace)
}

// A helper function that is used when a player leaves a team in team melee/ffa game types. Leave
// can be triggered by player leaving the lobby, being kicked/banned, moving the slot etc. Returns
// the updated lobby.
function removePlayerAndControlledSlots(lobby, teamIndex, playerIndex) {
  const team = lobby.teams.get(teamIndex)
  const id = team.slots.get(playerIndex).id
  if (team.slots.count(slot => slot.type === 'human') === 1 ||
      team.slots.count(slot => slot.type === 'computer') > 0) {
    // The player that is leaving is alone in this team, so to remove them we replace the whole team
    // with either opened or closed slots. Same goes if we're removing a computer in team melee/ffa
    // lobby.
    const slots = team.slots.map(currentSlot => {
      return currentSlot.type === 'controlledClosed' ? Slots.createClosed() : Slots.createOpen()
    })
    return lobby.setIn(['teams', teamIndex, 'slots'], slots)
  } else {
    // The team which the player is leaving has other human players in it; find the new oldest human
    // player in the team and:
    //  1) create a new controlled open with controlledBy set to their ID
    //  2) update any controlled slots with controlledBy set to the leaver's ID to that ID
    const oldestInTeam = team.slots.filter(slot => slot.type === 'human' && slot.id !== id)
        .sortBy(p => p.joinedAt)
        .first()
    return (lobby.updateIn(['teams', teamIndex, 'slots'], slots => slots.map(slot => {
      if (slot.id === id) {
        return Slots.createControlledOpen(slot.race, oldestInTeam.id)
      } else if (slot.controlledBy === id) {
        return slot.set('controlledBy', oldestInTeam.id)
      } else {
        return slot
      }
    })))
  }
}

// Removes the player at the specified `teamIndex` and `slotIndex` from a lobby, returning the
// updated lobby. If the lobby is closed (e.g. because it no longer has any human players), null
// will be returned. Note that if the host is being removed, a new, suitable host will be chosen.
export function removePlayer(lobby, teamIndex, slotIndex, toRemove) {
  if (!toRemove) {
    // nothing removed, e.g. player wasn't in the lobby
    return lobby
  }
  let updated = hasControlledOpens(lobby.gameType) ?
    removePlayerAndControlledSlots(lobby, teamIndex, slotIndex) :
    lobby.setIn(['teams', teamIndex, 'slots', slotIndex], Slots.createOpen())

  if (humanSlotCount(updated) < 1) {
    return null
  }

  if (lobby.host.id === toRemove.id) {
    // The player we removed was the host, find a new host (the "oldest" player in lobby)
    const newHost = getLobbySlots(updated)
        .filter(slot => slot.type === 'human')
        .sortBy(p => p.joinedAt)
        .first()
    updated = updated.set('host', newHost)
  }

  return updated
}

// "Moves" one slot to another. For now it's only possible to move a `human` type slot to `open` or
// `controlledOpen` type slot. Once the player is moved, there can be multiple side-effects:
// 1) in melee/ffa/tvb lobby, there are no side-effects
// 2) in team melee/ffa lobby
//  2.1) the source and dest slots are in the same team, no side-effects
//  2.2) the source and dest slots are in different teams
//    2.2.1) the team of source slot will become empty after move
//    2.2.2) the team of source slot will have remaining players
//      2.2.2.1) the slot that moved was the "controller" of that team
//      2.2.2.2) the slot that moved was not the "controller" of that team
//    2.2.3) the team of dest slot was empty before the move
//    2.2.4) the team of dest slot was not empty before the move
export function movePlayerToSlot(lobby, sourceTeamIndex, sourceSlotIndex, destTeamIndex,
    destSlotIndex) {
  const sourceSlot = lobby.teams.get(sourceTeamIndex).slots.get(sourceSlotIndex)
  const destSlot = lobby.teams.get(destTeamIndex).slots.get(destSlotIndex)
  if (!hasControlledOpens(lobby.gameType)) {
    // 1) case - move the source slot to the destination slot and create an `open` slot at the
    // source slot
    return lobby.setIn(['teams', destTeamIndex, 'slots', destSlotIndex], sourceSlot)
        .setIn(['teams', sourceTeamIndex, 'slots', sourceSlotIndex], Slots.createOpen())
  } else {
    if (sourceTeamIndex === destTeamIndex) {
      // 2.1) case - move the source slot to the destination slot and create a `controlledOpen` slot
      // at the source
      return lobby.setIn(['teams', destTeamIndex, 'slots', destSlotIndex], sourceSlot)
          .setIn(['teams', sourceTeamIndex, 'slots', sourceSlotIndex],
              Slots.createControlledOpen('r', destSlot.controlledBy))
    } else {
      let updated
      if (isTeamEmpty(lobby.teams.get(destTeamIndex))) {
        // 2.2.3) case - move the source slot (player) to the destination team and fill out the rest
        // of its slots properly
        updated = addPlayerAndControlledSlots(lobby, destTeamIndex, destSlotIndex,
            sourceSlot)
      } else {
        // 2.2.4) case - move the source slot to the destination slot
        updated = lobby.setIn(['teams', destTeamIndex, 'slots', destSlotIndex], sourceSlot)
      }
      // 2.2.1) and 2.2.2) case - clean up the controlled team which the player is leaving
      return removePlayerAndControlledSlots(updated, sourceTeamIndex, sourceSlotIndex)
    }
  }
}

// "Opens" a particular slot. This function is only possible to use to open a `closed` and
// `controlledClosed` slot types. If you want to open a player slot, use the `removePlayer` function
// instead, as that operation has side-effects, unlike this one.
export function openSlot(lobby, teamIndex, slotIndex) {
  const slotToOpen = lobby.teams.get(teamIndex).slots.get(slotIndex)

  if (slotToOpen.type === 'closed') {
    return lobby.setIn(['teams', teamIndex, 'slots', slotIndex], Slots.createOpen())
  } else if (slotToOpen.type === 'controlledClosed') {
    return lobby.setIn(['teams', teamIndex, 'slots', slotIndex],
        Slots.createControlledOpen(slotToOpen.race, slotToOpen.controlledBy))
  } else {
    throw new Error('trying to open an invalid slot type: ' + slotToOpen.type)
  }
}

// "Closes" a particular slot. This function is only possible to use to close an `open` and
// `controlledOpen` slot types. If you want to close a player slot, make sure to first remove the
// player from the slot and then close their slot with this function.
export function closeSlot(lobby, teamIndex, slotIndex) {
  const slotToClose = lobby.teams.get(teamIndex).slots.get(slotIndex)

  if (slotToClose.type === 'open') {
    return lobby.setIn(['teams', teamIndex, 'slots', slotIndex], Slots.createClosed())
  } else if (slotToClose.type === 'controlledOpen') {
    return lobby.setIn(['teams', teamIndex, 'slots', slotIndex],
        Slots.createControlledClosed(slotToClose.race, slotToClose.controlledBy))
  } else {
    throw new Error('tring to close an invalid slot type: ' + slotToClose.type)
  }
}
