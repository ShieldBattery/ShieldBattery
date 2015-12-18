// This is a version of redux-batched-updates that doesn't cause warnings in React 0.14+
/* eslint-disable camelcase */
import { unstable_batchedUpdates as doBatchedUpdate } from 'react-dom'
/* eslint-enable camelcase */

export function batchedUpdatesMiddleware() {
  return next => action => doBatchedUpdate(() => next(action))
}

export function batchedUpdates(next) {
  return (...args) => {
    const store = next(...args)
    return {
      ...store,
      dispatch: batchedUpdatesMiddleware()(store.dispatch)
    }
  }
}
