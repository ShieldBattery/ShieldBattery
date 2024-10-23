import { LeagueId } from '../../../common/leagues'
import { makeSbUserId, SbUserId } from '../../../common/users/sb-user'
import { Redis } from '../redis/redis'
import { LeagueUser } from './league-models'

function leaderboardKey(leagueId: LeagueId) {
  return `leaderboard:${leagueId}`
}

/** Updates all the leaderboards for the given updated `LeagueUser`s. */
export async function updateLeaderboards(redis: Redis, changes: ReadonlyArray<LeagueUser>) {
  if (!changes.length) {
    return
  }

  const pipeline = redis.pipeline()

  for (const change of changes) {
    const key = leaderboardKey(change.leagueId)
    pipeline.zadd(key, change.points, change.userId)
  }

  await pipeline.exec()
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
  const entries = await redis.zrange(key, offset, limit !== 0 ? offset + limit - 1 : -1, 'REV')
  return entries.map(entry => makeSbUserId(Number(entry)))
}
