import { applyMiddleware, compose, createStore } from 'redux'
import thunk from 'redux-thunk'
import { addSystemMiddleware } from './redux-system-info'
import createRootReducer from './root-reducer'

const isDev = __WEBPACK_ENV.NODE_ENV !== 'production'

// This is a replacement for redux-promise, which is unmaintained and has transitive deps exceeding
// 500KB in the output bundle (not worth lol)
function promiseMiddleware({ dispatch }) {
  return next => action => {
    if (isPromise(action)) {
      action.then(value => {
        if (value !== undefined && value !== null) {
          dispatch(value)
        }
      })
    } else if (isPromise(action.payload)) {
      action.payload
        .then(result => dispatch({ ...action, payload: result }))
        .catch(err => {
          dispatch({ ...action, payload: err, error: true })
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

export default function create(reduxDevTools) {
  const createMiddlewaredStore = compose(
    applyMiddleware(thunk, promiseMiddleware, addSystemMiddleware),
    // Support for https://github.com/zalmoxisus/redux-devtools-extension
    // We support both the manual integration of Redux Dev Tools (for Electron clients) and using
    // the extension (for Web clients)
    reduxDevTools ? reduxDevTools.instrument() : f => f,
    isDev && window.__REDUX_DEVTOOLS_EXTENSION__ && !reduxDevTools
      ? window.__REDUX_DEVTOOLS_EXTENSION__()
      : f => f,
  )(createStore)

  const store = createMiddlewaredStore(createRootReducer())

  return store
}
