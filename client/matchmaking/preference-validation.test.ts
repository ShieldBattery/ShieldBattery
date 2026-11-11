import { describe, expect, test } from 'vitest'
import { SbMapId } from '../../common/maps'
import {
  defaultPreferences,
  MatchmakingPreferencesDraft,
  MatchmakingType,
} from '../../common/matchmaking'
import { MatchmakingMapPoolJson } from '../../common/matchmaking/matchmaking-map-pools'
import { makeSbUserId } from '../../common/users/sb-user-id'
import { getMatchmakingPreferencesError } from './preference-validation'

const mapId = 'current-map' as SbMapId
const staleMapId = 'old-map' as SbMapId
const pool: MatchmakingMapPoolJson = {
  id: 1,
  matchmakingType: MatchmakingType.Match1v1,
  maps: [mapId],
  maxVetoCount: 0,
  startDate: 0,
}

function preferences(type: MatchmakingType): MatchmakingPreferencesDraft {
  return { ...defaultPreferences(type, makeSbUserId(1)), race: null }
}

describe('matchmaking settings validation', () => {
  test('requires a race even when maps are already configured', () => {
    expect(
      getMatchmakingPreferencesError(
        { ...preferences(MatchmakingType.Match1v1), mapSelections: [mapId] },
        pool,
      ),
    ).toBe('race')
  })

  test('an explicit Random choice is configured and vetoes are optional', () => {
    expect(
      getMatchmakingPreferencesError({ ...preferences(MatchmakingType.Match1v1), race: 'r' }, pool),
    ).toBeUndefined()
  })

  test('fixed-map modes require a race but no map selections', () => {
    const prefs = preferences(MatchmakingType.Match2v2Bgh)
    expect(getMatchmakingPreferencesError(prefs, pool)).toBe('race')
    expect(getMatchmakingPreferencesError({ ...prefs, race: 'p' }, pool)).toBeUndefined()
  })

  test('pick modes require at least one selection in the current map pool', () => {
    const prefs = { ...preferences(MatchmakingType.Match1v1Fastest), race: 't' as const }
    expect(getMatchmakingPreferencesError(prefs, pool)).toBe('maps')
    expect(getMatchmakingPreferencesError({ ...prefs, mapSelections: [staleMapId] }, pool)).toBe(
      'maps',
    )
    expect(
      getMatchmakingPreferencesError({ ...prefs, mapSelections: [staleMapId, mapId] }, pool),
    ).toBeUndefined()
  })

  test('waits for preferences and for the map pool needed to validate picks', () => {
    expect(getMatchmakingPreferencesError(undefined, pool)).toBe('loading')
    expect(
      getMatchmakingPreferencesError(
        { ...preferences(MatchmakingType.Match1v1Fastest), race: 'p' },
        undefined,
      ),
    ).toBe('loading')
  })
})
