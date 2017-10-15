import React from 'react'
import { Route, Switch } from 'react-router-dom'
import ga from 'react-ga'
import { makeServerUrl } from './network/server-url'

import Faq from './beta/faq.jsx'
import { ForgotUser, ForgotPassword, ResetPassword } from './auth/forgot.jsx'
import HasBetaFilter from './beta/has-beta-filter.jsx'
import DownloadPage from './download/download-page.jsx'
import LoadingFilter from './loading/loading-filter.jsx'
import LoggedInFilter from './auth/logged-in-filter.jsx'
import { ConditionalRoute, LoginRoute } from './navigation/custom-routes.jsx'
import Login from './auth/login.jsx'
import MainLayout from './main-layout.jsx'
import Signup from './auth/signup.jsx'
import SiteConnectedFilter from './network/site-connected-filter.jsx'
import Splash from './beta/splash.jsx'

let devRoutes
if (process.webpackEnv.NODE_ENV !== 'production') {
  const DevLobbies = require('./lobbies/devonly/routes.jsx').default
  const DevMaterial = require('./material/devonly/routes.jsx').default

  devRoutes = [
    <Route path="/dev/lobbies" component={DevLobbies} key="lobbies" />,
    <Route path="/dev/material" component={DevMaterial} key="material" />,
  ]
}

export default class App extends React.Component {
  initialized = false
  onUpdate = () => {
    if (!this.initialized) {
      return
    }

    // TODO(2Pac): Make GA work.
    // See: https://github.com/react-ga/react-ga/wiki/React-Router-v4-withTracker
    if (IS_ELECTRON) {
      ga.pageview(window.location.hash.slice(1))
    } else {
      ga.pageview(window.location.pathname)
    }
  }

  componentDidMount() {
    if (this.props.analyticsId) {
      ga.initialize(this.props.analyticsId)
      if (IS_ELECTRON) {
        ga.set({ location: makeServerUrl('') })
        ga.set({ checkProtocolTask: null })
      }
      this.initialized = true
    }
  }

  render() {
    return (
      // NOTE(2Pac): These are only the top-level routes. More specific routes are declared where
      // they are used, as per react-router's new philosophy.
      <Switch>
        <Route path="/splash" component={Splash} />
        <Route path="/faq" component={Faq} />
        <Route path="/download" component={DownloadPage} />
        <LoginRoute path="/forgot-password" component={ForgotPassword} />
        <LoginRoute path="/forgot-user" component={ForgotUser} />
        <LoginRoute path="/login" component={Login} />
        <LoginRoute path="/reset-password" component={ResetPassword} />
        <LoginRoute path="/signup" component={Signup} />
        {devRoutes}
        <ConditionalRoute
          filters={[HasBetaFilter, LoggedInFilter, SiteConnectedFilter, LoadingFilter]}
          component={MainLayout}
        />
      </Switch>
    )
  }
}
