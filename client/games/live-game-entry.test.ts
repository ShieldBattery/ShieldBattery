import { describe, expect, test } from 'vitest'
import { MatchmakingDivision, MatchmakingType } from '../../common/matchmaking'
import { getCurrentDivision } from './live-game-entry'

describe('client/games/live-game-entry/getCurrentDivision', () => {
  test('is unrated while placement matches remain', () => {
    expect(
      getCurrentDivision(
        { matchmakingType: MatchmakingType.Match1v1, points: 5000, lifetimeGames: 4 },
        0,
      ),
    ).toBe(MatchmakingDivision.Unrated)
  })

  test('places points into a division once placements are done', () => {
    expect(
      getCurrentDivision(
        { matchmakingType: MatchmakingType.Match1v1, points: 5000, lifetimeGames: 5 },
        0,
      ),
    ).toBe(MatchmakingDivision.Gold1)
  })

  test('accounts for the bonus pool', () => {
    const rank = { matchmakingType: MatchmakingType.Match1v1, points: 5000, lifetimeGames: 20 }
    expect(getCurrentDivision(rank, 0)).toBe(MatchmakingDivision.Gold1)
    expect(getCurrentDivision(rank, 3000)).toBe(MatchmakingDivision.Silver3)
  })
})
