import './styles/reset.css'
import './styles/global.css'

import React from 'react'
import { render } from 'react-dom'
import { Provider } from 'react-redux'
import { createHistory } from 'history'
import { syncReduxAndRouter } from 'redux-simple-router'
import createStore from './create-store'
import { registerDispatch } from './dispatch-registry'
import { fromJS as authFromJS } from './auth/auth-records'
import registerSocketHandlers from './network/socket-handlers'
import App from './app.jsx'

// initialize socket
import './network/psi-socket'

new Promise((resolve, reject) => {
  const elem = document.getElementById('app')
  if (elem) return resolve(elem)

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

  const store = createStore(initData)
  registerDispatch(store.dispatch)

  const history = createHistory()
  syncReduxAndRouter(history, store, state => state.router)

  registerSocketHandlers()

  return { elem, store, history }
}).then(({elem, store, history}) => {
  render(<Provider store={store}><App history={history}/></Provider>, elem)
})
