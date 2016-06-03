import { Map, OrderedMap, Record, Set } from 'immutable'
import errors from 'http-errors'
import IntervalTree from 'node-interval-tree'
import { Mount, Api, registerApiRoutes } from '../websockets/api-decorators'
import validateBody from '../websockets/validate-body'

const MATCHMAKING_TYPES = [
  '1v1ladder'
]
const MATCHMAKING_INTERVAL = 10000

const Interval = new Record({
  low: 0,
  high: 0,
})

const Player = new Record({
  name: null,
  rating: 0,
  interval: new Interval()
})

const MatchSettings = new Record({
  type: null
})

// TODO(2Pac): Move this to its own folder/file?
class Matchmaker {
  constructor(nydus, type) {
    this.nydus = nydus
    this.type = type
    this.tree = new IntervalTree()
    this.players = new OrderedMap()
    this.matchedPlayers = new Set()
    this.intervalId = null

    this.start()
  }

  _isRunning() {
    return !!this.intervalId
  }

  // Starts the matchmaker service, and runs the matchPlayers function every 10 seconds
  start() {
    if (!this._isRunning()) {
      this.intervalId = setInterval(() => this.matchPlayers(), MATCHMAKING_INTERVAL)
    }
  }

  // Stops the matchmaker service, for whatever reason
  stop() {
    if (this._isRunning()) {
      clearInterval(this.iIntervalId)
    }
  }

  // Adds a player to the tree and to the queue that's ordered by the start of search time
  addToTree(player) {
    if (this._isRunning()) {
      if (this.players.has(player.name)) {
        return false
      }
      this.tree.insert(player.interval.low, player.interval.high, player)
      this.players = this.players.set(player.name, player)
      return true
    }
    return false
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
  // the player stays in the queue, with his interval increased
  matchPlayers() {
    if (this.tree.count < 2) {
      // There are less than two players currently searching :(
      return
    }

    for (let player of this.players.values()) {
      if (this.matchedPlayers.has(player)) {
        // We already matched this player with someone else; skip him
        this.matchedPlayers = this.matchedPlayers.delete(player)
        continue
      }

      // Before searching, remove the player searching from the tree so he's not included in results
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
        // iterated over, even though we removed him from the queue; To stop that from happening,
        // mark the opponent as 'matched' so it can be skipped later on in the iteration
        this.matchedPlayers = this.matchedPlayers.add(opponent)

        // Notify both players that the match is found and who is their opponent
        this.nydus.publish('/matchmaking/' + player.name, {
          type: 'matchFound',
          opponent,
          matchmakingType: this.type
        })
        this.nydus.publish('/matchmaking/' + opponent.name, {
          type: 'matchFound',
          opponent: player,
          matchmakingType: this.type
        })
      }
    }
  }
}

const validateType = type => MATCHMAKING_TYPES.includes(type)

const MOUNT_BASE = '/matchmaking'

@Mount(MOUNT_BASE)
export class MatchmakingApi {
  constructor(nydus, userSockets) {
    this.nydus = nydus
    this.userSockets = userSockets
    this.matchmakers = new Map()

    // Construct a new matchmaker for each matchmaking type we have
    MATCHMAKING_TYPES.forEach(type => {
      this.matchmakers = this.matchmakers.set(type, new Matchmaker(this.nydus, type))
    })
  }

  @Api('/find',
    validateBody({
      type: validateType,
    }),
    'getUser')
  async find(data, next) {
    const { type } = data.get('body')
    const user = data.get('user')

    // TODO(2Pac): Get rating from the database and calculate the search interval for that player.
    // Until we devise a ranking system, make the search interval same for all players
    const rating = 1000
    const interval = new Interval({
      low: rating - 50,
      high: rating + 50
    })

    const player = new Player({
      name: user.name,
      rating,
      interval
    })

    const matchSettings = new MatchSettings({
      type
    })

    const isAdded = this.matchmakers.get(matchSettings.type).addToTree(player)
    if (!isAdded) {
      throw new errors.Conflict('already searching for the game')
    }

    user.subscribe(MatchmakingApi._getPath(user), undefined, user => {
      user.unsubscribe(MatchmakingApi._getPath(user))
    })
  }

  @Api('/cancel')
  async cancel(data, next) {
    throw new errors.NotImplemented()
  }

  async getUser(data, next) {
    const user = this.userSockets.getBySocket(data.get('client'))
    if (!user) throw new errors.Unauthorized('authorization required')
    const newData = data.set('user', user)

    return await next(newData)
  }

  static _getPath(user) {
    return `${MOUNT_BASE}/${encodeURIComponent(user.name)}`
  }
}

export default function registerApi(nydus, userSockets) {
  const api = new MatchmakingApi(nydus, userSockets)
  registerApiRoutes(api, nydus)
  return api
}
