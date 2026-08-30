import { createViewStateStore } from '../navigation/view-state-store'
import { isServerOriginMessage, SbMessage } from './message-records'

/**
 * How long a saved reading position stays usable. A place in a conversation keeps its meaning
 * longer than a list's scroll offset does, but not indefinitely: coming back much later, the newest
 * messages are the interesting ones.
 */
const ANCHOR_MAX_AGE_MS = 45 * 60 * 1000

/** Attribute carrying a message's id on the element that renders it. */
export const MESSAGE_ID_ATTRIBUTE = 'data-message-id'

/** Where in a conversation a message list was sitting when the user left it. */
export interface ChatViewAnchor {
  /** Id of the message the position is measured against. */
  messageId: string
  /**
   * Server-recorded time of the anchor message, in epoch millis. It outlives the message itself
   * being deleted, and locates the position in a window that has to be fetched again.
   */
  sentTime: number
  /**
   * How far the top of the anchor message sits below the top of the viewport, in pixels. Negative
   * when the message starts above the viewport.
   */
  offsetPx: number
}

/**
 * Reading positions for conversations the user has left, keyed by the same per-place key the
 * message input keys its drafts by. A place with no entry is one that was left at the bottom, which
 * needs no restoring: message lists open there anyway.
 */
export const chatViewAnchorStore = createViewStateStore<ChatViewAnchor>('chat-anchor', {
  maxAgeMs: ANCHOR_MAX_AGE_MS,
})

/**
 * Reads a reading position out of a message list's scroller: the topmost message that's at least
 * partially in view, and where its top sits relative to the top of the viewport. Messages whose
 * time the server never recorded are passed over — a position measured against one of those
 * couldn't be found again in a window that has to be fetched. Returns undefined when the list holds
 * nothing that can be anchored to.
 */
export function captureChatViewAnchor(
  scroller: HTMLElement,
  messages: ReadonlyArray<SbMessage>,
): ChatViewAnchor | undefined {
  // Positions are read as rects rather than offsets because a message's offset parent isn't
  // guaranteed to be the scroller.
  const scrollerTop = scroller.getBoundingClientRect().top

  for (const element of scroller.querySelectorAll<HTMLElement>(`[${MESSAGE_ID_ATTRIBUTE}]`)) {
    const rect = element.getBoundingClientRect()
    if (rect.bottom <= scrollerTop) {
      continue
    }

    const messageId = element.getAttribute(MESSAGE_ID_ATTRIBUTE)!
    const message = messages.find(m => m.id === messageId)
    if (!message || !isServerOriginMessage(message)) {
      continue
    }

    return { messageId, sentTime: message.time, offsetPx: rect.top - scrollerTop }
  }

  return undefined
}

/** How a saved reading position can be reached from a particular window of loaded messages. */
export type ChatViewPlacement =
  /** Put the named message's top `offsetPx` below the top of the viewport. */
  | { kind: 'message'; messageId: string; offsetPx: number }
  /** The position sits before the window, which has to be replaced by one that covers it. */
  | { kind: 'fetch' }
  /** Everything loaded predates the position, so the bottom of the window is as close as it gets. */
  | { kind: 'bottom' }

/**
 * Works out how to reach a saved reading position within a window of loaded messages. The anchor
 * message itself is preferred; failing that (it was deleted, say), the first message sent at or
 * after the same time stands in for it, at the top of the viewport.
 */
export function findChatViewPlacement(
  messages: ReadonlyArray<SbMessage>,
  anchor: ChatViewAnchor,
): ChatViewPlacement {
  if (messages.some(m => m.id === anchor.messageId)) {
    return { kind: 'message', messageId: anchor.messageId, offsetPx: anchor.offsetPx }
  }

  const serverMessages = messages.filter(isServerOriginMessage)
  if (!serverMessages.length || anchor.sentTime < serverMessages[0].time) {
    return { kind: 'fetch' }
  }

  const standIn = serverMessages.find(m => m.time >= anchor.sentTime)
  return standIn ? { kind: 'message', messageId: standIn.id, offsetPx: 0 } : { kind: 'bottom' }
}

/**
 * Whether reaching a saved reading position takes loading a window of messages around it, because
 * what's loaded doesn't reach back that far.
 */
export function anchorNeedsFetch(
  messages: ReadonlyArray<SbMessage>,
  anchor: ChatViewAnchor,
): boolean {
  return findChatViewPlacement(messages, anchor).kind === 'fetch'
}

/**
 * Scrolls a message list so the top of the given message sits `offsetPx` below the top of the
 * viewport. Returns whether the message was there to scroll to.
 */
export function scrollToAnchoredMessage(
  scroller: HTMLElement,
  messageId: string,
  offsetPx: number,
): boolean {
  const element = scroller.querySelector<HTMLElement>(
    `[${MESSAGE_ID_ATTRIBUTE}="${CSS.escape(messageId)}"]`,
  )
  if (!element) {
    return false
  }

  const scrollerTop = scroller.getBoundingClientRect().top
  const elementTop = element.getBoundingClientRect().top
  scroller.scrollTop += elementTop - scrollerTop - offsetPx
  return true
}
