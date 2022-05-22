import { ReconciledPlayerResult, ReconciledResult } from '../../../common/games/results'
import { SbUserId } from '../../../common/users/sb-user'
import { NEW_PLAYER_GAME_COUNT } from './constants'
import { MatchmakingRating, MatchmakingRatingChange } from './models'

/**
 * Calculates a `MatchmakingRatingChange` for each user in a game. This function expects that every
 * player in `results` has a matching entry in `mmrs`.
 *
 * @deprecated Only use for calculating legacy ratings, will be deleted soon.
 */
export function legacyCalculateChangedRatings({
  gameId,
  gameDate,
  results,
  mmrs,
  teams,
}: {
  /** The ID of the game that was played. */
  gameId: string
  /** When the game was completed (and changed ratings were calculated). */
  gameDate: Date
  /**
   * The reconciled results of the game, with everyone having a win or a loss (e.g. not disputed
   * results).
   */
  results: Map<SbUserId, ReconciledPlayerResult>
  /** The current matchmaking rating info for the users, prior to playing the game. */
  mmrs: MatchmakingRating[]
  /** The player's user IDs split into their respective teams. */
  teams: [teamA: SbUserId[], teamB: SbUserId[]]
  // TODO(tec27): Pass in party information as well
}): Map<SbUserId, MatchmakingRatingChange> {
  const result = new Map<SbUserId, MatchmakingRatingChange>()

  if (results.size === 2) {
    // 1v1
    result.set(
      mmrs[0].userId,
      legacyMakeRatingChange({
        gameId,
        gameDate,
        player: mmrs[0],
        opponentRating: mmrs[1].rating,
        result: results.get(mmrs[0].userId)!.result,
      }),
    )
    result.set(
      mmrs[1].userId,
      legacyMakeRatingChange({
        gameId,
        gameDate,
        player: mmrs[1],
        opponentRating: mmrs[0].rating,
        result: results.get(mmrs[1].userId)!.result,
      }),
    )
  } else {
    // Teams
    const [teamA, teamB] = teams
    const mmrById = mmrs.reduce((result, mmr) => {
      result.set(mmr.userId, mmr)
      return result
    }, new Map<SbUserId, MatchmakingRating>())

    const teamARatings = teamA.map(userId => mmrById.get(userId)!)
    const teamAEffective = calcTeamRating(teamARatings)

    const teamBRatings = teamB.map(userId => mmrById.get(userId)!)
    const teamBEffective = calcTeamRating(teamBRatings)

    // All players on team A get their rating adjusted based on the effective rating of team B
    for (const player of teamARatings) {
      result.set(
        player.userId,
        legacyMakeRatingChange({
          gameId,
          gameDate,
          player,
          opponentRating: teamBEffective,
          result: results.get(player.userId)!.result,
        }),
      )
    }

    // All players on team B get their rating adjusted based on the effective rating of team A
    for (const player of teamBRatings) {
      result.set(
        player.userId,
        legacyMakeRatingChange({
          gameId,
          gameDate,
          player,
          opponentRating: teamAEffective,
          result: results.get(player.userId)!.result,
        }),
      )
    }
  }

  return result
}

/**
 * Calculates the rating for a team as a whole, to be used as the "opponent" in team matches. Note
 * that this differs from the effective rating using during matchmaking because we want to ensure
 * that rating inflation doesn't occur.
 */
function calcTeamRating(ratings: ReadonlyArray<MatchmakingRating>): number {
  const sum = ratings.reduce((sum, rating) => sum + rating.rating, 0)
  return sum / ratings.length
}

/**
 * @deprecated Only use for calculating legacy ratings, will be deleted soon.
 */
function legacyMakeRatingChange({
  gameId,
  gameDate,
  player,
  opponentRating,
  result,
}: {
  gameId: string
  gameDate: Date
  player: MatchmakingRating
  opponentRating: number
  result: ReconciledResult
}): MatchmakingRatingChange {
  const ratingDiff = opponentRating - player.rating
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
    points: newRating,
    pointsChange: newRating - player.rating,
    bonusUsed: 0,
    bonusUsedChange: 0,
    probability: p,
    unexpectedStreak: newUnexpectedStreak,
  }
}
