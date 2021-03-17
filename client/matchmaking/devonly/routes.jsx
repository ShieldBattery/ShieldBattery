import React from 'react'
import { Link, Route, Switch } from 'wouter'

import MatchTest from './match-test'

const BASE_URL = '/dev/matchmaking'

class DevMatchmakingDashboard extends React.Component {
  render() {
    return (
      <ul>
        <li>
          <Link href={`${BASE_URL}/match`}>Matchmaking match</Link>
        </li>
      </ul>
    )
  }
}

export default () => {
  return (
    <Switch>
      <Route path={`${BASE_URL}/match`} component={MatchTest} />
      <Route>
        <DevMatchmakingDashboard />
      </Route>
    </Switch>
  )
}
