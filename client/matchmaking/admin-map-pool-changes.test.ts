import { describe, expect, test } from 'vitest'
import { makeSbMapId, SbMapId } from '../../common/maps'
import { poolChangeSummary } from './admin-map-pool-changes'

const a1 = makeSbMapId('a1')
const a2 = makeSbMapId('a2')
const b1 = makeSbMapId('b1')
const c1 = makeSbMapId('c1')
const d1 = makeSbMapId('d1')
const e1 = makeSbMapId('e1')

const FAMILIES = new Map<SbMapId, string>([
  [a1, 'a'],
  [a2, 'a'],
  [b1, 'b'],
  [c1, 'c'],
  [d1, 'd'],
  [e1, 'e'],
])
const familyOf = (id: SbMapId) => FAMILIES.get(id)

describe('client/matchmaking/admin-map-pool-changes/poolChangeSummary', () => {
  test('reports no changes for the same files and vetoes', () => {
    expect(
      poolChangeSummary(
        { maps: [a1, b1], maxVetoCount: 2 },
        { maps: [a1, b1], maxVetoCount: 2 },
        familyOf,
      ),
    ).toBe('No changes')
  })

  test('ignores order', () => {
    expect(
      poolChangeSummary(
        { maps: [a1, b1], maxVetoCount: 2 },
        { maps: [b1, a1], maxVetoCount: 2 },
        familyOf,
      ),
    ).toBe('No changes')
  })

  test('counts added and removed maps', () => {
    expect(
      poolChangeSummary(
        { maps: [a1, b1, c1], maxVetoCount: 1 },
        { maps: [a1, c1, d1, e1], maxVetoCount: 1 },
        familyOf,
      ),
    ).toBe('+2 maps · −1 map')
  })

  test('counts a swapped file of the same map as a changed file', () => {
    expect(
      poolChangeSummary(
        { maps: [a1, b1], maxVetoCount: 3 },
        { maps: [a2, b1], maxVetoCount: 3 },
        familyOf,
      ),
    ).toBe('1 file changed')
  })

  test('puts every kind of change on one line', () => {
    expect(
      poolChangeSummary(
        { maps: [a1, b1, c1], maxVetoCount: 3 },
        { maps: [a2, c1, d1, e1], maxVetoCount: 2 },
        familyOf,
      ),
    ).toBe('+2 maps · −1 map · 1 file changed · vetoes 3 → 2')
  })

  test('counts files of unknown maps as removed and added', () => {
    expect(
      poolChangeSummary(
        { maps: [a1], maxVetoCount: 0 },
        { maps: [a2], maxVetoCount: 0 },
        () => undefined,
      ),
    ).toBe('+1 map · −1 map')
  })

  test('reports only a veto change', () => {
    expect(
      poolChangeSummary({ maps: [a1], maxVetoCount: 0 }, { maps: [a1], maxVetoCount: 1 }, familyOf),
    ).toBe('vetoes 0 → 1')
  })

  test('pluralizes changed files', () => {
    const families = new Map<SbMapId, string>([
      [a1, 'a'],
      [a2, 'a'],
      [b1, 'b'],
      [c1, 'b'],
    ])
    expect(
      poolChangeSummary(
        { maps: [a1, b1], maxVetoCount: 0 },
        { maps: [a2, c1], maxVetoCount: 0 },
        id => families.get(id),
      ),
    ).toBe('2 files changed')
  })
})
