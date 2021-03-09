import { OrderedMap } from 'immutable'
import IntervalTree from 'node-interval-tree'
import logger from '../logging/logger'
import { MatchmakingPlayer } from './matchmaking-player'

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
   * Adds a player to the tree and to the queue that's ordered by the start of search time.
   *
   * @returns true if the player was not already in the queue, false otherwise
   */
  addToQueue(player: MatchmakingPlayer) {
    if (this.players.has(player.name)) {
      return false
    }
    const isAdded = this.tree.insert(player.interval.low, player.interval.high, player)
    if (isAdded) {
      this.players = this.players.set(player.name, player)
    }
    return isAdded
  }

  // Removes a player from the tree and from the queue
  removeFromQueue(playerName: string) {
    if (!this.players.has(playerName)) {
      return false
    }
    const player = this.players.get(playerName)!
    const isRemoved = this.tree.remove(player.interval.low, player.interval.high, player)
    if (isRemoved) {
      this.players = this.players.delete(player.name)
    }
    return isRemoved
  }

  // Finds the best match for each player and removes them from a queue. If a match is not found,
  // the player stays in the queue, with their interval increased
  matchPlayers() {
    let matchedPlayers = new Set<MatchmakingPlayer>()

    for (const player of this.players.values()) {
      if (matchedPlayers.has(player)) {
        // We already matched this player with someone else; skip them
        continue
      }

      // Before searching, remove the player searching from the tree so they're not included in
      // results
      this.tree.remove(player.interval.low, player.interval.high, player)
      const results = this.tree.search(player.interval.low, player.interval.high)

      let opponent: Readonly<MatchmakingPlayer> | undefined
      if (results.length > 0) {
        opponent = this.opponentChooser(player, results)
      }

      if (opponent) {
        // Remove the matched player from the tree
        this.tree.remove(opponent.interval.low, opponent.interval.high, opponent)

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
        // TODO(2Pac): Replace this with the logic of our ranking system
        const newLow = player.interval.low - 10 > 0 ? player.interval.low - 10 : 0
        const newHigh = player.interval.high + 10
        player.interval = {
          low: newLow,
          high: newHigh,
        }

        this.tree.insert(player.interval.low, player.interval.high, player)
        this.players = this.players.set(player.name, player)
      }
    }
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
    if (!this.timer && this.tree.count >= 2) {
      this.timer = setInterval(() => {
        try {
          this.matchPlayers()
        } catch (err) {
          logger.error({ err }, 'error while matching players')
        }
      }, this.searchIntervalMs)
    }

    return result
  }

  removeFromQueue(playerName: string): boolean {
    const result = super.removeFromQueue(playerName)
    if (this.timer && this.tree.count < 2) {
      clearInterval(this.timer)
      this.timer = null
    }

    return result
  }
}
