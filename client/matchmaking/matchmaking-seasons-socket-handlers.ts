import type { NydusClient, RouteInfo } from 'nydus-client'
import { MatchmakingSeasonsEvent } from '../../common/matchmaking'
import { dispatch } from '../dispatch-registry'
import logger from '../logging/logger'

function handleSeasonsEvent(_route: RouteInfo, event: MatchmakingSeasonsEvent) {
  if (event.type === 'seasonUpdate') {
    dispatch({ type: '@matchmaking/updateSeason', payload: event.season })
  } else {
    logger.warning(`got unknown matchmaking seasons event type: ${(event as any).type}`)
  }
}

/** Registered for every client (web and Electron), since all of them display seasons' divisions. */
export default function registerModule({ siteSocket }: { siteSocket: NydusClient }) {
  siteSocket.registerRoute('/matchmaking-seasons', handleSeasonsEvent)
}
