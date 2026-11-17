import { describe, expect, test } from 'vitest'
import { GameConfig, GameSource } from '../../../common/games/configuration'
import { GameType } from '../../../common/games/game-type'
import { GameRecord } from '../../../common/games/games'
import { makeSbMapId } from '../../../common/maps'
import { MatchmakingType } from '../../../common/matchmaking'
import { makeSbUserId } from '../../../common/users/sb-user-id'
import { generateReplayFilename } from './replay-filenames'

const START_TIME = new Date(1703692800 * 1000)
const TEAMS = [[{ id: makeSbUserId(1), race: 'z' as const, isComputer: false }]]

function makeGameRecord(config: GameConfig): GameRecord {
  return {
    id: 'game-1',
    startTime: START_TIME,
    mapId: makeSbMapId('map-1'),
    config,
    disputable: false,
    disputeRequested: false,
    disputeReviewed: false,
    gameLength: null,
    results: null,
    selectedMatchup: null,
    assignedMatchup: null,
    manuallyResolved: false,
  }
}

describe('replays/replay-filenames/generateReplayFilename', () => {
  test('names a matchmaking replay after its type', () => {
    const game = makeGameRecord({
      gameType: GameType.OneVsOne,
      gameSubType: 0,
      gameSource: GameSource.Matchmaking,
      gameSourceExtra: { type: MatchmakingType.Match1v1 },
      teams: TEAMS,
    })
    expect(generateReplayFilename(game, 'Fighting Spirit')).toBe(
      'SB-1v1-Fighting_Spirit-1703692800',
    )
  })

  test('names a lobby replay as one', () => {
    const game = makeGameRecord({
      gameType: GameType.Melee,
      gameSubType: 0,
      gameSource: GameSource.Lobby,
      teams: TEAMS,
    })
    expect(generateReplayFilename(game, 'Fighting Spirit')).toBe(
      'SB-Lobby-Fighting_Spirit-1703692800',
    )
  })

  test('names a solo replay as one', () => {
    const game = makeGameRecord({
      gameType: GameType.UseMapSettings,
      gameSubType: 0,
      gameSource: GameSource.Solo,
      teams: TEAMS,
    })
    expect(generateReplayFilename(game, 'Marine Training')).toBe(
      'SB-Solo-Marine_Training-1703692800',
    )
  })
})
