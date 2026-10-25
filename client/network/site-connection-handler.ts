import { RouteInfo } from 'nydus-client'
import {
  SITE_CONNECTION_PATH,
  SiteConnectionEvent,
  SiteConnectionRefusal,
  SubscribedClientEvent,
} from '../../common/websockets'
import { dispatch } from '../dispatch-registry'
import { jotaiStore } from '../jotai-store'
import logger from '../logging/logger'
import { showConnectionRefused } from './connection-refused-dialog'
import { nextSiteConnectionState, siteConnectionAtom, SiteConnectionStatus } from './network-atoms'
import { SocketHandlerParams } from './socket-handler'

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

function answerChallenge(event: Extract<SiteConnectionEvent, { type: 'challenge' }>) {
  if (!IS_ELECTRON) {
    return
  }
  import('../auth/client-attestation')
    .then(({ answerChallenge }) => answerChallenge(event.challenge))
    .catch(err => {
      logger.error(`Couldn't answer connection challenge: ${(err as any)?.stack ?? String(err)}`)
    })
}

/** Tracks the state of our connection to the server. */
export default function siteConnectionHandler({ siteSocket, ipcRenderer }: SocketHandlerParams) {
  let disconnectedAt: number | undefined

  const getStatus = () => jotaiStore.get(siteConnectionAtom).status
  const setStatus = (status: SiteConnectionStatus, refusal?: SiteConnectionRefusal) => {
    const prev = jotaiStore.get(siteConnectionAtom)
    if (prev.status === status) return

    jotaiStore.set(siteConnectionAtom, nextSiteConnectionState(prev, status, Date.now(), refusal))
    // These bracket the time we're admitted, which is when the server's state is flowing to us
    if (status === 'connected') {
      dispatch({ type: '@network/connect' })
    } else if (prev.status === 'connected') {
      dispatch({ type: '@network/disconnect' })
    }
  }
  const admit = () => {
    if (getStatus() === 'admitting') {
      logger.verbose('site socket admitted')
      setStatus('connected')
    }
  }

  siteSocket
    .on('connect', () => {
      const downFor =
        disconnectedAt !== undefined
          ? ` after ${((Date.now() - disconnectedAt) / 1000).toFixed(1)}s down`
          : ''
      logger.verbose(`site socket connected${downFor}`)
      disconnectedAt = undefined

      if (getStatus() !== 'refused') {
        setStatus('admitting')
      }
      // Doesn't wait for admission, so outdated clients still find their update
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

      if (getStatus() !== 'refused') {
        setStatus('disconnected')
      }
    })
    .on('reconnecting', attempts => {
      logger.verbose(`site socket reconnect attempt ${attempts}`)
    })
    .on('connect_timeout', () => {
      logger.verbose('site socket connect attempt timed out')
    })

  siteSocket.registerRoute(
    `${SITE_CONNECTION_PATH}/:socketId`,
    (route: RouteInfo, event: SiteConnectionEvent) => {
      switch (event.type) {
        case 'challenge':
          answerChallenge(event)
          break
        case 'admitted':
          admit()
          break
        case 'refused':
          logger.error(`site connection refused: ${event.reason}`)
          setStatus('refused', event.reason)
          showConnectionRefused(event.reason)
          siteSocket.disconnect()
          break
        default:
          event satisfies never
      }
    },
  )
  // For older servers, which don't send `admitted`
  siteSocket.registerRoute(
    '/clients/:userId/:clientId',
    (route: RouteInfo, event: Partial<SubscribedClientEvent>) => {
      if (event?.type === 'subscribedClient') {
        admit()
      }
    },
  )
}
