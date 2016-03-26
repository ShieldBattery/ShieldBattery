import React from 'react'
import { IndexRoute, Route } from 'react-router'

import ActiveGame from './active-game/view.jsx'
import AppNotFound from './app-not-found.jsx'
import ChatChannel from './chat/channel.jsx'
import ChatList from './chat/list.jsx'
import MainLayout from './main-layout.jsx'
import LobbyList from './lobbies/list.jsx'
import LobbyView from './lobbies/view.jsx'
import LoggedInFilter from './auth/logged-in-filter'
import LoginLayout from './auth/login-layout.jsx'
import Login from './auth/login.jsx'
import Signup from './auth/signup.jsx'
import SiteConnectedFilter from './network/site-connected-filter.jsx'
import WhisperIndex from './whispers/index.jsx'
import WhisperView from './whispers/view.jsx'

let devRoutes
if (process.env.NODE_ENV !== 'production') {
  const devLobbies = require('./lobbies/devonly/routes.jsx').default
  const devMaterial = require('./material/devonly/routes.jsx').default

  devRoutes = <Route>
    { devLobbies }
    { devMaterial }
  </Route>
}

const routes = <Route>
  <Route component={LoggedInFilter}>
    <Route component={SiteConnectedFilter}>
      <Route component={MainLayout}>
        <Route path='/' />
        <Route path='/active-game' component={ActiveGame} />
        <Route path='/chat'>
          <IndexRoute component={ChatList} title='Chat channels'/>
          <Route path=':channel' component={ChatChannel} />
        </Route>
        <Route path='/lobbies'>
          <IndexRoute component={LobbyList} />
          <Route path=':lobby' component={LobbyView} />
        </Route>
        <Route path='/whispers'>
          <IndexRoute component={WhisperIndex} />
          <Route path=':user' component={WhisperView} />
        </Route>
      </Route>
    </Route>
  </Route>
  <Route component={LoginLayout}>
    <Route path='/login' component={Login} />
    <Route path='/signup' component={Signup} />
  </Route>
  { devRoutes }
  <Route path='*' component={AppNotFound} />
</Route>

export default routes
