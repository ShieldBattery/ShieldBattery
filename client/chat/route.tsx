import React, { Suspense } from 'react'
import { Route, RouteProps, Switch } from 'wouter'
import { SbChannelId, makeSbChannelId } from '../../common/chat'
import { hasAnyPermission } from '../admin/admin-permissions'
import { NoPermissionsPage } from '../auth/no-permissions-page'
import { replace } from '../navigation/routing'
import { LoadingDotsArea } from '../progress/dots'
import { useAppSelector } from '../redux-hooks'
import { ConnectedChatChannel } from './channel'
import { ChannelList } from './channel-list'
import { CreateChannel } from './create-channel'

const LoadableChatAdminComponent = React.lazy(async () => ({
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
  const isAdmin = useAppSelector(s => hasAnyPermission(s.auth, 'moderateChatChannels'))

  return (
    <Suspense fallback={<LoadingDotsArea />}>
      <Switch>
        <Route path='/chat/admin/:rest*'>
          {isAdmin ? <LoadableChatAdminComponent /> : <NoPermissionsPage />}
        </Route>
        <Route path='/chat/new' component={CreateChannel} />
        <Route path='/chat/list' component={ChannelList} />
        <ChannelRoute path='/chat/:channelId/:channelName' component={ConnectedChatChannel} />
        <Route component={ChannelList} />
      </Switch>
    </Suspense>
  )
}
