import { Link, Route, Switch } from 'wouter'
import { StatsPageTest } from './stats-page-test'
import { UserCardTest } from './user-card-test'

export function DevUsers() {
  return (
    <Switch>
      <Route path='/dev/users/stats' component={StatsPageTest} />
      <Route path='/dev/users/user-card' component={UserCardTest} />
      <Route>
        <ul>
          <li>
            <Link href='/dev/users/stats'>Stats page</Link>
          </li>
          <li>
            <Link href='/dev/users/user-card'>User card</Link>
          </li>
        </ul>
      </Route>
    </Switch>
  )
}
