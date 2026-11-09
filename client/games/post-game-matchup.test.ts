import { describe, expect, test } from 'vitest'
import { GameSource, MatchmakingGameConfig } from '../../common/games/configuration'
import { GameType } from '../../common/games/game-type'
import { GameRecordJson } from '../../common/games/games'
import { makeSbMapId } from '../../common/maps'
import { MatchmakingType } from '../../common/matchmaking'
import { makeSbUserId } from '../../common/users/sb-user-id'
import { getPostGameMatchup } from './post-game-matchup'

const P1 = makeSbUserId(1)
const P2 = makeSbUserId(2)
const P3 = makeSbUserId(3)
const P4 = makeSbUserId(4)

function makeGame(overrides: {
  gameType: GameType
  teams: MatchmakingGameConfig['teams']
  results?: GameRecordJson['results']
}): GameRecordJson {
  const { gameType, teams, results = null } = overrides
  return {
    id: 'game-id',
    startTime: 0,
    mapId: makeSbMapId('map-id'),
    config: {
      gameSource: GameSource.Matchmaking,
      gameSourceExtra: { type: MatchmakingType.Match1v1 },
      gameType,
      gameSubType: 0,
      teams,
    },
    disputable: false,
    disputeRequested: false,
    disputeReviewed: false,
    gameLength: null,
    results,
    selectedMatchup: null,
    assignedMatchup: null,
    manuallyResolved: false,
  }
}

describe('client/games/post-game-matchup/getPostGameMatchup', () => {
  test('makes each player their own side in a game without teams', () => {
    const game = makeGame({
      gameType: GameType.OneVsOne,
      teams: [
        [
          { id: P1, race: 't', isComputer: false },
          { id: P2, race: 'z', isComputer: false },
        ],
      ],
    })

    expect(getPostGameMatchup(game, P1)).toEqual([['t'], ['z']])
  })

  test('puts the viewing player first', () => {
    const game = makeGame({
      gameType: GameType.OneVsOne,
      teams: [
        [
          { id: P1, race: 't', isComputer: false },
          { id: P2, race: 'z', isComputer: false },
        ],
      ],
    })

    expect(getPostGameMatchup(game, P2)).toEqual([['z'], ['t']])
  })

  test('keeps teams together, with the viewing player’s team first', () => {
    const game = makeGame({
      gameType: GameType.TopVsBottom,
      teams: [
        [
          { id: P1, race: 't', isComputer: false },
          { id: P2, race: 'p', isComputer: false },
        ],
        [
          { id: P3, race: 'z', isComputer: false },
          { id: P4, race: 'z', isComputer: false },
        ],
      ],
    })

    expect(getPostGameMatchup(game, P3)).toEqual([
      ['z', 'z'],
      ['t', 'p'],
    ])
  })

  test('shows what Random became once results are in', () => {
    const game = makeGame({
      gameType: GameType.OneVsOne,
      teams: [
        [
          { id: P1, race: 'r', isComputer: false },
          { id: P2, race: 'z', isComputer: false },
        ],
      ],
      results: [
        [P1, { result: 'win', race: 'p', apm: 100 }],
        [P2, { result: 'loss', race: 'z', apm: 100 }],
      ],
    })

    expect(getPostGameMatchup(game, P1)).toEqual([['p'], ['z']])
  })

  test('leaves Random as it was while results are pending', () => {
    const game = makeGame({
      gameType: GameType.OneVsOne,
      teams: [
        [
          { id: P1, race: 'r', isComputer: false },
          { id: P2, race: 'z', isComputer: false },
        ],
      ],
    })

    expect(getPostGameMatchup(game, P1)).toEqual([['r'], ['z']])
  })
})
