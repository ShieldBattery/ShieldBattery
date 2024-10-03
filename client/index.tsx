import { enableMapSet, setAutoFreeze } from 'immer'
import React from 'react'
import { createRoot } from 'react-dom/client'
import { Provider as ReduxProvider } from 'react-redux'
import { Router } from 'wouter'
import { getErrorStack } from '../common/errors.js'
import { ServerConfig } from '../common/server-config.js'
import { AUDIO_MANAGER_INITIALIZED } from './actions.js'
import App from './app.js'
import audioManager from './audio/audio-manager.js'
import { getCurrentSession } from './auth/action-creators.js'
import { initBrowserprint } from './auth/browserprint.js'
import createStore from './create-store.js'
import { dispatch, registerDispatch, ThunkAction } from './dispatch-registry.js'
import i18n, { detectedLocale, initI18next } from './i18n/i18next.js'
import { getBestLanguage } from './i18n/language-detector.js'
import log from './logging/logger.js'
import { fetchJson } from './network/fetch.js'
import registerSocketHandlers from './network/socket-handlers.js'
import { RootErrorBoundary } from './root-error-boundary.js'
import { setServerConfig } from './server-config-storage.js'
import './window-focus.js'

const isDev = __WEBPACK_ENV.NODE_ENV !== 'production'

enableMapSet()
setAutoFreeze(isDev)

window.addEventListener('error', event => {
  const messageText = event.error?.message ?? event.message
  if (messageText === 'ResizeObserver loop limit exceeded') {
    // NOTE(tec27): This error is not really an error and is something that unavoidably happens
    // with ResizeObservers in Chromium sometimes, *shrug*
    return
  }
  log.error(`JavaScript error in Renderer: ${messageText}\nStack: ${event.error?.stack}`)
})
window.addEventListener('unhandledrejection', event => {
  log.warning(
    `Unhandled rejection in Renderer: ${event.reason?.message}\n${
      event.reason?.stack ?? event.reason
    }`,
  )
})

const rootElemPromise = new Promise<HTMLElement>((resolve, reject) => {
  const elem = document.getElementById('app')
  if (elem) {
    resolve(elem)
    return
  }

  document.addEventListener('DOMContentLoaded', e => {
    const elem = document.getElementById('app')
    if (elem) {
      resolve(elem)
    } else {
      reject(new Error('app element could not be found'))
    }
  })
})

const initAudioPromise = audioManager.initialize()
if (!IS_ELECTRON) {
  initBrowserprint()
}

rootElemPromise
  .then(async elem => {
    const store = createStore()
    registerDispatch(store.dispatch)
    registerSocketHandlers()

    initAudioPromise
      .then(() => {
        store.dispatch({ type: AUDIO_MANAGER_INITIALIZED })
      })
      .catch(err => {
        log.error(`Error initializing audio manager: ${getErrorStack(err)}`)
      })

    const detected = getBestLanguage()
    detectedLocale.setValue(Array.isArray(detected) ? detected[0] : detected)

    let action: ThunkAction | undefined
    const configPromise = fetchJson<ServerConfig>('/config')
    // TODO(tec27): Could use a service worker to add the auth header to non-fetch requests to get
    // this working + avoid the extra request for logged out users
    const sessionPromise = new Promise<void>((resolve, reject) => {
      action = getCurrentSession(
        { locale: detectedLocale.getValue() },
        {
          onSuccess: () => resolve(),
          onError: err => reject(err),
        },
      )
    })

    store.dispatch(action)

    try {
      const config = await configPromise
      setServerConfig(config)
    } catch (err) {
      // Ignoring the error here shouldn't be that big of a deal since the config is usually cached
      // in the client's local storage anyway. But also, most config properties should have some
      // default values to fall back on to ensure things don't break.
      log.warning(`An error when retrieving the server config: ${getErrorStack(err)}`)
    }

    const i18nextPromise = initI18next()

    try {
      await sessionPromise
    } catch (err) {
      // Ignored, usually just means we don't have a current session
      // TODO(tec27): Probably we should handle some error codes here specifically
    }

    try {
      await i18nextPromise
      let locale
      ;(store.dispatch as typeof dispatch)((_, getState) => {
        const {
          auth: { self },
        } = getState()
        locale = self?.user?.locale
      })

      if (locale) {
        await i18n.changeLanguage(getBestLanguage([locale]))
      }
    } catch (err) {
      log.error(`Error initializing i18next: ${getErrorStack(err)}`)
    }

    return { elem, store }
  })
  .then(({ elem, store }) => {
    const root = createRoot(elem)

    // Track the initial page load with normal referer info
    window.fathom?.trackPageview()

    root.render(
      <RootErrorBoundary>
        <ReduxProvider store={store}>
          <Router>
            <>
              <App />
            </>
          </Router>
        </ReduxProvider>
      </RootErrorBoundary>,
    )
  })
  .catch(err => {
    log.error(`Error initializing app: ${getErrorStack(err)}`)
  })
