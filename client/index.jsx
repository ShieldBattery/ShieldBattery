import { enableMapSet } from 'immer'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { AUDIO_MANAGER_INITIALIZED } from './actions'
import { App } from './app'
import { audioManager } from './audio/audio-manager'
import { bootstrapSession, getCurrentSession } from './auth/action-creators'
import createStore from './create-store'
import { registerDispatch } from './dispatch-registry'
import './dom/window-focus'
import i18n, { detectedLocale, initI18next } from './i18n/i18next'
import { getBestLanguage } from './i18n/language-detector'
import log from './logging/logger'
import { fetchJson } from './network/fetch'
import registerSocketHandlers from './network/socket-handlers'
import { setServerConfig } from './server-config-storage'

// NOTE(tec27): Webpack seems to fail to utilize this in removing falsy conditional requires, so
// only use this for checks intended to happen at runtime
const isDev = __WEBPACK_ENV.NODE_ENV !== 'production'

// eslint-disable-next-line camelcase
window.__webpack_nonce__ = window.SB_CSP_NONCE

enableMapSet()

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

let ReduxDevTools
if (IS_ELECTRON && __WEBPACK_ENV.NODE_ENV !== 'production') {
  const devtools = require('./debug/redux-devtools')
  ReduxDevTools = devtools.DevTools
}

if (module.hot) {
  // Dumb hack to make HMR work with CSP. The webpack-hot-middleware runtime blindly inserts scripts
  // into the head without adding the nonce, with no real way to catch this easily. Anyway, we
  // hook `appendChild` on the head, check if it's trying to insert a script, and if so we add the
  // appropriate attribute before doing it.
  const headAppendChild = document.head.appendChild.bind(document.head)
  document.head.appendChild = elem => {
    if (elem.tagName === 'SCRIPT' && new Error().stack.includes('__webpack_require__')) {
      elem.setAttribute('nonce', __webpack_nonce__)
    }

    return headAppendChild(elem)
  }

  const bodyAppendChild = document.body.appendChild.bind(document.body)
  document.body.appendChild = elem => {
    if (elem.id === 'webpack-hot-middleware-clientOverlay') {
      elem.setAttribute('nonce', __webpack_nonce__)
    }

    return bodyAppendChild(elem)
  }
}

if (isDev) {
  // Fix for react-resizable-panels not getting a proper nonce from jotai-devtools
  const headAppendChild = document.head.appendChild.bind(document.head)
  document.head.appendChild = elem => {
    if (elem.tagName === 'STYLE' && !elem.getAttribute('nonce')) {
      if (new Error().stack.includes('react-resizable-panels')) {
        elem.setAttribute('nonce', __webpack_nonce__)
      }
    }
    return headAppendChild(elem)
  }
  // Remove annoying log
  const consoleWarn = console.warn.bind(console)
  console.warn = (...args) => {
    if (args.length > 0) {
      const firstArg = args[0]
      if (
        typeof firstArg === 'string' &&
        firstArg.startsWith('[jotai-devtools]: automatic tree-shaking')
      ) {
        return
      }
    }

    consoleWarn(...args)
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

rootElemPromise
  .then(async elem => {
    const reduxStore = createStore(ReduxDevTools)
    registerDispatch(reduxStore.dispatch)
    registerSocketHandlers()

    initAudioPromise.then(() => {
      reduxStore.dispatch({ type: AUDIO_MANAGER_INITIALIZED })
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

    reduxStore.dispatch(action)

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
      reduxStore.dispatch((_, getState) => {
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

    return { elem, reduxStore }
  })
  .then(({ elem, reduxStore }) => {
    // Track the initial page load with normal referer info
    window.fathom?.trackPageview()

    const root = createRoot(elem)
    root.render(
      <StrictMode>
        <App reduxStore={reduxStore} />
      </StrictMode>,
    )
  })
