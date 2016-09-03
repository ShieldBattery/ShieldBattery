import { OrderedMap, Record, } from 'immutable'
import * as Players from './player'

const Lobby = new Record({
  name: null,
  map: null,
  numSlots: 0,
  players: new OrderedMap(),
  hostId: null,
  gameType: 'melee',
  gameSubType: 0,
})

// Creates a new lobby, and an initial host player in the first slot.
export function create(name, map, gameType, gameSubType = 0, numSlots, hostName, hostRace = 'r') {
  const host = Players.createHuman(hostName, hostRace, 0)
  return new Lobby({
    name,
    map,
    gameType,
    gameSubType: +gameSubType,
    numSlots,
    players: new OrderedMap({ [host.id]: host }),
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
    filledSlots: lobby.players.size,
  }
}

// Finds the next empty slot in the lobby. Returns -1 if there are no available slots.
export function findEmptySlot(lobby) {
  if (lobby.numSlots <= lobby.players.size) {
    return -1
  }

  const slots = lobby.players.map(p => p.slot).toSet()
  for (let s = 0; s < lobby.numSlots; s++) {
    if (!slots.has(s)) {
      return s
    }
  }

  throw new Error('Invalid state: not at max players but failed to find empty slot')
}

// Adds a player to the lobby, returning the updated lobby. The player should already have the
// proper slot set (see #findEmptySlot).
export function addPlayer(lobby, player) {
  if (player.slot < 0 || player.slot >= lobby.numSlots) {
    throw new Error('slot out of bounds')
  } else if (lobby.players.some(p => p.slot === player.slot)) {
    throw new Error('slot conflict')
  }

  return lobby.setIn(['players', player.id], player)
}

// Updates the race of a particular player, returning the updated lobby.
export function setRace(lobby, id, newRace) {
  return lobby.setIn(['players', id, 'race'], newRace)
}

// Removes the player with specified `id` from a lobby, returning the updated lobby. If the lobby
// is closed (e.g. because it no longer has any human players), null will be returned. Note that
// if the host is being removed, a new, suitable host will be chosen.
export function removePlayerById(lobby, id) {
  const updated = lobby.deleteIn(['players', id])
  if (updated === lobby) {
    // nothing removed, e.g. player wasn't in the lobby
    return lobby
  }

  if (updated.players.isEmpty()) {
    return null
  }

  if (lobby.hostId === id) {
    // the player we removed was the host, find a new host
    const newHost = updated.players.skipWhile(p => p.isComputer).first()
    // if a new host was found, set their ID, else close the lobby (only computers left)
    return newHost ? updated.set('hostId', newHost.id) : null
  }

  return updated
}

// Finds the player with the specified name in the lobby. Only works for human players (computer
// players do not have unique names). If no player is found, undefined will be returned.
export function findPlayerByName(lobby, name) {
  return lobby.players.find(p => !p.isComputer && p.name === name)
}

// Finds the player with the specified slot number in the lobby. If no player is found, undefined
// will be returned.
export function findPlayerBySlot(lobby, slotNum) {
  return lobby.players.find(p => p.slot === slotNum)
}
