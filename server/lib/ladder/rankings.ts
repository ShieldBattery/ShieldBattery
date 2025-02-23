import { ALL_MATCHMAKING_TYPES, MatchmakingType, SeasonId } from '../../../common/matchmaking'
import { makeSbUserId, SbUserId } from '../../../common/users/sb-user-id'
import logger from '../logging/logger'
import { getAllSeasonMatchmakingRatings, MatchmakingRating } from '../matchmaking/models'
import { Redis } from '../redis/redis'

/** Locks for updating the rankings in redis, only acquired when doing a full update. */
const rankingsUpdateLocks = new Map<MatchmakingType, Promise<void>>()
for (const type of ALL_MATCHMAKING_TYPES) {
  rankingsUpdateLocks.set(type, Promise.resolve())
}

function rankingsKey(type: MatchmakingType, season: SeasonId) {
  return `rankings:${type}:${season}`
}

/** Updates all the rankings for the given updated `MatchmakingRating`s. */
export async function updateRankings(redis: Redis, changes: ReadonlyArray<MatchmakingRating>) {
  if (!changes.length) {
    return
  }

  const pipeline = redis.pipeline()
  const locks = new Set<Promise<void>>()

  for (const change of changes) {
    const key = rankingsKey(change.matchmakingType, change.seasonId)
    pipeline.zadd(key, change.points, change.userId)
    locks.add(rankingsUpdateLocks.get(change.matchmakingType)!)
  }

  await Promise.all(locks)

  await pipeline.exec()
}

/**
 * Returns if a season needs a full rankings update for a matchmaking type because it doesn't yet
 * exist in Redis. This should mostly only return true if upgrading from an older version of the
 * server that kept rankings in a database view.
 */
export async function seasonNeedsFullRankingsUpdate(
  redis: Redis,
  type: MatchmakingType,
  season: SeasonId,
): Promise<boolean> {
  const key = rankingsKey(type, season)
  const exists = await redis.exists(key)
  return !exists
}

export async function doFullRankingsUpdate(
  redis: Redis,
  type: MatchmakingType,
  season: SeasonId,
): Promise<void> {
  const lock = rankingsUpdateLocks.get(type)!
  rankingsUpdateLocks.set(
    type,
    Promise.resolve()
      .then(async () => {
        await lock
        const ratings = await getAllSeasonMatchmakingRatings(type, season)
        const pipeline = redis.pipeline()

        const key = rankingsKey(type, season)
        for (const rating of ratings) {
          pipeline.zadd(key, rating.points, rating.userId)
        }

        await pipeline.exec()
      })
      .catch(err => {
        logger.error({ err }, `error doing full rankings update for ${type}:${season}`)
      }),
  )

  await rankingsUpdateLocks.get(type)!
}

/**
 * Returns the `SbUserId`s in a matchmaking ranking list, ordered from most to least points.
 */
export async function getRankings(
  redis: Redis,
  matchmakingType: MatchmakingType,
  seasonId: SeasonId,
  limit: number = 0,
  offset: number = 0,
): Promise<SbUserId[]> {
  const key = rankingsKey(matchmakingType, seasonId)
  const entries = await redis.zrange(key, offset, limit !== 0 ? offset + limit - 1 : -1, 'REV')
  return entries.map(entry => makeSbUserId(Number(entry)))
}

/**
 * Returns the ranks of a given `SbUserId` for a particular season. Only seasons where the user has
 * a rank will be returned.
 */
export async function getRankingsForUser(
  redis: Redis,
  userId: SbUserId,
  seasonId: SeasonId,
): Promise<Map<MatchmakingType, number>> {
  const result = new Map<MatchmakingType, number>()

  await new Promise<void>((resolve, reject) => {
    const pipeline = redis.pipeline()
    for (const type of ALL_MATCHMAKING_TYPES) {
      pipeline.zrevrank(rankingsKey(type, seasonId), userId, (err, rank) => {
        if (err) {
          reject(err)
          return
        }
        if (rank !== null && rank !== undefined) {
          result.set(type, rank + 1)
        }
      })
    }
    pipeline.exec().then(() => resolve(), reject)
  })

  return result
}
