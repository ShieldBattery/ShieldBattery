import fs, { promises as fsPromises } from 'fs'
import { EventEmitter } from 'events'
import deepEqual from 'deep-equal'
import log from './logger'
import { findInstallPath } from './find-install-path'

const VERSION = 6

async function findStarcraftPath() {
  let starcraftPath = await findInstallPath()
  if (!starcraftPath) {
    log.warning('No Starcraft path found in registry, defaulting to standard install location')
    starcraftPath = process.env['ProgramFiles(x86)']
      ? `${process.env['ProgramFiles(x86)']}\\Starcraft`
      : `${process.env.ProgramFiles}\\Starcraft`
  }

  return starcraftPath
}

function jsonify(settings) {
  return JSON.stringify(settings, null, 2)
}

// A general class that the local settings and SC:R settings can both use to handle their respective
// logic. Currently, the only difference between local settings and SC:R settings is that we don't
// try to create the SC:R settings file if it doesn't exist.
class Settings extends EventEmitter {
  static EVENT = 'change'

  constructor(filepath, initializeFunc) {
    super()
    this._filepath = filepath
    this._settings = null
    this._watcher = null

    this._initialized = initializeFunc.apply(this)
    this._initialized.then(() => {
      this._emitChange()
    })
  }

  untilInitialized() {
    return this._initialized
  }

  async get() {
    await this._initialized
    return this._settings
  }

  async merge(settings) {
    await this._initialized
    const merged = Object.assign({}, this._settings, settings)
    if (!deepEqual(merged, this._settings)) {
      this._settings = merged
      await fsPromises.writeFile(this._filepath, jsonify(this._settings), { encoding: 'utf8' })
      this._emitChange()
    }
  }

  _onFileChange(event) {
    if (event === 'change') {
      this._readFile().catch(err => {
        log.error('Error reading/parsing the settings file: ' + err)
      })
    }
  }

  async _readFile() {
    await this._initialized
    const contents = await fsPromises.readFile(this._filepath, { encoding: 'utf8' })
    const newData = JSON.parse(contents)
    if (!deepEqual(newData, this._settings)) {
      this._settings = newData
      this._emitChange()
      log.verbose('Got new settings from file change: ' + JSON.stringify(this._settings))
    }
  }

  _emitChange() {
    this.emit('change', this._settings)
  }
}

export class LocalSettings extends Settings {
  constructor(filepath) {
    const initializeFunc = async function () {
      try {
        this._settings = JSON.parse(await fsPromises.readFile(this._filepath, { encoding: 'utf8' }))
      } catch (err) {
        log.error('Error reading/parsing settings file: ' + err + ', creating')
        try {
          await fsPromises.unlink(this._filepath)
        } catch (err) {
          // Ignored, probably just due to the file not existing
        }
      }
      // TODO(tec27): try to load the old settings location (in ProgramData)
      if (!this._settings) {
        this._settings = await this._createDefaults()
        await fsPromises.writeFile(this._filepath, jsonify(this._settings), { encoding: 'utf8' })
      } else if (this._settings.version !== VERSION) {
        this._settings = await this._migrateOldSettings(this._settings)
        await fsPromises.writeFile(this._filepath, jsonify(this._settings), { encoding: 'utf8' })
      }

      this._watcher = fs.watch(this._filepath, event => this._onFileChange(event))
    }

    super(filepath, initializeFunc)
  }

  async _createDefaults() {
    return {
      version: VERSION,
      starcraftPath: await findStarcraftPath(),
      winX: -1,
      winY: -1,
      winWidth: -1,
      winHeight: -1,
      winMaximized: false,
      masterVolume: 50,
    }
  }

  async _migrateOldSettings(settings) {
    const newSettings = { ...settings }
    if (!settings.starcraftPath) {
      log.verbose('Migrating old settings, finding starcraft path')
      newSettings.starcraftPath = await findStarcraftPath()
    }
    if (!settings.version || settings.version < 2) {
      log.verbose('Found settings version 1, migrating to version 2')
      delete newSettings.bwPort
      newSettings.mouseSensitivity = migrateV1MouseSensitivity(this._settings.mouseSensitivity)
    }
    if (!settings.version || settings.version < 3) {
      log.verbose('Found settings version 2, migrating to version 3')
      newSettings.winX = -1
      newSettings.winY = -1
      newSettings.winWidth = -1
      newSettings.winHeight = -1
      newSettings.winMaximized = false
    }
    if (!settings.version || settings.version < 4) {
      log.verbose('Found settings version 3, migrating to version 4')
      delete newSettings.renderer
    }
    if (!settings.version || settings.version < 5) {
      log.verbose('Found settings version 4, migrating to version 5')
      newSettings.masterVolume = 50
    }
    if (!settings.version || settings.version < 6) {
      log.verbose('Found settings version 5, migrating to version 6')
      newSettings.gameWinWidth = settings.width
      newSettings.gameWinHeight = settings.height
      newSettings.v1161displayMode = settings.displayMode
      newSettings.v1161maintainAspectRatio = settings.maintainAspectRatio
      newSettings.v1161mouseSensitivity = settings.mouseSensitivity

      delete newSettings.width
      delete newSettings.height
      delete newSettings.displayMode
      delete newSettings.maintainAspectRatio
      delete newSettings.mouseSensitivity
    }

    newSettings.version = VERSION
    return newSettings
  }
}

function migrateV1MouseSensitivity(oldSens) {
  if (oldSens === undefined) {
    return undefined
  }

  switch (oldSens) {
    case 0:
      return 0
    case 1:
      return 3
    case 2:
      return 5
    case 3:
      return 8
    case 4:
      return 10
    default:
      return 0
  }
}

export class ScrSettings extends Settings {
  constructor(filepath) {
    const initializeFunc = async function () {
      try {
        this._settings = JSON.parse(await fsPromises.readFile(this._filepath, { encoding: 'utf8' }))
        // We only attach the watcher if the above doesn't throw, which means the settings exist.
        this._watcher = fs.watch(this._filepath, event => this._onFileChange(event))
      } catch (err) {
        log.error('Error reading/parsing the sc:r settings file: ' + err)
      }
    }
    super(filepath, initializeFunc)
  }
}
