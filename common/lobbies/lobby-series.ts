import { SbUserId } from '../users/sb-user-id'
import { LobbySeriesGameJson } from './lobby-network'

/**
 * Who won one of the games a lobby played: the side that won it, or, in a game whose roster is a
 * single side (melee, FFA, 1v1), the one player who did.
 */
export type LobbySeriesWinner =
  | { kind: 'team'; teamId: number; name?: string }
  | { kind: 'player'; userId: SbUserId }

/**
 * Returns who won a series game, if a single side or player can be said to have.
 *
 * The answer is drawn from the people the lobby seated, so a game none of them won — a draw, a game
 * a computer won, one everyone the lobby recorded lost — has no winner, and neither does the
 * contradiction of winners sitting on two different sides.
 */
export function findSeriesGameWinner(game: LobbySeriesGameJson): LobbySeriesWinner | undefined {
  if (!game.result) {
    return undefined
  }

  const winners = new Set(
    game.result.outcomes.filter(outcome => outcome.result === 'win').map(o => o.userId),
  )
  if (!winners.size) {
    return undefined
  }

  if (game.teams.length > 1) {
    const winningTeams = game.teams.filter(team =>
      team.players.some(player => player.type === 'human' && winners.has(player.userId)),
    )
    if (winningTeams.length !== 1) {
      return undefined
    }

    const { teamId, name } = winningTeams[0]
    return { kind: 'team', teamId, ...(name !== undefined ? { name } : {}) }
  }

  // A roster with one side is everyone against everyone, so the win belongs to a person rather than
  // to the side they all sit on.
  return winners.size === 1 ? { kind: 'player', userId: [...winners][0] } : undefined
}

/**
 * Tallies how many of a series' games each player won. A game whose results have not settled counts
 * for nobody.
 *
 * Every human on a winning side reports a win of their own, so a team game is counted exactly like
 * a solo one.
 */
export function getWinsByUser(games: ReadonlyArray<LobbySeriesGameJson>): Map<SbUserId, number> {
  const wins = new Map<SbUserId, number>()
  for (const game of games) {
    for (const outcome of game.result?.outcomes ?? []) {
      if (outcome.result === 'win') {
        wins.set(outcome.userId, (wins.get(outcome.userId) ?? 0) + 1)
      }
    }
  }
  return wins
}
