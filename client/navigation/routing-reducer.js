// A reducer to use with react-router-redux. We avoid using their reducer because it's state field
// has an unnecessarily verbose name.
import { LOCATION_CHANGE } from 'react-router-redux'

const routingState = {
  location: null
}

export default function routingReducer(state = routingState, { type, payload } = {}) {
  if (type === LOCATION_CHANGE) {
    return { location: payload }
  }

  return state
}
