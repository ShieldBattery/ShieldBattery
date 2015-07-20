import { routerStateReducer } from 'redux-react-router'

export { default as auth } from './auth/auth-reducer'

export function router(state = {}, action) {
  return {
    location: routerStateReducer(state.location, action)
  }
}

export { default as serverStatus } from './serverstatus/server-status-reducer'
