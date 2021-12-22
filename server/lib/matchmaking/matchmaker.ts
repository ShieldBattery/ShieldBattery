import { OrderedMap } from 'immutable'
import IntervalTree from 'node-interval-tree'
import { injectable } from 'tsyringe'
import { multipleRandomItems, randomItem } from '../../../common/random'
import { range } from '../../../common/range'
import { ExponentialSmoothValue } from '../../../common/statistics/exponential-smoothing'
import { SbUserId } from '../../../common/users/sb-user'
import logger from '../logging/logger'
import { LazyScheduler } from './lazy-scheduler'
import { QueuedMatchmakingEntity } from './matchmaker-queue'
import {
  getMatchmakingEntityId,
  getNumPlayersInEntity,
  getPlayersFromEntity,
  isMatchmakingParty,
  isNewPlayer,
  MatchmakingEntity,
  MatchmakingInterval,
} from './matchmaking-entity'

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
 * Initializes an entity (in-place) with their starting and max interval, if it is not already
 * present.
 *
 * This should only be used by the Matchmaker or in tests, you probably don't want to call this!
 */
export function initializeEntity(entity: MatchmakingEntity): QueuedMatchmakingEntity {
  if (!entity.startingInterval) {
    entity.startingInterval = {
      low: entity.interval.low,
      high: entity.interval.high,
    }
  }
  if (!entity.maxInterval) {
    entity.maxInterval = {
      low: Math.max(0, entity.interval.low - MAX_SEARCH_BOUND_INCREASES * SEARCH_BOUND_INCREASE),
      high: entity.interval.high + MAX_SEARCH_BOUND_INCREASES * SEARCH_BOUND_INCREASE,
    }
  }

  return entity as QueuedMatchmakingEntity
}

/**
 * Calculates the effective rating of a team, as if they were a single player. Attempts to weight
 * things such that more skilled players influence the resulting rating more than less skilled ones.
 */
export function calcEffectiveRating(team: ReadonlyArray<Readonly<MatchmakingEntity>>): number {
  // Calculate the root mean square of the team's ratings. Using this formula means that players
  // with higher rating effectively count for more in the output, so a [2500 + 500] team has a
  // higher effective rating than a [1500 + 1500] team.
  let sum = 0
  let playerCount = 0
  for (const entity of team) {
    for (const players of getPlayersFromEntity(entity)) {
      playerCount += 1
      sum += players.rating * players.rating
    }
  }

  // TODO(tec27): Determine what the proper exponent is for this from win/loss data
  return Math.pow(sum / playerCount, 1 / 2)
}

function getRatingFromEntity(entity: QueuedMatchmakingEntity): number {
  return isMatchmakingParty(entity) ? calcEffectiveRating([entity]) : entity.rating
}

type MatchedTeams = [
  teamA: Array<Readonly<QueuedMatchmakingEntity>>,
  teamB: Array<Readonly<QueuedMatchmakingEntity>>,
]

function findOptimalTeams(
  teamSize: number,
  entity: Readonly<QueuedMatchmakingEntity>,
  // TODO(tec27): Make this a ReadonlyArray once we're on TS 4.6+ (prior to that, Array.at is only
  // available on non-readonly arrays)
  selections: Array<Readonly<QueuedMatchmakingEntity>>,
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

  if (isMatchmakingParty(entity) || selections.length < teamSize) {
    if (selections.some(s => !isMatchmakingParty(s))) {
      // This should never happen for 2v2, just a sanity check
      throw new Error('selections less than team size but contain a non-party')
    }

    // Teams can't differ, so just return them as is
    return [[entity], selections]
  }

  // Find all the different permutations of teams, select the one that minimizes the difference
  // between the two teams' effective ratings.
  let bestTeams: MatchedTeams
  let lowestRatingDiff = Infinity
  for (let i = 0; i < selections.length; i++) {
    const teamA = [entity, selections[i]]
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
 * A function that filters down the potential players/parties by some specific criteria, returning a
 * list of potential players/parties that meet it.
 */
type EntityFilter = (
  entity: Readonly<QueuedMatchmakingEntity>,
  potentials: ReadonlyArray<QueuedMatchmakingEntity>,
  neededPlayers: number,
) => QueuedMatchmakingEntity[]

// Filters that will be executed in order until we run under the needed number of players or all
// filters have been run. Once we reach that point, players will be selected at random from the
// remaining list, and teams will be optimized from that set.
const FILTERS: ReadonlyArray<EntityFilter> = [
  // 1) If you are a new player (<25 games), choose the player that also is a new player
  // 2) If you are not a new player, choose the player that also is not a new player
  (entity, potentials) => {
    const isNew = isNewPlayer(entity)
    return potentials.filter(p => isNewPlayer(p) === isNew)
  },
  // TODO(tec27): 3) If applicable, choose the player in “Inactive” status.
  // TODO(tec27): 4) Choose the player with the lowest ping (in 50ms buckets).

  // 5) Choose the players that have been waiting in queue the longest.
  (_, potentials, neededPlayers) => {
    const sorted = potentials.slice().sort((a, b) => b.searchIterations - a.searchIterations)
    // Pick an iteration number that would still give us enough players
    if (sorted.length < neededPlayers) {
      // TODO(tec27): Instead, account for parties in picking the index to look at)
      return sorted
    }
    const iterations = sorted[neededPlayers - 1].searchIterations
    return sorted.filter(p => p.searchIterations >= iterations)
  },

  // 6) Choose the players with the closest rating.
  (entity, potentials, neededPlayers) => {
    // Sort by rating difference (lowest difference first)
    const entityRating = getRatingFromEntity(entity)
    const sorted = potentials
      .map<[potential: typeof entity, ratingDiff: number]>(p => [
        p,
        Math.abs(getRatingFromEntity(p) - entityRating),
      ])
      .sort((a, b) => a[1] - b[1])

    if (sorted.length < neededPlayers) {
      // TODO(tec27): Instead, account for parties in picking the index to look at)
      return sorted.map(p => p[0])
    }
    // Pick a rating difference that would still give us enough players
    const ratingDiff = sorted[neededPlayers - 1][1]
    return sorted.filter(p => p[1] <= ratingDiff).map(p => p[0])
  },
]

function getTotalPlayersInPotentials(potentials: Readonly<QueuedMatchmakingEntity>[]) {
  return potentials.reduce((total, entity) => total + getNumPlayersInEntity(entity), 0)
}

export const DEFAULT_MATCH_CHOOSER: MatchChooser = (teamSize, entity, potentials) => {
  const neededPlayers = teamSize * 2 - getNumPlayersInEntity(entity)

  const entityRating = getRatingFromEntity(entity)
  let filtered = potentials.filter(
    p => p.interval.low <= entityRating && entityRating <= p.interval.high,
  )
  if (getTotalPlayersInPotentials(filtered) < neededPlayers) {
    // Not enough players in this player's search range
    return []
  }

  for (const filterFn of FILTERS) {
    if (getTotalPlayersInPotentials(filtered) === neededPlayers) {
      break
    }

    const nextFiltered = filterFn(entity, filtered, neededPlayers)
    if (getTotalPlayersInPotentials(nextFiltered) < neededPlayers) {
      break
    }

    filtered = nextFiltered
  }

  if (getTotalPlayersInPotentials(filtered) < neededPlayers) {
    // There weren't enough applicable players to fill both teams. Note that this really shouldn't
    // happen at this point (it would be handled by the first filter at the start of the function),
    // but having this here makes me feel safer :)
    return []
  } else {
    // 7) Randomize among remaining candidates.
    if (teamSize === 1) {
      const selection = randomItem(filtered)
      return [[entity], [selection]]
    } else {
      // This is kind of annoying because we potentially have combinations in this list that do
      // not result in a valid team. So instead of just selecting enough to cover N players, we need
      // to be careful to get the right size of entities. This is already pretty terrible for 2v2,
      // for 3v3 it seems like it needs a full rethink
      const shuffled = multipleRandomItems(filtered.length, filtered)
      if (isMatchmakingParty(entity)) {
        while (shuffled.length) {
          if (isMatchmakingParty(shuffled[0])) {
            return [[entity], [shuffled[0]]]
          } else {
            for (let i = 1; i < shuffled.length; i++) {
              // Find the first other solo player and group them
              if (!isMatchmakingParty(shuffled[i])) {
                return [[entity], [shuffled[0], shuffled[i]]]
              }
            }
          }

          // Couldn't find a matching solo player, just get rid of this one and try again :(
          shuffled.shift()
        }
      } else {
        let partner: QueuedMatchmakingEntity | undefined
        for (let i = 0; i < shuffled.length; i++) {
          if (!isMatchmakingParty(shuffled[i])) {
            partner = shuffled[i]
            shuffled.splice(i, 1)
            break
          }
        }
        if (!partner) {
          // No other solo players to be our partner
          return []
        }

        while (shuffled.length) {
          if (isMatchmakingParty(shuffled[0])) {
            return [[entity, partner], [shuffled[0]]]
          } else {
            for (let i = 1; i < shuffled.length; i++) {
              // Find the first other solo player and group them
              if (!isMatchmakingParty(shuffled[i])) {
                return findOptimalTeams(teamSize, entity, [partner, shuffled[0], shuffled[i]])
              }
            }
          }

          // Couldn't find a matching solo player, just get rid of this one and try again :(
          shuffled.shift()
        }
      }

      return []
    }
  }
}

export type OnMatchFoundFunc = (
  teamA: ReadonlyArray<Readonly<MatchmakingEntity>>,
  teamB: ReadonlyArray<Readonly<MatchmakingEntity>>,
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
  entity: Readonly<QueuedMatchmakingEntity>,
  potentialPlayers: Readonly<QueuedMatchmakingEntity>[],
) => MatchedTeams | []

@injectable()
export class Matchmaker {
  protected tree = new IntervalTree<QueuedMatchmakingEntity>()
  protected entities = OrderedMap<SbUserId, QueuedMatchmakingEntity>()

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
        keepGoing = this.searchForMatches()
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
    return this.entities.size
  }

  /**
   * Adds a player/party to the queue used to find potential matches.
   *
   * @returns `true` if the player/party was not already in the queue, `false` otherwise
   */
  addToQueue(entity: MatchmakingEntity): boolean {
    const id = getMatchmakingEntityId(entity)
    if (this.entities.has(id)) {
      return false
    }

    const queuedEntity = initializeEntity(entity)
    queuedEntity.maxInterval = this.calculateGoodMaxInterval(queuedEntity)

    const isAdded = this.insertInTree(queuedEntity)
    if (isAdded) {
      this.entities = this.entities.set(id, queuedEntity)

      const popBucket = getPopulationBucket(getRatingFromEntity(queuedEntity))
      const newPop = this.populationCurrent[popBucket] + getNumPlayersInEntity(queuedEntity)
      this.populationCurrent[popBucket] = newPop
      if (newPop > this.populationPeak[popBucket]) {
        this.populationPeak[popBucket] = newPop
      }

      this.scheduler.scheduleIfNeeded()
    }
    return isAdded
  }

  /**
   * Removes a player/party from the matchmaking queue.
   *
   * @returns the associated `MatchmakingEntity` structure if they were queued, otherwise
   *    `undefined`
   */
  removeFromQueue(userId: SbUserId): MatchmakingEntity | undefined {
    if (!this.entities.has(userId)) {
      return undefined
    }
    const player = this.entities.get(userId)!
    const isRemoved = this.removeFromTree(player)
    if (isRemoved) {
      this.entities = this.entities.delete(userId)
      this.onEntityRemoved(player)
    }
    return player
  }

  // NOTE(tec27): These just make it easier to do the "right" thing as far as rounding intervals.
  // We don't want to store them pre-rounded because we're adjusting the interval after searches
  // and this would introduce a lot of potential floating point error.
  private insertInTree(entity: QueuedMatchmakingEntity): boolean {
    return this.tree.insert(
      Math.round(entity.interval.low),
      Math.round(entity.interval.high),
      entity,
    )
  }

  private removeFromTree(entity: QueuedMatchmakingEntity): boolean {
    return this.tree.remove(
      Math.round(entity.interval.low),
      Math.round(entity.interval.high),
      entity,
    )
  }

  /**
   * Deals with updating population estimates to remove a player. Should be called whenever players
   * are removed (whether because they canceled, because they found a match, etc.).
   */
  private onEntityRemoved(entity: QueuedMatchmakingEntity) {
    const popBucket = getPopulationBucket(getRatingFromEntity(entity))
    this.populationCurrent[popBucket] -= getNumPlayersInEntity(entity)
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
  private searchForMatches(): boolean {
    let matchedEntities = new Set<MatchmakingEntity>()

    for (const entity of this.entities.values()) {
      if (matchedEntities.has(entity)) {
        // We already matched this player with someone else; skip them
        continue
      }

      // Before searching, remove the player searching from the tree so they're not included in
      // results
      this.removeFromTree(entity)
      entity.searchIterations += 1

      if (entity.searchIterations > IDEAL_MATCH_ITERATIONS) {
        const atMaxBounds =
          entity.interval.low <= entity.maxInterval.low &&
          entity.interval.high >= entity.maxInterval.high
        if (!atMaxBounds) {
          entity.interval.low = Math.max(
            entity.interval.low - SEARCH_BOUND_INCREASE,
            entity.maxInterval.low,
          )
          entity.interval.high = Math.min(
            entity.interval.high + SEARCH_BOUND_INCREASE,
            entity.maxInterval.high,
          )
        } else {
          if (entity.searchIterations % POPULATION_ESTIMATE_UPDATE_INTERVAL === 0) {
            // If the player is at their max bounds, every so often we'll recalculate what
            // good bounds are for them, to ensure we're using the latest population estimates to
            // find them a good match. This should mean that if 2 people are in the queue, they
            // will always (eventually) find each other
            entity.maxInterval = this.calculateGoodMaxInterval(entity)
          }
        }
      }

      const results = this.tree.search(
        Math.round(entity.interval.low),
        Math.round(entity.interval.high),
      )

      let teamA, teamB: Array<Readonly<QueuedMatchmakingEntity>> | undefined
      if (results.length > 0) {
        ;[teamA, teamB] = this.matchChooser(this.teamSize, entity, results)
      }

      if (teamA && teamB) {
        // Remove the matched players from the queue we use for iteration
        this.entities = this.entities.delete(getMatchmakingEntityId(entity))
        this.onEntityRemoved(entity)

        for (const entities of [teamA, teamB]) {
          for (const cur of entities) {
            if (cur !== entity) {
              this.removeFromTree(cur)
              this.entities = this.entities.delete(getMatchmakingEntityId(cur))

              // Since our iteration method returns the whole queue at once, the opponent will still
              // be iterated over, even though we removed them from the queue; To stop that from
              // happening, mark the opponent as 'matched' so it can be skipped later on in the
              // iteration
              matchedEntities = matchedEntities.add(cur)

              this.onEntityRemoved(cur)
            }
          }
        }

        this.onMatchFound(teamA, teamB)
      } else {
        // No matches for this player. Increase their search interval and re-add them to the tree

        this.insertInTree(entity)
        this.entities = this.entities.set(getMatchmakingEntityId(entity), entity)
      }
    }

    // NOTE(tec27): We run even if there's only one player in the queue because we need to update
    // the population estimates
    return this.entities.size > 0
  }

  /**
   * Calculates a max interval that is estimated to have at least N players in it, so that this
   * player will (hopefully) actually find a match, even in times of low population. If the current
   * max interval already contains enough estimated players, it will be returned directly.
   */
  private calculateGoodMaxInterval(entity: QueuedMatchmakingEntity): MatchmakingInterval {
    const curMaxInterval = entity.maxInterval
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
      const rating = getRatingFromEntity(entity)
      // Attempt to rebalance the range so it places the player's rating at the center
      const lowDistance = rating - result.low
      const highDistance = result.high - rating
      if (highDistance > lowDistance) {
        result.low = Math.max(0, result.low - (highDistance - lowDistance))
      } else {
        result.high = result.high + (lowDistance - highDistance)
      }

      return result
    }
  }
}
