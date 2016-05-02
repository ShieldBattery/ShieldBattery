import { Record } from 'immutable'
import {
  RESOLUTION_GET,
} from '../actions'

export const Resolution = new Record({
  width: -1,
  height: -1,
})

export const UserEnvironment = new Record({
  resolution: new Resolution(),
})

export function resolutionReducer(state, action) {
  if (action.type === RESOLUTION_GET) {
    if (!action.error) {
      return new Resolution(action.payload)
    } else {
      // TODO(2Pac): deal with the error
    }
  }

  return state
}

export default function userEnvironmentReducer(state = new UserEnvironment(), action) {
  return state.set('resolution', resolutionReducer(state.resolution, action))
}
