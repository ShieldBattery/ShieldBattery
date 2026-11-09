import { Immutable } from 'immer'
import { MatchmakingPreferencesDraft, MatchmakingType } from '../../common/matchmaking'
import { FetchError } from '../network/fetch-errors'
import { immerKeyedReducer } from '../reducers/keyed-reducer'

export interface FetchedMatchmakingPreferences {
  preferences?: MatchmakingPreferencesDraft
  /** Whether this type is part of the user's current find-match mode selection. */
  selected?: boolean
  lastError?: FetchError
  pendingRequestId?: number
  lastSavedPreferences?: MatchmakingPreferencesDraft
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

  ['@matchmaking/updatePreferencesBegin'](state, action) {
    const entry = state.byType.get(action.meta.type)
    if (!entry?.preferences) return

    entry.lastSavedPreferences ??= entry.preferences
    entry.preferences = { ...entry.preferences, ...action.payload } as MatchmakingPreferencesDraft
    entry.pendingRequestId = action.meta.requestId
    entry.lastError = undefined
  },

  ['@matchmaking/updatePreferences'](state, action) {
    const { type } = action.meta
    const entry = state.byType.get(type)
    if (entry?.pendingRequestId !== undefined && entry.pendingRequestId !== action.meta.requestId) {
      if (!action.error) entry.lastSavedPreferences = action.payload.preferences
      return
    }

    if (action.error) {
      if (!entry) {
        state.byType.set(type, { lastError: action.payload })
      } else {
        entry.preferences = entry.lastSavedPreferences ?? entry.preferences
        entry.lastSavedPreferences = undefined
        entry.pendingRequestId = undefined
        entry.lastError = action.payload
      }
      return
    }

    const { preferences, selected } = action.payload
    state.byType.set(type, { preferences, selected })
  },
})
