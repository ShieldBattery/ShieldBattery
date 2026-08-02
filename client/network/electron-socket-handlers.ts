import activeGame from '../active-game/socket-handlers'
import download from '../download/ipc-handlers'
import { gameServerRegionsAtom } from '../game-server-regions/game-server-regions-atoms'
import gameServerRegionsIpc from '../game-server-regions/ipc-handlers'
import { jotaiStore } from '../jotai-store'
import lobbies from '../lobbies/electron-socket-handlers'
import logger from '../logging/logger'
import matchmaking from '../matchmaking/socket-handlers'
import replays from '../replays/ipc-handlers'
import settings from '../settings/ipc-handlers'
import systemBar from '../system-bar/ipc-handlers'
import { SocketHandler, SocketHandlerParams } from './socket-handler'

function gameServerRegionsHandler({ siteSocket, ipcRenderer }: SocketHandlerParams) {
  siteSocket.registerRoute('/gameServerRegions', (route, event) => {
    if (event.type === 'fullUpdate') {
      ipcRenderer.send('gameServerRegionsSetList', event.regions)
      jotaiStore.set(gameServerRegionsAtom, event.regions)
    } else {
      logger.warning(`got unknown game server regions event type: ${event.type}`)
    }
  })
}

/**
 * Handlers that only exist in the Electron client, gathered into one module so that the code they
 * pull in is a single unit the web build can drop whole rather than something the bundler has to
 * prove unreachable one import at a time.
 */
const electronHandlers: SocketHandler[] = [
  activeGame,
  download,
  gameServerRegionsHandler,
  gameServerRegionsIpc,
  lobbies,
  matchmaking,
  replays,
  settings,
  systemBar,
]

export default electronHandlers
