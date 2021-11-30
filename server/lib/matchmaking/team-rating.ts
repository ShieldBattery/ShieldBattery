import { QueuedMatchmakingPlayer } from './matchmaker-queue'
import { MatchmakingRating } from './models'

/**
 * Calculates the effective rating of a team, as if they were a single player. Attempts to weight
 * things such that more skilled players influence the resulting rating more than less skilled ones.
 */
export function calcEffectiveRating(
  team: ReadonlyArray<Readonly<QueuedMatchmakingPlayer | MatchmakingRating>>,
): number {
  // Calculate the root mean square of the team's ratings. Using this formula means that players
  // with higher rating effectively count for more in the output, so a [2500 + 500] team has a
  // higher effective rating than a [1500 + 1500] team.
  const sum = team.reduce((sum, player) => sum + player.rating * player.rating, 0)
  // TODO(tec27): Determine what the proper exponent is for this from win/loss data
  return Math.pow(sum / team.length, 1 / 2)
}
