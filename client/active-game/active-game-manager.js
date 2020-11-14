import { ipcRenderer, remote } from 'electron'
import path from 'path'
import { promises as fsPromises } from 'fs'
import { EventEmitter } from 'events'
import { Set } from 'immutable'
import { checkStarcraftPath } from '../starcraft/check-starcraft-path'
import log from '../logging/logger'
import {
  GAME_STATUS_UNKNOWN,
  GAME_STATUS_LAUNCHING,
  GAME_STATUS_CONFIGURING,
  GAME_STATUS_PLAYING,
  GAME_STATUS_FINISHED,
  GAME_STATUS_ERROR,
  statusToString,
} from '../../common/game-status'
import { SCR_SETTINGS_OVERWRITE } from '../../common/ipc-constants'

const { launchProcess } = remote.require('./native/process')

export default class ActiveGameManager extends EventEmitter {
  constructor(mapStore) {
    super()
    this.mapStore = mapStore
    this.activeGame = null
    this.serverPort = 0
  }

  getStatus() {
    const game = this.activeGame
    if (game) {
      return {
        id: game.id,
        state: statusToString(game.status.state),
        extra: game.status.extra,
      }
    } else {
      return null
    }
  }

  setServerPort(port) {
    this.serverPort = port
  }

  setGameConfig(config) {
    const current = this.activeGame
    if (current && current.id !== config.gameId) {
      // Means that a previous game left hanging somehow; quit it
      this.emit('gameCommand', current.id, 'quit')
    }
    if (!config.setup) {
      this._setStatus(GAME_STATUS_UNKNOWN)
      this.activeGame = null
      return null
    }
    if (current && current.routes && config.setup) {
      const routesIds = new Set(current.routes.map(r => r.for))
      const slotIds = new Set(config.setup.slots.map(s => s.id))

      if (!slotIds.isSuperset(routesIds)) {
        this._setStatus(GAME_STATUS_ERROR)
        this.activeGame = null

        throw new Error("Slots and routes don't match")
      }
    }

    const gameId = config.setup.gameId
    const activeGamePromise = doLaunch(gameId, this.serverPort, config.settings)
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
      config,
      status: { state: GAME_STATUS_UNKNOWN, extra: null },
    }
    log.verbose(`Creating new game ${gameId}`)
    this._setStatus(GAME_STATUS_LAUNCHING)
    return gameId
  }

  setGameRoutes(gameId, routes) {
    const current = this.activeGame
    if (current && current.id !== gameId) {
      return
    }

    if (current && current.config) {
      const routesIds = new Set(routes.map(r => r.for))
      const slotIds = new Set(current.config.setup.slots.map(s => s.id))

      if (!slotIds.isSuperset(routesIds)) {
        this._setStatus(GAME_STATUS_ERROR)
        this.activeGame = null

        throw new Error("Slots and routes don't match")
      }
    }

    this.activeGame = {
      ...current,
      id: gameId,
      routes,
    }
    this._setStatus(GAME_STATUS_LAUNCHING)

    // `setGameRoutes` can be called before `setGameConfig`, in which case the config won't be set
    // yet; we also don't send the routes, since the game couldn't be connected in that case either.
    if (current && current.config) {
      this.emit('gameCommand', gameId, 'routes', routes)
      this.emit('gameCommand', gameId, 'setupGame', current.config.setup)
    }
  }

  allowStart(gameId) {
    if (!this.activeGame || this.activeGame.id !== gameId) {
      return
    }

    this.emit('gameCommand', gameId, 'allowStart')
    this.activeGame.allowStartSent = true
  }

  async handleGameConnected(id) {
    if (!this.activeGame || this.activeGame.id !== id) {
      // Not our active game, must be one we started before and abandoned
      this.emit('gameCommand', id, 'quit')
      log.verbose(`Game ${id} is not any of our active games, sending quit command`)
      return
    }

    const game = this.activeGame
    this._setStatus(GAME_STATUS_CONFIGURING)
    const { map } = game.config.setup
    game.config.setup.mapPath = map.path
      ? map.path
      : this.mapStore.getPath(map.hash, map.mapData.format)

    this.emit('gameCommand', id, 'localUser', game.config.localUser)
    this.emit('gameCommand', id, 'settings', game.config.settings)

    if (game.routes) {
      this.emit('gameCommand', id, 'routes', game.routes)
      this.emit('gameCommand', id, 'setupGame', game.config.setup)
    }

    // If the `allowStart` command was already sent by this point, it means it was sent while the
    // game wasn't even connected; we resend it here, otherwise the game wouldn't start at all.
    if (this.activeGame.allowStartSent) {
      this.emit('gameCommand', this.activeGame.id, 'allowStart')
    }
  }

  handleGameLaunchError(id, err) {
    log.error(`Error while launching game ${id}: ${err}`)
    if (this.activeGame && this.activeGame.id === id) {
      this._setStatus(GAME_STATUS_ERROR, err)
      this.activeGame = null
    }
  }

  handleSetupProgress(gameId, info) {
    if (!this.activeGame || this.activeGame.id !== gameId) {
      return
    }
    this._setStatus(info.state, info.extra)
  }

  handleGameStart(gameId) {
    if (!this.activeGame || this.activeGame.id !== gameId) {
      return
    }
    this._setStatus(GAME_STATUS_PLAYING)
  }

  handleGameEnd(gameId, results, time) {
    if (!this.activeGame || this.activeGame.id !== gameId) {
      return
    }
    // TODO(tec27): this needs to be handled differently (game should really be reporting these
    // directly to the server)
    log.verbose(`Game finished: ${JSON.stringify({ results, time })}`)
    this.emit('gameResults', { results, time })
    this._setStatus(GAME_STATUS_FINISHED)
    this.emit('gameCommand', gameId, 'cleanup_and_quit')
  }

  handleReplaySave(gameId, path) {
    if (!this.activeGame || this.activeGame.id !== gameId) {
      return
    }

    log.verbose(`Replay saved to: ${path}`)
    this.emit('replaySave', path)
  }

  handleGameExit(id, exitCode) {
    if (!this.activeGame || this.activeGame.id !== id) {
      return
    }

    log.verbose(`Game ${id} exited with code 0x${exitCode.toString(16)}`)

    if (this.activeGame.status.state < GAME_STATUS_FINISHED) {
      if (this.activeGame.status.state >= GAME_STATUS_PLAYING) {
        // TODO(tec27): report a disc to the server
        this._setStatus(GAME_STATUS_UNKNOWN)
      } else {
        this._setStatus(
          GAME_STATUS_ERROR,
          new Error(`Game exited unexpectedly with code 0x${exitCode.toString(16)}`),
        )
      }
    }

    this.activeGame = null
  }

  handleGameExitWaitError(id, err) {
    log.error(`Error while waiting for game ${id} to exit: ${err}`)
  }

  _setStatus(state, extra = null) {
    if (this.activeGame) {
      this.activeGame.status = { state, extra }
      this.emit('gameStatus', this.getStatus())
      log.verbose(`Game status updated to '${statusToString(state)}' [${JSON.stringify(extra)}]`)
    }
  }
}

function silentTerminate(proc) {
  try {
    proc.terminate()
  } catch (err) {
    log.warning('Error terminating process: ' + err)
  }
}

const injectPath = path.resolve(remote.app.getAppPath(), '../game/dist/shieldbattery.dll')

async function removeIfOld(path, maxAge) {
  try {
    const stat = await fsPromises.stat(path)
    if (Date.now() - stat.mtime > maxAge) {
      await fsPromises.unlink(path)
    }
  } catch (e) {
    // We won't care the file doesn't exist/can't be touched
  }
}

async function doLaunch(gameId, serverPort, settings) {
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

  const userDataPath = remote.app.getPath('userData')
  let appPath
  if (isRemastered) {
    appPath = path.join(starcraftPath, 'x86/starcraft.exe')
  } else {
    appPath = path.join(starcraftPath, 'starcraft.exe')
  }
  log.debug(`Attempting to launch ${appPath} with StarCraft path: ${starcraftPath}`)
  let args = `"${appPath}" ${gameId} ${serverPort} "${userDataPath}"`
  if (isRemastered) {
    // Blizzard reinitializes their settings file everytime the SC:R is opened through their
    // launcher. So we must do the same thing with our own version of settings before each game.
    ipcRenderer.send(SCR_SETTINGS_OVERWRITE)
    // SCR uses -launch as an argument to skip bnet launcher.
    // We also use it in DLL to detect whether apply 1.16.1 or SCR patches.
    args += ' -launch'
  }
  const proc = await launchProcess({
    appPath,
    args,
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
    logCallback: msg => log.verbose(`[Inject] ${msg}`),
  })
  log.verbose('Process launched')

  log.debug(`Injecting ${injectPath} into the process...`)
  const dataRoot = remote.app.getPath('userData')
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
