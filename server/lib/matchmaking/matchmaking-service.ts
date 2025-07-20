import { Immutable } from 'immer'
import { nanoid } from 'nanoid'
import { Counter, exponentialBuckets, Histogram } from 'prom-client'
import { container, singleton } from 'tsyringe'
import { ReadonlyDeep } from 'type-fest'
import { assertUnreachable } from '../../../common/assert-unreachable'
import { isAbortError, raceAbort } from '../../../common/async/abort-signals'
import createDeferred, { Deferred } from '../../../common/async/deferred'
import swallowNonBuiltins from '../../../common/async/swallow-non-builtins'
import { timeoutPromise } from '../../../common/async/timeout-promise'
import { intersection, subtract, union } from '../../../common/data-structures/sets'
import {
  GameConfig,
  GameConfigPlayer,
  GameSource,
  MatchmakingExtra,
} from '../../../common/games/configuration'
import { PlayerInfo } from '../../../common/games/game-launch-config'
import { GameType } from '../../../common/games/game-type'
import { createHuman, Slot, SlotType } from '../../../common/lobbies/slot'
import { MapInfo, SbMapId } from '../../../common/maps'
import {
  ALL_MATCHMAKING_TYPES,
  hasVetoes,
  MATCHMAKING_ACCEPT_MATCH_TIME_MS,
  MatchmakingCompletionType,
  MatchmakingEvent,
  MatchmakingPreferences,
  MatchmakingSeason,
  MatchmakingServiceErrorCode,
  MatchmakingType,
  TEAM_SIZES,
} from '../../../common/matchmaking'
import { RaceChar } from '../../../common/races'
import { randomInt, randomItem } from '../../../common/random'
import { RestrictionKind } from '../../../common/users/restrictions'
import { makeSbUserId, SbUserId } from '../../../common/users/sb-user-id'
import { GameLoader, GameLoadErrorType } from '../games/game-loader'
import { GameplayActivityRegistry } from '../games/gameplay-activity-registry'
import logger from '../logging/logger'
import { getMapInfos } from '../maps/map-models'
import { Matchmaker, MATCHMAKING_INTERVAL_MS, OnMatchFoundFunc } from '../matchmaking/matchmaker'
import {
  getMatchmakingEntityId,
  getNumPlayersInEntity,
  getPlayersFromEntity,
  MatchmakingEntity,
  MatchmakingPlayer,
  MatchmakingPlayerData,
  matchmakingRatingToPlayerData,
} from '../matchmaking/matchmaking-entity'
import MatchmakingStatusService from '../matchmaking/matchmaking-status'
import {
  createInitialMatchmakingRating,
  getMatchmakingRating,
  insertMatchmakingCompletion,
  MatchmakingRating,
} from '../matchmaking/models'
import { getCurrentMapPool } from '../models/matchmaking-map-pools'
import { Clock } from '../time/clock'
import { ClientIdentifierString } from '../users/client-ids'
import { RestrictionService } from '../users/restriction-service'
import { UserIdentifierManager } from '../users/user-identifier-manager'
import {
  ClientSocketsGroup,
  ClientSocketsManager,
  UserSocketsGroup,
  UserSocketsManager,
} from '../websockets/socket-groups'
import { TypedPublisher } from '../websockets/typed-publisher'
import { DraftState } from './draft-state'
import { MatchmakingBanService } from './matchmaking-ban-service'
import { MatchmakingSeasonsService } from './matchmaking-seasons'
import { MatchmakingServiceError } from './matchmaking-service-error'
import {
  getMatchmakingClientPath,
  getMatchmakingUserPath,
  getMatchPath,
} from './matchmaking-socket-paths'
import { adjustMatchmakingRatingForInactivity } from './rating'

interface MatchmakerCallbacks {
  onMatchFound: OnMatchFoundFunc
}

class Match {
  private acceptPromises = new Map<SbUserId, Deferred<void>>()
  private acceptTimeout: Promise<void>
  private clearAcceptTimeout: (reason?: any) => void
  private userIdToRegisteredId = new Map<SbUserId, SbUserId>()

  private toKick = new Set<SbUserId>()
  private toBan = new Set<SbUserId>()
  private abortController = new AbortController()
  private draftState?: DraftState

  constructor(
    readonly id: string,
    readonly type: MatchmakingType,
    readonly teams: Immutable<MatchmakingEntity[][]>,
    private publisher: TypedPublisher<ReadonlyDeep<MatchmakingEvent>>,
  ) {
    for (const entities of teams) {
      for (const entity of entities) {
        const registeredId = getMatchmakingEntityId(entity)
        for (const p of getPlayersFromEntity(entity)) {
          this.acceptPromises.set(p.id, createDeferred())
          this.userIdToRegisteredId.set(p.id, registeredId)
        }
      }
    }

    ;[this.acceptTimeout, this.clearAcceptTimeout] = timeoutPromise(
      MATCHMAKING_ACCEPT_MATCH_TIME_MS + ACCEPT_MATCH_LATENCY,
    )

    this.acceptTimeout
      .then(() => {
        if (this.acceptPromises.size) {
          for (const id of this.acceptPromises.keys()) {
            this.markForBan(id)
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

  *players(): Generator<Immutable<MatchmakingPlayerData>> {
    for (const entities of this.teams) {
      for (const entity of entities) {
        for (const p of getPlayersFromEntity(entity)) {
          yield p
        }
      }
    }
  }

  get totalPlayers(): number {
    return TEAM_SIZES[this.type] * this.teams.length
  }

  get numAccepted(): number {
    return this.totalPlayers - this.acceptPromises.size
  }

  registerAccept(userId: SbUserId) {
    this.acceptPromises.get(userId)?.resolve()
    this.acceptPromises.delete(userId)

    if (this.numAccepted === this.totalPlayers) {
      this.clearAcceptTimeout()
    }
  }

  registerDecline(userId: SbUserId) {
    this.markForBan(userId)
    this.clearAcceptTimeout()

    // If draft state exists, then we need to abort that too
    this.draftState?.handleClientLeave()
    this.abortController.abort()
  }

  markForBan(userId: SbUserId) {
    this.toBan.add(userId)
    // In case this user was in a party, mark their party for kick
    this.toKick.add(this.userIdToRegisteredId.get(userId)!)
  }

  getKicksBansAndRequeues(): [
    toKick: Set<SbUserId>,
    toBan: Set<SbUserId>,
    toRequeue: Set<SbUserId>,
  ] {
    // Requeue any party leaders and solo players that don't appear in toKick
    const toRequeue = subtract(
      new Set(this.teams.flatMap(team => team.map(entity => getMatchmakingEntityId(entity)))),
      union(this.toKick, this.toBan),
    )
    return [new Set(this.toKick), new Set(this.toBan), toRequeue]
  }

  /**
   * Runs a race draft for team modes, will return a resolved promise for modes without a draft.
   */
  runDraft(activeClients: Map<SbUserId, ClientSocketsGroup>, map: MapInfo): Promise<void> {
    if (this.type === MatchmakingType.Match1v1 || this.type === MatchmakingType.Match1v1Fastest) {
      return Promise.resolve()
    }

    if (this.draftState) {
      throw new Error('Draft state already initialized')
    }

    this.draftState = new DraftState(
      this.id,
      this.teams,
      map,
      this.abortController,
      this.publisher,
      activeClients,
    )
    return raceAbort(this.abortController.signal, this.draftState.completedPromise)
  }

  /**
   * Returns the draft state if this match has one.
   */
  getDraftState(): DraftState | undefined {
    return this.draftState
  }
}

interface QueueEntry {
  userId: SbUserId
  /** The user ID that the matchmaking queue is registered under. (e.g. the party leader's ID) */
  registeredId: SbUserId
  type: MatchmakingType
  partyId?: string
  matchId?: string
}

// Extra time that is added to the matchmaking accept time to account for latency in getting
// messages back and forth from clients
const ACCEPT_MATCH_LATENCY = 2000

/**
 * Selects a map for the given players and matchmaking type, based on the players' stored
 * matchmaking preferences and the current map pool.
 */
async function pickMap(
  matchmakingType: MatchmakingType,
  entities: Immutable<MatchmakingEntity[]>,
): Promise<MapInfo> {
  const currentMapPool = await getCurrentMapPool(matchmakingType)
  if (!currentMapPool) {
    throw new MatchmakingServiceError(
      MatchmakingServiceErrorCode.InvalidMapPool,
      "Map pool doesn't exist",
    )
  }

  const fullMapPool = new Set(currentMapPool.maps)
  let mapPool = fullMapPool
  if (hasVetoes(matchmakingType)) {
    // The algorithm for selecting maps in a veto system is:
    // 1) All players' map selections are treated as vetoes, and removed from the available map
    //    pool. We also track how many times each map was vetoed.
    // 2a) If any maps are remaining, select a random map from the remaining ones
    // 2b) If no maps are remaining, select a random map from the least vetoed maps

    const vetoCount = new Map<SbMapId, number>()
    for (const e of entities) {
      const mapSelections = e.mapSelections
      mapPool = subtract(mapPool, mapSelections)
      for (const map of mapSelections) {
        vetoCount.set(map, (vetoCount.get(map) ?? 0) + 1)
      }
    }

    if (!mapPool.size) {
      // All available maps were vetoed, create a final pool from the least vetoed maps
      // NOTE(tec27): We know since the whole pool was vetoed, each map in the pool will have an
      // entry here, even though we didn't initialize the Map directly
      const sortedByVetoCount = Array.from(vetoCount.entries()).sort((a, b) => a[1] - b[1])
      const leastVetoCount = sortedByVetoCount[0][1]
      let lastElem = 1
      while (
        lastElem < sortedByVetoCount.length &&
        sortedByVetoCount[lastElem][1] <= leastVetoCount
      ) {
        lastElem += 1
      }

      mapPool = new Set(sortedByVetoCount.slice(0, lastElem).map(e => e[0]))
    }
  } else {
    // For a positive map selection system, we just intersect all players' map selections to find
    // the pool
    for (const e of entities) {
      const mapSelections = new Set(e.mapSelections)
      mapPool = intersection(mapPool, mapSelections)
    }
  }

  const chosenMapId = randomItem(Array.from(mapPool))
  const mapInfo = await getMapInfos([chosenMapId])

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
    onMatchFound: (teamA, teamB) => {
      const playerEntry = this.queueEntries.get(getMatchmakingEntityId(teamA[0]))!

      const matchInfo = new Match(nanoid(), playerEntry.type, [teamA, teamB], this.publisher)
      this.matches.set(matchInfo.id, matchInfo)

      for (const entities of [teamA, teamB]) {
        for (const entity of entities) {
          for (const p of getPlayersFromEntity(entity)) {
            const queueEntry = this.queueEntries.get(p.id)!
            queueEntry.matchId = matchInfo.id
            this.publishToActiveClient(p.id, {
              type: 'matchFound',
              matchmakingType: matchInfo.type,
              numPlayers: matchInfo.totalPlayers,
            })
          }
        }
      }

      const completionTime = new Date(this.clock.now())
      for (const entities of [teamA, teamB]) {
        for (const entity of entities) {
          for (const p of getPlayersFromEntity(entity)) {
            insertMatchmakingCompletion({
              userId: p.id,
              matchmakingType: matchInfo.type,
              completionType: MatchmakingCompletionType.Found,
              searchTimeMillis: entity.searchIterations * MATCHMAKING_INTERVAL_MS,
              completionTime,
            }).catch(err => logger.error({ err }, 'error while logging matchmaking completion'))
          }
          this.matchSearchTimeMetric
            .labels(
              matchInfo.type,
              String(getNumPlayersInEntity(entity)),
              MatchmakingCompletionType.Found,
            )
            .observe((entity.searchIterations * MATCHMAKING_INTERVAL_MS) / 1000)
        }
      }

      this.matchesFoundMetric.labels(matchInfo.type).inc()

      this.runMatch(matchInfo.id).catch(swallowNonBuiltins)
    },
  }

  private matchmakers: Map<MatchmakingType, Matchmaker>
  private queueEntries = new Map<SbUserId, QueueEntry>()
  // Maps match ID -> Match
  private matches = new Map<string, Match>()

  private matchesRequestedMetric = new Counter({
    name: 'shieldbattery_matchmaker_matches_requested_total',
    labelNames: ['matchmaking_type', 'party_size'],
    help: 'Total number of matches requested',
  })
  private matchesFoundMetric = new Counter({
    name: 'shieldbattery_matchmaker_matches_found_total',
    labelNames: ['matchmaking_type'],
    help: 'Total number of matches found',
  })
  private matchRequestsCanceledMetric = new Counter({
    name: 'shieldbattery_matchmaker_match_requests_canceled_total',
    labelNames: ['matchmaking_type', 'party_size'],
    help: 'Total number of cancellations of match requests',
  })
  private matchSearchTimeMetric = new Histogram({
    name: 'shieldbattery_matchmaker_completion_seconds',
    labelNames: ['matchmaking_type', 'party_size', 'completion_type'],
    help: 'Duration of a matchmaking search in seconds',
    buckets: exponentialBuckets(1, 1.75, 20),
  })

  // Injecting this many is fine!
  // eslint-disable-next-line max-params
  constructor(
    private publisher: TypedPublisher<ReadonlyDeep<MatchmakingEvent>>,
    private userSocketsManager: UserSocketsManager,
    private clientSocketsManager: ClientSocketsManager,
    private matchmakingStatus: MatchmakingStatusService,
    private activityRegistry: GameplayActivityRegistry,
    private gameLoader: GameLoader,
    private matchmakingSeasonsService: MatchmakingSeasonsService,
    private clock: Clock,
    private userIdentifierManager: UserIdentifierManager,
    private matchmakingBanService: MatchmakingBanService,
    private restrictionService: RestrictionService,
  ) {
    this.matchmakers = new Map(
      ALL_MATCHMAKING_TYPES.map(type => [
        type,
        container
          .resolve(Matchmaker)
          .setMatchmakingType(type)
          .setOnMatchFound(this.matchmakerDelegate.onMatchFound),
      ]),
    )
  }

  /**
   * Adds a user to the matchmaking queue. This can only be used for solo players, players in a
   * party should use `findAsParty` instead (this call will fail for them).
   */
  async find(
    userId: SbUserId,
    clientId: string,
    identifiers: ReadonlyArray<ClientIdentifierString>,
    preferences: MatchmakingPreferences,
  ): Promise<void> {
    const { matchmakingType: type } = preferences
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

    try {
      await this.queueSoloPlayer(userId, clientId, identifiers, preferences)
    } catch (err) {
      // Clear out the activity registry for this user, since they didn't actually make it into the
      // queue
      this.activityRegistry.unregisterClientForUser(userId)
      throw err
    }
  }

  /**
   * Helper that deals with actually putting a solo player into the queue. This should only be
   * called *after* the player's request has been validated and they've been registered as the
   * active gameplay client.
   */
  private async queueSoloPlayer(
    userId: SbUserId,
    clientId: string,
    identifiers: ReadonlyArray<ClientIdentifierString>,
    preferences: Pick<
      MatchmakingPreferences,
      'matchmakingType' | 'race' | 'mapSelections' | 'data'
    >,
  ): Promise<void> {
    const { matchmakingType: type, race, mapSelections, data: preferenceData } = preferences
    const userSockets = this.getUserSocketsOrFail(userId)
    const clientSockets = this.getClientSocketsOrFail(userId, clientId)

    const season = await this.matchmakingSeasonsService.getCurrentSeason()
    const mmr = await this.retrieveMmr(userId, type, season, identifiers)
    const playerData = matchmakingRatingToPlayerData({
      mmr,
      race,
      mapSelections: mapSelections.slice(),
      preferenceData,
      identifiers,
    })

    // TODO(tec27): Bump up the uncertainty based on how long ago the last played date was:
    // "After [14] days, the inactive player’s uncertainty (search range) increases by 24 per day,
    // up to a maximum of 336 after 14 additional days."
    const halfUncertainty = mmr.uncertainty / 2

    const player: MatchmakingPlayer = {
      ...playerData,
      interval: {
        low: mmr.rating - halfUncertainty,
        high: mmr.rating + halfUncertainty,
      },
      searchIterations: 0,
    }

    this.matchmakers.get(type)!.addToQueue(player)
    this.queueEntries.set(userId, {
      type,
      userId,
      registeredId: userId,
    })

    this.subscribeUserToQueueUpdates(userSockets, clientSockets, type, race)
    this.matchesRequestedMetric.labels(type, '1').inc()
  }

  async cancel(userId: SbUserId): Promise<void> {
    const clientSockets = this.activityRegistry.getClientForUser(userId)
    if (!clientSockets || !this.queueEntries.has(userId)) {
      throw new MatchmakingServiceError(
        MatchmakingServiceErrorCode.NotInQueue,
        'User does not have an active matchmaking queue',
      )
    } else if (this.queueEntries.get(userId)?.matchId) {
      throw new MatchmakingServiceError(
        MatchmakingServiceErrorCode.MatchAlreadyStarting,
        'Match is already starting and cannot be canceled',
      )
    }

    this.removeClientFromMatchmaking(clientSockets, false)
  }

  async accept(userId: SbUserId): Promise<void> {
    const queueEntry = this.queueEntries.get(userId)
    if (!queueEntry?.matchId) {
      throw new MatchmakingServiceError(
        MatchmakingServiceErrorCode.NoActiveMatch,
        'No active match found',
      )
    }

    this.matches.get(queueEntry.matchId)?.registerAccept(userId)
  }

  async updateProvisionalRace(userId: SbUserId, race: RaceChar): Promise<void> {
    const queueEntry = this.queueEntries.get(userId)
    if (!queueEntry?.matchId) {
      throw new MatchmakingServiceError(
        MatchmakingServiceErrorCode.NoActiveMatch,
        'No active match found',
      )
    }

    const match = this.matches.get(queueEntry.matchId)
    if (!match) {
      throw new MatchmakingServiceError(
        MatchmakingServiceErrorCode.NoActiveMatch,
        'Match no longer exists',
      )
    }

    const draftState = match.getDraftState()
    if (!draftState) {
      throw new MatchmakingServiceError(
        MatchmakingServiceErrorCode.NoActiveDraft,
        'No active draft found',
      )
    }

    draftState.updateProvisionalRace(userId, race)
  }

  async lockInPick(userId: SbUserId, race: RaceChar): Promise<void> {
    const queueEntry = this.queueEntries.get(userId)
    if (!queueEntry?.matchId) {
      throw new MatchmakingServiceError(
        MatchmakingServiceErrorCode.NoActiveMatch,
        'No active match found',
      )
    }

    const match = this.matches.get(queueEntry.matchId)
    if (!match) {
      throw new MatchmakingServiceError(
        MatchmakingServiceErrorCode.NoActiveMatch,
        'Match no longer exists',
      )
    }

    const draftState = match.getDraftState()
    if (!draftState) {
      throw new MatchmakingServiceError(
        MatchmakingServiceErrorCode.NoActiveDraft,
        'No active draft found',
      )
    }

    draftState.lockInPick(userId, race)
  }

  async sendDraftChatMessage(userId: SbUserId, message: string): Promise<void> {
    const queueEntry = this.queueEntries.get(userId)
    if (!queueEntry?.matchId) {
      throw new MatchmakingServiceError(
        MatchmakingServiceErrorCode.NoActiveMatch,
        'No active match found',
      )
    }

    const match = this.matches.get(queueEntry.matchId)
    if (!match) {
      throw new MatchmakingServiceError(
        MatchmakingServiceErrorCode.NoActiveMatch,
        'Match no longer exists',
      )
    }

    const draftState = match.getDraftState()
    if (!draftState) {
      throw new MatchmakingServiceError(
        MatchmakingServiceErrorCode.NoActiveDraft,
        'No active draft found',
      )
    }

    const isChatRestricted = await this.restrictionService.isRestricted(
      userId,
      RestrictionKind.Chat,
    )
    if (isChatRestricted) {
      throw new MatchmakingServiceError(
        MatchmakingServiceErrorCode.UserChatRestricted,
        'User is chat restricted',
      )
    }

    await draftState.sendChatMessage(userId, message)
  }

  /**
   * Register that a player left a party. If that party is currently queued, we treat this like a
   * disconnect.
   */
  registerPartyLeave(userId: SbUserId, partyId: string): void {
    const queueEntry = this.queueEntries.get(userId)
    if (queueEntry?.partyId === partyId) {
      this.removeClientFromMatchmaking(this.activityRegistry.getClientForUser(userId)!, false)
    }
  }

  private async retrieveMmr(
    userId: SbUserId,
    type: MatchmakingType,
    season: MatchmakingSeason,
    identifiers: ReadonlyArray<ClientIdentifierString>,
  ): Promise<MatchmakingRating> {
    let currentMmr = await getMatchmakingRating(userId, type, season.id)
    if (!currentMmr) {
      const sameUsers = await this.userIdentifierManager.findUsersWithIdentifiers(identifiers)
      currentMmr = await createInitialMatchmakingRating(userId, type, season, sameUsers)
    }

    return adjustMatchmakingRatingForInactivity(currentMmr, new Date(this.clock.now()))
  }

  private subscribeUserToQueueUpdates(
    userSockets: UserSocketsGroup,
    clientSockets: ClientSocketsGroup,
    matchmakingType: MatchmakingType,
    race: RaceChar,
  ): void {
    userSockets.subscribe<MatchmakingEvent>(getMatchmakingUserPath(userSockets.userId), () => {
      return {
        type: 'queueStatus',
        matchmaking: { type: matchmakingType },
      }
    })
    clientSockets.subscribe<MatchmakingEvent>(
      getMatchmakingClientPath(clientSockets),
      () => ({
        type: 'startSearch',
        matchmakingType,
        race,
      }),
      sockets => this.removeClientFromMatchmaking(sockets, true),
    )
  }

  private async runMatch(matchId: string) {
    const match = this.matches.get(matchId)!
    let phase: 'accepting' | 'drafting' | 'loading' = 'accepting'

    const activeClients = new Map<SbUserId, ClientSocketsGroup>()

    try {
      for (const p of match.players()) {
        const client = this.activityRegistry.getClientForUser(p.id)
        if (!client) {
          // Client disconnected before we got here
          // NOTE(tec27): `match.acceptStateChanged` will immediately throw below after this
          match.registerDecline(p.id)
          continue
        }
        activeClients.set(p.id, client)
        client.subscribe<MatchmakingEvent>(getMatchPath(match.id))
      }

      const mapPromise = pickMap(match.type, match.teams.flat())

      while (match.numAccepted < match.totalPlayers) {
        await match.acceptStateChanged

        for (const p of match.players()) {
          this.publishToActiveClient(p.id, {
            type: 'playerAccepted',
            acceptedPlayers: match.numAccepted,
          })
        }
      }

      const mapInfo = await mapPromise
      phase = 'drafting'
      await match.runDraft(activeClients, mapInfo)

      phase = 'loading'
      await this.doGameLoad(match)
    } catch (err: any) {
      if (!isAbortError(err) && !(err instanceof MatchmakingServiceError)) {
        logger.error({ err }, 'error while processing match')
      }

      const [toKick, toBan, toRequeue] = match.getKicksBansAndRequeues()

      const entities = match.teams.flat()

      for (const id of toKick) {
        const entity = entities.find(entity => getMatchmakingEntityId(entity) === id)!
        for (const p of getPlayersFromEntity(entity)) {
          this.queueEntries.delete(p.id)
          if (phase === 'accepting') {
            this.publishToActiveClient(p.id, {
              type: 'acceptTimeout',
            })
          } else if (phase === 'drafting') {
            this.publishToActiveClient(p.id, {
              type: 'draftCancel',
            })
          } else if (phase === 'loading') {
            this.publishToActiveClient(p.id, {
              type: 'cancelLoading',
              reason: 'loading failed',
            })
          }
          this.unregisterActivity(p.id)
        }
      }

      const matchPlayers = Array.from(match.players())
      // NOTE(tec27): Unlike toKick/toRequeue, these are just raw user IDs and don't correspond to
      // an entity, we can use them directly
      for (const id of toBan) {
        // Just make extra certain we've removed the queue entry for this player
        this.queueEntries.delete(id)
        this.unregisterActivity(id)

        const player = matchPlayers.find(p => p.id === id)
        if (!player) {
          logger.error(
            { err: new Error(`Tried to ban user ${id} but they were not in the match`) },
            'error processing matchmaking bans',
          )
          continue
        }
        // NOTE(tec27): We only ban the current identifiers and not all connected identifiers, to
        // reduce the potential risk of a user on a shared machine getting a ton of people banned
        // at once. We store the user ID alongside these anyway so at the very least this account
        // should always be hit by the ban.
        this.matchmakingBanService.banUser(player.id, player.identifiers).catch(err => {
          logger.error({ err }, 'error while issuing matchmaking ban to user')
        })
        // We expect that the ban service will notify them of the ban so we don't need to tell them
        // more here
      }

      for (const id of toRequeue) {
        const entity = entities.find(entity => getMatchmakingEntityId(entity) === id)!
        let playerMissing = false

        for (const p of getPlayersFromEntity(entity)) {
          const queueEntry = this.queueEntries.get(p.id)
          if (!queueEntry) {
            // This client must have disconnected/left
            playerMissing = true
            continue
          }

          queueEntry.matchId = undefined

          if (phase === 'drafting') {
            this.publishToActiveClient(p.id, {
              type: 'draftCancel',
            })
          } else if (phase === 'loading') {
            this.publishToActiveClient(p.id, {
              type: 'cancelLoading',
              reason: 'loading failed',
            })
          }

          this.publishToActiveClient(p.id, {
            type: 'requeue',
          })
        }

        if (!playerMissing) {
          // Generate a writable version of the MatchmakingEntity
          const newQueueEntry = {
            ...entity,
          }

          this.matchmakers.get(match.type)!.addToQueue(newQueueEntry)
        }
      }
    } finally {
      for (const client of activeClients.values()) {
        client.unsubscribe(getMatchPath(match.id))
      }
      this.matches.delete(match.id)
    }
  }

  private async doGameLoad(match: Match) {
    let slots: Slot[]
    let playerInfos: PlayerInfo[]
    let teams: GameConfigPlayer[][]
    const players = Array.from(match.players())
    const clients: ClientSocketsGroup[] = []
    let declined = false
    for (const p of players) {
      const client = this.activityRegistry.getClientForUser(p.id)
      if (!client) {
        match.registerDecline(p.id)
        declined = true
      } else {
        clients.push(client)
      }
    }
    if (declined) {
      throw new MatchmakingServiceError(
        MatchmakingServiceErrorCode.ClientDisconnected,
        'client disconnected before game load',
      )
    }

    if (match.type === MatchmakingType.Match1v1 || match.type === MatchmakingType.Match1v1Fastest) {
      const firstPlayer = players[0]
      // NOTE(tec27): alternate race selection is not available for random users. We block this
      // from being set elsewhere, but ignore it here just in case
      const playersHaveSameRace =
        firstPlayer.race !== 'r' && players.every(p => p.race === firstPlayer.race)
      if (playersHaveSameRace && players.every(p => p.preferenceData.useAlternateRace === true)) {
        // All players have the same race and all of them want to use an alternate race: select
        // one of the players randomly to play their alternate race, leaving the other player to
        // play their main race.
        const randomPlayerIndex = randomInt(0, players.length)
        slots = players.map((p, i) =>
          createHuman(p.id, i === randomPlayerIndex ? p.preferenceData.alternateRace : p.race),
        )
      } else if (
        playersHaveSameRace &&
        players.some(p => p.preferenceData.useAlternateRace === true)
      ) {
        // All players have the same main race and one of them wants to use an alternate race
        slots = players.map(p =>
          createHuman(
            p.id,
            p.preferenceData.useAlternateRace ? p.preferenceData.alternateRace : p.race,
          ),
        )
      } else {
        // No alternate race selection, so everyone gets their selected race
        slots = players.map(p => createHuman(p.id, p.race))
      }

      playerInfos = slots.map(s => ({
        id: s.id,
        userId: s.userId,
        race: s.race,
        playerId: s.playerId,
        teamId: 0,
        type: s.type,
        typeId: s.typeId,
      }))
      teams = [
        slots.map(s => ({
          id: s.userId ?? makeSbUserId(0),
          race: s.race,
          isComputer: s.type === SlotType.Computer || s.type === SlotType.UmsComputer,
        })),
      ]
    } else {
      // For team modes, use draft results if available, otherwise use original race selections
      const draftState = match.getDraftState()
      const finalRaces = draftState?.getFinalRaces()

      const slotsInTeams = match.teams.map(team =>
        team.flatMap(entity =>
          Array.from(getPlayersFromEntity(entity), p =>
            createHuman(p.id, finalRaces?.get(p.id) ?? p.race),
          ),
        ),
      )
      slots = slotsInTeams.flat()
      playerInfos = slotsInTeams.flatMap((t, i) =>
        t.map(s => ({
          id: s.id,
          userId: s.userId,
          race: s.race,
          playerId: s.playerId,
          teamId: i,
          type: s.type,
          typeId: s.typeId,
        })),
      )
      teams = slotsInTeams.map(t =>
        t.map(s => ({
          id: s.userId ?? makeSbUserId(0),
          race: s.race,
          isComputer: s.type === SlotType.Computer || s.type === SlotType.UmsComputer,
        })),
      )
    }

    const entities = match.teams.flat()
    const chosenMap = await pickMap(match.type, entities)

    let gameSourceExtra: MatchmakingExtra
    switch (match.type) {
      case MatchmakingType.Match1v1:
      case MatchmakingType.Match1v1Fastest:
        gameSourceExtra = {
          type: match.type,
        }
        break
      case MatchmakingType.Match2v2:
        gameSourceExtra = {
          type: match.type,
          parties: entities.map(entity => Array.from(getPlayersFromEntity(entity), p => p.id)),
        }
        break
      default:
        gameSourceExtra = assertUnreachable(match.type)
    }

    let gameType: GameType
    let gameSubType: number
    switch (match.type) {
      case MatchmakingType.Match1v1:
      case MatchmakingType.Match1v1Fastest:
        gameType = GameType.OneVsOne
        gameSubType = 0
        break
      case MatchmakingType.Match2v2:
        gameType = GameType.TopVsBottom
        gameSubType = TEAM_SIZES[match.type]
        break
      default:
        gameType = assertUnreachable(match.type)
        gameSubType = 0
    }

    const gameConfig: GameConfig = {
      gameType,
      gameSubType,
      gameSource: GameSource.Matchmaking,
      gameSourceExtra,
      teams,
    }

    const ratings = match.teams.flatMap(team =>
      team.flatMap(entities =>
        Array.from(
          getPlayersFromEntity(entities),
          p => [p.id, p.rating] as [id: SbUserId, rating: number],
        ),
      ),
    )

    for (const client of clients) {
      this.publishToActiveClient(client.userId, { type: 'matchReady' })
    }

    const loadResult = await this.gameLoader.loadGame({
      players: slots,
      playerInfos,
      mapId: chosenMap.id,
      gameConfig,
      ratings,
    })

    if (loadResult.isError()) {
      if (loadResult.error.code === GameLoadErrorType.Timeout) {
        for (const user of loadResult.error.data.unloaded) {
          match.markForBan(user)
        }
      } else if (loadResult.error.code === GameLoadErrorType.PlayerFailed) {
        match.markForBan(loadResult.error.data.userId)
      }

      throw new MatchmakingServiceError(
        MatchmakingServiceErrorCode.LoadFailed,
        'Game load failed',
        { cause: loadResult.error },
      )
    }

    for (const player of match.players()) {
      this.queueEntries.delete(player.id)
    }
    for (const client of clients) {
      this.publishToActiveClient(client.userId, { type: 'gameStarted' })
      // TODO(tec27): Should this be maintained until the client reports game exit instead?
      this.unregisterActivity(client.userId)
    }
  }

  private unregisterActivity(userId: SbUserId) {
    const activeClient = this.activityRegistry.getClientForUser(userId)
    this.activityRegistry.unregisterClientForUser(userId)
    this.publishToUser(userId, {
      type: 'queueStatus',
      matchmaking: undefined,
    })

    const userSockets = this.userSocketsManager.getById(userId)
    userSockets?.unsubscribe(getMatchmakingUserPath(userId))
    activeClient?.unsubscribe(getMatchmakingClientPath(activeClient))
  }

  private removeClientFromMatchmaking(client: ClientSocketsGroup, isDisconnect = true) {
    // NOTE(2Pac): Client can leave, i.e. disconnect, while searching, accepting, drafting, or
    // while loading
    const entry = this.queueEntries.get(client.userId)
    const toUnregister = [client.userId]
    // If we didn't find an entry, this client wasn't actually in matchmaking (probably already
    // got removed just before this)
    if (entry) {
      this.queueEntries.delete(client.userId)

      const entity = this.matchmakers.get(entry.type)!.removeFromQueue(entry.registeredId)
      if (entity) {
        toUnregister.length = 0
        for (const player of getPlayersFromEntity(entity)) {
          toUnregister.push(player.id)
          this.queueEntries.delete(player.id)

          insertMatchmakingCompletion({
            userId: player.id,
            matchmakingType: entry.type,
            completionType: isDisconnect
              ? MatchmakingCompletionType.Disconnect
              : MatchmakingCompletionType.Cancel,
            searchTimeMillis: entity.searchIterations * MATCHMAKING_INTERVAL_MS,
            completionTime: new Date(this.clock.now()),
          }).catch(err => logger.error({ err }, 'error while logging matchmaking completion'))
        }

        this.matchSearchTimeMetric
          .labels(
            entry.type,
            String(getNumPlayersInEntity(entity)),
            isDisconnect ? MatchmakingCompletionType.Disconnect : MatchmakingCompletionType.Cancel,
          )
          .observe((entity.searchIterations * MATCHMAKING_INTERVAL_MS) / 1000)
        this.matchRequestsCanceledMetric
          .labels(entry.type, String(getNumPlayersInEntity(entity)))
          .inc()
      }

      if (entry.matchId) {
        this.matches.get(entry.matchId)?.registerDecline(client.userId)
      }
    }

    for (const userId of toUnregister) {
      this.unregisterActivity(userId)
    }
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
    this.publisher.publish(getMatchmakingUserPath(userId), data)
  }

  private publishToActiveClient(userId: SbUserId, data?: ReadonlyDeep<MatchmakingEvent>): boolean {
    const client = this.activityRegistry.getClientForUser(userId)
    if (client) {
      this.publisher.publish(getMatchmakingClientPath(client), data)
      return true
    } else {
      return false
    }
  }
}
