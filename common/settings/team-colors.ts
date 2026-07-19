import { TFunction } from 'i18next'
import { ReadonlyDeep } from 'type-fest'
import { assertUnreachable } from '../assert-unreachable'
import {
  CustomTeamColors,
  FfaColorPreset,
  LocalSettings,
  TeamColorPreset,
  TeamColorUsage,
} from './local-settings'

/**
 * SC:R's 22 selectable player colors, in the game's own index order (0x00-0x15). Values are exact
 * bytes extracted from the binary (`get_preset_player_color_rgba`), not approximations. Names are
 * the community-standard lobby names (the exe has no localized names for these outside CASC/locale
 * data).
 */
export const SC_COLORS: ReadonlyArray<{ hex: string; name: string }> = [
  { hex: '#F40404', name: 'Red' },
  { hex: '#0C48CC', name: 'Blue' },
  { hex: '#2CB494', name: 'Teal' },
  { hex: '#88409C', name: 'Purple' },
  { hex: '#F88C14', name: 'Orange' },
  { hex: '#703014', name: 'Brown' },
  { hex: '#CCE0D0', name: 'White' },
  { hex: '#FCFC38', name: 'Yellow' },
  { hex: '#088008', name: 'Green' },
  { hex: '#FCFC7C', name: 'Pale Yellow' },
  { hex: '#ECC4B0', name: 'Tan' },
  { hex: '#4068D4', name: 'Azure' },
  { hex: '#74A47C', name: 'Pale Green' },
  { hex: '#7290B8', name: 'Blueish Grey' },
  { hex: '#00E4FC', name: 'Cyan' },
  { hex: '#FFC4E4', name: 'Pink' },
  { hex: '#808000', name: 'Olive' },
  { hex: '#D2F53C', name: 'Lime' },
  { hex: '#000080', name: 'Navy' },
  { hex: '#F032E6', name: 'Magenta' },
  { hex: '#808080', name: 'Grey' },
  { hex: '#3C3C3C', name: 'Black' },
]

/** The built-in team-axis color presets (every {@link TeamColorPreset} except `Custom`). */
export const TEAM_COLOR_PRESETS: ReadonlyDeep<
  Record<Exclude<TeamColorPreset, TeamColorPreset.Custom>, CustomTeamColors>
> = {
  [TeamColorPreset.LegacyDiplomacy]: {
    // Brood War's Shift+Tab diplomacy colors, using the standard BW player palette: self = teal,
    // allies = yellow, enemies = red.
    self: '#2CB494',
    allies: ['#FCFC38'],
    enemies: ['#F40404'],
  },
  [TeamColorPreset.CoolVsWarm]: {
    self: '#0C48CC',
    allies: ['#2CB494', '#00E4FC', '#4068D4', '#74A47C', '#7290B8', '#088008'],
    enemies: ['#F40404', '#F88C14', '#F032E6', '#FCFC38', '#FFC4E4', '#703014', '#ECC4B0'],
  },
  [TeamColorPreset.ColorblindSafe]: {
    // Okabe-Ito based.
    self: '#0072B2',
    allies: ['#56B4E9', '#009E73', '#88CCEE', '#332288', '#44AA99', '#7290B8'],
    enemies: ['#E69F00', '#D55E00', '#F0E442', '#CC79A7', '#882255', '#EE8866', '#FFAABB'],
  },
}

/** The built-in FFA-axis color presets (every {@link FfaColorPreset} except `Custom`). */
export const FFA_COLOR_PRESETS: ReadonlyDeep<
  Record<Exclude<FfaColorPreset, FfaColorPreset.Custom>, string[]>
> = {
  [FfaColorPreset.Classic]: [
    '#F40404',
    '#0C48CC',
    '#2CB494',
    '#88409C',
    '#F88C14',
    '#703014',
    '#CCE0D0',
    '#FCFC38',
  ],
  [FfaColorPreset.Pastel]: [
    '#F6A5A5',
    '#A8DDE9',
    '#B8E4B8',
    '#DDB8F0',
    '#F9C784',
    '#C9B29B',
    '#FDF3A7',
    '#B5C7F5',
  ],
  [FfaColorPreset.ColorblindSafe]: [
    '#0072B2',
    '#E69F00',
    '#56B4E9',
    '#D55E00',
    '#009E73',
    '#F0E442',
    '#CC79A7',
    '#999999',
  ],
}

/** The FFA pool must contain at least this many colors (worst case: an 8-player FFA with no self). */
export const MIN_FFA_COLORS = 8
/** The FFA pool editor allows at most this many colors. */
export const MAX_FFA_COLORS = 16
/** The allies/enemies pool editors allow at most this many colors each. */
export const MAX_TEAM_POOL_COLORS = 8

/**
 * Returns a fresh, mutable copy of a {@link CustomTeamColors} value. Useful when a caller has one
 * sourced from a `ReadonlyDeep` value (e.g. `DEFAULT_LOCAL_SETTINGS`) and needs a copy it's free to
 * mutate, or that satisfies a plain `CustomTeamColors`-typed field.
 */
export function cloneCustomTeamColors(colors: {
  self: string
  allies: readonly string[]
  enemies: readonly string[]
}): CustomTeamColors {
  return { self: colors.self, allies: [...colors.allies], enemies: [...colors.enemies] }
}

/**
 * Resolves the active team-color scheme: the selected built-in preset, or `customTeamColors` if
 * the preset is `Custom`. Always returns a fresh copy, safe for the caller to mutate.
 */
export function resolveTeamColors(
  settings: Pick<LocalSettings, 'teamColorPreset' | 'customTeamColors'>,
): CustomTeamColors {
  const colors =
    settings.teamColorPreset === TeamColorPreset.Custom
      ? settings.customTeamColors
      : TEAM_COLOR_PRESETS[settings.teamColorPreset]

  return cloneCustomTeamColors(colors)
}

/**
 * Resolves the active FFA-color pool: the selected built-in preset, or `customFfaColors` if the
 * preset is `Custom`. Always returns a fresh copy, safe for the caller to mutate.
 */
export function resolveFfaColors(
  settings: Pick<LocalSettings, 'ffaColorPreset' | 'customFfaColors'>,
): string[] {
  const colors =
    settings.ffaColorPreset === FfaColorPreset.Custom
      ? settings.customFfaColors
      : FFA_COLOR_PRESETS[settings.ffaColorPreset]

  return [...colors]
}

export function getTeamColorPresetLabel(preset: TeamColorPreset, t: TFunction): string {
  switch (preset) {
    case TeamColorPreset.LegacyDiplomacy:
      return t('settings.game.gameplay.teamColorPreset.legacyDiplomacy', 'Legacy diplomacy')
    case TeamColorPreset.CoolVsWarm:
      return t('settings.game.gameplay.teamColorPreset.coolVsWarm', 'Cool vs warm')
    case TeamColorPreset.ColorblindSafe:
      return t('settings.game.gameplay.teamColorPreset.colorblindSafe', 'Colorblind-safe')
    case TeamColorPreset.Custom:
      return t('settings.game.gameplay.teamColorPreset.custom', 'Custom')
    default:
      return assertUnreachable(preset)
  }
}

export function getFfaColorPresetLabel(preset: FfaColorPreset, t: TFunction): string {
  switch (preset) {
    case FfaColorPreset.Classic:
      return t('settings.game.gameplay.ffaColorPreset.classic', 'Classic')
    case FfaColorPreset.Pastel:
      return t('settings.game.gameplay.ffaColorPreset.pastel', 'Pastel')
    case FfaColorPreset.ColorblindSafe:
      return t('settings.game.gameplay.ffaColorPreset.colorblindSafe', 'Colorblind-safe')
    case FfaColorPreset.Custom:
      return t('settings.game.gameplay.ffaColorPreset.custom', 'Custom')
    default:
      return assertUnreachable(preset)
  }
}

export function getTeamColorUsageLabel(usage: TeamColorUsage, t: TFunction): string {
  switch (usage) {
    case TeamColorUsage.Always:
      return t('settings.game.gameplay.teamColorUsage.always', 'In team games and 1v1')
    case TeamColorUsage.ExceptIn1v1:
      return t('settings.game.gameplay.teamColorUsage.exceptIn1v1', 'Only in team games')
    case TeamColorUsage.Never:
      return t('settings.game.gameplay.teamColorUsage.never', 'Never')
    default:
      return assertUnreachable(usage)
  }
}
