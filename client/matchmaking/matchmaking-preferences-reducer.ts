import { Immutable } from 'immer'
import { MatchmakingPreferences, MatchmakingType } from '../../common/matchmaking'
import { FetchError } from '../network/fetch-errors'
import { immerKeyedReducer } from '../reducers/keyed-reducer'

export interface FetchedMatchmakingPreferences {
  preferences?: MatchmakingPreferences | Record<string, never>
  mapPoolOutdated?: boolean
  lastError?: FetchError
}

export interface MatchmakingPreferencesState {
  byType: Map<MatchmakingType, FetchedMatchmakingPreferences>
  lastQueuedMatchmakingType: MatchmakingType
}

const DEFAULT_STATE: Immutable<MatchmakingPreferencesState> = {
  byType: new Map(),
  lastQueuedMatchmakingType: MatchmakingType.Match1v1,
}

export default immerKeyedReducer(DEFAULT_STATE, {
  ['@matchmaking/initPreferences'](state, action) {
    const { preferences, mapPoolOutdated } = action.payload
    const { type } = action.meta

    if (preferences) {
      state.byType.set(type, { preferences, mapPoolOutdated, lastError: undefined })
    } else {
      state.byType.delete(type)
    }
  },

  ['@matchmaking/updatePreferences'](state, action) {
    const { type } = action.meta

    if (action.error) {
      if (!state.byType.has(type)) {
        state.byType.set(type, { lastError: action.payload })
      } else {
        state.byType.get(type)!.lastError = action.payload
      }
      return
    }

    const { preferences, mapPoolOutdated } = action.payload
    state.byType.set(type, { preferences, mapPoolOutdated })
  },

  ['@matchmaking/updateLastQueuedMatchmakingType'](state, action) {
    state.lastQueuedMatchmakingType = action.payload
  },

  ['@auth/loadCurrentSession'](state, action) {
    if (action.error) {
      return state
    }

    const { lastQueuedMatchmakingType } = action.payload
    if (lastQueuedMatchmakingType) {
      state.lastQueuedMatchmakingType = lastQueuedMatchmakingType
    }

    return state
  },
})
