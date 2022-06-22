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
  UseMapSettings = 10,
  TeamMelee = 11,
  TeamFreeForAll = 12,
  TopVsBottom = 15,
}

export function replayGameTypeToLabel(gameType: SupportedReplayGameType): string {
  switch (gameType) {
    case SupportedReplayGameType.Melee:
      return 'Melee'
    case SupportedReplayGameType.FreeForAll:
      return 'Free for all'
    case SupportedReplayGameType.OneVsOne:
      return 'One on one'
    case SupportedReplayGameType.UseMapSettings:
      return 'Use map settings'
    case SupportedReplayGameType.TeamMelee:
      return 'Team melee'
    case SupportedReplayGameType.TeamFreeForAll:
      return 'Team free for all'
    case SupportedReplayGameType.TopVsBottom:
      return 'Top vs bottom'
    default:
      return assertUnreachable(gameType)
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
   * can match the index in this array to an index in players array we get from the header.
   *
   * The order of this array should match the order of the `players` array in the replay header,
   * such as that `header.players[i]` and `userIds[i]` point to the same player.
   */
  userIds: SbUserId[]
}
