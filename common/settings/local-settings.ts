import { TFunction } from 'i18next'
import { assertUnreachable } from '../assert-unreachable'
import { GameServerRegionId } from '../game-server-regions'
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
  ShowTerrainAndResources = 'transparent',
  ShowResources = 'showResources',
  Legacy = 'legacy',
}

export const ALL_STARTING_FOG: Readonly<StartingFog[]> = Object.values(StartingFog)

export function getStartingFogLabel(fog: StartingFog, t: TFunction): string {
  switch (fog) {
    case StartingFog.ShowTerrainAndResources:
      return t(
        'settings.game.gameplay.startingFog.showTerrainAndResources',
        'Show terrain and resources',
      )
    case StartingFog.ShowResources:
      return t('settings.game.gameplay.startingFog.showResources', 'Show resources')
    case StartingFog.Legacy:
      return t('settings.game.gameplay.startingFog.legacy', 'Legacy')
    default:
      return assertUnreachable(fog)
  }
}

/**
 * The minimap player-color mode, cycled in-game with Shift+Tab. The numeric values match the game's
 * internal `minimap_color_mode` global so they can be written/read directly. The non-Standard modes
 * apply the user's color preset (on the minimap, or on the minimap and game view).
 */
export enum MinimapColorMode {
  /** Default player colors everywhere. */
  Standard = 0,
  /** Apply the color preset on the minimap only. */
  PresetOnMinimapOnly = 1,
  /** Apply the color preset on both the minimap and the game view. */
  Preset = 2,
}

export const ALL_MINIMAP_COLOR_MODES: Readonly<MinimapColorMode[]> = [
  MinimapColorMode.Standard,
  MinimapColorMode.PresetOnMinimapOnly,
  MinimapColorMode.Preset,
]

export function getMinimapColorModeLabel(mode: MinimapColorMode, t: TFunction): string {
  switch (mode) {
    case MinimapColorMode.Standard:
      return t('settings.game.gameplay.teamColors.mode.standard', 'Standard')
    case MinimapColorMode.PresetOnMinimapOnly:
      return t('settings.game.gameplay.teamColors.mode.presetOnMinimap', 'Use preset on minimap')
    case MinimapColorMode.Preset:
      return t('settings.game.gameplay.teamColors.mode.presetEverywhere', 'Use preset everywhere')
    default:
      return assertUnreachable(mode)
  }
}

/**
 * A color preset that team-colors modes apply, identifying self/allies/enemies colors. Built-in
 * presets (created by us) have fixed colors; a future user-editable "custom" preset will source its
 * colors from settings instead.
 */
export enum ColorPreset {
  LegacyDiplomacy = 'legacyDiplomacy',
}

export const ALL_COLOR_PRESETS: Readonly<ColorPreset[]> = Object.values(ColorPreset)

export function getColorPresetLabel(preset: ColorPreset, t: TFunction): string {
  switch (preset) {
    case ColorPreset.LegacyDiplomacy:
      return t('settings.game.gameplay.colorPreset.legacyDiplomacy', 'Legacy diplomacy')
    default:
      return assertUnreachable(preset)
  }
}

/** The self/allies/enemies colors a team-color preset resolves to (used for previews + applying). */
export interface ColorPresetColors {
  self: string
  allies: string
  enemies: string
}

export function getColorPresetColors(preset: ColorPreset): ColorPresetColors {
  switch (preset) {
    case ColorPreset.LegacyDiplomacy:
      // Brood War's Shift+Tab diplomacy colors, using the standard BW player palette:
      // self = teal, allies = yellow, enemies = red.
      return { self: '#2CB494', allies: '#FCFC38', enemies: '#F40404' }
    default:
      return assertUnreachable(preset)
  }
}

export interface LocalSettings extends ShieldBatteryAppSettings {
  runAppAtSystemStart: boolean
  runAppAtSystemStartMinimized: boolean
  starcraftPath: string
  masterVolume: number
  gameWinX?: number
  gameWinY?: number
  gameWinWidth?: number
  gameWinHeight?: number
  monitorId?: number
  quickOpenReplays: boolean
  startingFog: StartingFog
  /**
   * The minimap player-color mode, cycled in-game with Shift+Tab. Saved when a game exits and
   * restored on the next launch.
   */
  minimapColorMode: MinimapColorMode
  /** Which color preset the non-Standard team-colors modes apply. */
  colorPreset: ColorPreset
  /**
   * Whether the minimap terrain is hidden, toggled in-game with Tab. Matches the game's internal
   * flag (`true` means terrain is blanked on the minimap). Saved/restored across game launches.
   */
  minimapTerrainHidden: boolean
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

  /**
   * The manually-selected game server region id (see `common/game-server-regions.ts`), or
   * undefined for Auto (the client homes on the lowest-measured-latency region). A value that's no
   * longer in the server-provided region list is treated the same as undefined.
   */
  gameServerRegion?: GameServerRegionId

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
