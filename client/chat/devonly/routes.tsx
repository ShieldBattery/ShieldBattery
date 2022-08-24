import React from 'react'
import { Link, Route, Switch } from 'wouter'
import { ChannelStatusCardTest } from './channel-status-card-test'

export function DevChat() {
  return (
    <Switch>
      <Route path='/dev/chat/status-card' component={ChannelStatusCardTest} />
      <Route>
        <ul>
          <li>
            <Link href='/dev/chat/status-card'>Channel status card</Link>
          </li>
        </ul>
      </Route>
    </Switch>
  )
}
