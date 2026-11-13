import { TFunction } from 'i18next'

/** A step through a collection's order: `-1` toward its start, `1` toward its end. */
export type MoveDirection = -1 | 1

/**
 * The index the map at `index` of a collection holding `count` maps moves to when moved one step in
 * `direction`, or undefined when it can't move that way (it's already at that end of the
 * collection, or `index` isn't in it).
 */
export function moveTargetIndex(
  index: number,
  direction: MoveDirection,
  count: number,
): number | undefined {
  if (!Number.isInteger(index) || index < 0 || index >= count) {
    return undefined
  }
  const target = index + direction
  return target >= 0 && target < count ? target : undefined
}

/**
 * The index in a collection's order of row `indexInPage` of page `pageIndex`, for pages of
 * `pageSize` rows. Every page but the last holds `pageSize` rows.
 */
export function rowIndex(pageIndex: number, indexInPage: number, pageSize: number): number {
  return pageIndex * pageSize + indexInPage
}

/** What removing a map from a collection tells the user, e.g. `Removed Fighting Spirit from Picks`. */
export function removedMapText(mapName: string, collectionTitle: string, t: TFunction): string {
  return t('maps.collections.removedMap', {
    defaultValue: 'Removed {{map}} from {{collection}}',
    map: mapName,
    collection: collectionTitle,
  })
}
