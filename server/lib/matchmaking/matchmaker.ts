import { OrderedMap } from 'immutable'
import IntervalTree from 'node-interval-tree'
import { injectable } from 'tsyringe'
import { range } from '../../../common/range'
import { ExponentialSmoothValue } from '../../../common/statistics/exponential-smoothing'
import logger from '../logging/logger'
import { LazyScheduler } from './lazy-scheduler'
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

function findClosestRating(rating: number, overlappingPlayers: MatchmakingPlayer[]) {
  let current = overlappingPlayers[0].rating
  let diff = Math.abs(rating - current)

  for (let i = 0; i < overlappingPlayers.length; i++) {
    const newDiff = Math.abs(rating - overlappingPlayers[i].rating)
    if (newDiff < diff) {
      diff = newDiff
      current = overlappingPlayers[i].rating
    }
  }

  return current
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

export const DEFAULT_OPPONENT_CHOOSER = (
  player: QueuedMatchmakingPlayer,
  opponents: QueuedMatchmakingPlayer[],
) => {
  let filtered = opponents.filter(
    o => o.interval.low <= player.rating && player.rating <= o.interval.high,
  )

  if (!filtered.length) {
    return undefined
  } else if (filtered.length === 1) {
    return filtered[0]
  }

  // 1) If you are a new player (<25 games), choose the opponent that also is a new player, else:
  // 2) If you are not a new player, choose the opponent that also is not a new player, else:
  const isNew = isNewPlayer(player)
  const sameNewness = filtered.filter(o => isNewPlayer(o) === isNew)
  if (sameNewness.length) {
    filtered = sameNewness
  }

  if (!filtered.length) {
    return undefined
  } else if (filtered.length === 1) {
    return filtered[0]
  }

  // TODO(tec27): 3) If applicable, choose the opponent in “Inactive” status.
  // TODO(tec27): 4) Choose the opponent with the lowest ping (in 50ms buckets).

  // 5) Choose the opponent that has been waiting in queue the longest.
  filtered.sort((a, b) => b.searchIterations - a.searchIterations)
  const mostSearchIterations = filtered[0].searchIterations
  filtered = filtered.filter(o => o.searchIterations === mostSearchIterations)

  if (!filtered.length) {
    return undefined
  } else if (filtered.length === 1) {
    return filtered[0]
  }

  // 6) Choose the opponent with the closest rating.
  const opponentRating = findClosestRating(player.rating, filtered)
  const ratingDiff = Math.abs(opponentRating - player.rating)
  filtered = filtered.filter(o => Math.abs(o.rating - player.rating) === ratingDiff)

  if (!filtered.length) {
    return undefined
  } else {
    // 7) Randomize among remaining candidates.
    return filtered[Math.floor(Math.random() * filtered.length)]
  }
}

export type OnMatchFoundFunc = (
  player: Readonly<MatchmakingPlayer>,
  opponent: Readonly<MatchmakingPlayer>,
) => void

/**
 * A MatchmakingPlayer that has had its matchmaking data filled out by the Matchmaker.
 */
export interface QueuedMatchmakingPlayer extends MatchmakingPlayer {
  startingInterval: MatchmakingInterval
  maxInterval: MatchmakingInterval
}

/**
 * A function that chooses an opponent for `player` among a pool of potential opponents.
 *
 * @param player the player to find an opponent for
 * @param opponents the possible opponents to choose from
 */
type OpponentChooser = (
  player: Readonly<QueuedMatchmakingPlayer>,
  opponents: Readonly<QueuedMatchmakingPlayer>[],
) => Readonly<QueuedMatchmakingPlayer> | undefined

@injectable()
export class Matchmaker {
  protected tree = new IntervalTree<QueuedMatchmakingPlayer>()
  protected players = OrderedMap<string, QueuedMatchmakingPlayer>()

  readonly populationCurrent = Array.from(range(0, POPULATION_NUM_BUCKETS), () => 0)
  readonly populationPeak = Array.from(range(0, POPULATION_NUM_BUCKETS), () => 0)
  readonly populationEstimate = Array.from(
    range(0, POPULATION_NUM_BUCKETS),
    // TODO(tec27): Try to calculate a more accurate alpha value
    () => new ExponentialSmoothValue(0.25, 0),
  )
  private populationInterval = 0

  private onMatchFound: OnMatchFoundFunc = () => {
    throw new Error('onMatchFound function must be set before use!')
  }
  private opponentChooser: OpponentChooser = DEFAULT_OPPONENT_CHOOSER

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
    if (this.players.has(player.name)) {
      return false
    }

    const queuedPlayer = initializePlayer(player)
    queuedPlayer.maxInterval = this.calculateGoodMaxInterval(queuedPlayer)

    const isAdded = this.insertInTree(queuedPlayer)
    if (isAdded) {
      this.players = this.players.set(queuedPlayer.name, queuedPlayer)

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
  removeFromQueue(playerName: string): MatchmakingPlayer | undefined {
    if (!this.players.has(playerName)) {
      return undefined
    }
    const player = this.players.get(playerName)!
    const isRemoved = this.removeFromTree(player)
    if (isRemoved) {
      this.players = this.players.delete(player.name)
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

      let opponent: Readonly<QueuedMatchmakingPlayer> | undefined
      if (results.length > 0) {
        opponent = this.opponentChooser(player, results)
      }

      if (opponent) {
        this.removeFromTree(opponent)

        // Remove the matched players from the queue we use for iteration
        this.players = this.players.delete(player.name)
        this.players = this.players.delete(opponent.name)

        // Since our iteration method returns the whole queue at once, the opponent will still be
        // iterated over, even though we removed them from the queue; To stop that from happening,
        // mark the opponent as 'matched' so it can be skipped later on in the iteration
        matchedPlayers = matchedPlayers.add(opponent)

        this.onPlayerRemoved(player)
        this.onPlayerRemoved(opponent)

        this.onMatchFound(player, opponent)
      } else {
        // No matches for this player. Increase their search interval and re-add them to the tree

        this.insertInTree(player)
        this.players = this.players.set(player.name, player)
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

    // TODO(tec27): Use the right value for non-1v1 matchmaking
    if (estimatedPlayers >= 2) {
      return curMaxInterval
    }

    while (estimatedPlayers < 2 && (lowBucket > 0 || highBucket < this.populationEstimate.length)) {
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
      // NOTE(tec27): Since this value is exlcusive, this correctly gets assigned the rating of the
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
