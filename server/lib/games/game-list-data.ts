import Joi from 'joi'
import { Logger } from 'pino'
import { MAX_DATE_TIMESTAMP } from '../../../common/constants'
import {
  ALL_GAME_FORMATS,
  GameDurationFilter,
  GameSortOption,
  GameSourceFilter,
} from '../../../common/games/game-filters'
import {
  GameRecord,
  GameReplayInfo,
  GetGamesQueryParams,
  MAX_GAMES_OFFSET,
} from '../../../common/games/games'
import { MapInfo } from '../../../common/maps'
import { SbUser } from '../../../common/users/sb-user'
import { SbUserId } from '../../../common/users/sb-user-id'
import { getMapInfos } from '../maps/map-models'
import { getReplayInfosForGames } from '../replays/replay-info'
import { ReplayService } from '../replays/replay-service'
import { findUsersById } from '../users/user-model'

/**
 * Joi validation schema for the query params shared by the public paginated games-list endpoints
 * (the global games list and a league's games). Extracted so their validation — the offset cap and
 * the `.integer()` requirement in particular — can't drift apart.
 */
export const GET_GAMES_QUERY_SCHEMA = Joi.object<GetGamesQueryParams>({
  source: Joi.string().valid(...Object.values(GameSourceFilter)),
  duration: Joi.string().valid(...Object.values(GameDurationFilter)),
  mapName: Joi.string().max(100),
  playerName: Joi.string().max(100),
  format: Joi.string().valid(...ALL_GAME_FORMATS),
  matchup: Joi.string().pattern(/^[ptz_]{1,4}-[ptz_]{1,4}$/),
  sort: Joi.string().valid(...Object.values(GameSortOption)),
  // These are public endpoints, so we cap the offset to avoid forcing the DB to produce (and sort)
  // an unbounded number of rows. `.integer()` is needed because Joi otherwise accepts e.g. `1.5`,
  // which produces an invalid `OFFSET 1.5` and 500s on the bigint cast.
  offset: Joi.number().integer().min(0).max(MAX_GAMES_OFFSET),
  startDate: Joi.number().integer().min(0).max(MAX_DATE_TIMESTAMP),
  endDate: Joi.number().integer().min(0).max(MAX_DATE_TIMESTAMP),
})

/**
 * Collects the side data (players, maps, replay download info) needed to turn a list of
 * `GameRecord`s into a response body. Shared by every endpoint that returns a paginated games
 * list (the public games list, a user's match history, a league's games) so they stay consistent
 * in what side data they attach and how.
 */
export async function getGameListSideData({
  games,
  currentUserId,
  replayService,
  logger,
}: {
  games: GameRecord[]
  currentUserId: SbUserId | undefined
  replayService: ReplayService
  logger: Logger
}): Promise<{ users: SbUser[]; maps: MapInfo[]; replays: GameReplayInfo[] }> {
  const uniqueUsers = new Set<SbUserId>()
  const uniqueMaps = new Set(games.map(g => g.mapId))
  for (const g of games) {
    for (const team of g.config.teams) {
      for (const player of team) {
        if (!player.isComputer) {
          uniqueUsers.add(player.id)
        }
      }
    }
  }

  const [users, maps] = await Promise.all([
    findUsersById(Array.from(uniqueUsers.values())),
    getMapInfos(Array.from(uniqueMaps.values())),
  ])

  const mapNameById = new Map(maps.map(m => [m.id, m.name]))
  const replays = await getReplayInfosForGames({
    games,
    currentUserId,
    mapNameById,
    replayService,
    logger,
  })

  return { users, maps, replays }
}
