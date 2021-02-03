import React from 'react'
import { Link, match as RouterMatch, Route, Switch } from 'react-router-dom'
import { ResultsTest } from './results-test'

interface DashboardProps {
  baseUrl: string
}

class DevGamesDashboard extends React.Component<DashboardProps> {
  render() {
    const { baseUrl } = this.props

    return (
      <ul>
        <li>
          <Link to={baseUrl + '/results'}>Game results</Link>
        </li>
      </ul>
    )
  }
}

export interface DevGamesProps {
  match: RouterMatch<never>
}

export function DevGames(props: DevGamesProps) {
  const baseUrl = props.match.url
  return (
    <Switch>
      <Route path={baseUrl} exact={true} render={() => <DevGamesDashboard baseUrl={baseUrl} />} />
      <Route path={baseUrl + '/results'} component={ResultsTest} />
    </Switch>
  )
}
