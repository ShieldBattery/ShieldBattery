import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { makeSbUserId } from '../../common/users/sb-user-id'
import {
  DRAFT_WRITE_COALESCE_MS,
  MAX_STORED_DRAFTS,
  StoredDraftsMap,
  flushDraftWrite,
  getStoredDraft,
  resetDraftStorageForTesting,
  resolveInitialDraftValue,
  scheduleDraftWrite,
  withDraftUpdate,
} from './draft-storage'

const USER_ID = makeSbUserId(1)

describe('messaging/draft-storage', () => {
  describe('withDraftUpdate', () => {
    test('adds a new entry with the given text and savedAt', () => {
      const result = withDraftUpdate({}, 'chat.1', 'hello', 100)

      expect(result).toEqual({ 'chat.1': { text: 'hello', savedAt: 100 } })
    })

    test('overwrites an existing entry for the same key', () => {
      const drafts: StoredDraftsMap = { 'chat.1': { text: 'hello', savedAt: 100 } }

      const result = withDraftUpdate(drafts, 'chat.1', 'hello there', 200)

      expect(result).toEqual({ 'chat.1': { text: 'hello there', savedAt: 200 } })
    })

    test('leaves other entries untouched', () => {
      const drafts: StoredDraftsMap = {
        'chat.1': { text: 'first', savedAt: 100 },
        'whisper.2': { text: 'second', savedAt: 150 },
      }

      const result = withDraftUpdate(drafts, 'chat.1', 'updated', 300)

      expect(result).toEqual({
        'chat.1': { text: 'updated', savedAt: 300 },
        'whisper.2': { text: 'second', savedAt: 150 },
      })
    })

    test('removes the entry when text is empty, rather than storing an empty string', () => {
      const drafts: StoredDraftsMap = { 'chat.1': { text: 'hello', savedAt: 100 } }

      const result = withDraftUpdate(drafts, 'chat.1', '', 200)

      expect(result).toEqual({})
    })

    test('an empty update for a key with no existing entry is a no-op', () => {
      const drafts: StoredDraftsMap = { 'whisper.2': { text: 'second', savedAt: 150 } }

      const result = withDraftUpdate(drafts, 'chat.1', '', 200)

      expect(result).toEqual({ 'whisper.2': { text: 'second', savedAt: 150 } })
    })

    test('drops other stray empty entries encountered while updating', () => {
      // Empty entries should never be written by `withDraftUpdate` itself, but defend against
      // them anyway (e.g. a value written by a future/older format).
      const drafts: StoredDraftsMap = {
        'chat.1': { text: '', savedAt: 100 },
        'whisper.2': { text: 'kept', savedAt: 150 },
      }

      const result = withDraftUpdate(drafts, 'chat.3', 'new', 200)

      expect(result).toEqual({
        'whisper.2': { text: 'kept', savedAt: 150 },
        'chat.3': { text: 'new', savedAt: 200 },
      })
    })

    test('does not evict anything when at or under the cap', () => {
      const drafts: StoredDraftsMap = {}
      for (let i = 0; i < MAX_STORED_DRAFTS - 1; i++) {
        drafts[`chat.${i}`] = { text: `text ${i}`, savedAt: i }
      }

      const result = withDraftUpdate(drafts, 'chat.new', 'new text', MAX_STORED_DRAFTS)

      expect(Object.keys(result)).toHaveLength(MAX_STORED_DRAFTS)
    })

    test('evicts the oldest entries by savedAt once the cap is exceeded', () => {
      const drafts: StoredDraftsMap = {}
      for (let i = 0; i < MAX_STORED_DRAFTS; i++) {
        drafts[`chat.${i}`] = { text: `text ${i}`, savedAt: i }
      }

      // chat.0 has the oldest savedAt (0), so adding one more entry should evict it.
      const result = withDraftUpdate(drafts, 'chat.new', 'new text', MAX_STORED_DRAFTS)

      expect(Object.keys(result)).toHaveLength(MAX_STORED_DRAFTS)
      expect(result['chat.0']).toBeUndefined()
      expect(result['chat.1']).toEqual({ text: 'text 1', savedAt: 1 })
      expect(result['chat.new']).toEqual({ text: 'new text', savedAt: MAX_STORED_DRAFTS })
    })
  })

  describe('resolveInitialDraftValue', () => {
    test('returns the in-session value when present', () => {
      expect(resolveInitialDraftValue('in session', 'stored', 'default')).toBe('in session')
    })

    test('falls back to the stored value when there is no in-session value', () => {
      expect(resolveInitialDraftValue(undefined, 'stored', 'default')).toBe('stored')
    })

    test('falls back to the default when neither in-session nor stored values are present', () => {
      expect(resolveInitialDraftValue(undefined, undefined, 'default')).toBe('default')
    })

    test('prefers the in-session value over the stored value when both are present', () => {
      expect(resolveInitialDraftValue('in session', 'stored', 'default')).toBe('in session')
    })
  })

  describe('scheduleDraftWrite / flushDraftWrite / getStoredDraft', () => {
    beforeEach(() => {
      vi.useFakeTimers()
      resetDraftStorageForTesting()
      localStorage.clear()
    })

    afterEach(() => {
      vi.useRealTimers()
    })

    test('does not persist anything before the coalescing window elapses', () => {
      scheduleDraftWrite(USER_ID, 'chat.1', 'hello')

      vi.advanceTimersByTime(DRAFT_WRITE_COALESCE_MS - 1)

      expect(getStoredDraft(USER_ID, 'chat.1')).toBeUndefined()
    })

    test('persists the text once the coalescing window elapses', () => {
      scheduleDraftWrite(USER_ID, 'chat.1', 'hello')

      vi.advanceTimersByTime(DRAFT_WRITE_COALESCE_MS)

      expect(getStoredDraft(USER_ID, 'chat.1')).toBe('hello')
    })

    test('rapid updates within the window coalesce into a single write of the newest text', () => {
      scheduleDraftWrite(USER_ID, 'chat.1', 'h')
      vi.advanceTimersByTime(DRAFT_WRITE_COALESCE_MS / 2)
      scheduleDraftWrite(USER_ID, 'chat.1', 'he')
      vi.advanceTimersByTime(DRAFT_WRITE_COALESCE_MS / 2)
      scheduleDraftWrite(USER_ID, 'chat.1', 'hel')

      // The first two schedules should have been superseded rather than each writing in turn.
      vi.advanceTimersByTime(DRAFT_WRITE_COALESCE_MS)

      expect(getStoredDraft(USER_ID, 'chat.1')).toBe('hel')
    })

    test('flushDraftWrite persists immediately and cancels the pending timer', () => {
      scheduleDraftWrite(USER_ID, 'chat.1', 'hello')

      flushDraftWrite(USER_ID, 'chat.1')

      expect(getStoredDraft(USER_ID, 'chat.1')).toBe('hello')

      // Nothing further should happen when the original timer would have fired.
      vi.advanceTimersByTime(DRAFT_WRITE_COALESCE_MS)
      expect(getStoredDraft(USER_ID, 'chat.1')).toBe('hello')
    })

    test('flushDraftWrite with nothing pending is a no-op', () => {
      expect(() => flushDraftWrite(USER_ID, 'chat.never-scheduled')).not.toThrow()
      expect(getStoredDraft(USER_ID, 'chat.never-scheduled')).toBeUndefined()
    })

    test('scheduling an empty text deletes a previously persisted draft', () => {
      scheduleDraftWrite(USER_ID, 'chat.1', 'hello')
      vi.advanceTimersByTime(DRAFT_WRITE_COALESCE_MS)
      expect(getStoredDraft(USER_ID, 'chat.1')).toBe('hello')

      scheduleDraftWrite(USER_ID, 'chat.1', '')
      vi.advanceTimersByTime(DRAFT_WRITE_COALESCE_MS)

      expect(getStoredDraft(USER_ID, 'chat.1')).toBeUndefined()
    })

    test('independent keys coalesce separately', () => {
      scheduleDraftWrite(USER_ID, 'chat.1', 'first')
      vi.advanceTimersByTime(DRAFT_WRITE_COALESCE_MS / 2)
      scheduleDraftWrite(USER_ID, 'whisper.2', 'second')

      vi.advanceTimersByTime(DRAFT_WRITE_COALESCE_MS / 2)
      expect(getStoredDraft(USER_ID, 'chat.1')).toBe('first')
      expect(getStoredDraft(USER_ID, 'whisper.2')).toBeUndefined()

      vi.advanceTimersByTime(DRAFT_WRITE_COALESCE_MS / 2)
      expect(getStoredDraft(USER_ID, 'whisper.2')).toBe('second')
    })

    test('drafts for different users are stored independently', () => {
      const otherUser = makeSbUserId(2)

      scheduleDraftWrite(USER_ID, 'chat.1', 'mine')
      scheduleDraftWrite(otherUser, 'chat.1', 'theirs')
      vi.advanceTimersByTime(DRAFT_WRITE_COALESCE_MS)

      expect(getStoredDraft(USER_ID, 'chat.1')).toBe('mine')
      expect(getStoredDraft(otherUser, 'chat.1')).toBe('theirs')
    })
  })
})
