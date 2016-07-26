import path from 'path'
import { checkStarcraftPath } from './natives/index'
import log from './logger'

const MAX_VALID_TIME = 2.5 * 60 * 1000

export default class PathValidator {
  lastCheckDate = -1
  lastCheckedSettings = null
  lastHadValidPath = false
  lastHadValidVersion = false

  constructor(onNewValidity) {
    this.onNewValidity = onNewValidity
  }

  getPathValidity(settings) {
    const curDate = Date.now()
    if (this.lastCheckedSettings !== settings ||
        curDate < this.lastCheckDate || curDate - this.lastCheckDate > MAX_VALID_TIME) {
      this._checkValidity(settings)
    }

    return { path: this.lastHadValidPath, version: this.lastHadValidVersion }
  }

  _checkValidity(settings) {
    this._hasValidPath(settings).then(result => this.onNewValidity(result))
  }

  async _hasValidPath(settings) {
    this.lastCheckDate = Date.now()
    this.lastCheckedSettings = settings

    if (!settings.starcraftPath) {
      this.lastHadValidPath = false
      this.lastHadValidVersion = false
      log.debug('StarCraft path invalid because no path is set')
    } else {
      try {
        await checkStarcraftPath(path.join(settings.starcraftPath, 'starcraft.exe'))
        this.lastHadValidPath = true
        this.lastHadValidVersion = true
        log.debug('StarCraft path is valid')
      } catch (e) {
        if (e.name === 'ProductVersionError') {
          this.lastHadValidPath = true
          this.lastHadValidVersion = false
          log.debug('StarCraft path is valid, but the version is incorrect')
        } else {
          this.lastHadValidPath = false
          this.lastHadValidVersion = false
          log.debug('StarCraft path is invalid, error was: ' + e)
        }
      }
    }

    return { path: this.lastHadValidPath, version: this.lastHadValidVersion }
  }
}
