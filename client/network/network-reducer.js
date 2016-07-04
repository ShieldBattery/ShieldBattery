import { Record } from 'immutable'
import {
  NETWORK_PSI_CONNECTED,
  NETWORK_PSI_DISCONNECTED,
  NETWORK_SITE_CONNECTED,
  NETWORK_SITE_DISCONNECTED,
  PSI_STARCRAFT_PATH_VALIDITY,
  PSI_STARCRAFT_VERSION_VALIDITY,
  PSI_VERSION,
} from '../actions'
import { parseVersion } from './needs-upgrade'

export const PsiSocketStatus = new Record({
  isConnected: false,
  version: null,
  hasValidStarcraftPath: false,
  hasValidStarcraftVersion: false,
})
export const SiteSocketStatus = new Record({
  isConnected: false,
})
export const NetworkStatus = new Record({
  psi: new PsiSocketStatus(),
  site: new SiteSocketStatus(),
})

function makeNetReducer(name, connected, disconnected) {
  return (state, action) => {
    if (action.type === connected) {
      return state.setIn([name, 'isConnected'], true)
    } else if (action.type === disconnected) {
      return state.setIn([name, 'isConnected'], false)
    }

    return state
  }
}

const PSI_NET_REDUCER = makeNetReducer('psi', NETWORK_PSI_CONNECTED, NETWORK_PSI_DISCONNECTED)
function psiReducer(state, action) {
  const newState = PSI_NET_REDUCER(state, action)

  if (action.type === PSI_VERSION) {
    const version = action.error ? '0.0.0' : action.payload
    return newState.setIn(['psi', 'version'], parseVersion(version))
  } else if (action.type === PSI_STARCRAFT_PATH_VALIDITY) {
    return newState.setIn(['psi', 'hasValidStarcraftPath'], action.payload)
  } else if (action.type === PSI_STARCRAFT_VERSION_VALIDITY) {
    return newState.setIn(['psi', 'hasValidStarcraftVersion'], action.payload)
  }

  return newState
}

const reducers = [
  psiReducer,
  makeNetReducer('site', NETWORK_SITE_CONNECTED, NETWORK_SITE_DISCONNECTED),
]

export default function networkStatusReducer(state = new NetworkStatus(), action) {
  let newState = state
  for (const reducer of reducers) {
    newState = reducer(newState, action)
  }
  return newState
}
