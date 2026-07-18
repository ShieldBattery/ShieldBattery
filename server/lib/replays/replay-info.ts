import { Logger } from 'pino'
import { GameRecord, GameReplayInfo } from '../../../common/games/games'
import { SbMapId } from '../../../common/maps'
import { SbUserId } from '../../../common/users/sb-user-id'
import { canUserAccessReplay } from './replay-access'
import { generateReplayFilename } from './replay-filenames'
import { getBestReplaysForGames } from './replay-models'
import { ReplayService } from './replay-service'

/**
 * Builds the downloadable replay info (signed URLs and all) for the games in a list that the given
 * user is allowed to access replays for. Games without an accessible replay are simply omitted, and
 * any game whose download URL fails to generate is dropped (with an error logged) rather than
 * failing the whole request. Shared by the games list and match history endpoints.
 */
export async function getReplayInfosForGames({
  games,
  currentUserId,
  mapNameById,
  replayService,
  logger,
}: {
  games: ReadonlyArray<GameRecord>
  currentUserId: SbUserId | undefined
  mapNameById: ReadonlyMap<SbMapId, string>
  replayService: ReplayService
  logger: Logger
}): Promise<GameReplayInfo[]> {
  const accessibleGames = games.filter(g => canUserAccessReplay(g, currentUserId))
  const replayByGameId = await getBestReplaysForGames(accessibleGames.map(g => g.id))

  return (
    await Promise.all(
      accessibleGames
        .filter(g => replayByGameId.has(g.id))
        .map(async game => {
          const bestReplay = replayByGameId.get(game.id)!
          const mapName = mapNameById.get(game.mapId) ?? 'Unknown Map'
          const filename = generateReplayFilename(game, mapName)
          try {
            return {
              gameId: game.id,
              id: bestReplay.id,
              url: await replayService.getReplayDownloadUrl(bestReplay.id, filename),
              hash: bestReplay.hash.toString('hex'),
              filename,
            } satisfies GameReplayInfo
          } catch (err) {
            logger.error({ err }, `Error retrieving replay download URL for game ${game.id}`)
            return undefined
          }
        }),
    )
  ).filter(r => r !== undefined)
}
