import { Link, Route, Switch } from 'wouter'
import { MatchupsPageTest } from './matchups-page-test'
import { StatsPageTest } from './stats-page-test'

export function DevUsers() {
  return (
    <Switch>
      <Route path='/dev/users/stats' component={StatsPageTest} />
      <Route path='/dev/users/matchups' component={MatchupsPageTest} />
      <Route>
        <ul>
          <li>
            <Link href='/dev/users/stats'>Stats page</Link>
          </li>
          <li>
            <Link href='/dev/users/matchups'>Matchups page</Link>
          </li>
        </ul>
      </Route>
    </Switch>
  )
}
