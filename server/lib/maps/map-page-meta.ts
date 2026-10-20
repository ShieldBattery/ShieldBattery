import { mapIdFromRouteSegment, urlForMap } from '../../../common/map-url'
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
