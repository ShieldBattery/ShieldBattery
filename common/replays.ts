import { ReplayRace } from 'jssuh'
import { assertUnreachable } from './assert-unreachable'
import { RaceChar } from './races'

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
