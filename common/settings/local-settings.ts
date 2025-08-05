import { TFunction } from 'i18next'
import { assertUnreachable } from '../assert-unreachable'
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

export enum StartingFog {
  Transparent = 'transparent',
  ShowResources = 'showResources',
  Legacy = 'legacy',
}

export const ALL_STARTING_FOG: Readonly<StartingFog[]> = Object.values(StartingFog)

export function getStartingFogLabel(fog: StartingFog, t: TFunction): string {
  switch (fog) {
    case StartingFog.Transparent:
      return t('settings.game.gameplay.startingFog.transparent', 'Transparent')
    case StartingFog.ShowResources:
      return t('settings.game.gameplay.startingFog.showResources', 'Show resources')
    case StartingFog.Legacy:
      return t('settings.game.gameplay.startingFog.legacy', 'Legacy')
    default:
      return assertUnreachable(fog)
  }
}

export interface LocalSettings extends ShieldBatteryAppSettings {
  runAppAtSystemStart: boolean
  runAppAtSystemStartMinimized: boolean
  starcraftPath: string
  masterVolume: number
  gameWinX: number | undefined
  gameWinY: number | undefined
  gameWinWidth: number | undefined
  gameWinHeight: number | undefined
  monitorId: number | undefined
  quickOpenReplays: boolean
  startingFog: StartingFog
  /**
   * Whether to use Blizzard's cursor sizing algorithm (that maxes out at 64px) instead of our fixed
   * version that allows larger cursors and keeps all the cursors the same scale.
   */
  legacyCursorSizing: boolean
  /** Whether to use the customCursorSize scale value instead of one based on game height. */
  useCustomCursorSize: boolean
  /**
   * If `useCustomCursorSize` is on, will be used to scale cursors down from their 4K resolution.
   */
  customCursorSize: number

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
