import { act, renderHook } from '@testing-library/react'
import { describe, expect, test } from 'vitest'
import { MAX_MAP_QUEUE } from '../../common/lobbies'
import { makeSbMapId } from '../../common/maps'
import { appendQueuedMap, toQueueEntries, useMapQueueEditor } from './map-queue-editor'

const A = makeSbMapId('map-a')
const B = makeSbMapId('map-b')

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
})
