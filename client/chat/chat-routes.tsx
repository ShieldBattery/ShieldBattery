import { lazy, Suspense } from 'react'
import { Route, Switch } from 'wouter'
import { useHasAnyPermission } from '../admin/admin-permissions'
import { useRequireLogin } from '../auth/auth-utils'
import { NoPermissionsPage } from '../auth/no-permissions-page'
import { LoadingDotsArea } from '../progress/dots'
import { ConnectedChatChannel } from './channel'
import { ChannelInvitePage } from './channel-invite-page'
import { ChannelList } from './channel-list'
import { ChannelRoute } from './channel-route'
import { CreateChannel } from './create-channel'

const LoadableChatAdminComponent = lazy(async () => ({
  default: (await import('./admin')).ChatAdmin,
}))

export function ChannelRouteComponent(props: { params: any }) {
  const isRedirecting = useRequireLogin()
  const isAdmin = useHasAnyPermission('moderateChatChannels')

  if (isRedirecting) {
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
        {/* Must come before the channel route, which would otherwise take `invite` for an id. */}
        <Route path='/chat/invite/:token' component={ChannelInvitePage} />
        <ChannelRoute path='/chat/:channelId/:channelName' component={ConnectedChatChannel} />
        <Route component={ChannelList} />
      </Switch>
    </Suspense>
  )
}
