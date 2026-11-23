import { nanoid } from 'nanoid'
import { useState } from 'react'
import { MAX_MAP_QUEUE } from '../../common/lobbies'
import { SbMapId } from '../../common/maps'

/**
 * One map in a map queue being edited. The same map can be queued more than once, so each entry
 * carries its own key to tell the copies apart.
 */
export interface QueuedMapEntry {
  key: string
  mapId: SbMapId
}

/** Builds the editable entries for a list of map ids, in the same order. */
export function toQueueEntries(mapIds: ReadonlyArray<SbMapId>): QueuedMapEntry[] {
  return mapIds.map(mapId => ({ key: nanoid(), mapId }))
}

/** Adds a map to the end of the queue, unless the queue is already at `MAX_MAP_QUEUE` maps. */
export function appendQueuedMap(
  queue: ReadonlyArray<QueuedMapEntry>,
  mapId: SbMapId,
): QueuedMapEntry[] {
  return queue.length < MAX_MAP_QUEUE ? [...queue, { key: nanoid(), mapId }] : queue.slice()
}

/**
 * Adds maps to the end of the queue in order, as {@link appendQueuedMap} adds each one, so the
 * maps past `MAX_MAP_QUEUE` are left out.
 */
export function appendQueuedMaps(
  queue: ReadonlyArray<QueuedMapEntry>,
  mapIds: ReadonlyArray<SbMapId>,
): QueuedMapEntry[] {
  return mapIds.reduce<QueuedMapEntry[]>((q, mapId) => appendQueuedMap(q, mapId), queue.slice())
}

/**
 * Splits a list of maps (e.g. a collection's, in its order) into a lobby's map and the queue after
 * it: the first map, then as many of the rest as the queue holds.
 */
export function splitMapAndQueue(mapIds: ReadonlyArray<SbMapId>): {
  mapId: SbMapId | undefined
  queue: SbMapId[]
} {
  return { mapId: mapIds[0], queue: mapIds.slice(1, 1 + MAX_MAP_QUEUE) }
}

/**
 * The state of a map queue being edited, starting from `initialMapIds` (only read on the first
 * render).
 */
export function useMapQueueEditor(initialMapIds: ReadonlyArray<SbMapId> = []) {
  const [queue, setQueue] = useState<QueuedMapEntry[]>(() => toQueueEntries(initialMapIds))

  return {
    queue,
    setQueue,
    queueIds: queue.map(entry => entry.mapId),
    canQueueMore: queue.length < MAX_MAP_QUEUE,
    addMap: (mapId: SbMapId) => setQueue(q => appendQueuedMap(q, mapId)),
    addMaps: (mapIds: ReadonlyArray<SbMapId>) => setQueue(q => appendQueuedMaps(q, mapIds)),
  }
}
