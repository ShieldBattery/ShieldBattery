import { Record } from 'immutable'
import {
  NETWORK_PSI_CONNECTED,
  NETWORK_PSI_DISCONNECTED,
  NETWORK_SITE_CONNECTED,
  NETWORK_SITE_DISCONNECTED,
} from '../actions'

export const SocketStatus = new Record({
  isConnected: false,
})
export const NetworkStatus = new Record({
  psi: new SocketStatus(),
  site: new SocketStatus(),
})

const CONNECTED = new SocketStatus({ isConnected: true })
const DISCONNECTED = new SocketStatus({ isConnected: false })

function makeNetReducer(name, connected, disconnected) {
  return (state, action) => {
    if (action.type === connected) {
      return state.set(name, CONNECTED)
    } else if (action.type === disconnected) {
      return state.set(name, DISCONNECTED)
    }

    return state
  }
}

const reducers = [
  makeNetReducer('psi', NETWORK_PSI_CONNECTED, NETWORK_PSI_DISCONNECTED),
  makeNetReducer('site', NETWORK_SITE_CONNECTED, NETWORK_SITE_DISCONNECTED),
]

export default function networkStatusReducer(state = new NetworkStatus(), action) {
  let newState = state
  for (const reducer of reducers) {
    newState = reducer(newState, action)
  }
  return newState
}
