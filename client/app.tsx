import { LazyMotion, MotionConfig, Transition } from 'motion/react'
import React, { useEffect, useState } from 'react'
import { StyleSheetManager } from 'styled-components'
import { Provider as UrqlProvider } from 'urql'
import { Route, Switch } from 'wouter'
import { AppRoutes } from './app-routes'
import { revokeSession } from './auth/action-creators'
import { useSelfUser } from './auth/auth-utils'
import { ConnectedDialogOverlay } from './dialogs/connected-dialog-overlay'
import { UpdateOverlay } from './download/update-overlay'
import { FileDropZoneProvider } from './file-browser/file-drop-zone'
import { KeyListenerBoundary } from './keyboard/key-listener'
import { logger } from './logging/logger'
import { MainLayout } from './main-layout'
import { UNAUTHORIZED_EMITTER } from './network/fetch'
import { createGraphqlClient } from './network/graphql-client'
import { SiteSocketManager } from './network/site-socket-manager'
import { LoadingDotsArea } from './progress/dots'
import { useAppDispatch, useAppSelector } from './redux-hooks'
import { RootErrorBoundary } from './root-error-boundary'
import { getServerConfig } from './server-config-storage'
import { ConnectedSettings } from './settings/settings'
import { SnackbarOverlay } from './snackbars/snackbar-overlay'
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

const loadMotionFeatures = () => import('./motion-features').then(m => m.domMax)

const DEFAULT_MOTION_CONFIG: Transition = {
  default: { type: 'spring', duration: 0.4, bounce: 0.5 },
  opacity: { type: 'spring', duration: 0.3, bounce: 0 },
}

export default function App() {
  const graphqlClient = useUserSpecificGraphqlClient()

  return (
    <StyleSheetManager disableVendorPrefixes={IS_ELECTRON}>
      <>
        <ResetStyle />
        <GlobalStyle />
        <KeyListenerBoundary>
          <LazyMotion strict={true} features={loadMotionFeatures}>
            <MotionConfig
              reducedMotion='user'
              nonce={(window as any).SB_CSP_NONCE}
              transition={DEFAULT_MOTION_CONFIG}>
              <RootErrorBoundary>
                <UrqlProvider value={graphqlClient}>
                  <FileDropZoneProvider>
                    <React.Suspense fallback={<LoadingDotsArea />}>
                      <SnackbarOverlay>
                        <AppContent />
                      </SnackbarOverlay>
                    </React.Suspense>
                  </FileDropZoneProvider>
                </UrqlProvider>
              </RootErrorBoundary>
              <UpdateOverlay />
            </MotionConfig>
          </LazyMotion>
        </KeyListenerBoundary>
      </>
    </StyleSheetManager>
  )
}

const AppContent = React.memo(() => {
  return (
    <>
      <LoadableWindowControls />
      <LoadableSystemBar />
      <RedirectOnUnauthorized />
      <SiteSocketManager />
      <React.Suspense fallback={<LoadingDotsArea />}>
        <Switch>
          {!IS_PRODUCTION ? <Route path='/dev/*?' component={LoadableDev} /> : <></>}
          <Route>
            <MainLayoutRoute />
          </Route>
        </Switch>
      </React.Suspense>
      <React.Suspense fallback={<LoadingDotsArea />}>
        <ConnectedSettings />
      </React.Suspense>
      <ConnectedDialogOverlay />
    </>
  )
})

function MainLayoutRoute() {
  const selfUser = useSelfUser()

  return (
    <MainLayout key={selfUser?.id ?? -1}>
      <AppRoutes />
    </MainLayout>
  )
}
