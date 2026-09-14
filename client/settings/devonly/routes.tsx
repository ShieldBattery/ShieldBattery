import { Link, Route, Switch } from 'wouter'
import { GameDefaultsTest } from './game-defaults-test'

export function DevSettings() {
  return (
    <Switch>
      <Route path='/dev/settings/game-defaults' component={GameDefaultsTest} />
      <Route>
        <ul>
          <li>
            <Link href='/dev/settings/game-defaults'>Game defaults</Link>
          </li>
        </ul>
      </Route>
    </Switch>
  )
}
