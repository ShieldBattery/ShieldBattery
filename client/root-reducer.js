import * as reducers from './reducers'
import { combineReducers } from 'redux'

export default history =>
  combineReducers({
    ...reducers,
  })
