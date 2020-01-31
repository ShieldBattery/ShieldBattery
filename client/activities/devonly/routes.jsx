import React from 'react'
import { Link, Route, Switch } from 'react-router-dom'

import DevActivityButtons from './activity-button-test.jsx'

class DevActivityDashboard extends React.Component {
  render() {
    const { baseUrl } = this.props

    return (
      <ul>
        <li>
          <Link to={baseUrl + '/activity-button'}>Activity button</Link>
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
        render={() => <DevActivityDashboard baseUrl={baseUrl} />}
      />
      <Route path={baseUrl + '/activity-button'} component={DevActivityButtons} />
    </Switch>
  )
}
