import React from 'react'
import { IndexRoute, Route } from 'react-router'

import ActiveGame from './active-game/view.jsx'
import AdminBetaInvites from './admin/invites.jsx'
import AdminPanel from './admin/panel.jsx'
import { UserFind, UserProfile } from './admin/user-profile.jsx'
import AppNotFound from './app-not-found.jsx'
import ChatChannel from './chat/channel.jsx'
import ChatList from './chat/list.jsx'
import Faq from './beta/faq.jsx'
import HasBetaFilter from './beta/has-beta-filter.jsx'
import DownloadPage from './download/download-page.jsx'
import LoadingFilter from './loading/loading-filter.jsx'
import LobbyView from './lobbies/view.jsx'
import LoggedInFilter from './auth/logged-in-filter.jsx'
import LoginLayout from './auth/login-layout.jsx'
import Login from './auth/login.jsx'
import MainLayout from './main-layout.jsx'
import Signup from './auth/signup.jsx'
import SiteConnectedFilter from './network/site-connected-filter.jsx'
import Splash from './beta/splash.jsx'
import Whisper from './whispers/whisper.jsx'

const AdminMapUpload =
    process.webpackEnv.SB_ENV === 'electron' ? require('./admin/map-upload.jsx').default : null

import {
  CanAcceptBetaInvitesFilter,
  CanViewUserProfileFilter,
  IsAdminFilter
} from './admin/admin-route-filters.jsx'

let devRoutes
if (process.webpackEnv.NODE_ENV !== 'production') {
  const devLobbies = require('./lobbies/devonly/routes.jsx').default
  const devMaterial = require('./material/devonly/routes.jsx').default

  devRoutes = <Route>
    { devLobbies }
    { devMaterial }
  </Route>
}

let activeGameRoute
let lobbyRoute
if (process.webpackEnv.SB_ENV === 'electron') {
  activeGameRoute = <Route path='/active-game' component={ActiveGame} />
  lobbyRoute = <Route path='/lobbies/:lobby' component={LobbyView} />
}

const routes = <Route>
  <Route path='/splash' component={Splash} />
  <Route path='/faq' component={Faq} />
  <Route path='/download' component={DownloadPage} />
  <Route component={HasBetaFilter}>
    <Route component={LoggedInFilter}>
      <Route component={SiteConnectedFilter}>
        <Route component={LoadingFilter}>
          <Route component={MainLayout}>
            <Route path='/' />
            { activeGameRoute }
            <Route component={IsAdminFilter}>
              <Route path='/admin'>
                <IndexRoute component={AdminPanel}/>
                <Route component={CanViewUserProfileFilter}>
                  <Route path='/admin/users' component={UserFind}>
                    <Route path=':username' component={UserProfile} />
                  </Route>
                </Route>
                <Route component={CanAcceptBetaInvitesFilter}>
                  <Route path='/admin/invites' component={AdminBetaInvites} />
                </Route>
                { AdminMapUpload ?
                    <Route path='/admin/map-upload' component={AdminMapUpload} /> : null }
              </Route>
            </Route>
            <Route path='/chat'>
              <IndexRoute component={ChatList}/>
              <Route path=':channel' component={ChatChannel} />
            </Route>
            { lobbyRoute }
            <Route path='/whispers'>
              <Route path=':target' component={Whisper} />
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
