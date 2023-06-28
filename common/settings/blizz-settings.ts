import { TFunction } from 'i18next'
import { assertUnreachable } from '../assert-unreachable'

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
export function getConsoleSkinName(skin: ConsoleSkin, t: TFunction): string {
  switch (skin) {
    case ConsoleSkin.Default:
      return t('settings.game.gameplay.consoleSkins.default', 'Default')
    case ConsoleSkin.BlizzCon2017:
      return t('settings.game.gameplay.consoleSkins.blizzcon2017', 'BlizzCon 2017')
    case ConsoleSkin.BlizzCon2018:
      return t('settings.game.gameplay.consoleSkins.blizzcon2018', 'BlizzCon 2018')
    case ConsoleSkin.SC20thAnniversary:
      return t('settings.game.gameplay.consoleSkins.20thAnniversary', 'StarCraft 20th Anniversary')
    case ConsoleSkin.KrcSilver:
      return t('settings.game.gameplay.consoleSkins.krcSilver', 'KRC Silver')
    case ConsoleSkin.KrcGold:
      return t('settings.game.gameplay.consoleSkins.krcGold', 'KRC Gold')
    case ConsoleSkin.War3Spoils:
      return t('settings.game.gameplay.consoleSkins.warcraft3', 'WarCraft 3 Spoils')
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
export function getIngameSkinName(skin: IngameSkin, t: TFunction): string {
  switch (skin) {
    case IngameSkin.Default:
      return t('settings.game.gameplay.ingameSkins.none', 'None')
    case IngameSkin.Preorder:
      return t('settings.game.gameplay.ingameSkins.preorder', 'Preorder')
    case IngameSkin.Carbot:
      return t('settings.game.gameplay.ingameSkins.carbot', 'Carbot')
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
export function getDisplayModeName(mode: DisplayMode, t: TFunction): string {
  switch (mode) {
    case DisplayMode.Windowed:
      return t('settings.game.video.displayMode.windowed', 'Windowed')
    case DisplayMode.WindowedFullscreen:
      return t('settings.game.video.displayMode.windowedFullscreen', 'Windowed (Fullscreen)')
    case DisplayMode.Fullscreen:
      return t('settings.game.video.displayMode.fullscreen', 'Fullscreen')
    default:
      return assertUnreachable(mode)
  }
}

/**
 * Custom announcers that can be selected for the `selectedAnnouncer` value in SC:R settings.
 */
export enum Announcer {
  Default = 'default',
  Jaekyung = 'Jaekyung',
  Yongjun = 'Yongjun',
  Jungmin = 'Jungmin',
  UmJeonKim = 'UmJeonKim',
  Jini = 'Jini',
}

export const ALL_ANNOUNCERS: Readonly<Announcer[]> = Object.values(Announcer)

/** Returns a displayable name for an `Announcer`. */
export function getAnnouncerName(announcer: Announcer, t: TFunction): string {
  switch (announcer) {
    case Announcer.Default:
      return t('settings.game.sound.announcer.default', 'Default')
    case Announcer.Jaekyung:
      return t('settings.game.sound.announcer.umJaeKyung', 'Um Jae Kyung')
    case Announcer.Jini:
      return t('settings.game.sound.announcer.heyJini', 'Hey Jini')
    case Announcer.Jungmin:
      return t('settings.game.sound.announcer.kimJungmin', 'Kim Jungmin')
    case Announcer.UmJeonKim:
      return t('settings.game.sound.announcer.umJeonKim', 'Um, Jeon, Kim Trio')
    case Announcer.Yongjun:
      return t('settings.game.sound.announcer.jeonYongJun', 'Jeon Yong Jun')
    default:
      return assertUnreachable(announcer)
  }
}
