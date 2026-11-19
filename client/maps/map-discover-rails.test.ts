import { TFunction } from 'i18next'
import { describe, expect, test } from 'vitest'
import { MapKind, MapLens } from '../gql/graphql'
import { CatalogSort, parseCatalogParams } from './map-catalog-params'
import {
  browseTags,
  catalogSearchForRail,
  collectionsRail,
  freshRail,
  freshSince,
  MIN_RECENT_MAPS,
  RAIL_GAP,
  railColumnSteps,
  recommendationShowAllTag,
  recommendationSubtitle,
  resolveDiscoverLens,
  shownRail,
  trendingRail,
} from './map-discover-rails'

/** Returns each string's default text with its `{{placeholders}}` filled in. */
const t = ((_key: string, defaultValue: string, options?: Record<string, unknown>) =>
  defaultValue.replace(/\{\{(\w+)\}\}/g, (_match, name: string) =>
    String(options?.[name] ?? ''),
  )) as unknown as TFunction

function freshMap(id: number, publisherId?: number) {
  return { id: `map-${id}`, publisher: publisherId === undefined ? null : { id: publisherId } }
}

describe('client/maps/map-discover-rails', () => {
  test('leaves out a rail with fewer than 4 items', () => {
    expect(shownRail([1, 2, 3])).toBeUndefined()
    expect(shownRail([1, 2, 3, 4])).toEqual([1, 2, 3, 4])
    expect(shownRail([])).toBeUndefined()
    expect(shownRail(undefined)).toBeUndefined()
    expect(shownRail(null)).toBeUndefined()
  })

  test('shows Jump back in from 3 maps', () => {
    expect(shownRail([1, 2], MIN_RECENT_MAPS)).toBeUndefined()
    expect(shownRail([1, 2, 3], MIN_RECENT_MAPS)).toEqual([1, 2, 3])
  })

  test('drops maps whose map is not trending, and cuts the rest to 12', () => {
    const maps = [
      { id: 'a', family: { stats: { trendingScore: 900 } } },
      { id: 'b', family: { stats: { trendingScore: 0 } } },
      { id: 'c', family: { stats: null } },
      { id: 'd', family: { stats: { trendingScore: -50 } } },
      { id: 'e', family: { stats: { trendingScore: 1 } } },
      // The file shown isn't trending on its own, but its map is
      { id: 'f', stats: { trendingScore: 0 }, family: { stats: { trendingScore: 300 } } },
      // The file shown is trending, but its map as a whole isn't
      { id: 'g', stats: { trendingScore: 300 }, family: { stats: { trendingScore: 0 } } },
    ]
    expect(trendingRail(maps).map(m => m.id)).toEqual(['a', 'e', 'f'])

    const many = Array.from({ length: 20 }, (_, i) => ({
      id: `m${i}`,
      family: { stats: { trendingScore: 100 - i } },
    }))
    expect(trendingRail(many)).toHaveLength(12)
    expect(trendingRail(many)[11].id).toBe('m11')
  })

  test('shows at most 2 fresh maps per publisher, in order, then the first 12', () => {
    const maps = [
      freshMap(1, 7),
      freshMap(2, 7),
      freshMap(3, 7),
      freshMap(4, 8),
      freshMap(5),
      freshMap(6),
      freshMap(7, 8),
      freshMap(8, 8),
    ]
    expect(freshRail(maps).map(m => m.id)).toEqual([
      'map-1',
      'map-2',
      'map-4',
      'map-5',
      'map-6',
      'map-7',
    ])

    const many = Array.from({ length: 24 }, (_, i) => freshMap(i, i))
    const rail = freshRail(many)
    expect(rail).toHaveLength(12)
    expect(rail[11].id).toBe('map-11')
  })

  test('counts fresh maps from 60 days before the start of the day, in UTC', () => {
    const morning = Date.parse('2026-11-15T03:12:00Z')
    const evening = Date.parse('2026-11-15T22:40:00Z')
    expect(freshSince(morning)).toBe('2026-09-16T00:00:00.000Z')
    expect(freshSince(evening)).toBe(freshSince(morning))
  })

  test('puts staff collections before players’ ones, 8 in all', () => {
    const staff = [{ id: 's1' }, { id: 's2' }, { id: 'p1' }]
    const players = Array.from({ length: 8 }, (_, i) => ({ id: `p${i + 1}` }))
    expect(collectionsRail(staff, players).map(c => c.id)).toEqual([
      's1',
      's2',
      'p1',
      'p2',
      'p3',
      'p4',
      'p5',
      'p6',
    ])
  })

  test('offers the tags of the lens that 3 or more maps have', () => {
    const tags = [
      { id: 'standard', kind: MapKind.Melee, mapCount: 12 },
      { id: 'money', kind: MapKind.Melee, mapCount: 2 },
      { id: 'defense', kind: MapKind.Ums, mapCount: 3 },
      { id: 'bound', kind: MapKind.Ums, mapCount: 0 },
    ]
    expect(browseTags(tags, MapLens.Melee).map(tag => tag.id)).toEqual(['standard'])
    expect(browseTags(tags, MapLens.Ums).map(tag => tag.id)).toEqual(['defense'])
  })

  test('shows the catalog lens on Discover when it picks one kind', () => {
    expect(resolveDiscoverLens(MapLens.Ums, undefined)).toBe(MapLens.Ums)
    expect(resolveDiscoverLens(MapLens.Melee, MapLens.Ums)).toBe(MapLens.Melee)
  })

  test('shows the last kind picked on Discover when the catalog lens is All', () => {
    expect(resolveDiscoverLens(MapLens.All, MapLens.Ums)).toBe(MapLens.Ums)
    expect(resolveDiscoverLens(MapLens.All, MapLens.Melee)).toBe(MapLens.Melee)
  })

  test('shows melee on Discover when nothing picks a kind', () => {
    expect(resolveDiscoverLens(MapLens.All, undefined)).toBe(MapLens.Melee)
  })

  test('names the seed map’s tags in the recommendation subtitle', () => {
    const defense = { name: 'Defense', names: [{ locale: 'es', name: 'Defensa' }] }
    const coOp = { name: 'Co-op', names: [] }
    const arena = { name: 'Arena', names: [] }
    expect(recommendationSubtitle([defense], 'en', t)).toBe("Defense maps you haven't played")
    expect(recommendationSubtitle([defense, coOp], 'en', t)).toBe(
      "Defense and Co-op maps you haven't played",
    )
    expect(recommendationSubtitle([defense, coOp, arena], 'en', t)).toBe(
      "Defense, Co-op and Arena maps you haven't played",
    )
    expect(recommendationSubtitle([defense, coOp], 'es', t)).toBe(
      "Defensa and Co-op maps you haven't played",
    )
    expect(recommendationSubtitle([], 'en', t)).toBe("Maps you haven't played")
  })

  test('opens the catalog from the recommendation only for a seed with one tag', () => {
    expect(recommendationShowAllTag([{ id: 'defense' }])).toEqual({ id: 'defense' })
    expect(recommendationShowAllTag([{ id: 'defense' }, { id: 'co-op' }])).toBeUndefined()
    expect(recommendationShowAllTag([])).toBeUndefined()
  })

  test('opens the catalog a rail is the first page of', () => {
    expect(catalogSearchForRail(MapLens.All, CatalogSort.Trending)).toBe('sort=trending')
    expect(catalogSearchForRail(MapLens.Ums, CatalogSort.Newest)).toBe('sort=newest&lens=ums')
    const params = parseCatalogParams(
      new URLSearchParams(catalogSearchForRail(MapLens.Melee, CatalogSort.Newest)),
    )
    expect(params.lens).toBe(MapLens.Melee)
    expect(params.sort).toBe(CatalogSort.Newest)
    expect(params.tags).toEqual([])
  })

  test('shows another card in a rail once one more fits at its narrowest', () => {
    const steps = railColumnSteps(232, RAIL_GAP, 12)
    expect(steps).toHaveLength(12)
    expect(steps.slice(0, 4)).toEqual([
      { fromWidth: 0, columns: 1 },
      { fromWidth: 480, columns: 2 },
      { fromWidth: 728, columns: 3 },
      { fromWidth: 976, columns: 4 },
    ])
    expect(steps[11]).toEqual({ fromWidth: 2960, columns: 12 })
    // At each step every column is at least as wide as a card's narrowest
    for (const { fromWidth, columns } of steps.slice(1)) {
      expect((fromWidth - (columns - 1) * RAIL_GAP) / columns).toBe(232)
    }
  })
})
