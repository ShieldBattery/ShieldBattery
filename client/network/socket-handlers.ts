import { NydusClient } from 'nydus-client'
import { TypedIpcRenderer } from '../../common/ipc'
import { apiUrl } from '../../common/urls'
import { NETWORK_SITE_CONNECTED, NETWORK_SITE_DISCONNECTED } from '../actions'
import auth from '../auth/socket-handlers'
import chat from '../chat/socket-handlers'
import { dispatch } from '../dispatch-registry'
import games from '../games/socket-handlers'
import loading from '../loading/socket-handlers'
import logger from '../logging/logger'
import notifications from '../notifications/socket-handlers'
import serverStatus from '../serverstatus/server-status-checker'
import whispers from '../whispers/socket-handlers'
import { clientId } from './client-id'
import fetchJson from './fetch'
import siteSocket from './site-socket'

function networkStatusHandler({
  siteSocket,
  ipcRenderer,
}: {
  siteSocket: NydusClient
  ipcRenderer: TypedIpcRenderer
}) {
  // TODO(tec27): we could probably pass through reconnecting status as well
  siteSocket
    .on('connect', () => {
      dispatch({ type: NETWORK_SITE_CONNECTED } as any)
      logger.verbose('site socket connected')
      if (ipcRenderer) {
        ipcRenderer.send('networkSiteConnected')
      }
    })
    .on('disconnect', () => {
      dispatch({ type: NETWORK_SITE_DISCONNECTED } as any)
      logger.verbose('site socket disconnected')
    })
}

function rallyPointHandler({
  siteSocket,
  ipcRenderer,
}: {
  siteSocket: NydusClient
  ipcRenderer: TypedIpcRenderer
}) {
  siteSocket.registerRoute('/rallyPoint/serverList', (route, event) => {
    if (event.type === 'fullUpdate') {
      ipcRenderer.send('rallyPointSetServers', event.servers)
    } else if (event.type === 'upsert') {
      ipcRenderer.send('rallyPointUpsertServer', event.server)
    } else if (event.type === 'delete') {
      ipcRenderer.send('rallyPointDeleteServer', event.id)
    } else {
      logger.warning(`got unknown rally-point serverList event type: ${event.type}`)
    }
  })

  ipcRenderer.on('rallyPointPingResult', (event, server, ping) => {
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
          `error while reporting rally-point ping for [${server.id}, ${server.description}]: ${
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
      require('../parties/socket-handlers').default,
      require('../settings/ipc-handlers').default,
    ]
  : []

const handlers = [
  auth,
  chat,
  games,
  loading,
  networkStatusHandler,
  notifications,
  serverStatus,
  whispers,
].concat(envSpecificHandlers)

export default function register() {
  const ipcRenderer = new TypedIpcRenderer()
  for (const handler of handlers) {
    handler({ siteSocket, ipcRenderer })
  }
}
