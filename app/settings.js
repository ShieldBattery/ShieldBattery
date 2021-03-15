import fs, { promises as fsPromises } from 'fs'
import { EventEmitter } from 'events'
import deepEqual from 'deep-equal'
import { Map } from 'immutable'
import log from './logger'
import { findInstallPath } from './find-install-path'

const VERSION = 6
const SCR_VERSION = 2

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
// logic.
class Settings extends EventEmitter {
  static EVENT = 'change'

  constructor(filepath, initializeFunc) {
    super()
    this._filepath = filepath
    this._settings = null

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

      fs.watch(this._filepath, event => this._onFileChange(event))
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
      gameWinWidth: -1, // This setting is only used in v1.16.1 for now; use it in SC:R eventually
      gameWinHeight: -1, // Ditto
      v1161displayMode: 0,
      v1161mouseSensitivity: 0,
      v1161maintainAspectRatio: true,
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

// Mapping of setting names between SB and SC:R, where the names used in SB are the keys, and the
// names used in SC:R are the values. Used for converting from SB -> SC:R settings (when saving). To
// convert from SC:R -> SB settings (when fetching) use the inverse map below.
export const sbToScrMapping = new Map([
  ['keyboardScrollSpeed', 'm_kscroll'],
  ['mouseScrollSpeed', 'm_mscroll'],
  ['mouseSensitivityOn', 'MouseUseSensitivity'],
  ['mouseSensitivity', 'MouseSensitivity'],
  ['mouseScalingOn', 'MouseScaling'],
  ['hardwareCursorOn', 'MouseHardwareCursor'],
  ['mouseConfineOn', 'MouseConfine'],
  ['musicOn', 'MusicEnabled'],
  ['musicVolume', 'music'],
  ['soundOn', 'SfxEnabled'],
  ['soundVolume', 'sfx'],
  ['unitSpeechOn', 'unitspeech'],
  ['unitAcknowledgementsOn', 'unitnoise'],
  ['backgroundSoundsOn', 'SoundInBackground'],
  ['buildingSoundsOn', 'bldgnoise'],
  ['gameSubtitlesOn', 'trigtext'],
  ['cinematicSubtitlesOn', 'cinematicSubtitlesEnabled'],
  ['originalVoiceOversOn', 'originalUnitVO'],
  ['displayMode', 'WindowMode'],
  ['fpsLimitOn', 'FPSLimitEnabled'],
  ['fpsLimit', 'FPSLimit'],
  ['sdGraphicsFilter', 'SDFilterMode'],
  ['vsyncOn', 'VSync'],
  ['hdGraphicsOn', 'HDPreferences'],
  ['environmentEffectsOn', 'ShowFoliage'],
  ['realTimeLightingOn', 'RealtimeLightingEnabled'],
  ['smoothUnitTurningOn', 'UseHDRotation'],
  ['shadowStackingOn', 'ShadowStacking'],
  ['pillarboxOn', 'OriginalAspectRatio'],
  ['gameTimerOn', 'GameTimer'],
  ['colorCyclingOn', 'ColorCycle'],
  ['unitPortraits', 'UnitPortraits'],
  ['minimapPosition', 'consoleSplit'],
  ['apmDisplayOn', 'apm_Showing'],
  ['apmAlertOn', 'apm_AlertUser'],
  ['apmAlertValue', 'apm_AlertValue'],
  ['apmAlertColorOn', 'apm_AlertUseColor'],
  ['apmAlertSoundOn', 'apm_AlertUseSound'],
])

export const scrToSbMapping = sbToScrMapping.mapEntries(([key, value]) => [value, key])

export function fromScrToSb(scrSettings) {
  return Object.entries(scrSettings).reduce((acc, [name, value]) => {
    const sbKeyName = scrToSbMapping.get(name)

    if (sbKeyName) {
      acc[sbKeyName] = value
    }

    return acc
  }, {})
}

export function fromSbToScr(sbSettings) {
  return Object.entries(sbSettings).reduce((acc, [name, value]) => {
    const scrKeyName = sbToScrMapping.get(name)

    if (scrKeyName) {
      acc[scrKeyName] = value
    }

    return acc
  }, {})
}

export class ScrSettings extends Settings {
  constructor(filepath, scrFilepath) {
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

      if (!this._settings) {
        this._settings = await this._createDefaults()
        await fsPromises.writeFile(this._filepath, jsonify(this._settings), { encoding: 'utf8' })
      } else if (this._settings.version !== SCR_VERSION) {
        this._settings = this._migrateOldScrSettings(this._settings)
        await fsPromises.writeFile(this._filepath, jsonify(this._settings), { encoding: 'utf8' })
      }

      fs.watch(this._filepath, event => this._onFileChange(event))

      try {
        this._scrSettings = JSON.parse(
          await fsPromises.readFile(this._scrFilepath, { encoding: 'utf8' }),
        )
        // We only attach the watcher if the above doesn't throw, which means the settings exist.
        fs.watch(this._scrFilepath, event => this._onScrFileChange(event))
      } catch (err) {
        log.error('Error reading/parsing the sc:r settings file: ' + err)
      }
    }

    super(filepath, initializeFunc)
    this._scrFilepath = scrFilepath
    this._scrSettings = null
  }

  async _createDefaults() {
    let scrSettings

    try {
      scrSettings = JSON.parse(await fsPromises.readFile(this._scrFilepath, { encoding: 'utf8' }))
    } catch (err) {
      log.error('Error reading/parsing the SC:R settings file: ' + err)
      // TODO(2Pac): There's technically a scenario in which a user doesn't have the SC:R installed,
      // and then installs it while the application is running. As soon as they set the StarCraft
      // path to a correct SC:R version, they will be able to see (and change) their SC:R settings
      // even though they will be uninitialized. This should be fine though because as soon as they
      // save the settings, our own copy of the SC:R settings should be created with the new values.
      // So even though this is probably fine, gonna leave this TODO here in case it doesn't really
      // work as I imagined.
      scrSettings = {}
    }

    return {
      version: SCR_VERSION,
      ...fromScrToSb(scrSettings),
    }
  }

  _migrateOldScrSettings(settings) {
    const newSettings = { ...settings }
    // Fix integer settings to not be negative
    const intSettings = [
      'keyboardScrollSpeed',
      'mouseScrollSpeed',
      'mouseSensitivity',
      'musicVolume',
      'soundVolume',
      'displayMode',
      'fpsLimit',
      'sdGraphicsFilter',
      'unitPortraits',
      'apmAlertValue',
    ]
    for (const setting of intSettings) {
      if (newSettings[setting] < 0) {
        newSettings[setting] = 0
      }
    }
    newSettings.version = SCR_VERSION
    return newSettings
  }

  _onScrFileChange(event) {
    if (event === 'change') {
      this._readScrFile().catch(err => {
        log.error('Error reading/parsing the SC:R settings file: ' + err)
      })
    }
  }

  async _readScrFile() {
    await this._initialized
    const contents = await fsPromises.readFile(this._scrFilepath, { encoding: 'utf8' })
    const newData = JSON.parse(contents)
    if (!deepEqual(newData, this._scrSettings)) {
      this._scrSettings = newData
    }
  }

  // Function which overwrites SC:R settings with our own. This should be done before each game to
  // make sure the game is initialized with our settings, instead of Blizzard's.
  async overwrite() {
    await this._initialized
    const merged = Object.assign({}, this._scrSettings, fromSbToScr(this._settings))
    if (!deepEqual(merged, this._scrSettings)) {
      this._scrSettings = merged
      await fsPromises.writeFile(this._scrFilepath, jsonify(this._scrSettings), {
        encoding: 'utf8',
      })
    }
  }
}
