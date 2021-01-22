import React from 'react'
import { Link, Route, Switch } from 'react-router-dom'

import MatchTest from './match-test'

class DevMatchmakingDashboard extends React.Component {
  render() {
    const { baseUrl } = this.props

    return (
      <ul>
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
      <Route path={baseUrl + '/match'} component={MatchTest} />
    </Switch>
  )
}
