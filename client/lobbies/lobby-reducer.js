import { Map, Record } from 'immutable'
import {
  LOBBY_INIT_DATA,
  LOBBY_UPDATE_GAME_STARTED,
  LOBBY_UPDATE_HOST_CHANGE,
  LOBBY_UPDATE_JOIN,
  LOBBY_UPDATE_LEAVE,
  LOBBY_UPDATE_LEAVE_SELF,
  LOBBY_UPDATE_RACE_CHANGE,
  LOBBY_UPDATE_COUNTDOWN_START,
  LOBBY_UPDATE_COUNTDOWN_TICK,
  LOBBY_UPDATE_COUNTDOWN_CANCELED,
  LOBBY_UPDATE_LOADING_START,
  LOBBY_UPDATE_LOADING_CANCELED,
} from '../actions'

export const Player = new Record({
  name: null,
  id: null,
  race: 'r',
  isComputer: false,
  slot: -1
})
export const LobbyMap = new Record({
  name: null,
  hash: null,
  tileset: null,
  width: -1,
  height: -1,
  description: null,
  format: null,
  thumbFormat: null,
  slots: -1,
  umsSlots: -1,
})
export const Lobby = new Record({
  name: null,
  map: null,
  numSlots: 0,
  players: new Map(),
  hostId: null,
  isCountingDown: false,
  countdownTimer: -1,
  isLoading: false,
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
    const { lobby } = action.payload
    return new Lobby({
      ...lobby,
      players: playersObjToMap(lobby.players),
      map: new LobbyMap(lobby.map),
    })
  },

  [LOBBY_UPDATE_JOIN](state, action) {
    const player = new Player(action.payload)
    return state.set('players', state.players.set(player.id, player))
  },

  [LOBBY_UPDATE_RACE_CHANGE](state, action) {
    const { id, newRace } = action.payload
    return state.setIn(['players', id, 'race'], newRace)
  },

  [LOBBY_UPDATE_LEAVE](state, action) {
    return state.deleteIn(['players', action.payload])
  },

  [LOBBY_UPDATE_LEAVE_SELF](state, action) {
    return new Lobby()
  },

  [LOBBY_UPDATE_HOST_CHANGE](state, action) {
    return state.set('hostId', action.payload)
  },

  [LOBBY_UPDATE_COUNTDOWN_START](state, action) {
    return state.set('isCountingDown', true).set('countdownTimer', action.payload)
  },

  [LOBBY_UPDATE_COUNTDOWN_TICK](state, action) {
    return state.set('countdownTimer', action.payload)
  },

  [LOBBY_UPDATE_COUNTDOWN_CANCELED](state, action) {
    return state.set('isCountingDown', false).set('countdownTimer', -1)
  },

  [LOBBY_UPDATE_LOADING_START](state, action) {
    return state.set('isLoading', true).set('isCountingDown', false)
  },

  [LOBBY_UPDATE_LOADING_CANCELED](state, action) {
    return state.set('isLoading', false)
  },

  [LOBBY_UPDATE_GAME_STARTED](state, action) {
    return new Lobby()
  },
}

export default function lobbyReducer(state = new Lobby(), action) {
  return handlers.hasOwnProperty(action.type) ? handlers[action.type](state, action) : state
}
