import React from 'react'
import { DefaultRoute, NotFoundRoute, Route } from 'react-router'
import App from './app.jsx'
import AppNotFound from './app-not-found.jsx'
import MainLayout from './main-layout.jsx'
import Home from './home.jsx'
import Games from './games/games.jsx'
import Replays from './replays/replays.jsx'
import LoginRequired from './auth/login-required.jsx'
import LoginLayout from './auth/login-layout.jsx'
import Login from './auth/login.jsx'
import Signup from './auth/signup.jsx'

const Routes = (
  <Route path='/' handler={App}>
    <Route handler={LoginRequired}>
      <Route handler={MainLayout}>
        <DefaultRoute name='home' handler={Home} />
        <Route name='games' handler={Games} />
        <Route name='replays' handler={Replays} />
      </Route>
    </Route>
    <Route handler={LoginLayout}>
      <Route name='login' handler={Login} />
      <Route name='signup' handler={Signup} />
    </Route>
    <NotFoundRoute handler={AppNotFound} />
  </Route>
)

export default Routes
