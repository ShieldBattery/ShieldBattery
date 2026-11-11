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
/** SC:R's name for the hardware cursor setting in its settings file. */
const HARDWARE_CURSOR_KEY = 'MouseHardwareCursor'
/** SC:R's name for the mouse scaling setting in its settings file. */
const MOUSE_SCALING_KEY = 'MouseScaling'

/**
 * Applies launch-time overrides to the SC:R settings contents a game will read at startup. Returns
 * a new object; the input is not modified.
 *
 * Mouse scaling is always off while the hardware cursor is on. The settings screens grey scaling
 * out under the hardware cursor, but SC:R applies both if it is given both, confining the system
 * cursor to a scaled-down box and drawing its own cursor in place of the hardware one.
 */
export function applyLaunchOverrides(
  blizzardSettings: Readonly<Record<string, any>>,
  options: { alwaysStartSd: boolean },
): Record<string, any> {
  const result = { ...blizzardSettings }
  if (options.alwaysStartSd) {
    result[HD_GRAPHICS_KEY] = false
  }
  if (result[HARDWARE_CURSOR_KEY]) {
    result[MOUSE_SCALING_KEY] = false
  }
  return result
}

/**
 * The same overrides as {@link applyLaunchOverrides}, applied to the settings the game is sent at
 * launch, so what it shows (its options screen) matches what it read from its settings file.
 */
export function applyLaunchOverridesToSettings<T extends Partial<ScrSettings>>(
  settings: Readonly<T>,
  options: { alwaysStartSd: boolean },
): T {
  let result: T = { ...settings }
  if (options.alwaysStartSd) {
    result = { ...result, hdGraphicsOn: false }
  }
  if (result.hardwareCursorOn) {
    result = { ...result, mouseScalingOn: false }
  }
  return result
}

/**
 * Removes the settings that {@link applyLaunchOverrides} may have forced from settings read back
 * out of the game's settings file, so a forced value is never mistaken for the player's choice.
 *
 * Mouse scaling is kept: turning it off under the hardware cursor is what the settings screens
 * already show the player, so saving it makes the stored setting agree with them.
 */
export function dropLaunchOverriddenSettings(settings: Partial<ScrSettings>): void {
  delete settings.hdGraphicsOn
}
