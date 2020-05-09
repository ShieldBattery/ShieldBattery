import React from 'react'
import { render } from 'react-dom'
import { Provider } from 'react-redux'
import { ConnectedRouter } from 'connected-react-router'
import { createBrowserHistory, createHashHistory } from 'history'

import log from './logging/logger'
import { makeServerUrl } from './network/server-url'
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
  // Necessary to make Google Analytics work, since it wants to store/read a cookie but we're on a
  // file:// origin (so that's not possible)
  const ElectronCookies = require('@exponent/electron-cookies')
  ElectronCookies.enable({ origin: makeServerUrl('') })
}

if (module.hot) {
  // Dumb hack to make HMR work with CSP. The HMR runtime blindly inserts scripts into the head
  // without adding the nonce (even though they use the nonce for style-loader? sigh). Anyway, we
  // hook `appendChild` on the head, check if it's trying to insert a script, and if so we add the
  // appropriate attribute before doing it.
  const appendChild = document.head.appendChild.bind(document.head)
  document.head.appendChild = elem => {
    if (elem.tagName === 'SCRIPT' && new Error().stack.includes('at hotDownloadUpdateChunk')) {
      // eslint-disable-next-line no-undef,camelcase
      elem.setAttribute('nonce', __webpack_nonce__)
    }

    appendChild(elem)
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
      initData.auth = authFromJS(initData.auth)
    }

    const history = !IS_ELECTRON ? createBrowserHistory() : createHashHistory()
    const store = createStore(initData, history)
    registerDispatch(store.dispatch)
    registerSocketHandlers()

    initAudioPromise.then(() => {
      store.dispatch({ type: AUDIO_MANAGER_INITIALIZED })
    })

    return { elem, store, history }
  })
  .then(async ({ elem, store, history }) => {
    let analyticsId = window._sbAnalyticsId
    if (IS_ELECTRON) {
      const configPromise = fetch('/config', { method: 'get' })
      const { action, promise: sessionPromise } = getCurrentSession()
      store.dispatch(action)
      try {
        const [config] = await Promise.all([configPromise, sessionPromise])
        analyticsId = config.analyticsId
        window._sbFeedbackUrl = config.feedbackUrl
      } catch (err) {
        // Ignored, usually just means we don't have a current session
      }
    }
    return { elem, store, history, analyticsId }
  })
  .then(({ elem, store, history, analyticsId }) => {
    render(
      <Provider store={store}>
        <ConnectedRouter history={history}>
          <RedirectProvider>
            <App analyticsId={analyticsId} />
          </RedirectProvider>
        </ConnectedRouter>
      </Provider>,
      elem,
    )
  })
