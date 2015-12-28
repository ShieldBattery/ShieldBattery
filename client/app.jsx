import React from 'react'
import createStore from './create-store'
import routes from './routes.jsx'
import { Provider } from 'react-redux'
import { registerDispatch } from './dispatch-registry'
import { fromJS as authFromJS } from './auth/auth-records'
import { Router } from 'react-router'
import { createHistory } from 'history'
import { syncReduxAndRouter } from 'redux-simple-router'

const initData = window._sbInitData
if (initData && initData.auth) {
  initData.auth = authFromJS(initData.auth)
}

const store = createStore(initData)
registerDispatch(store.dispatch)
const history = createHistory()
syncReduxAndRouter(history, store, state => state.router)

import './network/socket-handlers'

export default class App extends React.Component {
  render() {
    return (
      <Provider store={store}>
        <Router history={history}>
          {routes}
        </Router>
      </Provider>
    )
  }
}
