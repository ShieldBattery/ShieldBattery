import React from 'react'
import { Link, Route, Switch } from 'react-router-dom'

import ContentLayout from './content/content-layout.jsx'
import DevLobbies from './lobbies/devonly/routes.jsx'
import DevMaterial from './material/devonly/routes.jsx'

class DevDashboard extends React.Component {
  render() {
    return (
      <ContentLayout title={'Developer dashboard'}>
        <span>
          This is a corner dedicated to developers. Here you can inspect and test various components
          of the app.
        </span>
        <ul>
          <li>
            <Link to="/dev/lobbies">Lobby-related components</Link>
          </li>
          <li>
            <Link to="/dev/material">Material components</Link>
          </li>
        </ul>
      </ContentLayout>
    )
  }
}

export default class Dev extends React.Component {
  render() {
    return (
      <Switch>
        <Route path="/dev" exact={true} render={() => <DevDashboard />} />
        <Route path="/dev/lobbies" component={DevLobbies} />
        <Route path="/dev/material" component={DevMaterial} />
      </Switch>
    )
  }
}
