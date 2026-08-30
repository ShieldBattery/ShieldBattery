import { beforeEach, describe, expect, test, vi } from 'vitest'
import { clearViewState, createViewStateStore } from './view-state-store'

describe('view-state-store', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    clearViewState()
  })

  test('get returns undefined for a missing key', () => {
    const store = createViewStateStore<number>('test', { maxAgeMs: 1000 })
    expect(store.get('missing')).toBeUndefined()
  })

  test('set then get returns the value', () => {
    const store = createViewStateStore<number>('test', { maxAgeMs: 1000 })
    store.set('a', 42)
    expect(store.get('a')).toBe(42)
  })

  test('namespaces keep the same key string separate', () => {
    const storeA = createViewStateStore<string>('ns-a', { maxAgeMs: 1000 })
    const storeB = createViewStateStore<string>('ns-b', { maxAgeMs: 1000 })

    storeA.set('shared-key', 'from-a')

    expect(storeA.get('shared-key')).toBe('from-a')
    expect(storeB.get('shared-key')).toBeUndefined()
  })

  test('entries expire after maxAgeMs', () => {
    const store = createViewStateStore<number>('test', { maxAgeMs: 1000 })
    store.set('a', 1)

    vi.advanceTimersByTime(1001)

    expect(store.get('a')).toBeUndefined()
  })

  test('entries are still present just under maxAgeMs', () => {
    const store = createViewStateStore<number>('test', { maxAgeMs: 1000 })
    store.set('a', 1)

    vi.advanceTimersByTime(999)

    expect(store.get('a')).toBe(1)
  })

  test('evicts the least-recently-used entry once past capacity', () => {
    const store = createViewStateStore<number>('test', { maxAgeMs: 60 * 60 * 1000 })

    for (let i = 0; i < 50; i++) {
      store.set(`key-${i}`, i)
    }
    // Reading key-0 marks it as recently used, so it should survive the next eviction instead of
    // the never-read key-1, even though key-1 was inserted later.
    expect(store.get('key-0')).toBe(0)

    store.set('key-50', 50)

    expect(store.get('key-0')).toBe(0)
    expect(store.get('key-1')).toBeUndefined()
    expect(store.get('key-49')).toBe(49)
    expect(store.get('key-50')).toBe(50)
  })

  test('delete removes an entry so get returns undefined', () => {
    const store = createViewStateStore<number>('test', { maxAgeMs: 1000 })
    store.set('a', 42)

    store.delete('a')

    expect(store.get('a')).toBeUndefined()
  })

  test('deleting a missing key is a no-op and does not disturb other entries', () => {
    const store = createViewStateStore<number>('test', { maxAgeMs: 1000 })
    store.set('a', 42)

    store.delete('missing')

    expect(store.get('a')).toBe(42)
  })

  test('set on an existing key refreshes both its value and its recency', () => {
    const store = createViewStateStore<number>('test', { maxAgeMs: 60 * 60 * 1000 })

    store.set('key-0', 0)
    for (let i = 1; i < 50; i++) {
      store.set(`key-${i}`, i)
    }
    // Re-set key-0 with a new value; this should also move it to most-recently-used.
    store.set('key-0', 100)

    store.set('key-50', 50)

    expect(store.get('key-0')).toBe(100)
    expect(store.get('key-1')).toBeUndefined()
  })
})
