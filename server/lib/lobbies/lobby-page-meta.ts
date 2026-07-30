import { gameTypeToLabel } from '../../../common/games/game-type'
import { urlForLobby } from '../../../common/lobbies/lobby-url'
import logger from '../logging/logger'
import {
  defaultPageImage,
  defaultPageMetadata,
  englishT,
  PageMetadataResolver,
} from '../page-metadata/types'
import { getLiveLobbyWithHost } from './lobby-summaries'

/**
 * Resolves the Open Graph/Twitter Card metadata for a lobby's logged-out landing page (registered
 * for the `/lobbies/:id/*?` route in `page-metadata.ts`).
 *
 * Unlike games/leagues/news, a lobby's id (`SbLobbyId`) is itself the pretty (base64url-encoded)
 * form — there's no separate raw id to decode/encode (see `common/lobbies/sb-lobby-id.ts`).
 * `params.id` is checked with `isPrettyId` (inside the shared lookup helper) before it's ever used
 * as a lookup key. Every response for this route is marked `noindex`: a lobby's id is a capability
 * token backed by ephemeral in-memory state, so a shared link is expected to go dead once the
 * lobby closes — and "already dead" is the state a crawler will almost always find it in. A
 * dead/expired/malformed id, or a failed lookup, falls back to the default site-wide metadata
 * rather than showing stale lobby details; the landing page itself tells a human visitor the
 * lobby is gone.
 */
export const lobbyPageMetadata: PageMetadataResolver = async (params, context) => {
  // An error escaping this resolver falls through to the site-wide default metadata, which is not
  // marked `noindex`. A failed lookup is therefore treated the same as "lobby not found" here, so
  // every response for this route stays noindexed regardless of lookup failures.
  let result
  try {
    result = await getLiveLobbyWithHost(params.id)
  } catch (err) {
    logger.warn({ err }, 'lobby summary lookup failed while resolving lobby page metadata')
    result = undefined
  }
  if (!result) {
    return { ...defaultPageMetadata(context), noindex: true }
  }
  const { summary, host } = result

  const gameTypeLabel = gameTypeToLabel(summary.gameType, englishT)
  const slotWord = summary.openSlotCount === 1 ? 'slot' : 'slots'

  return {
    url: context.canonicalHost + urlForLobby(summary.id, summary.name),
    type: 'website',
    title: summary.name,
    description:
      `${gameTypeLabel} lobby on ${summary.map.name} — ${summary.openSlotCount} open ` +
      `${slotWord}. Hosted by ${host.name}.`,
    // `summary.map` is the same `MapInfoJson` the game/league resolvers use, so the same fallback
    // chain applies directly — no separate server-side map lookup is needed here.
    image:
      summary.map.image1024Url ??
      summary.map.image512Url ??
      summary.map.image256Url ??
      defaultPageImage(context),
    // The lobby's id is a capability token, not a stable public identifier: a link shared outside
    // the app is expected to go dead once the lobby closes, so it must never linger in a search
    // index (unlike the unfurl preview above, which crawlers request live).
    noindex: true,
  }
}
