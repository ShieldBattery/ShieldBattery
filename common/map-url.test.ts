import { describe, expect, test } from 'vitest'
import {
  ALL_MAP_CATALOG_TABS,
  MAP_COLLECTIONS_SEGMENT,
  MAP_COMPARE_SEGMENT,
  MAP_FAVORITES_SEGMENT,
  MapCatalogTab,
  mapCollectionIdFromSegment,
  MapCompareView,
  mapFileIdFromSegment,
  mapIdFromRouteSegment,
  MapPageSubPage,
  mapSlug,
  urlForMap,
  urlForMapCatalog,
  urlForMapCollection,
  urlForMapCollections,
  urlForMapCompare,
} from './map-url'
import { makeMapCollectionId, makeMapFamilyId, makeSbMapId } from './maps'
import { encodePrettyId } from './pretty-id'

const MAP_ID = makeSbMapId('5eed0000-0000-0000-0000-00000000aaaa')
const OTHER_MAP_ID = makeSbMapId('5eed0000-0000-0000-0000-00000000bbbb')
const REPORT_ID = '5eed0000-0000-0000-0000-00000000cccc'
const FAMILY_ID = makeMapFamilyId('5eed0000-0000-0000-0000-00000000ffff')
const COLLECTION_ID = makeMapCollectionId('5eed0000-0000-0000-0000-00000000eeee')

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

  test("builds family page URLs that select one of the family's files", () => {
    const base = `/maps/${encodePrettyId(FAMILY_ID)}/polypoid`
    expect(urlForMap(FAMILY_ID, 'Polypoid')).toBe(base)
    expect(urlForMap(FAMILY_ID, 'Polypoid', undefined, MAP_ID)).toBe(
      `${base}?file=${encodePrettyId(MAP_ID)}`,
    )
    expect(urlForMap(FAMILY_ID, 'Polypoid', MapPageSubPage.Games, MAP_ID)).toBe(
      `${base}/games?file=${encodePrettyId(MAP_ID)}`,
    )
  })

  test('reads map ids from pretty ids and raw UUIDs', () => {
    expect(mapIdFromRouteSegment(encodePrettyId(MAP_ID))).toBe(MAP_ID)
    expect(mapIdFromRouteSegment(MAP_ID)).toBe(MAP_ID)
    expect(mapIdFromRouteSegment(MAP_ID.toUpperCase())).toBe(MAP_ID)
    expect(mapIdFromRouteSegment(encodePrettyId(FAMILY_ID))).toBe(FAMILY_ID)
  })

  test('reads file ids from pretty ids and raw UUIDs', () => {
    expect(mapFileIdFromSegment(encodePrettyId(MAP_ID))).toBe(MAP_ID)
    expect(mapFileIdFromSegment(MAP_ID.toUpperCase())).toBe(MAP_ID)
    expect(mapFileIdFromSegment('polypoid')).toBeUndefined()
  })

  test('rejects other id segments', () => {
    expect(mapIdFromRouteSegment('polypoid')).toBeUndefined()
    expect(mapIdFromRouteSegment('')).toBeUndefined()
    expect(mapIdFromRouteSegment('5eed0000-0000-0000-0000')).toBeUndefined()
  })

  test('never reads a catalog tab or the compare or collections segment as a map id', () => {
    for (const tab of ALL_MAP_CATALOG_TABS) {
      expect(mapIdFromRouteSegment(tab)).toBeUndefined()
    }
    expect(mapIdFromRouteSegment(MAP_COMPARE_SEGMENT)).toBeUndefined()
    expect(mapIdFromRouteSegment(MAP_COLLECTIONS_SEGMENT)).toBeUndefined()
    expect(mapIdFromRouteSegment(MAP_FAVORITES_SEGMENT)).toBeUndefined()
  })

  test('lists collections on the Collections tab', () => {
    expect(ALL_MAP_CATALOG_TABS).toContain(MapCatalogTab.Collections)
    expect(urlForMapCollections()).toBe(urlForMapCatalog(MapCatalogTab.Collections))
    expect(urlForMapCollections('q=ums')).toBe('/maps/collections?q=ums')
  })

  test('builds collection URLs from a pretty id and slug', () => {
    expect(urlForMapCollections()).toBe('/maps/collections')
    expect(urlForMapCollection(COLLECTION_ID, 'UMS night: 4.0 starters')).toBe(
      `/maps/collections/${encodePrettyId(COLLECTION_ID)}/ums-night-4-0-starters`,
    )
    expect(urlForMapCollection(COLLECTION_ID)).toBe(
      `/maps/collections/${encodePrettyId(COLLECTION_ID)}`,
    )
    expect(urlForMapCollection(COLLECTION_ID, '')).toBe(
      `/maps/collections/${encodePrettyId(COLLECTION_ID)}`,
    )
    expect(urlForMapCollection(COLLECTION_ID, undefined, REPORT_ID)).toBe(
      `/maps/collections/${encodePrettyId(COLLECTION_ID)}?report=${REPORT_ID}`,
    )
    expect(urlForMapCollection(COLLECTION_ID, 'Pool', REPORT_ID)).toBe(
      `/maps/collections/${encodePrettyId(COLLECTION_ID)}/pool?report=${REPORT_ID}`,
    )
  })

  test('reads collection ids from pretty ids and raw UUIDs', () => {
    expect(mapCollectionIdFromSegment(encodePrettyId(COLLECTION_ID))).toBe(COLLECTION_ID)
    expect(mapCollectionIdFromSegment(COLLECTION_ID.toUpperCase())).toBe(COLLECTION_ID)
    expect(mapCollectionIdFromSegment('ums-night')).toBeUndefined()
    expect(mapCollectionIdFromSegment('')).toBeUndefined()
  })

  test('builds compare URLs, leaving the default view out', () => {
    const base = `/maps/compare/${encodePrettyId(MAP_ID)}/${encodePrettyId(OTHER_MAP_ID)}`
    expect(urlForMapCompare(MAP_ID, OTHER_MAP_ID)).toBe(base)
    expect(urlForMapCompare(MAP_ID, OTHER_MAP_ID, MapCompareView.Split)).toBe(base)
    expect(urlForMapCompare(MAP_ID, OTHER_MAP_ID, MapCompareView.Slider)).toBe(
      `${base}?view=slider`,
    )
    expect(urlForMapCompare(MAP_ID, OTHER_MAP_ID, undefined, REPORT_ID)).toBe(
      `${base}?report=${REPORT_ID}`,
    )
    expect(urlForMapCompare(MAP_ID, OTHER_MAP_ID, MapCompareView.Fade, REPORT_ID)).toBe(
      `${base}?view=fade&report=${REPORT_ID}`,
    )
  })

  test('builds catalog URLs', () => {
    expect(urlForMapCatalog(MapCatalogTab.All)).toBe('/maps/all')
    expect(urlForMapCatalog(MapCatalogTab.Yours, 'lens=ums&q=bound')).toBe(
      '/maps/yours?lens=ums&q=bound',
    )
  })
})
