import type { GameType } from '@shieldbattery/broodrep'
import { TFunction } from 'i18next'

export enum SupportedReplayGameType {
  Melee = 2,
  FreeForAll = 3,
  OneVsOne = 4,
  CaptureTheFlag = 5,
  Greed = 6,
  Slaughter = 7,
  SuddenDeath = 8,
  UseMapSettings = 10,
  TeamMelee = 11,
  TeamFreeForAll = 12,
  TeamCaptureTheFlag = 13,
  TopVsBottom = 15,
}

/**
 * The game types offered as standalone options in the replay Mode filter. Anything else is
 * grouped under the filter's "Others" option.
 */
export const FEATURED_REPLAY_GAME_TYPES: ReadonlyArray<SupportedReplayGameType> = [
  SupportedReplayGameType.Melee,
  SupportedReplayGameType.FreeForAll,
  SupportedReplayGameType.OneVsOne,
  SupportedReplayGameType.UseMapSettings,
  SupportedReplayGameType.TopVsBottom,
]

export function replayGameTypeToLabel(gameType: SupportedReplayGameType, t: TFunction): string {
  switch (gameType) {
    case SupportedReplayGameType.Melee:
      return t('game.gameType.melee', 'Melee')
    case SupportedReplayGameType.FreeForAll:
      return t('game.gameType.freeForAll', 'Free for all')
    case SupportedReplayGameType.OneVsOne:
      return t('game.gameType.oneOnOne', 'One on one')
    case SupportedReplayGameType.CaptureTheFlag:
      return t('game.gameType.captureTheFlag', 'Capture the flag')
    case SupportedReplayGameType.Greed:
      return t('game.gameType.greed', 'Greed')
    case SupportedReplayGameType.Slaughter:
      return t('game.gameType.slaughter', 'Slaughter')
    case SupportedReplayGameType.SuddenDeath:
      return t('game.gameType.suddenDeath', 'Sudden death')
    case SupportedReplayGameType.UseMapSettings:
      return t('game.gameType.useMapSettings', 'Use map settings')
    case SupportedReplayGameType.TeamMelee:
      return t('game.gameType.teamMelee', 'Team melee')
    case SupportedReplayGameType.TeamFreeForAll:
      return t('game.gameType.teamFreeForAll', 'Team free for all')
    case SupportedReplayGameType.TeamCaptureTheFlag:
      return t('game.gameType.teamCaptureTheFlag', 'Team capture the flag')
    case SupportedReplayGameType.TopVsBottom:
      return t('game.gameType.topVsBottom', 'Top vs bottom')
    default:
      return t('game.gameType.unknown', 'Unknown')
  }
}

/**
 * Maps broodrep's named `GameType` to the numeric game type stored in the replay index, per
 * broodrep's own `From<u16>` implementation.
 */
export const replayGameTypeToNumber: Record<GameType, number> = {
  none: 0,
  melee: 2,
  freeForAll: 3,
  oneOnOne: 4,
  captureTheFlag: 5,
  greed: 6,
  slaughter: 7,
  suddenDeath: 8,
  ladder: 9,
  useMapSettings: 10,
  teamMelee: 11,
  teamFreeForAll: 12,
  teamCaptureTheFlag: 13,
  topVsBottom: 15,
  unknown: 0,
}

// TODO(2Pac): Share this with the game code somehow?
/**
 * This is the value that's inserted in the `userIds` array of the ShieldBattery's replay data, for
 * every non-human slot.
 */
export const NON_EXISTING_USER_ID = 0xffffffff
