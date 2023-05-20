import React, { useLayoutEffect } from 'react'
import { StyleSheetManager } from 'styled-components'
import { Route, Switch, useRoute } from 'wouter'
import { isLoggedIn } from './auth/auth-utils'
import { EmailVerificationUi } from './auth/email-verification'
import { ForgotPassword, ForgotUser, ResetPassword } from './auth/forgot'
import { LoggedInFilter } from './auth/logged-in-filter'
import Login from './auth/login'
import Signup from './auth/signup'
import { ConnectedDialogOverlay } from './dialogs/connected-dialog-overlay'
import { usePixelShover } from './dom/pixel-shover'
import { DownloadPage } from './download/download-page'
import { UpdateOverlay } from './download/update-overlay'
import { KeyListenerBoundary } from './keyboard/key-listener'
import Faq from './landing/faq'
import Splash from './landing/splash'
import { LoadingFilter } from './loading/loading-filter'
import { LoggedOutContent } from './logged-out-content'
import { MainLayout } from './main-layout'
import { LoginRoute } from './navigation/custom-routes'
import { SiteConnectedFilter } from './network/site-connected-filter'
import {
  AcceptableUsePage,
  PrivacyPolicyPage,
  TermsOfServicePage,
} from './policies/policy-displays'
import { LoadingDotsArea } from './progress/dots'
import { useAppSelector } from './redux-hooks'
import { RootErrorBoundary } from './root-error-boundary'
import { ConnectedSettings } from './settings/settings'
import ConnectedSnackbar from './snackbars/connected-snackbar'
import GlobalStyle from './styles/global'
import ResetStyle from './styles/reset'

const IS_PRODUCTION = __WEBPACK_ENV.NODE_ENV === 'production'

const DevComponent = IS_PRODUCTION ? () => null : React.lazy(() => import('./dev'))

function LoadableDev() {
  return (
    <React.Suspense fallback={<LoadingDotsArea />}>
      <DevComponent />
    </React.Suspense>
  )
}

const LoadableWindowControls = IS_ELECTRON
  ? React.lazy(async () => ({
      default: (await import('./system-bar/window-controls')).WindowControls,
    }))
  : () => null

const LoadableSystemBar = IS_ELECTRON
  ? React.lazy(async () => ({ default: (await import('./system-bar/system-bar')).SystemBar }))
  : () => null

function MainContent() {
  const [matchesRoot] = useRoute('/')
  const user = useAppSelector(s => s.auth.user)
  const loggedIn = isLoggedIn({ user })

  if (matchesRoot) {
    // TODO(tec27): Make a function that lets us pass just the one value (or put this computed value
    // on the state?)
    if (!IS_ELECTRON && !loggedIn) {
      return <Splash />
    }
  }

  const loggedInContent = (
    <LoggedInFilter>
      <SiteConnectedFilter>
        <LoadingFilter>
          <MainLayout />
        </LoadingFilter>
      </SiteConnectedFilter>
    </LoggedInFilter>
  )

  return loggedIn ? loggedInContent : <LoggedOutContent loggedInContent={loggedInContent} />
}

export default function App() {
  const [shoveX, shoveY] = usePixelShover()
  useLayoutEffect(() => {
    document.body.style.setProperty('--pixel-shove-x', `${shoveX}px`)
    document.body.style.setProperty('--pixel-shove-y', `${shoveY}px`)
  }, [shoveX, shoveY])

  return (
    <StyleSheetManager disableVendorPrefixes={IS_ELECTRON}>
      <>
        <ResetStyle />
        <GlobalStyle />
        <LoadableWindowControls />
        <LoadableSystemBar />
        <KeyListenerBoundary>
          <RootErrorBoundary>
            <React.Suspense fallback={<LoadingDotsArea />}>
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
              <ConnectedSettings />
              <ConnectedSnackbar />
              <ConnectedDialogOverlay />
            </React.Suspense>
          </RootErrorBoundary>
          <UpdateOverlay />
        </KeyListenerBoundary>
      </>
    </StyleSheetManager>
  )
}
