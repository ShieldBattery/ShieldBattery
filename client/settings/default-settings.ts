import { Immutable } from 'immer'
import { Announcer, ConsoleSkin, IngameSkin } from '../../common/settings/blizz-settings'
import {
  LocalSettings,
  ScrSettings,
  ShieldBatteryAppSettings,
} from '../../common/settings/local-settings'

export const DEFAULT_LOCAL_SETTINGS: Immutable<
  Omit<LocalSettings, keyof ShieldBatteryAppSettings>
> = {
  runAppAtSystemStart: true,
  runAppAtSystemStartMinimized: false,
  starcraftPath: '',
  masterVolume: 0,
  gameWinWidth: -1,
  gameWinHeight: -1,
  visualizeNetworkStalls: false,
}

export const DEFAULT_SCR_SETTINGS: Immutable<Omit<ScrSettings, 'version'>> = {
  // Input settings
  keyboardScrollSpeed: 0,
  mouseScrollSpeed: 0,
  mouseSensitivityOn: false,
  mouseSensitivity: 0,
  mouseScalingOn: false,
  hardwareCursorOn: false,
  mouseConfineOn: false,
  // Sound settings
  musicOn: false,
  musicVolume: 0,
  soundOn: false,
  soundVolume: 0,
  unitSpeechOn: false,
  unitAcknowledgementsOn: false,
  backgroundSoundsOn: false,
  buildingSoundsOn: false,
  gameSubtitlesOn: false,
  cinematicSubtitlesOn: false,
  originalVoiceOversOn: false,
  selectedAnnouncer: Announcer.Default,
  // Video settings
  displayMode: 0,
  fpsLimitOn: false,
  fpsLimit: 0,
  sdGraphicsFilter: 0,
  vsyncOn: 0,
  hdGraphicsOn: false,
  environmentEffectsOn: false,
  realTimeLightingOn: false,
  smoothUnitTurningOn: false,
  shadowStackingOn: false,
  pillarboxOn: false,
  showFps: false,
  // Gameplay settings
  gameTimerOn: false,
  colorCyclingOn: false,
  unitPortraits: 0,
  minimapPosition: false,
  apmDisplayOn: false,
  apmAlertOn: false,
  apmAlertValue: 0,
  apmAlertColorOn: false,
  apmAlertSoundOn: false,
  consoleSkin: ConsoleSkin.Default,
  selectedSkin: IngameSkin.Default,
  showBonusSkins: false,
  showTurnRate: false,
}
