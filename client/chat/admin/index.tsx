import { Switch } from 'wouter'
import { useHasAnyPermission } from '../../admin/admin-permissions'
import { NoPermissionsPage } from '../../auth/no-permissions-page'
import { ChannelRoute } from '../channel-route'
import { AdminChannelView } from './channel-view'

export function ChatAdmin() {
  const canModerateChannels = useHasAnyPermission('moderateChatChannels')

  return (
    <Switch>
      <ChannelRoute
        path='/chat/admin/:channelId/:channelName/view'
        component={canModerateChannels ? AdminChannelView : NoPermissionsPage}
      />
    </Switch>
  )
}
