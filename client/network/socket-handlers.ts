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
import settings from '../settings/socket-handlers'
import users from '../users/socket-handlers'
import whispers from '../whispers/socket-handlers'
import { isConnectedAtom } from './network-atoms'
import siteSocket from './site-socket'
import { SocketHandler, SocketHandlerParams } from './socket-handler'

/**
 * Summarizes the details engine.io attaches to a close: nothing for a ping timeout, a
 * `{ description, context: CloseEvent }` for a closed websocket, or a `TransportError` for a
 * transport failure.
 */
function describeDisconnectDetails(details: unknown): string {
  if (!details || typeof details !== 'object') {
    return ''
  }

  const parts: string[] = []
  if (details instanceof Error) {
    parts.push(details.message)
  }
  const { description, context } = details as { description?: unknown; context?: unknown }
  if (typeof description === 'string' || typeof description === 'number') {
    parts.push(String(description))
  }
  if (context instanceof CloseEvent) {
    parts.push(
      `code ${context.code}${context.reason ? ` "${context.reason}"` : ''}` +
        `${context.wasClean ? ', clean' : ''}`,
    )
  }
  return parts.join(', ')
}

function networkStatusHandler({ siteSocket, ipcRenderer }: SocketHandlerParams) {
  // TODO(tec27): we could probably pass through reconnecting status as well
  let disconnectedAt: number | undefined

  siteSocket
    .on('connect', () => {
      const downFor =
        disconnectedAt !== undefined
          ? ` after ${((Date.now() - disconnectedAt) / 1000).toFixed(1)}s down`
          : ''
      logger.verbose(`site socket connected${downFor}`)
      disconnectedAt = undefined

      dispatch({ type: '@network/connect' })
      jotaiStore.set(isConnectedAtom, true)
      if (ipcRenderer) {
        ipcRenderer.send('networkSiteConnected')
      }
    })
    .on('disconnect', (reason, details) => {
      disconnectedAt = Date.now()
      const detailsText = describeDisconnectDetails(details)
      logger.verbose(
        `site socket disconnected: ${reason}${detailsText ? ` (${detailsText})` : ''}` +
          `${navigator.onLine ? '' : ', browser reports offline'}`,
      )

      dispatch({ type: '@network/disconnect' })
      jotaiStore.set(isConnectedAtom, false)
    })
    .on('reconnecting', attempts => {
      logger.verbose(`site socket reconnect attempt ${attempts}`)
    })
    .on('connect_timeout', () => {
      logger.verbose('site socket connect attempt timed out')
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
  settings,
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
