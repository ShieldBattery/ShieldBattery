import path from 'path'
import cuid from 'cuid'
import deepEqual from 'deep-equal'
import * as psi from './natives/index'
import log from './logger'
import { sendCommand } from './game-command'

export default class ActiveGameManager {
  constructor(nydus) {
    this.nydus = nydus
    this.activeGameId = null
    this.config = null
    this.status = null
  }

  get id() {
    return this.activeGameId
  }

  getStatus() {
    return this.status
  }

  setGameConfig(config) {
    if (deepEqual(config, this.config)) {
      // Same config as before, no operation necessary
      return
    }
    if (this.activeGameId) {
      // Quit the currently active game so we can replace it
      sendCommand(this.nydus, this.activeGameId, 'quit')
    }
    if (!config) {
      this._setStatus(null)
      return
    }

    this.config = config
    this.activeGameId = cuid()
    // TODO(tec27): this should be the spot that hole-punching happens, before we launch the game
    this._setStatus('launching')
    doLaunch(this.activeGameId)
  }

  handleGameConnected(id) {
    if (id !== this.activeGameId) {
      // Not our active game, must be one we started before and abandoned
      sendCommand(this.nydus, id, 'quit')
      log.verbose(`Game ${id} is not our active game [${this.activeGameId}], sending quit command`)
      return
    }

    this._setStatus('configuring')
    // TODO(tec27): probably need to convert our config to something directly usable by the game
    // (e.g. with the punched addresses chosen)
    sendCommand(this.nydus, id, 'setConfig', this.config)
  }

  handleGameDisconnected(id) {
    if (id !== this.activeGameId) {
      // Who cares, shut up
      return
    }

    this._setStatus(null)
    this.activeGameId = null
    this.config = null
  }

  handleSetupProgress(gameId, status) {
    this._setStatus(status)
  }

  handleGameStart(gameId) {
    this._setStatus('playing')
  }

  handleGameEnd(gameId, results, time) {
    log.verbose(`Game finished: ${JSON.stringify({ results, time })}`)
    this.nydus.publish('/game/results', { results, time })
    this._setStatus('done')
  }

  _setStatus(status) {
    this.status = status
    this.nydus.publish('/game/status', status)
    log.verbose(`Game status updated to '${status}'`)
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

  const proc = await psi.launchProcess({
    appPath,
    args: gameId,
    launchSuspended: true,
    currentDir: installPath,
  })
  log.verbose('Process launched')
  const shieldbatteryDll = path.join(shieldbatteryRoot, 'shieldbattery.dll')
  await proc.injectDll(shieldbatteryDll, 'OnInject')
  log.verbose('Dll injected. Attempting to resume process...')
  proc.resume()
  log.verbose('Process resumed')
}
