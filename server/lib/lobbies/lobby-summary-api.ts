import { RouterContext } from '@koa/router'
import httpErrors from 'http-errors'
import { isValidJoinCode, normalizeJoinCode } from '../../../common/lobbies/join-code'
import { LobbySummaryResponse } from '../../../common/lobbies/lobby-network'
import { httpApi } from '../http/http-api'
import { httpBefore, httpGet } from '../http/route-decorators'
import createThrottle from '../throttle/create-throttle'
import throttleMiddleware, { throttleByIp } from '../throttle/middleware'
import {
  getLiveLobbyWithHost,
  getLiveLobbyWithHostByJoinCode,
  LiveLobbyWithHost,
} from './lobby-summaries'

// Keyed by IP rather than session, since this endpoint is deliberately unauthenticated (a logged-
// out visitor following a lobby link has no session at all). Rate similar to the other read-only
// per-id fetches (e.g. `gameInfoThrottle` in game-api.ts).
const throttle = createThrottle('lobbySummary', {
  rate: 40,
  burst: 80,
  window: 60000,
})

// Tighter than `throttle` above: a lobby id is an unguessable capability token, but a join code
// is drawn from a ~113M-entry code space, which a sustained scanner could feasibly work through.
// Per-IP throttling is what keeps that scan impractical, so this bucket stays deliberately small.
const joinCodeThrottle = createThrottle('lobbyJoinCode', {
  rate: 10,
  burst: 20,
  window: 60000,
})

/**
 * Builds the unauthenticated response shape from a resolved live lobby, host, and join code.
 *
 * Explicit field picks rather than a spread, so a field added to LobbySummaryJson or MapInfoJson
 * later can't silently join this unauthenticated response.
 */
function toSummaryResponse(result: LiveLobbyWithHost): LobbySummaryResponse {
  const { summary, host, joinCode } = result
  const { map } = summary
  return {
    summary: {
      id: summary.id,
      name: summary.name,
      gameType: summary.gameType,
      gameSubType: summary.gameSubType,
      host: { id: summary.host.id },
      playerSlots: { ...summary.playerSlots },
      useLegacyLimits: summary.useLegacyLimits,
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
    joinCode,
  }
}

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
  @httpBefore(throttleMiddleware(throttle, throttleByIp))
  async getSummary(ctx: RouterContext): Promise<LobbySummaryResponse> {
    const result = await getLiveLobbyWithHost(ctx.params.lobbyId)
    if (!result) {
      throw new httpErrors.NotFound('lobby not found')
    }

    return toSummaryResponse(result)
  }

  /**
   * Resolves a join code to the same summary a link's lobby id would produce, so a client that
   * arrived via a typed-in code can navigate onward using `summary.id` exactly like the link flow.
   *
   * A malformed code can never match a live lobby, so it's treated the same as "not found" rather
   * than distinguished as an invalid-input case — this endpoint answers anyone who can guess or
   * enter a code, and telling them which codes are merely malformed would help a scanner narrow
   * its search.
   */
  @httpGet('/join-code/:code')
  @httpBefore(throttleMiddleware(joinCodeThrottle, throttleByIp))
  async getByJoinCode(ctx: RouterContext): Promise<LobbySummaryResponse> {
    const normalized = normalizeJoinCode(ctx.params.code)
    const result = isValidJoinCode(normalized)
      ? await getLiveLobbyWithHostByJoinCode(normalized)
      : undefined
    if (!result) {
      throw new httpErrors.NotFound('lobby not found')
    }

    return toSummaryResponse(result)
  }
}
