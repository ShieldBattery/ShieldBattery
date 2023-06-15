import { ReconciledPlayerResult, ReconciledResult } from '../../../common/games/results'
import {
  MATCHMAKING_BONUS_EARNED_PER_MS,
  MATCHMAKING_INACTIVE_TIME_MS,
  MatchmakingSeason,
  arePointsConverged,
  getConvergencePoints,
  wasPlayerInactive,
} from '../../../common/matchmaking'
import { SbUserId } from '../../../common/users/sb-user'
import { LeagueUser, LeagueUserChange } from '../leagues/league-models'
import { MatchmakingRating, MatchmakingRatingChange } from './models'

export interface RatingChanges {
  matchmaking: MatchmakingRatingChange
  leagues: LeagueUserChange[]
}

/**
 * Calculates a `MatchmakingRatingChange` for each user in a game. This function expects that every
 * player in `results` has a matching entry in `mmrs`.
 */
export function calculateChangedRatings({
  season,
  gameId,
  gameDate,
  results,
  mmrs: unadjustedMmrs,
  teams,
  activeLeagues,
}: {
  /** The matchmaking season the game was played in. */
  season: MatchmakingSeason
  /** The ID of the game that was played. */
  gameId: string
  /** When the game was completed (and changed ratings were calculated). */
  gameDate: Date
  /**
   * The reconciled results of the game, with everyone having a win or a loss (e.g. not disputed
   * results).
   */
  results: ReadonlyMap<SbUserId, ReconciledPlayerResult>
  /** The current matchmaking rating info for the users, prior to playing the game. */
  mmrs: ReadonlyArray<Readonly<MatchmakingRating>>
  /** The player's user IDs split into their respective teams. */
  teams: [teamA: SbUserId[], teamB: SbUserId[]]
  /** Any running leagues a player is participating in, grouped by user ID. */
  activeLeagues: ReadonlyMap<SbUserId, LeagueUser[]>
  // TODO(tec27): Pass in party information as well
}): Map<SbUserId, RatingChanges> {
  const result = new Map<SbUserId, RatingChanges>()

  const mmrs = unadjustedMmrs.map(m => adjustMatchmakingRatingForInactivity(m, gameDate))

  if (results.size === 2) {
    // 1v1
    result.set(
      mmrs[0].userId,
      makeRatingChanges({
        season,
        gameId,
        gameDate,
        player: mmrs[0],
        opponentRating: mmrs[1].rating,
        opponentUncertainty: mmrs[1].uncertainty,
        result: results.get(mmrs[0].userId)!.result,
        activeLeagues: activeLeagues.get(mmrs[0].userId) ?? [],
      }),
    )
    result.set(
      mmrs[1].userId,
      makeRatingChanges({
        season,
        gameId,
        gameDate,
        player: mmrs[1],
        opponentRating: mmrs[0].rating,
        opponentUncertainty: mmrs[0].uncertainty,
        result: results.get(mmrs[1].userId)!.result,
        activeLeagues: activeLeagues.get(mmrs[1].userId) ?? [],
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
    const [teamAEffective, teamAUncertainty] = calcTeamRating(teamARatings)

    const teamBRatings = teamB.map(userId => mmrById.get(userId)!)
    const [teamBEffective, teamBUncertainty] = calcTeamRating(teamBRatings)

    // All players on team A get their rating adjusted based on the effective rating of team B
    for (const player of teamARatings) {
      result.set(
        player.userId,
        makeRatingChanges({
          season,
          gameId,
          gameDate,
          player,
          opponentRating: teamBEffective,
          opponentUncertainty: teamBUncertainty,
          result: results.get(player.userId)!.result,
          activeLeagues: activeLeagues.get(player.userId) ?? [],
        }),
      )
    }

    // All players on team B get their rating adjusted based on the effective rating of team A
    for (const player of teamBRatings) {
      result.set(
        player.userId,
        makeRatingChanges({
          season,
          gameId,
          gameDate,
          player,
          opponentRating: teamAEffective,
          opponentUncertainty: teamAUncertainty,
          result: results.get(player.userId)!.result,
          activeLeagues: activeLeagues.get(player.userId) ?? [],
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
function calcTeamRating(
  ratings: ReadonlyArray<MatchmakingRating>,
): [rating: number, uncertainty: number] {
  const ratingSum = ratings.reduce((sum, rating) => sum + rating.rating, 0)
  const uncertaintySum = ratings.reduce((sum, rating) => sum + rating.uncertainty, 0)
  return [ratingSum / ratings.length, uncertaintySum / ratings.length]
}

const MAX_INCREASED_UNCERTAINTY = 200 / 173.7178

/**
 * Returns a MatchmakingRating that has had its value adjusted for how inactive the player has been.
 * If the player is not inactive, the return value will be the same as the input.
 */
export function adjustMatchmakingRatingForInactivity(
  mmr: Readonly<MatchmakingRating>,
  targetDate: Date,
): Readonly<MatchmakingRating> {
  if (!wasPlayerInactive(mmr.lastPlayedDate, targetDate)) {
    return mmr
  }

  let newUncertainty = mmr.uncertainty / 173.7178
  const periodsInactive = Math.floor(
    (Number(targetDate) - Number(mmr.lastPlayedDate)) / MATCHMAKING_INACTIVE_TIME_MS,
  )
  for (let i = 0; i < periodsInactive; i++) {
    const next = Math.sqrt(Math.pow(newUncertainty, 2) + Math.pow(mmr.volatility, 2))
    if (next > MAX_INCREASED_UNCERTAINTY) {
      newUncertainty = MAX_INCREASED_UNCERTAINTY
      break
    }

    newUncertainty = next
  }

  return {
    ...mmr,
    uncertainty: newUncertainty * 173.7178,
  }
}

const VOLATILITY_CHANGE = 0.5
const POINTS_ELO_K_FACTOR = 24
const MIN_UNCERTAINTY = 30

function makeRatingChanges({
  season,
  gameId,
  gameDate,
  player,
  opponentRating: opponentRatingGlicko,
  opponentUncertainty: opponentUncertaintyGlicko,
  result,
  activeLeagues,
}: {
  season: MatchmakingSeason
  gameId: string
  gameDate: Date
  player: MatchmakingRating
  opponentRating: number
  opponentUncertainty: number
  result: ReconciledResult
  activeLeagues: ReadonlyArray<LeagueUser>
}): RatingChanges {
  // Calculations are described here:
  // https://docs.google.com/document/d/1gHY9t3fe2qK2dwFjpVz6U2gaET-nc1iXhgMdOhcyDaE/view

  // 1) Convert from Glicko to Glicko-2 scale
  const selfRating = (player.rating - 1500) / 173.7178
  const selfUncertainty = player.uncertainty / 173.7178
  const selfVolatility = player.volatility
  const opponentRating = (opponentRatingGlicko - 1500) / 173.7178
  const opponentUncertainty = opponentUncertaintyGlicko / 173.7178
  // 2) Determine variance
  const opponentWeight =
    1 / Math.sqrt(1 + (3 * opponentUncertainty * opponentUncertainty) / (Math.PI * Math.PI))
  const expectedProbability = 1 / (1 + Math.exp(-opponentWeight * (selfRating - opponentRating)))

  const variance =
    1 / (opponentWeight * opponentWeight * expectedProbability * (1 - expectedProbability))
  // 3) Determine estimated improvement in rating
  const outcome = result === 'win' ? 1 : 0
  const estimatedImprovement = variance * opponentWeight * (outcome - expectedProbability)
  // 4) Update volatility
  // 4.1)
  const a = Math.log(selfVolatility * selfVolatility)
  const f = (x: number) =>
    (Math.exp(x) *
      (Math.pow(estimatedImprovement, 2) - Math.pow(selfUncertainty, 2) - variance - Math.exp(x))) /
      (2 * Math.pow(Math.pow(selfUncertainty, 2) + variance + Math.exp(x), 2)) -
    (x - a) / Math.pow(VOLATILITY_CHANGE, 2)
  const EPSILON = 0.000001

  // 4.2)
  let aValue = a
  let bValue: number
  if (Math.pow(estimatedImprovement, 2) > Math.pow(selfUncertainty, 2) + variance) {
    bValue = Math.log(Math.pow(estimatedImprovement, 2) - Math.pow(selfUncertainty, 2) - variance)
  } else {
    let k = 1
    while (f(a - k * VOLATILITY_CHANGE) < 0) {
      k += 1
    }
    bValue = a - k * VOLATILITY_CHANGE
  }

  // 4.3)
  let fA = f(aValue)
  let fB = f(bValue)

  // 4.4)
  while (Math.abs(bValue - aValue) > EPSILON) {
    const cValue = aValue + ((aValue - bValue) * fA) / (fB - fA)
    const fC = f(cValue)
    if (fC * fB < 0) {
      aValue = bValue
      fA = fB
    } else {
      fA = fA / 2
    }

    bValue = cValue
    fB = fC
  }
  // 4.5)
  const newVolatility = Math.exp(aValue / 2)
  // 5) Update RD to the new pre-rating period value
  const periodValue = Math.sqrt(Math.pow(selfUncertainty, 2) + Math.pow(newVolatility, 2))
  // 6.1) Update the RD and rating to new values
  let newUncertainty = 1 / Math.sqrt(1 / Math.pow(periodValue, 2) + 1 / variance)
  let newRating =
    selfRating + Math.pow(newUncertainty, 2) * opponentWeight * (outcome - expectedProbability)

  // 8) Convert ratings and RDs back to Glicko
  newRating = Math.max(173.7178 * newRating + 1500, 0)
  newUncertainty = Math.min(Math.max(173.7178 * newUncertainty, MIN_UNCERTAINTY), 350)

  // Calculate change in points
  const timeSinceSeasonStart = Number(gameDate) - Number(season.startDate)
  const [pointsChange, bonusApplied, pointsConverged] = calcPointsChange({
    rating: player.rating,
    points: player.points,
    pointsConverged: player.pointsConverged,
    bonusInfo: {
      bonusUsed: player.bonusUsed,
      bonusAvailable: Math.max(
        Math.floor(timeSinceSeasonStart * MATCHMAKING_BONUS_EARNED_PER_MS - player.bonusUsed),
        0,
      ),
    },
    opponentRatingGlicko,
    result,
  })

  const matchmakingChange: MatchmakingRatingChange = {
    userId: player.userId,
    matchmakingType: player.matchmakingType,
    gameId,
    changeDate: gameDate,
    outcome: result === 'win' ? 'win' : 'loss',
    rating: newRating,
    ratingChange: newRating - player.rating,
    uncertainty: newUncertainty,
    uncertaintyChange: newUncertainty - player.uncertainty,
    volatility: newVolatility,
    volatilityChange: newVolatility - player.volatility,
    points: player.points + pointsChange,
    pointsChange,
    pointsConverged,
    bonusUsed: player.bonusUsed + bonusApplied,
    bonusUsedChange: bonusApplied,
    probability: expectedProbability,
    lifetimeGames: player.lifetimeGames + 1,
  }

  // Calculate changes for leagues
  const leagueChanges: LeagueUserChange[] = activeLeagues.map(league => {
    const [pointsChange, _, pointsConverged] = calcPointsChange({
      rating: player.rating,
      points: league.points,
      pointsConverged: league.pointsConverged,
      opponentRatingGlicko,
      result,
    })

    return {
      userId: player.userId,
      leagueId: league.leagueId,
      gameId,
      changeDate: gameDate,
      outcome: result === 'win' ? 'win' : 'loss',
      points: league.points + pointsChange,
      pointsChange,
      pointsConverged,
    }
  })

  return {
    matchmaking: matchmakingChange,
    leagues: leagueChanges,
  }
}

interface BonusInfo {
  bonusUsed: number
  bonusAvailable: number
}

function calcPointsChange({
  rating,
  points,
  pointsConverged,
  bonusInfo,
  opponentRatingGlicko,
  result,
}: {
  rating: number
  points: number
  pointsConverged: boolean
  bonusInfo?: BonusInfo
  opponentRatingGlicko: number
  result: ReconciledResult
}): [pointsChange: number, bonusApplied: number, pointsConverged: boolean] {
  const outcome = result === 'win' ? 1 : 0

  const pointsWithoutBonus = bonusInfo ? Math.max(points - bonusInfo.bonusUsed, 0) : points
  const winProbability =
    1 / (1 + Math.pow(10, (4 * opponentRatingGlicko - pointsWithoutBonus) / 1600))
  let pointsChange = 4 * POINTS_ELO_K_FACTOR * (outcome - winProbability)
  if (result === 'win' && pointsChange < 1) {
    pointsChange = 1
  }

  let bonusApplied = 0
  if (bonusInfo) {
    // For wins, bonus pool can up to double the point improvement. For losses, bonus pool can
    // offset up to the entire amount of the point loss.
    bonusApplied = Math.min(bonusInfo.bonusAvailable, Math.abs(pointsChange))
    pointsChange = pointsChange + bonusApplied
  }

  let newPointsConverged = pointsConverged
  if (result === 'win' && !newPointsConverged) {
    pointsChange += getConvergencePoints(rating)
  }

  // Ensure that a player's points cannot go below 0
  pointsChange = Math.max(pointsChange, -points)
  newPointsConverged =
    newPointsConverged ||
    arePointsConverged(rating, points + pointsChange - ((bonusInfo?.bonusUsed ?? 0) + bonusApplied))

  return [pointsChange, bonusApplied, newPointsConverged]
}
