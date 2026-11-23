import { act, renderHook } from '@testing-library/react'
import { describe, expect, test } from 'vitest'
import { MAX_MAP_QUEUE } from '../../common/lobbies'
import { makeSbMapId } from '../../common/maps'
import {
  appendQueuedMap,
  appendQueuedMaps,
  splitMapAndQueue,
  toQueueEntries,
  useMapQueueEditor,
} from './map-queue-editor'

const A = makeSbMapId('map-a')
const B = makeSbMapId('map-b')
const C = makeSbMapId('map-c')

describe('lobbies/map-queue-editor', () => {
  test('toQueueEntries keeps order and repeats, with a distinct key per entry', () => {
    const entries = toQueueEntries([A, B, A])

    expect(entries.map(e => e.mapId)).toEqual([A, B, A])
    expect(new Set(entries.map(e => e.key)).size).toBe(3)
  })

  test('appendQueuedMap adds to the end and allows repeats', () => {
    const queue = appendQueuedMap(appendQueuedMap(appendQueuedMap([], A), B), A)

    expect(queue.map(e => e.mapId)).toEqual([A, B, A])
  })

  test('appendQueuedMap leaves a full queue as it is', () => {
    const full = toQueueEntries(Array(MAX_MAP_QUEUE).fill(A))

    expect(appendQueuedMap(full, B).map(e => e.key)).toEqual(full.map(e => e.key))
  })

  test('useMapQueueEditor starts empty by default and adds up to the maximum', () => {
    const { result } = renderHook(() => useMapQueueEditor())

    expect(result.current.queueIds).toEqual([])
    expect(result.current.canQueueMore).toBe(true)

    act(() => {
      for (let i = 0; i < MAX_MAP_QUEUE + 3; i++) {
        result.current.addMap(i % 2 ? A : B)
      }
    })

    expect(result.current.queue).toHaveLength(MAX_MAP_QUEUE)
    expect(result.current.canQueueMore).toBe(false)
  })

  test('useMapQueueEditor starts from the given maps', () => {
    const { result } = renderHook(() => useMapQueueEditor([A, B]))

    expect(result.current.queueIds).toEqual([A, B])
  })

  test('appendQueuedMaps adds in order after the queued maps, repeats included', () => {
    const queue = appendQueuedMaps(toQueueEntries([A]), [B, A, C])

    expect(queue.map(e => e.mapId)).toEqual([A, B, A, C])
    expect(new Set(queue.map(e => e.key)).size).toBe(4)
  })

  test('appendQueuedMaps stops once the queue is full', () => {
    const start = toQueueEntries(Array(MAX_MAP_QUEUE - 2).fill(A))
    const queue = appendQueuedMaps(start, [B, C, B, C])

    expect(queue).toHaveLength(MAX_MAP_QUEUE)
    expect(queue.slice(-2).map(e => e.mapId)).toEqual([B, C])
    expect(queue.slice(0, start.length).map(e => e.key)).toEqual(start.map(e => e.key))
  })

  test('appendQueuedMaps leaves a full queue as it is', () => {
    const full = toQueueEntries(Array(MAX_MAP_QUEUE).fill(A))

    expect(appendQueuedMaps(full, [B, C]).map(e => e.key)).toEqual(full.map(e => e.key))
  })

  test('useMapQueueEditor adds several maps up to the maximum', () => {
    const { result } = renderHook(() => useMapQueueEditor([A]))

    act(() => {
      result.current.addMaps(Array(MAX_MAP_QUEUE).fill(B))
    })

    expect(result.current.queueIds).toEqual([A, ...Array(MAX_MAP_QUEUE - 1).fill(B)])
    expect(result.current.canQueueMore).toBe(false)
  })

  test('splitMapAndQueue takes the first map and queues the next ones up to the maximum', () => {
    const ids = Array.from({ length: MAX_MAP_QUEUE + 5 }, (_, i) => makeSbMapId(`map-${i}`))
    const { mapId, queue } = splitMapAndQueue(ids)

    expect(mapId).toBe(ids[0])
    expect(queue).toEqual(ids.slice(1, MAX_MAP_QUEUE + 1))
  })

  test('splitMapAndQueue handles short and empty lists', () => {
    expect(splitMapAndQueue([A])).toEqual({ mapId: A, queue: [] })
    expect(splitMapAndQueue([A, B, A])).toEqual({ mapId: A, queue: [B, A] })
    expect(splitMapAndQueue([])).toEqual({ mapId: undefined, queue: [] })
  })
})
