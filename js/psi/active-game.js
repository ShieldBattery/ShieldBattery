import path from 'path'
import fs from 'fs'
import cuid from 'cuid'
import deepEqual from 'deep-equal'
import thenify from 'thenify'
import * as psi from './natives/index'
import log from './logger'
import { sendCommand } from './game-command'
import {
  GAME_STATUS_UNKNOWN,
  GAME_STATUS_LAUNCHING,
  GAME_STATUS_CONFIGURING,
  GAME_STATUS_PLAYING,
  GAME_STATUS_FINISHED,
  GAME_STATUS_ERROR,
  statusToString
} from '../common/game-status'

export default class ActiveGameManager {
  constructor(nydus, mapStore) {
    this.nydus = nydus
    this.mapStore = mapStore
    // Maps [username, origin] -> game info
    this.activeGames = new Map()
  }

  _findGameById(id) {
    for (const entry of this.activeGames) {
      if (entry[1].id === id) {
        return entry
      }
    }
    log.verbose(`Game ${id} not found`)
    return [null, null]
  }

  getStatusForSite(user) {
    const game = this.activeGames.get(user)
    if (game) {
      return [{
        user: user[0],
        id: game.id,
        state: statusToString(game.status.state),
        extra: game.status.extra
      }]
    } else {
      return []
    }
  }

  // Returns a list containing statuses of every active game
  getInitialStatus(origin) {
    return Array.from(this.activeGames.keys())
      .filter(u => u[1] === origin)
      .reduce((list, u) => list.concat(this.getStatusForSite(u)), [])
  }

  setGameConfig(user, config) {
    const current = this.activeGames.get(user)
    if (current) {
      if (deepEqual(config, current.config)) {
        // Same config as before, no operation necessary
        return current.activeGameId
      }
      // Quit the currently active game so we can replace it
      sendCommand(this.nydus, current.activeGameId, 'quit')
    }
    if (!config.lobby) {
      this.activeGames.delete(user)
      return null
    }

    const gameId = cuid()
    const activeGamePromise = doLaunch(gameId, config.settings)
      .then(proc => proc.waitForExit(), err => this.handleGameLaunchError(gameId, err))
      .then(code => this.handleGameExit(gameId, code),
          err => this.handleGameExitWaitError(gameId, err))
    this.activeGames.set(user, {
      id: gameId,
      promise: activeGamePromise,
      routes: null,
      config,
      status: { state: GAME_STATUS_UNKNOWN, extra: null },
    })
    log.verbose(`Creating new game ${gameId} for user ${user}`)
    // TODO(tec27): this should be the spot that hole-punching happens, before we launch the game
    this._setStatus(user, GAME_STATUS_LAUNCHING)
    return gameId
  }

  setGameRoutes(gameId, routes) {
    const [, game] = this._findGameById(gameId)
    if (!game) {
      return
    }

    game.routes = routes
    sendCommand(this.nydus, game.id, 'setRoutes', routes)
  }

  handleGameConnected(id) {
    const [user, game] = this._findGameById(id)
    if (!game) {
      // Not our active game, must be one we started before and abandoned
      sendCommand(this.nydus, id, 'quit')
      log.verbose(`Game ${id} is not any of our active games, sending quit command`)
      return
    }

    this._setStatus(user, GAME_STATUS_CONFIGURING)
    // TODO(tec27): probably need to convert our config to something directly usable by the game
    // (e.g. with the punched addresses chosen)
    const { map } = game.config.lobby
    sendCommand(this.nydus, id, 'setConfig', {
      ...game.config,
      localMap: this.mapStore.getPath(map.hash, map.format)
    })

    if (game.routes) {
      sendCommand(this.nydus, game.id, 'setRoutes', game.routes)
    }
  }

  handleGameLaunchError(id, err) {
    log.error(`Error while launching game ${id}: ${err}`)
    const [user, game] = this._findGameById(id)
    if (game) {
      this._setStatus(user, GAME_STATUS_ERROR, err)
      this.activeGames.delete(user)
    }
  }

  handleSetupProgress(gameId, info) {
    const [user, game] = this._findGameById(gameId)
    if (!game) {
      return
    }
    this._setStatus(user, info.state, info.extra)
  }

  handleGameStart(gameId) {
    const [user, game] = this._findGameById(gameId)
    if (!game) {
      return
    }
    this._setStatus(user, GAME_STATUS_PLAYING)
  }

  handleGameEnd(gameId, results, time) {
    const [user, game] = this._findGameById(gameId)
    if (!game) {
      return
    }
    // TODO(tec27): this needs to be handled differently (psi should really be reporting these
    // directly to the server)
    log.verbose(`Game finished: ${JSON.stringify({ results, time })}`)
    this.nydus.publish(`/game/results/${encodeURIComponent(user[1])}`, { results, time })
    this._setStatus(user, GAME_STATUS_FINISHED)
  }

  handleGameExit(id, exitCode) {
    const [user, game] = this._findGameById(id)
    if (!game) {
      return
    }

    log.verbose(`Game ${id} exited with code 0x${exitCode.toString(16)}`)

    if (game.status.state < GAME_STATUS_FINISHED) {
      if (game.status.state >= GAME_STATUS_PLAYING) {
        // TODO(tec27): report a disc to the server
      } else {
        this._setStatus(user, GAME_STATUS_ERROR,
            new Error(`Game exited unexpectedly with code 0x${exitCode.toString(16)}`))
      }
    }

    this.activeGames.delete(user)
  }

  handleGameExitWaitError(id, err) {
    log.error(`Error while waiting for game ${id} to exit: ${err}`)
  }

  _setStatus(user, state, extra = null) {
    const game = this.activeGames.get(user)
    if (game) {
      game.status = { state, extra }
      const encodedOrigin = encodeURIComponent(user[1])
      this.nydus.publish(`/game/status/${encodedOrigin}`, this.getStatusForSite(user))
      log.verbose(`Game status for '${user}' updated to '${statusToString(state)}'`)
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

const accessAsync = thenify(fs.access)
const shieldbatteryRoot = path.dirname(process.execPath)
async function doLaunch(gameId, settings) {
  const { starcraftPath } = settings.local
  if (!starcraftPath) {
    throw new Error('No Starcraft path set')
  }
  const appPath = path.join(starcraftPath, 'starcraft.exe')
  try {
    await psi.checkStarcraftPath(appPath)
  } catch (err) {
    throw new Error(`Could not access/find Starcraft executable at ${appPath}: ${err}`)
  }

  log.debug('Attempting to launch ' + appPath)
  const proc = await psi.launchProcess({
    appPath,
    args: gameId,
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

  const shieldbatteryDll = path.join(shieldbatteryRoot, 'shieldbattery.dll')
  try {
    await accessAsync(shieldbatteryDll)
  } catch (err) {
    throw new Error(`Could not access/find shieldbattery dll at ${shieldbatteryDll}`)
  }

  log.debug(`Injecting ${shieldbatteryDll} into the process...`)
  const dataRoot = process.env.ProgramData ?
      path.join(process.env.ProgramData, 'shieldbattery') :
      path.dirname(path.resolve(process.argv[0]))
  const errorDumpPath = path.join(dataRoot, 'logs', 'inject_fail.dmp')
  try {
    await proc.injectDll(shieldbatteryDll, 'OnInject', errorDumpPath)
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
