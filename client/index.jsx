import 'core-js/stable'
import 'regenerator-runtime/runtime'
import log from './logging/logger'
import { makeServerUrl } from './network/server-url'

if (IS_ELECTRON) {
  process
    .on('uncaughtException', function(err) {
      console.error(err.stack)
      log.error(err.stack)
      // TODO(tec27): We used to exit here, what's the right thing now? Close window? Show error
      // dialog to user?
    })
    .on('unhandledRejection', function(err) {
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

import React from 'react'
import { render } from 'react-dom'
import { Provider } from 'react-redux'
import { ConnectedRouter } from 'connected-react-router'
import { createBrowserHistory, createHashHistory } from 'history'

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
import { UPDATE_SERVER, UPDATE_SERVER_COMPLETE } from '../app/common/ipc-constants'

const ipcRenderer = IS_ELECTRON ? require('electron').ipcRenderer : null

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
const updatedServerPromise = new Promise(resolve => {
  if (!ipcRenderer) {
    resolve()
    return
  }

  ipcRenderer.once(UPDATE_SERVER_COMPLETE, () => resolve())
  ipcRenderer.send(UPDATE_SERVER, makeServerUrl(''))
})

const initAudioPromise = audioManager ? audioManager.initialize() : Promise.resolve()

Promise.all([rootElemPromise, updatedServerPromise])
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
