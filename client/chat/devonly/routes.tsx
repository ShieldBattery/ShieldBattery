import React from 'react'
import { Link, Route, Switch } from 'wouter'
import { ChannelInfoCardTest } from './channel-info-card-test'

export function DevChat() {
  return (
    <Switch>
      <Route path='/dev/chat/info-card' component={ChannelInfoCardTest} />
      <Route>
        <ul>
          <li>
            <Link href='/dev/chat/info-card'>Channel info card</Link>
          </li>
        </ul>
      </Route>
    </Switch>
  )
}
