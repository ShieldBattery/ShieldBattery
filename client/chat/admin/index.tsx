import React from 'react'
import { Route, Switch } from 'wouter'
import { useHasAnyPermission } from '../../admin/admin-permissions'
import { NoPermissionsPage } from '../../auth/no-permissions-page'
import { ChannelRoute } from '../route'
import { AdminChannelContent } from './channel-content'
import { AdminChannelView } from './channel-view'

export function ChatAdmin() {
  const canManageChannelContent = useHasAnyPermission('manageChannelContent')
  const canModerateChannels = useHasAnyPermission('moderateChatChannels')

  return (
    <Switch>
      {canManageChannelContent ? (
        <Route path='/chat/admin/channel-content/:rest*' component={AdminChannelContent} />
      ) : (
        <NoPermissionsPage />
      )}
      {canModerateChannels ? (
        <ChannelRoute
          path='/chat/admin/:channelId/:channelName/view'
          component={AdminChannelView}
        />
      ) : (
        <NoPermissionsPage />
      )}
    </Switch>
  )
}
