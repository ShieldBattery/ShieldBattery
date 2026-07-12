import { Map as IMap, Set as ISet, Record } from 'immutable'
import { Counter } from 'prom-client'
import { singleton } from 'tsyringe'
import { AsyncResult, Result } from 'typescript-result'
import createDeferred, { Deferred } from '../../../common/async/deferred'
import rejectOnTimeout from '../../../common/async/reject-on-timeout'
import { GameConfig, GameSource } from '../../../common/games/configuration'
import { GameSetup, PlayerInfo } from '../../../common/games/game-launch-config'
import { GameLoaderEvent } from '../../../common/games/game-loader-network'
import { Slot, SlotType } from '../../../common/lobbies/slot'
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

const createLoadingData = Record({
  gameSource: GameSource.Lobby,
  players: ISet<Slot>(),
  finishedPlayers: ISet<SbUserId>(),
  abortController: null as unknown as AbortController,
  deferred: null as unknown as Deferred<Result<GameLoadResult, GameLoaderError>>,
  signal: null as unknown as AbortSignal,
})

type LoadingData = ReturnType<typeof createLoadingData>

const LoadingDatas = {
  isAllFinished(loadingData: LoadingData) {
    return loadingData.players.every(p => loadingData.finishedPlayers.has(p.userId!))
  },
}

export interface GameSetupGameInfo {
  gameId: string
  seed: number
  turnRate?: BwTurnRate | 0
  userLatency?: BwUserLatency
  useLegacyLimits?: boolean
}

/**
 * Parameters to `GameLoader.loadGame`.
 */
export interface GameLoadRequest {
  /**
   * A list of players that should be created as human (or observer) type slots. At least one player
   * should be present for things to work properly.
   */
  players: Iterable<Slot>
  /**
   * A list of the info about each slot in the map/lobby. This is only really useful data for UMS
   * lobbies, where slots may have different types, there might be hidden computer slots, etc. For
   * a lobby, see `getPlayerInfos(Lobby)`. For matchmaking this can just be created from `players`
   * directly.
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
        this.loadingGames = this.loadingGames.set(
          gameId,
          createLoadingData({
            gameSource: gameConfig.gameSource,
            players: ISet(players),
            abortController,
            deferred: gameLoaded,
            signal: signal
              ? AbortSignal.any([signal, abortController.signal])
              : abortController.signal,
          }),
        )

        this.doGameLoad({ gameId, mapId, gameConfig, resultCodes, playerInfos, ratings }).onFailure(
          err => {
            this.maybeCancelLoadingFromSystem(gameId, err)
          },
        )

        rejectOnTimeout(gameLoaded, GAME_LOAD_TIMEOUT).catch(() => {
          const loadingData = this.loadingGames.get(gameId)
          if (!loadingData) {
            // Something else must have already dealt with it
            return
          }

          const unloaded = []
          if (loadingData.finishedPlayers.size >= Math.floor(loadingData.players.size / 2)) {
            // If at least half the players have finished loading, mark the rest of them as failed
            // since that can only really happen if some players failed to report a status or
            // crashed on game start.
            for (const p of loadingData.players) {
              if (p.userId && !loadingData.finishedPlayers.has(p.userId)) {
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
      const allUserIds = loadingData.players.map(p => p.userId!).toArray()
      const activeClients = allUserIds
        .map(userId => this.activityRegistry.getClientForUser(userId))
        .filter(c => !!c)
      for (const client of activeClients) {
        client.unsubscribe(gameUserPath(gameId, client.userId))
      }
      this.netcodeV2Service.discardGame(gameId)

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

    const allUserIds = loadingData.players.map(p => p.userId!).toArray()
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
    this.netcodeV2Service.discardGame(gameId)
    loadingData.abortController.abort()
    loadingData.deferred.resolve(Result.error(reason))

    Promise.all([deleteRecordForGame(gameId), deleteUserRecordsForGame(gameId)]).catch(err => {
      log.error({ err }, 'error removing game records for cancelled game')
    })

    return true
  }

  isLoadingOrRecentlyLoaded(gameId: string) {
    return this.loadingGames.has(gameId) || this.recentlyLoadedGames.has(gameId)
  }

  isLoading(gameId: string) {
    return this.loadingGames.has(gameId)
  }

  /** Returns whether `gameId` is currently loading with `userId` as one of its participants. */
  isLoadingForUser(gameId: string, userId: SbUserId): boolean {
    return !!this.loadingGames.get(gameId)?.players.some(p => p.userId === userId)
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
      const allUserIds = players.map(p => p.userId!).toArray()

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
      if (usersError || users.length !== players.size) {
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

      const hasMultipleHumans = players.size > 1
      if (hasMultipleHumans && !this.netcodeV2Service.isEnabled()) {
        return Result.error(
          new BaseGameLoaderError(
            GameLoadErrorType.Internal,
            'netcode v2 is not configured on this server; multiplayer games cannot load without it',
          ),
        )
      }
      const useNetcodeV2 = hasMultipleHumans
      // Persisted onto the game's config so later readers (e.g. the results endpoint deciding
      // whether direct HTTP submission is allowed) can see it without re-deriving it — this isn't
      // known until now, so it can't be part of the config written at registration time. The
      // write is awaited and fails the load on error: the results endpoint rejects direct
      // submissions for netcode-v2 games based on this flag, so losing the write would silently
      // re-open the direct-submission door for this game.
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
        const userId = player.userId!
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
        // Assign each participant a rally-point2 slot, wait for their per-session pubkeys, and
        // request the session from the coordinator. Each player gets their own token plus the
        // relay endpoints and the full slot roster. The game process consumes this setup when its
        // game init starts, so it must be published to every player before they can proceed.
        //
        // `players` includes observer slots alongside human slots (see `GameLoadRequest.players`'s
        // doc comment), and `Slot.type` distinguishes them, so observer-ness is known here — mark
        // it so the relay's desync comparator can exclude observers from the compared slot set.
        //
        // The host must land at rp2 slot 0: with native-lobby netcode v2, the host creates the
        // game's Storm session, and Storm always assigns its creator slot 0. The game DLL maps
        // BW Storm ids to rp2 slots by identity, so this roster has to agree the host is slot 0 or
        // that mapping breaks. Reuse the host already resolved for `generalSetup` (the same user
        // named in the published `GameSetup.host`) rather than re-deriving it here.
        const playersArr = [...players]
        const hostUserId = generalSetup.host.userId
        const hostPlayer = playersArr.find(p => p.userId === hostUserId)
        let orderedPlayers: Slot[]
        if (hostPlayer) {
          orderedPlayers = [hostPlayer, ...playersArr.filter(p => p !== hostPlayer)]
        } else {
          // Shouldn't happen — the host is always a human participant — but don't let it crash the
          // load, just fall back to the unordered assignment.
          log.warn(
            { gameId, hostUserId },
            'netcode v2: host not found among players, using unordered slot assignment',
          )
          orderedPlayers = playersArr
        }
        const slots = orderedPlayers.map((p, slot) => ({
          slot,
          userId: p.userId!,
          observer: p.type === SlotType.Observer,
          // The region the player selected when they queued/joined, if any. Forwarded to the
          // coordinator to home this slot's relay; a slot with none falls back region-blind.
          region: p.region,
        }))
        const [setups, setupsError] = (
          await Result.fromAsyncCatching(
            this.netcodeV2Service.createSessionForGame({ gameId, slots, signal }),
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
