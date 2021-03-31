import React, { useLayoutEffect } from 'react'
import { Route, Switch, useRoute } from 'wouter'
import { StyleSheetManager } from 'styled-components'
import loadable from '@loadable/component'
import { hot } from 'react-hot-loader/root'

import { VerifyEmail } from './auth/email-verification'
import Faq from './landing/faq'
import { ForgotUser, ForgotPassword, ResetPassword } from './auth/forgot'
import DownloadPage from './download/download-page'
import LoadingFilter from './loading/loading-filter'
import LoggedInFilter from './auth/logged-in-filter'
import { LoginRoute } from './navigation/custom-routes'
import Login from './auth/login'
import MainLayout from './main-layout'
import Signup from './auth/signup'
import SiteConnectedFilter from './network/site-connected-filter'
import Splash from './landing/splash'
import { WindowControls, WindowControlsStyle } from './app-bar/window-controls'
import LoadingIndicator from './progress/dots'

import GlobalStyle from './styles/global'
import ResetStyle from './styles/reset'
import { usePixelShover } from './dom/pixel-shover'
import { isLoggedIn } from './auth/auth-utils'
import { useAppSelector } from './redux-hooks'

const IS_PRODUCTION = __WEBPACK_ENV.NODE_ENV === 'production'

const LoadableDev = IS_PRODUCTION
  ? () => null
  : loadable(() => import('./dev'), {
      // TODO(tec27): do we need to position this indicator differently? (or pull that into a common
      // place?)
      fallback: <LoadingIndicator />,
    })

function MainContent() {
  const [matchesRoot] = useRoute('/')
  const user = useAppSelector(s => s.auth.user)

  if (matchesRoot) {
    // TODO(tec27): Make a function that lets us pass just the one value (or put this computed value
    // on the state?)
    if (!IS_ELECTRON && !isLoggedIn({ user })) {
      return <Splash />
    }
  }

  return (
    <LoggedInFilter>
      <SiteConnectedFilter>
        <LoadingFilter>
          <MainLayout />
        </LoadingFilter>
      </SiteConnectedFilter>
    </LoggedInFilter>
  )
}

function App() {
  const [shoveX, shoveY] = usePixelShover()
  useLayoutEffect(() => {
    document.body.style.setProperty('--pixel-shove-x', `${shoveX}px`)
    document.body.style.setProperty('--pixel-shove-y', `${shoveY}px`)
  }, [shoveX, shoveY])

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
          <Route>
            <MainContent />
          </Route>
        </Switch>
      </React.Fragment>
    </StyleSheetManager>
  )
}

export default hot(App)
