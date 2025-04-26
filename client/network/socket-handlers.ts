import { NydusClient } from 'nydus-client'
import { TypedIpcRenderer } from '../../common/ipc'
import { UpdateRallyPointClientPingBatchRequest } from '../../common/rally-point'
import { apiUrl } from '../../common/urls'
import auth from '../auth/socket-handlers'
import chat from '../chat/socket-handlers'
import { dispatch } from '../dispatch-registry'
import games from '../games/socket-handlers'
import loading from '../loading/socket-handlers'
import lobbies from '../lobbies/socket-handlers'
import logger from '../logging/logger'
import news from '../news/socket-handlers'
import notifications from '../notifications/socket-handlers'
import users from '../users/socket-handlers'
import whispers from '../whispers/socket-handlers'
import { clientId } from './client-id'
import { fetchJson } from './fetch'
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
      logger.verbose('site socket connected')
      dispatch({ type: '@network/connect' })
      if (ipcRenderer) {
        ipcRenderer.send('networkSiteConnected')
      }
    })
    .on('disconnect', () => {
      logger.verbose('site socket disconnected')
      dispatch({ type: '@network/disconnect' })
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

  const pingsToSend = new Map<number, number>()
  let sendTimeout: ReturnType<typeof setTimeout> | undefined

  const sendPings = () => {
    const toSend = Array.from(pingsToSend.entries())
    pingsToSend.clear()
    sendTimeout = undefined

    if (!toSend.length) {
      return
    }

    dispatch((_, getState) => {
      const {
        auth: { self },
      } = getState()
      if (!self) {
        return
      }

      const reqBody = {
        pings: toSend,
      } satisfies UpdateRallyPointClientPingBatchRequest
      fetchJson(apiUrl`rally-point/pings/${self.user.id}/${clientId}/batch`, {
        method: 'put',
        body: JSON.stringify(reqBody),
      }).catch(err => {
        logger.error(
          `error while reporting rally-point pings (${JSON.stringify(toSend)}): ${
            err.stack ?? err
          }`,
        )
      })
    })
  }

  ipcRenderer.on('rallyPointPingResult', (event, server, ping) => {
    pingsToSend.set(server.id, ping)

    if (!sendTimeout) {
      setTimeout(sendPings, 66)
    }
  })
}

const envSpecificHandlers = IS_ELECTRON
  ? [
      rallyPointHandler,
      require('../active-game/socket-handlers').default,
      require('../download/ipc-handlers').default,
      require('../lobbies/electron-socket-handlers').default,
      require('../matchmaking/socket-handlers').default,
      require('../replays/ipc-handlers').default,
      require('../settings/ipc-handlers').default,
      require('../system-bar/ipc-handlers').default,
    ]
  : []

const handlers = [
  auth,
  chat,
  games,
  loading,
  lobbies,
  networkStatusHandler,
  news,
  notifications,
  users,
  whispers,
].concat(envSpecificHandlers)

export default function register() {
  const ipcRenderer = new TypedIpcRenderer()
  for (const handler of handlers) {
    handler({ siteSocket, ipcRenderer })
  }
}
