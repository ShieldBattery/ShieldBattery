import {
  mapCollectionIdFromSegment,
  mapFileIdFromSegment,
  mapIdFromRouteSegment,
  urlForMap,
  urlForMapCollection,
  urlForMapCompare,
} from '../../../common/map-url'
import { filterColorCodes, MapVisibility, tilesetToName } from '../../../common/maps'
import {
  defaultPageImage,
  defaultPageMetadata,
  englishT,
  PageMetadataResolver,
} from '../page-metadata/types'
import { getMapCollectionPageInfo, MapCollectionPageInfo } from './map-collection-models'
import { getMapInfos, resolveMapId, resolveMapPageId } from './map-models'

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
 * `params.id` is a pretty id or raw UUID, resolved in order as a map family's ID, an old ID of a
 * family, a map file's ID and an old ID of a file. A family's page describes its current file; a
 * file's ID describes that file. The canonical URL is always the family's page under its current
 * ID, selecting the file only when it's an unlisted file (which the family page wouldn't show).
 * Maps that aren't listed are readable by anyone with the link, but are kept out of search engines.
 * A malformed ID or a missing map returns `undefined`, falling back to the default site-wide
 * metadata.
 */
export const mapPageMetadata: PageMetadataResolver = async (params, context) => {
  const requestedId = params.id ? mapIdFromRouteSegment(params.id) : undefined
  if (!requestedId) {
    return undefined
  }

  const resolved = await resolveMapPageId(requestedId)
  if (!resolved) {
    return undefined
  }
  const mapId = resolved.fileId ?? resolved.currentMapId
  const maps = await getMapInfos([resolved.currentMapId, mapId])
  const current = maps.find(m => m.id === resolved.currentMapId)
  const map = maps.find(m => m.id === mapId)
  if (!current || !map) {
    return undefined
  }
  const unlisted = map.visibility === MapVisibility.Unlisted

  const name = cleanText(map.name)
  const description = cleanText(map.description)
  const kind = map.mapData.umsContent ? 'Use Map Settings' : 'melee'
  const fallbackDescription =
    `A ${map.mapData.slots}-player ${tilesetToName(map.mapData.tileset, englishT)} ` +
    `${kind} map. Play it on ShieldBattery.`

  return {
    url:
      context.canonicalHost +
      urlForMap(
        resolved.familyId,
        current.name,
        undefined,
        unlisted && map.id !== current.id ? map.id : undefined,
      ),
    type: 'website',
    title: name || 'Untitled map',
    description: description ? truncate(description, MAX_DESCRIPTION_LENGTH) : fallbackDescription,
    // Crawlers don't all decode AVIF
    image: map.jpegImageUrl ?? defaultPageImage(context),
    noindex: !resolved.listed || unlisted,
  }
}

/**
 * Resolves the metadata for the page comparing two maps (registered for the `/maps/compare/:a/:b`
 * route in `page-metadata.ts`). Comparisons are for sharing, not for search engines, so they're
 * never indexed. A malformed ID or a missing map returns `undefined`.
 */
export const mapComparePageMetadata: PageMetadataResolver = async (params, context) => {
  const requestedA = params.a ? mapFileIdFromSegment(params.a) : undefined
  const requestedB = params.b ? mapFileIdFromSegment(params.b) : undefined
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

/** Whether everyone can see a collection: a staff collection, or a public player's one. */
function isPublicCollection(collection: MapCollectionPageInfo): boolean {
  return (
    collection.kind === 'staff' ||
    (collection.kind === 'user' && collection.published && !collection.hidden)
  )
}

/**
 * Resolves the metadata for a map collection's page (registered for the
 * `/maps/collections/:id/:slug?` route in `page-metadata.ts`). Staff collections and public
 * players' collections describe themselves as anyone sees them, counting only their listed maps;
 * one with no listed map is kept out of search engines, as it isn't listed. Every other collection (private, hidden or Starred) and an unknown or malformed id get the default
 * site-wide metadata, kept out of search engines, so the page never reveals what a collection is
 * called to someone who can't see it.
 */
export const mapCollectionPageMetadata: PageMetadataResolver = async (params, context) => {
  const hidden = { ...defaultPageMetadata(context), noindex: true }
  const id = params.id ? mapCollectionIdFromSegment(params.id) : undefined
  if (!id) {
    return hidden
  }
  const collection = await getMapCollectionPageInfo(id)
  if (!collection || !isPublicCollection(collection)) {
    return hidden
  }

  const title = cleanText(collection.title ?? '')
  const description = cleanText(collection.description)
  const count = collection.listedMapCount
  const maps = `${count} ${count === 1 ? 'map' : 'maps'}`
  const ownerName = collection.ownerName ? cleanText(collection.ownerName) : undefined
  const fallbackDescription = ownerName ? `${maps} by ${ownerName}` : maps
  const firstMap = collection.firstListedMapId
    ? (await getMapInfos([collection.firstListedMapId]))[0]
    : undefined

  return {
    url: context.canonicalHost + urlForMapCollection(collection.id, collection.title),
    type: 'website',
    title: title || 'Untitled collection',
    description: description ? truncate(description, MAX_DESCRIPTION_LENGTH) : fallbackDescription,
    // Crawlers don't all decode AVIF
    image: firstMap?.jpegImageUrl ?? defaultPageImage(context),
    noindex: count === 0,
  }
}
