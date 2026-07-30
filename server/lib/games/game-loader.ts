import { Map as IMap, Set as ISet, Record } from 'immutable'
import { Counter } from 'prom-client'
import { singleton } from 'tsyringe'
import { AsyncResult, Result } from 'typescript-result'
import createDeferred, { Deferred } from '../../../common/async/deferred'
import { extendableDeadline } from '../../../common/async/extendable-deadline'
import { GameServerRegionId } from '../../../common/game-server-regions'
import { GameConfig, GameSource } from '../../../common/games/configuration'
import { GameSetup, PlayerInfo } from '../../../common/games/game-launch-config'
import { GameLoaderEvent } from '../../../common/games/game-loader-network'
import { MapInfo, SbMapId, toMapInfoJson } from '../../../common/maps'
import { BwTurnRate, BwUserLatency } from '../../../common/network'
import { urlPath } from '../../../common/urls'
import { RestrictionKind } from '../../../common/users/restrictions'
import { SbUser } from '../../../common/users/sb-user'
import { SbUserId } from '../../../common/users/sb-user-id'
import { CodedError } from '../errors/coded-error'
import log from '../logging/logger'
import { getMapInfos } from '../maps/map-models'
import { deleteUserRecordsForGame } from '../models/games-users'
import { NetcodeV2Service } from '../netcode-v2/netcode-v2-service'
import { RestrictionService } from '../users/restriction-service'
import { findUsersById } from '../users/user-model'
import { TypedPublisher } from '../websockets/typed-publisher'
import { deleteRecordForGame, updateGameConfig } from './game-models'
import { GameplayActivityRegistry } from './gameplay-activity-registry'
import { registerGame } from './registration'

const GAME_LOAD_TIMEOUT = 75 * 1000

/**
 * Extra time added once to a load's deadline when the coordinator reports it's still provisioning a
 * game server. The base timeout matches the coordinator's provisioning-hold cap, so a load that
 * waits out a full provision would otherwise trip the timeout before the game itself begins loading.
 */
const PROVISIONING_LOAD_TIMEOUT_EXTENSION_MS = 90 * 1000

export enum GameLoadErrorType {
  /** The game load request was canceled before it completed. */
  Canceled = 'canceled',
  /** An internal error occurred while trying to load the game. */
  Internal = 'internal',
  /** A specific player failed to load. */
  PlayerFailed = 'playerFailed',
  /** Loading the game timed out before it finished. */
  Timeout = 'timeout',
}

type GameLoadErrorTypeToData = {
  [GameLoadErrorType.PlayerFailed]: {
    userId: SbUserId
  }
  [GameLoadErrorType.Timeout]: {
    unloaded: SbUserId[]
  }

  [GameLoadErrorType.Canceled]: undefined
  [GameLoadErrorType.Internal]: undefined
}

export class BaseGameLoaderError<
  T extends GameLoadErrorType = GameLoadErrorType,
> extends CodedError<T, GameLoadErrorTypeToData[T]> {}

export type GameLoaderError =
  | BaseGameLoaderError<GameLoadErrorType.Canceled>
  | BaseGameLoaderError<GameLoadErrorType.Internal>
  | BaseGameLoaderError<GameLoadErrorType.PlayerFailed>
  | BaseGameLoaderError<GameLoadErrorType.Timeout>

export function isGameLoaderError(err: unknown): err is GameLoaderError {
  return err instanceof BaseGameLoaderError
}

function generateSeed() {
  // BWChart and some other replay sites/libraries utilize the random seed as the date the game was
  // played, so we match BW's random seed method (time()) here
  return (Date.now() / 1000) | 0
}

/** Resolved value of a successful `GameLoader.loadGame`. */
export interface GameLoadResult {
  /** The ID of the game record that was created and successfully loaded. */
  gameId: string
}

/**
 * A human participant in a game being loaded. This is everything the loader itself needs to know
 * about a player; whatever richer model a caller has (lobby slots, matchmaking entities, ...) is
 * mapped into this at the call site. Per-slot data the game process needs but the loader only
 * passes through lives on `GameLoadRequest.playerInfos` instead.
 */
export interface GameLoadPlayer {
  /** The user occupying this spot in the game. */
  readonly userId: SbUserId
  /**
   * Whether this player watches rather than plays. Observers load the game and get a netcode v2
   * slot like anyone else, but are excluded from the relay's desync comparison.
   */
  readonly isObserver: boolean
  /**
   * The home game-server region this player selected, if any. Forwarded to the coordinator to home
   * this player's netcode v2 relay; a player with none is placed region-blind.
   */
  readonly region?: GameServerRegionId
  /**
   * This player's measured round-trip time (ms) to their home region, if recorded. Read when
   * building the netcode v2 session-create roster, alongside `region`. A player with no value is
   * forwarded to the coordinator without a latency sample.
   */
  readonly rttMs?: number
  /**
   * This player's per-session netcode v2 public key (base64), submitted at queue/lobby-join time.
   * Threaded per-slot into the netcode v2 session-create request. Required for every human slot of
   * a multi-human (netcode v2) game — a missing value fails the load fast rather than waiting.
   */
  readonly netcodeV2Pubkey?: string
}

const createLoadingData = Record({
  gameSource: GameSource.Lobby,
  players: [] as ReadonlyArray<GameLoadPlayer>,
  finishedPlayers: ISet<SbUserId>(),
  abortController: null as unknown as AbortController,
  deferred: null as unknown as Deferred<Result<GameLoadResult, GameLoaderError>>,
  signal: null as unknown as AbortSignal,
  /** Pushes the load's timeout deadline further out. Defaults to a no-op until a deadline is armed. */
  extendDeadline: ((_ms: number) => {}) as (ms: number) => void,
})

type LoadingData = ReturnType<typeof createLoadingData>

const LoadingDatas = {
  isAllFinished(loadingData: LoadingData) {
    return loadingData.players.every(p => loadingData.finishedPlayers.has(p.userId))
  },
}

/**
 * Parameters to `GameLoader.loadGame`.
 */
export interface GameLoadRequest {
  /**
   * The players that should be created as human (or observer) type slots. At least one player
   * should be present for things to work properly. The order is preserved when assigning netcode v2
   * slots (aside from the host, who is always moved to slot 0).
   */
  players: ReadonlyArray<GameLoadPlayer>
  /**
   * A list of the info about each slot in the map/lobby. This is only really useful data for UMS
   * lobbies, where slots may have different types, there might be hidden computer slots, etc. For
   * a lobby, see `getPlayerInfos(Lobby)`. A caller with a richer player model (e.g. matchmaking's
   * team assignments) builds `players` and `playerInfos` side by side from it.
   */
  playerInfos: PlayerInfo[]
  /**
   * The ID of the map that the game will be played on.
   */
  mapId: SbMapId
  /**
   * Configuration info for the game.
   */
  gameConfig: GameConfig
  /**
   * Optional list of rating entries for each player in the game. This only need to be provided for
   * matchmaking games.
   */
  ratings?: Array<[id: SbUserId, rating: number]>
  /** An `AbortSignal` that can be used to cancel the loading process midway through. */
  signal?: AbortSignal
}

function gameUserPath(gameId: string, userId: SbUserId) {
  return urlPath`/gameLoader/${gameId}/${userId}`
}

/** Returns the `GameSetup` for a game without any user-specific data. */
function getGeneralGameSetup({
  gameConfig,
  playerInfos,
  users,
  ratings,
  map,
  gameId,
  seed,
  turnRate,
  userLatency,
}: {
  gameConfig: GameConfig
  playerInfos: PlayerInfo[]
  users: SbUser[]
  ratings?: Array<[id: SbUserId, rating: number]>
  map: MapInfo
  gameId: string
  seed: number
  turnRate: BwTurnRate | 0 | undefined
  userLatency: BwUserLatency | undefined
}): Exclude<GameSetup, 'resultCode'> {
  if (gameConfig.gameSource === GameSource.Lobby) {
    // NOTE(tec27): For launching lobbies this should now always be set (the optional bit is just
    // for DB-stored configs), but we fall back to the first human player just in case
    let host: PlayerInfo | undefined
    if (gameConfig.gameSourceExtra?.host) {
      host = playerInfos.find(p => p.userId === gameConfig.gameSourceExtra!.host)
    }
    if (!host) {
      host = playerInfos.find(p => p.type === 'human' && p.userId)!
    }

    return {
      gameId,
      name: 'ShieldBattery Lobby',
      map: toMapInfoJson(map),
      gameType: gameConfig.gameType,
      gameSubType: gameConfig.gameSubType,
      slots: playerInfos,
      host,
      users,
      seed,
      turnRate,
      userLatency,
      useLegacyLimits: gameConfig.gameSourceExtra?.useLegacyLimits,
      disableAllianceChanges: gameConfig.lockedAlliances,
    }
  } else if (gameConfig.gameSource === GameSource.Matchmaking) {
    return {
      gameId,
      name: 'ShieldBattery Matchmaking',
      map: toMapInfoJson(map),
      gameType: gameConfig.gameType,
      gameSubType: gameConfig.gameSubType,
      slots: playerInfos,
      host: playerInfos[0],
      users,
      ratings,
      // Matchmaking always locks alliances; fall back to that if a caller ever constructs a
      // matchmaking config without setting the field explicitly.
      disableAllianceChanges: gameConfig.lockedAlliances ?? true,
      seed,
      turnRate,
      userLatency,
    }
  } else {
    return gameConfig satisfies never
  }
}

@singleton()
export class GameLoader {
  // Maps game id -> loading data
  private loadingGames = IMap<string, LoadingData>()
  private recentlyLoadedGames = new Set<string>()

  private gameLoadRequestsTotalMetric = new Counter({
    name: 'shieldbattery_game_loader_requests_total',
    labelNames: ['game_source'],
    help: 'Total number of game load requests',
  })
  private gameLoadFailuresTotalMetric = new Counter({
    name: 'shieldbattery_game_loader_failures_total',
    // TODO(tec27): Add failure types?
    labelNames: ['game_source'],
    help: 'Total number of game load requests that failed',
  })
  private gameLoadSuccessesTotalMetric = new Counter({
    name: 'shieldbattery_game_loader_successes_total',
    labelNames: ['game_source'],
    help: 'Total number of game load requests that succeeded',
  })

  constructor(
    private publisher: TypedPublisher<GameLoaderEvent>,
    private activityRegistry: GameplayActivityRegistry,
    private restrictionService: RestrictionService,
    private netcodeV2Service: NetcodeV2Service,
  ) {}

  /**
   * Starts the process of loading a new game.
   *
   * @returns A promise which will resolve with the list of players if the game successfully loaded,
   *   or be rejected if the load failed.
   */
  loadGame({
    players,
    playerInfos,
    mapId,
    gameConfig,
    ratings,
    signal,
  }: GameLoadRequest): AsyncResult<GameLoadResult, GameLoaderError> {
    const gameLoaded = createDeferred<Result<GameLoadResult, GameLoaderError>>()

    this.gameLoadRequestsTotalMetric.labels(gameConfig.gameSource).inc()

    registerGame(mapId, gameConfig).then(
      ({ gameId, resultCodes }) => {
        const abortController = new AbortController()
        const deadline = extendableDeadline(gameLoaded, GAME_LOAD_TIMEOUT, 'game load timed out')
        this.loadingGames = this.loadingGames.set(
          gameId,
          createLoadingData({
            gameSource: gameConfig.gameSource,
            players: [...players],
            abortController,
            deferred: gameLoaded,
            signal: signal
              ? AbortSignal.any([signal, abortController.signal])
              : abortController.signal,
            extendDeadline: deadline.extend,
          }),
        )

        this.doGameLoad({
          gameId,
          mapId,
          gameConfig,
          resultCodes,
          playerInfos,
          ratings,
        }).onFailure(err => {
          this.maybeCancelLoadingFromSystem(gameId, err)
        })

        deadline.expired.catch(() => {
          const loadingData = this.loadingGames.get(gameId)
          if (!loadingData) {
            // Something else must have already dealt with it
            return
          }

          const unloaded = []
          if (loadingData.finishedPlayers.size >= Math.floor(loadingData.players.length / 2)) {
            // If at least half the players have finished loading, mark the rest of them as failed
            // since that can only really happen if some players failed to report a status or
            // crashed on game start.
            for (const p of loadingData.players) {
              if (!loadingData.finishedPlayers.has(p.userId)) {
                unloaded.push(p.userId)
              }
            }
          }

          this.maybeCancelLoadingFromSystem(
            gameId,
            new BaseGameLoaderError(GameLoadErrorType.Timeout, 'game load timed out', {
              data: {
                // TODO(tec27): Better determine who is at fault here. Currently we don't get enough
                // information from clients about their loading state (just that their game is
                // started or errored) so timeouts often result in all players being seen
                // as at fault. We should send all the intermediate statuses from the game
                // (configuring, setting up, etc.) so that we can see who is behind the rest and
                // put the blame on them. (There we still likely be a lot of cases where no one
                // in particular is to blame, though)
                unloaded,
              },
            }),
          )
        })
      },
      err => {
        log.error({ err }, "couldn't register game with database")
        // NOTE(tec27): We haven't registered the game in `loadingGames` yet by this point so we
        // can't cancel it that way
        gameLoaded.resolve(
          Result.error(
            new BaseGameLoaderError(
              GameLoadErrorType.Internal,
              "Couldn't register game with database",
            ),
          ),
        )
      },
    )

    Result.fromAsync(() => gameLoaded)
      .onSuccess(() => {
        this.gameLoadSuccessesTotalMetric.labels(gameConfig.gameSource).inc()
      })
      .onFailure(() => {
        this.gameLoadFailuresTotalMetric.labels(gameConfig.gameSource).inc()
      })

    return Result.fromAsync(() => gameLoaded)
  }

  /**
   * The game has successfully loaded for a specific player. Once the game is loaded for all
   * players, we clean up any remaining state to prevent it from being canceled.
   *
   * @returns whether the relevant game could be found
   */
  registerGameAsLoaded(gameId: string, playerId: SbUserId): boolean {
    if (this.recentlyLoadedGames.has(gameId)) {
      // This is just to prevent an erroneous 404/409 resulting from retrying game status updates
      return true
    }

    if (!this.loadingGames.has(gameId)) {
      return false
    }

    let loadingData = this.loadingGames.get(gameId)!
    if (!loadingData.players.some(p => p.userId === playerId)) {
      return false
    }

    loadingData = loadingData.set('finishedPlayers', loadingData.finishedPlayers.add(playerId))
    this.loadingGames = this.loadingGames.set(gameId, loadingData)

    if (LoadingDatas.isAllFinished(loadingData)) {
      const allUserIds = loadingData.players.map(p => p.userId)
      const activeClients = allUserIds
        .map(userId => this.activityRegistry.getClientForUser(userId))
        .filter(c => !!c)
      for (const client of activeClients) {
        client.unsubscribe(gameUserPath(gameId, client.userId))
      }

      this.recentlyLoadedGames.add(gameId)
      this.loadingGames = this.loadingGames.delete(gameId)
      loadingData.deferred.resolve(Result.ok({ gameId }))

      setTimeout(() => {
        this.recentlyLoadedGames.delete(gameId)
      }, 60000)
    }

    return true
  }

  /**
   * Cancels the loading state of the game if it was loading (no-op if it was not).
   *
   * @returns whether the relevant game could be found
   */
  maybeCancelLoading(gameId: string, playerId: SbUserId): boolean {
    if (!this.loadingGames.has(gameId)) {
      return false
    }

    const loadingData = this.loadingGames.get(gameId)!
    const loadingPlayer = loadingData.players.find(p => p.userId === playerId)
    if (!loadingPlayer) {
      return false
    }

    return this.maybeCancelLoadingFromSystem(
      gameId,
      new BaseGameLoaderError(GameLoadErrorType.PlayerFailed, `User ${playerId} failed to load`, {
        data: { userId: playerId },
      }),
    )
  }

  private maybeCancelLoadingFromSystem(gameId: string, reason: GameLoaderError) {
    if (!this.loadingGames.has(gameId)) {
      return false
    }

    log.info({ err: reason }, `cancelling game load for ${gameId}: ${reason.message}`)

    const loadingData = this.loadingGames.get(gameId)!

    const allUserIds = loadingData.players.map(p => p.userId)
    const activeClients = allUserIds
      .map(userId => this.activityRegistry.getClientForUser(userId))
      .filter(c => !!c)
    for (const userId of allUserIds) {
      this.publisher.publish(gameUserPath(gameId, userId), {
        type: 'cancelLoading',
        gameId,
      })
    }

    Promise.resolve()
      .then(() => {
        for (const client of activeClients) {
          client.unsubscribe(gameUserPath(gameId, client.userId))
        }
      })
      .catch(err => {
        log.error({ err }, 'error unsubscribing client')
      })

    this.loadingGames = this.loadingGames.delete(gameId)
    loadingData.abortController.abort()
    loadingData.deferred.resolve(Result.error(reason))

    Promise.all([deleteRecordForGame(gameId), deleteUserRecordsForGame(gameId)]).catch(err => {
      log.error({ err }, 'error removing game records for cancelled game')
    })

    return true
  }

  /**
   * Runs once per load, the first time the coordinator reports a game server is still being
   * provisioned: tells every player a game server is coming up and extends the load deadline so
   * waiting out the provision doesn't trip the base timeout. The regions being provisioned are
   * logged but never sent to players — server locations hint at where the other players are, and
   * exposing that pre-game invites prejudging or dodging the match.
   */
  private handleGameServerProvisioning(gameId: string, regions: string[]): void {
    const loadingData = this.loadingGames.get(gameId)
    if (!loadingData) {
      return
    }

    log.info(`game server still provisioning for ${gameId} in: ${regions.join(', ')}`)
    for (const player of loadingData.players) {
      this.publisher.publish(gameUserPath(gameId, player.userId), {
        type: 'setLoadingStatus',
        gameId,
        status: 'provisioningGameServer',
      })
    }
    loadingData.extendDeadline(PROVISIONING_LOAD_TIMEOUT_EXTENSION_MS)
  }

  isLoadingOrRecentlyLoaded(gameId: string) {
    return this.loadingGames.has(gameId) || this.recentlyLoadedGames.has(gameId)
  }

  isLoading(gameId: string) {
    return this.loadingGames.has(gameId)
  }

  private doGameLoad({
    gameId,
    mapId,
    gameConfig,
    resultCodes,
    playerInfos,
    ratings,
  }: {
    gameId: string
    mapId: SbMapId
    gameConfig: GameConfig
    resultCodes: Map<SbUserId, string>
    playerInfos: PlayerInfo[]
    ratings?: Array<[id: SbUserId, rating: number]>
  }): AsyncResult<void, GameLoaderError> {
    return Result.fromAsync(async () => {
      if (!this.loadingGames.has(gameId)) {
        return Result.error(
          new BaseGameLoaderError(
            GameLoadErrorType.Internal,
            `tried to load a game that doesn't exist: ${gameId}`,
          ),
        )
      }

      const mapPromise = Result.try(() => getMapInfos([mapId]))

      const loadingData = this.loadingGames.get(gameId)!
      const { players, signal } = loadingData
      const allUserIds = players.map(p => p.userId)

      const usersResult = Result.try(() => findUsersById(allUserIds))
      const chatRestrictedResult = Result.try(() =>
        this.restrictionService.checkMultipleRestrictions(allUserIds, RestrictionKind.Chat),
      )

      const [activeClients, activeClientsError] = Result.all(
        ...allUserIds.map(userId => {
          const client = this.activityRegistry.getClientForUser(userId)
          if (!client) {
            return Result.error(
              new BaseGameLoaderError(
                GameLoadErrorType.PlayerFailed,
                'a player had no active client',
                {
                  data: { userId },
                },
              ),
            )
          }
          return Result.ok(client)
        }),
      ).toTuple()

      if (activeClientsError) {
        return Result.error(activeClientsError)
      }

      const [users, usersError] = await usersResult.toTuple()
      if (usersError || users.length !== players.length) {
        return Result.error(
          new BaseGameLoaderError(
            GameLoadErrorType.Internal,
            "couldn't find all users in the game",
          ),
        )
      }

      for (const client of activeClients) {
        client.subscribe(gameUserPath(gameId, client.userId), undefined, () => {
          this.maybeCancelLoadingFromSystem(
            gameId,
            new BaseGameLoaderError(
              GameLoadErrorType.PlayerFailed,
              'a player disconnected while loading',
              { data: { userId: client.userId } },
            ),
          )
        })
      }

      const hasMultipleHumans = players.length > 1
      if (hasMultipleHumans && !this.netcodeV2Service.isEnabled()) {
        return Result.error(
          new BaseGameLoaderError(
            GameLoadErrorType.Internal,
            'netcode v2 is not configured on this server; multiplayer games cannot load without it',
          ),
        )
      }
      const useNetcodeV2 = hasMultipleHumans
      // Persisted onto the game's config so later readers (e.g. result reconciliation deciding
      // whether a game's result can only arrive via the relay, see `usedNetcodeV2`) can see it
      // without re-deriving it — this isn't known until now, so it can't be part of the config
      // written at registration time. The write is awaited and fails the load on error, so a lost
      // write can't silently make a netcode-v2 game look like a legacy one to those readers.
      const [, configError] = (
        await Result.fromAsyncCatching(updateGameConfig(gameId, { ...gameConfig, useNetcodeV2 }))
      ).toTuple()
      if (configError) {
        return Result.error(
          new BaseGameLoaderError(GameLoadErrorType.Internal, 'error persisting game config', {
            cause: configError,
          }),
        )
      }

      // The relay resizes its latency buffer on the fly to match live network conditions, and DTR
      // (turn rate 0) can't work at all since the relay seam strips the turn-rate commands it
      // relies on — so every game always runs the best turn rate and lets the relay (or, for a
      // solo game, the lack of any peer at all) absorb latency.
      const chosenTurnRate: BwTurnRate = 24
      const chosenUserLatency: BwUserLatency = BwUserLatency.Low

      const [maps, mapError] = await mapPromise.toTuple()
      if (mapError || !maps.length) {
        return Result.error(
          new BaseGameLoaderError(
            GameLoadErrorType.Internal,
            `Couldn't find map with ID ${mapId}`,
            {
              cause: mapError,
            },
          ),
        )
      }
      if (signal.aborted) {
        return Result.error(
          new BaseGameLoaderError(GameLoadErrorType.Canceled, 'game load was canceled'),
        )
      }
      const [map] = maps

      const [chatRestrictions, chatRestrictionsError] = await chatRestrictedResult.toTuple()
      const restrictionsSet = new global.Set<SbUserId>()
      if (chatRestrictionsError) {
        log.error({ err: chatRestrictionsError }, 'error checking chat restrictions')
      } else {
        for (const u of chatRestrictions) {
          restrictionsSet.add(u)
        }
      }

      const generalSetup = getGeneralGameSetup({
        gameConfig,
        playerInfos,
        users,
        map,
        gameId,
        ratings,
        seed: generateSeed(),
        turnRate: chosenTurnRate,
        userLatency: chosenUserLatency,
      })
      for (const player of players) {
        const userId = player.userId
        this.publisher.publish(gameUserPath(gameId, userId), {
          type: 'setGameConfig',
          gameId,
          setup: {
            ...generalSetup,
            useNetcodeV2,
            resultCode: resultCodes.get(userId)!,
            isChatRestricted: restrictionsSet.has(userId),
          },
        })
      }

      if (useNetcodeV2) {
        // Assign each participant a rally-point2 slot, carrying their per-session pubkey (submitted
        // at queue/lobby-join time), and request the session from the coordinator. Each player gets
        // their own token plus the relay endpoints and the full slot roster. The game process
        // consumes this setup when its game init starts, so it must be published to every player
        // before they can proceed. A slot missing its pubkey fails the session create fast.
        //
        // `players` includes observers alongside playing humans (see `GameLoadRequest.players`'s
        // doc comment), and `GameLoadPlayer.isObserver` distinguishes them, so observer-ness is
        // known here — mark it so the relay's desync comparator can exclude observers from the
        // compared slot set.
        //
        // The host must land at rp2 slot 0: with native-lobby netcode v2, the host creates the
        // game's Storm session, and Storm always assigns its creator slot 0. The game DLL maps
        // BW Storm ids to rp2 slots by identity, so this roster has to agree the host is slot 0 or
        // that mapping breaks. Reuse the host already resolved for `generalSetup` (the same user
        // named in the published `GameSetup.host`) rather than re-deriving it here.
        const hostUserId = generalSetup.host.userId
        const hostPlayer = players.find(p => p.userId === hostUserId)
        let orderedPlayers: ReadonlyArray<GameLoadPlayer>
        if (hostPlayer) {
          orderedPlayers = [hostPlayer, ...players.filter(p => p !== hostPlayer)]
        } else {
          // Shouldn't happen — the host is always a human participant — but don't let it crash the
          // load, just fall back to the unordered assignment.
          log.warn(
            { gameId, hostUserId },
            'netcode v2: host not found among players, using unordered slot assignment',
          )
          orderedPlayers = players
        }
        const slots = orderedPlayers.map((p, slot) => ({
          slot,
          userId: p.userId,
          observer: p.isObserver,
          // The region the player selected when they queued/joined, if any. Forwarded to the
          // coordinator to home this slot's relay; a slot with none falls back region-blind.
          region: p.region,
          // The player's measured round-trip time to that region, if recorded. Combined with every
          // other slot's region/rtt to estimate the session's worst pairwise latency.
          rttMs: p.rttMs,
          // The player's per-session netcode v2 public key, submitted at queue/lobby-join time. The
          // coordinator embeds it in this slot's session token; a slot missing it fails create fast.
          pubkey: p.netcodeV2Pubkey,
        }))
        const [setups, setupsError] = (
          await Result.fromAsyncCatching(
            this.netcodeV2Service.createSessionForGame({
              gameId,
              slots,
              signal,
              onProvisioning: regions => this.handleGameServerProvisioning(gameId, regions),
            }),
          )
        ).toTuple()
        if (setupsError) {
          return Result.error(
            new BaseGameLoaderError(
              GameLoadErrorType.Internal,
              'error creating netcode v2 session',
              {
                cause: setupsError,
              },
            ),
          )
        }

        for (const [userId, setup] of setups) {
          this.publisher.publish(gameUserPath(gameId, userId), {
            type: 'setNetcodeV2Setup',
            gameId,
            setup,
          })
        }
      }

      if (signal.aborted) {
        return Result.error(
          new BaseGameLoaderError(GameLoadErrorType.Canceled, 'game load was canceled'),
        )
      }

      return Result.ok()
    })
  }
}
