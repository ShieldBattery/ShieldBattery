import { createContext } from 'react'
import { makeSbChannelId, SbChannelId } from '../../common/chat'

export interface ChannelContextValue {
  /** The ID of the channel that is currently being displayed. */
  channelId: SbChannelId
}

export const ChannelContext = createContext<ChannelContextValue>({
  channelId: makeSbChannelId(0),
})
