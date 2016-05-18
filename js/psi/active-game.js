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
    this.activeGameId = null
    this.activeGamePromise = null
    this.config = null
    this.status = { state: GAME_STATUS_UNKNOWN, extra: null }
  }

  get id() {
    return this.activeGameId
  }

  getStatusForSite() {
    return {
      id: this.activeGameId,
      state: statusToString(this.status.state),
      extra: this.status.extra
    }
  }

  setGameConfig(config) {
    if (deepEqual(config, this.config)) {
      // Same config as before, no operation necessary
      return this.activeGameId
    }
    if (this.activeGameId) {
      // Quit the currently active game so we can replace it
      sendCommand(this.nydus, this.activeGameId, 'quit')
    }
    if (!config) {
      this.activeGameId = null
      this.activeGamePromise = null
      this._setStatus(GAME_STATUS_UNKNOWN)
      return this.activeGameId
    }

    this.config = config
    const backupId = this.activeGameId = cuid()
    // TODO(tec27): this should be the spot that hole-punching happens, before we launch the game
    this._setStatus(GAME_STATUS_LAUNCHING)
    this.activeGamePromise = doLaunch(this.activeGameId, config.settings)
      .then(proc => proc.waitForExit(), err => this.handleGameLaunchError(backupId, err))
      .then(code => this.handleGameExit(backupId, code),
          err => this.handleGameExitWaitError(backupId, err))
    return this.activeGameId
  }

  handleGameConnected(id) {
    if (id !== this.activeGameId) {
      // Not our active game, must be one we started before and abandoned
      sendCommand(this.nydus, id, 'quit')
      log.verbose(`Game ${id} is not our active game [${this.activeGameId}], sending quit command`)
      return
    }

    this._setStatus(GAME_STATUS_CONFIGURING)
    // TODO(tec27): probably need to convert our config to something directly usable by the game
    // (e.g. with the punched addresses chosen)
    const { map } = this.config.lobby
    sendCommand(this.nydus, id, 'setConfig', {
      ...this.config,
      localMap: this.mapStore.getPath(map.hash, map.format)
    })
  }

  handleGameLaunchError(id, err) {
    log.error(`Error while launching game ${id}: ${err}`)
    if (id === this.activeGameId) {
      this._setStatus(GAME_STATUS_ERROR, err)

      this.activeGameId = null
      this.config = null
      this._setStatus(GAME_STATUS_UNKNOWN)
    }
  }

  handleSetupProgress(gameId, info) {
    this._setStatus(info.state, info.extra)
  }

  handleGameStart(gameId) {
    this._setStatus(GAME_STATUS_PLAYING)
  }

  handleGameEnd(gameId, results, time) {
    // TODO(tec27): this needs to be handled differently (psi should really be reporting these
    // directly to the server)
    log.verbose(`Game finished: ${JSON.stringify({ results, time })}`)
    this.nydus.publish('/game/results', { results, time })
    this._setStatus(GAME_STATUS_FINISHED)
  }

  handleGameExit(id, exitCode) {
    if (id !== this.activeGameId) {
      return
    }

    log.verbose(`Game ${id} exited with code 0x${exitCode.toString(16)}`)

    if (this.status.state < GAME_STATUS_FINISHED) {
      if (this.status.state >= GAME_STATUS_PLAYING) {
        // TODO(tec27): report a disc to the server
      } else {
        this._setStatus(GAME_STATUS_ERROR,
            new Error(`Game exited unexpectedly with code 0x${exitCode.toString(16)}`))
      }
    }

    this.activeGameId = null
    this.config = null
    this._setStatus(GAME_STATUS_UNKNOWN)
  }

  handleGameExitWaitError(id, err) {
    log.error(`Error while waiting for game ${id} to exit: ${err}`)
  }

  _setStatus(state, extra = null) {
    this.status = { state, extra }
    if (this.activeGameId) {
      this.nydus.publish('/game/status', this.getStatusForSite())
    }
    log.verbose(`Game status updated to '${statusToString(state)}'`)
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
  const appPath = path.join(starcraftPath, 'Starcraft.exe')
  try {
    await accessAsync(appPath)
  } catch (err) {
    throw new Error(`Could not access/find Starcraft executable at ${appPath}`)
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
