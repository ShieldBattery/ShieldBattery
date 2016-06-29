import siteSocket from './site-socket'
import psiSocket from './psi-socket'
import { dispatch } from '../dispatch-registry'
import {
  NETWORK_PSI_CONNECTED,
  NETWORK_PSI_DISCONNECTED,
  NETWORK_SITE_CONNECTED,
  NETWORK_SITE_DISCONNECTED,
  PSI_STARCRAFT_PATH_VALIDITY,
  PSI_STARCRAFT_VERSION_VALIDITY,
  PSI_VERSION,
} from '../actions'

import chat from '../chat/socket-handlers'
import loading from '../loading/socket-handlers'
import lobbies from '../lobbies/socket-handlers'
import serverStatus from '../serverstatus/server-status-checker'
import settingsPsi from '../settings/psi-handlers'
import upgrade from './upgrade-handlers'
import whispers from '../whispers/socket-handlers'

function networkStatusHandler({ siteSocket, psiSocket }) {
  // TODO(tec27): we could probably pass through reconnecting status as well
  siteSocket.on('connect', () => {
    dispatch({ type: NETWORK_SITE_CONNECTED })
  }).on('disconnect', () => {
    dispatch({ type: NETWORK_SITE_DISCONNECTED })
  })

  psiSocket.on('connect', () => {
    dispatch({ type: NETWORK_PSI_CONNECTED })
    dispatch({
      type: PSI_VERSION,
      payload: psiSocket.invoke('/site/getVersion'),
    })
  }).on('disconnect', () => {
    dispatch({ type: NETWORK_PSI_DISCONNECTED })
  })
}

function psiPathValidityHandler({ psiSocket }) {
  psiSocket.registerRoute('/starcraftPathValidity', (route, event) => {
    dispatch({ type: PSI_STARCRAFT_PATH_VALIDITY, payload: event })
  })
  psiSocket.registerRoute('/starcraftCorrectVersion', (route, event) => {
    dispatch({ type: PSI_STARCRAFT_VERSION_VALIDITY, payload: event })
  })
}

let lastRallyPointServers = null
function rallyPointHandler({ siteSocket, psiSocket }) {
  siteSocket.registerRoute('/rallyPoint/servers', (route, event) => {
    lastRallyPointServers = event
    psiSocket.invoke('/site/rallyPoint/setServers', { servers: event })
  })
  psiSocket.on('connect', () => {
    if (lastRallyPointServers) {
      psiSocket.invoke('/site/rallyPoint/setServers', { servers: lastRallyPointServers })
    }
  })
  psiSocket.registerRoute('/rallyPoint/ping/:origin', (route, event) => {
    siteSocket.invoke('/rallyPoint/pingResult',
        { serverIndex: event.serverIndex, ping: event.ping })
  })
}

const handlers = [
  chat,
  loading,
  lobbies,
  networkStatusHandler,
  psiPathValidityHandler,
  rallyPointHandler,
  serverStatus,
  settingsPsi,
  upgrade,
  whispers,
]

export default function register() {
  for (const handler of handlers) {
    handler({ siteSocket, psiSocket })
  }
}
