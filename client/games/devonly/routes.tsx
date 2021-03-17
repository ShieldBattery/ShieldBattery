import React from 'react'
import { Link, Route, Switch } from 'wouter'
import { ResultsTest } from './results-test'

const BASE_URL = '/dev/games'

class DevGamesDashboard extends React.Component {
  render() {
    return (
      <ul>
        <li>
          <Link href={`${BASE_URL}/results`}>Game results</Link>
        </li>
      </ul>
    )
  }
}

export function DevGames() {
  return (
    <Switch>
      <Route path={`${BASE_URL}/results`} component={ResultsTest} />
      <Route>
        <DevGamesDashboard />
      </Route>
    </Switch>
  )
}
