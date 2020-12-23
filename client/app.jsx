import React from 'react'
import { Route, Switch } from 'react-router-dom'
import { StyleSheetManager } from 'styled-components'
import loadable from '@loadable/component'
import { hot } from 'react-hot-loader/root'

import { VerifyEmail, SendVerificationEmail } from './auth/email-verification.jsx'
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
import { WindowControls, WindowControlsStyle } from './app-bar/window-controls.jsx'
import LoadingIndicator from './progress/dots.jsx'

import GlobalStyle from './styles/global'
import ResetStyle from './styles/reset'

const IS_PRODUCTION = process.webpackEnv.NODE_ENV === 'production'

const LoadableDev = IS_PRODUCTION
  ? () => null
  : loadable(() => import('./dev.jsx'), {
      // TODO(tec27): do we need to position this indicator differently? (or pull that into a common
      // place?)
      fallback: <LoadingIndicator />,
    })

class App extends React.Component {
  render() {
    return (
      // NOTE(2Pac): These are only the top-level routes. More specific routes are declared where
      // they are used, as per react-router's new philosophy.
      <StyleSheetManager disableVendorPrefixes={IS_ELECTRON}>
        <React.Fragment>
          <ResetStyle />
          <GlobalStyle />
          <WindowControlsStyle />
          <WindowControls />
          <Switch>
            <Route path='/splash' component={Splash} />
            <Route path='/faq' component={Faq} />
            <Route path='/download' component={DownloadPage} />
            <LoginRoute path='/forgot-password' component={ForgotPassword} />
            <LoginRoute path='/forgot-user' component={ForgotUser} />
            <LoginRoute path='/login' component={Login} />
            <LoginRoute path='/reset-password' component={ResetPassword} />
            <LoginRoute path='/signup' component={Signup} />
            <LoginRoute path='/verify-email' component={VerifyEmail} />
            <LoginRoute path='/send-verification-email' component={SendVerificationEmail} />
            {!IS_PRODUCTION ? <Route path='/dev' component={LoadableDev} /> : null}
            <ConditionalRoute
              filters={[HasBetaFilter, LoggedInFilter, SiteConnectedFilter, LoadingFilter]}
              component={MainLayout}
            />
          </Switch>
        </React.Fragment>
      </StyleSheetManager>
    )
  }
}

export default hot(App)
