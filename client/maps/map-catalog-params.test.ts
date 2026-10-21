import { describe, expect, test } from 'vitest'
import { MapCatalogTab } from '../../common/map-url'
import { Tileset } from '../../common/maps'
import { EudFilter, MapLens, MapSizeClass } from '../gql/graphql'
import {
  CatalogPlayers,
  CatalogSort,
  DEFAULT_CATALOG_FILTERS,
  effectiveSort,
  hasCatalogParams,
  hasNonDefaultFilters,
  parseCatalogParams,
  serializeCatalogParams,
  toMapFilter,
  validateSavedFilters,
  validateSavedSort,
} from './map-catalog-params'

const parse = (search: string) => parseCatalogParams(new URLSearchParams(search))

describe('client/maps/map-catalog-params', () => {
  test('parses every param', () => {
    expect(
      parse(
        'q=bound&sort=name&lens=ums&players=5%2B&size=large,tiny&tileset=ice,jungle&eud=hide&official=1',
      ),
    ).toEqual({
      search: 'bound',
      sort: CatalogSort.Name,
      lens: MapLens.Ums,
      players: CatalogPlayers.FivePlus,
      sizes: [MapSizeClass.Tiny, MapSizeClass.Large],
      tilesets: [Tileset.Jungle, Tileset.Ice],
      eud: EudFilter.Exclude,
      official: true,
    })
  })

  test('falls back to defaults for missing and unknown values', () => {
    expect(parse('')).toEqual({ search: '', sort: undefined, ...DEFAULT_CATALOG_FILTERS })
    expect(
      parse('sort=popular&lens=melee2&players=9&size=enormous&tileset=space&eud=x&official=yes'),
    ).toEqual({ search: '', sort: undefined, ...DEFAULT_CATALOG_FILTERS })
  })

  test('round-trips, leaving defaults out and keeping canonical order', () => {
    const search = serializeCatalogParams(
      parse('tileset=twilight,badlands&size=huge,small&lens=melee&players=2&eud=only'),
    )
    expect(search).toBe('lens=melee&players=2&size=small,huge&tileset=badlands,twilight&eud=only')
    expect(parse(search)).toEqual(
      parse('lens=melee&players=2&size=small,huge&tileset=badlands,twilight&eud=only'),
    )
    expect(serializeCatalogParams(parse(''))).toBe('')
  })

  test('keeps unrelated params and drops cleared ones', () => {
    const base = new URLSearchParams('lens=ums&other=1')
    expect(serializeCatalogParams({ ...parse(''), search: 'x' }, base)).toBe('other=1&q=x')
  })

  test('detects catalog params', () => {
    expect(hasCatalogParams(new URLSearchParams(''))).toBe(false)
    expect(hasCatalogParams(new URLSearchParams('other=1'))).toBe(false)
    expect(hasCatalogParams(new URLSearchParams('official=1'))).toBe(true)
    expect(hasNonDefaultFilters(DEFAULT_CATALOG_FILTERS)).toBe(false)
    expect(hasNonDefaultFilters({ ...DEFAULT_CATALOG_FILTERS, official: true })).toBe(true)
  })

  test('picks the sort from the URL, then searching, then saved, then the tab default', () => {
    const all = MapCatalogTab.All
    const yours = MapCatalogTab.Yours
    expect(effectiveSort({ search: '', sort: undefined }, undefined, all)).toBe(
      CatalogSort.Trending,
    )
    expect(effectiveSort({ search: '', sort: undefined }, undefined, yours)).toBe(
      CatalogSort.Newest,
    )
    expect(effectiveSort({ search: '', sort: undefined }, CatalogSort.Name, all)).toBe(
      CatalogSort.Name,
    )
    expect(effectiveSort({ search: 'x', sort: undefined }, CatalogSort.Name, all)).toBe(
      CatalogSort.BestMatch,
    )
    expect(effectiveSort({ search: 'x', sort: CatalogSort.Newest }, undefined, all)).toBe(
      CatalogSort.Newest,
    )
    expect(effectiveSort({ search: '  ', sort: CatalogSort.BestMatch }, undefined, all)).toBe(
      CatalogSort.Trending,
    )
  })

  test('builds the GraphQL filter', () => {
    expect(toMapFilter(parse(''))).toEqual({
      search: undefined,
      lens: MapLens.All,
      players: undefined,
      sizes: undefined,
      tilesets: undefined,
      eud: EudFilter.Any,
      official: undefined,
    })
    expect(toMapFilter(parse('q=%20bound%20&players=5%2B&official=1&tileset=ice'))).toEqual({
      search: 'bound',
      lens: MapLens.All,
      players: [5, 6, 7, 8],
      sizes: undefined,
      tilesets: [Tileset.Ice],
      eud: EudFilter.Any,
      official: true,
    })
  })

  test('validates saved defaults', () => {
    expect(validateSavedFilters(undefined)).toBeUndefined()
    expect(validateSavedFilters('nope')).toBeUndefined()
    expect(
      validateSavedFilters({
        lens: 'UMS',
        players: '5+',
        sizes: ['HUGE', 'BOGUS'],
        tilesets: [7, 99],
        eud: 'ONLY',
        official: 'true',
      }),
    ).toEqual({
      lens: MapLens.Ums,
      players: CatalogPlayers.FivePlus,
      sizes: [MapSizeClass.Huge],
      tilesets: [Tileset.Twilight],
      eud: EudFilter.Only,
      official: false,
    })
    expect(validateSavedSort('name')).toBe(CatalogSort.Name)
    expect(validateSavedSort('match')).toBeUndefined()
  })
})
