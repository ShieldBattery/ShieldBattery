import { combineReducers } from 'redux'
import * as reducers from './reducers'

export default function createRootReducer() {
  return combineReducers({
    ...reducers,
  })
}

export type RootState = ReturnType<ReturnType<typeof createRootReducer>>
