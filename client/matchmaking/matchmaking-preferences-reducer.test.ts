import { enableMapSet, Immutable } from 'immer'
import { describe, expect, test } from 'vitest'
import { SbMapId } from '../../common/maps'
import {
  defaultPreferences,
  GetPreferencesResponse,
  MatchmakingPreferencesDraft,
  MatchmakingType,
  PartialMatchmakingPreferences,
} from '../../common/matchmaking'
import { makeSbUserId } from '../../common/users/sb-user-id'
import { FetchError } from '../network/fetch-errors'
import { MatchmakingActions } from './actions'
import reducerImport, { MatchmakingPreferencesState } from './matchmaking-preferences-reducer'

enableMapSet()

const reducer: (
  state: Immutable<MatchmakingPreferencesState> | undefined,
  action: MatchmakingActions,
) => Immutable<MatchmakingPreferencesState> = reducerImport

const type = MatchmakingType.Match1v1
const userId = makeSbUserId(1)
const mapId = 'map-1' as SbMapId
const initial: MatchmakingPreferencesDraft = { ...defaultPreferences(type, userId), race: null }
const response = (preferences: MatchmakingPreferencesDraft): GetPreferencesResponse => ({
  preferences,
  selected: false,
  currentMapPoolId: 1,
  mapInfos: [],
})
const failure = new FetchError(new Response(null, { status: 500, statusText: 'Server Error' }), '')

function initialize() {
  return reducer(undefined, {
    type: '@matchmaking/initPreferences',
    payload: response(initial),
    meta: { type },
  })
}

function begin(
  state: Immutable<MatchmakingPreferencesState>,
  requestId: number,
  changes: PartialMatchmakingPreferences,
) {
  return reducer(state, {
    type: '@matchmaking/updatePreferencesBegin',
    payload: changes,
    meta: { type, requestId },
  })
}

function succeed(
  state: Immutable<MatchmakingPreferencesState>,
  requestId: number,
  preferences: MatchmakingPreferencesDraft,
) {
  return reducer(state, {
    type: '@matchmaking/updatePreferences',
    payload: response(preferences),
    meta: { type, requestId },
  })
}

function fail(state: Immutable<MatchmakingPreferencesState>, requestId: number) {
  return reducer(state, {
    type: '@matchmaking/updatePreferences',
    error: true,
    payload: failure,
    meta: { type, requestId },
  })
}

describe('matchmaking preferences saves', () => {
  test('keeps the latest draft visible while earlier saves complete', () => {
    let state = initialize()
    state = begin(state, 1, { userId, matchmakingType: type, mapSelections: [] })
    state = begin(state, 2, { userId, matchmakingType: type, race: 'p' })
    expect(state.byType.get(type)?.preferences?.race).toBe('p')

    state = begin(state, 3, { userId, matchmakingType: type, mapSelections: [mapId] })
    const draft = { ...initial, race: 'p' as const, mapSelections: [mapId] }
    expect(state.byType.get(type)?.preferences).toEqual(draft)

    state = succeed(state, 1, initial)
    expect(state.byType.get(type)?.preferences).toEqual(draft)
    expect(state.byType.get(type)?.pendingRequestId).toBe(3)

    state = succeed(state, 2, { ...initial, race: 'p' })
    expect(state.byType.get(type)?.preferences).toEqual(draft)
    state = succeed(state, 3, draft)
    expect(state.byType.get(type)?.preferences).toEqual(draft)
    expect(state.byType.get(type)?.pendingRequestId).toBeUndefined()
  })

  test('rolls back a failed latest save to the most recently confirmed preferences', () => {
    let state = initialize()
    state = begin(state, 1, { userId, matchmakingType: type, race: 'p' })
    state = begin(state, 2, { userId, matchmakingType: type, mapSelections: [mapId] })
    const saved = { ...initial, race: 'p' as const }
    state = succeed(state, 1, saved)
    state = fail(state, 2)

    expect(state.byType.get(type)?.preferences).toEqual(saved)
    expect(state.byType.get(type)?.pendingRequestId).toBeUndefined()
    expect(state.byType.get(type)?.lastError).toBe(failure)
  })

  test('does not discard a newer draft when an older save fails', () => {
    let state = initialize()
    state = begin(state, 1, { userId, matchmakingType: type, race: 'p' })
    state = begin(state, 2, { userId, matchmakingType: type, mapSelections: [mapId] })
    state = fail(state, 1)

    expect(state.byType.get(type)?.preferences).toEqual({
      ...initial,
      race: 'p',
      mapSelections: [mapId],
    })
    expect(state.byType.get(type)?.pendingRequestId).toBe(2)
    expect(state.byType.get(type)?.lastError).toBeUndefined()
  })
})
