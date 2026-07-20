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
 * data) and are code-side canonical labels for traceability, not what's shown to users -- displayed
 * text goes through {@link getNamedColorLabel} so it's localized.
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

/**
 * The "cool" 7-color pool backing the CoolVsWarm/WarmVsCool team-color presets (as the enemies
 * pool, or reversed with its head color as `self`, as the allies pool). Ordered to keep the
 * highest-priority slots (the ones a small ally/enemy pool actually uses) maximally distinguishable
 * under normal and color-vision-deficient vision. `name` is a code-side label, not what's shown to
 * users -- displayed text goes through {@link getNamedColorLabel} so it's localized.
 */
export const COOL: ReadonlyArray<{ hex: string; name: string }> = [
  { hex: '#2F7FE3', name: 'Azure' },
  { hex: '#5AC576', name: 'Emerald' },
  { hex: '#92C1FD', name: 'Sky' },
  { hex: '#BE8CE1', name: 'Violet' },
  { hex: '#B3ECB9', name: 'Mint' },
  { hex: '#60812B', name: 'Moss' },
  { hex: '#228A8D', name: 'Deep teal' },
]

/** The "warm" counterpart to {@link COOL}; see there for details, including on `name`. */
export const WARM: ReadonlyArray<{ hex: string; name: string }> = [
  { hex: '#DE3C37', name: 'Scarlet' },
  { hex: '#EDC23E', name: 'Gold' },
  { hex: '#D553AC', name: 'Magenta' },
  { hex: '#F48815', name: 'Orange' },
  { hex: '#F99FB7', name: 'Rose' },
  { hex: '#A24B36', name: 'Brick' },
  { hex: '#FEC2A4', name: 'Peach' },
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
    self: COOL[0].hex,
    allies: COOL.slice(1, 7).map(c => c.hex),
    enemies: WARM.map(c => c.hex),
  },
  [TeamColorPreset.WarmVsCool]: {
    self: WARM[0].hex,
    allies: WARM.slice(1, 7).map(c => c.hex),
    enemies: COOL.map(c => c.hex),
  },
  [TeamColorPreset.ColorblindSafe]: {
    // Okabe-Ito based. Chosen independently of COOL/WARM above, so don't assume its colors are a
    // subset or derivative of that pool.
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
  [FfaColorPreset.Jewel]: [
    '#D23855', // Ruby
    '#396ED6', // Sapphire
    '#3BB360', // Emerald
    '#F3B01D', // Amber
    '#B675DB', // Amethyst
    '#F28058', // Coral
    '#BEDC6F', // Peridot
    '#F4ACC7', // Rose quartz
  ],
  [FfaColorPreset.Arcade]: [
    '#E32762', // Razzmatazz
    '#46A6EF', // Sky blue
    '#6CBD2E', // Lime
    '#FACB39', // Sunglow
    '#ED68AE', // Hot pink
    '#615CDC', // Blurple
    '#FE9C4C', // Tangerine
    '#84D48A', // Seafoam
  ],
  // Resurrect 64 by Kerrie Lake; see FFA_COLOR_PRESET_ATTRIBUTION below.
  [FfaColorPreset.Resurrect]: [
    '#D5E04B',
    '#4D65B4',
    '#EA4F36',
    '#EAADED',
    '#0EAF9B',
    '#A24B6F',
    '#F79617',
    '#A884F3',
  ],
  // Pear36 by PineTreePizza; see FFA_COLOR_PRESET_ATTRIBUTION below.
  [FfaColorPreset.Pear]: [
    '#FFE478',
    '#B0305C',
    '#4DA6FF',
    '#3CA370',
    '#FF6B97',
    '#FFB5B5',
    '#8FDE5D',
    '#BA6156',
  ],
  [FfaColorPreset.Neon]: [
    '#E935CF', // Fuchsia
    '#7ADB00', // Laser lime
    '#2D70F4', // Electric blue
    '#FE8C2C', // Neon orange
    '#F9E03F', // Acid yellow
    '#7B2BCF', // Hyper purple
    '#FE5C8E', // Hot pink
    '#23D891', // Spring green
  ],
  [FfaColorPreset.ColorblindSafe]: [
    '#3072C1', // Blue
    '#EE9733', // Orange
    '#80BDFB', // Sky
    '#D64C29', // Vermillion
    '#3EAF86', // Teal green
    '#F0D947', // Yellow
    '#F9AFC5', // Pink
    '#96943C', // Olive
  ],
}

/**
 * Source data for a built-in FFA-axis preset's attribution: either a named palette credited to an
 * author, or one merely inspired by a named palette (no direct author to credit). Kept structured
 * -- rather than a single pre-formatted phrase -- so the connecting words ("by", "Inspired by") go
 * through {@link getFfaColorPresetAttribution}'s `t` and localize, while the proper nouns
 * (`palette`, `author`) stay literal in every language.
 */
type PresetAttributionSource =
  | { palette: string; author: string; url: string }
  | { palette: string; inspiredBy: true; url: string }

/**
 * Attribution for the FFA-axis presets adapted from a named third-party palette. Presets not
 * listed here are original to ShieldBattery and need no credit.
 */
const FFA_COLOR_PRESET_ATTRIBUTION: ReadonlyDeep<
  Partial<Record<Exclude<FfaColorPreset, FfaColorPreset.Custom>, PresetAttributionSource>>
> = {
  [FfaColorPreset.Arcade]: {
    palette: 'PICO-8',
    inspiredBy: true,
    url: 'https://lospec.com/palette-list/pico-8',
  },
  [FfaColorPreset.Resurrect]: {
    palette: 'Resurrect 64',
    author: 'Kerrie Lake',
    url: 'https://lospec.com/palette-list/resurrect-64',
  },
  [FfaColorPreset.Pear]: {
    palette: 'Pear36',
    author: 'PineTreePizza',
    url: 'https://lospec.com/palette-list/pear36',
  },
}

/**
 * Returns the source-palette attribution for a built-in FFA-axis preset, or `undefined` if it's
 * original to ShieldBattery (or `Custom`). `label` is the fully-localized attribution phrase (e.g.
 * "Resurrect 64 by Kerrie Lake" or "Inspired by PICO-8"); `url` links to the source palette.
 */
export function getFfaColorPresetAttribution(
  preset: FfaColorPreset,
  t: TFunction,
): { label: string; url: string } | undefined {
  if (preset === FfaColorPreset.Custom) {
    return undefined
  }
  const source = FFA_COLOR_PRESET_ATTRIBUTION[preset]
  if (!source) {
    return undefined
  }
  const label =
    'author' in source
      ? t('settings.game.gameplay.ffaColors.attributionBy', {
          defaultValue: '{{palette}} by {{author}}',
          palette: source.palette,
          author: source.author,
        })
      : t('settings.game.gameplay.ffaColors.attributionInspiredBy', {
          defaultValue: 'Inspired by {{palette}}',
          palette: source.palette,
        })
  return { label, url: source.url }
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
 * Resolves the `teamSelf` override sent to the game (and mirrored by the settings preview): on
 * the `Custom` preset, always the scheme's own self color -- pinning a deliberately-chosen custom
 * self the same way an explicit override would, so it isn't drawn into the shuffle-on combined
 * self+allies pool like an arbitrary built-in preset's hero color would be. On a built-in preset,
 * the user's explicit override if they've set one, or `undefined` (no override in effect) if not.
 */
export function resolveTeamSelfOverride(
  settings: Pick<LocalSettings, 'teamColorPreset' | 'teamSelfColor'>,
  resolvedTeamColors: Pick<CustomTeamColors, 'self'>,
): string | undefined {
  return settings.teamColorPreset === TeamColorPreset.Custom
    ? resolvedTeamColors.self
    : settings.teamSelfColor
}

/**
 * Removes the first entry of `pool` matching `color` (case-insensitively), mirroring the engine's
 * ally-pool consume when a team self override collides with an ally color -- so that ally draws
 * the next color instead of duplicating the local player. Guarded the same way the engine is:
 * `color` of `undefined` (no override in effect) is a no-op, and consuming down to an empty pool
 * is skipped, since a length-1 pool is a valid "everyone matches" scheme, not a degenerate one.
 */
export function consumeMatchingColor(pool: readonly string[], color: string | undefined): string[] {
  if (color === undefined || pool.length <= 1) {
    return [...pool]
  }
  const index = pool.findIndex(c => c.toLowerCase() === color.toLowerCase())
  if (index === -1) {
    return [...pool]
  }
  const next = pool.slice()
  next.splice(index, 1)
  return next
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

/**
 * Localized display name for one of the built-in colors in {@link SC_COLORS}, {@link COOL}, or
 * {@link WARM}, looked up by hex value (case-insensitively). Returns `undefined` for a hex that
 * isn't one of those built-ins, so callers can fall back to the hex string itself.
 *
 * A few names repeat across tables for different hexes (e.g. "Azure" in both `SC_COLORS` and
 * `COOL`); those share a single translation key below rather than getting distinct ones, since the
 * displayed English text -- and its translation -- is the same either way.
 */
export function getNamedColorLabel(hex: string, t: TFunction): string | undefined {
  switch (hex.toLowerCase()) {
    case '#f40404':
      return t('settings.game.gameplay.colorNames.red', 'Red')
    case '#0c48cc':
      return t('settings.game.gameplay.colorNames.blue', 'Blue')
    case '#2cb494':
      return t('settings.game.gameplay.colorNames.teal', 'Teal')
    case '#88409c':
      return t('settings.game.gameplay.colorNames.purple', 'Purple')
    case '#f88c14':
    case '#f48815':
      return t('settings.game.gameplay.colorNames.orange', 'Orange')
    case '#703014':
      return t('settings.game.gameplay.colorNames.brown', 'Brown')
    case '#cce0d0':
      return t('settings.game.gameplay.colorNames.white', 'White')
    case '#fcfc38':
      return t('settings.game.gameplay.colorNames.yellow', 'Yellow')
    case '#088008':
      return t('settings.game.gameplay.colorNames.green', 'Green')
    case '#fcfc7c':
      return t('settings.game.gameplay.colorNames.paleYellow', 'Pale Yellow')
    case '#ecc4b0':
      return t('settings.game.gameplay.colorNames.tan', 'Tan')
    case '#4068d4':
    case '#2f7fe3':
      return t('settings.game.gameplay.colorNames.azure', 'Azure')
    case '#74a47c':
      return t('settings.game.gameplay.colorNames.paleGreen', 'Pale Green')
    case '#7290b8':
      return t('settings.game.gameplay.colorNames.blueishGrey', 'Blueish Grey')
    case '#00e4fc':
      return t('settings.game.gameplay.colorNames.cyan', 'Cyan')
    case '#ffc4e4':
      return t('settings.game.gameplay.colorNames.pink', 'Pink')
    case '#808000':
      return t('settings.game.gameplay.colorNames.olive', 'Olive')
    case '#d2f53c':
      return t('settings.game.gameplay.colorNames.lime', 'Lime')
    case '#000080':
      return t('settings.game.gameplay.colorNames.navy', 'Navy')
    case '#f032e6':
    case '#d553ac':
      return t('settings.game.gameplay.colorNames.magenta', 'Magenta')
    case '#808080':
      return t('settings.game.gameplay.colorNames.grey', 'Grey')
    case '#3c3c3c':
      return t('settings.game.gameplay.colorNames.black', 'Black')
    case '#5ac576':
      return t('settings.game.gameplay.colorNames.emerald', 'Emerald')
    case '#92c1fd':
      return t('settings.game.gameplay.colorNames.sky', 'Sky')
    case '#be8ce1':
      return t('settings.game.gameplay.colorNames.violet', 'Violet')
    case '#b3ecb9':
      return t('settings.game.gameplay.colorNames.mint', 'Mint')
    case '#60812b':
      return t('settings.game.gameplay.colorNames.moss', 'Moss')
    case '#228a8d':
      return t('settings.game.gameplay.colorNames.deepTeal', 'Deep teal')
    case '#de3c37':
      return t('settings.game.gameplay.colorNames.scarlet', 'Scarlet')
    case '#edc23e':
      return t('settings.game.gameplay.colorNames.gold', 'Gold')
    case '#f99fb7':
      return t('settings.game.gameplay.colorNames.rose', 'Rose')
    case '#a24b36':
      return t('settings.game.gameplay.colorNames.brick', 'Brick')
    case '#fec2a4':
      return t('settings.game.gameplay.colorNames.peach', 'Peach')
    default:
      return undefined
  }
}

export function getTeamColorPresetLabel(preset: TeamColorPreset, t: TFunction): string {
  switch (preset) {
    case TeamColorPreset.LegacyDiplomacy:
      return t('settings.game.gameplay.teamColorPreset.legacyDiplomacy', 'Legacy diplomacy')
    case TeamColorPreset.CoolVsWarm:
      return t('settings.game.gameplay.teamColorPreset.coolVsWarm', 'Cool vs warm')
    case TeamColorPreset.WarmVsCool:
      return t('settings.game.gameplay.teamColorPreset.warmVsCool', 'Warm vs cool')
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
    case FfaColorPreset.Jewel:
      return t('settings.game.gameplay.ffaColorPreset.jewel', 'Jewel')
    case FfaColorPreset.Arcade:
      return t('settings.game.gameplay.ffaColorPreset.arcade', 'Arcade')
    case FfaColorPreset.Resurrect:
      return t('settings.game.gameplay.ffaColorPreset.resurrect', 'Resurrect')
    case FfaColorPreset.Pear:
      return t('settings.game.gameplay.ffaColorPreset.pear', 'Pear')
    case FfaColorPreset.Neon:
      return t('settings.game.gameplay.ffaColorPreset.neon', 'Neon')
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
