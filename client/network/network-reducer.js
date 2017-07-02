import { Record } from 'immutable'
import { NETWORK_SITE_CONNECTED, NETWORK_SITE_DISCONNECTED } from '../actions'

export const SiteSocketStatus = new Record({
  isConnected: false,
})
export const NetworkStatus = new Record({
  site: new SiteSocketStatus(),
})

function makeNetReducer(name, Constructor, connected, disconnected) {
  return (state, action) => {
    if (action.type === connected) {
      return state.set(name, new Constructor({ isConnected: true }))
    } else if (action.type === disconnected) {
      return state.set(name, new Constructor({ isConnected: false }))
    }

    return state
  }
}

const reducers = [
  makeNetReducer('site', SiteSocketStatus, NETWORK_SITE_CONNECTED, NETWORK_SITE_DISCONNECTED),
]

export default function networkStatusReducer(state = new NetworkStatus(), action) {
  let newState = state
  for (const reducer of reducers) {
    newState = reducer(newState, action)
  }
  return newState
}
