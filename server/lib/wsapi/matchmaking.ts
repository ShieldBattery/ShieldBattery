import errors from 'http-errors'
import { List, Map as IMap, Range, Record, Set as ISet } from 'immutable'
import { NextFunc, NydusServer } from 'nydus'
import { container, singleton } from 'tsyringe'
import CancelToken from '../../../common/async/cancel-token'
import createDeferred, { Deferred } from '../../../common/async/deferred'
import swallowNonBuiltins from '../../../common/async/swallow-non-builtins'
import { MATCHMAKING_ACCEPT_MATCH_TIME, validRace } from '../../../common/constants'
import { MATCHMAKING } from '../../../common/flags'
import { GameRoute } from '../../../common/game-config'
import { MapInfo } from '../../../common/maps'
import { isValidMatchmakingType, MatchmakingType } from '../../../common/matchmaking'
import gameLoader from '../games/game-loader'
import activityRegistry from '../games/gameplay-activity-registry'
import { createHuman, Slot } from '../lobbies/slot'
import { MatchmakingDebugDataService } from '../matchmaking/debug-data'
import MatchAcceptor, { MatchAcceptorCallbacks } from '../matchmaking/match-acceptor'
import { TimedMatchmaker } from '../matchmaking/matchmaker'
import { MatchmakingPlayer } from '../matchmaking/matchmaking-player'
import matchmakingStatusInstance from '../matchmaking/matchmaking-status-instance'
import {
  createInitialMatchmakingRating,
  getHighRankedRating,
  getMatchmakingRating,
  MatchmakingRating,
} from '../matchmaking/models'
import { getMapInfo } from '../models/maps'
import { getCurrentMapPool } from '../models/matchmaking-map-pools'
import { monotonicNow } from '../time/monotonic-now'
import { Api, Mount, registerApiRoutes } from '../websockets/api-decorators'
import {
  ClientSocketsGroup,
  ClientSocketsManager,
  UserSocketsManager,
} from '../websockets/socket-groups'
import validateBody from '../websockets/validate-body'

const createMatch = Record({
  type: MatchmakingType.Match1v1 as MatchmakingType,
  players: List<MatchmakingPlayer>(),
})

type Match = ReturnType<typeof createMatch>

const createQueueEntry = Record({
  username: '',
  type: MatchmakingType.Match1v1 as MatchmakingType,
})

type QueueEntry = ReturnType<typeof createQueueEntry>

const createTimers = Record({
  mapSelectionTimer: null as Deferred<void> | null,
  countdownTimer: null as Deferred<void> | null,
  cancelToken: new CancelToken(),
})

type Timers = ReturnType<typeof createTimers>

const getRandomInt = (max: number) => Math.floor(Math.random() * Math.floor(max))

// How often to run the matchmaker 'find match' process
const MATCHMAKING_INTERVAL = 7500
// Extra time that is added to the matchmaking accept time to account for latency in getting
// messages back and forth from clients
const ACCEPT_MATCH_LATENCY = 2000
/**
 * How long retrieved "high rank" MMRs are valid for. If the cached data is older than this, it
 * will be re-retrieved.
 */
const MAX_HIGH_RANKED_AGE_MS = 10 * 60 * 1000

const MOUNT_BASE = '/matchmaking'

/**
 * Selects a map for the given players and matchmaking type, based on the players' stored
 * matchmaking preferences and the current map pool.
 *
 * @returns an object with `{ mapsByPlayer, preferredMaps, randomMaps, chosenMap }` describing the
 *   maps that were used to make the selection, as well as the actual selection.
 */
async function pickMap(matchmakingType: MatchmakingType, players: List<MatchmakingPlayer>) {
  const currentMapPool = await getCurrentMapPool(matchmakingType)
  if (!currentMapPool) {
    throw new Error('invalid map pool')
  }

  // The algorithm for selecting maps is:
  // 1) All player selections are collected and only unique ones are kept
  // 2) If there are less than 4 maps after #1, we fill the rest of the list
  //    with random map selections from the pool that are *also* unique
  // 3) We pick 1 random map from this 4 map pool as the chosen one
  //
  // This means that we are guaranteed to have 4 unique maps to select from each
  // time, and that even if 2 particular maps are extremely popular among
  // players, they will still have to know how to play on the entire pool. It
  // also means that players that learn "rare" maps will have an advantage
  // during this selection process (there is a higher chance their map will
  // not be replaced with a random one).

  const mapPool = ISet(currentMapPool.maps)
  let preferredMapIds = ISet()
  let mapIdsByPlayer = IMap<number, ISet<string>>()

  for (const p of players) {
    const available = ISet(p.preferredMaps).intersect(mapPool)
    preferredMapIds = preferredMapIds.concat(available)
    mapIdsByPlayer = mapIdsByPlayer.set(p.id, available)
  }

  const randomMapIds: string[] = []
  Range(preferredMapIds.size, 4).forEach(() => {
    const availableMaps = mapPool.subtract(preferredMapIds.concat(randomMapIds))
    const randomMap = availableMaps.toList().get(getRandomInt(availableMaps.size))!
    randomMapIds.push(randomMap)
  })

  // TODO(tec27): remove the need for these casts by TSifying the map info stuff
  const [preferredMaps, randomMaps] = await Promise.all([
    (getMapInfo(preferredMapIds.toJS()) as any) as MapInfo[],
    (getMapInfo(randomMapIds) as any) as MapInfo[],
  ])
  if (preferredMapIds.size + randomMapIds.length !== preferredMaps.length + randomMaps.length) {
    throw new Error('no maps found')
  }

  const mapsByPlayer = mapIdsByPlayer
    .map(mapIds => mapIds.map(id => preferredMaps.find(m => m.id === id)))
    .toJS() as { [key: number]: MapInfo }

  const chosenMap = [...preferredMaps, ...randomMaps][
    getRandomInt(preferredMaps.length + randomMaps.length)
  ]

  return { mapsByPlayer, preferredMaps, randomMaps, chosenMap }
}

@singleton()
@Mount(MOUNT_BASE)
export class MatchmakingApi {
  private matchAcceptorDelegate: MatchAcceptorCallbacks<Match> = {
    onAcceptProgress: (matchInfo, total, accepted) => {
      for (const player of matchInfo.players) {
        this.publishToActiveClient(player.name, {
          type: 'playerAccepted',
          acceptedPlayers: accepted,
        })
      }
    },
    onAccepted: async (matchInfo, clients) => {
      this.queueEntries = this.queueEntries.withMutations(map => {
        for (const client of clients) {
          map.delete(client.name)
        }
      })

      let slots: List<Slot>
      const players = matchInfo.players

      // TODO(tec27): ignore alternate race selection if there are more than 2 players
      const firstPlayer = players.first<MatchmakingPlayer>()
      // NOTE(tec27): alternate race selection is not available for random users. We block this
      // from being set elsewhere, but ignore it here just in case
      const playersHaveSameRace =
        firstPlayer.race !== 'r' && players.every(p => p.race === firstPlayer.race)
      if (playersHaveSameRace && players.every(p => p.useAlternateRace === true)) {
        // All players have the same race and all of them want to use an alternate race: select
        // one of the players randomly to play their alternate race, leaving the other player to
        // play their main race.
        const randomPlayerIndex = getRandomInt(players.size)
        slots = players.map((p, i) =>
          createHuman(p.name, p.id, i === randomPlayerIndex ? p.alternateRace : p.race),
        )
      } else if (playersHaveSameRace && players.some(p => p.useAlternateRace === true)) {
        // All players have the same main race and one of them wants to use an alternate race
        slots = players.map(p =>
          createHuman(p.name, p.id, p.useAlternateRace ? p.alternateRace : p.race),
        )
      } else {
        // No alternate race selection, so everyone gets their selected race
        slots = players.map(p => createHuman(p.name, p.id, p.race))
      }

      const { mapsByPlayer, preferredMaps, randomMaps, chosenMap } = await pickMap(
        matchInfo.type,
        matchInfo.players,
      )

      const gameConfig = {
        // TODO(tec27): This will need to be adjusted for team matchmaking
        gameType: 'oneVOne',
        gameSubType: 0,
        teams: [
          slots
            .map(s => ({
              name: s.name!,
              race: s.race,
              isComputer: s.type === 'computer' || s.type === 'umsComputer',
            }))
            .toArray(),
        ],
      }

      const loadCancelToken = new CancelToken()
      const gameLoaded = gameLoader.loadGame({
        players: slots,
        mapId: chosenMap.id,
        gameSource: 'MATCHMAKING',
        gameSourceExtra: matchInfo.type,
        gameConfig,
        cancelToken: loadCancelToken,
        onGameSetup: (setup, resultCodes) =>
          this.gameLoaderDelegate.onGameSetup({
            matchInfo,
            clients,
            slots,
            setup,
            resultCodes,
            mapsByPlayer,
            preferredMaps,
            randomMaps,
            chosenMap,
            cancelToken: loadCancelToken,
          }),
        onRoutesSet: (playerName, routes, gameId) =>
          this.gameLoaderDelegate.onRoutesSet(clients, playerName, routes, gameId),
      })

      await gameLoaded
      this.gameLoaderDelegate.onGameLoaded(clients)
    },
    onDeclined: (matchInfo, requeueClients, kickClients) => {
      this.queueEntries = this.queueEntries.withMutations(map => {
        for (const client of kickClients) {
          map.delete(client.name)
          this.publishToActiveClient(client.name, {
            type: 'acceptTimeout',
          })
          this.unregisterActivity(client)
        }
      })

      for (const client of requeueClients) {
        const player = matchInfo.players.find(p => p.name === client.name)!
        this.matchmakers.get(matchInfo.type)!.addToQueue(player)
        this.publishToActiveClient(client.name, {
          type: 'requeue',
        })
      }
    },
    onError: (err, clients) => {
      for (const client of clients) {
        if (this.clientTimers.has(client.name)) {
          // TODO(tec27): this event really needs a gameId and some better info about why we're
          // canceling
          this.publishToActiveClient(client.name, {
            type: 'cancelLoading',
            // TODO(tec27): We probably shouldn't be blindly sending error messages to clients
            reason: err && err.message,
          })
          this.handleLeave(client)
        }
      }
    },
  }

  matchmakerDelegate = {
    onMatchFound: (player: Readonly<MatchmakingPlayer>, opponent: Readonly<MatchmakingPlayer>) => {
      const { type } = this.queueEntries.get(player.name)!
      const matchInfo = createMatch({
        type,
        players: List([player, opponent]),
      })
      this.acceptor.addMatch(matchInfo, [
        activityRegistry.getClientForUser(player.name),
        activityRegistry.getClientForUser(opponent.name),
      ])

      this.publishToActiveClient(player.name, {
        type: 'matchFound',
        matchmakingType: type,
        numPlayers: 2,
      })
      this.publishToActiveClient(opponent.name, {
        type: 'matchFound',
        matchmakingType: type,
        numPlayers: 2,
      })
    },
  }

  gameLoaderDelegate = {
    onGameSetup: async ({
      matchInfo,
      clients,
      slots,
      setup = {},
      resultCodes,
      mapsByPlayer,
      preferredMaps,
      randomMaps,
      chosenMap,
      cancelToken,
    }: {
      matchInfo: Match
      clients: List<ClientSocketsGroup>
      slots: List<Slot>
      setup?: Partial<{
        gameId: string
        seed: number
      }>
      resultCodes: Map<string, string>
      mapsByPlayer: { [key: number]: MapInfo }
      preferredMaps: MapInfo[]
      randomMaps: MapInfo[]
      chosenMap: MapInfo
      cancelToken: CancelToken
    }) => {
      cancelToken.throwIfCancelling()

      const playersJson = matchInfo.players.map(p => {
        const slot = slots.find(s => s.name === p.name)!

        return {
          id: p.id,
          name: p.name,
          race: slot.race,
          rating: p.rating,
        }
      })

      // Using `map` with `Promise.all` here instead of `forEach`, so our general error handler
      // catches any of the errors inside.
      await Promise.all(
        clients.map(async client => {
          let published = this.publishToActiveClient(client.name, {
            type: 'matchReady',
            setup,
            resultCode: resultCodes.get(client.name),
            slots,
            players: playersJson,
            mapsByPlayer,
            preferredMaps,
            randomMaps,
            chosenMap,
          })

          if (!published) {
            throw new Error(`match cancelled, ${client.name} disconnected`)
          }

          let mapSelectionTimerId
          let countdownTimerId
          try {
            const mapSelectionTimer = createDeferred<void>()
            mapSelectionTimer.catch(swallowNonBuiltins)
            this.clientTimers = this.clientTimers.update(
              client.name,
              createTimers({ cancelToken }),
              timers => timers.merge({ mapSelectionTimer }),
            )
            mapSelectionTimerId = setTimeout(() => mapSelectionTimer.resolve(), 5000)
            await mapSelectionTimer
            cancelToken.throwIfCancelling()

            published = this.publishToActiveClient(client.name, { type: 'startCountdown' })
            if (!published) {
              throw new Error(`match cancelled, ${client.name} disconnected`)
            }

            const countdownTimer = createDeferred<void>()
            countdownTimer.catch(swallowNonBuiltins)
            this.clientTimers = this.clientTimers.update(
              client.name,
              createTimers({ cancelToken }),
              timers => timers.merge({ countdownTimer }),
            )
            countdownTimerId = setTimeout(() => countdownTimer.resolve(), 5000)

            await countdownTimer
            cancelToken.throwIfCancelling()

            published = this.publishToActiveClient(client.name, {
              type: 'startWhenReady',
              gameId: setup.gameId,
            })
            if (!published) {
              throw new Error(`match cancelled, ${client.name} disconnected`)
            }
          } finally {
            if (mapSelectionTimerId) {
              clearTimeout(mapSelectionTimerId)
              mapSelectionTimerId = null
            }
            if (countdownTimerId) {
              clearTimeout(countdownTimerId)
              countdownTimerId = null
            }
          }
        }),
      )
    },

    onRoutesSet: (
      clients: List<ClientSocketsGroup>,
      playerName: string,
      routes: GameRoute[],
      gameId: string,
    ) => {
      this.publishToActiveClient(playerName, {
        type: 'setRoutes',
        routes,
        gameId,
      })
    },

    onGameLoaded: (clients: List<ClientSocketsGroup>) => {
      for (const client of clients) {
        this.publishToActiveClient(client.name, { type: 'gameStarted' })
        // TODO(tec27): Should this be maintained until the client reports game exit instead?
        this.unregisterActivity(client)
      }
    },
  }

  private matchmakers: IMap<MatchmakingType, TimedMatchmaker>
  private acceptor = new MatchAcceptor(
    MATCHMAKING_ACCEPT_MATCH_TIME + ACCEPT_MATCH_LATENCY,
    this.matchAcceptorDelegate,
  )
  // Maps username -> QueueEntry
  private queueEntries = IMap<string, QueueEntry>()
  // Maps username -> Timers
  private clientTimers = IMap<string, Timers>()

  private highRankedMmrs = IMap<MatchmakingType, { retrieved: number; rating: number }>()

  constructor(
    private nydus: NydusServer,
    private userSockets: UserSocketsManager,
    private clientSockets: ClientSocketsManager,
  ) {
    this.matchmakers = IMap(
      Object.values(MatchmakingType).map(type => [
        type,
        new TimedMatchmaker(MATCHMAKING_INTERVAL, this.matchmakerDelegate.onMatchFound),
      ]),
    )

    const debugDataService = container.resolve(MatchmakingDebugDataService)
    for (const [type, matchmaker] of this.matchmakers.entries()) {
      debugDataService.registerMatchmaker(type, matchmaker)
    }
  }

  private handleLeave = (client: ClientSocketsGroup) => {
    // NOTE(2Pac): Client can leave, i.e. disconnect, during the queueing process, during the
    // loading process, or even during the game process.
    const entry = this.queueEntries.get(client.name)
    // Means the client disconnected during the queueing process
    if (entry) {
      this.queueEntries = this.queueEntries.delete(client.name)
      this.matchmakers.get(entry.type)!.removeFromQueue(entry.username)
      this.acceptor.registerDisconnect(client)
    }

    // Means the client disconnected during the loading process
    if (this.clientTimers.has(client.name)) {
      const { mapSelectionTimer, countdownTimer, cancelToken } = this.clientTimers.get(client.name)!
      if (countdownTimer) {
        countdownTimer.reject(new Error('Countdown cancelled'))
      }
      if (mapSelectionTimer) {
        mapSelectionTimer.reject(new Error('Map selection cancelled'))
      }

      cancelToken.cancel()

      this.clientTimers = this.clientTimers.delete(client.name)
    }

    this.unregisterActivity(client)
  }

  private unregisterActivity(client: ClientSocketsGroup) {
    activityRegistry.unregisterClientForUser(client.name)
    this.publishToUser(client.name, {
      type: 'status',
      matchmaking: null,
    })

    const user = this.userSockets.getByName(client.name)
    if (user) {
      user.unsubscribe(MatchmakingApi.getUserPath(client.name))
    }
    client.unsubscribe(MatchmakingApi.getClientPath(client))
  }

  @Api(
    '/find',
    validateBody({
      type: isValidMatchmakingType,
      race: validRace,
    }),
  )
  async find(data: Map<string, any>, next: NextFunc) {
    const { type, race, useAlternateRace, alternateRace, preferredMaps } = data.get('body')

    if (useAlternateRace) {
      if (!validRace(alternateRace) || alternateRace === 'r') {
        throw new errors.BadRequest('invalid alternate race')
      }
    }
    if (!Array.isArray(preferredMaps) || preferredMaps.length > 2) {
      throw new errors.BadRequest('invalid preferred maps, must be an array with length at most 2')
    }

    const user = this.getUser(data)
    const client = this.getClient(data)

    if (matchmakingStatusInstance && !matchmakingStatusInstance.isEnabled(type)) {
      throw new errors.Conflict('matchmaking is currently disabled')
    }

    if (!activityRegistry.registerActiveClient(user.name, client)) {
      throw new errors.Conflict('user is already active in a gameplay activity')
    }

    const mmr: MatchmakingRating =
      (await getMatchmakingRating(user.userId, type)) ??
      (await createInitialMatchmakingRating(user.userId, type))

    // TODO(tec27): Really this retrieval should be triggered by the matchmaking, since it knows
    // when it's still running and for what matchmaking type
    const currentTime = monotonicNow()
    if (
      !this.highRankedMmrs.has(type) ||
      currentTime - this.highRankedMmrs.get(type)!.retrieved > MAX_HIGH_RANKED_AGE_MS
    ) {
      const highRankedRating = await getHighRankedRating(type)
      this.highRankedMmrs.set(type, { retrieved: currentTime, rating: highRankedRating })
      this.matchmakers.get(type)!.setHighRankedRating(highRankedRating)
    }

    // TODO(tec27): Bump up the uncertainty based on how long ago the last played date was:
    // "After [14] days, the inactive player’s uncertainty (search range) increases by 24 per day,
    // up to a maximum of 336 after 14 additional days."

    const halfUncertainty = mmr.uncertainty / 2

    const player: MatchmakingPlayer = {
      id: user.session.userId,
      name: user.name,
      numGamesPlayed: mmr.numGamesPlayed,
      rating: mmr.rating,
      interval: {
        low: mmr.rating - halfUncertainty,
        high: mmr.rating + halfUncertainty,
      },
      searchIterations: 0,
      race,
      useAlternateRace: !!useAlternateRace,
      alternateRace,
      preferredMaps: new Set(preferredMaps),
    }

    this.matchmakers.get(type)!.addToQueue(player)

    const queueEntry = createQueueEntry({ type, username: user.name })
    this.queueEntries = this.queueEntries.set(user.name, queueEntry)

    user.subscribe(MatchmakingApi.getUserPath(user.name), () => {
      return {
        type: 'status',
        matchmaking: { type },
      }
    })
    client.subscribe(MatchmakingApi.getClientPath(client), undefined, this.handleLeave)
  }

  @Api('/cancel')
  async cancel(data: Map<string, any>, next: NextFunc) {
    const user = this.getUser(data)
    const client = activityRegistry.getClientForUser(user.name)
    if (!client || !this.queueEntries.has(user.name)) {
      throw new errors.Conflict('user does not have an active matchmaking queue')
    }

    this.handleLeave(client)
  }

  @Api('/accept')
  async accept(data: Map<string, any>, next: NextFunc) {
    const client = this.getClient(data)
    if (!this.acceptor.registerAccept(client)) {
      throw new errors.NotFound('no active match found')
    }
  }

  getUser(data: Map<string, any>) {
    const user = this.userSockets.getBySocket(data.get('client'))
    if (!user) throw new errors.Unauthorized('authorization required')
    return user
  }

  getClient(data: Map<string, any>) {
    const client = this.clientSockets.getCurrentClient(data.get('client'))
    if (!client) throw new errors.Unauthorized('authorization required')
    return client
  }

  private publishToUser(username: string, data?: any) {
    this.nydus.publish(MatchmakingApi.getUserPath(username), data)
  }

  private publishToActiveClient(username: string, data?: any): boolean {
    const client = activityRegistry.getClientForUser(username)
    if (client) {
      this.nydus.publish(MatchmakingApi.getClientPath(client), data)
      return true
    } else {
      return false
    }
  }

  static getUserPath(username: string) {
    return `${MOUNT_BASE}/${encodeURIComponent(username)}`
  }

  static getClientPath(client: ClientSocketsGroup) {
    return `${MOUNT_BASE}/${client.userId}/${client.clientId}`
  }
}

export default function registerApi(nydus: NydusServer) {
  if (!MATCHMAKING) return null
  const api = container.resolve(MatchmakingApi)
  registerApiRoutes(api, nydus)
  return api
}
