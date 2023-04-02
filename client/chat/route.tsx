import React, { Suspense } from 'react'
import { Route, RouteProps, Switch } from 'wouter'
import { makeSbChannelId, SbChannelId } from '../../common/chat'
import { hasAnyPermission } from '../admin/admin-permissions'
import { replace } from '../navigation/routing'
import { LoadingDotsArea } from '../progress/dots'
import { useAppSelector } from '../redux-hooks'
import { ConnectedChatChannel } from './channel'
import { ChannelList } from './channel-list'

const LoadableChatAdmin = React.lazy(async () => ({
  default: (await import('./admin')).ChatAdmin,
}))

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
          queueMicrotask(() => {
            replace('/')
          })
          return null
        }

        return (
          <Component channelId={makeSbChannelId(channelIdNum)} channelName={params.channelName} />
        )
      }}
    </Route>
  )
}

export function ChannelRouteComponent(props: { params: any }) {
  // TODO(2Pac): Add a separate permission for managing chat channels
  const isAdmin = useAppSelector(s => hasAnyPermission(s.auth, 'moderateChatChannels'))

  return (
    <Suspense fallback={<LoadingDotsArea />}>
      <Switch>
        {isAdmin ? <Route path='/chat/admin/:rest*' component={LoadableChatAdmin} /> : <></>}
        <ChannelRoute path='/chat/:channelId/:channelName' component={ConnectedChatChannel} />
        <Route component={ChannelList} />
      </Switch>
    </Suspense>
  )
}
