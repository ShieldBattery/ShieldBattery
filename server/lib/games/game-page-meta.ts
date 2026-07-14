import type { TFunction } from 'i18next'
import { GameConfig, GameConfigPlayer, GameSource } from '../../../common/games/configuration'
import { matchmakingTypeToLabel } from '../../../common/matchmaking'
import { decodePrettyId, encodePrettyId, isPrettyId } from '../../../common/pretty-id'
import { SbUser } from '../../../common/users/sb-user'
import { SbUserId } from '../../../common/users/sb-user-id'
import { getMapInfos } from '../maps/map-models'
import { defaultPageImage, PageMetadataResolver } from '../page-metadata/types'
import { findUsersByIdAsMap } from '../users/user-model'
import { getGameRecord } from './game-models'

// Crawler-facing metadata is English-only, so resolve labels with their default strings rather
// than running the full i18next pipeline.
const englishT = ((_key: string, defaultValue: string) => defaultValue) as unknown as TFunction

// Pinned to UTC so the rendered date doesn't depend on the server host's timezone.
const DATE_FORMAT = new Intl.DateTimeFormat('en-US', {
  month: 'long',
  day: 'numeric',
  year: 'numeric',
  timeZone: 'UTC',
})

function playerDisplayName(player: GameConfigPlayer, users: Map<SbUserId, SbUser>): string {
  if (player.isComputer) {
    return 'Computer'
  }
  return users.get(player.id)?.name ?? 'Unknown player'
}

/**
 * Builds a title out of the game's teams: each team's players joined with ', ', teams joined with
 * ' vs '. A single-team (FFA-style) config instead joins that team's players with ' vs '.
 */
function gameTitle(config: GameConfig, users: Map<SbUserId, SbUser>): string {
  const teams = config.teams.map(team => team.map(p => playerDisplayName(p, users)))
  return teams.length === 1
    ? teams[0].join(' vs ')
    : teams.map(team => team.join(', ')).join(' vs ')
}

/**
 * Resolves the Open Graph/Twitter Card metadata for a game results page (registered for the
 * `/games/:id/*?` route in `page-metadata.ts`).
 *
 * `params.id` is expected to be the game's pretty (base64url-encoded) id; anything else — a raw
 * UUID, a malformed id, etc. — returns `undefined` without querying the database, as does a game
 * that doesn't exist. Either case falls back to the default site-wide metadata.
 */
export const gamePageMetadata: PageMetadataResolver = async (params, context) => {
  const routeId = params.id
  if (!routeId || !isPrettyId(routeId)) {
    return undefined
  }

  const gameId = decodePrettyId(routeId)
  const game = await getGameRecord(gameId)
  if (!game) {
    return undefined
  }

  const userIds = game.config.teams.flatMap(t => t.filter(p => !p.isComputer).map(p => p.id))
  const [mapArray, users] = await Promise.all([
    getMapInfos([game.mapId]),
    findUsersByIdAsMap(userIds),
  ])

  const map = mapArray[0]
  const mapName = map?.name ?? 'Unknown Map'
  const date = DATE_FORMAT.format(game.startTime)

  const description =
    game.config.gameSource === GameSource.Matchmaking
      ? `Ranked ${matchmakingTypeToLabel(game.config.gameSourceExtra.type, englishT)} game on ` +
        `${mapName}, played ${date}.`
      : `Custom game on ${mapName}, played ${date}.`

  return {
    url: `${context.canonicalHost}/games/${encodePrettyId(gameId)}`,
    type: 'website',
    title: gameTitle(game.config, users),
    description,
    image: map?.image1024Url ?? map?.image512Url ?? map?.image256Url ?? defaultPageImage(context),
  }
}
