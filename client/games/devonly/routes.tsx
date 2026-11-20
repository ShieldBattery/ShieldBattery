import { Link, Route, Switch } from 'wouter'
import { GameCardTest } from './game-card-test'
import {
  RefundFromReportTest,
  RefundFromResultsTest,
  RefundTeamGameTest,
} from './refund-game-points-test'

export function DevGames() {
  return (
    <Switch>
      <Route path='/dev/games/cards' component={GameCardTest} />
      <Route path='/dev/games/refund-results' component={RefundFromResultsTest} />
      <Route path='/dev/games/refund-team' component={RefundTeamGameTest} />
      <Route path='/dev/games/refund-report' component={RefundFromReportTest} />
      <Route>
        <ul>
          <li>
            <Link href='/dev/games/cards'>Game cards</Link>
          </li>
          <li>
            <Link href='/dev/games/refund-results'>Refund points (from a game's results)</Link>
          </li>
          <li>
            <Link href='/dev/games/refund-team'>Refund points (team game)</Link>
          </li>
          <li>
            <Link href='/dev/games/refund-report'>Refund points (from a report)</Link>
          </li>
        </ul>
      </Route>
    </Switch>
  )
}
