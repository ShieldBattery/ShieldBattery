import React from 'react'
import { Link, Route, Switch } from 'react-router-dom'
import { hot } from 'react-hot-loader/root'
import styled from 'styled-components'

import DevActivities from './activities/devonly/routes'
import { DevGames } from './games/devonly/routes'
import DevLists from './lists/devonly/routes'
import DevLobbies from './lobbies/devonly/routes'
import DevMatchmaking from './matchmaking/devonly/routes'
import DevMaterial from './material/devonly/routes'

const Container = styled.div`
  padding: 16px !important;
`

const DescriptionText = styled.div`
  margin: 8px 0;
`

class DevDashboard extends React.Component {
  render() {
    return (
      <div>
        <DescriptionText>
          This is a corner dedicated to developers. Here you can inspect and test various components
          of the app.
        </DescriptionText>
        <ul>
          <li>
            <Link to='/dev/activities'>Activity components</Link>
          </li>
          <li>
            <Link to='/dev/games'>Games components</Link>
          </li>
          <li>
            <Link to='/dev/lists'>List components</Link>
          </li>
          <li>
            <Link to='/dev/lobbies'>Lobby components</Link>
          </li>
          <li>
            <Link to='/dev/matchmaking'>Matchmaking components</Link>
          </li>
          <li>
            <Link to='/dev/material'>Material components</Link>
          </li>
        </ul>
      </div>
    )
  }
}

class Dev extends React.Component {
  render() {
    return (
      <Container>
        <Link to='/'>Home</Link>
        <Switch>
          <Route path='/dev' exact={true} render={() => <DevDashboard />} />
          <Route path='/dev/activities' component={DevActivities} />
          <Route path='/dev/games' component={DevGames} />
          <Route path='/dev/lists' component={DevLists} />
          <Route path='/dev/lobbies' component={DevLobbies} />
          <Route path='/dev/matchmaking' component={DevMatchmaking} />
          <Route path='/dev/material' component={DevMaterial} />
        </Switch>
      </Container>
    )
  }
}

// NOTE(tec27): @loadable/component seems to screw with react-hot-loader in weird ways, so we make
// this root it's own hot context to keep things working inside here
export default hot(Dev)
