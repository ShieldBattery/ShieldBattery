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
 */
export function canUserAccessReplay(game: GameRecord, userId: SbUserId | undefined): boolean {
  if (game.config.gameSource === GameSource.Matchmaking) {
    return true
  }

  if (game.config.gameSource === GameSource.Lobby) {
    if (game.config.gameSourceExtra?.visibility === LISTED_VISIBILITY) {
      return true
    }

    if (!userId) {
      return false
    }
    // Check if user was a participant, either playing or observing
    const allPlayers = game.config.teams.flat()
    return (
      allPlayers.some(p => !p.isComputer && p.id === userId) ||
      (game.config.observers?.includes(userId) ?? false)
    )
  }

  return false
}
