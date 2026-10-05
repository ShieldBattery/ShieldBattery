import { SbChannelId } from '../../common/chat'
import { getErrorStack } from '../../common/errors'
import logger from '../logging/logger'
import { getServerOrigin } from '../network/server-url'
import { urlForChannel } from './channel-url'

/**
 * Copies a public channel's link to the clipboard. Private channels are shared through invite
 * links instead, since their plain URL only works for members.
 */
export function copyChannelLink(channelId: SbChannelId, channelName: string) {
  navigator.clipboard
    .writeText(getServerOrigin() + urlForChannel(channelId, channelName))
    .catch(err => logger.error(`Error writing to clipboard: ${getErrorStack(err)}`))
}
