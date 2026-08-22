import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import {
  getHistoryEntryKey,
  installHistoryEntryKeys,
  resetHistoryEntryKeysForTesting,
} from './history-entry-key'

describe('history-entry-key', () => {
  beforeEach(() => {
    history.replaceState(null, '', '/a')
    installHistoryEntryKeys()
  })

  afterEach(() => {
    resetHistoryEntryKeysForTesting()
  })

  test('getHistoryEntryKey returns undefined for null state', () => {
    expect(getHistoryEntryKey(null)).toBeUndefined()
  })

  test('getHistoryEntryKey returns undefined for a sentinel string state', () => {
    expect(getHistoryEntryKey('SOME:sentinel')).toBeUndefined()
  })

  test('getHistoryEntryKey returns undefined for an object without the stamp', () => {
    expect(getHistoryEntryKey({ foo: 'bar' })).toBeUndefined()
  })

  test('installing stamps the initial entry with a key', () => {
    const key = getHistoryEntryKey()
    expect(typeof key).toBe('string')
  })

  test('push with null state to a different pathname mints a fresh key', () => {
    const firstKey = getHistoryEntryKey()

    history.pushState(null, '', '/b')

    const secondKey = getHistoryEntryKey()
    expect(secondKey).toEqual(expect.any(String))
    expect(secondKey).not.toBe(firstKey)
  })

  test('push with null state to the same pathname inherits the current key', () => {
    const firstKey = getHistoryEntryKey()

    history.pushState(null, '', '/a?page=2')

    expect(getHistoryEntryKey()).toBe(firstKey)
  })

  test('push with null state and a hash-only url inherits the current key', () => {
    const firstKey = getHistoryEntryKey()

    history.pushState(null, '', '#section')

    expect(getHistoryEntryKey()).toBe(firstKey)
  })

  test('push with a non-null state passes it through untouched', () => {
    history.pushState('SETTINGS:open', '', '/a')

    expect(history.state).toBe('SETTINGS:open')
    expect(getHistoryEntryKey()).toBeUndefined()
  })

  test('push with a non-null state does not change the tracked visit key', () => {
    const firstKey = getHistoryEntryKey()

    history.pushState('SETTINGS:open', '', '/a')
    // A subsequent null-state push on the same pathname should inherit the key that was current
    // before the sentinel entry, not lose it.
    history.pushState(null, '', '/a')

    expect(getHistoryEntryKey()).toBe(firstKey)
  })

  test('replaceState with null state keeps the current entry key while changing the url', () => {
    const firstKey = getHistoryEntryKey()

    history.replaceState(null, '', '/a-corrected')

    expect(getHistoryEntryKey()).toBe(firstKey)
    expect(window.location.pathname).toBe('/a-corrected')
  })

  test('replaceState with a non-null state passes it through untouched', () => {
    history.replaceState('SETTINGS:open', '', '/a')

    expect(history.state).toBe('SETTINGS:open')
    expect(getHistoryEntryKey()).toBeUndefined()
  })

  test('popstate resyncs the tracked visit key to the entry the browser traversed to', () => {
    const firstKey = getHistoryEntryKey()

    history.pushState(null, '', '/b')
    expect(getHistoryEntryKey()).not.toBe(firstKey)

    // A real back-traversal changes `history.state` without going through pushState/replaceState
    // at all, then fires popstate; setting the state directly via a non-null replaceState (which
    // passes through untouched and leaves the tracked key alone) reproduces that same moment.
    history.replaceState({ __sbEntryKey: firstKey }, '', '/a')
    window.dispatchEvent(new PopStateEvent('popstate'))

    // With the tracked key resynced, a subsequent push back to the same pathname inherits it
    // instead of minting a new one or reusing the stale key from the /b entry.
    history.pushState(null, '', '/a')
    expect(getHistoryEntryKey()).toBe(firstKey)
  })

  test('installHistoryEntryKeys is idempotent', () => {
    const firstKey = getHistoryEntryKey()

    installHistoryEntryKeys()
    history.pushState(null, '', '/b')

    expect(getHistoryEntryKey()).not.toBe(firstKey)
  })
})
