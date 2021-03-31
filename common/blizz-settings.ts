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

/**
 * Returns a displayable name for an `IngameSkin`.
 */
export function getIngameSkinName(skin: IngameSkin): string {
  switch (skin) {
    case IngameSkin.Default:
      return 'Default'
    case IngameSkin.Preorder:
      return 'Preorder'
    case IngameSkin.Carbot:
      return 'Carbot'
    default:
      return assertUnreachable(skin)
  }
}
