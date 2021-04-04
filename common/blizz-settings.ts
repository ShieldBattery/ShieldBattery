import { assertUnreachable } from './assert-unreachable'

/**
 * Purchaseable/unlockable custom console skins (e.g. ingame UI). The values of these match the ones
 * that get stored in CSettings.json.
 */
export enum ConsoleSkin {
  Default = 'Default',
  BlizzCon2017 = 'bc2017',
  BlizzCon2018 = 'bc2018',
  SC20thAnniversary = 'SC_20thAnniversary',
  KrcSilver = 'KRC_Silver',
  KrcGold = 'KRC_Gold',
  War3Spoils = 'War3Spoils',
}

export const ALL_CONSOLE_SKINS: Readonly<ConsoleSkin[]> = Object.values(ConsoleSkin)

/**
 * Returns a displayable name for a `ConsoleSkin`.
 */
export function getConsoleSkinName(skin: ConsoleSkin): string {
  switch (skin) {
    case ConsoleSkin.Default:
      return 'Default'
    case ConsoleSkin.BlizzCon2017:
      return 'BlizzCon 2017'
    case ConsoleSkin.BlizzCon2018:
      return 'BlizzCon 2018'
    case ConsoleSkin.SC20thAnniversary:
      return 'StarCraft 20th Anniversary'
    case ConsoleSkin.KrcSilver:
      return 'KRC Silver'
    case ConsoleSkin.KrcGold:
      return 'KRC Gold'
    case ConsoleSkin.War3Spoils:
      return 'WarCraft 3 Spoils'
    default:
      return assertUnreachable(skin)
  }
}

/**
 * Purchaseable/unlockable custom building/unit skins. The values of these match the ones that get
 * stored in CSettings.json.
 */
export enum IngameSkin {
  Default = '',
  Preorder = 'presale',
  Carbot = 'carbot',
}

export const ALL_INGAME_SKINS: Readonly<IngameSkin[]> = Object.values(IngameSkin)

/**
 * Returns a displayable name for an `IngameSkin`.
 */
export function getIngameSkinName(skin: IngameSkin): string {
  switch (skin) {
    case IngameSkin.Default:
      return 'None'
    case IngameSkin.Preorder:
      return 'Preorder'
    case IngameSkin.Carbot:
      return 'Carbot'
    default:
      return assertUnreachable(skin)
  }
}

/**
 * The type of rendering setup the game will use.
 */
export enum DisplayMode {
  Windowed = 0,
  WindowedFullscreen = 1,
  Fullscreen = 2,
}

// NOTE(tec27): The Object.values() method doesn't work for number enums because TS adds mirror
// values for the string names
export const ALL_DISPLAY_MODES: Readonly<DisplayMode[]> = [
  DisplayMode.Windowed,
  DisplayMode.WindowedFullscreen,
  DisplayMode.Fullscreen,
]

/**
 * Returns a displayable name for a `DisplayMode`.
 */
export function getDisplayModeName(mode: DisplayMode): string {
  switch (mode) {
    case DisplayMode.Windowed:
      return 'Windowed'
    case DisplayMode.WindowedFullscreen:
      return 'Windowed (Fullscreen)'
    case DisplayMode.Fullscreen:
      return 'Fullscreen'
    default:
      return assertUnreachable(mode)
  }
}
