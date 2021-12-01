import { OrderedMap } from 'immutable'
import IntervalTree from 'node-interval-tree'
import { injectable } from 'tsyringe'
import { multipleRandomItems } from '../../../common/random'
import { range } from '../../../common/range'
import { ExponentialSmoothValue } from '../../../common/statistics/exponential-smoothing'
import { SbUserId } from '../../../common/users/user-info'
import logger from '../logging/logger'
import { LazyScheduler } from './lazy-scheduler'
import { QueuedMatchmakingPlayer } from './matchmaker-queue'
import { isNewPlayer, MatchmakingInterval, MatchmakingPlayer } from './matchmaking-player'

/** How often to run the matchmaker 'find match' process. */
export const MATCHMAKING_INTERVAL_MS = 6 * 1000
/**
 * How many iterations to search for a player's "ideal match" only, i.e. a player directly within
 * rating +/- (uncertainty / 2). After this many iterations, we start to widen the search range.
 */
const IDEAL_MATCH_ITERATIONS = 3
/**
 * How much we changes the search bound each iteration (on both sides).
 */
const SEARCH_BOUND_INCREASE = 15
/**
 * How many times the search bound will be increased before we stop.
 */
const MAX_SEARCH_BOUND_INCREASES = Math.ceil(120 / SEARCH_BOUND_INCREASE)

// Below are constants related to population estimation. A basic run-down of how that works:
// 1) Split the ratings into N evenly sized buckets
// 2) For each bucket, keep track of the peak number of players currently in queue over periods
//    of N minutes (using exponential smoothing on the value we record every N minutes)
// 3) When placing a player/team in the queue, use these bucketed smoothed values to find a
//    radius that we think will have at least the right number of players (e.g. 1 other player
//    for 1v1, 3 other players for 2v2 solo, ...)
// 4) If the calculated radius is less than their normal search radius, leave the normal search
//    radius intact. If it's bigger, adjust their search radius to match

/**
 * How many rating points each population tracking bucket represents. This is chosen to balance the
 * number of buckets required with accuracy (higher bucket count = more accuracy with estimates).
 */
const POPULATION_BUCKET_RATING = 100
/**
 * The max rating we track popualtion for (everything above this will be included in the top
 * bucket).
 */
const POPULATION_TRACKING_MAX_RATING = 3000
/** The number of buckets that exist for tracking population. */
const POPULATION_NUM_BUCKETS = Math.floor(POPULATION_TRACKING_MAX_RATING / POPULATION_BUCKET_RATING)
/**
 * How often to update the population estimates based on the current peak population, as a multiple
 * of `MATCHMAKING_INTERVAL_MS`. This is balanced between being more reactive
 * (shorter times = better?) and not causing too much system load (longer times = less CPU spent on
 * it).
 *
 * This time is also the minimum time that the matchmaker can remain active for (as we have to
 * update the estimates before shutting down). Probably optimizing for that is the wrong thing,
 * though, since it's optimizing for people *not* using the service :)
 */
const POPULATION_ESTIMATE_UPDATE_INTERVAL = 10
/**
 * How many missed update intervals to update for individually. Any amount of missed intervals over
 * this will simply reset all the estimates to 0.
 */
const MAX_MISSED_POPULATION_UPDATES = 20

function getPopulationBucket(rating: number): number {
  return Math.min(Math.floor(rating / POPULATION_BUCKET_RATING), POPULATION_NUM_BUCKETS - 1)
}

/**
 * Initializes a player (in-place) with their starting and max interval, if it is not already
 * present.
 *
 * This should only be used by the Matchmaker or in tests, you probably don't want to call this!
 */
export function initializePlayer(player: MatchmakingPlayer): QueuedMatchmakingPlayer {
  if (!player.startingInterval) {
    player.startingInterval = {
      low: player.interval.low,
      high: player.interval.high,
    }
  }
  if (!player.maxInterval) {
    player.maxInterval = {
      low: Math.max(0, player.interval.low - MAX_SEARCH_BOUND_INCREASES * SEARCH_BOUND_INCREASE),
      high: player.interval.high + MAX_SEARCH_BOUND_INCREASES * SEARCH_BOUND_INCREASE,
    }
  }

  return player as QueuedMatchmakingPlayer
}

/**
 * Calculates the effective rating of a team, as if they were a single player. Attempts to weight
 * things such that more skilled players influence the resulting rating more than less skilled ones.
 */
function calcEffectiveRating(team: ReadonlyArray<Readonly<QueuedMatchmakingPlayer>>): number {
  // Calculate the root mean square of the team's ratings. Using this formula means that players
  // with higher rating effectively count for more in the output, so a [2500 + 500] team has a
  // higher effective rating than a [1500 + 1500] team.
  const sum = team.reduce((sum, player) => sum + player.rating * player.rating, 0)
  // TODO(tec27): Determine what the proper exponent is for this from win/loss data
  return Math.pow(sum / team.length, 1 / 2)
}

type MatchedTeams = [
  teamA: Array<Readonly<QueuedMatchmakingPlayer>>,
  teamB: Array<Readonly<QueuedMatchmakingPlayer>>,
]

function findOptimalTeams(
  teamSize: number,
  player: Readonly<QueuedMatchmakingPlayer>,
  // TODO(tec27): Make this a ReadonlyArray once we're on TS 4.5+ (prior to that, Array.at is only
  // available on non-readonly arrays)
  selections: Array<Readonly<QueuedMatchmakingPlayer>>,
): MatchedTeams {
  if (teamSize !== 2) {
    // TODO(tec27): Rework for 3v3. This is incredibly simple for 2v2 (it's simply the matching
    // player + each of the other players vs whatever is leftover), not so much with more players on
    // each team.
    throw new Error('Team optimization is not yet implemented for team sizes > 2')
  }

  if (!selections.length) {
    throw new Error('selections must not be empty')
  }

  // Find all the different permutations of teams, select the one that minimizes the difference
  // between the two teams' effective ratings.
  let bestTeams: MatchedTeams
  let lowestRatingDiff = Infinity
  for (let i = 0; i < selections.length; i++) {
    const teamA = [player, selections[i]]
    const teamB = [selections.at(i - 1)!, selections.at((i + 1) % selections.length)!]
    const ratingDiff = Math.abs(calcEffectiveRating(teamA) - calcEffectiveRating(teamB))
    if (ratingDiff < lowestRatingDiff) {
      lowestRatingDiff = ratingDiff
      bestTeams = [teamA, teamB]
    }
  }

  return bestTeams!
}

/**
 * A function that filters down the potential players by some specific criteria, returning a
 * list of potential players that meet it.
 */
type PlayerFilter = (
  player: Readonly<QueuedMatchmakingPlayer>,
  potentials: ReadonlyArray<QueuedMatchmakingPlayer>,
  neededPlayers: number,
) => QueuedMatchmakingPlayer[]

// Filters that will be executed in order until we run under the needed number of players or all
// filters have been run. Once we reach that point, players will be selected at random from the
// remaining list, and teams will be optimized from that set.
const FILTERS: ReadonlyArray<PlayerFilter> = [
  // 1) If you are a new player (<25 games), choose the player that also is a new player
  // 2) If you are not a new player, choose the player that also is not a new player
  (player, potentials) => {
    const isNew = isNewPlayer(player)
    return potentials.filter(p => isNewPlayer(p) === isNew)
  },
  // TODO(tec27): 3) If applicable, choose the player in “Inactive” status.
  // TODO(tec27): 4) Choose the player with the lowest ping (in 50ms buckets).

  // 5) Choose the players that have been waiting in queue the longest.
  (_, potentials, neededPlayers) => {
    const sorted = potentials.slice().sort((a, b) => b.searchIterations - a.searchIterations)
    // Pick an iteration number that would still give us enough players
    const iterations = sorted[neededPlayers - 1].searchIterations
    return sorted.filter(p => p.searchIterations >= iterations)
  },

  // 6) Choose the players with the closest rating.
  (player, potentials, neededPlayers) => {
    // Sort by rating difference (lowest difference first)
    const sorted = potentials
      .map<[potential: QueuedMatchmakingPlayer, ratingDiff: number]>(p => [
        p,
        Math.abs(p.rating - player.rating),
      ])
      .sort((a, b) => a[1] - b[1])
    // Pick a rating difference that would still give us enough players
    const ratingDiff = sorted[neededPlayers - 1][1]
    return sorted.filter(p => p[1] <= ratingDiff).map(p => p[0])
  },
]

// TODO(tec27): Handle teamSize > 1
export const DEFAULT_MATCH_CHOOSER: MatchChooser = (teamSize, player, potentialPlayers) => {
  const neededPlayers = teamSize * 2 - 1

  let filtered = potentialPlayers.filter(
    p => p.interval.low <= player.rating && player.rating <= p.interval.high,
  )
  if (filtered.length < neededPlayers) {
    // Not enough players in this player's search range
    return []
  }

  for (const filterFn of FILTERS) {
    if (filtered.length === neededPlayers) {
      break
    }

    const nextFiltered = filterFn(player, filtered, neededPlayers)
    if (nextFiltered.length < neededPlayers) {
      break
    }

    filtered = nextFiltered
  }

  if (filtered.length < neededPlayers) {
    // There weren't enough applicable players to fill both teams. Note that this really shouldn't
    // happen at this point (it would be handled by the first filter at the start of the function),
    // but having this here makes me feel safer :)
    return []
  } else {
    // 7) Randomize among remaining candidates.
    const selections = multipleRandomItems(neededPlayers, filtered)
    if (teamSize === 1) {
      return [[player], [selections[0]]]
    } else {
      return findOptimalTeams(teamSize, player, selections)
    }
  }
}

export type OnMatchFoundFunc = (
  teamA: ReadonlyArray<Readonly<MatchmakingPlayer>>,
  teamB: ReadonlyArray<Readonly<MatchmakingPlayer>>,
) => void

/**
 * A function that chooses a teammates/opponents for `player` among a pool of potential players.
 *
 * @param teamSize The number of players in each team
 * @param player the player to find a match for
 * @param potentialPlayers the possible players to choose from
 *
 * @returns A tuple of `[teamA, teamB]` with the players in each team, or an empty array if no match
 *     could be found from the given pool.
 */
type MatchChooser = (
  teamSize: number,
  player: Readonly<QueuedMatchmakingPlayer>,
  potentialPlayers: Readonly<QueuedMatchmakingPlayer>[],
) => MatchedTeams | []

@injectable()
export class Matchmaker {
  protected tree = new IntervalTree<QueuedMatchmakingPlayer>()
  protected players = OrderedMap<SbUserId, QueuedMatchmakingPlayer>()

  readonly populationCurrent = Array.from(range(0, POPULATION_NUM_BUCKETS), () => 0)
  readonly populationPeak = Array.from(range(0, POPULATION_NUM_BUCKETS), () => 0)
  readonly populationEstimate = Array.from(
    range(0, POPULATION_NUM_BUCKETS),
    // TODO(tec27): Try to calculate a more accurate alpha value
    () => new ExponentialSmoothValue(0.25, 0),
  )
  private populationInterval = 0

  /**
   * How many players will be on each team for a complete match. Note that this assumes we only
   * have modes with 2 teams total, and would need to be adjusted for more.
   */
  private teamSize = 1
  private onMatchFound: OnMatchFoundFunc = () => {
    throw new Error('onMatchFound function must be set before use!')
  }
  private matchChooser: MatchChooser = DEFAULT_MATCH_CHOOSER

  constructor(private scheduler: LazyScheduler) {
    scheduler.setDelay(MATCHMAKING_INTERVAL_MS)
    scheduler.setErrorHandler(err => {
      logger.error({ err }, 'error in scheduled matchmaking handler')
      return true
    })
    scheduler.setMethod(timeSinceLastRunMillis => {
      const intervalsSinceLast = Math.max(
        1,
        Math.floor(Math.round(timeSinceLastRunMillis) / MATCHMAKING_INTERVAL_MS),
      )

      this.populationInterval += intervalsSinceLast

      if (this.populationInterval >= POPULATION_ESTIMATE_UPDATE_INTERVAL) {
        this.updatePopulationEstimates()
      }

      let keepGoing = true
      try {
        keepGoing = this.matchPlayers()
      } catch (err) {
        logger.error({ err }, 'error while matching players')
      }

      // If populationInterval is over 0, we always continue until it hits the interval and gets
      // reset to 0. This allows us to ensure the peak population will always be 0 in every bucket
      // when we pick back up after scheduler shutdowns, so we can easily put in the missed estimate
      // updates accurately.
      return keepGoing || this.populationInterval > 0
    })
  }

  setTeamSize(teamSize: number): this {
    this.teamSize = teamSize
    return this
  }

  setOnMatchFound(onMatchFound: OnMatchFoundFunc): this {
    this.onMatchFound = onMatchFound
    return this
  }

  get queueSize(): number {
    return this.players.size
  }

  /**
   * Adds a player to the queue used to find potential matches.
   *
   * @returns `true` if the player was not already in the queue, `false` otherwise
   */
  addToQueue(player: MatchmakingPlayer): boolean {
    if (this.players.has(player.id)) {
      return false
    }

    const queuedPlayer = initializePlayer(player)
    queuedPlayer.maxInterval = this.calculateGoodMaxInterval(queuedPlayer)

    const isAdded = this.insertInTree(queuedPlayer)
    if (isAdded) {
      this.players = this.players.set(queuedPlayer.id, queuedPlayer)

      const popBucket = getPopulationBucket(queuedPlayer.rating)
      const newPop = this.populationCurrent[popBucket] + 1
      this.populationCurrent[popBucket] = newPop
      if (newPop > this.populationPeak[popBucket]) {
        this.populationPeak[popBucket] = newPop
      }

      this.scheduler.scheduleIfNeeded()
    }
    return isAdded
  }

  /**
   * Removes a player from the matchmaking queue.
   *
   * @returns the player's `MatchmakingPlayer` structure if they were queued, otherwise `undefined`
   */
  removeFromQueue(playerId: SbUserId): MatchmakingPlayer | undefined {
    if (!this.players.has(playerId)) {
      return undefined
    }
    const player = this.players.get(playerId)!
    const isRemoved = this.removeFromTree(player)
    if (isRemoved) {
      this.players = this.players.delete(playerId)
      this.onPlayerRemoved(player)
    }
    return player
  }

  // NOTE(tec27): These just make it easier to do the "right" thing as far as rounding intervals.
  // We don't want to store them pre-rounded because we're adjusting the interval after searches
  // and this would introduce a lot of potential floating point error.
  private insertInTree(player: QueuedMatchmakingPlayer): boolean {
    return this.tree.insert(
      Math.round(player.interval.low),
      Math.round(player.interval.high),
      player,
    )
  }

  private removeFromTree(player: QueuedMatchmakingPlayer): boolean {
    return this.tree.remove(
      Math.round(player.interval.low),
      Math.round(player.interval.high),
      player,
    )
  }

  /**
   * Deals with updating population estimates to remove a player. Should be called whenever players
   * are removed (whether because they canceled, because they found a match, etc.).
   */
  private onPlayerRemoved(player: QueuedMatchmakingPlayer) {
    const popBucket = getPopulationBucket(player.rating)
    this.populationCurrent[popBucket] -= 1
    // This can never produce a new peak, so no need to update that
  }

  private updatePopulationEstimates(): void {
    if (
      this.populationInterval >=
      MAX_MISSED_POPULATION_UPDATES * POPULATION_ESTIMATE_UPDATE_INTERVAL
    ) {
      // Just reset all the estimates to 0
      for (let i = 0; i < this.populationEstimate.length; i++) {
        this.populationEstimate[i].reset(0)
      }

      return
    }

    do {
      const multipleIntervals = this.populationInterval >= POPULATION_ESTIMATE_UPDATE_INTERVAL * 2
      for (let i = 0; i < this.populationCurrent.length; i++) {
        // NOTE(tec27): If we're updating for skipped intervals, the population for those skipped
        // intervals was 0 (or the scheduler would have been running). This ensures that the player
        // that just joined doesn't erroneously increase the population estimate for the previous
        // empty times
        this.populationEstimate[i].add(multipleIntervals ? 0 : this.populationPeak[i])
      }
      this.populationInterval -= POPULATION_ESTIMATE_UPDATE_INTERVAL
    } while (this.populationInterval >= POPULATION_ESTIMATE_UPDATE_INTERVAL)

    for (let i = 0; i < this.populationCurrent.length; i++) {
      this.populationPeak[i] = this.populationCurrent[i]
    }
  }

  /**
   * Finds the best match for each player and removes them from a queue. If a match is not found,
   * the player stays in the queue, with their interval bounds increased as needed.
   *
   * @returns `true` if there are still players in the queue, `false` otherwise
   */
  private matchPlayers(): boolean {
    let matchedPlayers = new Set<MatchmakingPlayer>()

    for (const player of this.players.values()) {
      if (matchedPlayers.has(player)) {
        // We already matched this player with someone else; skip them
        continue
      }

      // Before searching, remove the player searching from the tree so they're not included in
      // results
      this.removeFromTree(player)
      player.searchIterations += 1

      if (player.searchIterations > IDEAL_MATCH_ITERATIONS) {
        const atMaxBounds =
          player.interval.low <= player.maxInterval.low &&
          player.interval.high >= player.maxInterval.high
        if (!atMaxBounds) {
          player.interval.low = Math.max(
            player.interval.low - SEARCH_BOUND_INCREASE,
            player.maxInterval.low,
          )
          player.interval.high = Math.min(
            player.interval.high + SEARCH_BOUND_INCREASE,
            player.maxInterval.high,
          )
        } else {
          if (player.searchIterations % POPULATION_ESTIMATE_UPDATE_INTERVAL === 0) {
            // If the player is at their max bounds, every so often we'll recalculate what
            // good bounds are for them, to ensure we're using the latest population estimates to
            // find them a good match. This should mean that if 2 people are in the queue, they
            // will always (eventually) find each other
            player.maxInterval = this.calculateGoodMaxInterval(player)
          }
        }
      }

      const results = this.tree.search(
        Math.round(player.interval.low),
        Math.round(player.interval.high),
      )

      let teamA, teamB: Array<Readonly<QueuedMatchmakingPlayer>> | undefined
      if (results.length > 0) {
        ;[teamA, teamB] = this.matchChooser(this.teamSize, player, results)
      }

      if (teamA && teamB) {
        // Remove the matched players from the queue we use for iteration
        this.players = this.players.delete(player.id)
        this.onPlayerRemoved(player)

        for (const players of [teamA, teamB]) {
          for (const p of players) {
            if (p !== player) {
              this.removeFromTree(p)
              this.players = this.players.delete(p.id)

              // Since our iteration method returns the whole queue at once, the opponent will still
              // be iterated over, even though we removed them from the queue; To stop that from
              // happening, mark the opponent as 'matched' so it can be skipped later on in the
              // iteration
              matchedPlayers = matchedPlayers.add(p)

              this.onPlayerRemoved(p)
            }
          }
        }

        this.onMatchFound(teamA, teamB)
      } else {
        // No matches for this player. Increase their search interval and re-add them to the tree

        this.insertInTree(player)
        this.players = this.players.set(player.id, player)
      }
    }

    // NOTE(tec27): We run even if there's only one player in the queue because we need to update
    // the population estimates
    return this.players.size > 0
  }

  /**
   * Calculates a max interval that is estimated to have at least N players in it, so that this
   * player will (hopefully) actually find a match, even in times of low population. If the current
   * max interval already contains enough estimated players, it will be returned directly.
   */
  private calculateGoodMaxInterval(player: QueuedMatchmakingPlayer): MatchmakingInterval {
    const curMaxInterval = player.maxInterval
    // NOTE(tec27): These differ from getPopulationBucket slightly, since we want to round
    // differently to better estimate population (if you have 75% of a bucket in your range it
    // should probably have it's population estimate included, but not 25% of a bucket)
    let lowBucket = Math.min(
      Math.round(curMaxInterval.low / POPULATION_BUCKET_RATING),
      POPULATION_NUM_BUCKETS - 1,
    )
    // NOTE(tec27): This bucket is non-inclusive, as it makes the range calculations easier to do
    // correctly later
    let highBucket = Math.min(
      Math.ceil(curMaxInterval.high / POPULATION_BUCKET_RATING),
      POPULATION_NUM_BUCKETS,
    )

    let estimatedPlayers = 0
    for (let i = lowBucket; i < highBucket; i++) {
      estimatedPlayers += this.populationEstimate[i].value
    }

    const neededPlayers = this.teamSize * 2

    if (estimatedPlayers >= neededPlayers) {
      return curMaxInterval
    }

    while (
      estimatedPlayers < neededPlayers &&
      (lowBucket > 0 || highBucket < this.populationEstimate.length)
    ) {
      if (lowBucket > 0) {
        lowBucket -= 1
        estimatedPlayers += this.populationEstimate[lowBucket].value
      }
      if (highBucket < this.populationEstimate.length) {
        highBucket += 1
        estimatedPlayers += this.populationEstimate[highBucket - 1].value
      }
    }

    const result = {
      low: lowBucket * POPULATION_BUCKET_RATING,
      // NOTE(tec27): Since this value is exclusive, this correctly gets assigned the rating of the
      // next bucket up (thereby including all of the ratings of the top bucket in our range)
      high: highBucket * POPULATION_BUCKET_RATING,
    }

    if (result.low <= 0 || result.high >= POPULATION_TRACKING_MAX_RATING) {
      return result
    } else {
      // Attempt to rebalance the range so it places the player's rating at the center
      const lowDistance = player.rating - result.low
      const highDistance = result.high - player.rating
      if (highDistance > lowDistance) {
        result.low = Math.max(0, result.low - (highDistance - lowDistance))
      } else {
        result.high = result.high + (lowDistance - highDistance)
      }

      return result
    }
  }
}
