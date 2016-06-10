import React from 'react'
import { IndexRoute, Route } from 'react-router'

import ActiveGame from './active-game/view.jsx'
import AdminBetaInvites from './admin/invites.jsx'
import AdminPanel from './admin/panel.jsx'
import { PermissionsFind, PermissionsResults } from './admin/permissions.jsx'
import AppNotFound from './app-not-found.jsx'
import ChatChannel from './chat/channel.jsx'
import ChatList from './chat/list.jsx'
import Faq from './beta/faq.jsx'
import HasBetaFilter from './beta/has-beta-filter.jsx'
import LoadingFilter from './loading/loading-filter.jsx'
import LobbyView from './lobbies/view.jsx'
import LoggedInFilter from './auth/logged-in-filter.jsx'
import LoginLayout from './auth/login-layout.jsx'
import Login from './auth/login.jsx'
import MainLayout from './main-layout.jsx'
import Signup from './auth/signup.jsx'
import SiteConnectedFilter from './network/site-connected-filter.jsx'
import Splash from './beta/splash.jsx'
import WhisperIndex from './whispers/index.jsx'
import WhisperView from './whispers/view.jsx'

import {
  CanAcceptBetaInvitesFilter,
  CanEditPermissionsFilter,
  IsAdminFilter
} from './admin/admin-route-filters.jsx'

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
  <Route path='/splash' component={Splash} />
  <Route path ='/faq' component={Faq} />
  <Route component={HasBetaFilter}>
    <Route component={LoggedInFilter}>
      <Route component={SiteConnectedFilter}>
        <Route component={LoadingFilter}>
          <Route component={MainLayout}>
            <Route path='/' />
            <Route path='/active-game' component={ActiveGame} />
            <Route component={IsAdminFilter}>
              <Route path='/admin'>
                <IndexRoute component={AdminPanel} title='Admin panel'/>
                <Route component={CanEditPermissionsFilter}>
                  <Route path='/admin/permissions' component={PermissionsFind}>
                    <Route path=':username' component={PermissionsResults} />
                  </Route>
                </Route>
                <Route component={CanAcceptBetaInvitesFilter}>
                  <Route path='/admin/invites' component={AdminBetaInvites} />
                </Route>
              </Route>
            </Route>
            <Route path='/chat'>
              <IndexRoute component={ChatList} title='Chat channels'/>
              <Route path=':channel' component={ChatChannel} />
            </Route>
            <Route path='/lobbies/:lobby' component={LobbyView} />
            <Route path='/whispers'>
              <IndexRoute component={WhisperIndex} />
              <Route path=':user' component={WhisperView} />
            </Route>
          </Route>
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
