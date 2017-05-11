import { OrderedMap, Record, Set } from 'immutable'
import IntervalTree from 'node-interval-tree'

export const Interval = new Record({
  low: 0,
  high: 0,
})

function findClosestRating(rating, overlappingPlayers) {
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
const DEFAULT_OPPONENT_CHOOSER = (player, opponents) => {
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

export class Matchmaker {
  // onMatchFound is a `function(player, opponent)` called when a match is found
  // opponentChooser is a `function(player, opponents) => opponent` called when potential matches
  // are found to select the best opponent. Defaults to picking an opponent with the closest rating.
  constructor(onMatchFound, opponentChooser = DEFAULT_OPPONENT_CHOOSER) {
    this.onMatchFound = onMatchFound
    this.opponentChooser = opponentChooser
    this.tree = new IntervalTree()
    this.players = new OrderedMap()
  }

  // Adds a player to the tree and to the queue that's ordered by the start of search time
  addToQueue(player) {
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
  removeFromQueue(playerName) {
    if (!this.players.has(playerName)) {
      return false
    }
    const player = this.players.get(playerName)
    const isRemoved = this.tree.remove(player.interval.low, player.interval.high, player)
    if (isRemoved) {
      this.players = this.players.delete(player.name)
    }
    return isRemoved
  }

  // Finds the best match for each player and removes them from a queue. If a match is not found,
  // the player stays in the queue, with their interval increased
  matchPlayers() {
    let matchedPlayers = new Set()

    for (let player of this.players.values()) {
      if (matchedPlayers.has(player)) {
        // We already matched this player with someone else; skip them
        continue
      }

      // Before searching, remove the player searching from the tree so they're not included in
      // results
      this.tree.remove(player.interval.low, player.interval.high, player)
      const results = this.tree.search(player.interval.low, player.interval.high)

      if (!results || results.length === 0) {
        // No matches for this player; increase their search interval and re-add them to the tree

        // TODO(2Pac): Replace this with the logic of our ranking system
        const newLow = player.interval.low - 10 > 0 ? player.interval.low - 10 : 0
        const newHigh = player.interval.high + 10
        const newInterval = new Interval({ low: newLow, high: newHigh })
        player = player.set('interval', newInterval)

        this.tree.insert(player.interval.low, player.interval.high, player)
        this.players = this.players.set(player.name, player)
      } else {
        const opponent = this.opponentChooser(player, results)

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
      }
    }
  }
}

// A Matchmaker that looks for matches at a set time interval.
export class TimedMatchmaker extends Matchmaker {
  constructor(searchIntervalMs, onMatchFound, opponentChooser = undefined) {
    super(onMatchFound, opponentChooser)
    this.searchIntervalMs = searchIntervalMs
    this.timer = null
    this.doMatchPlayers = ::this.matchPlayers
  }

  addToQueue(player) {
    super.addToQueue(player)
    if (!this.timer && this.tree.count >= 2) {
      this.timer = setInterval(this.doMatchPlayers, this.searchIntervalMs)
    }
  }

  removeFromQueue(playerName) {
    super.removeFromQueue(playerName)
    if (this.timer && this.tree.count < 2) {
      clearInterval(this.timer)
      this.timer = null
    }
  }
}
