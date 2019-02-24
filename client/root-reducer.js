import * as reducers from './reducers'
import { combineReducers } from 'redux'
import { connectRouter } from 'connected-react-router'

export default history =>
  combineReducers({
    // According to the `connected-react-router` docs, this key *must* to be `router`
    router: connectRouter(history),
    ...reducers,
  })
