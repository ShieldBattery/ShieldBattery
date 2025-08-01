import { Immutable } from 'immer'
import { ReadonlyDeep } from 'type-fest'
import { MatchmakingServiceErrorCode, MatchmakingType } from '../../common/matchmaking'
import { RaceChar } from '../../common/races'
import { isFetchError } from '../network/fetch-errors'
import { immerKeyedReducer } from '../reducers/keyed-reducer'
import { MatchmakingMatch } from './matchmaking-match-state'

export interface MatchmakingSearchInfo {
  matchmakingType: MatchmakingType
  race: RaceChar
  /** The time when the search was started (as returned by `window.performance.now()`) */
  startTime: number
}

export interface MatchmakingState {
  searchInfo?: MatchmakingSearchInfo
  isAccepting: boolean
  hasAccepted: boolean
  acceptTime?: number
  failedToAccept: boolean
  isLaunching: boolean
  isCountingDown: boolean
  countdownTimer?: number

  match?: MatchmakingMatch
}

export function isMatchmakingLoading(state: Immutable<MatchmakingState>): boolean {
  return state.isLaunching || state.isCountingDown
}

const DEFAULT_STATE: ReadonlyDeep<MatchmakingState> = {
  searchInfo: undefined,
  isAccepting: false,
  hasAccepted: false,
  acceptTime: undefined,
  failedToAccept: false,
  isLaunching: false,
  isCountingDown: false,
  countdownTimer: undefined,
  match: undefined,
}

export default immerKeyedReducer(DEFAULT_STATE, {
  ['@matchmaking/acceptMatchBegin'](state, action) {
    state.isAccepting = true
  },

  ['@matchmaking/acceptMatch'](state, action) {
    if (action.error) {
      return DEFAULT_STATE
    }

    state.hasAccepted = true
    state.isAccepting = false
    return state
  },

  ['@matchmaking/cancelMatch'](state, action) {
    if (action.error) {
      if (isFetchError(action.payload)) {
        if (action.payload.code !== MatchmakingServiceErrorCode.MatchAlreadyStarting) {
          return DEFAULT_STATE
        }
      }

      // non-FetchError indicates a server or connection error, leave the state as it was
      return state
    } else {
      // Success, matchmaking was canceled
      return DEFAULT_STATE
    }
  },

  ['@matchmaking/startSearch'](
    state,
    { payload: { matchmakingType, race }, system: { monotonicTime } },
  ) {
    return {
      ...DEFAULT_STATE,
      searchInfo: {
        matchmakingType,
        race,
        startTime: monotonicTime,
      },
    }
  },

  ['@matchmaking/requeue'](state, action) {
    state.match = undefined
    state.failedToAccept = false
  },

  ['@matchmaking/playerFailedToAccept'](state, action) {
    state.failedToAccept = true
    state.searchInfo = undefined
    state.match = undefined
  },

  ['@matchmaking/acceptMatchTime'](state, action) {
    state.acceptTime = action.payload
  },

  ['@matchmaking/matchFound'](state, action) {
    const { matchmakingType, numPlayers } = action.payload
    state.match = {
      type: matchmakingType,
      numPlayers,
      acceptedPlayers: 0,
      players: undefined,
    }
    state.hasAccepted = false
  },

  ['@matchmaking/playerAccepted'](state, action) {
    if (state.match) {
      state.match.acceptedPlayers = action.payload.acceptedPlayers
    }
  },

  ['@matchmaking/matchReady'](state, action) {
    state.isLaunching = true
  },

  ['@matchmaking/countdownStarted'](state, action) {
    state.isLaunching = false
    state.isCountingDown = true
    state.countdownTimer = action.payload
  },

  ['@matchmaking/countdownTick'](state, action) {
    state.countdownTimer = action.payload
  },

  ['@matchmaking/gameStarted'](state, action) {
    return DEFAULT_STATE
  },

  ['@matchmaking/loadingCanceled'](state, action) {
    return {
      ...DEFAULT_STATE,
      searchInfo: state.searchInfo,
    }
  },

  ['@matchmaking/queueStatus'](state, action) {
    if (!action.payload.matchmaking) {
      return state.failedToAccept ? { ...DEFAULT_STATE, failedToAccept: true } : DEFAULT_STATE
    }

    return state
  },

  ['@network/connect']() {
    return DEFAULT_STATE
  },
})
