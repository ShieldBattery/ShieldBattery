import { Provider as JotaiProvider } from 'jotai'
import { LazyMotion, MotionConfig, Transition } from 'motion/react'
import React, { Suspense, useEffect, useLayoutEffect, useState } from 'react'
import { Provider as ReduxProvider } from 'react-redux'
import { Store } from 'redux'
import { StyleSheetManager } from 'styled-components'
import { Provider as UrqlProvider } from 'urql'
import { Route, Router, Switch } from 'wouter'
import { AppRoutes } from './app-routes'
import { revokeSession } from './auth/action-creators'
import { useSelfUser } from './auth/auth-utils'
import { ConnectedDialogOverlay } from './dialogs/connected-dialog-overlay'
import './dom/window-focus'
import { UpdateOverlay } from './download/update-overlay'
import { FileDropZoneProvider } from './file-browser/file-drop-zone'
import { getJotaiStore } from './jotai-store'
import { KeyListenerBoundary } from './keyboard/key-listener'
import { logger } from './logging/logger'
import { MainLayout, MainLayoutContent, MainLayoutLoadingDotsArea } from './main-layout'
import { UNAUTHORIZED_EMITTER } from './network/fetch'
import { createGraphqlClient } from './network/graphql-client'
import { SiteSocketManager } from './network/site-socket-manager'
import { LoadingDotsArea } from './progress/dots'
import { useAppDispatch, useAppSelector } from './redux-hooks'
import { RootErrorBoundary } from './root-error-boundary'
import { RootState } from './root-reducer'
import { getServerConfig } from './server-config-storage'
import { ConnectedSettings } from './settings/settings'
import { SnackbarOverlay } from './snackbars/snackbar-overlay'
import GlobalStyle from './styles/global'
import ResetStyle from './styles/reset'

const IS_PRODUCTION = __WEBPACK_ENV.NODE_ENV === 'production'

const JotaiDevTools =
  __WEBPACK_ENV.NODE_ENV === 'production'
    ? undefined
    : React.lazy(() => import('./debug/jotai-devtools').then(m => ({ default: m.JotaiDevTools })))

let ReduxDevToolsContainer: any
if (IS_ELECTRON && __WEBPACK_ENV.NODE_ENV !== 'production') {
  const devtools = require('./debug/redux-devtools')
  ReduxDevToolsContainer = devtools.default
}

const DevComponent =
  __WEBPACK_ENV.NODE_ENV === 'production' ? () => null : React.lazy(() => import('./dev'))

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

export interface AppProps {
  reduxStore: Store<RootState>
}

export function App({ reduxStore }: AppProps) {
  return (
    <RootErrorBoundary isVeryTopLevel={true}>
      <JotaiProvider store={getJotaiStore()}>
        <ReduxProvider store={reduxStore}>
          <Suspense fallback={<LoadingDotsArea />}>
            <InnerApp />
            {ReduxDevToolsContainer ? <ReduxDevToolsContainer /> : null}
            {JotaiDevTools ? <JotaiDevTools /> : null}
          </Suspense>
        </ReduxProvider>
      </JotaiProvider>
    </RootErrorBoundary>
  )
}

function InnerApp() {
  const graphqlClient = useUserSpecificGraphqlClient()
  useLayoutEffect(() => {
    // Calculate the scrollbar width and set it as a CSS variable so other styles can use it. We
    // directly control this on webkit-ish browsers, but Firefox doesn't have a way of directly
    // specifying the scrollbar width so...

    const outer = document.createElement('div')
    outer.style.visibility = 'hidden'
    outer.style.position = 'fixed'
    outer.style.width = '100px'
    outer.style.overflow = 'scroll'
    document.body.appendChild(outer)

    const inner = document.createElement('div')
    inner.style.width = '100%'
    outer.appendChild(inner)
    const scrollbarWidth = outer.offsetWidth - inner.offsetWidth
    document.body.removeChild(outer)

    document.body.style.setProperty('--scrollbar-width', `${scrollbarWidth}px`)
  }, [])

  return (
    <Router>
      <StyleSheetManager enableVendorPrefixes={!IS_ELECTRON}>
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
    </Router>
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

  // NOTE(tec27): The delay on the transition gives the route a second to settle before we show it,
  // this reduces some of the visual layout changes
  return (
    <MainLayout key={selfUser?.id ?? -1}>
      <React.Suspense fallback={<MainLayoutLoadingDotsArea />}>
        <AppRoutes
          container={
            <MainLayoutContent
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.3, ease: 'linear', delay: 0.1 }}
            />
          }
        />
      </React.Suspense>
    </MainLayout>
  )
}
