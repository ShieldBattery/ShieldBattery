import { GameSource } from '../../../common/games/configuration'
import { GameRecord } from '../../../common/games/games'
import { LobbyVisibility } from '../../../common/lobbies/lobby-visibility'
import { SbUserId } from '../../../common/users/sb-user-id'

const LISTED_VISIBILITY: LobbyVisibility = 'listed'

/**
 * Determines if a user can access replays for a game.
 * - Matchmaking games: any user can access
 * - Lobby games with `listed` visibility: any user can access, since the game itself was public
 * - Other lobby games (unlisted, or predating the visibility field): only participants can
 *   access, where participants include team members and observers
 * - Solo games: only the person who played it can access
 */
export function canUserAccessReplay(game: GameRecord, userId: SbUserId | undefined): boolean {
  if (game.config.gameSource === GameSource.Matchmaking) {
    return true
  }

  if (game.config.gameSource === GameSource.Lobby) {
    if (game.config.gameSourceExtra?.visibility === LISTED_VISIBILITY) {
      return true
    }

    return wasParticipant(game, userId)
  }

  if (game.config.gameSource === GameSource.Solo) {
    return wasParticipant(game, userId)
  }

  return false
}

/** Whether `userId` was in the game, either playing or observing. */
function wasParticipant(game: GameRecord, userId: SbUserId | undefined): boolean {
  if (!userId) {
    return false
  }
  const allPlayers = game.config.teams.flat()
  return (
    allPlayers.some(p => !p.isComputer && p.id === userId) ||
    (game.config.observers?.includes(userId) ?? false)
  )
}
