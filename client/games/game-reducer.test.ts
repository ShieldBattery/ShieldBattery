import { describe, expect, test } from 'vitest'
import { GameSource } from '../../common/games/configuration'
import { GameRecordJson } from '../../common/games/games'
import { MatchmakingType, PublicMatchmakingRatingChangeJson } from '../../common/matchmaking'
import { makeSbUserId } from '../../common/users/sb-user-id'
import gameReducer from './game-reducer'

function makeGame(id: string, gameSource: GameSource, reconciled = true): GameRecordJson {
  return {
    id,
    config: { gameSource, teams: [] },
    results: reconciled ? [] : null,
  } as unknown as GameRecordJson
}

function change(gameId: string, userId: number): PublicMatchmakingRatingChangeJson {
  return {
    gameId,
    userId: makeSbUserId(userId),
    matchmakingType: MatchmakingType.Match1v1,
  } as PublicMatchmakingRatingChangeJson
}

describe('client/games/game-reducer list responses', () => {
  test("stores each ranked game's rating changes, and none for custom games", () => {
    const state = gameReducer(undefined, {
      type: '@games/getGames',
      payload: {
        games: [
          makeGame('ranked', GameSource.Matchmaking),
          makeGame('ranked-no-changes', GameSource.Matchmaking),
          makeGame('custom', GameSource.Lobby),
        ],
        maps: [],
        users: [],
        hasMoreGames: false,
        replays: [],
        mmrChanges: [change('ranked', 1), change('ranked', 2)],
      },
    } as any)

    expect(state.byId.size).toBe(3)
    expect(Array.from(state.mmrChangesById.get('ranked')!.keys())).toEqual([
      makeSbUserId(1),
      makeSbUserId(2),
    ])
    // A list carries all of a game's changes, so a ranked game without any is known to have none.
    expect(state.mmrChangesById.get('ranked-no-changes')!.size).toBe(0)
    expect(state.mmrChangesById.has('custom')).toBe(false)
  })

  test('leaves unreconciled ranked games without an entry', () => {
    const state = gameReducer(undefined, {
      type: '@games/browseGames',
      payload: {
        games: [makeGame('pending', GameSource.Matchmaking, false)],
        maps: [],
        users: [],
        replays: [],
        mmrChanges: [],
      },
    } as any)

    expect(state.byId.has('pending')).toBe(true)
    expect(state.mmrChangesById.has('pending')).toBe(false)
  })
})
