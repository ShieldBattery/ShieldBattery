import React from 'react'
import { Link, Route, Switch } from 'react-router-dom'

import MapSelectionTest from './map-selection-test'
import MatchTest from './match-test'

class DevMatchmakingDashboard extends React.Component {
  render() {
    const { baseUrl } = this.props

    return (
      <ul>
        <li>
          <Link to={baseUrl + '/map-selection'}>Map selection</Link>
        </li>
        <li>
          <Link to={baseUrl + '/match'}>Matchmaking match</Link>
        </li>
      </ul>
    )
  }
}

export default props => {
  const baseUrl = props.match.url
  return (
    <Switch>
      <Route
        path={baseUrl}
        exact={true}
        render={() => <DevMatchmakingDashboard baseUrl={baseUrl} />}
      />
      <Route path={baseUrl + '/map-selection'} component={MapSelectionTest} />
      <Route path={baseUrl + '/match'} component={MatchTest} />
    </Switch>
  )
}
