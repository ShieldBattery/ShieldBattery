import { SbUserId } from '../../common/users/sb-user-id'

/**
 * Publish/subscribe channel for whispers that should be echoed into whatever chat surface is
 * currently mounted, rather than stored as state.
 *
 * The echo is a one-shot display event: it's meant for whichever surface happens to be on screen
 * when the whisper arrives, it's never persisted, and a surface that wasn't mounted to see it
 * never gets a second chance. Keeping it in Redux or a jotai atom would need an explicit
 * "consumed" or expiry step to get that same one-shot behavior; a subscription gives it for free
 * by simply not remembering anything between publishes.
 */
export interface WhisperEcho {
  /** When the server recorded the whisper. */
  time: number
  direction: 'incoming' | 'outgoing'
  /**
   * The other user in the conversation: the sender of an incoming whisper, the recipient of an
   * outgoing one.
   */
  counterpartId: SbUserId
  text: string
  /** Present and `true` for an action line sent with `/me`. Never carried as `false`. */
  emote?: boolean
}

export type WhisperEchoListener = (echo: WhisperEcho) => void

const listeners = new Set<WhisperEchoListener>()

/** Starts receiving every whisper that arrives from now on; returns a function that stops it. */
export function subscribeToWhisperEchoes(listener: WhisperEchoListener): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/**
 * Hands a whisper to whatever is currently listening. Nothing is kept for later listeners: a
 * whisper nobody was there to show is only ever seen in its conversation.
 */
export function publishWhisperEcho(echo: WhisperEcho): void {
  // Iterate a copy so a listener that unsubscribes (its own or another's) while this dispatch is
  // in progress can't disturb the listeners still owed a call.
  for (const listener of Array.from(listeners)) {
    listener(echo)
  }
}
