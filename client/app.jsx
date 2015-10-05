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

const initData = window._sbInitData
if (initData && initData.auth) {
  initData.auth = Immutable.fromJS(initData.auth)
}

const topLevelReducer = combineReducers(reducers)
const createMiddlewaredStore = compose(
    applyMiddleware(thunk, promise, batchedUpdatesMiddleware),
    reduxReactRouter({ routes, createHistory })
)(createStore)
const store = createMiddlewaredStore(topLevelReducer, window._sbInitData)
registerDispatch(store.dispatch)

if (module.hot) {
  // Enable Webpack hot module replacement for reducers
  module.hot.accept('./reducers', () => {
    const nextRootReducer = require('./reducers') // eslint-disable-line import/no-require
    store.replaceReducer(nextRootReducer)
  })
}

export default class App extends React.Component {
  render() {
    return <Provider store={store}><ReduxRouter routes={routes}/></Provider>
  }
}
