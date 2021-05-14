import React from 'react'
import { Link, Route, Switch } from 'wouter'
import DevActivityButtons from './activity-button-test'

const BASE_URL = '/dev/activities'

class DevActivityDashboard extends React.Component {
  render() {
    return (
      <ul>
        <li>
          <Link href={`${BASE_URL}/activity-button`}>Activity button</Link>
        </li>
      </ul>
    )
  }
}

export default () => {
  return (
    <Switch>
      <Route path={`${BASE_URL}/activity-button`} component={DevActivityButtons} />
      <Route component={DevActivityDashboard} />
    </Switch>
  )
}
