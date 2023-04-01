import { useCallback } from 'react'
import {
  BasicChannelInfo,
  DetailedChannelInfo,
  JoinedChannelInfo,
  SbChannelId,
} from '../../common/chat'
import { RootState } from '../root-reducer'

/**
 * Combined (and flattened) channel data that simplifies the usage in React components.
 */
export type ClientChannelInfo = BasicChannelInfo &
  Partial<DetailedChannelInfo> &
  Partial<JoinedChannelInfo>

/**
 * Returns a function for use with `useAppSelector` that finds all the available information about
 * the given `channelId` in store, and returns a combined and flattened object for easier use in
 * React components.
 */
export function useChannelInfoSelector(channelId: SbChannelId) {
  return useCallback(
    (state: RootState): ClientChannelInfo | undefined => {
      const basicChannelInfo = state.chat.idToBasicInfo.get(channelId)
      const detailedChannelInfo = state.chat.idToDetailedInfo.get(channelId)
      const joinedChannelInfo = state.chat.idToJoinedInfo.get(channelId)

      if (!basicChannelInfo) {
        return undefined
      }

      let channelInfo: ClientChannelInfo = {
        ...basicChannelInfo,
      }

      if (detailedChannelInfo) {
        channelInfo = {
          ...channelInfo,
          ...detailedChannelInfo,
        }
      }
      if (joinedChannelInfo) {
        channelInfo = {
          ...channelInfo,
          ...joinedChannelInfo,
        }
      }

      return channelInfo
    },
    [channelId],
  )
}
