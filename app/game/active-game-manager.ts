import { HKCU, REG_SZ, WindowsRegistry } from '@shieldbattery/windows-registry'
import { app } from 'electron'
import { Set } from 'immutable'
import { promises as fsPromises } from 'node:fs'
import path from 'node:path'
import { singleton } from 'tsyringe'
import { getErrorStack } from '../../common/errors'
import {
  GameLaunchConfig,
  GameRoute,
  isReplayLaunchConfig,
  isReplayMapInfo,
} from '../../common/games/game-launch-config'
import { GameStatus, ReportedGameStatus, statusToString } from '../../common/games/game-status'
import { GameClientPlayerResult, SubmitGameResultsRequest } from '../../common/games/results'
import { TypedEventEmitter } from '../../common/typed-emitter'
import { makeSbUserId, SbUserId } from '../../common/users/sb-user-id'
import log from '../logger'
import { LocalSettingsManager, ScrSettingsManager } from '../settings'
import { checkStarcraftPath } from './check-starcraft-path'
import { MapStore } from './map-store'

// Overrides the default rally-point bind port in the game. Not recommended for use outside of
// specific development testing, as it can cause game processes to conflict with each other.
const RALLY_POINT_PORT = Number(process.env.SB_RALLY_POINT_PORT ?? 0)

interface ActiveGameInfo {
  id: string
  status?: {
    state: GameStatus
    extra: any // TODO(tec27): Type the extra param based on the GameStatus
  }
  /**
   * A promise for when the game process has been launched, returning an instance of the process.
   */
  promise?: Promise<any>
  config?: GameLaunchConfig
  routes?: GameRoute[]
  /**
   * Whether or not this game instance has been told it can start.
   */
  startWhenReadySent?: boolean
  /**
   * The results of the game delivered once our local process has completed.
   */
  result?: {
    result: Record<SbUserId, GameClientPlayerResult>
    /** How long the game was played, in milliseconds. */
    time: number
  }
  /**
   * Whether or not the game result was successfully reported to the server by the game process.
   */
  resultSent?: boolean
}

function isGameConfig(
  possibleConfig: GameLaunchConfig | Record<string, never>,
): possibleConfig is GameLaunchConfig {
  return !!(possibleConfig as any).setup
}

export type ActiveGameManagerEvents = {
  gameCommand: (gameId: string, command: string, ...args: any[]) => void
  gameResult: (info: {
    gameId: string
    /** A mapping of player user ID -> result. */
    result: Record<SbUserId, GameClientPlayerResult>
    /** The time the game took in milliseconds. */
    time: number
  }) => void
  gameStatus: (statusInfo: ReportedGameStatus) => void
  replaySaved: (gameId: string, path: string) => void
  resendResults: (gameId: string, requestBody: SubmitGameResultsRequest) => void
}

@singleton()
export class ActiveGameManager extends TypedEventEmitter<ActiveGameManagerEvents> {
  private activeGame: ActiveGameInfo | null = null
  private serverPort = 0

  constructor(
    private mapStore: MapStore,
    private localSettings: LocalSettingsManager,
    private scrSettings: ScrSettingsManager,
  ) {
    super()
  }

  getStatus(): ReportedGameStatus | null {
    const game = this.activeGame
    if (game) {
      return {
        id: game.id,
        state: statusToString(game.status?.state ?? GameStatus.Unknown),
        extra: game.status?.extra,
        isReplay: game.config ? isReplayLaunchConfig(game.config) : false,
      }
    } else {
      return null
    }
  }

  setServerPort(port: number) {
    this.serverPort = port
  }

  /**
   * Sets the current game configuration. If this differs from the previous one, a new game client
   * will be launched.
   *
   * @returns the ID of the active game client, or null if there isn't one
   */
  setGameConfig(config: GameLaunchConfig | Record<string, never>): string | null {
    const current = this.activeGame
    if (current && current.id !== config.setup?.gameId) {
      // Means that a previous game left hanging somehow; quit it
      this.emit('gameCommand', current.id, 'quit')
    }
    if (!isGameConfig(config)) {
      this.setStatus(GameStatus.Unknown)
      this.activeGame = null
      return null
    }
    if (current && current.routes && isGameConfig(config)) {
      const routesIds = Set(current.routes.map(r => r.for))
      const slotIds = Set(config.setup.slots.map(s => s.id))

      if (!slotIds.isSuperset(routesIds)) {
        this.setStatus(GameStatus.Error)
        this.activeGame = null

        log.error(
          `Slots and routes don't match:\nslots: ${String(slotIds)}\nroutes: ${String(routesIds)}`,
        )
        throw new Error("Slots and routes don't match")
      }
    }

    const gameId = config.setup.gameId
    const activeGamePromise = doLaunch(
      gameId,
      this.serverPort,
      this.localSettings,
      this.scrSettings,
    ).then(
      async proc => {
        try {
          const code = await proc.waitForExit()
          this.handleGameExit(gameId, code)
        } catch (err) {
          this.handleGameExitWaitError(gameId, err as Error)
        }
      },
      err => this.handleGameLaunchError(gameId, err),
    )
    this.activeGame = {
      ...current,
      id: gameId,
      promise: activeGamePromise,
      config,
      status: { state: GameStatus.Unknown, extra: null },
    }
    log.verbose(`Creating new game ${gameId}`)
    this.setStatus(GameStatus.Launching)
    return gameId
  }

  setGameRoutes(gameId: string, routes: GameRoute[]) {
    const current = this.activeGame
    if (current && current.id !== gameId) {
      return
    }

    if (current && current.config) {
      const routesIds = Set(routes.map(r => r.for))
      const slotIds = Set(current.config.setup.slots.map(s => s.id))

      if (!slotIds.isSuperset(routesIds)) {
        this.setStatus(GameStatus.Error)
        this.activeGame = null

        const err = new Error("Slots and routes don't match")
        this.setStatus(GameStatus.Error, err)
        return
      }
    }

    this.activeGame = {
      ...current,
      id: gameId,
      routes,
    }
    this.setStatus(GameStatus.Launching)

    // `setGameRoutes` can be called before `setGameConfig`, in which case the config won't be set
    // yet; we also don't send the routes, since the game couldn't be connected in that case either.
    if (current && current.config) {
      this.emit('gameCommand', gameId, 'routes', routes)
      this.emit('gameCommand', gameId, 'setupGame', current.config.setup)
    }
  }

  /** Tells a particular game instance that it is okay to begin (starting actual gameplay). */
  startWhenReady(gameId: string) {
    if (!this.activeGame || this.activeGame.id !== gameId) {
      return
    }

    this.emit('gameCommand', gameId, 'startWhenReady')
    this.activeGame.startWhenReadySent = true
  }

  /** Notifies the manager that a game instance has connected and is ready for configuration. */
  async handleGameConnected(id: string) {
    if (!this.activeGame || this.activeGame.id !== id) {
      // Not our active game, must be one we started before and abandoned
      this.emit('gameCommand', id, 'quit')
      log.verbose(`Game ${id} is not any of our active games, sending quit command`)
      return
    }

    const game = this.activeGame
    this.setStatus(GameStatus.Configuring)
    const config = game.config!
    const { map } = config.setup
    config.setup.mapPath = isReplayMapInfo(map)
      ? map.path
      : this.mapStore.getPath(map.hash, map.mapData.format)

    this.emit('gameCommand', id, 'localUser', config.localUser)
    this.emit('gameCommand', id, 'serverConfig', config.serverConfig)
    this.emit('gameCommand', id, 'settings', {
      local: await this.localSettings.get(),
      scr: await this.scrSettings.get(),
      settingsFilePath: this.scrSettings.gameFilepath,
    })

    if (game.routes) {
      this.emit('gameCommand', id, 'routes', game.routes)
      this.emit('gameCommand', id, 'setupGame', config.setup)
    }

    // If the `startWhenReady` command was already sent by this point, it means it was sent while
    // the game wasn't even connected; we resend it here, otherwise the game wouldn't start at all.
    if (this.activeGame.startWhenReadySent) {
      this.emit('gameCommand', this.activeGame.id, 'startWhenReady')
    }
  }

  handleGameLaunchError(id: string, err: Error) {
    log.error(`Error while launching game ${id}: ${err.stack}`)
    if (this.activeGame && this.activeGame.id === id) {
      this.setStatus(GameStatus.Error, err)
      this.activeGame = null
    }
  }

  handleSetupProgress(gameId: string, info: any) {
    if (!this.activeGame || this.activeGame.id !== gameId) {
      return
    }
    this.setStatus(info.state, info.extra)
  }

  handleGameStart(gameId: string) {
    if (!this.activeGame || this.activeGame.id !== gameId) {
      return
    }
    this.setStatus(GameStatus.Playing)
  }

  handleGameResult(gameId: string, result: Record<SbUserId, GameClientPlayerResult>, time: number) {
    if (!this.activeGame || this.activeGame.id !== gameId) {
      return
    }

    log.verbose(`Game results: ${JSON.stringify({ result, time })}`)

    this.activeGame = {
      ...this.activeGame,
      result: { result, time },
    }
    this.setStatus(GameStatus.HasResult)

    this.emit('gameResult', { gameId, result, time })
  }

  handleGameResultSent(gameId: string) {
    if (!this.activeGame || this.activeGame.id !== gameId) {
      return
    }

    this.activeGame = {
      ...this.activeGame,
      resultSent: true,
    }
    this.setStatus(GameStatus.ResultSent)
  }

  handleGameFinished(gameId: string) {
    if (!this.activeGame || this.activeGame.id !== gameId) {
      return
    }

    this.setStatus(GameStatus.Finished)
    this.emit('gameCommand', gameId, 'cleanup_and_quit')
  }

  handleReplaySaved(gameId: string, path: string) {
    if (!this.activeGame || this.activeGame.id !== gameId) {
      return
    }

    log.verbose(`Replay saved to: ${path}`)
    this.emit('replaySaved', gameId, path)
  }

  handleGameExit(id: string, exitCode: number) {
    if (!this.activeGame || this.activeGame.id !== id) {
      return
    }

    log.verbose(`Game ${id} exited with code 0x${exitCode.toString(16)}`)

    Promise.resolve()
      .then(() => this.scrSettings.syncWithGameSettingsFile())
      .catch(err => {
        log.error(`Error syncing settings with game settings file: ${err?.stack ?? err}`)
      })

    let status = this.activeGame.status?.state ?? GameStatus.Unknown
    if (status < GameStatus.Finished) {
      if (status >= GameStatus.Playing) {
        if (!this.activeGame?.resultSent && this.activeGame.config) {
          // The game didn't send a result, so we will send a blank one
          const config = this.activeGame.config
          const submission: SubmitGameResultsRequest = {
            userId: config.localUser.id,
            resultCode: config.setup.resultCode!,
            time: 0,
            playerResults: [],
          }
          this.emit('resendResults', this.activeGame.id, submission)
        }
        this.setStatus(GameStatus.Unknown)
      } else {
        this.setStatus(
          GameStatus.Error,
          new Error(`Game exited unexpectedly with code 0x${exitCode.toString(16)}`),
        )
      }
    }

    status = this.activeGame.status?.state ?? GameStatus.Unknown
    if (
      status >= GameStatus.Playing &&
      this.activeGame.config?.setup.resultCode &&
      !this.activeGame.resultSent &&
      this.activeGame.result
    ) {
      const config = this.activeGame.config!
      const submission: SubmitGameResultsRequest = {
        userId: config.localUser.id,
        resultCode: config.setup.resultCode!,
        time: this.activeGame.result.time,
        playerResults: Array.from(Object.entries(this.activeGame.result.result), ([id, result]) => [
          makeSbUserId(Number(id)),
          result,
        ]),
      }

      this.emit('resendResults', this.activeGame.id, submission)
    }

    this.activeGame = null
  }

  handleGameExitWaitError(id: string, err: Error) {
    log.error(`Error while waiting for game ${id} to exit: ${String(err.stack ?? err)}`)
  }

  private setStatus(state: GameStatus, extra: any = null) {
    if (this.activeGame) {
      this.activeGame.status = { state, extra }
      this.emit('gameStatus', this.getStatus()!)
      log.verbose(`Game status updated to '${statusToString(state)}' [${JSON.stringify(extra)}]`)
    }
  }
}

const injectPath32 = path.resolve(app.getAppPath(), '../game/dist/shieldbattery.dll')
const injectPath64 = path.resolve(app.getAppPath(), '../game/dist/shieldbattery_64.dll')

async function doLaunch(
  gameId: string,
  serverPort: number,
  localSettings: LocalSettingsManager,
  scrSettings: ScrSettingsManager,
) {
  const settings = await localSettings.get()
  const injectPath = settings.launch64Bit ? injectPath64 : injectPath32
  try {
    await fsPromises.access(injectPath)
  } catch (err) {
    throw new Error(`Could not access/find shieldbattery dll at ${injectPath}`)
  }

  let { starcraftPath } = settings
  if (!starcraftPath) {
    throw new Error('No Starcraft path set')
  }
  const checkResult = await checkStarcraftPath(starcraftPath)
  if (!checkResult.path || !checkResult.version) {
    throw new Error(`StarCraft path ${starcraftPath} not valid: ` + JSON.stringify(checkResult))
  }

  // Ensure that our local settings file is up-to-date with the current settings
  await scrSettings.writeGameSettingsFile()

  const userDataPath = app.getPath('userData')
  let appPath = settings.launch64Bit
    ? path.join(starcraftPath, 'x86_64', 'StarCraft.exe')
    : path.join(starcraftPath, 'x86', 'StarCraft.exe')
  try {
    // Attempt to resolve the real path, just to ensure our capitalization matches Windows' for the
    // compat settings registry key
    ;[appPath, starcraftPath] = await Promise.all([
      fsPromises.realpath(appPath),
      fsPromises.realpath(starcraftPath),
    ])
  } catch (err) {
    log.warn(`Failed to resolve real path for StarCraft executable: ${getErrorStack(err)}`)
    // If we can't resolve the real path, we just use the original path we had
  }

  log.debug(`Attempting to launch "${appPath}" with StarCraft path: "${starcraftPath}"`)

  const rallyPointPort = !isNaN(RALLY_POINT_PORT) ? RALLY_POINT_PORT : 0
  // NOTE(tec27): SC:R uses -launch as an argument to skip bnet launcher.
  const args = `"${appPath}" ${gameId} ${serverPort} "${userDataPath}" ${rallyPointPort} -launch`

  // NOTE(tec27): We dynamically import this so that it doesn't crash the process on startup if
  // an antivirus decides to delete the native module
  const { launchProcess } = await import('./native/process/index')

  // People sometimes turn on compatibility settings for the game process for misguided reasons,
  // which then cause issues that they blame on us. So, we turn them off by overwriting the registry
  // key with a blank string, launch the game, and then restore whatever value they had set. This is
  // best effort, if it fails we just continue trying to launch
  const registry = new WindowsRegistry()
  let compatValue: string | undefined
  try {
    compatValue = (await registry.read(
      HKCU,
      'Software\\Microsoft\\Windows NT\\CurrentVersion\\AppCompatFlags\\Layers',
      appPath,
    )) as string | undefined
    if (compatValue !== undefined && typeof compatValue !== 'string') {
      throw new Error(
        'Got unexpected type for compatibility settings: ' + JSON.stringify(compatValue),
      )
    }
  } catch (err) {
    log.warn(`Failed to read compatibility settings from registry: ${getErrorStack(err)}`)
    compatValue = undefined
  }

  try {
    if (compatValue) {
      log.debug(`Found compatibility settings for StarCraft: "${compatValue}"`)
      log.debug(`Overriding compatibility settings before launch...`)
      try {
        await registry.write(
          HKCU,
          'Software\\Microsoft\\Windows NT\\CurrentVersion\\AppCompatFlags\\Layers',
          appPath,
          REG_SZ,
          '',
        )
      } catch (err) {
        log.warn(`Failed to write blank compatibility settings to registry: ${getErrorStack(err)}`)
      }
    }

    const proc = await launchProcess({
      appPath,
      args: args as any,
      currentDir: starcraftPath,
      dllPath: injectPath,
      dllFunc: 'OnInject',
      logCallback: ((msg: string) => log.verbose(`[Inject] ${msg}`)) as any,
    })
    log.verbose('Process launched')
    return proc
  } finally {
    if (compatValue) {
      log.debug(`Restoring compatibility settings after launch...`)
      try {
        await registry.write(
          HKCU,
          'Software\\Microsoft\\Windows NT\\CurrentVersion\\AppCompatFlags\\Layers',
          appPath,
          REG_SZ,
          compatValue,
        )
      } catch (err) {
        log.warn(`Failed to restore compatibility settings to registry: ${getErrorStack(err)}`)
      }
    }
  }
}
