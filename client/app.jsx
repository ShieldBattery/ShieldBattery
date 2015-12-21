import React from 'react'
import Immutable from 'immutable'
import { applyMiddleware, createStore, combineReducers, compose } from 'redux'
import thunk from 'redux-thunk'
import promise from 'redux-promise'
import { reduxReactRouter, ReduxRouter } from 'redux-router'
import { batchedUpdatesMiddleware } from './dom/batched-updates'
import { Provider } from 'react-redux'
import { createHistory } from 'history'
import routes from './routes.jsx'
import * as reducers from './reducers'
import { registerDispatch } from './dispatch-registry'
import { fromJS as authFromJS } from './auth/auth-records'

const initData = window._sbInitData
if (initData && initData.auth) {
  initData.auth = authFromJS(initData.auth)
}

const isDev = (process.env.NODE_ENV || 'development') === 'development'
const topLevelReducer = combineReducers(reducers)
const createMiddlewaredStore = compose(
    applyMiddleware(thunk, promise, batchedUpdatesMiddleware),
    reduxReactRouter({ routes, createHistory }),
    // Support for https://github.com/zalmoxisus/redux-devtools-extension
    isDev && window.devToolsExtension ? window.devToolsExtension() : f => f
)(createStore)
const store = createMiddlewaredStore(topLevelReducer, initData)
registerDispatch(store.dispatch)

import './network/socket-handlers'

if (module.hot) {
  module.hot.accept('./reducers', () => {
    const nextRootReducer = require('./reducers')
    store.replaceReducer(nextRootReducer)
  })
}

export default class App extends React.Component {
  render() {
    return <Provider store={store}><ReduxRouter routes={routes}/></Provider>
  }
}
