import { mapIdFromRouteSegment, urlForMap, urlForMapCompare } from '../../../common/map-url'
import { filterColorCodes, MapVisibility, tilesetToName } from '../../../common/maps'
import { defaultPageImage, englishT, PageMetadataResolver } from '../page-metadata/types'
import { getMapInfos, resolveMapId } from './map-models'

const MAX_DESCRIPTION_LENGTH = 200

function cleanText(text: string): string {
  return filterColorCodes(text).replace(/\s+/g, ' ').trim()
}

function truncate(text: string, maxLength: number): string {
  return text.length > maxLength ? text.slice(0, maxLength - 1).trimEnd() + '…' : text
}

/**
 * Resolves the Open Graph/Twitter Card metadata for a map page (registered for the `/maps/:id/*?`
 * route in `page-metadata.ts`).
 *
 * `params.id` is the map's pretty id or raw UUID, and may be an alias of the map's current ID; the
 * canonical URL always uses the current ID. Maps that aren't listed are readable by anyone with
 * the link, but are kept out of search engines. A malformed ID or a missing map returns
 * `undefined`, falling back to the default site-wide metadata.
 */
export const mapPageMetadata: PageMetadataResolver = async (params, context) => {
  const requestedId = params.id ? mapIdFromRouteSegment(params.id) : undefined
  if (!requestedId) {
    return undefined
  }

  const mapId = await resolveMapId(requestedId)
  const [map] = await getMapInfos([mapId])
  if (!map) {
    return undefined
  }

  const name = cleanText(map.name)
  const description = cleanText(map.description)
  const kind = map.mapData.umsContent ? 'Use Map Settings' : 'melee'
  const fallbackDescription =
    `A ${map.mapData.slots}-player ${tilesetToName(map.mapData.tileset, englishT)} ` +
    `${kind} map. Play it on ShieldBattery.`

  return {
    url: context.canonicalHost + urlForMap(map.id, map.name),
    type: 'website',
    title: name || 'Untitled map',
    description: description ? truncate(description, MAX_DESCRIPTION_LENGTH) : fallbackDescription,
    // Crawlers don't all decode AVIF
    image: map.jpegImageUrl ?? defaultPageImage(context),
    noindex: map.visibility === MapVisibility.Unlisted,
  }
}

/**
 * Resolves the metadata for the page comparing two maps (registered for the `/maps/compare/:a/:b`
 * route in `page-metadata.ts`). Comparisons are for sharing, not for search engines, so they're
 * never indexed. A malformed ID or a missing map returns `undefined`.
 */
export const mapComparePageMetadata: PageMetadataResolver = async (params, context) => {
  const requestedA = params.a ? mapIdFromRouteSegment(params.a) : undefined
  const requestedB = params.b ? mapIdFromRouteSegment(params.b) : undefined
  if (!requestedA || !requestedB) {
    return undefined
  }

  const [a, b] = await Promise.all([resolveMapId(requestedA), resolveMapId(requestedB)])
  const maps = await getMapInfos([a, b])
  const mapA = maps.find(m => m.id === a)
  const mapB = maps.find(m => m.id === b)
  if (!mapA || !mapB) {
    return undefined
  }

  const nameA = cleanText(mapA.name) || 'Untitled map'
  const nameB = cleanText(mapB.name) || 'Untitled map'
  return {
    url: context.canonicalHost + urlForMapCompare(mapA.id, mapB.id),
    type: 'website',
    title: `${nameA} vs. ${nameB}`,
    description: `Compare the terrain, bases and start locations of ${nameA} and ${nameB}.`,
    image: mapB.jpegImageUrl ?? mapA.jpegImageUrl ?? defaultPageImage(context),
    noindex: true,
  }
}
