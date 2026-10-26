import { TypedIpcRenderer } from '../../common/ipc'
import admin from '../admin/socket-handlers'
import auth from '../auth/socket-handlers'
import chat from '../chat/socket-handlers'
import games from '../games/socket-handlers'
import lobbies from '../lobbies/socket-handlers'
import matchmakingSeasons from '../matchmaking/matchmaking-seasons-socket-handlers'
import news from '../news/socket-handlers'
import notifications from '../notifications/socket-handlers'
import settings from '../settings/socket-handlers'
import users from '../users/socket-handlers'
import whispers from '../whispers/socket-handlers'
import siteConnectionHandler from './site-connection-handler'
import siteSocket from './site-socket'
import { SocketHandler } from './socket-handler'

const handlers: SocketHandler[] = [
  admin,
  auth,
  chat,
  games,
  lobbies,
  matchmakingSeasons,
  news,
  notifications,
  settings,
  siteConnectionHandler,
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
