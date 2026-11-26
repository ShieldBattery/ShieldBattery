import { TFunction } from 'i18next'
import { ReadonlyDeep } from 'type-fest'
import { SbMapId } from '../../common/maps'
import { MapPoolChangeNotice } from '../../common/matchmaking/matchmaking-map-pools'

/** One kind of change a map pool update made, as named in its summary. */
export type MapPoolChangePart =
  | { kind: 'added'; count: number }
  | { kind: 'removed'; count: number }
  | { kind: 'vetoLimit'; previous: number; current: number }

/** The kinds of change in `notice` that its summary names, in the order they're listed. */
export function getMapPoolChangeParts(
  notice: ReadonlyDeep<MapPoolChangeNotice>,
): MapPoolChangePart[] {
  const parts: MapPoolChangePart[] = []
  if (notice.addedMaps.length) {
    parts.push({ kind: 'added', count: notice.addedMaps.length })
  }
  if (notice.removedMaps.length) {
    parts.push({ kind: 'removed', count: notice.removedMaps.length })
  }
  if (notice.maxVetoCount) {
    parts.push({
      kind: 'vetoLimit',
      previous: notice.maxVetoCount.previous,
      current: notice.maxVetoCount.current,
    })
  }
  return parts
}

export type DroppedSelectionReason = MapPoolChangeNotice['droppedSelections'][number]['reason']

/** The player's dropped map selections grouped by why they were dropped, in a stable order. */
export function groupDroppedSelections(
  notice: ReadonlyDeep<MapPoolChangeNotice>,
): Array<{ reason: DroppedSelectionReason; mapIds: SbMapId[] }> {
  const groups: Array<{ reason: DroppedSelectionReason; mapIds: SbMapId[] }> = []
  for (const reason of ['mapRemoved', 'vetoLimit'] as const) {
    const mapIds = notice.droppedSelections.filter(d => d.reason === reason).map(d => d.mapId)
    if (mapIds.length) {
      groups.push({ reason, mapIds })
    }
  }
  return groups
}

/** Returns `maps` with the ones in `firstMaps` moved to the front, otherwise keeping their order. */
export function orderMapsFirst(
  maps: ReadonlyArray<SbMapId>,
  firstMaps: ReadonlyArray<SbMapId> | undefined,
): SbMapId[] {
  if (!firstMaps?.length) {
    return [...maps]
  }
  const first = new Set(firstMaps)
  return [...maps.filter(id => first.has(id)), ...maps.filter(id => !first.has(id))]
}

export function mapPoolChangePartToText(part: MapPoolChangePart, t: TFunction): string {
  switch (part.kind) {
    case 'added':
      return t('matchmaking.findMatch.poolChange.added', {
        defaultValue: '{{count}} new maps',
        defaultValue_one: '{{count}} new map',
        count: part.count,
      })
    case 'removed':
      return t('matchmaking.findMatch.poolChange.removed', {
        defaultValue: '{{count}} removed',
        count: part.count,
      })
    case 'vetoLimit':
      return t('matchmaking.findMatch.poolChange.vetoLimit', {
        defaultValue: 'Vetoes {{previous}} → {{current}}',
        previous: part.previous,
        current: part.current,
      })
    default:
      return part satisfies never
  }
}

/** The one-line summary of what a pool change did, e.g. "2 new maps · 1 removed". */
export function getMapPoolChangeSummaryText(
  notice: ReadonlyDeep<MapPoolChangeNotice>,
  t: TFunction,
): string {
  const parts = getMapPoolChangeParts(notice)
  if (!parts.length) {
    return t('matchmaking.findMatch.poolChange.updated', 'The map pool was updated.')
  }
  return parts.map(part => mapPoolChangePartToText(part, t)).join(' · ')
}

/**
 * Says that the player's own selections of `maps` (already joined into one string) were dropped,
 * and why. `count` is how many maps `maps` names.
 */
export function getDroppedSelectionsText(
  reason: DroppedSelectionReason,
  selectionStyle: 'veto' | 'pick',
  maps: string,
  count: number,
  t: TFunction,
): string {
  if (selectionStyle === 'pick') {
    return t('matchmaking.findMatch.poolChange.pickRemovedWithMap', {
      defaultValue: 'Your picks of {{maps}} were removed with the maps.',
      defaultValue_one: 'Your pick of {{maps}} was removed with the map.',
      maps,
      count,
    })
  }
  if (reason === 'vetoLimit') {
    return t('matchmaking.findMatch.poolChange.vetoRemovedByLimit', {
      defaultValue: 'Your vetoes on {{maps}} were removed because the veto limit is lower.',
      defaultValue_one: 'Your veto on {{maps}} was removed because the veto limit is lower.',
      maps,
      count,
    })
  }
  return t('matchmaking.findMatch.poolChange.vetoRemovedWithMap', {
    defaultValue: 'Your vetoes on {{maps}} were removed with the maps.',
    defaultValue_one: 'Your veto on {{maps}} was removed with the map.',
    maps,
    count,
  })
}

/** The short form of the summary, shown on a mode's row on the find-match screen. */
export function getMapPoolChangeBadgeText(
  notice: ReadonlyDeep<MapPoolChangeNotice>,
  t: TFunction,
): string {
  const [first] = getMapPoolChangeParts(notice)
  return first ? mapPoolChangePartToText(first, t) : t('matchmaking.findMatch.updated', 'Updated')
}
