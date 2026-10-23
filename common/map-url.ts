import slug from 'slug'
import { filterColorCodes, makeSbMapId, SbMapId } from './maps'
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
 * Returns the URL slug for a map's name. The slug is decorative: map pages look maps up by the id
 * segment only, then replace a slug that doesn't match this one. The server's page metadata and the
 * client must agree on it, or a map page would keep redirecting to itself.
 */
export function mapSlug(name: string | undefined): string {
  // Dots become separators so version numbers stay readable ("1.75" -> "1-75", not "175")
  const cleaned = name ? filterColorCodes(name).replace(/\./g, ' ').trim() : ''
  return (cleaned ? slug(cleaned) : '') || '_'
}

/**
 * Returns the URL of a map's page. If the map's name is available, the URL will include a slug
 * (otherwise the page replaces the placeholder once the map has loaded).
 */
export function urlForMap(id: SbMapId, name?: string, subPage?: MapPageSubPage): string {
  const base = urlPath`/maps/${encodePrettyId(id)}/${mapSlug(name)}`
  return subPage ? base + urlPath`/${subPage}` : base
}

/**
 * Returns the map ID from the id segment of a map page URL, which is either a pretty (base64url)
 * ID or a raw UUID. Returns undefined for anything else.
 */
export function mapIdFromRouteSegment(segment: string): SbMapId | undefined {
  if (isPrettyId(segment)) {
    return makeSbMapId(decodePrettyId(segment))
  } else if (UUID_PATTERN.test(segment)) {
    return makeSbMapId(segment.toLowerCase())
  } else {
    return undefined
  }
}
