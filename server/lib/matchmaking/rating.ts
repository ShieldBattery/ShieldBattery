import { ReconciledPlayerResult, ReconciledResult } from '../../../common/games/results'
import {
  getTotalBonusPoolForSeason,
  MATCHMAKING_INACTIVE_TIME_MS,
  MatchmakingSeason,
  POINTS_FOR_RATING_TARGET_FACTOR,
  wasPlayerInactive,
} from '../../../common/matchmaking'
import { SbUserId } from '../../../common/users/sb-user-id'
import { ActiveLeagueUser, LeagueUserChange } from '../leagues/league-models'
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
  activeLeagues: ReadonlyMap<SbUserId, ActiveLeagueUser[]>
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
        teammates: [],
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
        teammates: [],
        opponentRating: mmrs[0].rating,
        opponentUncertainty: mmrs[0].uncertainty,
        result: results.get(mmrs[1].userId)!.result,
        activeLeagues: activeLeagues.get(mmrs[1].userId) ?? [],
      }),
    )
  } else {
    // Teams
    const [teamA, teamB] = teams
    const mmrById = new Map(mmrs.map(mmr => [mmr.userId, mmr]))

    const teamARatings = teamA.map(userId => mmrById.get(userId)!)
    const [teamAEffective, teamAUncertainty] = calcTeamRating(teamARatings)

    const teamBRatings = teamB.map(userId => mmrById.get(userId)!)
    const [teamBEffective, teamBUncertainty] = calcTeamRating(teamBRatings)

    // Each player is rated individually, but against the result their whole team was expected to
    // get versus the other team. Players can't queue together, so teammates are reshuffled from game
    // to game; over many games the player is the only constant across their teams, which is what
    // lets team results separate out individual skill. Rating a player against the opposing team
    // without their teammates instead punishes whoever the matchmaker pairs with weaker teammates to
    // balance a match, and rewards whoever it pairs with stronger ones.
    for (const [team, opponentRating, opponentUncertainty] of [
      [teamARatings, teamBEffective, teamBUncertainty],
      [teamBRatings, teamAEffective, teamAUncertainty],
    ] as const) {
      for (const player of team) {
        result.set(
          player.userId,
          makeRatingChanges({
            season,
            gameId,
            gameDate,
            player,
            teammates: team.filter(teammate => teammate.userId !== player.userId),
            opponentRating,
            opponentUncertainty,
            result: results.get(player.userId)!.result,
            activeLeagues: activeLeagues.get(player.userId) ?? [],
          }),
        )
      }
    }
  }

  return result
}

/**
 * Calculates the rating for a team as a whole, to be used as the "opponent" in team matches: the
 * arithmetic mean of its players' ratings and uncertainties. The matchmaker balances teams on the
 * same mean, so the two agree on which team is favored.
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
/**
 * The lowest a player's uncertainty can go, by team size. A team game says much less about any one
 * player than a 1v1 does, and team-mode rating moves are scaled down to match (see
 * `makeRatingChanges`), so at the 1v1 floor a team-mode rating would barely respond to a lasting
 * change in the player's skill. Higher floors keep those ratings moving.
 */
function minUncertainty(teamSize: number): number {
  switch (teamSize) {
    case 1:
      return 30
    case 2:
      return 80
    default:
      return 100
  }
}

function makeRatingChanges({
  season,
  gameId,
  gameDate,
  player,
  teammates,
  opponentRating: opponentRatingGlicko,
  opponentUncertainty: opponentUncertaintyGlicko,
  result,
  activeLeagues,
}: {
  season: MatchmakingSeason
  gameId: string
  gameDate: Date
  player: MatchmakingRating
  /** The player's teammates in this game, not including the player. Empty for 1v1. */
  teammates: ReadonlyArray<MatchmakingRating>
  opponentRating: number
  opponentUncertainty: number
  result: ReconciledResult
  activeLeagues: ReadonlyArray<ActiveLeagueUser>
}): RatingChanges {
  // Calculations are described here:
  // https://docs.google.com/document/d/1gHY9t3fe2qK2dwFjpVz6U2gaET-nc1iXhgMdOhcyDaE/view
  // In team games, the expected result is the player's whole team versus the opposing team. The
  // player's own rating is only 1/teamSize of their team's average, so it moves their team's
  // expected result by only that fraction, and the rating move is scaled to match; otherwise
  // team-mode ratings wander far more than skill differences justify. Without teammates both reduce
  // to the standard calculation.
  const teamSize = teammates.length + 1
  const teammateRatingSum = teammates.reduce((sum, teammate) => sum + teammate.rating, 0)
  const teamRatingGlicko = (player.rating + teammateRatingSum) / teamSize
  const ratingStep = 1 / teamSize

  // 1) Convert from Glicko to Glicko-2 scale
  const selfRating = (player.rating - 1500) / 173.7178
  const selfUncertainty = player.uncertainty / 173.7178
  const selfVolatility = player.volatility
  const teamRating = (teamRatingGlicko - 1500) / 173.7178
  const opponentRating = (opponentRatingGlicko - 1500) / 173.7178
  const opponentUncertainty = opponentUncertaintyGlicko / 173.7178
  // 2) Determine variance
  const opponentWeight =
    1 / Math.sqrt(1 + (3 * opponentUncertainty * opponentUncertainty) / (Math.PI * Math.PI))
  const expectedProbability = 1 / (1 + Math.exp(-opponentWeight * (teamRating - opponentRating)))

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
    selfRating +
    ratingStep * Math.pow(newUncertainty, 2) * opponentWeight * (outcome - expectedProbability)

  // 8) Convert ratings and RDs back to Glicko
  newRating = Math.max(173.7178 * newRating + 1500, 0)
  newUncertainty = Math.min(Math.max(173.7178 * newUncertainty, minUncertainty(teamSize)), 350)

  // Calculate change in points
  const totalBonusPool = getTotalBonusPoolForSeason(gameDate, season)
  const teammateRatings = teammates.map(teammate => teammate.rating)
  const [pointsChange, bonusApplied, pointsConverged] = calcPointsChange({
    convergence: ladderConvergence(player.rating, player.uncertainty),
    points: player.points,
    pointsConverged: player.pointsConverged,
    bonusInfo: {
      bonusUsed: player.bonusUsed,
      bonusAvailable: Math.max(Math.floor(totalBonusPool - player.bonusUsed), 0),
    },
    teammateRatings,
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
      convergence: leagueConvergence(player.rating, player.uncertainty, league),
      points: league.points,
      pointsConverged: league.pointsConverged,
      teammateRatings,
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

/**
 * How a player's points converge on the target for their rating: the extra points a win adds while
 * they're below it, and when they count as having reached it. Both take the player's points
 * without any bonus pool applied: `extraWinPoints` as of before the game, `isConverged` after it.
 */
interface PointsConvergence {
  extraWinPoints(pointsWithoutBonus: number): number
  isConverged(pointsWithoutBonus: number): boolean
}

/** The share of the gap to the catch-up target that a win adds. */
const CATCH_UP_GAP_SHARE = 0.5
/** The most catch-up points a single ladder win can add. */
const MAX_LADDER_CATCH_UP_POINTS = 400

/**
 * Points catch up to a target of `POINTS_FOR_RATING_TARGET_FACTOR` times the player's rating minus
 * their uncertainty, a cautious estimate of their skill. Each win adds a share of the remaining gap,
 * up to `maxExtraPoints`, so the extra shrinks to nothing as points near the target. A new player's
 * uncertainty is high, so a lucky run of early wins can't carry their points past what their rating
 * will support once it settles.
 *
 * The extra applies whenever points are below the target, not just until the first time they reach
 * it, so points keep following a rating that climbs later on.
 */
function gapConvergence(
  rating: number,
  uncertainty: number,
  maxExtraPoints: number,
): PointsConvergence {
  const target = POINTS_FOR_RATING_TARGET_FACTOR * (rating - uncertainty)
  return {
    extraWinPoints: pointsWithoutBonus =>
      Math.min(maxExtraPoints, Math.max(0, CATCH_UP_GAP_SHARE * (target - pointsWithoutBonus))),
    isConverged: pointsWithoutBonus => pointsWithoutBonus >= target,
  }
}

/**
 * A ladder win adds at most a fixed number of catch-up points, so players at every rating catch up
 * over a similar number of games.
 */
function ladderConvergence(rating: number, uncertainty: number): PointsConvergence {
  return gapConvergence(rating, uncertainty, MAX_LADDER_CATCH_UP_POINTS)
}

const WEEK_MS = 7 * 24 * 60 * 60 * 1000

/**
 * League points start at 0 for everyone and leagues run for a set number of weeks, so the most a
 * league win can add is the player's cautious rating divided by the league's length in weeks. That
 * takes the same number of wins to reach the target at any rating, and about 4 wins a week reaches
 * it by the end of a league of any length. Players who play more get there sooner and stay there
 * longer, so activity still counts, while a single win can't jump a player far past those who have
 * played all league.
 */
function leagueConvergence(
  rating: number,
  uncertainty: number,
  league: Readonly<ActiveLeagueUser>,
): PointsConvergence {
  const weeks = Math.max(1, (Number(league.leagueEndAt) - Number(league.leagueStartAt)) / WEEK_MS)
  return gapConvergence(rating, uncertainty, Math.max(0, rating - uncertainty) / weeks)
}

function calcPointsChange({
  convergence,
  points,
  pointsConverged,
  bonusInfo,
  teammateRatings,
  opponentRatingGlicko,
  result,
}: {
  convergence: PointsConvergence
  points: number
  pointsConverged: boolean
  bonusInfo?: BonusInfo
  /** Ratings of the player's teammates in this game, not including the player. Empty for 1v1. */
  teammateRatings: ReadonlyArray<number>
  opponentRatingGlicko: number
  result: ReconciledResult
}): [pointsChange: number, bonusApplied: number, pointsConverged: boolean] {
  const outcome = result === 'win' ? 1 : 0

  const pointsWithoutBonus = bonusInfo ? Math.max(points - bonusInfo.bonusUsed, 0) : points
  // The player's points stand in for their own rating within their team's average, so wins with
  // strong teammates are expected and earn little, while losses with them cost more.
  const teamStrength =
    (pointsWithoutBonus +
      POINTS_FOR_RATING_TARGET_FACTOR * teammateRatings.reduce((sum, r) => sum + r, 0)) /
    (teammateRatings.length + 1)
  const winProbability =
    1 /
    (1 +
      Math.pow(10, (POINTS_FOR_RATING_TARGET_FACTOR * opponentRatingGlicko - teamStrength) / 1600))
  let pointsChange =
    POINTS_FOR_RATING_TARGET_FACTOR * POINTS_ELO_K_FACTOR * (outcome - winProbability)
  if (result === 'win' && pointsChange < 1) {
    pointsChange = 1
  }

  if (result === 'win') {
    pointsChange += convergence.extraWinPoints(pointsWithoutBonus)
  }

  let bonusApplied = 0
  if (bonusInfo) {
    // For wins, bonus pool can up to double the point improvement, catch-up points included, so a
    // player who is far below their target spends their pool quickly. For losses, bonus pool can
    // offset up to the entire amount of the point loss.
    bonusApplied = Math.min(bonusInfo.bonusAvailable, Math.abs(pointsChange))
    pointsChange = pointsChange + bonusApplied
  }

  // Ensure that a player's points cannot go below 0
  pointsChange = Math.max(pointsChange, -points)
  const newPointsConverged =
    pointsConverged ||
    convergence.isConverged(points + pointsChange - ((bonusInfo?.bonusUsed ?? 0) + bonusApplied))

  return [pointsChange, bonusApplied, newPointsConverged]
}
