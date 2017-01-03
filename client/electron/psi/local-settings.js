import fs from 'fs'
import { EventEmitter } from 'events'
import deepEqual from 'deep-equal'
import log from './logger'
import { getInstallPathFromRegistry } from './natives'

const VERSION = 2

class LocalSettings extends EventEmitter {
  constructor(filepath, creationPromise) {
    super()
    this._filepath = filepath
    this._creationPromise = creationPromise
    this._settings = null
    this._watcher = null

    this._initialized = this._creationPromise.then(async () => {
      try {
        this._settings = JSON.parse(fs.readFileSync(filepath, { encoding: 'utf8' }))
      } catch (err) {
        log.error('Error parsing settings file: ' + err)
      }
      if (!this._settings) {
        throw new Error('Could not read settings file')
      }

      await this.migrateOldSettings()

      this._watcher = this._createWatcher(filepath)
    })

    this._initialized.catch(err => {
      log.error('Error opening settings: ' + err)
    })
  }

  // Pulled out due to the bug in babel arrow function transformer that screws with super() calls
  _createWatcher(filepath) {
    return fs.watch(filepath, event => this.onFileChange(event))
  }

  onFileChange(event) {
    if (event === 'change') {
      fs.readFile(this._filepath, { encoding: 'utf8' },
          (err, data) => this.onFileContents(err, data))
    }
  }

  onFileContents(err, data) {
    if (err) {
      log.error('Error getting settings file contents: ' + err)
      return
    }

    try {
      const newData = JSON.parse(data)
      if (!deepEqual(newData, this._settings)) {
        this._settings = newData
        this.emit('change')
      }
      log.verbose('Got new settings: ' + JSON.stringify(this._settings))
    } catch (err) {
      log.error('Error parsing settings file: ' + err)
    }
  }

  stopWatching() {
    if (this._watcher) {
      this._watcher.close()
      this._watcher = null
    }
  }

  async migrateOldSettings() {
    const newSettings = { ...this._settings }
    let updated = false
    if (!this._settings.starcraftPath) {
      log.verbose('Migrating old settings, finding starcraft path')
      newSettings.starcraftPath = await findStarcraftPath()
      updated = true
    }
    if (!this._settings.version || this._settings.version < 2) {
      log.verbose('Found settings version 1, migrating to version 2')
      newSettings.version = VERSION
      delete newSettings.bwPort
      newSettings.mouseSensitivity = migrateV1MouseSensitivity(this._settings.mouseSensitivity)
      updated = true
    }

    if (updated) {
      this.settings = newSettings
    }
  }

  get settings() {
    return this._settings
  }

  set settings(toSet) {
    this._initialized.then(() => {
      const newSettings = {
        ...toSet,
        version: VERSION,
      }
      if (deepEqual(newSettings, this._settings)) {
        return
      }

      this._settings = newSettings
      const opts = { encoding: 'utf8' }
      fs.writeFile(this._filepath, jsonify(this._settings), opts, err => {
        if (err) {
          log.error('Error writing to settings file: ' + err)
        }
      })
      this.emit('change')
    })
  }
}

export default function(filepath) {
  const creationPromise = fs.existsSync(filepath) ? Promise.resolve() : createSettingsFile(filepath)
  return new LocalSettings(filepath, creationPromise)
}

async function createSettingsFile(filepath) {
  // create an object with any "generated defaults"
  const settings = {
    version: VERSION,
    starcraftPath: await findStarcraftPath()
  }
  return new Promise((resolve, reject) => {
    fs.writeFile(filepath, jsonify(settings), { encoding: 'utf8' }, err => {
      if (err) {
        reject(err)
      } else {
        resolve()
      }
    })
  })
}

export async function findStarcraftPath() {
  let starcraftPath = await getInstallPathFromRegistry()
  if (!starcraftPath) {
    log.warning('No Starcraft path found in registry, defaulting to standard install location')
    starcraftPath = process.env['ProgramFiles(x86)'] ?
        `${process.env['ProgramFiles(x86)']}\\Starcraft` :
        `${process.env.ProgramFiles}\\Starcraft`
  }

  return starcraftPath
}

function jsonify(settings) {
  return JSON.stringify(settings, null, 2)
}

function migrateV1MouseSensitivity(oldSens) {
  if (oldSens === undefined) {
    return undefined
  }

  switch (oldSens) {
    case 0: return 0
    case 1: return 3
    case 2: return 5
    case 3: return 8
    case 4: return 10
    default: return 0
  }
}
