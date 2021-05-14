import { List, Map, Record, Set } from 'immutable'
import {
  MAPS_TOGGLE_FAVORITE,
  MATCHMAKING_ACCEPT,
  MATCHMAKING_CANCEL,
  MATCHMAKING_FIND,
  MATCHMAKING_GET_CURRENT_MAP_POOL,
  MATCHMAKING_GET_CURRENT_MAP_POOL_BEGIN,
  MATCHMAKING_UPDATE_ACCEPT_MATCH_FAILED,
  MATCHMAKING_UPDATE_ACCEPT_MATCH_TIME,
  MATCHMAKING_UPDATE_COUNTDOWN_START,
  MATCHMAKING_UPDATE_COUNTDOWN_TICK,
  MATCHMAKING_UPDATE_GAME_STARTED,
  MATCHMAKING_UPDATE_GAME_STARTING,
  MATCHMAKING_UPDATE_LOADING_CANCELED,
  MATCHMAKING_UPDATE_MATCH_ACCEPTED,
  MATCHMAKING_UPDATE_MATCH_FOUND,
  MATCHMAKING_UPDATE_MATCH_READY,
  NETWORK_SITE_CONNECTED,
} from '../actions'
import { MapRecord } from '../maps/maps-reducer'
import keyedReducer from '../reducers/keyed-reducer'

export const Player = new Record({
  id: null,
  name: null,
  race: null,
  rating: -1,
})
const Match = new Record({
  numPlayers: 0,
  acceptedPlayers: 0,
  type: null,
  players: new List(),
  preferredMaps: new Set(),
  randomMaps: new Set(),
  chosenMap: null,
})
const MapPool = new Record({
  id: null,
  type: null,
  startDate: null,
  maps: new List(),
  byId: new Map(),

  isRequesting: false,
  lastError: null,
})
export const BaseMatchmakingState = new Record({
  isFinding: false,
  /** The time when the search was started (as returned by `window.performance.now()`) */
  searchStartTime: -1,
  hasAccepted: false,
  acceptTime: -1,
  failedToAccept: false,
  isLaunching: false,
  isCountingDown: false,
  countdownTimer: -1,
  isStarting: false,

  match: null,
  mapPoolTypes: new Map(),
})
export class MatchmakingState extends BaseMatchmakingState {
  get isLoading() {
    return this.isLaunching || this.isCountingDown || this.isStarting
  }
}

export default keyedReducer(new MatchmakingState(), {
  [MATCHMAKING_ACCEPT](state, action) {
    if (action.error) {
      return new MatchmakingState()
    }

    return state.set('hasAccepted', true)
  },

  [MATCHMAKING_CANCEL](state, action) {
    // TODO(tec27): handle errors, which might indicate you're currently still in the queue

    return new MatchmakingState()
  },

  [MATCHMAKING_FIND](state, action) {
    if (action.error) {
      return new MatchmakingState()
    }

    return new MatchmakingState({
      isFinding: true,
      searchStartTime: action.payload.startTime,
    })
  },

  [MATCHMAKING_GET_CURRENT_MAP_POOL_BEGIN](state, action) {
    return state.setIn(['mapPoolTypes', action.meta.type], new MapPool({ isRequesting: true }))
  },

  [MATCHMAKING_GET_CURRENT_MAP_POOL](state, action) {
    const { meta, payload } = action

    if (action.error) {
      return state.setIn(['mapPoolTypes', meta.type], new MapPool({ lastError: payload }))
    }

    const mapPool = {
      ...payload,
      maps: new List(payload.maps.map(m => m.id)),
      byId: new Map(payload.maps.map(m => [m.id, new MapRecord(m)])),
    }
    return state.setIn(['mapPoolTypes', meta.type], new MapPool(mapPool))
  },

  [MAPS_TOGGLE_FAVORITE](state, action) {
    const {
      map,
      context: { matchmakingType: type },
    } = action.meta

    if (!type) {
      return state
    }

    return state.setIn(['mapPoolTypes', type, 'byId', map.id, 'isFavorited'], !map.isFavorited)
  },

  [MATCHMAKING_UPDATE_ACCEPT_MATCH_FAILED](state, action) {
    return state.set('failedToAccept', true)
  },

  [MATCHMAKING_UPDATE_ACCEPT_MATCH_TIME](state, action) {
    return state.set('acceptTime', action.payload)
  },

  [MATCHMAKING_UPDATE_MATCH_FOUND](state, action) {
    const { matchmakingType, numPlayers } = action.payload
    return state
      .set('match', new Match({ type: matchmakingType, numPlayers }))
      .set('isFinding', false)
      .set('hasAccepted', false)
  },

  [MATCHMAKING_UPDATE_MATCH_ACCEPTED](state, action) {
    return state.setIn(['match', 'acceptedPlayers'], action.payload.acceptedPlayers)
  },

  [MATCHMAKING_UPDATE_MATCH_READY](state, action) {
    const { players, preferredMaps, randomMaps, chosenMap } = action.payload
    const match = {
      acceptedPlayers: Object.keys(players).length,
      players: new List(players.map(p => new Player(p))),
      preferredMaps: new Set(preferredMaps.map(m => new MapRecord(m))),
      randomMaps: new Set(randomMaps.map(m => new MapRecord(m))),
      chosenMap: new MapRecord(chosenMap),
    }

    return state.set('isLaunching', true).update('match', m => m.merge(match))
  },

  [MATCHMAKING_UPDATE_COUNTDOWN_START](state, action) {
    return state
      .set('isLaunching', false)
      .set('isCountingDown', true)
      .set('countdownTimer', action.payload)
  },

  [MATCHMAKING_UPDATE_COUNTDOWN_TICK](state, action) {
    return state.set('countdownTimer', action.payload)
  },

  [MATCHMAKING_UPDATE_GAME_STARTING](state, action) {
    return state.set('isStarting', true).set('isCountingDown', false)
  },

  [MATCHMAKING_UPDATE_GAME_STARTED](state, action) {
    return new MatchmakingState()
  },

  [MATCHMAKING_UPDATE_LOADING_CANCELED](state, action) {
    return new MatchmakingState()
  },

  [NETWORK_SITE_CONNECTED](state, action) {
    return new MatchmakingState()
  },
})
