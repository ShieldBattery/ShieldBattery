import React from 'react'
import { Route, Switch } from 'wouter'
import { StyleSheetManager } from 'styled-components'
import loadable from '@loadable/component'
import { hot } from 'react-hot-loader/root'

import { VerifyEmail } from './auth/email-verification'
import Faq from './beta/faq'
import { ForgotUser, ForgotPassword, ResetPassword } from './auth/forgot'
import HasBetaFilter from './beta/has-beta-filter'
import DownloadPage from './download/download-page'
import LoadingFilter from './loading/loading-filter'
import LoggedInFilter from './auth/logged-in-filter'
import { ConditionalRoute, LoginRoute } from './navigation/custom-routes'
import Login from './auth/login'
import MainLayout from './main-layout'
import Signup from './auth/signup'
import SiteConnectedFilter from './network/site-connected-filter'
import Splash from './beta/splash'
import { WindowControls, WindowControlsStyle } from './app-bar/window-controls'
import LoadingIndicator from './progress/dots'

import GlobalStyle from './styles/global'
import ResetStyle from './styles/reset'

const IS_PRODUCTION = __WEBPACK_ENV.NODE_ENV === 'production'

const LoadableDev = IS_PRODUCTION
  ? () => null
  : loadable(() => import('./dev'), {
      // TODO(tec27): do we need to position this indicator differently? (or pull that into a common
      // place?)
      fallback: <LoadingIndicator />,
    })

class App extends React.Component {
  render() {
    return (
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
            {!IS_PRODUCTION ? <Route path='/dev/:rest*' component={LoadableDev} /> : <></>}
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
