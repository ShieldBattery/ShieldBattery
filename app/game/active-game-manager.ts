import { app } from 'electron'
import { promises as fsPromises } from 'fs'
import got from 'got'
import { Set } from 'immutable'
import path from 'path'
import { singleton } from 'tsyringe'
import { GameConfig, GameRoute, isReplayMapInfo } from '../../common/game-config'
import { GameClientPlayerResult } from '../../common/game-results'
import { GameStatus, statusToString } from '../../common/game-status'
import { TypedEventEmitter } from '../../common/typed-emitter'
import log from '../logger'
import { launchProcess } from '../native/process'
import { ScrSettings } from '../settings'
import { checkStarcraftPath } from './check-starcraft-path'
import { MapStore } from './map-store'

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
  config?: GameConfig
  routes?: GameRoute[]
  /**
   * Whether or not this game instance has been told it can start.
   */
  allowStartSent?: boolean
  /**
   * The results of the game delivered once our local process has completed.
   */
  result?: {
    result: any
    /** How long the game was played, in milliseconds. */
    time: number
  }
  /**
   * Whether or not the game result was successfully reported to the server by the game process.
   */
  resultSent?: boolean
}

function isGameConfig(
  possibleConfig: GameConfig | Record<string, never>,
): possibleConfig is GameConfig {
  return !!(possibleConfig as any).setup
}

export interface ActiveGameManagerEvents {
  gameCommand: (gameId: string, command: string, ...args: any[]) => void
  gameResult: (info: {
    gameId: string
    /** A mapping of player name -> result. */
    result: Record<string, GameClientPlayerResult>
    /** The time the game took in milliseconds. */
    time: number
  }) => void
  gameStatus: (statusInfo: { id: string; state: string; extra?: any }) => void
  replaySave: (gameId: string, path: string) => void
}

@singleton()
export class ActiveGameManager extends TypedEventEmitter<ActiveGameManagerEvents> {
  private activeGame: ActiveGameInfo | null = null
  private serverPort = 0

  constructor(private mapStore: MapStore, private scrSettings: ScrSettings) {
    super()
  }

  getStatus() {
    const game = this.activeGame
    if (game) {
      return {
        id: game.id,
        state: statusToString(game.status?.state ?? GameStatus.Unknown),
        extra: game.status?.extra,
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
  setGameConfig(config: GameConfig | Record<string, never>): string | null {
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

        throw new Error("Slots and routes don't match")
      }
    }

    const gameId = config.setup.gameId
    const activeGamePromise = doLaunch(gameId, this.serverPort, config.settings, this.scrSettings)
      .then(
        proc => proc.waitForExit(),
        err => this.handleGameLaunchError(gameId, err),
      )
      .then(
        code => this.handleGameExit(gameId, code),
        err => this.handleGameExitWaitError(gameId, err),
      )
    this.activeGame = {
      ...current,
      id: gameId,
      promise: activeGamePromise,
      // NOTE(tec27): this
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

        throw new Error("Slots and routes don't match")
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
  allowStart(gameId: string) {
    if (!this.activeGame || this.activeGame.id !== gameId) {
      return
    }

    this.emit('gameCommand', gameId, 'allowStart')
    this.activeGame.allowStartSent = true
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
    this.emit('gameCommand', id, 'settings', config.settings)

    if (game.routes) {
      this.emit('gameCommand', id, 'routes', game.routes)
      this.emit('gameCommand', id, 'setupGame', config.setup)
    }

    // If the `allowStart` command was already sent by this point, it means it was sent while the
    // game wasn't even connected; we resend it here, otherwise the game wouldn't start at all.
    if (this.activeGame.allowStartSent) {
      this.emit('gameCommand', this.activeGame.id, 'allowStart')
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

  handleGameResult(gameId: string, result: Record<string, GameClientPlayerResult>, time: number) {
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

  handleReplaySave(gameId: string, path: string) {
    if (!this.activeGame || this.activeGame.id !== gameId) {
      return
    }

    log.verbose(`Replay saved to: ${path}`)
    this.emit('replaySave', gameId, path)
  }

  handleGameExit(id: string, exitCode: number) {
    if (!this.activeGame || this.activeGame.id !== id) {
      return
    }

    log.verbose(`Game ${id} exited with code 0x${exitCode.toString(16)}`)

    let status = this.activeGame.status?.state ?? GameStatus.Unknown
    if (status < GameStatus.Finished) {
      if (status >= GameStatus.Playing) {
        // TODO(tec27): report a disc to the server
        this.setStatus(GameStatus.Unknown)
      } else {
        this.setStatus(
          GameStatus.Error,
          new Error(`Game exited unexpectedly with code 0x${exitCode.toString(16)}`),
        )
      }
    }

    status = this.activeGame.status?.state ?? GameStatus.Unknown
    // TODO(#541): Convert a game config to a "blank" result if one was not delivered by the
    // game before exit
    if (
      status >= GameStatus.Playing &&
      !this.activeGame.resultSent &&
      this.activeGame.result &&
      !isReplayMapInfo(this.activeGame.config!.setup.map)
    ) {
      // TODO(#542): Retry submission of these results more times/for longer to try and ensure
      // complete resutls on the server
      log.verbose('Game failed to send result, retrying once from the app')
      const config = this.activeGame.config!
      const submission = {
        userId: config.localUser.id,
        resultCode: config.setup.resultCode,
        time: this.activeGame.result.time,
        playerResults: Array.from(Object.entries(this.activeGame.result.result)),
      }

      got(`/api/1/gameResults/${encodeURIComponent(this.activeGame.id)}`, {
        method: 'post',
        body: JSON.stringify(submission),
      })
        .then(() => {
          log.verbose('Game result submitted successfully')
        })
        .catch(err => {
          log.error('Game result submission failed: ' + err)
        })
    }

    this.activeGame = null
  }

  handleGameExitWaitError(id: string, err: Error) {
    log.error(`Error while waiting for game ${id} to exit: ${err}`)
  }

  private setStatus(state: GameStatus, extra: any = null) {
    if (this.activeGame) {
      this.activeGame.status = { state, extra }
      this.emit('gameStatus', this.getStatus()!)
      log.verbose(`Game status updated to '${statusToString(state)}' [${JSON.stringify(extra)}]`)
    }
  }
}

// TODO(tec27): add typings for launchProcess
function silentTerminate(proc: any) {
  try {
    proc.terminate()
  } catch (err) {
    log.warning('Error terminating process: ' + err)
  }
}

const injectPath = path.resolve(app.getAppPath(), '../game/dist/shieldbattery.dll')

async function removeIfOld(path: string, maxAge: number) {
  try {
    const stat = await fsPromises.stat(path)
    if (Date.now() - Number(stat.mtime) > maxAge) {
      await fsPromises.unlink(path)
    }
  } catch (e) {
    // We won't care the file doesn't exist/can't be touched
  }
}

async function doLaunch(
  gameId: string,
  serverPort: number,
  settings: GameConfig['settings'],
  scrSettings: ScrSettings,
) {
  try {
    await fsPromises.access(injectPath)
  } catch (err) {
    throw new Error(`Could not access/find shieldbattery dll at ${injectPath}`)
  }

  const { starcraftPath } = settings.local
  if (!starcraftPath) {
    throw new Error('No Starcraft path set')
  }
  const checkResult = await checkStarcraftPath(starcraftPath)
  if (!checkResult.path || !checkResult.version) {
    throw new Error(`StarCraft path ${starcraftPath} not valid: ` + JSON.stringify(checkResult))
  }
  const isRemastered = checkResult.remastered
  if (isRemastered) {
    // Blizzard reinitializes their settings file everytime the SC:R is opened through their
    // launcher. So we must do the same thing with our own version of settings before each game.
    await scrSettings.overwrite()
  }

  const userDataPath = app.getPath('userData')
  let appPath
  if (isRemastered) {
    appPath = path.join(starcraftPath, 'x86/starcraft.exe')
  } else {
    appPath = path.join(starcraftPath, 'starcraft.exe')
  }
  log.debug(`Attempting to launch ${appPath} with StarCraft path: ${starcraftPath}`)
  let args = `"${appPath}" ${gameId} ${serverPort} "${userDataPath}"`
  if (isRemastered) {
    // SCR uses -launch as an argument to skip bnet launcher.
    // We also use it in DLL to detect whether apply 1.16.1 or SCR patches.
    args += ' -launch'
  }
  const proc = await launchProcess({
    appPath,
    args: args as any,
    launchSuspended: !isRemastered,
    currentDir: starcraftPath,
    environment: [
      // Prevent Windows Game Explorer from trying to make a network connection on process launch,
      // which, if it fails, will be retried ~forever (wat). Also turn off some compatibility
      // settings that people typically enabled for pre-ShieldBattery BW, but cause problems with
      // forge.
      '__COMPAT_LAYER=!GameUX !256Color !640x480 !Win95 !Win98 !Win2000 !NT4SP5',
    ],
    debuggerLaunch: isRemastered,
    logCallback: (msg: string) => log.verbose(`[Inject] ${msg}`),
  })
  log.verbose('Process launched')

  log.debug(`Injecting ${injectPath} into the process...`)
  const dataRoot = app.getPath('userData')
  const errorDumpPath = path.join(dataRoot, 'logs', 'inject_fail.dmp')
  // Remove the error dump if it's older than 2 weeks, as can be really large
  await removeIfOld(errorDumpPath, 2 * 24 * 3600 * 1000)
  try {
    // Note: if debuggerLaunch is true (remastered), injection happens on main thread that stays
    // suspended until proc.resume() below, while otherwise the OnInject has finished running
    // before injectDll resolves.
    // This shouldn't really change anything, but worth noticing to anyone looking at this code.
    // Could be possibly fixed if someone wants to refactor injection to add something in the
    // inject_proc asm that synchronizes the launching process without needing an extra thread.
    await proc.injectDll(injectPath, 'OnInject', errorDumpPath)
  } catch (err) {
    silentTerminate(proc)
    throw err
  }

  log.verbose('Dll injected. Attempting to resume process...')
  try {
    proc.resume()
  } catch (err) {
    silentTerminate(proc)
    throw err
  }

  log.verbose('Process resumed')
  return proc
}
