import { remote } from 'electron'
import electronIsDev from 'electron-is-dev'
import path from 'path'
import fs from 'fs'
import { EventEmitter } from 'events'
import cuid from 'cuid'
import deepEqual from 'deep-equal'
import thenify from 'thenify'
import ReplayParser from 'jssuh'
import { checkStarcraftPath } from '../settings/check-starcraft-path'
import log from '../logging/logger'
import {
  GAME_STATUS_UNKNOWN,
  GAME_STATUS_LAUNCHING,
  GAME_STATUS_CONFIGURING,
  GAME_STATUS_PLAYING,
  GAME_STATUS_FINISHED,
  GAME_STATUS_ERROR,
  statusToString
} from '../../common/game-status'

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
        extra: game.status.extra
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
    if (!config.lobby) {
      this._setStatus(GAME_STATUS_UNKNOWN)
      this.activeGame = null
      return null
    }

    const gameId = cuid()
    const activeGamePromise = doLaunch(gameId, this.serverPort, config.settings)
      .then(proc => proc.waitForExit(), err => this.handleGameLaunchError(gameId, err))
      .then(code => this.handleGameExit(gameId, code),
          err => this.handleGameExitWaitError(gameId, err))
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
    this.emit('gameCommand', gameId, 'setRoutes', routes)
  }

  getReplayHeader(filename) {
    return new Promise((resolve, reject) => {
      const reppi = fs.createReadStream(filename).pipe(new ReplayParser())
      reppi.on('replayHeader', resolve)
        .on('error', reject)
      reppi.resume()
    })
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
    const { map } = game.config.lobby
    let localMap
    if (map.isReplay) {
      localMap = map.path

      // TODO(tec27): Do this while the game is launching, no point in waiting for it to launch
      // before kicking the process off
      //
      // To be able to watch the replay correctly, we need to get the `seed` value that the game was
      // played with
      let header
      try {
        header = await this.getReplayHeader(localMap)
      } catch (err) {
        this.emit('gameCommand', id, 'quit')
        log.verbose('Error parsing the replay file, sending quit command')
        return
      }
      game.config.setup = {
        seed: header.seed
      }
    } else {
      localMap = this.mapStore.getPath(map.hash, map.format)
    }
    this.emit('gameCommand', id, 'setConfig', {
      ...game.config,
      localMap,
    })

    if (game.routes) {
      this.emit('gameCommand', game.id, 'setRoutes', game.routes)
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
        this._setStatus(GAME_STATUS_ERROR,
            new Error(`Game exited unexpectedly with code 0x${exitCode.toString(16)}`))
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
      log.verbose(`Game status updated to '${statusToString(state)}'`)
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

const injectPath = path.resolve(remote.app.getAppPath(),
    electronIsDev ? '../game/dist/shieldbattery.dll' : './resources/game/dist/shieldbattery.dll')

const accessAsync = thenify(fs.access)
async function doLaunch(gameId, serverPort, settings) {
  const { starcraftPath } = settings.local
  if (!starcraftPath) {
    throw new Error('No Starcraft path set')
  }
  const appPath = path.join(starcraftPath, 'starcraft.exe')
  try {
    await checkStarcraftPath(starcraftPath)
  } catch (err) {
    throw new Error(`Could not access/find Starcraft executable at ${appPath}: ${err}`)
  }

  log.debug('Attempting to launch ' + appPath)
  const proc = await launchProcess({
    appPath,
    args: `${gameId} ${serverPort}`,
    launchSuspended: true,
    currentDir: starcraftPath,
    environment: [
      // Prevent Windows Game Explorer from trying to make a network connection on process launch,
      // which, if it fails, will be retried ~forever (wat). Also turn off some compatibility
      // settings that people typically enabled for pre-ShieldBattery BW, but cause problems with
      // forge.
      '__COMPAT_LAYER=!GameUX !256Color !640x480 !Win95 !Win98 !Win2000 !NT4SP5',
    ]
  })
  log.verbose('Process launched')

  try {
    await accessAsync(injectPath)
  } catch (err) {
    throw new Error(`Could not access/find shieldbattery dll at ${injectPath}`)
  }

  log.debug(`Injecting ${injectPath} into the process...`)
  const dataRoot = remote.app.getPath('userData')
  const errorDumpPath = path.join(dataRoot, 'logs', 'inject_fail.dmp')
  try {
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
