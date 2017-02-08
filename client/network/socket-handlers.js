import siteSocket from './site-socket'
import rallyPointManager from './rally-point-manager-instance'
import { dispatch } from '../dispatch-registry'
import {
  NETWORK_SITE_CONNECTED,
  NETWORK_SITE_DISCONNECTED,
} from '../actions'

import activeGame from '../active-game/socket-handlers'
import chat from '../chat/socket-handlers'
import loading from '../loading/socket-handlers'
import lobbies from '../lobbies/socket-handlers'
import serverStatus from '../serverstatus/server-status-checker'
import settings from '../settings/ipc-handlers'
import whispers from '../whispers/socket-handlers'

const ipcRenderer =
    process.webpackEnv.SB_ENV === 'electron' ? require('electron').ipcRenderer : null

function networkStatusHandler({ siteSocket }) {
  // TODO(tec27): we could probably pass through reconnecting status as well
  siteSocket.on('connect', () => {
    dispatch({ type: NETWORK_SITE_CONNECTED })
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

const handlers = [
  chat,
  loading,
  networkStatusHandler,
  serverStatus,
  whispers,
]

if (process.webpackEnv.SB_ENV === 'electron') {
  handlers.push(activeGame, lobbies, rallyPointHandler, settings)
}

export default function register() {
  for (const handler of handlers) {
    handler({ siteSocket, ipcRenderer })
  }
}
