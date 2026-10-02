import { describe, expect, test } from 'vitest'
import { MatchmakingType, SeasonId } from '../../../common/matchmaking'
import { makeSbUserId } from '../../../common/users/sb-user-id'
import { Redis } from '../redis/redis'
import { getRankings, getRankingsForUser, rankByPoints } from './rankings'

const SEASON = 1 as SeasonId

/** Holds sorted sets in memory and answers the commands `rankings.ts` reads them with. */
class FakeRedisClient {
  readonly sets = new Map<string, Map<string, number>>()

  set(type: MatchmakingType, points: Record<number, number>) {
    this.sets.set(
      `rankings:${type}:${SEASON}`,
      new Map(Object.entries(points).map(([userId, score]) => [userId, score])),
    )
  }

  async zRangeWithScores(key: string, start: number, stop: number, options: { REV: boolean }) {
    if (start !== 0 || stop !== -1 || !options.REV) {
      throw new Error('only full reversed ranges are supported')
    }
    // Sorted sets order equal scores by member, and REV reverses that too. Members are unique, so
    // two entries never compare equal.
    return Array.from(this.sets.get(key) ?? [], ([value, score]) => ({ value, score })).sort(
      (a, b) => b.score - a.score || (a.value < b.value ? 1 : -1),
    )
  }

  async zScore(key: string, member: string) {
    return this.sets.get(key)?.get(member) ?? null
  }

  async zCount(key: string, min: string, max: string) {
    if (!min.startsWith('(') || max !== '+inf') {
      throw new Error('only exclusive minimums up to +inf are supported')
    }
    const exclusiveMin = Number(min.slice(1))
    return Array.from(this.sets.get(key)?.values() ?? []).filter(s => s > exclusiveMin).length
  }
}

function makeRedis() {
  const client = new FakeRedisClient()
  return { client, redis: { client } as unknown as Redis }
}

describe('server/lib/ladder/rankings/rankByPoints', () => {
  test('ranks untied entries by position', () => {
    expect(
      rankByPoints([
        { value: '5', score: 300 },
        { value: '2', score: 200 },
        { value: '9', score: 100 },
      ]),
    ).toEqual([
      { userId: makeSbUserId(5), rank: 1 },
      { userId: makeSbUserId(2), rank: 2 },
      { userId: makeSbUserId(9), rank: 3 },
    ])
  })

  test('gives tied entries the rank of the first of them and skips after', () => {
    expect(
      rankByPoints([
        { value: '1', score: 300 },
        { value: '2', score: 200 },
        { value: '3', score: 200 },
        { value: '4', score: 200 },
        { value: '5', score: 100 },
        { value: '6', score: 0 },
        { value: '7', score: 0 },
      ]).map(r => r.rank),
    ).toEqual([1, 2, 2, 2, 5, 6, 6])
  })

  test('handles an empty list', () => {
    expect(rankByPoints([])).toEqual([])
  })
})

describe('server/lib/ladder/rankings/getRankings', () => {
  test('returns users from most to least points with shared ranks for ties', async () => {
    const { client, redis } = makeRedis()
    client.set(MatchmakingType.Match1v1, { 1: 50, 2: 80, 3: 50, 4: 10, 5: 50 })

    expect(await getRankings(redis, MatchmakingType.Match1v1, SEASON)).toEqual([
      { userId: makeSbUserId(2), rank: 1 },
      { userId: makeSbUserId(5), rank: 2 },
      { userId: makeSbUserId(3), rank: 2 },
      { userId: makeSbUserId(1), rank: 2 },
      { userId: makeSbUserId(4), rank: 5 },
    ])
  })
})

describe('server/lib/ladder/rankings/getRankingsForUser', () => {
  test('matches the rank from the full list, including for tied users', async () => {
    const { client, redis } = makeRedis()
    client.set(MatchmakingType.Match1v1, { 1: 50, 2: 80, 3: 50, 4: 10, 5: 50 })
    client.set(MatchmakingType.Match2v2, { 1: 0, 6: 20 })

    const full = await getRankings(redis, MatchmakingType.Match1v1, SEASON)
    for (const { userId, rank } of full) {
      const ranks = await getRankingsForUser(redis, userId, SEASON)
      expect(ranks.get(MatchmakingType.Match1v1)).toBe(rank)
    }

    const user1 = await getRankingsForUser(redis, makeSbUserId(1), SEASON)
    expect(user1).toEqual(
      new Map([
        [MatchmakingType.Match1v1, 2],
        [MatchmakingType.Match2v2, 2],
      ]),
    )
  })

  test('omits matchmaking types the user has no rank in', async () => {
    const { client, redis } = makeRedis()
    client.set(MatchmakingType.Match1v1, { 1: 50 })

    expect(await getRankingsForUser(redis, makeSbUserId(7), SEASON)).toEqual(new Map())
  })
})
