import path from 'path'
import cuid from 'cuid'
import psi from './natives/index'
import log from './psi/logger'

export default class ActiveGameManager {
  constructor() {
    this._activeGame = null
  }

  get id() {
    return this._activeGame
  }

  getStatus() {
    return null // TODO
  }

  launchGame(config) {

  }

  handleGameConnected(id) {
    return false // TODO
  }

  handleGameDisconnected(id) {
    // TODO
  }

  handleSetupProgress(/* TODO */) {
  }

  handleGameReady(/* TODO */) {
  }

  handleGameEnd(/* TODO */) {
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
  // TODO(tec27): wait for the game to connect
}
