import { OrderedMap, Set } from 'immutable'
import IntervalTree from 'node-interval-tree'
import { Interval } from './matchmaking-records'

export default class Matchmaker {
  constructor(type, onMatchFound) {
    this.type = type
    this.onMatchFound = onMatchFound
    this.tree = new IntervalTree()
    this.players = new OrderedMap()
    this.matchedPlayers = new Set()
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

  _findClosestElementInArray(rating, overlappingPlayers) {
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

  // Finds the best match for each player and removes them from a queue. If a match is not found,
  // the player stays in the queue, with their interval increased
  matchPlayers() {
    if (this.tree.count < 2) {
      // There are less than two players currently searching :(
      return
    }

    for (let player of this.players.values()) {
      if (this.matchedPlayers.has(player)) {
        // We already matched this player with someone else; skip them
        this.matchedPlayers = this.matchedPlayers.delete(player)
        continue
      }

      // Before searching, remove the player searching from the tree so they're not included in
      // results
      this.tree.remove(player.interval.low, player.interval.high, player)
      const results = this.tree.search(player.interval.low, player.interval.high)

      if (!results || results.length === 0) {
        // No matches for this player; increase their search interval and re-add them to the tree
        // and to the queue

        // TODO(2Pac): Replace this with the logic of our ranking system
        const newLow = player.interval.low - 10 > 0 ? player.interval.low - 10 : 0
        const newHigh = player.interval.high + 10
        const newInterval = new Interval({ low: newLow, high: newHigh })
        player = player.set('interval', newInterval)

        this.tree.insert(player.interval.low, player.interval.high, player)
        this.players = this.players.set(player.name, player)
      } else {
        // The best match should be evaluated by taking into consideration various variables, eg.
        // the rating difference, time spent queueing, region, etc.
        // For now, we're iterating over the players in order they joined the queue, plus finding
        // the player with lowest rating difference; in future we should also take player's region
        // into consideration and anything else that might be relevant

        // TODO(2Pac): Check player's region and prefer the ones that are closer to each other
        const opponentRating = this._findClosestElementInArray(player.rating, results)
        const opponents = results.filter(player => opponentRating === player.rating)

        let opponent = null
        if (opponents.length === 1) {
          // Found the closest player to the searching player's rating
          opponent = opponents[0]
        } else if (opponents.length > 1) {
          // There are multiple players with the same rating closest to the searching player's
          // rating. Randomly choose one
          opponent = opponents[Math.floor(Math.random() * opponents.length)]
        }

        // Remove the matched player from the tree
        this.tree.remove(opponent.interval.low, opponent.interval.high, opponent)

        // Remove the matched players from the queue we use for iteration
        this.players = this.players.delete(player.name)
        this.players = this.players.delete(opponent.name)

        // Since our iteration method returns the whole queue at once, the opponent will still be
        // iterated over, even though we removed them from the queue; To stop that from happening,
        // mark the opponent as 'matched' so it can be skipped later on in the iteration
        this.matchedPlayers = this.matchedPlayers.add(opponent)

        if (this.onMatchFound) {
          this.onMatchFound(player, opponent)
        }
      }
    }
  }
}
