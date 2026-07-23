import { ReadonlyDeep } from 'type-fest'
import { Announcer, ConsoleSkin, IngameSkin } from './blizz-settings'
import {
  FfaColorPreset,
  LocalSettings,
  MinimapColorMode,
  ScrSettings,
  ShieldBatteryAppSettings,
  StartingFog,
  TeamColorPreset,
  TeamColorUsage,
} from './local-settings'
import { cloneCustomTeamColors, FFA_COLOR_PRESETS, TEAM_COLOR_PRESETS } from './team-colors'

export const DEFAULT_LOCAL_SETTINGS: ReadonlyDeep<
  Omit<LocalSettings, keyof ShieldBatteryAppSettings>
> = {
  runAppAtSystemStart: false,
  runAppAtSystemStartMinimized: false,
  starcraftPath: '',
  masterVolume: 50,
  gameWinX: undefined,
  gameWinY: undefined,
  gameWinWidth: undefined,
  gameWinHeight: undefined,
  quickOpenReplays: false,
  startingFog: StartingFog.ShowTerrainAndResources,
  minimapColorMode: MinimapColorMode.Standard,
  minimapTerrainHidden: false,
  teamColorPreset: TeamColorPreset.CoolVsWarm,
  ffaColorPreset: FfaColorPreset.Classic,
  teamColorUsage: TeamColorUsage.Always,
  shuffleColors: false,
  // Copied (rather than referencing the preset table directly) so this default can never be
  // aliased/mutated through the preset it was seeded from.
  customTeamColors: cloneCustomTeamColors(TEAM_COLOR_PRESETS[TeamColorPreset.LegacyDiplomacy]),
  customFfaColors: [...FFA_COLOR_PRESETS[FfaColorPreset.Classic]],
  teamSelfColor: undefined,
  ffaSelfColor: undefined,
  legacyCursorSizing: false,
  useCustomCursorSize: false,
  customCursorSize: 0.25,
  gameServerRegion: undefined,
}

export const DEFAULT_SCR_SETTINGS: ReadonlyDeep<Omit<ScrSettings, 'version'>> = {
  // Input settings
  keyboardScrollSpeed: 0,
  mouseScrollSpeed: 0,
  mouseSensitivityOn: false,
  mouseSensitivity: 0,
  mouseScalingOn: false,
  hardwareCursorOn: false,
  mouseConfineOn: false,
  // Sound settings
  musicOn: true,
  musicVolume: 50,
  soundOn: true,
  soundVolume: 50,
  unitSpeechOn: true,
  unitAcknowledgementsOn: true,
  backgroundSoundsOn: true,
  buildingSoundsOn: true,
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
  hdGraphicsOn: true,
  environmentEffectsOn: true,
  realTimeLightingOn: false,
  smoothUnitTurningOn: true,
  shadowStackingOn: false,
  pillarboxOn: false,
  showFps: false,
  // Gameplay settings
  gameTimerOn: false,
  colorCyclingOn: true,
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
