import path from 'path'
import cuid from 'cuid'
import deepEqual from 'deep-equal'
import * as psi from './natives/index'
import log from './logger'
import { sendCommand } from './game-command'
import {
  GAME_STATUS_UNKNOWN,
  GAME_STATUS_LAUNCHING,
  GAME_STATUS_CONFIGURING,
  GAME_STATUS_PLAYING,
  GAME_STATUS_FINISHED,
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
    this.activeGameId = cuid()
    // TODO(tec27): this should be the spot that hole-punching happens, before we launch the game
    this._setStatus(GAME_STATUS_LAUNCHING)
    this.activeGamePromise = doLaunch(this.activeGameId)

    const backupId = this.activeGameId
    this.activeGamePromise.then(code => this.handleGameExit(backupId, code),
        err => this.handleGameExitWaitErr(backupId, err))
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

    log.verbose(`Game ${id} exited with code ${exitCode}`)

    if (this.status.state < GAME_STATUS_FINISHED) {
      if (this.status.state >= GAME_STATUS_PLAYING) {
        // TODO(tec27): report a disc to the server
      } else {
        // TODO(tec27): report this exit back to the site so it can cancel the lobby load
      }
    }

    this.activeGameId = null
    this.config = null
    this._setStatus(GAME_STATUS_UNKNOWN)
  }

  handleGameExitWaitErr(id, err) {
    log.verbose(`Error while waiting for game ${id} to exit: ${err}`)
  }

  _setStatus(state, extra = null) {
    this.status = { state, extra }
    if (this.activeGameId) {
      this.nydus.publish('/game/status', this.getStatusForSite())
    }
    log.verbose(`Game status updated to '${statusToString(state)}'`)
  }
}

const shieldbatteryRoot = path.dirname(process.execPath)
async function doLaunch(gameId) {
  // TODO(tec27): we should also try to guess the install path as %ProgramFiles(x86)%/Starcraft and
  // %ProgramFiles%/Starcraft, and allow this to be set through the web interface as well
  let installPath = psi.getInstallPathFromRegistry()
  installPath = installPath || 'C:\\Program Files (x86)\\Starcraft'
  const appPath = installPath +
      (installPath.charAt(installPath.length - 1) === '\\' ? '' : '\\') +
      'Starcraft.exe'

  log.debug('Attempting to launch ' + appPath)
  const proc = await psi.launchProcess({
    appPath,
    args: gameId,
    launchSuspended: true,
    currentDir: installPath,
  })
  log.verbose('Process launched')
  const endPromise = proc.waitForExit()
  const shieldbatteryDll = path.join(shieldbatteryRoot, 'shieldbattery.dll')
  await proc.injectDll(shieldbatteryDll, 'OnInject')
  log.verbose('Dll injected. Attempting to resume process...')
  proc.resume()
  log.verbose('Process resumed')
  return endPromise
}
