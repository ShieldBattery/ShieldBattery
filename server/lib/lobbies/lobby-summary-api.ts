import { RouterContext } from '@koa/router'
import httpErrors from 'http-errors'
import { LobbySummaryResponse } from '../../../common/lobbies/lobby-network'
import { makeSbLobbyId } from '../../../common/lobbies/sb-lobby-id'
import { isPrettyId } from '../../../common/pretty-id'
import { httpApi } from '../http/http-api'
import { httpBefore, httpGet } from '../http/route-decorators'
import createThrottle from '../throttle/create-throttle'
import throttleMiddleware from '../throttle/middleware'
import { findUsersById } from '../users/user-model'
import { getLobbySummary } from './lobby-summaries'

// Keyed by IP rather than session, since this endpoint is deliberately unauthenticated (a logged-
// out visitor following a lobby link has no session at all). Rate similar to the other read-only
// per-id fetches (e.g. `gameInfoThrottle` in game-api.ts).
const throttle = createThrottle('lobbySummary', {
  rate: 40,
  burst: 80,
  window: 60000,
})

/**
 * Serves summary info for a single lobby, with no login required.
 *
 * A lobby's id is an unguessable capability token (see `common/lobbies/sb-lobby-id.ts`), and for
 * unlisted lobbies possessing the link *is* the invite — so handing back summary data to anyone who
 * has the id is intended, not a leak. This is what backs the logged-out lobby landing page and link
 * unfurling (Open Graph) for `/lobbies/:id/*` links.
 */
@httpApi('/lobbies')
export class LobbySummaryApi {
  @httpGet('/:lobbyId/summary')
  @httpBefore(throttleMiddleware(throttle, ctx => ctx.ip))
  async getSummary(ctx: RouterContext): Promise<LobbySummaryResponse> {
    const lobbyId = makeSbLobbyId(ctx.params.lobbyId)
    if (!isPrettyId(lobbyId)) {
      // A malformed id can never match a live lobby, so it's indistinguishable from "not found" as
      // far as the landing page is concerned — both mean "this link doesn't work".
      throw new httpErrors.NotFound('lobby not found')
    }

    const summary = getLobbySummary(lobbyId)
    if (!summary) {
      throw new httpErrors.NotFound('lobby not found')
    }

    const [host] = await findUsersById([summary.host.id])
    if (!host) {
      // Shouldn't normally happen (the host is necessarily a real account), but a half response
      // (summary without a resolvable host) is worse than a 404 here.
      throw new httpErrors.NotFound('lobby not found')
    }

    // Explicit field picks rather than a spread, so a field added to LobbySummaryJson or
    // MapInfoJson later can't silently join this unauthenticated response.
    const { map } = summary
    return {
      summary: {
        id: summary.id,
        name: summary.name,
        gameType: summary.gameType,
        gameSubType: summary.gameSubType,
        host: { id: summary.host.id },
        openSlotCount: summary.openSlotCount,
        map: {
          id: map.id,
          name: map.name,
          image256Url: map.image256Url,
          image512Url: map.image512Url,
          image1024Url: map.image1024Url,
          image2048Url: map.image2048Url,
          mapData: { width: map.mapData.width, height: map.mapData.height },
        },
      },
      host,
    }
  }
}
