import React, { useEffect, useLayoutEffect, useState } from 'react'
import { StyleSheetManager } from 'styled-components'
import { Provider as UrqlProvider } from 'urql'
import { Route, Switch, useRoute } from 'wouter'
import { revokeSession } from './auth/action-creators.js'
import { useIsLoggedIn } from './auth/auth-utils.js'
import { EmailVerificationUi } from './auth/email-verification.js'
import { ForgotPassword, ForgotUser, ResetPassword } from './auth/forgot.js'
import { LoggedInFilter } from './auth/logged-in-filter.js'
import { Login } from './auth/login.js'
import { Signup } from './auth/signup.js'
import { ConnectedDialogOverlay } from './dialogs/connected-dialog-overlay.js'
import { usePixelShover } from './dom/pixel-shover.js'
import { DownloadPage } from './download/download-page.js'
import { UpdateOverlay } from './download/update-overlay.js'
import { FileDropZoneProvider } from './file-browser/file-drop-zone.js'
import { KeyListenerBoundary } from './keyboard/key-listener.js'
import { Faq } from './landing/faq.js'
import { Splash } from './landing/splash.js'
import { LoadingFilter } from './loading/loading-filter.js'
import { LoggedOutContent } from './logged-out-content.js'
import { logger } from './logging/logger.js'
import { MainLayout } from './main-layout.js'
import { LoginRoute } from './navigation/custom-routes.js'
import { UNAUTHORIZED_EMITTER } from './network/fetch.js'
import { createGraphqlClient } from './network/graphql-client.js'
import { SiteConnectedFilter } from './network/site-connected-filter.js'
import {
  AcceptableUsePage,
  PrivacyPolicyPage,
  TermsOfServicePage,
} from './policies/policy-displays.js'
import { LoadingDotsArea } from './progress/dots.js'
import { useAppDispatch, useAppSelector } from './redux-hooks.js'
import { RootErrorBoundary } from './root-error-boundary.js'
import { getServerConfig } from './server-config-storage.js'
import { ConnectedSettings } from './settings/settings.js'
import ConnectedSnackbar from './snackbars/connected-snackbar.js'
import GlobalStyle from './styles/global.js'
import ResetStyle from './styles/reset.js'

const IS_PRODUCTION = __WEBPACK_ENV.NODE_ENV === 'production'

const DevComponent = IS_PRODUCTION ? () => null : React.lazy(() => import('./dev.js'))

function LoadableDev() {
  return (
    <React.Suspense fallback={<LoadingDotsArea />}>
      <DevComponent />
    </React.Suspense>
  )
}

const LoadableWindowControls = IS_ELECTRON
  ? React.lazy(async () => ({
      default: (await import('./system-bar/window-controls.js')).WindowControls,
    }))
  : () => null

const LoadableSystemBar = IS_ELECTRON
  ? React.lazy(async () => ({ default: (await import('./system-bar/system-bar.js')).SystemBar }))
  : () => null

function RedirectOnUnauthorized() {
  const dispatch = useAppDispatch()

  useEffect(() => {
    const handler = (url: string) => {
      logger.debug(`Got 401 Unauthorized response for: ${url}, removing active user session`)
      dispatch(revokeSession())
    }

    UNAUTHORIZED_EMITTER.on('unauthorized', handler)

    return () => {
      UNAUTHORIZED_EMITTER.removeListener('unauthorized', handler)
    }
  }, [dispatch])

  return null
}

function MainContent() {
  const [matchesRoot] = useRoute('/')
  const loggedIn = useIsLoggedIn()

  if (matchesRoot) {
    if (!IS_ELECTRON && !loggedIn) {
      return <Splash />
    }
  }

  const loggedInContent = (
    <LoggedInFilter>
      <>
        <RedirectOnUnauthorized />
        <SiteConnectedFilter>
          <LoadingFilter>
            <MainLayout />
          </LoadingFilter>
        </SiteConnectedFilter>
      </>
    </LoggedInFilter>
  )

  return loggedIn ? loggedInContent : <LoggedOutContent loggedInContent={loggedInContent} />
}

/**
 * Returns the current GraphQL client, recreating it if the current user changes. This ensures that
 * any user-specific data in the caches is cleared out.
 */
function useUserSpecificGraphqlClient() {
  const currentUserId = useAppSelector(s => s.auth.self?.user.id)
  const [urqlClient, setUrqlClient] = useState<ReturnType<typeof createGraphqlClient>>(() =>
    createGraphqlClient(getServerConfig()),
  )

  useEffect(() => {
    setUrqlClient(createGraphqlClient(getServerConfig()))
  }, [currentUserId])

  return urqlClient
}

export default function App() {
  const [shoveX, shoveY] = usePixelShover()
  useLayoutEffect(() => {
    document.body.style.setProperty('--pixel-shove-x', `${shoveX}px`)
    document.body.style.setProperty('--pixel-shove-y', `${shoveY}px`)
  }, [shoveX, shoveY])
  const graphqlClient = useUserSpecificGraphqlClient()

  return (
    <StyleSheetManager enableVendorPrefixes={!IS_ELECTRON}>
      <>
        <ResetStyle />
        <GlobalStyle />
        <LoadableWindowControls />
        <LoadableSystemBar />
        <KeyListenerBoundary>
          <RootErrorBoundary>
            <UrqlProvider value={graphqlClient}>
              <FileDropZoneProvider>
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
                    {!IS_PRODUCTION ? <Route path='/dev/*?' component={LoadableDev} /> : <></>}
                    <Route>
                      <MainContent />
                    </Route>
                  </Switch>
                  <ConnectedSettings />
                  <ConnectedSnackbar />
                  <ConnectedDialogOverlay />
                </React.Suspense>
              </FileDropZoneProvider>
            </UrqlProvider>
          </RootErrorBoundary>
          <UpdateOverlay />
        </KeyListenerBoundary>
      </>
    </StyleSheetManager>
  )
}
