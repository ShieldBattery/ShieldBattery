import siteSocket from './site-socket'
import rallyPointManager from './rally-point-manager-instance'
import { dispatch } from '../dispatch-registry'
import { NETWORK_SITE_CONNECTED, NETWORK_SITE_DISCONNECTED } from '../actions'
// prettier-ignore
import {
  NETWORK_SITE_CONNECTED as IPC_NETWORK_SITE_CONNNECTED,
} from '../../common/ipc-constants'

import auth from '../auth/socket-handlers'
import chat from '../chat/socket-handlers'
import loading from '../loading/socket-handlers'
import serverStatus from '../serverstatus/server-status-checker'
import whispers from '../whispers/socket-handlers'
import logger from '../logging/logger'

const ipcRenderer = IS_ELECTRON ? require('electron').ipcRenderer : null

function networkStatusHandler({ siteSocket }) {
  // TODO(tec27): we could probably pass through reconnecting status as well
  siteSocket
    .on('connect', () => {
      dispatch({ type: NETWORK_SITE_CONNECTED })
      logger.verbose('site socket connected')
      if (ipcRenderer) {
        ipcRenderer.send(IPC_NETWORK_SITE_CONNNECTED)
      }
    })
    .on('disconnect', () => {
      dispatch({ type: NETWORK_SITE_DISCONNECTED })
      logger.verbose('site socket disconnected')
    })
}

function rallyPointHandler({ siteSocket }) {
  if (!rallyPointManager) {
    return
  }

  siteSocket.registerRoute('/rallyPoint/servers', (route, event) => {
    rallyPointManager.setServers(event)
    logger.verbose(`got new rally-point servers: ${JSON.stringify(event)}`)
  })

  rallyPointManager.on('ping', (serverIndex, desc, ping) => {
    siteSocket.invoke('/rallyPoint/pingResult', { serverIndex, ping })
    logger.verbose(`rally-point ping result: server [${serverIndex} - ${desc}] at ${ping}ms`)
  })
}

const envSpecificHandlers = IS_ELECTRON
  ? [
      rallyPointHandler,
      require('../active-game/socket-handlers').default,
      require('../app-bar/ipc-handlers').default,
      require('../download/ipc-handlers').default,
      require('../lobbies/socket-handlers').default,
      require('../matchmaking/socket-handlers').default,
      require('../settings/ipc-handlers').default,
    ]
  : []

const handlers = [auth, chat, loading, networkStatusHandler, serverStatus, whispers].concat(
  envSpecificHandlers,
)

export default function register() {
  for (const handler of handlers) {
    handler({ siteSocket, ipcRenderer })
  }
}
