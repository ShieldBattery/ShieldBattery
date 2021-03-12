import React from 'react'
import { render } from 'react-dom'
import { Provider } from 'react-redux'
import { ConnectedRouter } from 'connected-react-router'
import { createBrowserHistory } from 'history'

import log from './logging/logger'
import createStore from './create-store'
import { registerDispatch } from './dispatch-registry'
import { fromJs as authFromJs } from './auth/auth-records'
import { getCurrentSession } from './auth/action-creators'
import registerSocketHandlers from './network/socket-handlers'
import App from './app'
import RedirectProvider from './navigation/redirect-provider'
import fetch from './network/fetch'
import audioManager from './audio/audio-manager-instance'
import { AUDIO_MANAGER_INITIALIZED } from './actions'

const isDev = __WEBPACK_ENV.NODE_ENV !== 'production'

if (IS_ELECTRON) {
  process
    .on('uncaughtException', function (err) {
      console.error(err.stack)
      log.error(err.stack)
      // TODO(tec27): We used to exit here, what's the right thing now? Close window? Show error
      // dialog to user?
    })
    .on('unhandledRejection', function (err) {
      log.error(err.stack)
      if (err instanceof TypeError || err instanceof SyntaxError || err instanceof ReferenceError) {
        // TODO(tec27): We used to exit here, what's the right thing now? Close window? Show error
        // dialog to user?
      }
      // Other promise rejections are likely less severe, leave the process up but log it
    })
}

window.addEventListener('error', event => {
  log.error(`JavaScript error in Renderer:\n${event.error?.stack ?? event.error}`)
})
window.addEventListener('unhandledrejection', event => {
  log.warning(`Unhandled rejection in Renderer:\n${event.reason?.stack ?? event.reason}`)
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
    if (elem.tagName === 'SCRIPT' && new Error().stack.includes('at hotDownloadUpdateChunk')) {
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

const initAudioPromise = audioManager ? audioManager.initialize() : Promise.resolve()

Promise.all([rootElemPromise])
  .then(async ([elem]) => {
    const initData = window._sbInitData
    if (initData && initData.auth) {
      initData.auth = authFromJs(initData.auth)
    }

    const history = createBrowserHistory()
    const store = createStore(initData, history, ReduxDevTools)
    registerDispatch(store.dispatch)
    registerSocketHandlers()

    initAudioPromise.then(() => {
      store.dispatch({ type: AUDIO_MANAGER_INITIALIZED })
    })

    return { elem, store, history }
  })
  .then(async ({ elem, store, history }) => {
    const configPromise = fetch('/config', { method: 'get' })
    const { action, promise: sessionPromise } = getCurrentSession()
    store.dispatch(action)
    try {
      const [config] = await Promise.all([configPromise, sessionPromise])
      window._sbFeedbackUrl = config.feedbackUrl
    } catch (err) {
      // Ignored, usually just means we don't have a current session
    }
    return { elem, store, history }
  })
  .then(({ elem, store, history }) => {
    render(
      <Provider store={store}>
        <ConnectedRouter history={history}>
          <RedirectProvider>
            <>
              <App />
              {ReduxDevToolsContainer ? <ReduxDevToolsContainer /> : null}
            </>
          </RedirectProvider>
        </ConnectedRouter>
      </Provider>,
      elem,
    )
  })
