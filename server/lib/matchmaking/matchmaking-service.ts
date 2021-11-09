import cuid from 'cuid'
import { container, singleton } from 'tsyringe'
import { ReadonlyDeep } from 'type-fest'
import { isAbortError, raceAbort } from '../../../common/async/abort-signals'
import CancelToken from '../../../common/async/cancel-token'
import createDeferred, { Deferred } from '../../../common/async/deferred'
import swallowNonBuiltins from '../../../common/async/swallow-non-builtins'
import { timeoutPromise } from '../../../common/async/timeout-promise'
import { GameRoute } from '../../../common/game-launch-config'
import { GameConfig, GameSource, GameType } from '../../../common/games/configuration'
import { createHuman, Slot } from '../../../common/lobbies/slot'
import { MapInfo, MapInfoJson, toMapInfoJson } from '../../../common/maps'
import {
  ALL_MATCHMAKING_TYPES,
  MatchmakingCompletionType,
  MatchmakingEvent,
  MatchmakingPreferences,
  MatchmakingType,
  MATCHMAKING_ACCEPT_MATCH_TIME_MS,
} from '../../../common/matchmaking'
import { subtract } from '../../../common/sets'
import { urlPath } from '../../../common/urls'
import { SbUserId } from '../../../common/users/user-info'
import gameLoader from '../games/game-loader'
import { GameplayActivityRegistry } from '../games/gameplay-activity-registry'
import logger from '../logging/logger'
import { getMapInfo } from '../maps/map-models'
import { MatchmakingDebugDataService } from '../matchmaking/debug-data'
import { Matchmaker, MATCHMAKING_INTERVAL_MS, OnMatchFoundFunc } from '../matchmaking/matchmaker'
import { MatchmakingPlayer } from '../matchmaking/matchmaking-player'
import MatchmakingStatusService from '../matchmaking/matchmaking-status'
import {
  createInitialMatchmakingRating,
  getMatchmakingRating,
  insertMatchmakingCompletion,
  MatchmakingRating,
} from '../matchmaking/models'
import { getCurrentMapPool } from '../models/matchmaking-map-pools'
import {
  ClientSocketsGroup,
  ClientSocketsManager,
  UserSocketsGroup,
  UserSocketsManager,
} from '../websockets/socket-groups'
import { TypedPublisher } from '../websockets/typed-publisher'

interface MatchmakerCallbacks {
  onMatchFound: OnMatchFoundFunc
}

interface GameLoaderCallbacks {
  onGameSetup: (props: {
    matchInfo: Readonly<Match>
    clients: ReadonlyArray<ClientSocketsGroup>
    slots: ReadonlyArray<Slot>
    setup?: Partial<{
      gameId: string
      seed: number
    }>
    resultCodes: ReadonlyMap<SbUserId, string>
    chosenMap: MapInfoJson
    cancelToken: CancelToken
  }) => void
  onRoutesSet: (
    clients: ReadonlyArray<ClientSocketsGroup>,
    playerName: string,
    routes: ReadonlyArray<GameRoute>,
    gameId: string,
  ) => void
  onGameLoaded: (clients: ReadonlyArray<ClientSocketsGroup>) => void
}

class Match {
  private acceptPromises = new Map<SbUserId, Deferred<void>>()
  private acceptTimeout: Promise<void>
  private clearAcceptTimeout: (reason?: any) => void

  private toKick = new Set<SbUserId>()
  private abortController = new AbortController()

  constructor(
    readonly id: string,
    readonly type: MatchmakingType,
    readonly players: MatchmakingPlayer[],
  ) {
    for (const p of players) {
      this.acceptPromises.set(p.id, createDeferred())
    }

    ;[this.acceptTimeout, this.clearAcceptTimeout] = timeoutPromise(
      MATCHMAKING_ACCEPT_MATCH_TIME_MS + ACCEPT_MATCH_LATENCY,
    )

    this.acceptTimeout
      .then(() => {
        if (this.acceptPromises.size) {
          for (const id of this.acceptPromises.keys()) {
            this.toKick.add(id)
          }
          this.abortController.abort()
        }
      })
      .catch(swallowNonBuiltins)
  }

  get acceptStateChanged(): Promise<void> {
    return raceAbort(
      this.abortController.signal,
      Promise.race(Array.from(this.acceptPromises.values())),
    )
  }

  get totalPlayers(): number {
    return this.players.length
  }

  get numAccepted(): number {
    return this.players.length - this.acceptPromises.size
  }

  registerAccept(userId: SbUserId) {
    this.acceptPromises.get(userId)?.resolve()
    this.acceptPromises.delete(userId)

    if (this.numAccepted === this.totalPlayers) {
      this.clearAcceptTimeout()
    }
  }

  registerDecline(userId: SbUserId) {
    this.toKick.add(userId)
    this.abortController.abort()
    this.clearAcceptTimeout()
  }

  getKicksAndRequeues(): [toKick: Set<SbUserId>, toRequeue: Set<SbUserId>] {
    const toRequeue = subtract(new Set(this.players.map(p => p.id)), this.toKick)
    return [new Set(this.toKick), toRequeue]
  }
}

interface QueueEntry {
  userId: SbUserId
  type: MatchmakingType
  matchId?: string
}

interface Timers {
  mapSelectionTimer?: Deferred<void>
  countdownTimer?: Deferred<void>
  cancelToken: CancelToken
}

const getRandomInt = (max: number) => Math.floor(Math.random() * Math.floor(max))

// Extra time that is added to the matchmaking accept time to account for latency in getting
// messages back and forth from clients
const ACCEPT_MATCH_LATENCY = 2000

export enum MatchmakingServiceErrorCode {
  UserOffline = 'userOffline',
  InvalidMapPool = 'invalidMapPool',
  InvalidMaps = 'invalidMaps',
  ClientDisconnected = 'clientDisconnected',
  MatchmakingDisabled = 'matchmakingDisabled',
  GameplayConflict = 'gameplayConflict',
  NotInQueue = 'notInQueue',
  NoActiveMatch = 'noActiveMatch',
  InvalidClient = 'invalidClient',
}

export class MatchmakingServiceError extends Error {
  constructor(readonly code: MatchmakingServiceErrorCode, message: string) {
    super(message)
  }
}

/**
 * Selects a map for the given players and matchmaking type, based on the players' stored
 * matchmaking preferences and the current map pool.
 */
async function pickMap(
  matchmakingType: MatchmakingType,
  players: ReadonlyArray<MatchmakingPlayer>,
): Promise<MapInfo> {
  const currentMapPool = await getCurrentMapPool(matchmakingType)
  if (!currentMapPool) {
    throw new MatchmakingServiceError(
      MatchmakingServiceErrorCode.InvalidMapPool,
      "Map pool doesn't exist",
    )
  }

  // TODO(tec27): Handle parties in 2v2: only the leader's selections should be used

  // The algorithm for selecting maps is:
  // 1) All players' map selections are treated as vetoes, and removed from the available map pool
  // 2a) If any maps are remaining, select a random map from the remaining ones
  // 2b) If no maps are remaining, select a random map from the entire pool

  const fullMapPool = new Set(currentMapPool.maps)
  let mapPool = fullMapPool
  for (const p of players) {
    mapPool = subtract(mapPool, p.mapSelections)
  }

  if (!mapPool.size) {
    // All available maps were vetoed, select from the whole pool
    mapPool = fullMapPool
  }

  const chosenMapId = [...mapPool][getRandomInt(mapPool.size)]
  const mapInfo = await getMapInfo([chosenMapId])

  if (!mapInfo.length) {
    throw new MatchmakingServiceError(
      MatchmakingServiceErrorCode.InvalidMaps,
      'Some (or all) of the maps not found',
    )
  }

  const chosenMap = mapInfo[0]

  return chosenMap
}

@singleton()
export class MatchmakingService {
  private matchmakerDelegate: MatchmakerCallbacks = {
    onMatchFound: (player: Readonly<MatchmakingPlayer>, opponent: Readonly<MatchmakingPlayer>) => {
      const playerEntry = this.queueEntries.get(player.id)!

      const matchInfo = new Match(cuid(), playerEntry.type, [player, opponent])
      this.matches.set(matchInfo.id, matchInfo)

      for (const p of [player, opponent]) {
        const queueEntry = this.queueEntries.get(p.id)!
        queueEntry.matchId = matchInfo.id
        this.publishToActiveClient(p.id, {
          type: 'matchFound',
          matchmakingType: matchInfo.type,
          numPlayers: 2,
        })
      }

      const completionTime = new Date()
      for (const p of [player, opponent]) {
        insertMatchmakingCompletion({
          userId: p.id,
          matchmakingType: matchInfo.type,
          completionType: MatchmakingCompletionType.Found,
          searchTimeMillis: p.searchIterations * MATCHMAKING_INTERVAL_MS,
          completionTime,
        }).catch(err => logger.error({ err }, 'error while logging matchmaking completion'))
      }

      this.runMatch(matchInfo.id).catch(swallowNonBuiltins)
    },
  }

  private gameLoaderDelegate: GameLoaderCallbacks = {
    onGameSetup: async ({
      matchInfo,
      clients,
      slots,
      setup = {},
      resultCodes,
      chosenMap,
      cancelToken,
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
          let published = this.publishToActiveClient(client.userId, {
            type: 'matchReady',
            matchmakingType: matchInfo.type,
            setup,
            resultCode: resultCodes.get(client.userId),
            slots,
            players: playersJson,
            chosenMap,
          })

          if (!published) {
            throw new MatchmakingServiceError(
              MatchmakingServiceErrorCode.ClientDisconnected,
              `Match cancelled, ${client.name} disconnected`,
            )
          }

          let mapSelectionTimerId
          let countdownTimerId
          try {
            const mapSelectionTimer = createDeferred<void>()
            mapSelectionTimer.catch(swallowNonBuiltins)
            let timers = this.clientTimers.get(client.userId) ?? { cancelToken }
            timers.mapSelectionTimer = mapSelectionTimer
            this.clientTimers.set(client.userId, timers)
            mapSelectionTimerId = setTimeout(() => mapSelectionTimer.resolve(), 5000)
            await mapSelectionTimer
            cancelToken.throwIfCancelling()

            published = this.publishToActiveClient(client.userId, { type: 'startCountdown' })
            if (!published) {
              throw new MatchmakingServiceError(
                MatchmakingServiceErrorCode.ClientDisconnected,
                `Match cancelled, ${client.name} disconnected`,
              )
            }

            const countdownTimer = createDeferred<void>()
            countdownTimer.catch(swallowNonBuiltins)
            timers = this.clientTimers.get(client.userId) ?? { cancelToken }
            timers.countdownTimer = countdownTimer
            this.clientTimers.set(client.userId, timers)
            countdownTimerId = setTimeout(() => countdownTimer.resolve(), 5000)

            await countdownTimer
            cancelToken.throwIfCancelling()

            published = this.publishToActiveClient(client.userId, {
              type: 'startWhenReady',
              gameId: setup.gameId!,
            })
            if (!published) {
              throw new MatchmakingServiceError(
                MatchmakingServiceErrorCode.ClientDisconnected,
                `Match cancelled, ${client.name} disconnected`,
              )
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

    onRoutesSet: (clients, playerName, routes, gameId) => {
      for (const c of clients) {
        // TODO(tec27): It'd be a lot nicer if this just delivered us the user ID of this player
        // instead of their name (or gave both).
        if (c.name === playerName) {
          this.publishToActiveClient(c.userId, {
            type: 'setRoutes',
            routes,
            gameId,
          })
          break
        }
      }
    },

    onGameLoaded: clients => {
      for (const client of clients) {
        this.publishToActiveClient(client.userId, { type: 'gameStarted' })
        // TODO(tec27): Should this be maintained until the client reports game exit instead?
        this.unregisterActivity(client.userId)
      }
    },
  }

  private matchmakers: Map<MatchmakingType, Matchmaker>
  // Maps user ID -> QueueEntry
  private queueEntries = new Map<SbUserId, QueueEntry>()
  // Maps match ID -> Match
  private matches = new Map<string, Match>()
  // Maps user ID -> Timers
  private clientTimers = new Map<SbUserId, Timers>()

  constructor(
    private publisher: TypedPublisher<ReadonlyDeep<MatchmakingEvent>>,
    private userSocketsManager: UserSocketsManager,
    private clientSocketsManager: ClientSocketsManager,
    private matchmakingStatus: MatchmakingStatusService,
    private activityRegistry: GameplayActivityRegistry,
  ) {
    this.matchmakers = new Map(
      ALL_MATCHMAKING_TYPES.map(type => [
        type,
        container.resolve(Matchmaker).setOnMatchFound(this.matchmakerDelegate.onMatchFound),
      ]),
    )

    const debugDataService = container.resolve(MatchmakingDebugDataService)
    for (const [type, matchmaker] of this.matchmakers.entries()) {
      debugDataService.registerMatchmaker(type, matchmaker)
    }
  }

  async find(userId: SbUserId, clientId: string, preferences: MatchmakingPreferences) {
    const { matchmakingType: type, race, mapSelections, data } = preferences
    const userSockets = this.getUserSocketsOrFail(userId)
    const clientSockets = this.getClientSocketsOrFail(userId, clientId)

    if (!this.matchmakingStatus.isEnabled(type)) {
      throw new MatchmakingServiceError(
        MatchmakingServiceErrorCode.MatchmakingDisabled,
        'Matchmaking is currently disabled',
      )
    }

    if (!this.activityRegistry.registerActiveClient(userId, clientSockets)) {
      throw new MatchmakingServiceError(
        MatchmakingServiceErrorCode.GameplayConflict,
        'User is already active in a gameplay activity',
      )
    }

    const mmr: MatchmakingRating =
      (await getMatchmakingRating(userId, type)) ??
      (await createInitialMatchmakingRating(userId, type))

    // TODO(tec27): Bump up the uncertainty based on how long ago the last played date was:
    // "After [14] days, the inactive player’s uncertainty (search range) increases by 24 per day,
    // up to a maximum of 336 after 14 additional days."

    const halfUncertainty = mmr.uncertainty / 2

    const player: MatchmakingPlayer = {
      id: clientSockets.userId,
      name: clientSockets.name,
      numGamesPlayed: mmr.numGamesPlayed,
      rating: mmr.rating,
      interval: {
        low: mmr.rating - halfUncertainty,
        high: mmr.rating + halfUncertainty,
      },
      searchIterations: 0,
      race,
      useAlternateRace: !!data?.useAlternateRace,
      alternateRace: data?.alternateRace ?? 'z',
      mapSelections: new Set(mapSelections),
    }

    this.matchmakers.get(type)!.addToQueue(player)

    this.queueEntries.set(userId, {
      type,
      userId,
    })

    userSockets.subscribe<MatchmakingEvent>(
      MatchmakingService.getUserPath(userSockets.userId),
      () => {
        return {
          type: 'queueStatus',
          matchmaking: { type },
        }
      },
    )
    clientSockets.subscribe<MatchmakingEvent>(
      MatchmakingService.getClientPath(clientSockets),
      undefined,
      sockets => this.removeClientFromMatchmaking(sockets, true),
    )
  }

  async cancel(userId: SbUserId) {
    const clientSockets = this.activityRegistry.getClientForUser(userId)
    if (!clientSockets || !this.queueEntries.has(userId)) {
      throw new MatchmakingServiceError(
        MatchmakingServiceErrorCode.NotInQueue,
        'User does not have an active matchmaking queue',
      )
    }

    this.removeClientFromMatchmaking(clientSockets, false)
  }

  async accept(userId: SbUserId) {
    const queueEntry = this.queueEntries.get(userId)
    if (!queueEntry?.matchId) {
      throw new MatchmakingServiceError(
        MatchmakingServiceErrorCode.NoActiveMatch,
        'No active match found',
      )
    }

    this.matches.get(queueEntry.matchId)?.registerAccept(userId)
  }

  private async runMatch(matchId: string) {
    const match = this.matches.get(matchId)!
    let phase: 'accepting' | 'loading' = 'accepting'

    try {
      while (match.numAccepted < match.totalPlayers) {
        await match.acceptStateChanged

        for (const p of match.players) {
          this.publishToActiveClient(p.id, {
            type: 'playerAccepted',
            acceptedPlayers: match.numAccepted,
          })
        }
      }

      phase = 'loading'
      await this.doGameLoad(match)
    } catch (err: any) {
      if (!isAbortError(err)) {
        logger.error({ err }, 'error while processing match')
      }

      const [toKick, toRequeue] = match.getKicksAndRequeues()

      for (const id of toKick) {
        this.queueEntries.delete(id)
        this.publishToActiveClient(id, {
          type: 'acceptTimeout',
        })
        this.unregisterActivity(id)
      }

      for (const id of toRequeue) {
        this.queueEntries.get(id)!.matchId = undefined
        const player = match.players.find(p => p.id === id)!
        this.matchmakers.get(match.type)!.addToQueue(player)

        if (phase === 'loading') {
          // TODO(tec27): Give a better reason here, and ideally derive who to kick from the load
          // failures
          this.publishToActiveClient(id, {
            type: 'cancelLoading',
            reason: 'loading failed',
          })
        }

        // TODO(tec27): Really this event should have info about what is being queued for, with
        // what settings, etc. (MatchmakingPreferences, probably). It should be enough info that
        // the event can be the same on the client as it is for the initial queue
        this.publishToActiveClient(id, {
          type: 'requeue',
        })
      }
    } finally {
      this.matches.delete(match.id)
    }
  }

  private async doGameLoad(match: Match) {
    let slots: Slot[]
    const players = match.players

    // TODO(tec27): ignore alternate race selection if there are more than 2 players
    const firstPlayer = players[0]
    // NOTE(tec27): alternate race selection is not available for random users. We block this
    // from being set elsewhere, but ignore it here just in case
    const playersHaveSameRace =
      firstPlayer.race !== 'r' && players.every(p => p.race === firstPlayer.race)
    if (playersHaveSameRace && players.every(p => p.useAlternateRace === true)) {
      // All players have the same race and all of them want to use an alternate race: select
      // one of the players randomly to play their alternate race, leaving the other player to
      // play their main race.
      const randomPlayerIndex = getRandomInt(players.length)
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

    const chosenMap = await pickMap(match.type, match.players)

    const gameConfig: GameConfig = {
      // TODO(tec27): This will need to be adjusted for team matchmaking
      gameType: GameType.OneVsOne,
      gameSubType: 0,
      gameSource: GameSource.Matchmaking,
      gameSourceExtra: { type: match.type },
      teams: [
        slots.map(s => ({
          id: s.userId,
          race: s.race,
          isComputer: s.type === 'computer' || s.type === 'umsComputer',
        })),
      ],
    }

    const clients = players.map(({ id }) => this.activityRegistry.getClientForUser(id)!)

    const loadCancelToken = new CancelToken()
    const gameLoaded = gameLoader.loadGame({
      players: slots,
      mapId: chosenMap.id,
      gameConfig,
      cancelToken: loadCancelToken,
      onGameSetup: (setup, resultCodes) =>
        this.gameLoaderDelegate.onGameSetup({
          matchInfo: match,
          clients,
          slots,
          setup,
          resultCodes,
          chosenMap: toMapInfoJson(chosenMap),
          cancelToken: loadCancelToken,
        }),
      onRoutesSet: (playerName, routes, gameId) =>
        this.gameLoaderDelegate.onRoutesSet(clients, playerName, routes, gameId),
    })

    await gameLoaded

    for (const player of match.players) {
      this.queueEntries.delete(player.id)
    }

    this.gameLoaderDelegate.onGameLoaded(clients)
  }

  private unregisterActivity(userId: SbUserId) {
    const activeClient = this.activityRegistry.getClientForUser(userId)
    this.activityRegistry.unregisterClientForUser(userId)
    this.publishToUser(userId, {
      type: 'queueStatus',
      matchmaking: undefined,
    })

    const userSockets = this.userSocketsManager.getById(userId)
    userSockets?.unsubscribe(MatchmakingService.getUserPath(userId))
    activeClient?.unsubscribe(MatchmakingService.getClientPath(activeClient))
  }

  private removeClientFromMatchmaking(client: ClientSocketsGroup, isDisconnect = true) {
    // NOTE(2Pac): Client can leave, i.e. disconnect, during the queueing process, during the
    // loading process, or even during the game process.
    const entry = this.queueEntries.get(client.userId)
    // Means the client disconnected during the queueing process
    if (entry) {
      this.queueEntries.delete(client.userId)

      const player = this.matchmakers.get(entry.type)!.removeFromQueue(entry.userId)
      if (player) {
        insertMatchmakingCompletion({
          userId: player.id,
          matchmakingType: entry.type,
          completionType: isDisconnect
            ? MatchmakingCompletionType.Disconnect
            : MatchmakingCompletionType.Cancel,
          searchTimeMillis: player.searchIterations * MATCHMAKING_INTERVAL_MS,
          completionTime: new Date(),
        }).catch(err => logger.error({ err }, 'error while logging matchmaking completion'))
      }

      if (entry.matchId) {
        this.matches.get(entry.matchId)?.registerDecline(client.userId)
      }
    }

    // Means the client disconnected during the loading process
    if (this.clientTimers.has(client.userId)) {
      const { mapSelectionTimer, countdownTimer, cancelToken } = this.clientTimers.get(
        client.userId,
      )!
      if (countdownTimer) {
        countdownTimer.reject(new Error('Countdown cancelled'))
      }
      if (mapSelectionTimer) {
        mapSelectionTimer.reject(new Error('Map selection cancelled'))
      }

      cancelToken.cancel()

      this.clientTimers.delete(client.userId)
    }

    this.unregisterActivity(client.userId)
  }

  private getUserSocketsOrFail(userId: SbUserId): UserSocketsGroup {
    const userSockets = this.userSocketsManager.getById(userId)
    if (!userSockets) {
      throw new MatchmakingServiceError(MatchmakingServiceErrorCode.UserOffline, 'User is offline')
    }

    return userSockets
  }

  private getClientSocketsOrFail(userId: SbUserId, clientId: string): ClientSocketsGroup {
    const clientSockets = this.clientSocketsManager.getById(userId, clientId)
    if (!clientSockets) {
      throw new MatchmakingServiceError(
        MatchmakingServiceErrorCode.UserOffline,
        'Client could not be found',
      )
    }
    if (clientSockets.clientType !== 'electron') {
      throw new MatchmakingServiceError(MatchmakingServiceErrorCode.InvalidClient, 'Invalid client')
    }

    return clientSockets
  }

  private publishToUser(userId: SbUserId, data?: ReadonlyDeep<MatchmakingEvent>) {
    this.publisher.publish(MatchmakingService.getUserPath(userId), data)
  }

  private publishToActiveClient(userId: SbUserId, data?: ReadonlyDeep<MatchmakingEvent>): boolean {
    const client = this.activityRegistry.getClientForUser(userId)
    if (client) {
      this.publisher.publish(MatchmakingService.getClientPath(client), data)
      return true
    } else {
      return false
    }
  }

  static getUserPath(userId: SbUserId) {
    return urlPath`/matchmaking/${userId}`
  }

  static getClientPath(client: ClientSocketsGroup) {
    return urlPath`/matchmaking/${client.userId}/${client.clientId}`
  }
}
