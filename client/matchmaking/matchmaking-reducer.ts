import { List, Map, Record, Set } from 'immutable'
import { MapInfoJson } from '../../common/maps'
import { MatchmakingType } from '../../common/matchmaking'
import { MAPS_TOGGLE_FAVORITE, NETWORK_SITE_CONNECTED } from '../actions'
import { MapRecord } from '../maps/maps-reducer'
import { FetchError } from '../network/fetch-action-types'
import { keyedReducer } from '../reducers/keyed-reducer'

export class MatchmakingPlayerRecord extends Record({
  id: 0,
  name: '',
  race: 'r',
  rating: -1,
}) {}

export class MatchmakingMatchRecord extends Record({
  numPlayers: 0,
  acceptedPlayers: 0,
  type: MatchmakingType.Match1v1,
  players: List<MatchmakingPlayerRecord>(),
  preferredMaps: Set<MapInfoJson>(),
  randomMaps: Set<MapInfoJson>(),
  chosenMap: undefined as MapInfoJson | undefined,
}) {}

export class MapPoolRecord extends Record({
  id: '',
  type: MatchmakingType.Match1v1,
  startDate: new Date(),
  maps: List<string>(),
  byId: Map<string, MapInfoJson>(),

  isRequesting: false,
  lastError: undefined as FetchError | undefined,
}) {}

export class BaseMatchmakingState extends Record({
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

  match: undefined as MatchmakingMatchRecord | undefined,
  mapPoolTypes: Map<MatchmakingType, MapPoolRecord>(),
}) {}

export class MatchmakingState extends BaseMatchmakingState {
  get isLoading() {
    return this.isLaunching || this.isCountingDown || this.isStarting
  }
}

export default keyedReducer(new MatchmakingState(), {
  ['@matchmaking/acceptMatch'](state, action) {
    if (action.error) {
      return new MatchmakingState()
    }

    return state.set('hasAccepted', true)
  },

  ['@matchmaking/cancelMatch'](state, action) {
    // TODO(tec27): handle errors, which might indicate you're currently still in the queue

    return new MatchmakingState()
  },

  ['@matchmaking/findMatch'](state, action) {
    if (action.error) {
      return new MatchmakingState()
    }

    return new MatchmakingState({
      isFinding: true,
      searchStartTime: action.payload.startTime,
    })
  },

  ['@matchmaking/getCurrentMapPoolBegin'](state, action) {
    return state.setIn(
      ['mapPoolTypes', action.payload.type],
      new MapPoolRecord({ isRequesting: true }),
    )
  },

  ['@matchmaking/getCurrentMapPool'](state, action) {
    if (action.error) {
      const { meta, payload } = action

      return state.setIn(['mapPoolTypes', meta.type], new MapPoolRecord({ lastError: payload }))
    }

    const { meta, payload } = action
    const mapPool = {
      ...payload,
      maps: List(payload.maps.map(m => m.id)),
      byId: Map(payload.maps.map(m => [m.id, new MapRecord(m) as MapInfoJson])),
    }
    return state.setIn(['mapPoolTypes', meta.type], new MapPoolRecord(mapPool))
  },

  ['@matchmaking/playerFailedToAccept'](state, action) {
    return state.set('failedToAccept', true)
  },

  ['@matchmaking/acceptMatchTime'](state, action) {
    return state.set('acceptTime', action.payload)
  },

  ['@matchmaking/matchFound'](state, action) {
    const { matchmakingType, numPlayers } = action.payload
    return state
      .set('match', new MatchmakingMatchRecord({ type: matchmakingType, numPlayers }))
      .set('isFinding', false)
      .set('hasAccepted', false)
  },

  ['@matchmaking/playerAccepted'](state, action) {
    return state.setIn(['match', 'acceptedPlayers'], action.payload.acceptedPlayers)
  },

  ['@matchmaking/matchReady'](state, action) {
    const { players, preferredMaps, randomMaps, chosenMap } = action.payload
    const match = {
      acceptedPlayers: Object.keys(players).length,
      players: List(players.map(p => new MatchmakingPlayerRecord(p))),
      preferredMaps: Set(preferredMaps.map(m => new MapRecord(m))),
      randomMaps: Set(randomMaps.map(m => new MapRecord(m))),
      chosenMap: new MapRecord(chosenMap),
    }

    return state.set('isLaunching', true).update('match', m => m!.merge(match))
  },

  ['@matchmaking/countdownStarted'](state, action) {
    return state
      .set('isLaunching', false)
      .set('isCountingDown', true)
      .set('countdownTimer', action.payload)
  },

  ['@matchmaking/countdownTick'](state, action) {
    return state.set('countdownTimer', action.payload)
  },

  ['@matchmaking/gameStarting'](state, action) {
    return state.set('isStarting', true).set('isCountingDown', false)
  },

  ['@matchmaking/gameStarted'](state, action) {
    return new MatchmakingState()
  },

  ['@matchmaking/loadingCanceled'](state, action) {
    return new MatchmakingState()
  },

  [MAPS_TOGGLE_FAVORITE as any](state: any, action: any) {
    const {
      map,
      context: { matchmakingType: type },
    } = action.meta

    if (!type) {
      return state
    }

    return state.setIn(['mapPoolTypes', type, 'byId', map.id, 'isFavorited'], !map.isFavorited)
  },

  [NETWORK_SITE_CONNECTED as any]() {
    return new MatchmakingState()
  },
})
