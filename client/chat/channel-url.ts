import { makeSbChannelId, SbChannelId } from '../../common/chat'
import { urlPath } from '../../common/urls'

/**
 * Stand-in for a channel's name in its URL when the name isn't known. The route needs something in
 * that segment, and the name is corrected in place once the channel's info is available.
 */
const UNKNOWN_CHANNEL_NAME = '_'

/**
 * Name of the query param that points a channel URL at one particular message in the channel.
 * Reading and writing it must go through this name so a link and the page that consumes it can't
 * disagree.
 */
export const MESSAGE_LINK_PARAM = 'm'

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

/** Matches a UUID's `8-4-4-4-12` hex layout, case-insensitively. */
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

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
  if (!messageId || !UUID_PATTERN.test(messageId)) {
    return undefined
  }

  return { channelId: makeSbChannelId(channelId), messageId }
}
