import { applyMiddleware, createStore, combineReducers, compose } from 'redux'
import thunk from 'redux-thunk'
import promise from 'redux-promise'
import { batchedUpdatesMiddleware } from './dom/batched-updates'
import { reduxReactRouter } from 'redux-router'
import { createHistory } from 'history'
import rootReducer from './root-reducer'
import routes from './routes.jsx'

const isDev = (process.env.NODE_ENV || 'development') === 'development'
const createMiddlewaredStore = compose(
    applyMiddleware(thunk, promise, batchedUpdatesMiddleware),
    reduxReactRouter({ routes, createHistory }),
    // Support for https://github.com/zalmoxisus/redux-devtools-extension
    isDev && window.devToolsExtension ? window.devToolsExtension() : f => f
)(createStore)

export default function create(initialState) {
  const store = createMiddlewaredStore(rootReducer, initialState)

  if (module.hot) {
    module.hot.accept('./root-reducer', () => {
      const nextRootReducer = require('./root-reducer').default
      store.replaceReducer(nextRootReducer)
    })
  }

  return store
}
