import { enableMapSet, setAutoFreeze } from 'immer'
import React from 'react'
import { createRoot } from 'react-dom/client'
import { Provider as ReduxProvider } from 'react-redux'
import { Router } from 'wouter'
import { AUDIO_MANAGER_INITIALIZED } from './actions.js'
import App from './app.js'
import audioManager from './audio/audio-manager.js'
import { bootstrapSession, getCurrentSession } from './auth/action-creators.js'
import { initBrowserprint } from './auth/browserprint.js'
import createStore from './create-store.js'
import { registerDispatch } from './dispatch-registry.js'
import i18n, { detectedLocale, initI18next } from './i18n/i18next.js'
import { getBestLanguage } from './i18n/language-detector.js'
import log from './logging/logger.js'
import { fetchJson } from './network/fetch.js'
import registerSocketHandlers from './network/socket-handlers.js'
import { RootErrorBoundary } from './root-error-boundary.js'
import { setServerConfig } from './server-config-storage.js'
import './window-focus.js'

const isDev = __WEBPACK_ENV.NODE_ENV !== 'production'

// eslint-disable-next-line camelcase
window.__webpack_nonce__ = window.SB_CSP_NONCE

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

let ReduxDevTools, ReduxDevToolsContainer
if (IS_ELECTRON && isDev) {
  const devtools = require('./debug/redux-devtools')
  ReduxDevToolsContainer = devtools.default
  ReduxDevTools = devtools.DevTools
}

if (module.hot) {
  // Dumb hack to make HMR work with CSP. The webpack-hot-middleware runtime blindly inserts scripts
  // into the head without adding the nonce, with no real way to catch this easily. Anyway, we
  // hook `appendChild` on the head, check if it's trying to insert a script, and if so we add the
  // appropriate attribute before doing it.
  const appendChild = document.head.appendChild.bind(document.head)
  document.head.appendChild = elem => {
    if (elem.tagName === 'SCRIPT' && new Error().stack.includes('__webpack_require__')) {
      // eslint-disable-next-line no-undef,camelcase
      elem.setAttribute('nonce', __webpack_nonce__)
    }

    return appendChild(elem)
  }
}

const rootElemPromise = new Promise((resolve, reject) => {
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
    const store = createStore(ReduxDevTools)
    registerDispatch(store.dispatch)
    registerSocketHandlers()

    initAudioPromise.then(() => {
      store.dispatch({ type: AUDIO_MANAGER_INITIALIZED })
    })

    const detected = getBestLanguage()
    detectedLocale.setValue(Array.isArray(detected) ? detected[0] : detected)

    let action
    let configPromise
    let sessionPromise

    if (!window._sbInitData) {
      configPromise = fetchJson('/config')
    } else {
      configPromise = Promise.resolve(window._sbInitData.serverConfig)
    }

    // TODO(tec27): Could use a service worker to add the auth header to non-fetch requests to get
    // this working + avoid the extra request for logged out users
    if (!window._sbInitData?.session) {
      sessionPromise = new Promise((resolve, reject) => {
        action = getCurrentSession(
          { locale: detectedLocale.getValue() },
          {
            onSuccess: () => resolve(),
            onError: err => reject(err),
          },
        )
      })
    } else {
      sessionPromise = Promise.resolve()
      action = bootstrapSession(window._sbInitData.session)
    }

    store.dispatch(action)

    try {
      const config = await configPromise
      setServerConfig(config)
    } catch (err) {
      // Ignoring the error here shouldn't be that big of a deal since the config is usually cached
      // in the client's local storage anyway. But also, most config properties should have some
      // default values to fall back on to ensure things don't break.
      log.warning(`An error when retrieving the server config: ${err?.stack ?? err}`)
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
      store.dispatch((_, getState) => {
        const {
          auth: { self },
        } = getState()
        locale = self?.user?.locale
      })

      if (locale) {
        await i18n.changeLanguage(getBestLanguage([locale]))
      }
    } catch (err) {
      log.error(`Error initializing i18next: ${err?.stack ?? err}`)
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
              {ReduxDevToolsContainer ? <ReduxDevToolsContainer /> : null}
            </>
          </Router>
        </ReduxProvider>
      </RootErrorBoundary>,
    )
  })
