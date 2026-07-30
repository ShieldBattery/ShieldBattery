import type { TFunction } from 'i18next'
import { gameTypeToLabel } from '../../../common/games/game-type'
import { urlForLobby } from '../../../common/lobbies/lobby-url'
import { makeSbLobbyId, SbLobbyId } from '../../../common/lobbies/sb-lobby-id'
import { isPrettyId } from '../../../common/pretty-id'
import { defaultPageImage, PageMetadataResolver } from '../page-metadata/types'
import { findUsersById } from '../users/user-model'
import { getLobbySummary } from './lobby-summaries'

// Crawler-facing metadata is English-only, so resolve labels with their default strings rather
// than running the full i18next pipeline.
const englishT = ((_key: string, defaultValue: string) => defaultValue) as unknown as TFunction

/**
 * Resolves the Open Graph/Twitter Card metadata for a lobby's logged-out landing page (registered
 * for the `/lobbies/:id/*?` route in `page-metadata.ts`).
 *
 * Unlike games/leagues/news, a lobby's id (`SbLobbyId`) is itself the pretty (base64url-encoded)
 * form — there's no separate raw id to decode/encode (see `common/lobbies/sb-lobby-id.ts`).
 * `params.id` is checked with `isPrettyId` before it's ever used as a lookup key; anything else, or
 * an id with no currently-live lobby behind it, returns `undefined`. A lobby is ephemeral in-memory
 * state, so a dead/expired link falling back to the generic site preview (rather than showing stale
 * lobby details) is deliberate — the landing page itself tells a human visitor the lobby is gone.
 */
export const lobbyPageMetadata: PageMetadataResolver = async (params, context) => {
  const routeId = params.id
  if (!routeId || !isPrettyId(routeId)) {
    return undefined
  }

  const lobbyId: SbLobbyId = makeSbLobbyId(routeId)
  const summary = getLobbySummary(lobbyId)
  if (!summary) {
    return undefined
  }

  const [host] = await findUsersById([summary.host.id])
  if (!host) {
    return undefined
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
  }
}
