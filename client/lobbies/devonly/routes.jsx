import { Component } from 'react'
import { Link, Route, Switch } from 'wouter'
import { LobbyLandingTest } from './lobby-landing-test'
import LobbyTest from './lobby-test'
import RacePickerTest from './race-picker-test'

const BASE_URL = '/dev/lobbies'

class DevLobbiesDashboard extends Component {
  render() {
    return (
      <ul>
        <li>
          <Link href={`${BASE_URL}/lobby`}>Lobby component</Link>
        </li>
        <li>
          <Link href={`${BASE_URL}/race-picker`}>Race picker component</Link>
        </li>
        <li>
          <Link href={`${BASE_URL}/lobby-landing`}>Lobby landing page</Link>
        </li>
      </ul>
    )
  }
}

export default () => {
  return (
    <Switch>
      <Route path={`${BASE_URL}/lobby`} component={LobbyTest} />
      <Route path={`${BASE_URL}/race-picker`} component={RacePickerTest} />
      <Route path={`${BASE_URL}/lobby-landing`} component={LobbyLandingTest} />
      <Route>
        <DevLobbiesDashboard />
      </Route>
    </Switch>
  )
}
