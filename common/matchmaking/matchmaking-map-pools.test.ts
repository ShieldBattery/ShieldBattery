import { describe, expect, test } from 'vitest'
import { makeSbMapId } from '../maps'
import { MatchmakingType } from '../matchmaking'
import {
  computeMapPoolChanges,
  filterMapSelections,
  getMapPoolChangeNotice,
  isMapPoolChangeInterrupting,
  MapPoolChangeNotice,
  MatchmakingMapPoolChanges,
} from './matchmaking-map-pools'

const m = makeSbMapId

function pool(
  matchmakingType: MatchmakingType,
  maps: string[],
  maxVetoCount = 3,
  id = 2,
): {
  id: number
  matchmakingType: MatchmakingType
  maps: ReturnType<typeof m>[]
  maxVetoCount: number
} {
  return { id, matchmakingType, maps: maps.map(m), maxVetoCount }
}

describe('common/matchmaking/matchmaking-map-pools/filterMapSelections', () => {
  test('drops selections that are not in the pool', () => {
    const p = pool(MatchmakingType.Match1v1Fastest, ['a', 'b', 'c'])
    expect(filterMapSelections(p, [m('a'), m('x'), m('c')])).toEqual([m('a'), m('c')])
  })

  test('caps vetoes at the veto limit', () => {
    const p = pool(MatchmakingType.Match1v1, ['a', 'b', 'c', 'd'], 2)
    expect(filterMapSelections(p, [m('a'), m('x'), m('b'), m('c')])).toEqual([m('a'), m('b')])
  })

  test('does not cap picks', () => {
    const p = pool(MatchmakingType.Match1v1Fastest, ['a', 'b', 'c', 'd'], 1)
    expect(filterMapSelections(p, [m('a'), m('b'), m('c')])).toEqual([m('a'), m('b'), m('c')])
  })

  test('returns an empty list without selections', () => {
    expect(filterMapSelections(pool(MatchmakingType.Match1v1, ['a']))).toEqual([])
  })
})

describe('common/matchmaking/matchmaking-map-pools/computeMapPoolChanges', () => {
  test('reports added maps in the current pool order', () => {
    const result = computeMapPoolChanges(
      { maps: [m('a')], maxVetoCount: 3 },
      { maps: [m('z'), m('a'), m('b')], maxVetoCount: 3 },
    )
    expect(result.addedMaps).toEqual([m('z'), m('b')])
    expect(result.removedMaps).toEqual([])
  })

  test('reports removed maps in the previous pool order', () => {
    const result = computeMapPoolChanges(
      { maps: [m('c'), m('a'), m('b')], maxVetoCount: 3 },
      { maps: [m('a')], maxVetoCount: 3 },
    )
    expect(result.addedMaps).toEqual([])
    expect(result.removedMaps).toEqual([m('c'), m('b')])
  })

  test('reports nothing for identical pools, regardless of order', () => {
    const result = computeMapPoolChanges(
      { maps: [m('a'), m('b')], maxVetoCount: 3 },
      { maps: [m('b'), m('a')], maxVetoCount: 3 },
    )
    expect(result).toEqual({
      addedMaps: [],
      removedMaps: [],
      previousMapCount: 2,
      previousMaxVetoCount: 3,
    })
  })

  test('carries the previous veto count and size', () => {
    const result = computeMapPoolChanges(
      { maps: [m('a'), m('b'), m('c')], maxVetoCount: 1 },
      { maps: [m('a')], maxVetoCount: 4 },
    )
    expect(result.previousMapCount).toBe(3)
    expect(result.previousMaxVetoCount).toBe(1)
  })
})

describe('common/matchmaking/matchmaking-map-pools/getMapPoolChangeNotice', () => {
  const changes = (
    partial: Partial<MatchmakingMapPoolChanges> = {},
  ): MatchmakingMapPoolChanges => ({
    addedMaps: [],
    removedMaps: [],
    previousMapCount: 3,
    previousMaxVetoCount: 3,
    ...partial,
  })

  test('returns undefined when the pool was already seen', () => {
    const p = pool(MatchmakingType.Match1v1, ['a', 'b', 'c'], 3, 2)
    expect(
      getMapPoolChangeNotice(
        { mapPoolId: 2, mapSelections: [m('a')] },
        p,
        changes({ addedMaps: [m('c')] }),
      ),
    ).toBeUndefined()
  })

  test('returns undefined for a re-issued identical pool', () => {
    const p = pool(MatchmakingType.Match1v1, ['a', 'b', 'c'], 3, 2)
    expect(
      getMapPoolChangeNotice({ mapPoolId: 1, mapSelections: [m('a')] }, p, changes()),
    ).toBeUndefined()
  })

  test('without changes, reports nothing when no selections are dropped', () => {
    const p = pool(MatchmakingType.Match1v1, ['a', 'b', 'c'])
    expect(
      getMapPoolChangeNotice({ mapPoolId: 1, mapSelections: [m('a')] }, p, undefined),
    ).toBeUndefined()
  })

  test('without changes, still reports dropped selections', () => {
    const p = pool(MatchmakingType.Match1v1, ['a', 'b', 'c'])
    expect(
      getMapPoolChangeNotice({ mapPoolId: 1, mapSelections: [m('a'), m('x')] }, p, undefined),
    ).toEqual({
      addedMaps: [],
      removedMaps: [],
      droppedSelections: [{ mapId: m('x'), reason: 'mapRemoved' }],
    })
  })

  test('reports selections dropped because their map was removed', () => {
    const p = pool(MatchmakingType.Match1v1, ['a', 'b'])
    const notice = getMapPoolChangeNotice(
      { mapPoolId: 1, mapSelections: [m('c'), m('a')] },
      p,
      changes({ removedMaps: [m('c')] }),
    )
    expect(notice).toEqual({
      addedMaps: [],
      removedMaps: [m('c')],
      mapCount: { previous: 3, current: 2 },
      droppedSelections: [{ mapId: m('c'), reason: 'mapRemoved' }],
    })
  })

  test('reports selections cut by a smaller veto limit, keeping the first ones', () => {
    const p = pool(MatchmakingType.Match1v1, ['a', 'b', 'c'], 1)
    const notice = getMapPoolChangeNotice(
      { mapPoolId: 1, mapSelections: [m('a'), m('b'), m('c')] },
      p,
      changes({ previousMaxVetoCount: 3 }),
    )
    expect(notice).toEqual({
      addedMaps: [],
      removedMaps: [],
      maxVetoCount: { previous: 3, current: 1 },
      droppedSelections: [
        { mapId: m('b'), reason: 'vetoLimit' },
        { mapId: m('c'), reason: 'vetoLimit' },
      ],
    })
  })

  test('does not report the veto limit for pick modes, and does not cap their picks', () => {
    const p = pool(MatchmakingType.Match1v1Fastest, ['a', 'b', 'c'], 1)
    const notice = getMapPoolChangeNotice(
      { mapPoolId: 1, mapSelections: [m('a'), m('b'), m('x')] },
      p,
      changes({ previousMaxVetoCount: 3, addedMaps: [m('c')] }),
    )
    expect(notice).toEqual({
      addedMaps: [m('c')],
      removedMaps: [],
      droppedSelections: [{ mapId: m('x'), reason: 'mapRemoved' }],
    })
  })

  test('ignores selections for fixed modes', () => {
    const p = pool(MatchmakingType.Match2v2Bgh, ['a', 'b'], 1)
    const notice = getMapPoolChangeNotice(
      { mapPoolId: 1, mapSelections: [m('x'), m('y')] },
      p,
      changes({ previousMaxVetoCount: 3, addedMaps: [m('b')], previousMapCount: 1 }),
    )
    expect(notice).toEqual({
      addedMaps: [m('b')],
      removedMaps: [],
      mapCount: { previous: 1, current: 2 },
      droppedSelections: [],
    })
  })

  test('reports a pool size change on its own', () => {
    const p = pool(MatchmakingType.Match1v1, ['a', 'b'])
    const notice = getMapPoolChangeNotice({ mapPoolId: 1 }, p, changes({ removedMaps: [m('c')] }))
    expect(notice?.mapCount).toEqual({ previous: 3, current: 2 })
  })
})

describe('common/matchmaking/matchmaking-map-pools/isMapPoolChangeInterrupting', () => {
  const base: MapPoolChangeNotice = { addedMaps: [], removedMaps: [], droppedSelections: [] }

  test('is true when maps were added', () => {
    expect(isMapPoolChangeInterrupting({ ...base, addedMaps: [m('a')] })).toBe(true)
  })

  test('is true when selections were dropped', () => {
    expect(
      isMapPoolChangeInterrupting({
        ...base,
        droppedSelections: [{ mapId: m('a'), reason: 'mapRemoved' }],
      }),
    ).toBe(true)
  })

  test('is true when the veto limit changed', () => {
    expect(
      isMapPoolChangeInterrupting({ ...base, maxVetoCount: { previous: 3, current: 2 } }),
    ).toBe(true)
  })

  test('is false for removals that touch no selections', () => {
    expect(isMapPoolChangeInterrupting({ ...base, removedMaps: [m('a')] })).toBe(false)
  })

  test('is false for a size change alone', () => {
    expect(isMapPoolChangeInterrupting({ ...base, mapCount: { previous: 3, current: 2 } })).toBe(
      false,
    )
  })
})
