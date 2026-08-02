import { TypedIpcRenderer } from '../../common/ipc'
import auth from '../auth/socket-handlers'
import chat from '../chat/socket-handlers'
import { dispatch } from '../dispatch-registry'
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
import { SocketHandler, SocketHandlerParams } from './socket-handler'

function networkStatusHandler({ siteSocket, ipcRenderer }: SocketHandlerParams) {
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

const handlers: SocketHandler[] = [
  auth,
  chat,
  games,
  lobbies,
  networkStatusHandler,
  news,
  notifications,
  users,
  whispers,
]

export default async function register(): Promise<void> {
  const ipcRenderer = new TypedIpcRenderer()

  // Loaded here rather than at module scope so the import can be dynamic: the bundler drops it
  // from builds where this branch is statically false, which is every non-Electron build.
  let envSpecificHandlers: SocketHandler[] = []
  if (IS_ELECTRON) {
    envSpecificHandlers = (await import('./electron-socket-handlers')).default
  }

  for (const handler of handlers.concat(envSpecificHandlers)) {
    handler({ siteSocket, ipcRenderer })
  }
}
