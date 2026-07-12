import { NydusClient } from 'nydus-client'
import { TypedIpcRenderer } from '../../common/ipc'
import auth from '../auth/socket-handlers'
import chat from '../chat/socket-handlers'
import { dispatch } from '../dispatch-registry'
import { gameServerRegionsAtom } from '../game-server-regions/game-server-regions-atoms'
import games from '../games/socket-handlers'
import { jotaiStore } from '../jotai-store'
import lobbies from '../lobbies/socket-handlers'
import logger from '../logging/logger'
import news from '../news/socket-handlers'
import notifications from '../notifications/socket-handlers'
import users from '../users/socket-handlers'
import whispers from '../whispers/socket-handlers'
import { isConnectedAtom } from './network-atoms'
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
      jotaiStore.set(isConnectedAtom, true)
      if (ipcRenderer) {
        ipcRenderer.send('networkSiteConnected')
      }
    })
    .on('disconnect', () => {
      logger.verbose('site socket disconnected')
      dispatch({ type: '@network/disconnect' })
      jotaiStore.set(isConnectedAtom, false)
    })
}

function gameServerRegionsHandler({
  siteSocket,
  ipcRenderer,
}: {
  siteSocket: NydusClient
  ipcRenderer: TypedIpcRenderer
}) {
  siteSocket.registerRoute('/gameServerRegions', (route, event) => {
    if (event.type === 'fullUpdate') {
      ipcRenderer.send('gameServerRegionsSetList', event.regions)
      jotaiStore.set(gameServerRegionsAtom, event.regions)
    } else {
      logger.warning(`got unknown game server regions event type: ${event.type}`)
    }
  })
}

const envSpecificHandlers = IS_ELECTRON
  ? [
      gameServerRegionsHandler,
      require('../active-game/socket-handlers').default,
      require('../download/ipc-handlers').default,
      require('../game-server-regions/ipc-handlers').default,
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
