import { TFunction } from 'i18next'
import { MapKind, MapLens } from '../gql/graphql'
import { CatalogSort, CLEARED_CATALOG_FILTERS, serializeCatalogParams } from './map-catalog-params'
import { mapTagLabel, MapTagNames } from './map-tags'

/** The fewest items a rail of the Discover page shows. With fewer, the rail is left out. */
export const MIN_RAIL_ITEMS = 4

/** The fewest recently played maps the Jump back in grid shows. With fewer, it's left out. */
export const MIN_RECENT_MAPS = 3

/** How many recently played maps the Jump back in grid asks for. */
export const RECENT_MAPS_COUNT = 6

/** The most maps a rail of maps holds. */
export const MAP_RAIL_SIZE = 12

/** How many of the newest maps are loaded for the Fresh rail, before the cap per publisher. */
export const FRESH_FETCH_COUNT = 24

/** The most maps of one publisher the Fresh rail shows. */
export const FRESH_PER_PUBLISHER = 2

/** How recently a map's recommended file has to have been published to count as fresh. */
export const FRESH_DAYS = 60

/** The fewest listed maps a tag needs to be offered in the Browse by tag row. */
export const BROWSE_TAG_MIN_MAPS = 3

/** The most collections the Collections rail holds. */
export const COLLECTION_RAIL_SIZE = 8

/** The most mapmakers the Mapmakers rail holds. */
export const MAKER_RAIL_SIZE = 8

const DAY_MS = 24 * 60 * 60 * 1000

/**
 * The items of a rail if there are enough of them to show it (at least `min`), else undefined, so
 * the rail is left out.
 */
export function shownRail<T>(
  items: ReadonlyArray<T> | null | undefined,
  min = MIN_RAIL_ITEMS,
): ReadonlyArray<T> | undefined {
  return items && items.length >= min ? items : undefined
}

/**
 * The maps of the Trending rail from the most trending maps: the ones whose map's trending score
 * (summed over all of its files, as the catalog's Trending sort goes by) is above 0, since a score
 * of 0 means too few people played the map lately to tell, at most {@link MAP_RAIL_SIZE} of them.
 */
export function trendingRail<T extends { family: { stats?: { trendingScore: number } | null } }>(
  maps: ReadonlyArray<T>,
): T[] {
  return maps
    .filter(m => !!m.family.stats && m.family.stats.trendingScore > 0)
    .slice(0, MAP_RAIL_SIZE)
}

/**
 * The maps of the Fresh rail from the newest maps, in their order: at most
 * {@link FRESH_PER_PUBLISHER} by each publisher, so one person publishing many maps doesn't fill
 * the rail, then at most {@link MAP_RAIL_SIZE} of them. A map with no known publisher counts as
 * its own.
 */
export function freshRail<T extends { id: string; publisher?: { id: number } | null }>(
  maps: ReadonlyArray<T>,
): T[] {
  const perPublisher = new Map<number, number>()
  const result: T[] = []
  for (const map of maps) {
    const publisherId = map.publisher?.id
    if (publisherId !== undefined) {
      const count = perPublisher.get(publisherId) ?? 0
      if (count >= FRESH_PER_PUBLISHER) {
        continue
      }
      perPublisher.set(publisherId, count + 1)
    }
    result.push(map)
    if (result.length >= MAP_RAIL_SIZE) {
      break
    }
  }
  return result
}

/**
 * The time from which a map counts as fresh, given the current time: {@link FRESH_DAYS} days
 * before the start of the current day (UTC), so the value stays the same all day and repeat visits
 * share their cached results.
 */
export function freshSince(now: number): string {
  const startOfDay = Math.floor(now / DAY_MS) * DAY_MS
  return new Date(startOfDay - FRESH_DAYS * DAY_MS).toISOString()
}

/**
 * The collections of the Collections rail: the staff's, then players' (most saved first), at most
 * {@link COLLECTION_RAIL_SIZE} in all.
 */
export function collectionsRail<T extends { id: string }>(
  staff: ReadonlyArray<T>,
  players: ReadonlyArray<T>,
): T[] {
  const seen = new Set<string>()
  const result: T[] = []
  for (const collection of [...staff, ...players]) {
    if (!seen.has(collection.id)) {
      seen.add(collection.id)
      result.push(collection)
    }
  }
  return result.slice(0, COLLECTION_RAIL_SIZE)
}

/**
 * The tags the Browse by tag row offers, in list order: the ones for the maps `lens` shows that at
 * least {@link BROWSE_TAG_MIN_MAPS} listed maps have.
 */
export function browseTags<T extends { kind: MapKind; mapCount: number }>(
  tags: ReadonlyArray<T>,
  lens: MapLens,
): T[] {
  return tags.filter(
    tag =>
      tag.mapCount >= BROWSE_TAG_MIN_MAPS &&
      (lens === MapLens.All ||
        (lens === MapLens.Melee ? tag.kind === MapKind.Melee : tag.kind === MapKind.Ums)),
  )
}

/**
 * The line under the title of the Because you played rail, naming the seed map's tags (a map holds
 * at most 3) in `language`: e.g. "Defense and Co-op maps you haven't played".
 */
export function recommendationSubtitle(
  tags: ReadonlyArray<MapTagNames>,
  language: string,
  t: TFunction,
): string {
  const labels = tags.map(tag => mapTagLabel(tag, language))
  if (labels.length === 1) {
    return t('maps.discover.recommendationOneTag', "{{tag}} maps you haven't played", {
      tag: labels[0],
    })
  } else if (labels.length === 2) {
    return t(
      'maps.discover.recommendationTwoTags',
      "{{first}} and {{second}} maps you haven't played",
      {
        first: labels[0],
        second: labels[1],
      },
    )
  } else if (labels.length >= 3) {
    return t(
      'maps.discover.recommendationThreeTags',
      "{{first}}, {{second}} and {{third}} maps you haven't played",
      { first: labels[0], second: labels[1], third: labels[2] },
    )
  }
  return t('maps.discover.recommendationNoTags', "Maps you haven't played")
}

/**
 * The tag whose catalog listing the Because you played rail's Show all opens: its seed's only tag.
 * With more tags there's none, since the catalog's tag filter wants maps with all of them, while
 * the rail holds maps sharing any of them.
 */
export function recommendationShowAllTag<T>(tags: ReadonlyArray<T>): T | undefined {
  return tags.length === 1 ? tags[0] : undefined
}

/**
 * The URL search string of the catalog listing a rail is the first page of: every listed map of
 * `lens` in the order `sort`, with no other filters.
 */
export function catalogSearchForRail(lens: MapLens, sort: CatalogSort): string {
  return serializeCatalogParams({ ...CLEARED_CATALOG_FILTERS, lens, search: '', sort })
}

/** The space between the cards of a one-row rail, in CSS pixels. */
export const RAIL_GAP = 16

/** A width from which a one-row rail shows `columns` cards, in as many equal columns. */
export interface RailColumnStep {
  /** The narrowest the rail can be to show this many cards, in CSS pixels. */
  fromWidth: number
  columns: number
}

/**
 * The widths at which a one-row rail shows another card: `k` cards from the width that fits `k`
 * cards of `minCardWidth` with `gap` between them, for 1 up to `maxColumns` cards. The first step
 * starts at 0, so even a rail narrower than one card shows one, squeezed.
 */
export function railColumnSteps(
  minCardWidth: number,
  gap: number,
  maxColumns: number,
): RailColumnStep[] {
  return Array.from({ length: maxColumns }, (_, i) => {
    const columns = i + 1
    return { fromWidth: i === 0 ? 0 : columns * minCardWidth + i * gap, columns }
  })
}
