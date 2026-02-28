import { GameSource } from '../../../common/games/configuration'
import { GameRecord } from '../../../common/games/games'
import { SbUserId } from '../../../common/users/sb-user-id'

/**
 * Determines if a user can access replays for a game.
 * - Matchmaking games: any user can access
 * - Lobby games: only participants can access
 */
export function canUserAccessReplay(game: GameRecord, userId: SbUserId | undefined): boolean {
  if (game.config.gameSource === GameSource.Matchmaking) {
    return true
  }

  if (game.config.gameSource === GameSource.Lobby) {
    if (!userId) {
      return false
    }
    // Check if user was a participant
    const allPlayers = game.config.teams.flat()
    return allPlayers.some(p => !p.isComputer && p.id === userId)
  }

  return false
}
