import { OrderedMap, Range, Record, Set } from 'immutable'
import * as Players from './player'

const Lobby = new Record({
  name: null,
  map: null,
  // Total number of slots (including any that are currently filled)
  numSlots: 0,
  // Number of actual players (not including controlled open slots)
  filledSlots: 0,
  players: new OrderedMap(),
  hostId: null,
  gameType: 'melee',
  gameSubType: 0,
})


function isTeamType(gameType) {
  return gameType === 'topVBottom' || gameType === 'teamMelee' || gameType === 'teamFfa'
}

function hasControlledOpens(gameType) {
  return gameType === 'teamMelee' || gameType === 'teamFfa'
}

function slotsPerTeam(gameType, gameSubType) {
  if (gameType === 'topVBottom') {
    return gameSubType
  } else if (gameType === 'teamMelee' || gameType === 'teamFfa') {
    switch (gameSubType) {
      case 4: return 2
      case 3: return 3
      case 2:
      default: return 4
    }
  } else {
    return 0
  }
}

// Creates a new lobby, and an initial host player in the first slot.
export function create(name, map, gameType, gameSubType = 0, numSlots, hostName, hostRace = 'r') {
  const host = Players.createHuman(hostName, hostRace, 0)
  let players = [[host.id, host]]
  if (hasControlledOpens(gameType)) {
    players = players.concat(Range(1, slotsPerTeam(gameType, gameSubType)).map(slot => {
      const p = Players.createControlledOpen(host.id, hostRace, slot)
      return [ p.id, p ]
    }).toArray())
  }
  return new Lobby({
    name,
    map,
    gameType,
    gameSubType: +gameSubType,
    numSlots,
    filledSlots: 1,
    players: new OrderedMap(players),
    hostId: host.id
  })
}

// Serializes a lobby to a summary-form in JSON, suitable for e.g. displaying a list of all the
// open lobbies.
export function toSummaryJson(lobby) {
  return {
    name: lobby.name,
    map: lobby.map,
    gameType: lobby.gameType,
    gameSubType: lobby.gameSubType,
    numSlots: lobby.numSlots,
    host: { name: lobby.getIn(['players', lobby.hostId, 'name']), id: lobby.hostId },
    filledSlots: lobby.filledSlots,
  }
}

// Finds the next empty slot in the lobby. Returns -1 if there are no available slots.
export function findEmptySlot(lobby) {
  if (lobby.numSlots <= lobby.filledSlots) {
    return -1
  }

  const slots = lobby.players.filter(p => !p.controlledBy).map(p => p.slot).toSet()
  if (!isTeamType(lobby.gameType)) {
    for (let s = 0; s < lobby.numSlots; s++) {
      if (!slots.has(s)) {
        return s
      }
    }
  } else {
    const teamCount = lobby.gameType === 'topVBottom' ? 2 : lobby.gameSubType
    const perTeam = slotsPerTeam(lobby.gameType, lobby.gameSubType)
    // Group slots by the team they belong to
    const teamsMap = slots.groupBy(s => Math.min(Math.floor(s / perTeam), teamCount - 1))
    // Make a list of all teams with any empty spaces filled in with an empty Set
    const teamsList = Range(0, teamCount).map(t => teamsMap.get(t) || new Set())
    // Count the number of players in each team, filter any teams that are full out, then sort the
    // remaining teams by the number of players (human or computer) they have, such that the first
    // team in the resulting list is the one with the least number of players
    const teamCounts =
        teamsList.map((t, index) => ({
          size: t.size,
          maxSize: index < teamCount - 1 ? perTeam : lobby.numSlots - (perTeam * (teamCount - 1)),
          index,
          slots: t,
        })).filter(t => t.size < t.maxSize).sort((a, b) => {
          if (a.size < b.size) return -1
          else if (a.size > b.size) return 1
          else return a.index - b.index
        })
    const targetTeam = teamCounts.get(0)
    const start = targetTeam.index * perTeam
    for (let s = start; s < start + targetTeam.maxSize; s++) {
      if (!targetTeam.slots.has(s)) {
        return s
      }
    }
  }

  throw new Error('Invalid state: not at max players but failed to find empty slot')
}

// Adds a player to the lobby, returning the updated lobby. The player should already have the
// proper slot set (see #findEmptySlot).
export function addPlayer(lobby, player) {
  if (player.slot < 0 || player.slot >= lobby.numSlots) {
    throw new Error('slot out of bounds')
  } else if (lobby.players.some(p => !p.controlledBy && p.slot === player.slot)) {
    throw new Error('slot conflict')
  }

  if (!hasControlledOpens(lobby.gameType)) {
    return lobby.setIn(['players', player.id], player).set('filledSlots', lobby.filledSlots + 1)
  } else {
    const perTeam = slotsPerTeam(lobby.gameType, lobby.gameSubType)
    const teamNum = Math.floor(player.slot / perTeam)
    const inSlot = lobby.players.find(p => p.slot === player.slot)
    if (inSlot) {
      if (player.isComputer) {
        // Teams must be either all human or all computer
        throw new Error('slot type conflict')
      }
      // This player is replacing a slot that was previously a controlled open
      return (lobby.deleteIn(['players', inSlot.id])
        .setIn(['players', player.id], player)
        .set('filledSlots', lobby.filledSlots + 1))
    } else {
      // No one was found in this slot, so this team was previously empty. So, we fill the remaining
      // slots in the team with either ones that are controlled by the added player, or computers,
      // depending on whether or not the player being added is human or computer
      const start = perTeam * teamNum
      const end = Math.min(perTeam * (teamNum + 1), lobby.numSlots)
      const players = Range(start, end).map(slot => {
        if (slot === player.slot) return [player.id, player]
        const fill = player.isComputer ?
            Players.createComputer(player.race, slot) :
            Players.createControlledOpen(player.id, player.race, slot)
        return [fill.id, fill]
      })
      return (lobby.mergeIn(['players'], players)
        .set('filledSlots', lobby.filledSlots + (player.isComputer ? end - start : 1)))
    }
  }
}

// Updates the race of a particular player, returning the updated lobby.
export function setRace(lobby, id, newRace) {
  return lobby.setIn(['players', id, 'race'], newRace)
}

// Removes the player with specified `id` from a lobby, returning the updated lobby. If the lobby
// is closed (e.g. because it no longer has any human players), null will be returned. Note that
// if the host is being removed, a new, suitable host will be chosen.
export function removePlayerById(lobby, id) {
  const toRemove = lobby.players.get(id)
  if (!toRemove) {
    // nothing removed, e.g. player wasn't in the lobby
    return lobby
  } else if (toRemove.controlledBy) {
    throw new Error('invalid slot type')
  }

  let updated
  if (hasControlledOpens(lobby.gameType)) {
    const perTeam = slotsPerTeam(lobby.gameType, lobby.gameSubType)
    const teamNum = Math.floor(toRemove.slot / perTeam)
    const sameTeam = p => p.slot >= perTeam * teamNum && p.slot < perTeam * (teamNum + 1)

    if (toRemove.isComputer ||
        lobby.players.filter(p => !p.controlledBy && sameTeam(p)).size === 1) {
      // If this player is a computer, or if they were the last non-open slot on a team, remove all
      // the other entries for this team as well
      const teamSize = Math.min(perTeam * (teamNum + 1), lobby.numSlots) - (perTeam * teamNum)
      updated = lobby.update('players', players => players.filterNot(sameTeam))
        .set('filledSlots', lobby.filledSlots - (toRemove.isComputer ? teamSize : 1))
    } else {
      // This is a human player, but there are other human players left in the team. Find the new
      // oldest human player in the team and:
      //  1) create a new controlled open with controlledBy set to their ID
      //  2) update any controlled opens with controlledBy set to the leaver's ID to that ID
      const oldestInTeam =
          lobby.players.skipUntil(p => !p.controlledBy && sameTeam(p) && p.id !== id).first()
      updated = lobby.update('players', players => players.mapEntries(entry => {
        const [, p] = entry
        if (p.id === id || p.controlledBy === id) {
          const open = Players.createControlledOpen(oldestInTeam.id, p.race, p.slot)
          return [open.id, open]
        } else if (p.controlledBy === id) {
          return [p.id, p.set('controlledBy', oldestInTeam.id)]
        } else {
          return entry
        }
      })).set('filledSlots', lobby.filledSlots - 1)
    }
  } else {
    updated = lobby.deleteIn(['players', id]).set('filledSlots', lobby.filledSlots - 1)
  }
  if (!updated.filledSlots) {
    return null
  }

  if (lobby.hostId === id) {
    // the player we removed was the host, find a new host
    const newHost = updated.players.skipWhile(p => p.isComputer || p.controlledBy).first()
    // if a new host was found, set their ID, else close the lobby (only computers left)
    return newHost ? updated.set('hostId', newHost.id) : null
  }

  return updated
}

// Finds the player with the specified name in the lobby. Only works for human players (computer
// players do not have unique names). If no player is found, undefined will be returned.
export function findPlayerByName(lobby, name) {
  return lobby.players.find(p => !p.controlledBy && !p.isComputer && p.name === name)
}

// Finds the player with the specified slot number in the lobby. If no player is found, undefined
// will be returned.
export function findPlayerBySlot(lobby, slotNum) {
  return lobby.players.find(p => p.slot === slotNum)
}

// Returns whether or not a lobby has 2 or more opposing sides (and thus would be suitable for
// starting a game from)
export function hasOpposingSides(lobby) {
  if (!isTeamType(lobby.gameType)) {
    return lobby.filledSlots > 1
  }

  const slots = lobby.players.filter(p => !p.controlledBy).map(p => p.slot).toSet()
  const teamCount = lobby.gameType === 'topVBottom' ? 2 : lobby.gameSubType
  const perTeam = slotsPerTeam(lobby.gameType, lobby.gameSubType)
  // Group slots by the team they belong to
  const teamsMap = slots.groupBy(s => Math.min(Math.floor(s / perTeam), teamCount - 1))

  return teamsMap.size > 1
}
