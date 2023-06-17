import { TFunction } from 'i18next'
import { ReplayRace } from 'jssuh'
import { assertUnreachable } from './assert-unreachable'
import { RaceChar } from './races'
import { SbUserId } from './users/sb-user'

export function replayRaceToChar(name: ReplayRace): RaceChar {
  switch (name) {
    case 'protoss':
      return 'p'
    case 'unknown':
      return 'r'
    case 'terran':
      return 't'
    case 'zerg':
      return 'z'
    default:
      return assertUnreachable(name)
  }
}

// TODO(2Pac): Create this enum as a subset from an enum of all possible game types that `jssuh`
// should expose, so we don't have to use these magic numbers here.
enum SupportedReplayGameType {
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

// TODO(2Pac): Share this with the game code somehow?
/**
 * This is the value that's inserted in the `userIds` array of the ShieldBattery's replay data, for
 * every non-human slot.
 */
export const NON_EXISTING_USER_ID = 0xffffffff

export interface ReplayShieldBatteryData {
  /** The version number of the current format of the ShieldBattery replay data section. */
  formatVersion: number
  /** The version of the StarCraft's EXE build number on which this replay way played. */
  starcraftExeBuild: number
  /** The version of the ShieldBattery application on which this replay was played. */
  shieldBatteryVersion: string
  /** The game ID of this replay, allowing us to link this replay to the game info in our system. */
  gameId: string
  /**
   * The list of user IDs that were in this game. In case there were less than 8 players in the
   * game, all "empty" user IDs will be set to 0xFFFF_FFFF. We keep those IDs in the array, so we
   * can match the index in this array to an ID in players array we get from the header.
   *
   * The order of this array can be used to match the user IDs with players from the replay header,
   * such that `userIds[player.id]` will give you the player's SB user ID.
   */
  userIds: SbUserId[]
}
