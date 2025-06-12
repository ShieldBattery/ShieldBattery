import { lazy, Suspense } from 'react'
import { Route, Switch } from 'wouter'
import { useHasAnyPermission } from '../admin/admin-permissions'
import { redirectToLogin, useIsLoggedIn } from '../auth/auth-utils'
import { NoPermissionsPage } from '../auth/no-permissions-page'
import { LoadingDotsArea } from '../progress/dots'
import { ConnectedChatChannel } from './channel'
import { ChannelList } from './channel-list'
import { ChannelRoute } from './channel-route'
import { CreateChannel } from './create-channel'

const LoadableChatAdminComponent = lazy(async () => ({
  default: (await import('./admin')).ChatAdmin,
}))

export function ChannelRouteComponent(props: { params: any }) {
  const isLoggedIn = useIsLoggedIn()
  const isAdmin = useHasAnyPermission('moderateChatChannels')

  if (!isLoggedIn) {
    redirectToLogin()
    return undefined
  }

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
