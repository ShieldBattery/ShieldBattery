import { Map, Record } from 'immutable'
import {
  LOBBY_INIT_DATA,
  LOBBY_UPDATE_HOST_CHANGE,
  LOBBY_UPDATE_JOIN,
  LOBBY_UPDATE_LEAVE,
} from '../actions'

export const Player = new Record({
  name: null,
  id: null,
  race: 'r',
  isComputer: false,
  slot: -1
})
export const Lobby = new Record({
  name: null,
  map: null,
  numSlots: 0,
  players: new Map(),
  hostId: null,
  myId: null,
})

const playersObjToMap = obj => {
  const records = Object.keys(obj).reduce((result, key) => {
    result[key] = new Player(obj[key])
    return result
  }, {})

  return new Map(records)
}

const handlers = {
  [LOBBY_INIT_DATA](state, action) {
    const { lobby, myId } = action.payload
    return new Lobby({
      ...lobby,
      myId,
      players: playersObjToMap(lobby.players),
    })
  },

  [LOBBY_UPDATE_JOIN](state, action) {
    const player = new Player(action.payload)
    return state.set('players', state.players.set(player.id, player))
  },

  [LOBBY_UPDATE_LEAVE](state, action) {
    if (action.payload === state.myId) {
      // We were the ones that left
      return new Lobby()
    } else {
      return state.deleteIn(['players', action.payload])
    }
  },

  [LOBBY_UPDATE_HOST_CHANGE](state, action) {
    return state.set('hostId', action.payload)
  },
}

export default function lobbyReducer(state = new Lobby(), action) {
  return handlers.hasOwnProperty(action.type) ? handlers[action.type](state, action) : state
}
