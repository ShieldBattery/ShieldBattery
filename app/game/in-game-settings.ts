import {
  ALL_ANNOUNCERS,
  ALL_CONSOLE_SKINS,
  ALL_DISPLAY_MODES,
  ALL_INGAME_SKINS,
} from '../../common/settings/blizz-settings'
import {
  ALL_MINIMAP_COLOR_MODES,
  ALL_STARTING_FOG,
  FramePacing,
  LocalSettings,
  MAX_ROLLBACK_TARGET,
  ScrSettings,
} from '../../common/settings/local-settings'

/** Settings the game's own options screen changed, in the app's encodings. */
export interface InGameSettingsChange {
  local: Partial<LocalSettings>
  scr: Partial<ScrSettings>
  /**
   * The display the player chose: `null` for the system's primary display, otherwise its desktop
   * rectangle, for the app to find its own id for. Absent when the player didn't choose one.
   */
  monitor?: MonitorBounds | null
}

/** A display's desktop rectangle, in the terms Electron's `screen` reports its bounds in. */
export interface MonitorBounds {
  x: number
  y: number
  width: number
  height: number
}

function readMonitor(value: unknown): MonitorBounds | null | undefined {
  if (value === null) {
    return null
  }
  if (Array.isArray(value) && value.length === 4 && value.every(n => Number.isInteger(n))) {
    const [x, y, width, height] = value as number[]
    return { x, y, width, height }
  }
  return undefined
}

type Validator = (value: unknown) => boolean

const isBoolean: Validator = value => typeof value === 'boolean'

function isIntegerIn(min: number, max: number): Validator {
  return value => Number.isInteger(value) && (value as number) >= min && (value as number) <= max
}

function isNumberIn(min: number, max: number): Validator {
  return value =>
    typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max
}

function isOneOf(values: Readonly<unknown[]>): Validator {
  return value => values.includes(value)
}

const ALL_FRAME_PACINGS: Readonly<FramePacing[]> = Object.values(FramePacing)

/**
 * The local settings the game may write, each with what a value it sends has to look like. Keys the
 * game has no screen for (window placement, team colors, folders) are never accepted from it.
 */
const LOCAL_SETTING_VALIDATORS: Partial<Record<keyof LocalSettings, Validator>> = {
  grabPanSensitivityOn: isBoolean,
  grabPanSensitivity: isNumberIn(0, 150),
  grabPanInverted: isBoolean,
  useCustomCursorSize: isBoolean,
  customCursorSize: isNumberIn(0.25, 1),
  legacyCursorSizing: isBoolean,
  startingFog: isOneOf(ALL_STARTING_FOG),
  minimapTerrainHidden: isBoolean,
  minimapColorMode: isOneOf(ALL_MINIMAP_COLOR_MODES),
  framePacing: isOneOf(ALL_FRAME_PACINGS),
  rollbackTarget: isIntegerIn(0, MAX_ROLLBACK_TARGET),
  emulateTurnRate24Delay: isBoolean,
  observerPanels: value =>
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    Object.keys(value).length <= 64 &&
    Object.values(value).every(
      v => typeof v === 'boolean' || (typeof v === 'string' && v.length <= 64),
    ),
}

/** The SC:R settings the game may write, each with what a value it sends has to look like. */
const SCR_SETTING_VALIDATORS: Partial<Record<keyof ScrSettings, Validator>> = {
  keyboardScrollSpeed: isIntegerIn(0, 6),
  mouseScrollSpeed: isIntegerIn(0, 6),
  mouseSensitivityOn: isBoolean,
  mouseSensitivity: isIntegerIn(0, 100),
  mouseScalingOn: isBoolean,
  hardwareCursorOn: isBoolean,
  mouseConfineOn: isBoolean,
  musicOn: isBoolean,
  musicVolume: isIntegerIn(0, 100),
  soundOn: isBoolean,
  soundVolume: isIntegerIn(0, 100),
  unitSpeechOn: isBoolean,
  unitAcknowledgementsOn: isBoolean,
  backgroundSoundsOn: isBoolean,
  buildingSoundsOn: isBoolean,
  gameSubtitlesOn: isBoolean,
  cinematicSubtitlesOn: isBoolean,
  originalVoiceOversOn: isBoolean,
  displayMode: isOneOf(ALL_DISPLAY_MODES),
  gamma: isIntegerIn(60, 140),
  fpsLimitOn: isBoolean,
  fpsLimit: isIntegerIn(0, 1000),
  sdGraphicsFilter: isIntegerIn(0, 3),
  vsyncOn: isIntegerIn(0, 1),
  hdGraphicsOn: isBoolean,
  environmentEffectsOn: isBoolean,
  realTimeLightingOn: isBoolean,
  smoothUnitTurningOn: isBoolean,
  shadowStackingOn: isBoolean,
  pillarboxOn: isBoolean,
  gameTimerOn: isBoolean,
  colorCyclingOn: isBoolean,
  unitPortraits: isIntegerIn(0, 2),
  minimapPosition: isBoolean,
  apmDisplayOn: isBoolean,
  apmAlertOn: isBoolean,
  apmAlertValue: isIntegerIn(0, 999),
  apmAlertColorOn: isBoolean,
  apmAlertSoundOn: isBoolean,
  consoleSkin: isOneOf(ALL_CONSOLE_SKINS),
  selectedSkin: isOneOf(ALL_INGAME_SKINS),
  showBonusSkins: isBoolean,
  selectedAnnouncer: isOneOf(ALL_ANNOUNCERS),
  showFps: isBoolean,
  showTurnRate: isBoolean,
}

function pickValid<T>(
  input: unknown,
  validators: Partial<Record<keyof T, Validator>>,
  rejected: string[],
): Partial<T> {
  const result: Partial<T> = {}
  if (typeof input !== 'object' || input === null) {
    return result
  }
  for (const [key, value] of Object.entries(input)) {
    const validator = validators[key as keyof T]
    if (validator?.(value)) {
      result[key as keyof T] = value as T[keyof T]
    } else {
      rejected.push(key)
    }
  }
  return result
}

/**
 * Reads a `/game/settingsChanged` payload, keeping only the settings the game's options screen is
 * allowed to change and only values the app itself could have chosen. The payload crosses a local
 * websocket, and anything accepted here flows back into the settings UI and every later launch.
 *
 * @returns the accepted settings, and the keys that were dropped.
 */
export function readInGameSettingsChange(payload: unknown): {
  change: InGameSettingsChange
  rejected: string[]
} {
  const rejected: string[] = []
  const { local, scr, monitor } = (payload ?? {}) as {
    local?: unknown
    scr?: unknown
    monitor?: unknown
  }
  const change: InGameSettingsChange = {
    local: pickValid<LocalSettings>(local, LOCAL_SETTING_VALIDATORS, rejected),
    scr: pickValid<ScrSettings>(scr, SCR_SETTING_VALIDATORS, rejected),
  }
  if (monitor !== undefined) {
    const bounds = readMonitor(monitor)
    if (bounds === undefined) {
      rejected.push('monitor')
    } else {
      change.monitor = bounds
    }
  }
  return { change, rejected }
}
