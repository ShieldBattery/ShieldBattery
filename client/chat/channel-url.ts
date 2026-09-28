import { makeSbChannelId, SbChannelId } from '../../common/chat'
import { isPrettyId } from '../../common/pretty-id'
import { urlPath } from '../../common/urls'
import { isMessageLinkId, MESSAGE_LINK_PARAM } from '../messaging/message-link'

/**
 * Stand-in for a channel's name in its URL when the name isn't known. The route needs something in
 * that segment, and the name is corrected in place once the channel's info is available.
 */
const UNKNOWN_CHANNEL_NAME = '_'

/** Returns the URL for a chat channel. */
export function urlForChannel(channelId: SbChannelId, channelName: string | undefined): string {
  return urlPath`/chat/${channelId}/${channelName || UNKNOWN_CHANNEL_NAME}`
}

/**
 * Returns the URL for a chat channel that points at one of its messages. Opening it moves the
 * message list to that message, wherever in the channel's history it sits.
 */
export function urlForChannelMessage(
  channelId: SbChannelId,
  channelName: string | undefined,
  messageId: string,
): string {
  const params = new URLSearchParams({ [MESSAGE_LINK_PARAM]: messageId })
  return `${urlForChannel(channelId, channelName)}?${params}`
}

/** A channel message link's target: the channel it's in and the message it points at. */
export interface ChannelMessageLinkTarget {
  channelId: SbChannelId
  messageId: string
}

/**
 * Returns the channel and message a channel message link points at, or undefined if `url` isn't
 * one: its pathname must be `/chat/<channelId>/<name>` (the name segment is ignored — the id is
 * authoritative, and a stale or placeholder name gets corrected in place once the channel page
 * loads the real one), and it must carry a {@link MESSAGE_LINK_PARAM} search param that looks like
 * a UUID. Doesn't check the URL's origin; callers that only want ShieldBattery's own links (as
 * opposed to some other site that happens to have a `/chat/...` path) must check that themselves.
 */
export function channelMessageFromUrl(url: URL): ChannelMessageLinkTarget | undefined {
  const segments = url.pathname.split('/').filter(segment => segment.length > 0)
  if (segments.length < 2 || segments[0] !== 'chat' || !/^\d+$/.test(segments[1])) {
    return undefined
  }

  const channelId = Number(segments[1])
  if (!Number.isSafeInteger(channelId) || channelId <= 0) {
    return undefined
  }

  const messageId = url.searchParams.get(MESSAGE_LINK_PARAM)
  if (!messageId || !isMessageLinkId(messageId)) {
    return undefined
  }

  return { channelId: makeSbChannelId(channelId), messageId }
}

/** Returns the path of a private channel's invite link with the given token. */
export function urlForChannelInvite(token: string): string {
  return urlPath`/chat/invite/${token}`
}

/**
 * Returns the token of the invite link `pathname` is the path of, or undefined if it isn't one: it
 * must be exactly `/chat/invite/<token>`, with a token shaped like one.
 */
export function channelInviteTokenFromPath(pathname: string): string | undefined {
  const segments = pathname.split('/').filter(segment => segment.length > 0)
  if (
    segments.length !== 3 ||
    segments[0] !== 'chat' ||
    segments[1] !== 'invite' ||
    !isPrettyId(segments[2])
  ) {
    return undefined
  }

  return segments[2]
}
