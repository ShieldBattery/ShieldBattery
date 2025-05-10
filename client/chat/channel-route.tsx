import React from 'react'
import { Route, RouteProps } from 'wouter'
import { SbChannelId, makeSbChannelId } from '../../common/chat'
import { replace } from '../navigation/routing'

export function ChannelRoute({
  component: Component,
  ...rest
}: Omit<RouteProps, 'component'> & {
  component: React.ComponentType<{ channelId: SbChannelId; channelName: string }>
}) {
  return (
    <Route<{ channelId: string; channelName: string }> {...rest}>
      {params => {
        const channelIdNum = Number(params.channelId)
        if (isNaN(channelIdNum)) {
          replace('/')
          return null
        }

        return (
          <Component channelId={makeSbChannelId(channelIdNum)} channelName={params.channelName} />
        )
      }}
    </Route>
  )
}
