import { Link, Route, Switch } from 'wouter'
import { BanFormTest } from './ban-form-test'
import { StatsPageTest } from './stats-page-test'

export function DevUsers() {
  return (
    <Switch>
      <Route path='/dev/users/stats' component={StatsPageTest} />
      <Route path='/dev/users/ban-form' component={BanFormTest} />
      <Route>
        <ul>
          <li>
            <Link href='/dev/users/stats'>Stats page</Link>
          </li>
          <li>
            <Link href='/dev/users/ban-form'>Ban form</Link>
          </li>
        </ul>
      </Route>
    </Switch>
  )
}
