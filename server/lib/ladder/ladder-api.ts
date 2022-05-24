import { RouterContext } from '@koa/router'
import Joi from 'joi'
import { GetRankingsResponse, LadderPlayer } from '../../../common/ladder'
import { ALL_MATCHMAKING_TYPES, MatchmakingType } from '../../../common/matchmaking'
import { SbUser } from '../../../common/users/sb-user'
import { httpApi } from '../http/http-api'
import { httpBefore, httpGet } from '../http/route-decorators'
import { JobScheduler } from '../jobs/job-scheduler'
import logger from '../logging/logger'
import { getRankings, refreshRankings } from '../matchmaking/models'
import { Redis } from '../redis'
import createThrottle from '../throttle/create-throttle'
import throttleMiddleware from '../throttle/middleware'
import { validateRequest } from '../validation/joi-validator'

const UPDATE_RANKS_MINUTES = 5

const LAST_UPDATED_KEY = 'lib/ladder#updateRanks:lastRun'

const getRankingsThrottle = createThrottle('laddergetrankings', {
  rate: 50,
  burst: 100,
  window: 60000,
})

@httpApi('/ladder')
export class LadderApi {
  private lastUpdated = new Date()
  private runOnce = false

  constructor(private jobScheduler: JobScheduler, private redis: Redis) {
    const startTime = new Date()
    const timeRemainder = UPDATE_RANKS_MINUTES - (startTime.getMinutes() % UPDATE_RANKS_MINUTES)
    startTime.setMinutes(startTime.getMinutes() + timeRemainder, 0, 0)

    this.redis
      .get(LAST_UPDATED_KEY)
      .then(lastUpdatedStr => {
        if (!this.runOnce && lastUpdatedStr) {
          this.lastUpdated = new Date(Number(lastUpdatedStr))
        }
      })
      .catch(err => {
        logger.error({ err }, 'Error getting last updated time for ladder rankings')
      })

    this.jobScheduler.scheduleJob(
      'lib/ladder#updateRanks',
      startTime,
      UPDATE_RANKS_MINUTES * 60 * 1000,
      async () => {
        this.runOnce = true
        const updatedAt = new Date()
        this.redis.set(LAST_UPDATED_KEY, Number(updatedAt)).catch(err => {
          logger.error({ err }, 'Error setting last updated time for ladder rankings')
        })
        await refreshRankings()
        this.lastUpdated = updatedAt
      },
    )
  }

  @httpGet('/:matchmakingType')
  @httpBefore(throttleMiddleware(getRankingsThrottle, ctx => ctx.ip))
  async getRankings(ctx: RouterContext): Promise<GetRankingsResponse> {
    const { params, query } = validateRequest(ctx, {
      params: Joi.object<{ matchmakingType: MatchmakingType }>({
        matchmakingType: Joi.valid(...ALL_MATCHMAKING_TYPES).required(),
      }),
      query: Joi.object<{ q?: string }>({
        q: Joi.string().allow(''),
      }),
    })

    const rankings = await getRankings(params.matchmakingType, query.q)

    const players: LadderPlayer[] = []
    const users: SbUser[] = []
    for (const r of rankings) {
      players.push({
        rank: r.rank,
        userId: r.userId,
        rating: r.rating,
        points: r.points,
        bonusUsed: r.bonusUsed,
        wins: r.wins,
        losses: r.losses,
        pWins: r.pWins,
        pLosses: r.pLosses,
        tWins: r.tWins,
        tLosses: r.tLosses,
        zWins: r.zWins,
        zLosses: r.zLosses,
        rWins: r.rWins,
        rLosses: r.rLosses,
        rPWins: r.rPWins,
        rPLosses: r.rPLosses,
        rTWins: r.rTWins,
        rTLosses: r.rTLosses,
        rZWins: r.rZWins,
        rZLosses: r.rZLosses,
        lastPlayedDate: Number(r.lastPlayedDate),
      })
      users.push({
        id: r.userId,
        name: r.username,
      })
    }

    return {
      totalCount: rankings.length,
      players,
      users,
      lastUpdated: Number(this.lastUpdated),
    }
  }
}
