import { describe, expect, test } from 'vitest'
import {
  ALL_MAP_CATALOG_TABS,
  MapCatalogTab,
  mapIdFromRouteSegment,
  MapPageSubPage,
  mapSlug,
  urlForMap,
  urlForMapCatalog,
} from './map-url'
import { makeSbMapId } from './maps'
import { encodePrettyId } from './pretty-id'

const MAP_ID = makeSbMapId('5eed0000-0000-0000-0000-00000000aaaa')

describe('common/map-url', () => {
  test('slugs names, keeping version numbers readable', () => {
    expect(mapSlug('Polypoid 1.75')).toBe('polypoid-1-75')
    expect(mapSlug('Fighting Spirit (Ghost) 1.3')).toBe('fighting-spirit-ghost-1-3')
  })

  test('strips BW color codes before slugging', () => {
    expect(mapSlug('\x03Lost \x04Temple')).toBe('lost-temple')
  })

  test('uses a placeholder for missing or blank names', () => {
    expect(mapSlug(undefined)).toBe('_')
    expect(mapSlug('')).toBe('_')
    expect(mapSlug('   ')).toBe('_')
    expect(mapSlug('\x03')).toBe('_')
  })

  test('slugs non-Latin names to something stable', () => {
    expect(mapSlug('라데온')).toBe(mapSlug('라데온'))
    expect(mapSlug('라데온')).not.toBe('_')
  })

  test('builds map page URLs from a pretty id and slug', () => {
    expect(urlForMap(MAP_ID, 'Polypoid 1.75')).toBe(`/maps/${encodePrettyId(MAP_ID)}/polypoid-1-75`)
    expect(urlForMap(MAP_ID)).toBe(`/maps/${encodePrettyId(MAP_ID)}/_`)
    expect(urlForMap(MAP_ID, 'Polypoid', MapPageSubPage.Games)).toBe(
      `/maps/${encodePrettyId(MAP_ID)}/polypoid/games`,
    )
  })

  test('reads map ids from pretty ids and raw UUIDs', () => {
    expect(mapIdFromRouteSegment(encodePrettyId(MAP_ID))).toBe(MAP_ID)
    expect(mapIdFromRouteSegment(MAP_ID)).toBe(MAP_ID)
    expect(mapIdFromRouteSegment(MAP_ID.toUpperCase())).toBe(MAP_ID)
  })

  test('rejects other id segments', () => {
    expect(mapIdFromRouteSegment('polypoid')).toBeUndefined()
    expect(mapIdFromRouteSegment('')).toBeUndefined()
    expect(mapIdFromRouteSegment('5eed0000-0000-0000-0000')).toBeUndefined()
  })

  test('never reads a catalog tab as a map id', () => {
    for (const tab of ALL_MAP_CATALOG_TABS) {
      expect(mapIdFromRouteSegment(tab)).toBeUndefined()
    }
  })

  test('builds catalog URLs', () => {
    expect(urlForMapCatalog(MapCatalogTab.All)).toBe('/maps/all')
    expect(urlForMapCatalog(MapCatalogTab.Yours, 'lens=ums&q=bound')).toBe(
      '/maps/yours?lens=ums&q=bound',
    )
  })
})
