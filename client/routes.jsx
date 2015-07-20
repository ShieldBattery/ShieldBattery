import React from 'react'
import { Router, Route } from 'react-router'
import { reduxRouteComponent } from 'redux-react-router'
import AppNotFound from './app-not-found.jsx'
import MainLayout from './main-layout.jsx'
import Home from './home.jsx'
import Games from './games/games.jsx'
import Replays from './replays/replays.jsx'
import LoginRequired from './auth/login-required.jsx'
import LoginLayout from './auth/login-layout.jsx'
import Login from './auth/login.jsx'
import Signup from './auth/signup.jsx'

export default function getRoutes(history, store) {
  return (<Router history={history}>
    <Route component={reduxRouteComponent(store)}>
      <Route component={LoginRequired}>
        <Route component={MainLayout}>
          <Route path='/' component={Home} />
          <Route path='games' component={Games} />
          <Route path='replays' component={Replays} />
        </Route>
      </Route>
      <Route component={LoginLayout}>
        <Route path='/login' component={Login} />
        <Route path='/signup' component={Signup} />
      </Route>
      <Route path='*' component={AppNotFound} />
    </Route>
  </Router>)
}
