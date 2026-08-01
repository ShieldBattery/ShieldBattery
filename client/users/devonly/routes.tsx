import { Link, Route, Switch } from 'wouter'
import { StatsPageTest } from './stats-page-test'

export function DevUsers() {
  return (
    <Switch>
      <Route path='/dev/users/stats' component={StatsPageTest} />
      <Route>
        <ul>
          <li>
            <Link href='/dev/users/stats'>Stats page</Link>
          </li>
        </ul>
      </Route>
    </Switch>
  )
}
