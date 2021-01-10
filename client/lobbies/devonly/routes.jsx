import React from 'react'
import { Link, Route, Switch } from 'react-router-dom'

import ActiveTest from './active-test'
import LobbyTest from './lobby-test'
import LoadingTest from './loading-test'
import RacePickerTest from './race-picker-test'

class DevLobbiesDashboard extends React.Component {
  render() {
    const { baseUrl } = this.props

    return (
      <ul>
        <li>
          <Link to={baseUrl + '/lobby'}>Lobby component</Link>
        </li>
        <li>
          <Link to={baseUrl + '/loading'}>Loading component</Link>
        </li>
        <li>
          <Link to={baseUrl + '/active'}>Active component</Link>
        </li>
        <li>
          <Link to={baseUrl + '/race-picker'}>Race picker component</Link>
        </li>
      </ul>
    )
  }
}

export default props => {
  const baseUrl = props.match.url
  return (
    <Switch>
      <Route path={baseUrl} exact={true} render={() => <DevLobbiesDashboard baseUrl={baseUrl} />} />
      <Route path={baseUrl + '/lobby'} component={LobbyTest} />
      <Route path={baseUrl + '/loading'} component={LoadingTest} />
      <Route path={baseUrl + '/active'} component={ActiveTest} />
      <Route path={baseUrl + '/race-picker'} component={RacePickerTest} />
    </Switch>
  )
}
