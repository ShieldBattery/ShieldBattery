import loadable from '@loadable/component'
import React, { useLayoutEffect } from 'react'
import { hot } from 'react-hot-loader/root'
import { StyleSheetManager } from 'styled-components'
import { Route, Switch, useRoute } from 'wouter'
import { WindowControls, WindowControlsStyle } from './app-bar/window-controls'
import { isLoggedIn } from './auth/auth-utils'
import { EmailVerificationUi } from './auth/email-verification'
import { ForgotPassword, ForgotUser, ResetPassword } from './auth/forgot'
import LoggedInFilter from './auth/logged-in-filter'
import Login from './auth/login'
import Signup from './auth/signup'
import { usePixelShover } from './dom/pixel-shover'
import DownloadPage from './download/download-page'
import Faq from './landing/faq'
import Splash from './landing/splash'
import LoadingFilter from './loading/loading-filter'
import MainLayout from './main-layout'
import { LoginRoute } from './navigation/custom-routes'
import SiteConnectedFilter from './network/site-connected-filter'
import {
  AcceptableUsePage,
  PrivacyPolicyPage,
  TermsOfServicePage,
} from './policies/policy-displays'
import LoadingIndicator from './progress/dots'
import { useAppSelector } from './redux-hooks'
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
          <Route path='/acceptable-use' component={AcceptableUsePage} />
          <Route path='/privacy' component={PrivacyPolicyPage} />
          <Route path='/terms-of-service' component={TermsOfServicePage} />
          <LoginRoute path='/forgot-password' component={ForgotPassword} />
          <LoginRoute path='/forgot-user' component={ForgotUser} />
          <LoginRoute path='/login' component={Login} />
          <LoginRoute path='/reset-password' component={ResetPassword} />
          <LoginRoute path='/signup' component={Signup} />
          <LoginRoute path='/verify-email' component={EmailVerificationUi} />
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
