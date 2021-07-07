import { ReconciledPlayerResult, ReconciledResult } from '../../../common/games/results'
import { NEW_PLAYER_GAME_COUNT } from './constants'
import { MatchmakingRating, MatchmakingRatingChange } from './models'

/**
 * Calculates a `MatchmakingRatingChange` for each user in a game. This function expects that every
 * player in `results` has a matching entry in `mmrs`.
 *
 * @param gameId the ID of the game that was played
 * @param gameDate when the game was completed (and changed ratings were calculated)
 * @param results the reconciled results of the game, with everyone having a win or a loss (e.g.
 *   not disputed results)
 * @param mmrs the current matchmaking rating info for the user, prior to playing the game
 */
export function calculateChangedRatings(
  gameId: string,
  gameDate: Date,
  results: Map<number, ReconciledPlayerResult>,
  mmrs: MatchmakingRating[],
): Map<number, MatchmakingRatingChange> {
  if (results.size !== 2) {
    throw new Error('Team MMR not implemented yet')
  }

  const result = new Map<number, MatchmakingRatingChange>()
  result.set(
    mmrs[0].userId,
    makeRatingChange(gameId, gameDate, mmrs[0], mmrs[1], results.get(mmrs[0].userId)!.result),
  )
  result.set(
    mmrs[1].userId,
    makeRatingChange(gameId, gameDate, mmrs[1], mmrs[0], results.get(mmrs[1].userId)!.result),
  )

  return result
}

function makeRatingChange(
  gameId: string,
  gameDate: Date,
  player: MatchmakingRating,
  opponent: MatchmakingRating,
  result: ReconciledResult,
): MatchmakingRatingChange {
  const ratingDiff = opponent.rating - player.rating
  const p = 1 / (1 + Math.pow(10, ratingDiff / 400))
  const outcome = result === 'win' ? 1 : 0

  const newRating = Math.max(player.rating + player.kFactor * (outcome - p), 0)

  let newKFactor = player.kFactor
  if (player.numGamesPlayed >= NEW_PLAYER_GAME_COUNT) {
    if (outcome === 1 && p >= 0.5) {
      newKFactor -= p
    } else if (outcome === 0 && p < 0.5) {
      newKFactor -= 1 - p
    }
  }

  const unexpected = (outcome === 1 && p < 0.5) || (outcome === 0 && p >= 0.5)
  let newUnexpectedStreak = unexpected ? player.unexpectedStreak + 1 : 0
  if (newUnexpectedStreak > 2) {
    newUnexpectedStreak = 0
    newKFactor += 1
  }

  newKFactor = Math.max(Math.min(newKFactor, 40), 24)

  const uncertaintyChange = Math.abs(player.kFactor * (outcome - p))
  let newUncertainty = unexpected
    ? player.uncertainty + uncertaintyChange
    : player.uncertainty - uncertaintyChange

  newUncertainty = Math.max(Math.min(newUncertainty, 600), 80)

  return {
    userId: player.userId,
    matchmakingType: player.matchmakingType,
    gameId,
    changeDate: gameDate,
    outcome: result === 'win' ? 'win' : 'loss',
    rating: newRating,
    ratingChange: newRating - player.rating,
    kFactor: newKFactor,
    kFactorChange: newKFactor - player.kFactor,
    uncertainty: newUncertainty,
    uncertaintyChange: newUncertainty - player.uncertainty,
    probability: p,
    unexpectedStreak: newUnexpectedStreak,
  }
}
