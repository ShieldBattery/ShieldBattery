import { enableMapSet, Immutable } from 'immer'
import { describe, expect, test } from 'vitest'
import { MatchmakingResultsEvent } from '../../common/games/games'
import { GetRankForUserResponse, LadderPlayer } from '../../common/ladder/ladder'
import {
  CURRENT_DIVISION_TABLE_VERSION,
  makeSeasonId,
  MatchmakingSeasonJson,
  MatchmakingType,
  PublicMatchmakingRatingChangeJson,
} from '../../common/matchmaking'
import { makeSbUserId } from '../../common/users/sb-user-id'
import { ReduxAction } from '../action-types'
import reducerImport, { SelfRankState } from './self-rank-reducer'

enableMapSet()

const reducer: (
  state: Immutable<SelfRankState> | undefined,
  action: ReduxAction,
) => Immutable<SelfRankState> = reducerImport

const type = MatchmakingType.Match1v1
const userId = makeSbUserId(1)

function makeSeason(id: number): MatchmakingSeasonJson {
  return {
    id: makeSeasonId(id),
    startDate: 0,
    name: `Season ${id}`,
    resetMmr: false,
    divisionTableVersion: CURRENT_DIVISION_TABLE_VERSION,
  }
}

const season = makeSeason(2)

/** The state after the user's standings have loaded with `ranks`. */
function loaded(ranks: Partial<Record<MatchmakingType, Partial<LadderPlayer>>> = {}) {
  return reducer(undefined, {
    type: '@ladder/getInstantaneousSelfRank',
    payload: { ranks, currentSeason: season } as GetRankForUserResponse,
  })
}

function receiveResults(
  state: Immutable<SelfRankState> | undefined,
  mmrChange: Partial<PublicMatchmakingRatingChangeJson>,
  resultsSeason = season,
) {
  return reducer(state, {
    type: '@matchmaking/resultsReceived',
    payload: {
      userId,
      mmrChange: { userId, matchmakingType: type, outcome: 'win', ...mmrChange },
      season: resultsSeason,
    } as MatchmakingResultsEvent,
  })
}

const before: Partial<LadderPlayer> = {
  matchmakingType: type,
  rating: 1500,
  points: 2000,
  bonusUsed: 100,
  lifetimeGames: 30,
  wins: 6,
  losses: 4,
}

describe('client/matchmaking/self-rank-reducer', () => {
  test("updates the standing from a game's results", () => {
    const state = receiveResults(loaded({ [type]: before }), {
      outcome: 'win',
      rating: 1520,
      points: 2096,
      bonusUsed: 148,
      lifetimeGames: 31,
    })

    expect(state.byType.get(type)).toEqual({
      matchmakingType: type,
      rating: 1520,
      points: 2096,
      bonusUsed: 148,
      lifetimeGames: 31,
      wins: 7,
      losses: 4,
    })
  })

  test('counts a loss', () => {
    const state = receiveResults(loaded({ [type]: before }), {
      outcome: 'loss',
      rating: 1480,
      points: 1950,
      bonusUsed: 100,
      lifetimeGames: 31,
    })

    expect(state.byType.get(type)).toMatchObject({ rating: 1480, wins: 6, losses: 5 })
  })

  test('adds a standing for a type that had none when the standings loaded', () => {
    const state = receiveResults(loaded(), {
      outcome: 'win',
      rating: 0,
      points: 96,
      bonusUsed: 48,
      lifetimeGames: 1,
    })

    expect(state.byType.get(type)).toEqual({
      matchmakingType: type,
      rating: 0,
      points: 96,
      bonusUsed: 48,
      lifetimeGames: 1,
      wins: 1,
      losses: 0,
    })
  })

  test('leaves the standings of other types alone', () => {
    const other = { ...before, matchmakingType: MatchmakingType.Match2v2 }
    const state = receiveResults(loaded({ [type]: before, [MatchmakingType.Match2v2]: other }), {
      rating: 1520,
      points: 2096,
      bonusUsed: 148,
      lifetimeGames: 31,
    })

    expect(state.byType.get(MatchmakingType.Match2v2)).toEqual(other)
  })

  test('ignores results for a game the standing already includes', () => {
    const initial = loaded({ [type]: before })

    // Both the newest game arriving twice and an older game arriving late
    for (const lifetimeGames of [30, 12]) {
      const state = receiveResults(initial, {
        rating: 1400,
        points: 1200,
        bonusUsed: 60,
        lifetimeGames,
      })
      expect(state.byType.get(type)).toEqual(before)
    }
  })

  test('ignores results for a game from another season', () => {
    const state = receiveResults(
      loaded({ [type]: before }),
      { rating: 1700, points: 5000, bonusUsed: 900, lifetimeGames: 31 },
      makeSeason(1),
    )

    expect(state.byType.get(type)).toEqual(before)
  })

  test('ignores results before the standings have loaded', () => {
    const state = receiveResults(undefined, {
      rating: 1520,
      points: 2096,
      bonusUsed: 148,
      lifetimeGames: 31,
    })

    expect(state.byType.size).toBe(0)
    expect(state.currentSeason).toBeUndefined()
  })
})
