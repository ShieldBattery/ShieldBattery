import { singleton } from 'tsyringe'
import { MatchmakingType } from '../../../common/matchmaking'
import logger from '../logging/logger'
import redis from '../redis'
import { Matchmaker } from './matchmaker'

@singleton()
export class MatchmakingDebugDataService {
  private matchmakers = new Map<MatchmakingType, Matchmaker>()

  constructor() {
    // Clean up matchmaking queue size data older than 3 months
    const cleanupBefore = new Date()
    cleanupBefore.setDate(cleanupBefore.getDate() - 90)
    const pipeline = redis.pipeline()
    for (const type of Object.values(MatchmakingType)) {
      pipeline.zremrangebyscore(`matchmaking:${type}:queue`, 0, +cleanupBefore)
    }
    pipeline.exec().catch(err => {
      logger.error({ err }, 'error clearing old matchmaking queue sizes')
    })

    // Log the current matchmaking queue size to redis every 30 seconds
    setInterval(() => {
      const time = Date.now()
      const pipeline = redis.pipeline()
      for (const type of Object.values(MatchmakingType)) {
        pipeline.zadd(
          `matchmaking:${type}:queue`,
          time,
          JSON.stringify({ time, size: this.matchmakers.get(type)?.queueSize ?? 0 }),
        )
      }
      pipeline.exec().catch(err => {
        logger.error({ err }, 'error storing matchmaking queue size')
      })
    }, 30 * 1000)
  }

  // TODO(tec27): These could probably just be injected instead?
  registerMatchmaker(matchmakingType: MatchmakingType, matchmaker: Matchmaker) {
    this.matchmakers.set(matchmakingType, matchmaker)
  }

  async retrieveQueueSizeHistory(
    matchmakingType: MatchmakingType,
    startDate?: Date,
    endDate?: Date,
  ): Promise<Array<{ time: number; size: number }>> {
    const startDateNum = startDate ? +startDate : 0
    const endDateNum = endDate ? +endDate : Number.MAX_SAFE_INTEGER

    const values = await redis.zrangebyscore(
      `matchmaking:${matchmakingType}:queue`,
      startDateNum,
      endDateNum,
    )
    return values.map(v => JSON.parse(v))
  }
}
