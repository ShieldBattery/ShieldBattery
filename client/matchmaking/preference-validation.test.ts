import { describe, expect, test } from 'vitest'
import { SbMapId } from '../../common/maps'
import {
  defaultPreferences,
  MatchmakingPreferencesDraft,
  MatchmakingType,
} from '../../common/matchmaking'
import {
  MatchmakingMapPoolChanges,
  MatchmakingMapPoolJson,
} from '../../common/matchmaking/matchmaking-map-pools'
import { makeSbUserId } from '../../common/users/sb-user-id'
import {
  getMatchmakingPreferencesError,
  MatchmakingQueueState,
  orderMatchmakingTypes,
  planMatchmakingQueue,
} from './preference-validation'

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

describe('matchmaking queue planning', () => {
  const newMapId = 'new-map' as SbMapId

  function poolFor(
    type: MatchmakingType,
    overrides: Partial<MatchmakingMapPoolJson> = {},
  ): MatchmakingMapPoolJson {
    return { ...pool, id: 2, matchmakingType: type, maps: [mapId], maxVetoCount: 2, ...overrides }
  }

  function state(
    entries: Array<{
      type: MatchmakingType
      prefs?: Partial<MatchmakingPreferencesDraft>
      pool?: MatchmakingMapPoolJson | null
      changes?: MatchmakingMapPoolChanges
    }>,
  ): MatchmakingQueueState {
    const result = {
      preferencesByType: new Map(),
      mapPoolsByType: new Map(),
      mapPoolChangesByType: new Map(),
    }
    for (const entry of entries) {
      if (entry.prefs) {
        result.preferencesByType.set(entry.type, {
          preferences: {
            ...defaultPreferences(entry.type, makeSbUserId(1), 2),
            ...entry.prefs,
          } as MatchmakingPreferencesDraft,
        })
      }
      if (entry.pool !== null) {
        result.mapPoolsByType.set(entry.type, entry.pool ?? poolFor(entry.type))
      }
      if (entry.changes) {
        result.mapPoolChangesByType.set(entry.type, entry.changes)
      }
    }
    return result
  }

  test('orders types the way the find-match screen lists them', () => {
    expect(
      orderMatchmakingTypes([
        MatchmakingType.Match3v3Bgh,
        MatchmakingType.Match1v1,
        MatchmakingType.Match2v2,
        MatchmakingType.Match1v1,
      ]),
    ).toEqual([MatchmakingType.Match1v1, MatchmakingType.Match2v2, MatchmakingType.Match3v3Bgh])
  })

  test('queues with the stored preferences when nothing needs review', () => {
    const plan = planMatchmakingQueue(
      [MatchmakingType.Match2v2, MatchmakingType.Match1v1],
      state([
        { type: MatchmakingType.Match1v1, prefs: {} },
        { type: MatchmakingType.Match2v2, prefs: {} },
      ]),
    )
    expect(plan.kind).toBe('queue')
    expect(plan.kind === 'queue' && plan.preferences.map(p => p.matchmakingType)).toEqual([
      MatchmakingType.Match1v1,
      MatchmakingType.Match2v2,
    ])
  })

  test('reviews types without a race or picked maps, in list order', () => {
    expect(
      planMatchmakingQueue(
        [MatchmakingType.Match1v1Fastest, MatchmakingType.Match1v1, MatchmakingType.Match2v2],
        state([
          { type: MatchmakingType.Match1v1, prefs: { race: null } },
          { type: MatchmakingType.Match1v1Fastest, prefs: { mapSelections: [] } },
          { type: MatchmakingType.Match2v2, prefs: {} },
        ]),
      ),
    ).toEqual({
      kind: 'review',
      reviewTypes: [MatchmakingType.Match1v1, MatchmakingType.Match1v1Fastest],
    })
  })

  test('reviews a type whose pool changed in a way that interrupts', () => {
    const changes = {
      addedMaps: [newMapId],
      removedMaps: [],
      previousMapCount: 1,
      previousMaxVetoCount: 2,
    }
    expect(
      planMatchmakingQueue(
        [MatchmakingType.Match1v1],
        state([
          {
            type: MatchmakingType.Match1v1,
            prefs: { mapPoolId: 1 },
            pool: poolFor(MatchmakingType.Match1v1, { maps: [mapId, newMapId] }),
            changes,
          },
        ]),
      ),
    ).toEqual({ kind: 'review', reviewTypes: [MatchmakingType.Match1v1] })
  })

  test('does not review a pool change the player has already seen or one that only removes maps', () => {
    const changes = {
      addedMaps: [],
      removedMaps: [staleMapId],
      previousMapCount: 2,
      previousMaxVetoCount: 2,
    }
    expect(
      planMatchmakingQueue(
        [MatchmakingType.Match1v1, MatchmakingType.Match2v2],
        state([
          { type: MatchmakingType.Match1v1, prefs: { mapPoolId: 1 }, changes },
          {
            type: MatchmakingType.Match2v2,
            prefs: {},
            changes: { ...changes, addedMaps: [newMapId] },
          },
        ]),
      ).kind,
    ).toBe('queue')
  })

  test('waits when any type is still loading, even if another needs review', () => {
    expect(
      planMatchmakingQueue(
        [MatchmakingType.Match1v1, MatchmakingType.Match2v2],
        state([
          { type: MatchmakingType.Match1v1, prefs: { race: null } },
          { type: MatchmakingType.Match2v2 },
        ]),
      ),
    ).toEqual({ kind: 'loading' })
    expect(
      planMatchmakingQueue(
        [MatchmakingType.Match1v1Fastest],
        state([
          {
            type: MatchmakingType.Match1v1Fastest,
            prefs: { mapSelections: [mapId] },
            pool: null,
          },
        ]),
      ),
    ).toEqual({ kind: 'loading' })
  })
})
