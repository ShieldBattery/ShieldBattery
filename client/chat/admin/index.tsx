import React from 'react'
import { Switch } from 'wouter'
import { ChannelRoute } from '../route'
import { AdminChannelView } from './channel-view'

export function ChatAdmin() {
  return (
    <Switch>
      <ChannelRoute path='/chat/admin/:channelId/:channelName/view' component={AdminChannelView} />
    </Switch>
  )
}
