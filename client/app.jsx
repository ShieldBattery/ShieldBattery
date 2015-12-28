import React from 'react'
import { ReduxRouter } from 'redux-router'
import createStore from './create-store'
import { Provider } from 'react-redux'
import { registerDispatch } from './dispatch-registry'
import { fromJS as authFromJS } from './auth/auth-records'

const initData = window._sbInitData
if (initData && initData.auth) {
  initData.auth = authFromJS(initData.auth)
}

const store = createStore(initData)
registerDispatch(store.dispatch)

import './network/socket-handlers'

export default class App extends React.Component {
  render() {
    return <Provider store={store}><ReduxRouter /></Provider>
  }
}
