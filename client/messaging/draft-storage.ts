import { getErrorStack } from '../../common/errors'
import { SbUserId } from '../../common/users/sb-user-id'
import logger from '../logging/logger'

/**
 * How long to wait after the last update to a conversation's draft before persisting it to
 * `localStorage`. Keystrokes arriving faster than this get folded into a single write, so a burst
 * of typing costs at most one write per window rather than one per keystroke.
 */
export const DRAFT_WRITE_COALESCE_MS = 300

/** The maximum number of conversations' worth of drafts kept per user in durable storage. */
export const MAX_STORED_DRAFTS = 50

export interface StoredDraft {
  text: string
  savedAt: number
}

/** A user's drafts, keyed by the same per-place storage key used for the in-session draft map. */
export type StoredDraftsMap = Record<string, StoredDraft>

function draftsStorageKey(userId: SbUserId): string {
  return `${userId}|chatDrafts`
}

function readDraftsMap(userId: SbUserId): StoredDraftsMap {
  try {
    const json = localStorage.getItem(draftsStorageKey(userId))
    if (json === null) {
      return {}
    }

    const parsed = JSON.parse(json)
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch (err) {
    logger.error(`error reading chat drafts: ${getErrorStack(err)}`)
    return {}
  }
}

function writeDraftsMap(userId: SbUserId, drafts: StoredDraftsMap): void {
  try {
    localStorage.setItem(draftsStorageKey(userId), JSON.stringify(drafts))
  } catch (err) {
    logger.error(`error writing chat drafts: ${getErrorStack(err)}`)
  }
}

/**
 * Returns a copy of `drafts` with `key`'s entry set to `{ text, savedAt }`, or removed if `text`
 * is empty (an empty draft is never stored, whether it's new or clearing an existing one). Any
 * other empty entries are dropped as well, and the result is capped to `MAX_STORED_DRAFTS` places,
 * evicting the entries with the oldest `savedAt` first.
 */
export function withDraftUpdate(
  drafts: StoredDraftsMap,
  key: string,
  text: string,
  savedAt: number,
): StoredDraftsMap {
  const next: StoredDraftsMap = {}
  for (const [k, v] of Object.entries(drafts)) {
    if (k !== key && v.text) {
      next[k] = v
    }
  }
  if (text) {
    next[key] = { text, savedAt }
  }

  const entries = Object.entries(next)
  if (entries.length <= MAX_STORED_DRAFTS) {
    return next
  }

  entries.sort((a, b) => b[1].savedAt - a[1].savedAt)
  return Object.fromEntries(entries.slice(0, MAX_STORED_DRAFTS))
}

/**
 * Resolves the initial value a conversation's message input should hydrate with: the in-session
 * value (if this conversation was already visited earlier in the session) takes precedence over
 * the durable copy from a previous session, which takes precedence over the default.
 */
export function resolveInitialDraftValue(
  inSessionValue: string | undefined,
  storedValue: string | undefined,
  defaultValue: string,
): string {
  return inSessionValue ?? storedValue ?? defaultValue
}

/** Reads the durably-stored draft text for `userId`/`key`, or `undefined` if none is stored. */
export function getStoredDraft(userId: SbUserId, key: string): string | undefined {
  return readDraftsMap(userId)[key]?.text
}

interface PendingWrite {
  userId: SbUserId
  key: string
  text: string
  timer: ReturnType<typeof setTimeout>
}

const pendingWrites = new Map<string, PendingWrite>()

function pendingWriteKey(userId: SbUserId, key: string): string {
  return `${userId}|${key}`
}

function commitWrite(pending: PendingWrite): void {
  const drafts = readDraftsMap(pending.userId)
  const updated = withDraftUpdate(drafts, pending.key, pending.text, Date.now())
  writeDraftsMap(pending.userId, updated)
}

/**
 * Schedules `text` to be persisted as the draft for `userId`/`key`, coalescing rapid updates (e.g.
 * a burst of keystrokes) into a single write `DRAFT_WRITE_COALESCE_MS` after the last one. An
 * empty `text` removes the stored draft rather than persisting an empty string.
 */
export function scheduleDraftWrite(userId: SbUserId, key: string, text: string): void {
  const pendingKey = pendingWriteKey(userId, key)
  const existing = pendingWrites.get(pendingKey)
  if (existing) {
    clearTimeout(existing.timer)
  }

  const timer = setTimeout(() => {
    const pending = pendingWrites.get(pendingKey)
    if (pending) {
      pendingWrites.delete(pendingKey)
      commitWrite(pending)
    }
  }, DRAFT_WRITE_COALESCE_MS)

  pendingWrites.set(pendingKey, { userId, key, text, timer })
}

/**
 * Immediately persists a pending draft write scheduled for `userId`/`key` by `scheduleDraftWrite`,
 * cancelling its timer. Meant to be called when a conversation's input is about to go away
 * (unmount, app close) so a keystroke that landed just before that isn't lost.
 */
export function flushDraftWrite(userId: SbUserId, key: string): void {
  const pendingKey = pendingWriteKey(userId, key)
  const pending = pendingWrites.get(pendingKey)
  if (!pending) {
    return
  }

  clearTimeout(pending.timer)
  pendingWrites.delete(pendingKey)
  commitWrite(pending)
}

/** Clears all pending draft writes without persisting them. Only for use in tests. */
export function resetDraftStorageForTesting(): void {
  for (const pending of pendingWrites.values()) {
    clearTimeout(pending.timer)
  }
  pendingWrites.clear()
}
