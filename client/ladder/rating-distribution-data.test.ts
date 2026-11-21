import { describe, expect, test } from 'vitest'
import { MatchmakingDivision, NUM_PLACEMENT_MATCHES } from '../../common/matchmaking'
import {
  buildRatingDistribution,
  fractionAtOrAbove,
  hasVisibleRating,
  pickBucketWidth,
} from './rating-distribution-data'

interface TestPlayer {
  rating: number
  lifetimeGames: number
  division: MatchmakingDivision
}

function player(rating: number, division = MatchmakingDivision.Gold1): TestPlayer {
  return { rating, lifetimeGames: NUM_PLACEMENT_MATCHES, division }
}

const divisionOf = (p: Readonly<TestPlayer>) => p.division

describe('client/ladder/rating-distribution-data', () => {
  test('hasVisibleRating excludes players in placements', () => {
    expect(hasVisibleRating({ rating: 1500, lifetimeGames: NUM_PLACEMENT_MATCHES })).toBe(true)
    expect(hasVisibleRating({ rating: 0, lifetimeGames: NUM_PLACEMENT_MATCHES - 1 })).toBe(false)
    expect(hasVisibleRating({ rating: 0, lifetimeGames: 20 })).toBe(false)
  })

  test('pickBucketWidth uses the narrowest width within the bucket limit', () => {
    expect(pickBucketWidth(0)).toBe(10)
    expect(pickBucketWidth(500)).toBe(10)
    expect(pickBucketWidth(1950)).toBe(50)
    expect(pickBucketWidth(2600)).toBe(100)
    expect(pickBucketWidth(1_000_000)).toBe(500)
  })

  test('returns an empty distribution when nobody is rated', () => {
    const result = buildRatingDistribution(
      [{ rating: 0, lifetimeGames: 2, division: MatchmakingDivision.Unrated }],
      divisionOf,
    )
    expect(result.buckets).toEqual([])
    expect(result.ratedCount).toBe(0)
    expect(result.median).toBeUndefined()
  })

  test('buckets players with no gaps and cumulative counts', () => {
    const players = [
      player(1000),
      player(1005),
      player(1490),
      { rating: 0, lifetimeGames: 1, division: MatchmakingDivision.Unrated },
    ]
    const result = buildRatingDistribution(players, divisionOf)

    expect(result.bucketWidth).toBe(10)
    expect(result.ratedCount).toBe(3)
    expect(result.median).toBe(1005)
    expect(result.buckets[0]).toMatchObject({ start: 1000, end: 1010, count: 2, atOrAbove: 3 })
    expect(result.buckets.at(-1)).toMatchObject({ start: 1490, end: 1500, count: 1, atOrAbove: 1 })
    expect(result.buckets).toHaveLength(50)
    expect(result.buckets.reduce((sum, b) => sum + b.count, 0)).toBe(3)
    expect(result.buckets[1]).toMatchObject({ count: 0, division: MatchmakingDivision.Unrated })
  })

  test('colors a bucket by its most common division, preferring the higher on ties', () => {
    const result = buildRatingDistribution(
      [
        player(1000, MatchmakingDivision.Gold1),
        player(1001, MatchmakingDivision.Gold2),
        player(1002, MatchmakingDivision.Gold2),
        player(1100, MatchmakingDivision.Gold3),
        player(1101, MatchmakingDivision.Platinum1),
      ],
      divisionOf,
    )
    expect(result.buckets[0].division).toBe(MatchmakingDivision.Gold2)
    expect(result.buckets.at(-1)!.division).toBe(MatchmakingDivision.Platinum1)
  })

  test('averages the middle pair for an even median', () => {
    const result = buildRatingDistribution([player(1000), player(1100)], divisionOf)
    expect(result.median).toBe(1050)
  })

  test('fractionAtOrAbove counts ties as at-or-above', () => {
    const sorted = [1000, 1100, 1100, 1200]
    expect(fractionAtOrAbove(sorted, 1200)).toBe(0.25)
    expect(fractionAtOrAbove(sorted, 1100)).toBe(0.75)
    expect(fractionAtOrAbove(sorted, 900)).toBe(1)
    expect(fractionAtOrAbove(sorted, 1300)).toBe(0)
    expect(fractionAtOrAbove([], 1000)).toBe(0)
  })
})
