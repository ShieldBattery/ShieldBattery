import { describe, expect, test } from 'vitest'
import { LocalMapKind, LocalMapSize, LocalMapSort } from '../../common/map-library'
import { MapCatalogTab } from '../../common/map-url'
import { Tileset } from '../../common/maps'
import { EudFilter, MapLens, MapSizeClass } from '../gql/graphql'
import {
  CatalogPlayers,
  CatalogSort,
  DEFAULT_CATALOG_FILTERS,
  defaultPickerSortForTab,
  defaultSortForTab,
  effectiveSort,
  hasCatalogParams,
  hasNonDefaultFilters,
  LOCAL_SORTS,
  parseCatalogParams,
  serializeCatalogParams,
  toLocalMapQuery,
  toMapFilter,
  validateSavedFilters,
  validateSavedSort,
  withSearch,
} from './map-catalog-params'

const parse = (search: string) => parseCatalogParams(new URLSearchParams(search))

describe('client/maps/map-catalog-params', () => {
  test('parses every param', () => {
    expect(
      parse(
        'q=bound&sort=name&lens=ums&players=5%2B&size=large,tiny&tileset=ice,jungle&eud=hide' +
          '&official=1&versions=all',
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
      allVersions: true,
    })
  })

  test('falls back to defaults for missing and unknown values', () => {
    const defaults = { search: '', sort: undefined, allVersions: false, ...DEFAULT_CATALOG_FILTERS }
    expect(parse('')).toEqual(defaults)
    expect(
      parse(
        'sort=popular&lens=melee2&players=9&size=enormous&tileset=space&eud=x&official=yes' +
          '&versions=some',
      ),
    ).toEqual(defaults)
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
    expect(serializeCatalogParams(parse('versions=all'))).toBe('versions=all')
  })

  test('keeps unrelated params and drops cleared ones', () => {
    const base = new URLSearchParams('lens=ums&other=1')
    expect(serializeCatalogParams({ ...parse(''), search: 'x' }, base)).toBe('other=1&q=x')
  })

  test('detects catalog params', () => {
    expect(hasCatalogParams(new URLSearchParams(''))).toBe(false)
    expect(hasCatalogParams(new URLSearchParams('other=1'))).toBe(false)
    expect(hasCatalogParams(new URLSearchParams('official=1'))).toBe(true)
    expect(hasCatalogParams(new URLSearchParams('versions=all'))).toBe(true)
    expect(hasNonDefaultFilters(DEFAULT_CATALOG_FILTERS)).toBe(false)
    expect(hasNonDefaultFilters({ ...DEFAULT_CATALOG_FILTERS, official: true })).toBe(true)
  })

  test('picks the sort from the URL, then searching, then saved, then the tab default', () => {
    const all = defaultSortForTab(MapCatalogTab.All)
    const yours = defaultSortForTab(MapCatalogTab.Yours)
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

  test('defaults the picker to the most played maps', () => {
    expect(defaultPickerSortForTab(MapCatalogTab.All)).toBe(CatalogSort.MostPlayed)
    expect(defaultPickerSortForTab(MapCatalogTab.Yours)).toBe(CatalogSort.Newest)
    expect(defaultPickerSortForTab(MapCatalogTab.Favorites)).toBe(CatalogSort.Newest)
  })

  test('switches to and from Best match as a search starts and ends', () => {
    const base = parse('sort=name')
    const searching = withSearch(base, 'bound')
    expect(searching.search).toBe('bound')
    expect(searching.sort).toBeUndefined()
    expect(withSearch({ ...searching, sort: CatalogSort.Newest }, 'bounds').sort).toBe(
      CatalogSort.Newest,
    )
    expect(withSearch({ ...searching, sort: CatalogSort.BestMatch }, '').sort).toBeUndefined()
    expect(withSearch({ ...searching, sort: CatalogSort.Newest }, '').sort).toBe(CatalogSort.Newest)
    expect(withSearch(base, '').sort).toBe(CatalogSort.Name)
  })

  test('only uses sorts the tab offers', () => {
    const local = defaultSortForTab(MapCatalogTab.Local)
    expect(local).toBe(CatalogSort.Name)
    expect(
      effectiveSort({ search: '', sort: CatalogSort.Trending }, undefined, local, LOCAL_SORTS),
    ).toBe(CatalogSort.Name)
    expect(
      effectiveSort({ search: '', sort: undefined }, CatalogSort.MostPlayed, local, LOCAL_SORTS),
    ).toBe(CatalogSort.Name)
    expect(
      effectiveSort({ search: '', sort: undefined }, CatalogSort.Players, local, LOCAL_SORTS),
    ).toBe(CatalogSort.Players)
    // No Best match among the maps on this PC, so searching keeps the chosen sort
    expect(
      effectiveSort({ search: 'x', sort: undefined }, CatalogSort.Newest, local, LOCAL_SORTS),
    ).toBe(CatalogSort.Newest)
  })

  test('builds the local map index query', () => {
    expect(
      toLocalMapQuery(
        parse('q=+Bound+&lens=ums&players=5%2B&size=tiny,huge&tileset=jungle&eud=hide&official=1'),
        CatalogSort.Players,
        { path: 'documents/UMS', recursive: true },
      ),
    ).toEqual({
      search: 'Bound',
      kind: LocalMapKind.Ums,
      players: [5, 6, 7, 8],
      sizes: [LocalMapSize.Tiny, LocalMapSize.Huge],
      tilesets: [Tileset.Jungle],
      eud: false,
      folder: { path: 'documents/UMS', recursive: true },
      sort: LocalMapSort.Players,
    })
    expect(toLocalMapQuery(parse(''), CatalogSort.Newest)).toEqual({
      search: undefined,
      kind: undefined,
      players: undefined,
      sizes: undefined,
      tilesets: undefined,
      eud: undefined,
      folder: undefined,
      sort: LocalMapSort.Newest,
    })
    expect(toLocalMapQuery(parse('eud=only&lens=melee'), CatalogSort.Name)).toMatchObject({
      kind: LocalMapKind.Melee,
      eud: true,
      sort: LocalMapSort.Name,
    })
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
