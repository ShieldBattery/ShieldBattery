import siteSocket from './site-socket'
import { dispatch } from '../dispatch-registry'
import { NETWORK_SITE_CONNECTED, NETWORK_SITE_DISCONNECTED } from '../actions'
import {
  NETWORK_SITE_CONNECTED as IPC_NETWORK_SITE_CONNNECTED,
  RALLY_POINT_DELETE_SERVER,
  RALLY_POINT_PING_RESULT,
  RALLY_POINT_SET_SERVERS,
  RALLY_POINT_UPSERT_SERVER,
} from '../../common/ipc-constants'

import auth from '../auth/socket-handlers'
import chat from '../chat/socket-handlers'
import loading from '../loading/socket-handlers'
import serverStatus from '../serverstatus/server-status-checker'
import whispers from '../whispers/socket-handlers'
import logger from '../logging/logger'
import fetchJson from './fetch'
import { apiUrl } from './urls'
import { clientId } from './client-id'

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

function rallyPointHandler({ siteSocket, ipcRenderer }) {
  if (!ipcRenderer) {
    return
  }

  siteSocket.registerRoute('/rallyPoint/serverList', (route, event) => {
    if (event.type === 'fullUpdate') {
      ipcRenderer.send(RALLY_POINT_SET_SERVERS, event.servers)
    } else if (event.type === 'upsert') {
      ipcRenderer.send(RALLY_POINT_UPSERT_SERVER, event.server)
    } else if (event.type === 'delete') {
      ipcRenderer.send(RALLY_POINT_DELETE_SERVER, event.id)
    } else {
      logger.warning(`got unknown rally-point serverList event type: ${event.type}`)
    }
  })

  ipcRenderer.on(RALLY_POINT_PING_RESULT, (event, server, ping) => {
    dispatch((_, getState) => {
      const {
        auth: { user },
      } = getState()
      if (!user) {
        return
      }

      const reqBody = {
        ping,
      }
      fetchJson(apiUrl`rally-point/pings/${user.id}/${clientId}/${server.id}`, {
        method: 'put',
        body: JSON.stringify(reqBody),
      }).catch(err => {
        logger.error(
          `error while reporting rally-point ping for [${server.id}, ${server.desc}]: ${
            err.stack ?? err
          }`,
        )
      })
    })
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
