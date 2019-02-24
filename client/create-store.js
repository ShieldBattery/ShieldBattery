import { applyMiddleware, createStore, compose } from 'redux'
import thunk from 'redux-thunk'
import promise from 'redux-promise'
import { routerMiddleware } from 'connected-react-router'
import { batchedSubscribe } from 'redux-batched-subscribe'
/*eslint-disable camelcase*/
import { unstable_batchedUpdates as batchedUpdates } from 'react-dom'
/* eslint-enable camelcase */
import createRootReducer from './root-reducer'

const isDev = (process.webpackEnv.NODE_ENV || 'development') === 'development'

export default function create(initialState, history) {
  const createMiddlewaredStore = compose(
    applyMiddleware(thunk, promise, routerMiddleware(history)),
    batchedSubscribe(batchedUpdates),
    // Support for https://github.com/zalmoxisus/redux-devtools-extension
    isDev && window.__REDUX_DEVTOOLS_EXTENSION__ ? window.__REDUX_DEVTOOLS_EXTENSION__() : f => f,
  )(createStore)

  const store = createMiddlewaredStore(createRootReducer(history), initialState)

  return store
}
