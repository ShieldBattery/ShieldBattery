import React from 'react'
import { Switch } from 'wouter'
import { useHasAnyPermission } from '../../admin/admin-permissions.js'
import { NoPermissionsPage } from '../../auth/no-permissions-page.js'
import { ChannelRoute } from '../route.js'
import { AdminChannelView } from './channel-view.js'

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
