import React from 'react'
import { render } from 'react-dom'
import { Provider } from 'react-redux'
import { ConnectedRouter } from 'connected-react-router'
import { createBrowserHistory, createHashHistory } from 'history'

import log from './logging/logger'
import createStore from './create-store'
import { registerDispatch } from './dispatch-registry'
import { fromJS as authFromJS } from './auth/auth-records'
import { getCurrentSession } from './auth/auther'
import registerSocketHandlers from './network/socket-handlers'
import App from './app.jsx'
import RedirectProvider from './navigation/redirect-provider.jsx'
import fetch from './network/fetch'
import audioManager from './audio/audio-manager-instance'
import { AUDIO_MANAGER_INITIALIZED } from './actions'

const isDev = (__WEBPACK_ENV.NODE_ENV || 'development') === 'development'

// A helper function which adds nonce to third party scripts/styles. We hook `appendChild` on the
// head, check if it's trying to insert a `tagName` and if the error contains a given string. If so,
// we add the nonce attribute before doing it.
const addNonceToThirdParty = (tagName, errorStringMatch = '') => {
  const appendChild = document.head.appendChild.bind(document.head)
  document.head.appendChild = elem => {
    if (elem.tagName === tagName && new Error().stack.includes(errorStringMatch)) {
      // eslint-disable-next-line no-undef,camelcase
      elem.setAttribute('nonce', __webpack_nonce__)
    }

    return appendChild(elem)
  }
}

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

  require('./active-game/game-server')
}

if (module.hot) {
  // Dumb hack to make HMR work with CSP. The webpack-hot-middleware runtime blindly inserts scripts
  // into the head without adding the nonce, with no real way to catch this easily.
  addNonceToThirdParty('SCRIPT', 'at hotDownloadUpdateChunk')
}

let ReduxDevTools
if (IS_ELECTRON && isDev) {
  ReduxDevTools = require('./debug/redux-devtools.jsx').default

  // Dumb hack to make redux devtools inspector monitor to work with CSP. The inspector blindly
  // inserts styles into the head without adding the nonce, with no real way to catch this easily.
  addNonceToThirdParty('STYLE', 'at new DevtoolsInspector')
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
      initData.auth = authFromJS(initData.auth)
    }

    const history = !IS_ELECTRON ? createBrowserHistory() : createHashHistory()
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
              {ReduxDevTools ? <ReduxDevTools /> : null}
            </>
          </RedirectProvider>
        </ConnectedRouter>
      </Provider>,
      elem,
    )
  })
