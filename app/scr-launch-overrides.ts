import { LocalSettings, ScrSettings } from '../common/settings/local-settings'

/**
 * Whether a game launched with these settings must start in SD graphics: the player asked for it,
 * or the dev-only `disableHd` keeps the game out of HD entirely, which the game refuses to launch
 * with HD graphics on.
 */
export function startsInSd(settings: Readonly<Partial<LocalSettings>>): boolean {
  return Boolean(settings.alwaysStartSd || settings.disableHd)
}

/** SC:R's name for the HD graphics setting in its settings file. */
const HD_GRAPHICS_KEY = 'HDPreferences'

/**
 * Applies launch-time overrides to the SC:R settings contents a game will read at startup. Returns
 * a new object; the input is not modified.
 */
export function applyLaunchOverrides(
  blizzardSettings: Readonly<Record<string, any>>,
  options: { alwaysStartSd: boolean },
): Record<string, any> {
  if (!options.alwaysStartSd) {
    return { ...blizzardSettings }
  }
  return { ...blizzardSettings, [HD_GRAPHICS_KEY]: false }
}

/**
 * The same overrides as {@link applyLaunchOverrides}, applied to the settings the game is sent at
 * launch, so what it shows (its options screen) matches what it read from its settings file.
 */
export function applyLaunchOverridesToSettings<T extends Partial<ScrSettings>>(
  settings: Readonly<T>,
  options: { alwaysStartSd: boolean },
): T {
  if (!options.alwaysStartSd) {
    return { ...settings }
  }
  return { ...settings, hdGraphicsOn: false }
}

/**
 * Removes the settings that {@link applyLaunchOverrides} may have forced from settings read back
 * out of the game's settings file, so a forced value is never mistaken for the player's choice.
 */
export function dropLaunchOverriddenSettings(settings: Partial<ScrSettings>): void {
  delete settings.hdGraphicsOn
}
