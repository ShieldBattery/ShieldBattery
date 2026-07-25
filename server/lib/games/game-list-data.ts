import { Logger } from 'pino'
import { GameRecord, GameReplayInfo } from '../../../common/games/games'
import { MapInfo } from '../../../common/maps'
import { SbUser } from '../../../common/users/sb-user'
import { SbUserId } from '../../../common/users/sb-user-id'
import { getMapInfos } from '../maps/map-models'
import { getReplayInfosForGames } from '../replays/replay-info'
import { ReplayService } from '../replays/replay-service'
import { findUsersById } from '../users/user-model'

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
