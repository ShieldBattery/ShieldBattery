import siteSocket from './site-socket'
import psiSocket from './psi-socket'
import { dispatch } from '../dispatch-registry'
import {
  NETWORK_PSI_CONNECTED,
  NETWORK_PSI_DISCONNECTED,
  NETWORK_SITE_CONNECTED,
  NETWORK_SITE_DISCONNECTED,
} from '../actions'

import lobbies from '../lobbies/socket-handlers'
import serverStatus from '../serverstatus/server-status-checker'
import settingsPsi from '../settings/psi-handlers'

function networkStatusHandler({ siteSocket, psiSocket }) {
  // TODO(tec27): we could probably pass through reconnecting status as well
  siteSocket.on('connect', () => {
    dispatch({ type: NETWORK_SITE_CONNECTED })
  }).on('disconnect', () => {
    dispatch({ type: NETWORK_SITE_DISCONNECTED })
  })

  psiSocket.on('connect', () => {
    dispatch({ type: NETWORK_PSI_CONNECTED })
  }).on('disconnect', () => {
    dispatch({ type: NETWORK_PSI_DISCONNECTED })
  })
}

const handlers = [
  lobbies,
  networkStatusHandler,
  serverStatus,
  settingsPsi
]

export default function register() {
  for (const handler of handlers) {
    handler({ siteSocket, psiSocket })
  }
}
