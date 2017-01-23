import './styles/reset.css'
import './styles/global.css'
import 'babel-polyfill'
import log from './logging/logger'

if (process.webpackEnv.SB_ENV === 'electron') {
  process.on('uncaughtException', function(err) {
    console.error(err.stack)
    log.error(err.stack)
    // TODO(tec27): We used to exit here, what's the right thing now? Close window? Show error
    // dialog to user?
  }).on('unhandledRejection', function(err) {
    log.error(err.stack)
    if (err instanceof TypeError || err instanceof SyntaxError || err instanceof ReferenceError) {
      // TODO(tec27): We used to exit here, what's the right thing now? Close window? Show error
      // dialog to user?
    }
    // Other promise rejections are likely less severe, leave the process up but log it
  })

  require('./active-game/game-server')
}

import React from 'react'
import { render } from 'react-dom'
import { Provider } from 'react-redux'
import { useRouterHistory } from 'react-router'
import { syncHistoryWithStore } from 'react-router-redux'
import { createHistory, createHashHistory } from 'history'
import createStore from './create-store'
import { registerDispatch } from './dispatch-registry'
import { fromJS as authFromJS } from './auth/auth-records'
import { getCurrentSession } from './auth/auther'
import registerSocketHandlers from './network/socket-handlers'
import App from './app.jsx'
import RedirectProvider from './navigation/redirect-provider.jsx'

new Promise((resolve, reject) => {
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
}).then(elem => {
  const initData = window._sbInitData
  if (initData && initData.auth) {
    initData.auth = authFromJS(initData.auth)
  }

  let history = useRouterHistory(process.webpackEnv.SB_ENV === 'web' ?
      createHistory : createHashHistory)()
  const store = createStore(initData, history)
  history = syncHistoryWithStore(history, store, {
    // Since we're using a custom reducer, we have to adjust the state to be shaped like
    // react-router-redux expects
    selectLocationState: ({ routing }) => ({ locationBeforeTransitions: routing.location })
  })
  registerDispatch(store.dispatch)
  registerSocketHandlers()

  return { elem, store, history }
}).then(async ({ elem, store, history }) => {
  if (process.webpackEnv.SB_ENV !== 'web') {
    const { action, promise } = getCurrentSession()
    store.dispatch(action)
    try {
      await promise
    } catch (err) {
      // Ignored, usually just means we don't have a current session
    }
  }
  return { elem, store, history }
}).then(({elem, store, history}) => {
  render(
    <Provider store={store}>
      <RedirectProvider>
        <App history={history}/>
      </RedirectProvider>
    </Provider>, elem)
})
