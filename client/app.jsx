import React from 'react'
import Immutable from 'immutable'
import { applyMiddleware, createStore, combineReducers } from 'redux'
import thunk from 'redux-thunk'
import promise from 'redux-promise'
import { batchedUpdatesMiddleware } from 'redux-batched-updates'
import { Provider } from 'react-redux'
import { history } from 'react-router/lib/BrowserHistory'
import getRoutes from './routes.jsx'
import * as reducers from './reducers'
import { registerDispatch } from './dispatch-registry'

const initData = window._sbInitData
if (initData && initData.auth) {
  initData.auth = Immutable.fromJS(initData.auth)
}

const topLevelReducer = combineReducers(reducers)
const createMiddlewaredStore =
    applyMiddleware(thunk, promise, batchedUpdatesMiddleware)(createStore)
const store = createMiddlewaredStore(topLevelReducer, window._sbInitData)
registerDispatch(store.dispatch)

export default class App extends React.Component {
  render() {
    return <Provider store={store}>{() => getRoutes(history, store)}</Provider>
  }
}
