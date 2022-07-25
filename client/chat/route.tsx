import React from 'react'
import { useRoute } from 'wouter'
import { makeSbChannelId } from '../../common/chat'
import { replace } from '../navigation/routing'
import { ConnectedChatChannel } from './channel'

export function ChannelRouteComponent(props: { params: any }) {
  const [matches, params] = useRoute<{ channelId: string; channelName: string }>(
    '/chat/:channelId/:channelName',
  )

  if (!matches) {
    queueMicrotask(() => {
      replace('/')
    })
    return null
  }
  const channelIdNum = Number(params!.channelId)
  if (isNaN(channelIdNum)) {
    queueMicrotask(() => {
      replace('/')
    })
    return null
  }

  return (
    <ConnectedChatChannel
      channelId={makeSbChannelId(channelIdNum)}
      channelName={params!.channelName}
    />
  )
}
