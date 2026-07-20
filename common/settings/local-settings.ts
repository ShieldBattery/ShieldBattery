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
 * Which built-in palette the team-axis colors (self/allies/enemies) are drawn from, or `Custom` to
 * source them from `customTeamColors` instead. Built-in preset color values live in
 * `common/settings/team-colors.ts`, the single source of truth for all preset colors.
 */
export enum TeamColorPreset {
  LegacyDiplomacy = 'legacyDiplomacy',
  CoolVsWarm = 'coolVsWarm',
  WarmVsCool = 'warmVsCool',
  ColorblindSafe = 'colorblindSafe',
  Custom = 'custom',
}

export const ALL_TEAM_COLOR_PRESETS: Readonly<TeamColorPreset[]> = Object.values(TeamColorPreset)

/**
 * Which built-in palette non-team contexts (FFAs, and team contexts `teamColorUsage` excludes) draw
 * player colors from, or `Custom` to source them from `customFfaColors` instead. Built-in preset
 * color values live in `common/settings/team-colors.ts`.
 */
export enum FfaColorPreset {
  Classic = 'classic',
  Jewel = 'jewel',
  Arcade = 'arcade',
  Resurrect = 'resurrect',
  Pear = 'pear',
  Neon = 'neon',
  ColorblindSafe = 'colorblindSafe',
  Custom = 'custom',
}

export const ALL_FFA_COLOR_PRESETS: Readonly<FfaColorPreset[]> = Object.values(FfaColorPreset)

/**
 * When the team-axis colors (`teamColorPreset`/`customTeamColors`) apply to a game, versus the
 * FFA-axis colors (`ffaColorPreset`/`customFfaColors`). A game is in team context if it starts with
 * allies already set (matchmaking, TvB forces, UMS forces); a plain 1v1 only counts as team context
 * when this is `Always`. Switching this never changes color values, only which pool applies.
 */
export enum TeamColorUsage {
  /** Apply team colors in team games and in 1v1s. */
  Always = 'always',
  /** Apply team colors in team games only; 1v1s use the FFA colors. */
  ExceptIn1v1 = 'exceptIn1v1',
  /** Never apply team colors; every game uses the FFA colors. */
  Never = 'never',
}

export const ALL_TEAM_COLOR_USAGES: Readonly<TeamColorUsage[]> = Object.values(TeamColorUsage)

/**
 * A user's custom team-color scheme: the color the local player is drawn in (in team contexts),
 * and the ordered color pools allied/enemy players draw from. `allies`/`enemies` wrap when a game
 * needs more colors than they contain, so a duplicate-color pool (e.g. length 1) is a valid,
 * intentional "everyone on this side looks the same" scheme rather than an error.
 */
export interface CustomTeamColors {
  /** The color the local player is drawn in, in team contexts. '#RRGGBB'. */
  self: string
  /** Ordered pool of colors for allied players, length 1-8. '#RRGGBB' each. */
  allies: string[]
  /** Ordered pool of colors for enemy players, length 1-8. '#RRGGBB' each. */
  enemies: string[]
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
  /** Which built-in team-color palette (or Custom) the non-Standard team-colors modes apply. */
  teamColorPreset: TeamColorPreset
  /** Which built-in FFA-color palette (or Custom) non-team contexts draw colors from. */
  ffaColorPreset: FfaColorPreset
  /** When team colors apply to a game versus the FFA colors; see {@link TeamColorUsage}. */
  teamColorUsage: TeamColorUsage
  /** Whether to apply a per-game random shuffle to each active color pool. */
  shuffleColors: boolean
  /** The user's custom team-color scheme, used when `teamColorPreset` is `Custom`. */
  customTeamColors: CustomTeamColors
  /** The user's custom FFA-color pool (length 8-16), used when `ffaColorPreset` is `Custom`. */
  customFfaColors: string[]
  /**
   * A fixed self color for FFA contexts, or undefined to draw from the FFA pool like everyone
   * else. If set and present in the active FFA pool, it's consumed (skipped when assigning other
   * players) rather than causing a collision. '#RRGGBB'.
   */
  ffaSelfColor?: string
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
