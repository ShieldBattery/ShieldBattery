import { Immutable } from 'immer'
import { List, Record } from 'immutable'
import { MapInfoJson } from '../../common/maps'
import { MatchmakingServiceErrorCode, MatchmakingType } from '../../common/matchmaking'
import { RaceChar } from '../../common/races'
import { NETWORK_SITE_CONNECTED } from '../actions'
import { isFetchError } from '../network/fetch-errors'
import { keyedReducer } from '../reducers/keyed-reducer'

export interface MatchmakingSearchInfo {
  matchmakingType: MatchmakingType
  race: RaceChar
  /** The time when the search was started (as returned by `window.performance.now()`) */
  startTime: number
}

export class MatchmakingPlayerRecord extends Record({
  id: 0,
  name: '',
  race: 'r',
  rating: -1,
}) {}

export class MatchmakingMatchRecord extends Record({
  numPlayers: 0,
  acceptedPlayers: 0,
  type: MatchmakingType.Match1v1 as MatchmakingType,
  players: List<MatchmakingPlayerRecord>(),
  chosenMap: undefined as MapInfoJson | undefined,
}) {}

export class BaseMatchmakingState extends Record({
  searchInfo: undefined as Immutable<MatchmakingSearchInfo> | undefined,
  isAccepting: false,
  hasAccepted: false,
  acceptTime: -1,
  failedToAccept: false,
  isLaunching: false,
  isCountingDown: false,
  countdownTimer: -1,
  isStarting: false,

  match: undefined as MatchmakingMatchRecord | undefined,
}) {}

export class MatchmakingState extends BaseMatchmakingState {
  get isLoading() {
    return this.isLaunching || this.isCountingDown || this.isStarting
  }
}

export default keyedReducer(new MatchmakingState(), {
  ['@matchmaking/acceptMatchBegin'](state, action) {
    return state.set('isAccepting', true)
  },

  ['@matchmaking/acceptMatch'](state, action) {
    if (action.error) {
      return new MatchmakingState()
    }

    return state.set('hasAccepted', true).set('isAccepting', false)
  },

  ['@matchmaking/cancelMatch'](state, action) {
    if (action.error) {
      if (isFetchError(action.payload)) {
        if (action.payload.code !== MatchmakingServiceErrorCode.MatchAlreadyStarting) {
          return new MatchmakingState()
        }
      }

      // non-FetchError indicates a server or connection error, leave the state as it was
      return state
    } else {
      // Success, matchmaking was canceled
      return new MatchmakingState()
    }
  },

  ['@matchmaking/startSearch'](
    state,
    { payload: { matchmakingType, race }, system: { monotonicTime } },
  ) {
    return new MatchmakingState({
      searchInfo: {
        matchmakingType,
        race,
        startTime: monotonicTime,
      },
    })
  },

  ['@matchmaking/requeue'](state, action) {
    return state.set('match', undefined).set('failedToAccept', false)
  },

  ['@matchmaking/playerFailedToAccept'](state, action) {
    return state.set('failedToAccept', true).set('searchInfo', undefined).set('match', undefined)
  },

  ['@matchmaking/acceptMatchTime'](state, action) {
    return state.set('acceptTime', action.payload)
  },

  ['@matchmaking/matchFound'](state, action) {
    const { matchmakingType, numPlayers } = action.payload
    return state
      .set('match', new MatchmakingMatchRecord({ type: matchmakingType, numPlayers }))
      .set('hasAccepted', false)
  },

  ['@matchmaking/playerAccepted'](state, action) {
    return state.setIn(['match', 'acceptedPlayers'], action.payload.acceptedPlayers)
  },

  ['@matchmaking/matchReady'](state, action) {
    const { matchmakingType, players, chosenMap } = action.payload

    return state.set('isLaunching', true).set(
      'match',
      new MatchmakingMatchRecord({
        type: matchmakingType,
        acceptedPlayers: players.length,
        numPlayers: players.length,
        players: List(players.map(p => new MatchmakingPlayerRecord(p))),
        chosenMap,
      }),
    )
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
    return new MatchmakingState({
      searchInfo: state.searchInfo,
    })
  },

  ['@matchmaking/queueStatus'](state, action) {
    if (!action.payload.matchmaking) {
      return new MatchmakingState({ failedToAccept: state.failedToAccept })
    }

    return state
  },

  [NETWORK_SITE_CONNECTED as any]() {
    return new MatchmakingState()
  },
})
