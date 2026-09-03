import { urlPath } from '../../common/urls'
import { SbUserId } from '../../common/users/sb-user-id'
import { isMessageLinkId, MESSAGE_LINK_PARAM } from '../messaging/message-link'

/** Returns the URL for a whisper conversation with a particular user. */
export function urlForWhisper(targetId: SbUserId, targetName: string): string {
  return urlPath`/whispers/${targetId}/${targetName}`
}

/**
 * The path segment a whisper message link carries in place of the target user id a normal whisper
 * URL has there. User ids are numeric, so this segment can never collide with one -- but the
 * message-link route still has to be matched ahead of the generic whisper route, since a router
 * matching purely on shape (a literal path segment, then another) can't tell the two apart on its
 * own.
 */
export const WHISPER_MESSAGE_LINK_SEGMENT = 'm'

/**
 * Returns the shareable, viewer-independent URL for a whisper message. A whisper URL normally names
 * one specific pair of participants, so a link built from either of their sides would point anyone
 * else who opened it at the wrong conversation (or at none at all); this form instead names only
 * the message; opening it resolves which of the opener's own whispers the message belongs to and
 * redirects to the normal whisper URL for that conversation.
 */
export function urlForWhisperMessageLink(messageId: string): string {
  return urlPath`/whispers/${WHISPER_MESSAGE_LINK_SEGMENT}/${messageId}`
}

/**
 * Returns the URL for a whisper conversation that points at one of its messages, for the
 * conversation's own participant to open: unlike {@link urlForWhisperMessageLink}, this URL is
 * relative to whichever participant follows it and is not meant to be shared.
 */
export function urlForWhisperMessage(
  targetId: SbUserId,
  targetName: string,
  messageId: string,
): string {
  const params = new URLSearchParams({ [MESSAGE_LINK_PARAM]: messageId })
  return `${urlForWhisper(targetId, targetName)}?${params}`
}

/** A whisper message link's target: the message it points at. */
export interface WhisperMessageLinkTarget {
  messageId: string
}

/**
 * Returns the message a whisper message link points at, or undefined if `url` isn't one: its
 * pathname must be exactly `/whispers/${WHISPER_MESSAGE_LINK_SEGMENT}/<id>`, where `<id>` looks
 * like a UUID. Doesn't check the URL's origin; callers that only want ShieldBattery's own links (as
 * opposed to some other site that happens to have a `/whispers/...` path) must check that
 * themselves.
 */
export function whisperMessageFromUrl(url: URL): WhisperMessageLinkTarget | undefined {
  const segments = url.pathname.split('/').filter(segment => segment.length > 0)
  if (
    segments.length !== 3 ||
    segments[0] !== 'whispers' ||
    segments[1] !== WHISPER_MESSAGE_LINK_SEGMENT
  ) {
    return undefined
  }

  const messageId = segments[2]
  if (!isMessageLinkId(messageId)) {
    return undefined
  }

  return { messageId }
}
