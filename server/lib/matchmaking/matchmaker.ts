import { OrderedMap } from 'immutable'
import IntervalTree from 'node-interval-tree'
import logger from '../logging/logger'
import { MatchmakingPlayer } from './matchmaking-player'

/**
 * How many iterations to search for a player's "ideal match" only, i.e. a player directly within
 * rating +/- (uncertainty / 2). After this many iterations, we start to widen the search range.
 */
const IDEAL_MATCH_ITERATIONS = 8 /* Calculated to be 60 seconds with our standard timing */
const SEARCH_BOUND_INCREASE = (12 / 10) * 7.5 /* Value from the doc, adjusted for our timing */
const MAX_SEARCH_BOUND_INCREASES = 14 /* Calculated to be roughly 100 seconds of iterations */

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

// The best match should be evaluated by taking into consideration various variables, eg.
// the rating difference, time spent queueing, region, etc.
// For now, we're iterating over the players in order they joined the queue, plus finding
// the player with lowest rating difference; in future we should also take player's region
// into consideration and anything else that might be relevant
const DEFAULT_OPPONENT_CHOOSER = (player: MatchmakingPlayer, opponents: MatchmakingPlayer[]) => {
  // TODO(2Pac): Check player's region and prefer the ones that are closer to each other
  const opponentRating = findClosestRating(player.rating, opponents)
  const matches = opponents.filter(player => opponentRating === player.rating)

  if (matches.length === 1) {
    // Found the closest player to the searching player's rating
    return matches[0]
  } else {
    // There are multiple players with the same rating closest to the searching player's
    // rating. Randomly choose one
    return matches[Math.floor(Math.random() * matches.length)]
  }
}

type OnMatchFoundFunc = (
  player: Readonly<MatchmakingPlayer>,
  opponent: Readonly<MatchmakingPlayer>,
) => void
type OpponentChooser = (
  player: Readonly<MatchmakingPlayer>,
  opponents: Readonly<MatchmakingPlayer>[],
) => Readonly<MatchmakingPlayer> | undefined

export class Matchmaker {
  protected tree = new IntervalTree<MatchmakingPlayer>()
  protected players = OrderedMap<string, MatchmakingPlayer>()

  /**
   * Constructs a new Matchmaker.
   *
   * @param onMatchFound Called when a match has been found
   * @param opponentChooser A function called to narrow potential matches down to a single one.
   *     Optional, if not provided, the default implementation finds the player with the nearest
   *     rating.
   */
  constructor(
    private onMatchFound: OnMatchFoundFunc,
    private opponentChooser: OpponentChooser = DEFAULT_OPPONENT_CHOOSER,
  ) {}

  /**
   * Adds a player to the queue used to find potential matches.
   *
   * @returns `true` if the player was not already in the queue, `false` otherwise
   */
  addToQueue(player: MatchmakingPlayer) {
    if (this.players.has(player.name)) {
      return false
    }
    const isAdded = this.insertInTree(player)
    if (isAdded) {
      this.players = this.players.set(player.name, player)
    }
    return isAdded
  }

  /** Removes a player from the matchmaking queue. */
  removeFromQueue(playerName: string) {
    if (!this.players.has(playerName)) {
      return false
    }
    const player = this.players.get(playerName)!
    const isRemoved = this.removeFromTree(player)
    if (isRemoved) {
      this.players = this.players.delete(player.name)
    }
    return isRemoved
  }

  /**
   * Finds the best match for each player and removes them from a queue. If a match is not found,
   * the player stays in the queue, with their interval bounds increased as needed.
   *
   * @returns `true` if there are enough players to potentially find more matches in the future,
   *     `false` if no matches could ever be found (e.g. if there is only 1 player left in queue)
   */
  matchPlayers(): boolean {
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
      if (
        player.searchIterations > IDEAL_MATCH_ITERATIONS &&
        player.searchIterations <= IDEAL_MATCH_ITERATIONS + MAX_SEARCH_BOUND_INCREASES
      ) {
        // Player has been in the queue long enough to have their search bound increased (but not
        // so long that they're at the max bounds)
        player.interval.low = Math.max(player.interval.low - SEARCH_BOUND_INCREASE, 0)
        player.interval.high += SEARCH_BOUND_INCREASE
      }

      const results = this.tree.search(
        Math.round(player.interval.low),
        Math.round(player.interval.high),
      )

      let opponent: Readonly<MatchmakingPlayer> | undefined
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

        this.onMatchFound(player, opponent)
      } else {
        // No matches for this player. Increase their search interval and re-add them to the tree

        this.insertInTree(player)
        this.players = this.players.set(player.name, player)
      }
    }

    return this.players.size > 1
  }

  // NOTE(tec27): These just make it easier to do the "right" thing as far as rounding intervals.
  // We don't want to store them pre-rounded because we're adjusting the interval after searches
  // and this would introduce a lot of potential floating point error.
  private insertInTree(player: MatchmakingPlayer): boolean {
    return this.tree.insert(
      Math.round(player.interval.low),
      Math.round(player.interval.high),
      player,
    )
  }

  private removeFromTree(player: MatchmakingPlayer): boolean {
    return this.tree.remove(
      Math.round(player.interval.low),
      Math.round(player.interval.high),
      player,
    )
  }
}

/** A `Matchmaker` that looks for matches at a set time interval. */
export class TimedMatchmaker extends Matchmaker {
  private timer: ReturnType<typeof setInterval> | null = null

  constructor(
    private searchIntervalMs: number,
    onMatchFound: OnMatchFoundFunc,
    opponentChooser?: OpponentChooser,
  ) {
    super(onMatchFound, opponentChooser)
  }

  addToQueue(player: MatchmakingPlayer): boolean {
    const result = super.addToQueue(player)
    if (!this.timer) {
      this.timer = setInterval(() => {
        try {
          const hasMoreMatches = this.matchPlayers()
          if (!hasMoreMatches) {
            this.clearTimer()
          }
        } catch (err) {
          logger.error({ err }, 'error while matching players')
        }
      }, this.searchIntervalMs)
    }

    return result
  }

  private clearTimer() {
    if (this.timer) {
      clearInterval(this.timer)
      this.timer = null
    }
  }
}
