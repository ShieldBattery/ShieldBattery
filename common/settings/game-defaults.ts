import { TFunction } from 'i18next'
import { ReadonlyDeep } from 'type-fest'
import { assertUnreachable } from '../assert-unreachable'
import { GameDefaultsPreset, LocalSettings, StartingFog, TeamColorPreset } from './local-settings'

/** The local settings whose values a {@link GameDefaultsPreset} decides. */
export const GAME_DEFAULTS_PRESET_KEYS = [
  'startingFog',
  'legacyCursorSizing',
  'teamColorPreset',
  'grabPanSensitivityOn',
] as const

export type GameDefaultsPresetKey = (typeof GAME_DEFAULTS_PRESET_KEYS)[number]

export type GameDefaultsPresetValues = Pick<LocalSettings, GameDefaultsPresetKey>

/**
 * The values each preset assigns to the settings it covers. `Recommended` must stay equal to the
 * corresponding entries of `DEFAULT_LOCAL_SETTINGS`, since a fresh settings file is created from
 * those defaults before the user has chosen a preset.
 */
export const GAME_DEFAULTS_PRESET_VALUES: ReadonlyDeep<
  Record<GameDefaultsPreset, GameDefaultsPresetValues>
> = {
  [GameDefaultsPreset.Recommended]: {
    startingFog: StartingFog.ShowTerrainAndResources,
    legacyCursorSizing: false,
    teamColorPreset: TeamColorPreset.CoolVsWarm,
    grabPanSensitivityOn: true,
  },
  [GameDefaultsPreset.Legacy]: {
    startingFog: StartingFog.Legacy,
    legacyCursorSizing: true,
    teamColorPreset: TeamColorPreset.LegacyDiplomacy,
    grabPanSensitivityOn: false,
  },
}

/**
 * Returns the covered settings whose current value differs from what `preset` would assign them.
 */
export function getGameDefaultsMismatches(
  settings: Readonly<GameDefaultsPresetValues>,
  preset: GameDefaultsPreset,
): GameDefaultsPresetKey[] {
  const values = GAME_DEFAULTS_PRESET_VALUES[preset]
  return GAME_DEFAULTS_PRESET_KEYS.filter(key => settings[key] !== values[key])
}

export function getGameDefaultsPresetLabel(preset: GameDefaultsPreset, t: TFunction): string {
  switch (preset) {
    case GameDefaultsPreset.Recommended:
      return t('settings.game.defaults.preset.recommended', 'Recommended')
    case GameDefaultsPreset.Legacy:
      return t('settings.game.defaults.preset.legacy', 'Legacy')
    default:
      return assertUnreachable(preset)
  }
}
