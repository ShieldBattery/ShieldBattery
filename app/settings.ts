import deepEqual from 'deep-equal'
import fs, { promises as fsPromises } from 'fs'
import debounce from 'lodash/debounce'
import { ConditionalKeys } from 'type-fest'
import swallowNonBuiltins from '../common/async/swallow-non-builtins'
import { DEV_INDICATOR } from '../common/flags'
import { DEFAULT_LOCAL_SETTINGS } from '../common/settings/default-settings'
import { LocalSettings, ScrSettings, StartingFog } from '../common/settings/local-settings'
import { TypedEventEmitter } from '../common/typed-emitter'
import { findInstallPath } from './find-install-path'
import log from './logger'

const VERSION = 13
const SCR_VERSION = 5

async function findStarcraftPath() {
  let starcraftPath = await findInstallPath()
  if (!starcraftPath) {
    log.warning('No Starcraft path found in search, defaulting to standard install location')
    starcraftPath = process.env['ProgramFiles(x86)']
      ? `${process.env['ProgramFiles(x86)']}\\Starcraft`
      : `${process.env.ProgramFiles}\\Starcraft`
  }

  return starcraftPath
}

function jsonify(settings: unknown) {
  return JSON.stringify(settings, null, 2)
}

type SettingsEvents<T> = {
  change: (settings: Readonly<Partial<T>>) => void
}

// A general class that the local settings and SC:R settings can both use to handle their respective
// logic.
abstract class SettingsManager<T> extends TypedEventEmitter<SettingsEvents<T>> {
  protected abstract settings: Partial<T>
  protected initialized: Promise<void>
  protected settingsDirty = false

  constructor(
    private settingsName: string,
    protected filepath: string,
    initializeFunc: () => Promise<void>,
  ) {
    super()

    this.initialized = initializeFunc.apply(this).catch(err => {
      log.error(`Error initializing the ${this.settingsName} settings file: ${err.stack ?? err}`)
    })
    this.initialized
      .then(() => {
        this.emitChange()
      })
      .catch(swallowNonBuiltins)
  }

  untilInitialized(): Promise<void> {
    return this.initialized
  }

  async get(): Promise<Partial<T>> {
    await this.initialized
    return this.settings
  }

  debouncedFileWrite = debounce(() => {
    if (this.settingsDirty) {
      this.settingsDirty = false
      fsPromises
        .writeFile(this.filepath, jsonify(this.settings), { encoding: 'utf8' })
        .catch(err => {
          this.settingsDirty = true
          log.error(`Error saving the ${this.settingsName} settings file: ${err.stack ?? err}`)
        })
    }
  }, 400)

  saveSettingsToDiskSync() {
    if (this.settingsDirty) {
      this.settingsDirty = false
      try {
        fs.writeFileSync(this.filepath, jsonify(this.settings), { encoding: 'utf8' })
      } catch (err: any) {
        this.settingsDirty = true
        log.error(`Error saving the ${this.settingsName} settings file: ${err.stack ?? err}`)
      }
    }
  }

  async merge(settings: Readonly<Partial<T>>): Promise<void> {
    await this.initialized
    const merged = { ...this.settings, ...settings }
    if (!deepEqual(merged, this.settings)) {
      this.settings = merged
      this.emitChange()

      this.settingsDirty = true
      this.debouncedFileWrite()
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

export class LocalSettingsManager extends SettingsManager<LocalSettings> {
  protected settings!: Partial<LocalSettings>

  constructor(filepath: string) {
    const initializeFunc = async function (this: LocalSettingsManager) {
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

  private async createDefaults(): Promise<LocalSettings> {
    return {
      ...DEFAULT_LOCAL_SETTINGS,
      version: VERSION,
      starcraftPath: await findStarcraftPath(),
      winX: -1,
      winY: -1,
      winWidth: -1,
      winHeight: -1,
      winMaximized: false,
    }
  }

  override async get(): Promise<Partial<LocalSettings>> {
    const settings = await super.get()
    // Remove settings gated by flags, so that you don't have to start a dev client to reset them if
    // they were left on.
    if (!DEV_INDICATOR) {
      delete settings.visualizeNetworkStalls
      delete settings.disableHd
      delete settings.launch64Bit
    }
    return settings
  }

  // TODO(tec27): Type the old settings files
  private async migrateOldSettings(settings: Partial<LocalSettings>) {
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

    // NOTE(tec27): Settings version 9 was reverted in 10, so there's no migration from 8 to 10
    if (settings.version === 9) {
      log.verbose('Found settings version 9, migrating to version 10')
      delete (newSettings as any).trustedDomains
    }

    if (!settings.version || settings.version < 11) {
      log.verbose('Found settings version 10, migrating to version 11')
      newSettings.quickOpenReplays = false
    }

    if (!settings.version || settings.version < 12) {
      log.verbose('Found settings version 11, migrating to version 12')
      newSettings.startingFog = StartingFog.Transparent
    }

    if (!settings.version || settings.version < 13) {
      log.verbose('Found settings version 12, migrating to version 13')
      // NOTE(tec27): These settings still exist, but the tracking for them before this version
      // was not good, and tracked fullscreen positions as well, so we clear them out now that the
      // tracking is improved.
      delete newSettings.gameWinX
      delete newSettings.gameWinY
      delete newSettings.gameWinWidth
      delete newSettings.gameWinHeight
    }

    newSettings.version = VERSION
    return newSettings
  }
}

/**
 * Mapping of setting names between SB and SC:R, where the names used in SB are the keys, and the
 * names used in SC:R are the values. Used for converting from SB -> SC:R settings (when saving). To
 * convert from SC:R -> SB settings (when fetching) use the inverse map below.
 */
export const sbToScrMapping: ReadonlyMap<Omit<keyof ScrSettings, 'version'>, string> = new Map([
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
  ['selectedAnnouncer', 'selectedAnnouncer'],
  ['showFps', 'ShowFPS'],
  ['showTurnRate', 'ShowTurnRate'],
])

export const scrToSbMapping: ReadonlyMap<string, Omit<keyof ScrSettings, 'version'>> = new Map(
  Array.from(sbToScrMapping.entries(), ([key, value]) => [value, key]),
)

export function fromBlizzardToSb(blizzardSettings: Record<string, any>): Partial<ScrSettings> {
  return Object.entries(blizzardSettings).reduce((acc, [name, value]) => {
    const sbKeyName = scrToSbMapping.get(name)

    if (sbKeyName) {
      ;(acc as any)[sbKeyName as any] = value
    }

    return acc
  }, {} as Partial<ScrSettings>)
}

export function fromSbToBlizzard(sbSettings: Partial<ScrSettings>): Record<string, any> {
  return Object.entries(sbSettings).reduce(
    (acc, [name, value]) => {
      const scrKeyName = sbToScrMapping.get(name)

      if (scrKeyName) {
        acc[scrKeyName] = value
      }

      return acc
    },
    {} as Record<string, any>,
  )
}

export class ScrSettingsManager extends SettingsManager<ScrSettings> {
  protected settings!: Partial<ScrSettings>
  private blizzardFilepath: string
  private blizzardSettings!: Record<string, any>

  /**
   * Creates a new ScrSettings.
   *
   * @param filepath the path to store the settings file that gets updated by our settings dialog
   * @param blizzardFilepath the path to the game's normal settings file, which we overlay our
   *   settings on top of.
   * @param gameFilepath the path to the file that the game should load instead of the normal
   *   settings file, which we write out during game launches.
   */
  constructor(
    filepath: string,
    blizzardFilepath: string,
    readonly gameFilepath: string,
  ) {
    const initializeFunc = async function (this: ScrSettingsManager) {
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
        const contents = await fsPromises.readFile(this.blizzardFilepath, { encoding: 'utf8' })
        this.blizzardSettings = JSON.parse(contents)
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
    log.debug(`Blizzard settings path: ${blizzardFilepath}`)
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

  private migrateOldSettings(settings: Partial<ScrSettings>) {
    const newSettings = { ...settings }
    if (!newSettings.version || newSettings.version < 2) {
      // Fix integer settings to not be negative
      const intSettings: Array<ConditionalKeys<ScrSettings, number>> = [
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
    if (newSettings.version < 4) {
      // Address previous issues with vsyncOn setting. If not n range, we just reset it to the
      // current blizz setting (or off if the blizz setting is also bad)
      const vsyncOnAsNumber = Number(newSettings.vsyncOn)
      if (vsyncOnAsNumber !== 0 && vsyncOnAsNumber !== 1) {
        const blizzAsNumber = Number(fromBlizzardToSb(this.blizzardSettings).vsyncOn)
        if (blizzAsNumber !== 0 && blizzAsNumber !== 1) {
          newSettings.vsyncOn = 0
        } else {
          newSettings.vsyncOn = blizzAsNumber
        }
      } else {
        newSettings.vsyncOn = vsyncOnAsNumber
      }

      newSettings.version = 4
    }
    if (newSettings.version < 5) {
      // Add new settings that we didn't have before

      // NOTE(tec27): Like `createDefaults` above, this is always called *after* scrSettings has
      // been loaded
      const blizzSettings = fromBlizzardToSb(this.blizzardSettings)
      newSettings.selectedAnnouncer = blizzSettings.selectedAnnouncer
      newSettings.showFps = blizzSettings.showFps
      newSettings.showTurnRate = blizzSettings.showTurnRate
      newSettings.version = 5
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

  /**
   * Writes out the current SC:R settings to our replacement file, which the game will redirect
   * reads/writes of CSettings.json to. Once the game completes, `syncWithGameSettingsFile` should
   * be called to update our settings with what was changed ingame.
   */
  async writeGameSettingsFile() {
    log.debug('Writing ScrSettings to game settings file')
    await this.initialized
    const merged = {
      ...this.blizzardSettings,
      ...fromSbToBlizzard(this.settings),
      /**
       * NOTE(tec27): Blizzard uses this to signal they should force Carbot on immediately after
       * purchasing. In cases where our settings file is corrupted in some way, the existence of
       * this setting can make the game launch with Carbot even though it's turned off in SB
       * settings. We add this back explicitly just in case (Carbot can still be enabled
       * directly, it just won't pick it regardless of setting).
       */
      forcedCarbot: true,
    }
    const contents = jsonify(merged)
    await fsPromises.writeFile(this.gameFilepath, contents, { encoding: 'utf8' })
  }

  async syncWithGameSettingsFile() {
    log.debug('Syncing ScrSettings with game settings file')
    await this.initialized
    const contents = await fsPromises.readFile(this.gameFilepath, { encoding: 'utf8' })
    const newData = fromBlizzardToSb(JSON.parse(contents))
    await this.merge(newData)
  }
}
