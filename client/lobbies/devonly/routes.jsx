import { Component } from 'react'
import { Link, Route, Switch } from 'wouter'
import { HostGameTest } from './host-game-test'
import { JoinPreviewTest } from './join-preview-test'
import { LobbyInviteCardTest } from './lobby-invite-card-test'
import { LobbyLandingTest } from './lobby-landing-test'
import LobbyTest from './lobby-test'
import RacePickerTest from './race-picker-test'

const BASE_URL = '/dev/lobbies'

class DevLobbiesDashboard extends Component {
  render() {
    return (
      <ul>
        <li>
          <Link href={`${BASE_URL}/host-game`}>Host a game (redesign)</Link>
        </li>
        <li>
          <Link href={`${BASE_URL}/lobby`}>Lobby component</Link>
        </li>
        <li>
          <Link href={`${BASE_URL}/race-picker`}>Race picker component</Link>
        </li>
        <li>
          <Link href={`${BASE_URL}/lobby-landing`}>Lobby landing page</Link>
        </li>
        <li>
          <Link href={`${BASE_URL}/join-preview`}>Lobby join preview</Link>
        </li>
        <li>
          <Link href={`${BASE_URL}/invite-card`}>Lobby invite card</Link>
        </li>
      </ul>
    )
  }
}

export default () => {
  return (
    <Switch>
      <Route path={`${BASE_URL}/host-game`} component={HostGameTest} />
      <Route path={`${BASE_URL}/lobby`} component={LobbyTest} />
      <Route path={`${BASE_URL}/race-picker`} component={RacePickerTest} />
      <Route path={`${BASE_URL}/lobby-landing`} component={LobbyLandingTest} />
      <Route path={`${BASE_URL}/join-preview`} component={JoinPreviewTest} />
      <Route path={`${BASE_URL}/invite-card`} component={LobbyInviteCardTest} />
      <Route>
        <DevLobbiesDashboard />
      </Route>
    </Switch>
  )
}
