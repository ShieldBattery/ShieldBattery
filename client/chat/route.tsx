import React, { Suspense } from 'react'
import { Route, RouteProps, Switch } from 'wouter'
import { SbChannelId, makeSbChannelId } from '../../common/chat.js'
import { useHasAnyPermission } from '../admin/admin-permissions.js'
import { NoPermissionsPage } from '../auth/no-permissions-page.js'
import { replace } from '../navigation/routing.js'
import { LoadingDotsArea } from '../progress/dots.js'
import { ChannelList } from './channel-list.js'
import { ConnectedChatChannel } from './channel.js'
import { CreateChannel } from './create-channel.js'

const LoadableChatAdminComponent = React.lazy(async () => ({
  default: (await import('./admin/index.js')).ChatAdmin,
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
  const isAdmin = useHasAnyPermission('moderateChatChannels')

  return (
    <Suspense fallback={<LoadingDotsArea />}>
      <Switch>
        <Route path='/chat/admin/*?'>
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
