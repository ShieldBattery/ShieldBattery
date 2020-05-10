import React from 'react'
import { Link, Route, Switch } from 'react-router-dom'

import DevActivities from './activities/devonly/routes.jsx'
import DevLists from './lists/devonly/routes.jsx'
import DevLobbies from './lobbies/devonly/routes.jsx'
import DevMaterial from './material/devonly/routes.jsx'

class DevDashboard extends React.Component {
  render() {
    return (
      <div>
        <span>
          This is a corner dedicated to developers. Here you can inspect and test various components
          of the app.
        </span>
        <ul>
          <li>
            <Link to='/dev/activities'>Activity components</Link>
          </li>
          <li>
            <Link to='/dev/lists'>List components</Link>
          </li>
          <li>
            <Link to='/dev/lobbies'>Lobby-related components</Link>
          </li>
          <li>
            <Link to='/dev/material'>Material components</Link>
          </li>
        </ul>
      </div>
    )
  }
}

export default class Dev extends React.Component {
  render() {
    return (
      <Switch>
        <Route path='/dev' exact={true} render={() => <DevDashboard />} />
        <Route path='/dev/activities' component={DevActivities} />
        <Route path='/dev/lists' component={DevLists} />
        <Route path='/dev/lobbies' component={DevLobbies} />
        <Route path='/dev/material' component={DevMaterial} />
      </Switch>
    )
  }
}
