import siteSocket from './site-socket'
import rallyPointManager from './rally-point-manager-instance'
import { dispatch } from '../dispatch-registry'
import {
  NETWORK_SITE_CONNECTED,
  NETWORK_SITE_DISCONNECTED,
} from '../actions'
import {
  NETWORK_SITE_CONNECTED as IPC_NETWORK_SITE_CONNNECTED,
} from '../../app/common/ipc-constants'

import chat from '../chat/socket-handlers'
import loading from '../loading/socket-handlers'
import serverStatus from '../serverstatus/server-status-checker'
import whispers from '../whispers/socket-handlers'

const ipcRenderer =
    process.webpackEnv.SB_ENV === 'electron' ? require('electron').ipcRenderer : null

function networkStatusHandler({ siteSocket }) {
  // TODO(tec27): we could probably pass through reconnecting status as well
  siteSocket.on('connect', () => {
    dispatch({ type: NETWORK_SITE_CONNECTED })
    if (ipcRenderer) {
      ipcRenderer.send(IPC_NETWORK_SITE_CONNNECTED)
    }
  }).on('disconnect', () => {
    dispatch({ type: NETWORK_SITE_DISCONNECTED })
  })
}

function rallyPointHandler({ siteSocket }) {
  if (!rallyPointManager) {
    return
  }

  siteSocket.registerRoute('/rallyPoint/servers', (route, event) => {
    // TODO(tec27): log this?
    rallyPointManager.setServers(event)
  })

  rallyPointManager.on('ping', (serverIndex, desc, ping) => {
    // TODO(tec27): log this?
    siteSocket.invoke('/rallyPoint/pingResult', { serverIndex, ping })
  })
}

const envSpecificHandlers = process.webpackEnv.SB_ENV === 'electron' ? [
  rallyPointHandler,
  require('../active-game/socket-handlers').default,
  require('../download/ipc-handlers').default,
  require('../lobbies/socket-handlers').default,
  require('../matchmaking/socket-handlers').default,
  require('../settings/ipc-handlers').default,
  require('../window-controls/ipc-handlers').default,
] : []

const handlers = [
  chat,
  loading,
  networkStatusHandler,
  serverStatus,
  whispers,
].concat(envSpecificHandlers)

export default function register() {
  for (const handler of handlers) {
    handler({ siteSocket, ipcRenderer })
  }
}
