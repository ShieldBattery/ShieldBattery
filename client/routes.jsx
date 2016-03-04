import React from 'react'
import { IndexRoute, Route } from 'react-router'
import { routeActions } from 'redux-simple-router'
import AdminBetaInvites from './admin/invites.jsx'
import AdminPanel from './admin/panel.jsx'
import AdminPermissions from './admin/permissions.jsx'
import AppNotFound from './app-not-found.jsx'
import ChatChannel from './chat/channel.jsx'
import ChatList from './chat/list.jsx'
import ConditionalRedirect from './navigation/conditional-redirect.jsx'
import MainLayout from './main-layout.jsx'
import LobbyList from './lobbies/list.jsx'
import LobbyView from './lobbies/view.jsx'
import LoginLayout from './auth/login-layout.jsx'
import Login from './auth/login.jsx'
import Signup from './auth/signup.jsx'
import WhisperIndex from './whispers/index.jsx'
import WhisperView from './whispers/view.jsx'

import { isAdmin, checkPermissions } from './admin/admin-utils'
import { isLoggedIn } from './auth/auth-utils'
import { redirectAfterLogin, goToIndex, goToAdminPanel } from './navigation/action-creators'

let devRoutes
if (process.env.NODE_ENV !== 'production') {
  const DevLobbies = require('./lobbies/devonly/lobby-test.jsx').default
  const devMaterial = require('./material/devonly/routes.jsx').default

  devRoutes = <Route>
    <Route path='/devlobbies' component={DevLobbies} />
    { devMaterial }
  </Route>
}

const routes = <Route>
  <Route component={ConditionalRedirect} conditionFn={(auth) => isLoggedIn(auth)}
      actionFn={(props) => redirectAfterLogin(props)}>
    <Route component={MainLayout}>
      <Route path='/' />
      <Route component={ConditionalRedirect} conditionFn={(auth) => isAdmin(auth)}
          actionFn={() => goToIndex(routeActions.replace)}>
        <Route path='/admin'>
          <IndexRoute component={AdminPanel} title='Admin panel'/>
          <Route component={ConditionalRedirect}
              conditionFn={(auth) => checkPermissions(auth, 'editPermissions')}
              actionFn={() => goToAdminPanel(routeActions.replace)}>
            <Route path='/admin/permissions' component={AdminPermissions} />
            <Route path='/admin/permissions/:username' component={AdminPermissions} />
          </Route>
          <Route component={ConditionalRedirect}
              conditionFn={(auth) => checkPermissions(auth, 'acceptInvites')}
              actionFn={() => goToAdminPanel(routeActions.replace)}>
            <Route path='/admin/invites' component={AdminBetaInvites} />
          </Route>
        </Route>
      </Route>
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
  <Route component={LoginLayout}>
    <Route path='/login' component={Login} />
    <Route path='/signup' component={Signup} />
  </Route>
  { devRoutes }
  <Route path='*' component={AppNotFound} />
</Route>

export default routes
