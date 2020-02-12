import { remote } from 'electron'
import path from 'path'
import fs from 'fs'
import { EventEmitter } from 'events'
import cuid from 'cuid'
import deepEqual from 'deep-equal'
import thenify from 'thenify'
import { checkStarcraftPath } from '../settings/check-starcraft-path'
import getDowngradePath from './get-downgrade-path'
import log from '../logging/logger'
import {
  GAME_STATUS_UNKNOWN,
  GAME_STATUS_LAUNCHING,
  GAME_STATUS_CONFIGURING,
  GAME_STATUS_PLAYING,
  GAME_STATUS_FINISHED,
  GAME_STATUS_ERROR,
  statusToString,
} from '../../app/common/game-status'

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
    if (current) {
      if (deepEqual(config, current.config)) {
        // Same config as before, no operation necessary
        return current.id
      }
      // Quit the currently active game so we can replace it
      this.emit('gameCommand', current.id, 'quit')
    }
    if (!config.setup) {
      this._setStatus(GAME_STATUS_UNKNOWN)
      this.activeGame = null
      return null
    }

    const gameId = cuid()
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
      id: gameId,
      promise: activeGamePromise,
      routes: null,
      config,
      status: { state: GAME_STATUS_UNKNOWN, extra: null },
    }
    log.verbose(`Creating new game ${gameId}`)
    this._setStatus(GAME_STATUS_LAUNCHING)
    return gameId
  }

  setGameRoutes(gameId, routes) {
    if (!this.activeGame || this.activeGame.id !== gameId) {
      return
    }

    this.activeGame.routes = routes
    this.emit('gameCommand', gameId, 'routes', routes)
    this.emit('gameCommand', gameId, 'setupGame', this.activeGame.config.setup)
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
    // TODO(tec27): this needs to be handled differently (psi should really be reporting these
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

const statAsync = thenify(fs.stat)
const unlinkAsync = thenify(fs.unlink)
async function removeIfOld(path, maxAge) {
  try {
    const stat = await statAsync(path)
    if (Date.now() - stat.mtime > maxAge) {
      await unlinkAsync(path)
    }
  } catch (e) {
    // We won't care the file doesn't exist/can't be touched
  }
}

const accessAsync = thenify(fs.access)
async function doLaunch(gameId, serverPort, settings) {
  try {
    await accessAsync(injectPath)
  } catch (err) {
    throw new Error(`Could not access/find shieldbattery dll at ${injectPath}`)
  }

  const { starcraftPath } = settings.local
  if (!starcraftPath) {
    throw new Error('No Starcraft path set')
  }
  const downgradePath = getDowngradePath()
  const checkResult = await checkStarcraftPath(starcraftPath, downgradePath)
  if (!checkResult.path || !checkResult.version) {
    throw new Error(
      `StarCraft path [${starcraftPath}, ${downgradePath}] not valid: ` +
        JSON.stringify(checkResult),
    )
  }
  const isRemastered = checkResult.remastered

  const userDataPath = remote.app.getPath('userData')
  let appPath
  if (isRemastered) {
    appPath = path.join(starcraftPath, 'x86/starcraft.exe')
  } else {
    appPath = path.join(checkResult.downgradePath ? downgradePath : starcraftPath, 'starcraft.exe')
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
