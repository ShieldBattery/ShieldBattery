import deepEqual from 'deep-equal'
import fs, { promises as fsPromises } from 'fs'
import { Map } from 'immutable'
import { ConditionalKeys } from 'type-fest'
import { LocalSettingsData, ScrSettingsData } from '../common/local-settings'
import { TypedEventEmitter } from '../common/typed-emitter'
import { findInstallPath } from './find-install-path'
import log from './logger'

const VERSION = 9
const SCR_VERSION = 3

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

function jsonify(settings: unknown) {
  return JSON.stringify(settings, null, 2)
}

interface SettingsEvents<T> {
  change: (settings: Readonly<Partial<T>>) => void
}

// A general class that the local settings and SC:R settings can both use to handle their respective
// logic.
abstract class Settings<T> extends TypedEventEmitter<SettingsEvents<T>> {
  protected abstract settings: Partial<T>
  protected initialized: Promise<void>

  constructor(
    private settingsName: string,
    protected filepath: string,
    initializeFunc: () => Promise<void>,
  ) {
    super()

    this.initialized = initializeFunc.apply(this)
    this.initialized.then(() => {
      this.emitChange()
    })
  }

  untilInitialized(): Promise<void> {
    return this.initialized
  }

  async get(): Promise<Partial<T>> {
    await this.initialized
    return this.settings
  }

  async merge(settings: Readonly<Partial<T>>): Promise<void> {
    await this.initialized
    const merged = { ...this.settings, ...settings }
    if (!deepEqual(merged, this.settings)) {
      this.settings = merged
      await fsPromises.writeFile(this.filepath, jsonify(this.settings), { encoding: 'utf8' })
      this.emitChange()
    }
  }

  protected onFileChange(event: 'change' | 'rename'): void {
    if (event === 'change') {
      this.readFile().catch(err => {
        log.error(
          `Error reading/parsing the ${this.settingsName} settings file: ${err.stack ?? err}`,
        )
      })
    }
  }

  private async readFile(): Promise<void> {
    await this.initialized
    const contents = await fsPromises.readFile(this.filepath, { encoding: 'utf8' })
    const newData = JSON.parse(contents) as T
    if (!deepEqual(newData, this.settings)) {
      this.settings = newData
      this.emitChange()
      log.verbose(
        `Got new ${this.settingsName} settings from file change: ${JSON.stringify(this.settings)}`,
      )
    }
  }

  private emitChange(): void {
    this.emit('change', this.settings)
  }
}

function migrateV1MouseSensitivity(oldSens: number | undefined) {
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

export class LocalSettings extends Settings<LocalSettingsData> {
  protected settings!: Partial<LocalSettingsData>

  constructor(filepath: string) {
    const initializeFunc = async function (this: LocalSettings) {
      try {
        this.settings = JSON.parse(await fsPromises.readFile(this.filepath, { encoding: 'utf8' }))
      } catch (err) {
        log.error('Error reading/parsing local settings file: ' + err + ', creating')
        try {
          await fsPromises.unlink(this.filepath)
        } catch (err) {
          // Ignored, probably just due to the file not existing
        }
      }

      if (!this.settings) {
        this.settings = await this.createDefaults()
        await fsPromises.writeFile(this.filepath, jsonify(this.settings), { encoding: 'utf8' })
      } else if (this.settings.version !== VERSION) {
        this.settings = await this.migrateOldSettings(this.settings)
        await fsPromises.writeFile(this.filepath, jsonify(this.settings), { encoding: 'utf8' })
      }

      fs.watch(this.filepath, event => this.onFileChange(event))
    }

    super('local', filepath, initializeFunc)
  }

  private async createDefaults(): Promise<LocalSettingsData> {
    return {
      version: VERSION,
      runAppAtSystemStart: true,
      runAppAtSystemStartMinimized: false,
      starcraftPath: await findStarcraftPath(),
      winX: -1,
      winY: -1,
      winWidth: -1,
      winHeight: -1,
      winMaximized: false,
      masterVolume: 50,
      // Game window pos/size settings are only used in v1.16.1 for now; use it in SC:R eventually
      gameWinX: -1,
      gameWinY: -1,
      gameWinWidth: -1,
      gameWinHeight: -1,
      v1161displayMode: 0,
      v1161mouseSensitivity: 0,
      v1161maintainAspectRatio: true,
      trustedDomains: [],
    }
  }

  // TODO(tec27): Type the old settings files
  private async migrateOldSettings(settings: Partial<LocalSettingsData>) {
    const newSettings = { ...settings }
    if (!settings.starcraftPath) {
      log.verbose('Migrating old local settings, finding starcraft path')
      newSettings.starcraftPath = await findStarcraftPath()
    }
    if (!settings.version || settings.version < 2) {
      log.verbose('Found settings version 1, migrating to version 2')
      delete (newSettings as any).bwPort
      ;(newSettings as any).mouseSensitivity = migrateV1MouseSensitivity(
        (this.settings as any).mouseSensitivity,
      )
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
      delete (newSettings as any).renderer
    }
    if (!settings.version || settings.version < 5) {
      log.verbose('Found settings version 4, migrating to version 5')
      newSettings.masterVolume = 50
    }
    if (!settings.version || settings.version < 6) {
      log.verbose('Found settings version 5, migrating to version 6')
      newSettings.gameWinWidth = (settings as any).width
      newSettings.gameWinHeight = (settings as any).height
      newSettings.v1161displayMode = (settings as any).displayMode
      newSettings.v1161maintainAspectRatio = (settings as any).maintainAspectRatio
      newSettings.v1161mouseSensitivity = (settings as any).mouseSensitivity

      delete (newSettings as any).width
      delete (newSettings as any).height
      delete (newSettings as any).displayMode
      delete (newSettings as any).maintainAspectRatio
      delete (newSettings as any).mouseSensitivity
    }

    if (!settings.version || settings.version < 7) {
      log.verbose('Found settings version 6, migrating to version 7')
      newSettings.runAppAtSystemStart = true
    }

    if (!settings.version || settings.version < 8) {
      log.verbose('Found settings version 7, migrating to version 8')
      newSettings.runAppAtSystemStartMinimized = false
    }

    if (!settings.version || settings.version < 9) {
      log.verbose('Found settings version 8, migrating to version 9')
      newSettings.trustedDomains = []
    }

    newSettings.version = VERSION
    return newSettings
  }
}

/**
 * Mapping of setting names between SB and SC:R, where the names used in SB are the keys, and the
 * names used in SC:R are the values. Used for converting from SB -> SC:R settings (when saving). To
 * convert from SC:R -> SB settings (when fetching) use the inverse map below.
 *
 * NOTE(tec27): The typing here does very little in current versions of TS, since it allows either
 * side of the tuple to match to 'string' :/
 */
export const sbToScrMapping = Map<Omit<keyof ScrSettingsData, 'version'>, string>([
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
  ['consoleSkin', 'selectedConsole'],
  ['selectedSkin', 'selectedSkin'],
  ['showBonusSkins', 'skinsEnabled'],
])

export const scrToSbMapping = sbToScrMapping.mapEntries(([key, value]) => [value, key])

export function fromBlizzardToSb(blizzardSettings: Record<string, any>): Partial<ScrSettingsData> {
  return Object.entries(blizzardSettings).reduce((acc, [name, value]) => {
    const sbKeyName = scrToSbMapping.get(name)

    if (sbKeyName) {
      ;(acc as any)[sbKeyName as any] = value
    }

    return acc
  }, {} as Partial<ScrSettingsData>)
}

export function fromSbToBlizzard(sbSettings: Partial<ScrSettingsData>): Record<string, any> {
  return Object.entries(sbSettings).reduce((acc, [name, value]) => {
    const scrKeyName = sbToScrMapping.get(name)

    if (scrKeyName) {
      acc[scrKeyName] = value
    }

    return acc
  }, {} as Record<string, any>)
}

export class ScrSettings extends Settings<ScrSettingsData> {
  protected settings!: Partial<ScrSettingsData>
  private blizzardFilepath: string
  private blizzardSettings!: Record<string, any>

  constructor(filepath: string, blizzardFilepath: string) {
    const initializeFunc = async function (this: ScrSettings) {
      try {
        this.settings = JSON.parse(await fsPromises.readFile(this.filepath, { encoding: 'utf8' }))
      } catch (err) {
        log.error('Error reading/parsing SCR settings file: ' + err + ', creating')
        try {
          await fsPromises.unlink(this.filepath)
        } catch (err) {
          // Ignored, probably just due to the file not existing
        }
      }

      try {
        this.blizzardSettings = JSON.parse(
          await fsPromises.readFile(this.blizzardFilepath, { encoding: 'utf8' }),
        )
        // We only attach the watcher if the above doesn't throw, which means the settings exist.
        // TODO(tec27): We should probably be watching the directory if we can't watch the file
        // itself (or create the file empty ourselves?) so that we can monitor any changes SC:R
        // might make to it if launched after SB runs
        fs.watch(this.blizzardFilepath, event => this.onBlizzardFileChange(event))
      } catch (err) {
        log.error(
          'Error reading/parsing the Blizzard settings file: ' + ((err as any).stack ?? err),
        )
        this.blizzardSettings = {}
      }

      if (!this.settings) {
        this.settings = await this.createDefaults()
        await fsPromises.writeFile(this.filepath, jsonify(this.settings), { encoding: 'utf8' })
      } else if (this.settings.version !== SCR_VERSION) {
        this.settings = this.migrateOldSettings(this.settings)
        await fsPromises.writeFile(this.filepath, jsonify(this.settings), { encoding: 'utf8' })
      }

      fs.watch(this.filepath, event => this.onFileChange(event))
    }

    super('SCR', filepath, initializeFunc)
    this.blizzardFilepath = blizzardFilepath
  }

  private async createDefaults() {
    // NOTE(tec27): This is always called *after* we initialize scrSettings the first time. If the
    // `initialize` function above gets rearranged that may no longer be true  (so don't do that :))
    return {
      version: SCR_VERSION,
      ...fromBlizzardToSb(this.blizzardSettings),
    }
  }

  private migrateOldSettings(settings: Partial<ScrSettingsData>) {
    const newSettings = { ...settings }
    if (!newSettings.version || newSettings.version < 2) {
      // Fix integer settings to not be negative
      const intSettings: Array<ConditionalKeys<ScrSettingsData, number>> = [
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
        const oldSetting = newSettings[setting]
        if (oldSetting !== undefined && oldSetting < 0) {
          newSettings[setting] = 0
        }
      }
      newSettings.version = 2
    }
    if (newSettings.version < 3) {
      // Add settings related to skins (console and ingame), defaulting to whatever people have in
      // their Blizzard file

      // NOTE(tec27): Like `createDefaults` above, this is always called *after* scrSettings has
      // been loaded
      const blizzSettings = fromBlizzardToSb(this.blizzardSettings)
      newSettings.consoleSkin = blizzSettings.consoleSkin
      newSettings.selectedSkin = blizzSettings.selectedSkin
      newSettings.showBonusSkins = blizzSettings.showBonusSkins
      newSettings.version = 3
    }

    newSettings.version = SCR_VERSION
    return newSettings
  }

  private onBlizzardFileChange(event: 'change' | 'rename') {
    if (event === 'change') {
      this.readBlizzardFile().catch(err => {
        log.error('Error reading/parsing the Blizzard settings file: ' + (err.stack ?? err))
      })
    }
  }

  private async readBlizzardFile() {
    await this.initialized
    const contents = await fsPromises.readFile(this.blizzardFilepath, { encoding: 'utf8' })
    const newData = JSON.parse(contents)
    if (!deepEqual(newData, this.blizzardSettings)) {
      this.blizzardSettings = newData
    }
  }

  // Function which overwrites the Blizzard settings with our own. This should be done before each
  // game to make sure the game is initialized with our settings, instead of Blizzard's.
  async overwriteBlizzardSettingsFile() {
    await this.initialized
    const merged = { ...this.blizzardSettings, ...fromSbToBlizzard(this.settings) }
    if (!deepEqual(merged, this.blizzardSettings)) {
      this.blizzardSettings = merged
      await fsPromises.writeFile(this.blizzardFilepath, jsonify(this.blizzardSettings), {
        encoding: 'utf8',
      })
    }
  }
}
