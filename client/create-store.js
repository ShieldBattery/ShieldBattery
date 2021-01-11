import { applyMiddleware, createStore, compose } from 'redux'
import thunk from 'redux-thunk'
import { routerMiddleware } from 'connected-react-router'
import { batchedSubscribe } from 'redux-batched-subscribe'
/*eslint-disable camelcase*/
import { unstable_batchedUpdates as batchedUpdates } from 'react-dom'
/* eslint-enable camelcase */
import createRootReducer from './root-reducer'

const isDev = (__WEBPACK_ENV.NODE_ENV || 'development') === 'development'

// This is a replacement for redux-promise, which is unmaintained and has transitive deps exceeding
// 500KB in the output bundle (not worth lol)
function promiseMiddleware({ dispatch }) {
  return next => action => {
    if (isPromise(action)) {
      action.then(dispatch)
    } else if (isPromise(action.payload)) {
      action.payload
        .then(result => dispatch({ ...action, payload: result }))
        .catch(err => {
          dispatch({ ...action, payload: err, error: true })
          return Promise.reject(err)
        })
    } else {
      next(action)
    }
  }
}

function isPromise(obj) {
  return (
    !!obj &&
    (typeof obj === 'object' || typeof obj === 'function') &&
    typeof obj.then === 'function'
  )
}

export default function create(initialState, history, reduxDevTools) {
  const createMiddlewaredStore = compose(
    applyMiddleware(thunk, promiseMiddleware, routerMiddleware(history)),
    batchedSubscribe(batchedUpdates),
    // Support for https://github.com/zalmoxisus/redux-devtools-extension
    // We support both the manual integration of Redux Dev Tools (for Electron clients) and using
    // the extension (for Web clients)
    reduxDevTools ? reduxDevTools.instrument() : f => f,
    isDev && window.__REDUX_DEVTOOLS_EXTENSION__ && !reduxDevTools
      ? window.__REDUX_DEVTOOLS_EXTENSION__()
      : f => f,
  )(createStore)

  const store = createMiddlewaredStore(createRootReducer(history), initialState)

  return store
}
