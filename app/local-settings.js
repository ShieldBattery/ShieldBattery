import fs from 'fs'
import { EventEmitter } from 'events'
import deepEqual from 'deep-equal'
import thenify from 'thenify'
import log from './logger'
import { findInstallPath } from './find-install-path'

const VERSION = 4

const readFileAsync = thenify(fs.readFile)
const writeFileAsync = thenify(fs.writeFile)
const unlinkAsync = thenify(fs.unlink)

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

export default class LocalSettings extends EventEmitter {
  static EVENT = 'change'

  constructor(filepath) {
    super()
    this._filepath = filepath
    this._settings = null
    this._watcher = null

    this._initialized = (async () => {
      try {
        this._settings = JSON.parse(await readFileAsync(this._filepath, { encoding: 'utf8' }))
      } catch (err) {
        log.error('Error reading/parsing settings file: ' + err + ', creating')
        try {
          await unlinkAsync(this._filepath)
        } catch (err) {
          // Ignored, probably just due to the file not existing
        }
      }
      // TODO(tec27): try to load the old settings location (in ProgramData)
      if (!this._settings) {
        this._settings = await this._createDefaults()
        await writeFileAsync(this._filepath, jsonify(this._settings), { encoding: 'utf8' })
      } else if (this._settings.version !== VERSION) {
        this._settings = await this._migrateOldSettings(this._settings)
        await writeFileAsync(this._filepath, jsonify(this._settings), { encoding: 'utf8' })
      }

      this._watcher = fs.watch(this._filepath, event => this._onFileChange(event))
    })()

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
      await writeFileAsync(this._filepath, jsonify(this._settings), { encoding: 'utf8' })
      this._emitChange()
    }
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

    newSettings.version = VERSION
    return newSettings
  }

  _onFileChange(event) {
    if (event === 'change') {
      this._readFile().catch(err => {
        log.error('Error reading/parsing settings file: ' + err)
      })
    }
  }

  async _readFile() {
    await this._initialized
    const contents = await readFileAsync(this._filepath, { encoding: 'utf8' })
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
