import path from 'path'
import fs from 'fs'
import cuid from 'cuid'
import deepEqual from 'deep-equal'
import thenify from 'thenify'
import { Map, Record } from 'immutable'
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

const SiteUser = new Record({
  username: null,
  origin: null,
})

export default class ActiveGameManager {
  constructor(nydus, mapStore) {
    this.nydus = nydus
    this.mapStore = mapStore
    // Maps SiteUser -> game info
    this.activeGames = new Map()
  }

  _findGameById(id) {
    for (const [ siteUser, config ] of this.activeGames.entries()) {
      if (config.id === id) {
        return [ siteUser, config ]
      }
    }
    log.verbose(`Game ${id} not found`)
    return [null, null]
  }

  getStatusForSite(siteUser) {
    const game = this.activeGames.get(siteUser)
    if (game) {
      return [{
        user: siteUser.username,
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
    return this.activeGames.keySeq()
      .filter(u => u.origin === origin)
      .reduce((list, u) => list.concat(this.getStatusForSite(u)), [])
  }

  setGameConfig([ username, origin ], config) {
    const siteUser = new SiteUser({ username, origin })
    const current = this.activeGames.get(siteUser)
    if (current) {
      if (deepEqual(config, current.config)) {
        // Same config as before, no operation necessary
        return current.id
      }
      // Quit the currently active game so we can replace it
      sendCommand(this.nydus, current.id, 'quit')
    }
    if (!config.lobby) {
      this.activeGames = this.activeGames.delete(siteUser)
      return null
    }

    const gameId = cuid()
    const activeGamePromise = doLaunch(gameId, config.settings)
      .then(proc => proc.waitForExit(), err => this.handleGameLaunchError(gameId, err))
      .then(code => this.handleGameExit(gameId, code),
          err => this.handleGameExitWaitError(gameId, err))
    this.activeGames = this.activeGames.set(siteUser, {
      id: gameId,
      promise: activeGamePromise,
      routes: null,
      config,
      status: { state: GAME_STATUS_UNKNOWN, extra: null },
    })
    log.verbose(`Creating new game ${gameId} for user ${siteUser}`)
    // TODO(tec27): this should be the spot that hole-punching happens, before we launch the game
    this._setStatus(siteUser, GAME_STATUS_LAUNCHING)
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
    const [siteUser, game] = this._findGameById(id)
    if (!game) {
      // Not our active game, must be one we started before and abandoned
      sendCommand(this.nydus, id, 'quit')
      log.verbose(`Game ${id} is not any of our active games, sending quit command`)
      return
    }

    this._setStatus(siteUser, GAME_STATUS_CONFIGURING)
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
    const [siteUser, game] = this._findGameById(id)
    if (game) {
      this._setStatus(siteUser, GAME_STATUS_ERROR, err)
      this.activeGames = this.activeGames.delete(siteUser)
    }
  }

  handleSetupProgress(gameId, info) {
    const [siteUser, game] = this._findGameById(gameId)
    if (!game) {
      return
    }
    this._setStatus(siteUser, info.state, info.extra)
  }

  handleGameStart(gameId) {
    const [siteUser, game] = this._findGameById(gameId)
    if (!game) {
      return
    }
    this._setStatus(siteUser, GAME_STATUS_PLAYING)
  }

  handleGameEnd(gameId, results, time) {
    const [siteUser, game] = this._findGameById(gameId)
    if (!game) {
      return
    }
    // TODO(tec27): this needs to be handled differently (psi should really be reporting these
    // directly to the server)
    log.verbose(`Game finished: ${JSON.stringify({ results, time })}`)
    this.nydus.publish(`/game/results/${encodeURIComponent(siteUser.origin)}`, { results, time })
    this._setStatus(siteUser, GAME_STATUS_FINISHED)
  }

  handleGameExit(id, exitCode) {
    const [siteUser, game] = this._findGameById(id)
    if (!game) {
      return
    }

    log.verbose(`Game ${id} exited with code 0x${exitCode.toString(16)}`)

    if (game.status.state < GAME_STATUS_FINISHED) {
      if (game.status.state >= GAME_STATUS_PLAYING) {
        // TODO(tec27): report a disc to the server
        // FIXME FIXME FIXME
      } else {
        this._setStatus(siteUser, GAME_STATUS_ERROR,
            new Error(`Game exited unexpectedly with code 0x${exitCode.toString(16)}`))
      }
    }

    this.activeGames = this.activeGames.delete(siteUser)
  }

  handleGameExitWaitError(id, err) {
    log.error(`Error while waiting for game ${id} to exit: ${err}`)
  }

  _setStatus(siteUser, state, extra = null) {
    const game = this.activeGames.get(siteUser)
    if (game) {
      game.status = { state, extra }
      const encodedOrigin = encodeURIComponent(siteUser.origin)
      this.nydus.publish(`/game/status/${encodedOrigin}`, this.getStatusForSite(siteUser))
      log.verbose(`Game status for '${siteUser}' updated to '${statusToString(state)}'`)
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
