import './styles/reset.css'
import './styles/global.css'
import 'babel-polyfill'

import React from 'react'
import { render } from 'react-dom'
import { Provider } from 'react-redux'
import { useRouterHistory } from 'react-router'
import { syncHistoryWithStore } from 'react-router-redux'
import { createHistory, createHashHistory } from 'history'
import createStore from './create-store'
import { registerDispatch } from './dispatch-registry'
import { fromJS as authFromJS } from './auth/auth-records'
import registerSocketHandlers from './network/socket-handlers'
import App from './app.jsx'
import RedirectProvider from './navigation/redirect-provider.jsx'

// initialize socket
import './network/psi-socket'

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

  let history = useRouterHistory(process.env.SB_ENV === 'web' ? createHistory : createHashHistory)()
  const store = createStore(initData, history)
  history = syncHistoryWithStore(history, store, {
    // Since we're using a custom reducer, we have to adjust the state to be shaped like
    // react-router-redux expects
    selectLocationState: ({ routing }) => ({ locationBeforeTransitions: routing.location })
  })
  registerDispatch(store.dispatch)
  registerSocketHandlers()

  return { elem, store, history }
}).then(({elem, store, history}) => {
  render(
    <Provider store={store}>
      <RedirectProvider>
        <App history={history}/>
      </RedirectProvider>
    </Provider>, elem)
})
