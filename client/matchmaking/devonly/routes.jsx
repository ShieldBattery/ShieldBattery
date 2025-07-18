import { Component } from 'react'
import { Link, Route, Switch } from 'wouter'
import { DraftTest } from './draft-tester'
import { PostMatchDialogTest } from './post-match-dialog-test'
import { RankIconsTest } from './rank-icons-test'

const BASE_URL = '/dev/matchmaking'

class DevMatchmakingDashboard extends Component {
  render() {
    return (
      <ul>
        <li>
          <Link href={`${BASE_URL}/draft`}>Draft</Link>
        </li>
        <li>
          <Link href={`${BASE_URL}/post-match-dialog`}>Post-match dialog</Link>
        </li>
        <li>
          <Link href={`${BASE_URL}/icons`}>Rank icons</Link>
        </li>
      </ul>
    )
  }
}

export default () => {
  return (
    <Switch>
      <Route path={`${BASE_URL}/draft`} component={DraftTest} />
      <Route path={`${BASE_URL}/post-match-dialog`} component={PostMatchDialogTest} />
      <Route path={`${BASE_URL}/icons`} component={RankIconsTest} />
      <Route>
        <DevMatchmakingDashboard />
      </Route>
    </Switch>
  )
}
