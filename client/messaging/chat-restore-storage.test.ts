import { describe, expect, test } from 'vitest'
import {
  getFreshStoredRestore,
  MAX_STORED_RESTORE_PLACES,
  resolveRestoreHydration,
  StoredChatRestore,
  StoredChatRestoreMap,
  withRestoreUpdate,
} from './chat-restore-storage'
import { CHAT_ANCHOR_MAX_AGE_MS, ChatViewAnchor } from './chat-view-anchor'

const NOW = 10_000_000

function anchor(messageId = 'a'): ChatViewAnchor {
  return { messageId, sentTime: 500, offsetPx: -12 }
}

function stored(overrides: Partial<StoredChatRestore> = {}): StoredChatRestore {
  return { anchor: anchor(), savedAt: NOW, ...overrides }
}

describe('messaging/chat-restore-storage/withRestoreUpdate', () => {
  test('adds a new entry with the given savedAt', () => {
    const result = withRestoreUpdate({}, 'chat.1', { anchor: anchor() }, NOW)

    expect(result).toEqual({ 'chat.1': { anchor: anchor(), savedAt: NOW } })
  })

  test('stores the divider alongside the position', () => {
    const result = withRestoreUpdate({}, 'chat.1', { anchor: anchor(), unreadLineTime: 400 }, NOW)

    expect(result).toEqual({
      'chat.1': { anchor: anchor(), unreadLineTime: 400, savedAt: NOW },
    })
  })

  test('overwrites an existing entry for the same key', () => {
    const positions: StoredChatRestoreMap = {
      'chat.1': stored({ anchor: anchor('old'), unreadLineTime: 100, savedAt: NOW - 1000 }),
    }

    const result = withRestoreUpdate(positions, 'chat.1', { anchor: anchor('new') }, NOW)

    expect(result).toEqual({ 'chat.1': { anchor: anchor('new'), savedAt: NOW } })
  })

  test('leaves other entries untouched', () => {
    const positions: StoredChatRestoreMap = {
      'whisper.2': stored({ anchor: anchor('other'), savedAt: NOW - 1000 }),
    }

    const result = withRestoreUpdate(positions, 'chat.1', { anchor: anchor() }, NOW)

    expect(result).toEqual({
      'whisper.2': { anchor: anchor('other'), savedAt: NOW - 1000 },
      'chat.1': { anchor: anchor(), savedAt: NOW },
    })
  })

  test('removes the entry when there is no position to store', () => {
    const positions: StoredChatRestoreMap = { 'chat.1': stored() }

    const result = withRestoreUpdate(positions, 'chat.1', undefined, NOW)

    expect(result).toEqual({})
  })

  test('removing an entry that was never stored is a no-op', () => {
    const positions: StoredChatRestoreMap = { 'whisper.2': stored({ savedAt: NOW - 1000 }) }

    const result = withRestoreUpdate(positions, 'chat.1', undefined, NOW)

    expect(result).toEqual({ 'whisper.2': { anchor: anchor(), savedAt: NOW - 1000 } })
  })

  test('prunes entries that have outlived a reading position', () => {
    const positions: StoredChatRestoreMap = {
      'chat.2': stored({ savedAt: NOW - CHAT_ANCHOR_MAX_AGE_MS - 1 }),
      'chat.3': stored({ savedAt: NOW - CHAT_ANCHOR_MAX_AGE_MS }),
    }

    const result = withRestoreUpdate(positions, 'chat.1', { anchor: anchor() }, NOW)

    expect(Object.keys(result).sort()).toEqual(['chat.1', 'chat.3'])
  })

  test('drops stray entries that carry no position', () => {
    const positions = {
      'chat.2': { savedAt: NOW } as StoredChatRestore,
      'chat.3': stored(),
    }

    const result = withRestoreUpdate(positions, 'chat.1', { anchor: anchor() }, NOW)

    expect(Object.keys(result).sort()).toEqual(['chat.1', 'chat.3'])
  })

  test('caps the stored places, evicting the ones saved longest ago', () => {
    const positions: StoredChatRestoreMap = {}
    for (let i = 0; i < MAX_STORED_RESTORE_PLACES; i++) {
      positions[`chat.${i}`] = stored({ savedAt: NOW - (MAX_STORED_RESTORE_PLACES - i) })
    }

    const result = withRestoreUpdate(positions, 'chat.new', { anchor: anchor() }, NOW)

    expect(Object.keys(result).length).toBe(MAX_STORED_RESTORE_PLACES)
    expect(result['chat.new']).toBeDefined()
    // `chat.0` had the oldest savedAt of the entries that were already there.
    expect(result['chat.0']).toBeUndefined()
    expect(result['chat.1']).toBeDefined()
  })

  test('leaves a map at exactly the cap alone', () => {
    const positions: StoredChatRestoreMap = {}
    for (let i = 0; i < MAX_STORED_RESTORE_PLACES - 1; i++) {
      positions[`chat.${i}`] = stored({ savedAt: NOW - 1 })
    }

    const result = withRestoreUpdate(positions, 'chat.new', { anchor: anchor() }, NOW)

    expect(Object.keys(result).length).toBe(MAX_STORED_RESTORE_PLACES)
  })
})

describe('messaging/chat-restore-storage/getFreshStoredRestore', () => {
  test('returns an entry that is still worth returning to', () => {
    const positions: StoredChatRestoreMap = { 'chat.1': stored({ unreadLineTime: 400 }) }

    expect(getFreshStoredRestore(positions, 'chat.1', NOW)).toEqual({
      anchor: anchor(),
      unreadLineTime: 400,
      savedAt: NOW,
    })
  })

  test('returns nothing for a key that has no entry', () => {
    expect(getFreshStoredRestore({}, 'chat.1', NOW)).toBeUndefined()
  })

  test('returns nothing for an entry that carries no position', () => {
    const positions = { 'chat.1': { savedAt: NOW } as StoredChatRestore }

    expect(getFreshStoredRestore(positions, 'chat.1', NOW)).toBeUndefined()
  })

  test('returns nothing for an entry that has outlived a reading position', () => {
    const positions: StoredChatRestoreMap = {
      'chat.1': stored({ savedAt: NOW - CHAT_ANCHOR_MAX_AGE_MS - 1 }),
    }

    expect(getFreshStoredRestore(positions, 'chat.1', NOW)).toBeUndefined()
  })

  test('returns an entry saved exactly a reading position ago', () => {
    const positions: StoredChatRestoreMap = {
      'chat.1': stored({ savedAt: NOW - CHAT_ANCHOR_MAX_AGE_MS }),
    }

    expect(getFreshStoredRestore(positions, 'chat.1', NOW)).toBeDefined()
  })
})

describe('messaging/chat-restore-storage/resolveRestoreHydration', () => {
  test('brings back a stored position when this session holds none', () => {
    expect(resolveRestoreHydration(undefined, stored())).toEqual(anchor())
  })

  test('leaves a position this session already holds alone', () => {
    expect(
      resolveRestoreHydration(anchor('in-session'), stored({ anchor: anchor('durable') })),
    ).toEqual(undefined)
  })

  test('brings back nothing when there is nothing stored to bring back', () => {
    expect(resolveRestoreHydration(undefined, undefined)).toBeUndefined()
  })
})
