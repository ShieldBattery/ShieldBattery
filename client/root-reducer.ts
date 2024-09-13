import { combineReducers } from 'redux'
import * as reducers from './reducers.js'

export default function createRootReducer() {
  return combineReducers({
    ...reducers,
  })
}

export type RootState = ReturnType<ReturnType<typeof createRootReducer>>
