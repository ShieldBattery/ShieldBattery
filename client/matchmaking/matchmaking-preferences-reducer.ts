import { Immutable } from 'immer'
import { MatchmakingPreferences, MatchmakingType } from '../../common/matchmaking'
import { FetchError } from '../network/fetch-errors'
import { immerKeyedReducer } from '../reducers/keyed-reducer'

export interface FetchedMatchmakingPreferences {
  preferences?: MatchmakingPreferences
  /** Whether this type is part of the user's current find-match mode selection. */
  selected?: boolean
  lastError?: FetchError
}

export interface MatchmakingPreferencesState {
  byType: Map<MatchmakingType, FetchedMatchmakingPreferences>
}

const DEFAULT_STATE: Immutable<MatchmakingPreferencesState> = {
  byType: new Map(),
}

export default immerKeyedReducer(DEFAULT_STATE, {
  ['@matchmaking/initPreferences'](state, action) {
    const { preferences, selected } = action.payload
    const { type } = action.meta

    state.byType.set(type, { preferences, selected, lastError: undefined })
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

    const { preferences, selected } = action.payload
    state.byType.set(type, { preferences, selected })
  },
})
