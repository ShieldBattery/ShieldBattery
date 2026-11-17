import { singleton } from 'tsyringe'
import { assertUnreachable } from '../../../common/assert-unreachable'
import { GameSource, SoloGameConfig } from '../../../common/games/configuration'
import { GameType } from '../../../common/games/game-type'
import { SbMapId } from '../../../common/maps'
import { RaceChar } from '../../../common/races'
import {
  canPlayMapAlone,
  SoloGameEvent,
  SoloGameLaunchFailure,
  SoloGameServiceErrorCode,
} from '../../../common/solo-games'
import { urlPath } from '../../../common/urls'
import { FriendActivityStatus } from '../../../common/users/relationships'
import { SbUserId } from '../../../common/users/sb-user-id'
import { GameLoader, GameLoaderError, GameLoadErrorType } from '../games/game-loader'
import { GameplayActivityRegistry } from '../games/gameplay-activity-registry'
import logger from '../logging/logger'
import { getMapInfos } from '../maps/map-models'
import { ActivityStatusService } from '../users/activity-status-service'
import { ClientSocketsGroup } from '../websockets/socket-groups'
import { TypedPublisher } from '../websockets/typed-publisher'
import { SoloGameServiceError } from './solo-game-service-error'
import { buildSoloGameSlots } from './solo-game-slots'

/** The path a launching client hears how its launch turned out on. */
export function getSoloGamesPath(userId: SbUserId): string {
  return urlPath`/solo-games/${userId}`
}

function toLaunchFailure(error: GameLoaderError): SoloGameLaunchFailure {
  switch (error.code) {
    case GameLoadErrorType.Timeout:
      return SoloGameLaunchFailure.Timeout
    case GameLoadErrorType.PlayerFailed:
      return SoloGameLaunchFailure.ClientFailed
    case GameLoadErrorType.Internal:
    // The loader only cancels a load when its caller asks it to, which this service never does
    case GameLoadErrorType.Canceled:
    // A game without a network session has no relay to detect anomalies
    case GameLoadErrorType.GameAnomaly:
      return SoloGameLaunchFailure.Internal
    default:
      return assertUnreachable(error)
  }
}

/**
 * Launches games that one person plays by themselves, on a map of their choosing. There's no lobby
 * involved: the game is loaded with its single player directly, the way matchmaking loads a match
 * once it's been formed.
 */
@singleton()
export class SoloGameService {
  constructor(
    private activityRegistry: GameplayActivityRegistry,
    private activityStatusService: ActivityStatusService,
    private gameLoader: GameLoader,
    private publisher: TypedPublisher<SoloGameEvent>,
  ) {}

  /**
   * Starts loading a game on `mapId` that the user of `client` plays alone, from `slot` as `race`
   * (see `buildSoloGameSlots`). Returns once the load has begun; how it turns out is sent to
   * the client on `getSoloGamesPath` (see `SoloGameEvent`).
   *
   * Everything that can refuse the launch is checked before anything changes, so a refused launch
   * leaves the user as they were. Until the load settles, the client holds the user's gameplay
   * activity, keeping them out of lobbies and matchmaking, without changing what their friends see
   * them doing until the game starts.
   *
   * The client's site connection dropping doesn't end the load: the game reports its own start over
   * HTTP, and a game that never does is caught by the load's deadline. Either way the activity is
   * released once the load settles, whether or not the client is still connected.
   *
   * @throws SoloGameServiceError if the launch is refused
   */
  async launch({
    client,
    mapId,
    slot,
    race,
  }: {
    client: ClientSocketsGroup
    mapId: SbMapId
    slot?: number
    race?: RaceChar
  }): Promise<void> {
    const [map] = await getMapInfos([mapId])
    if (!map) {
      throw new SoloGameServiceError(SoloGameServiceErrorCode.MapNotFound, 'map not found')
    }
    if (!canPlayMapAlone(map.kind, map.mapData.umsForces)) {
      throw new SoloGameServiceError(
        SoloGameServiceErrorCode.MapNotPlayableAlone,
        'map cannot be played alone',
      )
    }
    const userId = client.userId
    const { playerInfos, teams } = buildSoloGameSlots({ map, userId, slot, race })

    if (!client.isConnected()) {
      throw new SoloGameServiceError(
        SoloGameServiceErrorCode.NoActiveClient,
        'client is no longer connected',
      )
    }
    // The gameplay activity registry alone doesn't keep someone who is playing a game from starting
    // another one: matchmaking lets go of its players' activity once their game has loaded
    if (this.activityStatusService.getStatus(userId) === FriendActivityStatus.InGame) {
      throw new SoloGameServiceError(
        SoloGameServiceErrorCode.AlreadyInGame,
        'user is already playing a game',
      )
    }
    if (!this.activityRegistry.registerActiveClient(userId, client, undefined)) {
      throw new SoloGameServiceError(
        SoloGameServiceErrorCode.AlreadyInActivity,
        'user is already in a gameplay activity',
      )
    }

    const path = getSoloGamesPath(userId)
    client.subscribe<SoloGameEvent>(path)

    const gameConfig: SoloGameConfig = {
      gameSource: GameSource.Solo,
      gameType: GameType.UseMapSettings,
      gameSubType: 0,
      teams,
      // As in a Use Map Settings lobby game, alliances are left to the map's triggers
      lockedAlliances: false,
    }

    Promise.resolve(
      this.gameLoader.loadGame({
        players: [{ userId, isObserver: false }],
        playerInfos,
        mapId: map.id,
        gameConfig,
      }),
    )
      .then(
        (result): SoloGameEvent => {
          if (result.isOk()) {
            return { type: 'gameStarted', gameId: result.value.gameId }
          }
          if (result.error.code === GameLoadErrorType.Internal) {
            logger.error({ err: result.error }, 'error loading solo game')
          }
          return { type: 'launchFailed', reason: toLaunchFailure(result.error) }
        },
        (err): SoloGameEvent => {
          logger.error({ err }, 'unexpected error loading solo game')
          return { type: 'launchFailed', reason: SoloGameLaunchFailure.Internal }
        },
      )
      .then(event => {
        // The registry keeps the client it was given even once it has disconnected, so this also
        // releases a launch whose client went away mid-load
        if (this.activityRegistry.getClientForUser(userId) === client) {
          this.activityRegistry.unregisterClientForUser(userId)
        }
        this.publisher.publish(path, event)
        client.unsubscribe(path)
      })
      .catch(err => {
        logger.error({ err }, 'error finishing solo game launch')
      })
  }
}
