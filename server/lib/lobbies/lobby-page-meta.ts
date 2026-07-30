import { gameTypeToLabel } from '../../../common/games/game-type'
import { urlForLobby } from '../../../common/lobbies/lobby-url'
import { makeSbLobbyId, SbLobbyId } from '../../../common/lobbies/sb-lobby-id'
import { isPrettyId } from '../../../common/pretty-id'
import {
  defaultPageImage,
  defaultPageMetadata,
  englishT,
  PageMetadataResolver,
} from '../page-metadata/types'
import { findUsersById } from '../users/user-model'
import { getLobbySummary } from './lobby-summaries'

/**
 * Resolves the Open Graph/Twitter Card metadata for a lobby's logged-out landing page (registered
 * for the `/lobbies/:id/*?` route in `page-metadata.ts`).
 *
 * Unlike games/leagues/news, a lobby's id (`SbLobbyId`) is itself the pretty (base64url-encoded)
 * form — there's no separate raw id to decode/encode (see `common/lobbies/sb-lobby-id.ts`).
 * `params.id` is checked with `isPrettyId` before it's ever used as a lookup key. Every response
 * for this route is marked `noindex`: a lobby's id is a capability token backed by ephemeral
 * in-memory state, so a shared link is expected to go dead once the lobby closes — and "already
 * dead" is the state a crawler will almost always find it in. A dead/expired/malformed id falls
 * back to the default site-wide metadata rather than showing stale lobby details; the landing
 * page itself tells a human visitor the lobby is gone.
 */
export const lobbyPageMetadata: PageMetadataResolver = async (params, context) => {
  const routeId = params.id
  if (!routeId || !isPrettyId(routeId)) {
    return { ...defaultPageMetadata(context), noindex: true }
  }

  const lobbyId: SbLobbyId = makeSbLobbyId(routeId)
  const summary = getLobbySummary(lobbyId)
  if (!summary) {
    return { ...defaultPageMetadata(context), noindex: true }
  }

  const [host] = await findUsersById([summary.host.id])
  if (!host) {
    return { ...defaultPageMetadata(context), noindex: true }
  }

  const gameTypeLabel = gameTypeToLabel(summary.gameType, englishT)
  const slotWord = summary.openSlotCount === 1 ? 'slot' : 'slots'

  return {
    url: context.canonicalHost + urlForLobby(lobbyId, summary.name),
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
