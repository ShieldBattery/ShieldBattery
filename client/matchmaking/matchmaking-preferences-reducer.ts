import { List, Map, Record as ImmutableRecord } from 'immutable'
import { assertUnreachable } from '../../common/assert-unreachable'
import { MatchmakingPreferences, MatchmakingType } from '../../common/matchmaking'
import { AssignedRaceChar, RaceChar } from '../../common/races'
import { MapRecord } from '../maps/maps-reducer'
import { FetchError } from '../network/fetch-action-types'
import { keyedReducer } from '../reducers/keyed-reducer'

export class MatchmakingPreferencesData1v1Record extends ImmutableRecord({
  useAlternateRace: false,
  alternateRace: 'z' as AssignedRaceChar,
}) {}

export type MatchmakingPreferencesDataRecord =
  | MatchmakingPreferencesData1v1Record
  | Record<string, never>

export class MatchmakingPreferencesRecord extends ImmutableRecord({
  matchmakingType: MatchmakingType.Match1v1,
  race: 'r' as RaceChar,
  mapPoolId: 1,
  mapPoolOutdated: false,
  mapSelections: List<ReturnType<typeof MapRecord>>(),
  data: {} as MatchmakingPreferencesDataRecord,

  lastError: undefined as FetchError | undefined,
}) {}

export class MatchmakingPreferencesState extends ImmutableRecord({
  typeToPreferences: Map<MatchmakingType, MatchmakingPreferencesRecord>(),
  lastQueuedMatchmakingType: MatchmakingType.Match1v1,
}) {}

function toMatchmakingPreferencesDataRecord(
  prefs: Readonly<MatchmakingPreferences>,
): MatchmakingPreferencesDataRecord {
  switch (prefs.matchmakingType) {
    case MatchmakingType.Match1v1:
      return new MatchmakingPreferencesData1v1Record({
        useAlternateRace: prefs.data.useAlternateRace,
        alternateRace: prefs.data.alternateRace,
      })
    case MatchmakingType.Match2v2:
      return {}
    default:
      return assertUnreachable(prefs)
  }
}

export default keyedReducer(new MatchmakingPreferencesState(), {
  ['@matchmaking/initPreferences'](state, action) {
    const { preferences, mapPoolOutdated, mapInfos = [] } = action.payload
    // The server has not sent us any preferences, most likely due to them not existing yet. We
    // create the matchmaking preferences for this type with default values.
    if (!preferences) {
      const { type } = action.meta
      return state.setIn(
        ['typeToPreferences', type],
        new MatchmakingPreferencesRecord({ matchmakingType: type }),
      )
    }

    return state.setIn(
      ['typeToPreferences', preferences.matchmakingType],
      new MatchmakingPreferencesRecord({
        ...preferences,
        mapPoolOutdated,
        mapSelections: List(mapInfos.map(m => MapRecord(m))),
        data: toMatchmakingPreferencesDataRecord(preferences),
      }),
    )
  },

  ['@matchmaking/updatePreferences'](state, action) {
    if (action.error) {
      return state.setIn(['typeToPreferences', action.meta.type, 'lastError'], action.payload)
    }

    const { preferences, mapPoolOutdated, mapInfos } = action.payload
    return state.setIn(
      ['typeToPreferences', preferences.matchmakingType],
      new MatchmakingPreferencesRecord({
        ...preferences,
        mapPoolOutdated,
        mapSelections: List(mapInfos.map(m => MapRecord(m))),
        data: toMatchmakingPreferencesDataRecord(preferences),
      }),
    )
  },

  ['@matchmaking/updateLastQueuedMatchmakingType'](state, action) {
    return state.set('lastQueuedMatchmakingType', action.payload)
  },

  ['@auth/loadCurrentSession'](state, action) {
    if (action.error) {
      return state
    }

    const { lastQueuedMatchmakingType } = action.payload
    if (lastQueuedMatchmakingType) {
      return state.set('lastQueuedMatchmakingType', lastQueuedMatchmakingType)
    }

    return state
  },
})
