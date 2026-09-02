import { SbChannelId } from '../../common/chat'
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
