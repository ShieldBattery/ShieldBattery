import { getErrorStack } from '../../common/errors'
import { SbUserId } from '../../common/users/sb-user-id'
import logger from '../logging/logger'
import { CHAT_ANCHOR_MAX_AGE_MS, ChatViewAnchor, chatViewAnchorStore } from './chat-view-anchor'

/**
 * The maximum number of conversations' worth of reading positions kept per user in durable
 * storage. Only conversations left away from their newest messages take up a slot, so this reaches
 * much further back than the number of conversations a session touches.
 */
export const MAX_STORED_RESTORE_PLACES = 20

/** A conversation's reading position, as it survives a reload or an app restart. */
export interface StoredChatRestore {
  anchor: ChatViewAnchor
  /**
   * The unread divider the user hadn't caught up with, if there was one. It's only ever stored
   * next to a position: a divider the read position has already passed is consumed the moment its
   * conversation opens at the newest messages, so one with no position to return to would be gone
   * before it could be seen.
   */
  unreadLineTime?: number
  savedAt: number
}

/**
 * A user's stored reading positions, keyed by the same per-place key the in-memory store and the
 * message input's drafts use.
 */
export type StoredChatRestoreMap = Record<string, StoredChatRestore>

function restoreStorageKey(userId: SbUserId): string {
  return `${userId}|chatRestore`
}

function readRestoreMap(userId: SbUserId): StoredChatRestoreMap {
  try {
    const json = localStorage.getItem(restoreStorageKey(userId))
    if (json === null) {
      return {}
    }

    const parsed = JSON.parse(json)
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch (err) {
    logger.error(`error reading chat reading positions: ${getErrorStack(err)}`)
    return {}
  }
}

function writeRestoreMap(userId: SbUserId, positions: StoredChatRestoreMap): void {
  try {
    localStorage.setItem(restoreStorageKey(userId), JSON.stringify(positions))
  } catch (err) {
    logger.error(`error writing chat reading positions: ${getErrorStack(err)}`)
  }
}

/**
 * Returns a copy of `positions` with `key`'s entry set to `entry`, or removed when there's nothing
 * to store for it (a conversation left at its newest messages opens there anyway). Entries that
 * have outlived a reading position's usefulness are dropped along the way, as are any that carry
 * no position at all, and the result is capped to `MAX_STORED_RESTORE_PLACES` conversations,
 * evicting the ones saved longest ago first.
 */
export function withRestoreUpdate(
  positions: StoredChatRestoreMap,
  key: string,
  entry: Omit<StoredChatRestore, 'savedAt'> | undefined,
  savedAt: number,
): StoredChatRestoreMap {
  const next: StoredChatRestoreMap = {}
  for (const [k, v] of Object.entries(positions)) {
    if (k !== key && v?.anchor && savedAt - v.savedAt <= CHAT_ANCHOR_MAX_AGE_MS) {
      next[k] = v
    }
  }
  if (entry) {
    next[key] = { ...entry, savedAt }
  }

  const entries = Object.entries(next)
  if (entries.length <= MAX_STORED_RESTORE_PLACES) {
    return next
  }

  entries.sort((a, b) => b[1].savedAt - a[1].savedAt)
  return Object.fromEntries(entries.slice(0, MAX_STORED_RESTORE_PLACES))
}

/**
 * Returns `key`'s stored entry if it's still worth returning to: it has to carry a position, and
 * it stops naming a place worth going back to once it has outlived a reading position's lifetime,
 * exactly as the in-memory store treats its own entries.
 */
export function getFreshStoredRestore(
  positions: StoredChatRestoreMap,
  key: string,
  now: number,
): StoredChatRestore | undefined {
  const stored = positions[key]
  if (!stored?.anchor || now - stored.savedAt > CHAT_ANCHOR_MAX_AGE_MS) {
    return undefined
  }

  return stored
}

/**
 * Decides which reading position opening a conversation should use: the one this session already
 * holds, if any, otherwise the durably-stored one. Returns the position to bring back into memory,
 * or nothing when memory is already ahead (its position is from this session and so the newer of
 * the two) or when there's nothing stored worth restoring.
 */
export function resolveRestoreHydration(
  inMemoryAnchor: ChatViewAnchor | undefined,
  stored: StoredChatRestore | undefined,
): ChatViewAnchor | undefined {
  return inMemoryAnchor === undefined ? stored?.anchor : undefined
}

/**
 * Copies a conversation's current in-memory reading position into durable storage for `userId`,
 * along with the unread divider the user hadn't caught up with. A conversation holding no position
 * in memory — one left at its newest messages — has its stored entry removed instead. The position
 * this reads is the one the message list records as it goes away, so this belongs after that: on
 * the conversation's own teardown, or once the list has saved for a page that's unloading.
 */
export function saveStoredChatRestore(
  userId: SbUserId,
  placeKey: string,
  unreadLineTime: number | undefined,
): void {
  const anchor = chatViewAnchorStore.get(placeKey)
  const entry = anchor ? { anchor, unreadLineTime } : undefined

  writeRestoreMap(userId, withRestoreUpdate(readRestoreMap(userId), placeKey, entry, Date.now()))
}

/**
 * Brings a conversation's durably-stored reading position into the in-memory store, unless this
 * session is already holding one for it. Everything that goes looking for a position calls this
 * first, so it has to be safe to repeat: once memory holds a position, further calls change
 * nothing. Nobody signed in means there's no store to read from.
 */
export function hydrateStoredChatAnchor(userId: SbUserId | undefined, placeKey: string): void {
  if (userId === undefined) {
    return
  }

  const anchor = resolveRestoreHydration(
    chatViewAnchorStore.get(placeKey),
    getFreshStoredRestore(readRestoreMap(userId), placeKey, Date.now()),
  )
  if (anchor) {
    chatViewAnchorStore.set(placeKey, anchor)
  }
}

/**
 * The unread divider stored alongside a conversation's durable reading position, for an activation
 * to bring back together with it. A divider without a position to return to would be consumed as
 * soon as the conversation opened, which is why the two are only ever stored together.
 */
export function getStoredRestoreUnreadLineTime(
  userId: SbUserId | undefined,
  placeKey: string,
): number | undefined {
  if (userId === undefined) {
    return undefined
  }

  return getFreshStoredRestore(readRestoreMap(userId), placeKey, Date.now())?.unreadLineTime
}
