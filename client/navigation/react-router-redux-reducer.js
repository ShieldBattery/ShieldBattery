import { LOCATION_CHANGE } from 'react-router-redux'

const routingState = {
  location: null
}

export default function routingReducer(state = routingState, { type, payload } = {}) {
  if (type === LOCATION_CHANGE) {
    return { ...state, location: payload }
  }

  return state
}
