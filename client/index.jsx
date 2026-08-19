import { enableArrayMethods, enableMapSet } from 'immer'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { TypedIpcRenderer } from '../common/ipc'
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

const isDev = import.meta.env.DEV

// eslint-disable-next-line camelcase
window.__webpack_nonce__ = window.SB_CSP_NONCE

enableArrayMethods()
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

if (isDev) {
  // The panel library behind jotai-devtools injects a `<style>` for its drag cursor without a
  // nonce, which our style-src blocks. It appends the element empty and fills it afterwards, so the
  // violation names an empty-content hash and points at whoever appended it rather than at the
  // library.
  //
  // Every un-nonced style gets one, rather than identifying the source from the call stack: a dev
  // server that pre-bundles dependencies puts the package inside a bundled chunk, so the stack
  // names the chunk and matching on a package name silently stops working.
  const headAppendChild = document.head.appendChild.bind(document.head)
  document.head.appendChild = elem => {
    if (elem.tagName === 'STYLE' && !elem.getAttribute('nonce')) {
      elem.setAttribute('nonce', window.SB_CSP_NONCE)
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

audioManager.initialize()

rootElemPromise
  .then(async elem => {
    // Loaded here rather than at module scope so the import can be dynamic: the bundler drops it
    // from builds where this branch is statically false, which is every non-Electron build.
    let ReduxDevTools
    if (IS_ELECTRON && import.meta.env.DEV) {
      ReduxDevTools = (await import('./debug/redux-devtools')).DevTools
    }

    const reduxStore = createStore(ReduxDevTools)
    if (import.meta.env.DEV) {
      // Expose these for dev verification tooling (CDP-driven assertions on app state, and
      // querying the debug-only state of a running game process); compiled out of production
      // bundles.
      window.__sbReduxStore = reduxStore
      window.__sbDebugGame = {
        queryGameState: gameId =>
          new TypedIpcRenderer().invoke('activeGameDebugQueryState', gameId),
        forceUnsyncedLeave: (gameId, slot) =>
          new TypedIpcRenderer().invoke('activeGameForceUnsyncedLeave', gameId, slot),
        forceDesync: gameId => new TypedIpcRenderer().invoke('activeGameForceDesync', gameId),
        sendChat: (gameId, text) =>
          new TypedIpcRenderer().invoke('activeGameSendChat', gameId, text),
        requestDrop: (gameId, slot) =>
          new TypedIpcRenderer().invoke('activeGameRequestDrop', gameId, slot),
        toggleNetStats: gameId => new TypedIpcRenderer().invoke('activeGameToggleNetStats', gameId),
        forceQuit: gameId => new TypedIpcRenderer().invoke('activeGameForceQuit', gameId),
        screenshot: gameId => new TypedIpcRenderer().invoke('activeGameDebugScreenshot', gameId),
      }
    }
    registerDispatch(reduxStore.dispatch)
    await registerSocketHandlers()

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

    // The main process holds back startup-sensitive events (e.g. replay files passed as launch
    // args) until this, since anything it sends before our IPC listeners exist is dropped.
    new TypedIpcRenderer().send('rendererReady')
  })
