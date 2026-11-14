import slug from 'slug'
import {
  filterColorCodes,
  makeMapCollectionId,
  makeSbMapId,
  MapCollectionId,
  MapFamilyId,
  SbMapId,
} from './maps'
import { decodePrettyId, encodePrettyId, isPrettyId } from './pretty-id'
import { urlPath } from './urls'

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Sub-pages of a map page, as the path segment after the slug. */
export enum MapPageSubPage {
  Games = 'games',
}

export const ALL_MAP_PAGE_SUB_PAGES: ReadonlyArray<MapPageSubPage> = Object.values(MapPageSubPage)

/**
 * Tabs of the map catalog, as the path segment after `/maps`. None of these can be read as a map
 * id (see {@link mapIdFromRouteSegment}), so they share the `/maps/:segment` namespace with map
 * pages.
 */
export enum MapCatalogTab {
  All = 'all',
  Yours = 'yours',
  Favorites = 'favorites',
  /** The map files in the user's StarCraft map folders (desktop app only). */
  Local = 'local',
}

export const ALL_MAP_CATALOG_TABS: ReadonlyArray<MapCatalogTab> = Object.values(MapCatalogTab)

/** Returns the URL of a map catalog tab, with an optional query string (without the `?`). */
export function urlForMapCatalog(tab: MapCatalogTab, search?: string): string {
  const base = urlPath`/maps/${tab}`
  return search ? `${base}?${search}` : base
}

/**
 * The path segment after `/maps` for the page comparing two maps. Like the catalog tabs, it can't
 * be read as a map id, so it shares the `/maps/:segment` namespace with map pages.
 */
export const MAP_COMPARE_SEGMENT = 'compare'

/**
 * The path segment after `/maps` for map collections: `/maps/collections` lists them, and
 * `/maps/collections/:id/:slug?` is one collection's page. Like the catalog tabs, it can't be read
 * as a map id, so it shares the `/maps/:segment` namespace with map pages.
 */
export const MAP_COLLECTIONS_SEGMENT = 'collections'

/** Returns the URL of the page listing map collections. */
export function urlForMapCollections(): string {
  return urlPath`/maps/${MAP_COLLECTIONS_SEGMENT}`
}

/**
 * Returns the URL of a map collection's page. If the collection's title is available, the URL will
 * include a slug made from it (otherwise the page replaces the placeholder once the collection has
 * loaded). Like a map page's slug, it's decorative: the page looks the collection up by its id.
 */
export function urlForMapCollection(id: MapCollectionId, title?: string): string {
  return urlPath`/maps/${MAP_COLLECTIONS_SEGMENT}/${encodePrettyId(id)}/${mapSlug(title)}`
}

/**
 * Returns a map collection's ID from the id segment of its page's URL, which is either a pretty
 * (base64url) ID or a raw UUID. Returns undefined for anything else.
 */
export function mapCollectionIdFromSegment(segment: string): MapCollectionId | undefined {
  const id = uuidFromIdSegment(segment)
  return id !== undefined ? makeMapCollectionId(id) : undefined
}

/** The ways the compare page can show two maps' images, as its `view` query param. */
export enum MapCompareView {
  /** The two images next to each other. */
  Split = 'split',
  /** One image over the other, with a draggable divider revealing the second. */
  Slider = 'slider',
  /** One image over the other, with the second's opacity controlled by a slider. */
  Fade = 'fade',
  /** The two images shown in turn. */
  Flicker = 'flicker',
  /** The pixels that differ, highlighted over a dimmed copy of the first image. */
  Highlight = 'highlight',
  /** The per-pixel difference of the two images. */
  Subtract = 'subtract',
}

/**
 * The query param of the compare page and of a map's page that names the map family report for
 * staff to review there.
 */
export const MAP_REPORT_PARAM = 'report'

export const ALL_MAP_COMPARE_VIEWS: ReadonlyArray<MapCompareView> = Object.values(MapCompareView)

/**
 * Returns the URL of the page comparing map `a` (the before side) with map `b` (the after side).
 * The default view is left out of the URL. `reportId` makes the page show that map family report
 * to staff, who can resolve it there.
 */
export function urlForMapCompare(
  a: SbMapId,
  b: SbMapId,
  view?: MapCompareView,
  reportId?: string,
): string {
  const base = urlPath`/maps/${MAP_COMPARE_SEGMENT}/${encodePrettyId(a)}/${encodePrettyId(b)}`
  const params: string[] = []
  if (view && view !== MapCompareView.Split) {
    params.push(urlPath`view=${view}`)
  }
  if (reportId) {
    params.push(urlPath`${MAP_REPORT_PARAM}=${reportId}`)
  }
  return params.length ? `${base}?${params.join('&')}` : base
}

/**
 * Returns the URL slug for a map's name. The slug is decorative: map pages look maps up by the id
 * segment only, then replace a slug that doesn't match this one. The server's page metadata and the
 * client must agree on it, or a map page would keep redirecting to itself.
 */
export function mapSlug(name: string | undefined): string {
  // Dots become separators so version numbers stay readable ("1.75" -> "1-75", not "175")
  const cleaned = name ? filterColorCodes(name).replace(/\./g, ' ').trim() : ''
  return (cleaned ? slug(cleaned) : '') || '_'
}

/** The query param of a map page that selects one of the map's files. */
export const MAP_PAGE_FILE_PARAM = 'file'

/**
 * The id in a map page URL: a map family's ID (or an old ID of a family that was merged into
 * another one), or a map file's ID (or an old ID of one). The server resolves them in that order,
 * and a file's ID leads to its family's page with that file selected.
 */
export type MapPageId = MapFamilyId | SbMapId

/**
 * Returns the URL of a map's page. `id` is normally a family's ID; a file's ID also works, and the
 * page then moves to the file's family with the file selected. If the map's name is available,
 * the URL will include a slug (otherwise the page replaces the placeholder once the map has
 * loaded). `file` selects one of the family's files. `reportId` makes the page show that map
 * family report to staff, who can resolve it there.
 */
export function urlForMap(
  id: MapPageId,
  name?: string,
  subPage?: MapPageSubPage,
  file?: SbMapId,
  reportId?: string,
): string {
  let url = urlPath`/maps/${encodePrettyId(id)}/${mapSlug(name)}`
  if (subPage) {
    url += urlPath`/${subPage}`
  }
  const params: string[] = []
  if (file) {
    params.push(urlPath`${MAP_PAGE_FILE_PARAM}=${encodePrettyId(file)}`)
  }
  if (reportId) {
    params.push(urlPath`${MAP_REPORT_PARAM}=${reportId}`)
  }
  return params.length ? `${url}?${params.join('&')}` : url
}

/** Returns the UUID in a pretty (base64url) ID or a raw UUID, lowercased, or undefined. */
function uuidFromIdSegment(segment: string): string | undefined {
  if (isPrettyId(segment)) {
    return decodePrettyId(segment)
  } else if (UUID_PATTERN.test(segment)) {
    return segment.toLowerCase()
  } else {
    return undefined
  }
}

/**
 * Returns the ID from the id segment of a map page URL, which is either a pretty (base64url) ID or
 * a raw UUID. Returns undefined for anything else.
 */
export function mapIdFromRouteSegment(segment: string): MapPageId | undefined {
  const id = uuidFromIdSegment(segment)
  return id !== undefined ? (id as MapPageId) : undefined
}

/**
 * Returns a map file's ID from a URL segment that only holds file IDs (a map page's `file` param,
 * or an id segment of the compare page), which is either a pretty (base64url) ID or a raw UUID.
 * Returns undefined for anything else.
 */
export function mapFileIdFromSegment(segment: string): SbMapId | undefined {
  const id = uuidFromIdSegment(segment)
  return id !== undefined ? makeSbMapId(id) : undefined
}
