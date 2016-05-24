import { Map, Record, Set } from 'immutable'
import errors from 'http-errors'
import IntervalTree from 'node-interval-tree'
import { Mount, Api, registerApiRoutes } from '../websockets/api-decorators'
import validateBody from '../websockets/validate-body'

const MATCHMAKING_TYPES = [
  '1v1ladder'
]
const MATCHMAKING_INTERVAL = 20000

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
    this.intervalId = null
    this.unmatchedPlayers = new Map()
    this.matchedPlayers = new Set()
    this.isMatchPlayersRunning = false

    this.start()
  }

  _isRunning() {
    return !!this.intervalId
  }

  // Starts the matchmaker service, and runs the matchPlayers function every 20 seconds
  start() {
    if (this._isRunning()) {
      throw new Error('This matchmaking service is already running')
    } else {
      this.intervalId = setInterval(() => this.matchPlayers(), MATCHMAKING_INTERVAL)
    }
  }

  // Stops the matchmaker service, for whatever reason
  stop() {
    if (this._isRunning()) {
      clearInterval(this.iIntervalId)
    } else {
      throw new Error('This matchmaking service is already stopped')
    }
  }

  // Adds a player to the tree
  // TODO(2Pac): Figure out what happens if a player is added while matchPlayers is running
  addToTree(player) {
    if (this._isRunning()) {
      this.tree.insert(player.interval.low, player.interval.high, player)
    } else {
      throw new Error('This matchmaking service is stopped')
    }
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

  // Finds the best match for each player and removes them from a tree. If a match is not found, the
  // player stays in the tree, with his interval increased
  matchPlayers() {
    if (this.isMatchPlayersRunning) {
      return
    }
    this.isMatchPlayersRunning = true

    if (this.tree.count < 2) {
      // There are less than two players currently searching :(
      this.isMatchPlayersRunning = false
      return
    }

    for (const player of this.tree.inOrder(this.tree.root)) {
      if (this.matchedPlayers.has(player)) {
        // We already matched this player with someone else; skip him
        this.matchedPlayers = this.matchedPlayers.delete(player)
        continue
      }

      // Before searching, remove the player searching from the tree so he's not included in results
      this.tree.remove(player.interval.low, player.interval.high, player)
      const results = this.tree.search(player.interval.low, player.interval.high)

      if (!results || results.length === 0) {
        // No matches for this player; Add him to the unmatched players map so he can be re-added
        // after the for loop
        this.unmatchedPlayers = this.unmatchedPlayers.set(player.name, player)
      } else {
        // The best match would be the one with the closest rating to the searching player, while
        // taking into consideration other variables, eg. their search interval, uncertainty
        // variable about their rating (TrueSkill?), region etc. We could also introduce some kind
        // of randomness to make sure that two players don't end up playing each other repeatedly,
        // although this shouldn't be a problem, since their ratings and search interval will change
        // after each game

        // TODO(2Pac): Do a more sophisticated algorithm to find the best match
        const opponentRating = this._findClosestElementInArray(player.rating, results)
        const opponents = []
        for (let i = 0; i < results.length; i++) {
          if (opponentRating === results[i].rating) {
            opponents.push(results[i])
          }
        }

        let opponent = null
        if (opponents.length === 1) {
          // Found the closest player to the searching player's rating
          opponent = opponents[0]
        } else if (opponents.length > 1) {
          // There are multiple players with the same rating closest to the searching player's
          // rating. Randomly choose one
          opponent = opponents[Math.floor(Math.random() * opponents.length)]
        }

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

        // Remove the matched player from the tree
        this.tree.remove(opponent.interval.low, opponent.interval.high, opponent)
        this.matchedPlayers = this.matchedPlayers.add(opponent)

        if (this.unmatchedPlayers.has(player.name)) {
          this.unmatchedPlayers = this.unmatchedPlayers.delete(player.name)
        }
      }
    }

    // Iterate through all of the unmatched players, increase their search interval and re-add them
    // to the tree
    this.unmatchedPlayers.forEach(p => {
      // TODO(2Pac): Replace this with the logic of our ranking system
      const newLow = p.interval.low - 10 > 0 ? p.interval.low - 10 : 0
      const newHigh = p.interval.high + 10
      const newInterval = new Interval({ low: newLow, high: newHigh })
      p = p.set('interval', newInterval)

      this.tree.insert(p.interval.low, p.interval.high, p)
    })

    this.isMatchPlayersRunning = false
  }
}

const validateType = type => MATCHMAKING_TYPES.includes(type)

const MOUNT_BASE = '/matchmaking'

@Mount(MOUNT_BASE)
export class MatchmakingApi {
  constructor(nydus, userSockets) {
    this.nydus = nydus
    this.userSockets = userSockets
    this.userMatches = new Map()
    this.matchmakers = new Map()

    this._doConstructorMatchmakers()
  }

  // Works around a bug in babel with arrow functions in constructors
  _doConstructorMatchmakers() {
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

    if (this.userMatches.has(user.name)) {
      throw new errors.Conflict('already searching for the game')
    }

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

    // TODO(2Pac): Delete the match for this user when his match is found and started; or if the
    // matchmaking is canceled for any reason
    this.userMatches = this.userMatches.set(user.name, matchSettings)
    this.matchmakers.get(matchSettings.type).addToTree(player)

    user.subscribe(MatchmakingApi._getPath(user), () => {}, user => {
      if (this.userMatches.has(user.name)) {
        this.userMatches = this.userMatches.delete(user.name)
      }
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
