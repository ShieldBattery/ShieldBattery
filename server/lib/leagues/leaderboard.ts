import { LeagueId } from '../../../common/leagues/leagues'
import { makeSbUserId, SbUserId } from '../../../common/users/sb-user-id'
import { DbClient } from '../db'
import transact from '../db/transaction'
import { Redis } from '../redis/redis'
import { getLeagueLeaderboardEntriesWithLock, LeagueUser } from './league-models'

function leaderboardKey(leagueId: LeagueId) {
  return `leaderboard:${leagueId}`
}

/** Updates all the leaderboards for the given updated `LeagueUser`s. */
export async function updateLeaderboards(
  redis: Redis,
  changes: ReadonlyArray<Pick<LeagueUser, 'leagueId' | 'userId'>>,
  withClient?: DbClient,
) {
  if (!changes.length) {
    return
  }

  const update = async (client: DbClient) => {
    // Result/refund callbacks can arrive after a player leaves or rejoins. Read current scores
    // under the membership locks and hold them through the cache write to serialize removal.
    const entries = await getLeagueLeaderboardEntriesWithLock(changes, client)
    const pipeline = redis.client.multi()
    for (const entry of entries) {
      const key = leaderboardKey(entry.leagueId)
      if (entry.leftAt || !entry.lastPlayedDate) {
        pipeline.zRem(key, String(entry.userId))
      } else {
        pipeline.zAdd(key, { score: entry.points, value: String(entry.userId) })
      }
    }
    await pipeline.execAsPipeline()
  }
  if (withClient) {
    await update(withClient)
  } else {
    await transact(update)
  }
}

/**
 * Returns the `SbUserId`s in a league's leaderboard, ordered from most to least points.
 */
export async function getLeaderboard(
  redis: Redis,
  leagueId: LeagueId,
  limit: number = 0,
  offset: number = 0,
): Promise<SbUserId[]> {
  const key = leaderboardKey(leagueId)
  const entries = await redis.client.zRange(key, offset, limit !== 0 ? offset + limit - 1 : -1, {
    REV: true,
  })
  return entries.map(entry => makeSbUserId(Number(entry)))
}

/**
 * Returns a user's place on a league's leaderboard, or `undefined` if they aren't on it. Players
 * with equal points share a place, and the next lower score takes the place after it.
 */
export async function getLeaderboardRank(
  redis: Redis,
  leagueId: LeagueId,
  userId: SbUserId,
): Promise<number | undefined> {
  const key = leaderboardKey(leagueId)
  const score = await redis.client.zScore(key, String(userId))
  if (score === null) {
    return undefined
  }
  const higher = await redis.client.zRangeWithScores(key, '+inf', `(${score}`, {
    BY: 'SCORE',
    REV: true,
  })
  return new Set(higher.map(entry => entry.score)).size + 1
}
