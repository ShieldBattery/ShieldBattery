import { Announcer, ConsoleSkin, DisplayMode, IngameSkin } from './blizz-settings'

/**
 * Settings related to the ShieldBattery Electron app (that will not be exposed to users in the
 * settings dialog).
 */
export interface ShieldBatteryAppSettings {
  version: number
  winX: number
  winY: number
  winWidth: number
  winHeight: number
  winMaximized: boolean
}

export interface LocalSettings extends ShieldBatteryAppSettings {
  runAppAtSystemStart: boolean
  runAppAtSystemStartMinimized: boolean
  starcraftPath: string
  masterVolume: number
  gameWinX: number
  gameWinY: number
  gameWinWidth: number
  gameWinHeight: number
  quickOpenReplays: boolean

  visualizeNetworkStalls?: boolean
  disableHd?: boolean
  launch64Bit?: boolean
}

export interface ScrSettings {
  version: number
  keyboardScrollSpeed: number
  mouseScrollSpeed: number
  mouseSensitivityOn: boolean
  mouseSensitivity: number
  mouseScalingOn: boolean
  hardwareCursorOn: boolean
  mouseConfineOn: boolean
  musicOn: boolean
  musicVolume: number
  soundOn: boolean
  soundVolume: number
  unitSpeechOn: boolean
  unitAcknowledgementsOn: boolean
  backgroundSoundsOn: boolean
  buildingSoundsOn: boolean
  gameSubtitlesOn: boolean
  cinematicSubtitlesOn: boolean
  originalVoiceOversOn: boolean
  displayMode: DisplayMode
  fpsLimitOn: boolean
  fpsLimit: number
  sdGraphicsFilter: number
  vsyncOn: number
  hdGraphicsOn: boolean
  environmentEffectsOn: boolean
  realTimeLightingOn: boolean
  smoothUnitTurningOn: boolean
  shadowStackingOn: boolean
  pillarboxOn: boolean
  gameTimerOn: boolean
  colorCyclingOn: boolean
  unitPortraits: number // TODO(tec27): type this more narrowly/use an enum
  minimapPosition: boolean
  apmDisplayOn: boolean
  apmAlertOn: boolean
  apmAlertValue: number
  apmAlertColorOn: boolean
  apmAlertSoundOn: boolean
  consoleSkin: ConsoleSkin
  selectedSkin: IngameSkin
  showBonusSkins: boolean
  selectedAnnouncer: Announcer
  showFps: boolean
  showTurnRate: boolean
}
