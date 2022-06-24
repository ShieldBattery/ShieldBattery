import { RouterContext } from '@koa/router'
import Joi from 'joi'
import { assertUnreachable } from '../../../common/assert-unreachable'
import {
  GetRankForUserResponse,
  GetRankingsResponse,
  LadderErrorCode,
  LadderPlayer,
} from '../../../common/ladder'
import {
  ALL_MATCHMAKING_TYPES,
  MatchmakingType,
  NUM_PLACEMENT_MATCHES,
  toMatchmakingSeasonJson,
} from '../../../common/matchmaking'
import { SbUser, SbUserId } from '../../../common/users/sb-user'
import { CodedError, makeErrorConverterMiddleware } from '../errors/coded-error'
import { asHttpError } from '../errors/error-with-payload'
import { httpApi, httpBeforeAll } from '../http/http-api'
import { httpBefore, httpGet } from '../http/route-decorators'
import { JobScheduler } from '../jobs/job-scheduler'
import logger from '../logging/logger'
import { MatchmakingSeasonsService } from '../matchmaking/matchmaking-seasons'
import { getInstantaneousRanksForUser, getRankings, refreshRankings } from '../matchmaking/models'
import { Redis } from '../redis'
import ensureLoggedIn from '../session/ensure-logged-in'
import createThrottle from '../throttle/create-throttle'
import throttleMiddleware from '../throttle/middleware'
import { findUserById } from '../users/user-model'
import { joiUserId } from '../users/user-validators'
import { validateRequest } from '../validation/joi-validator'

const UPDATE_RANKS_MINUTES = 5

const LAST_UPDATED_KEY = 'lib/ladder#updateRanks:lastRun'

const getRankingsThrottle = createThrottle('laddergetrankings', {
  rate: 50,
  burst: 100,
  window: 60000,
})

class LadderApiError extends CodedError<LadderErrorCode> {}

const convertLadderApiErrors = makeErrorConverterMiddleware(err => {
  if (!(err instanceof LadderApiError)) {
    throw err
  }

  switch (err.code) {
    case LadderErrorCode.NotFound:
      throw asHttpError(404, err)
    case LadderErrorCode.OnlyAllowedOnSelf:
      throw asHttpError(403, err)

    default:
      assertUnreachable(err.code)
  }
})

@httpApi('/ladder')
@httpBeforeAll(convertLadderApiErrors)
export class LadderApi {
  private lastUpdated = new Date()
  private runOnce = false

  constructor(
    private jobScheduler: JobScheduler,
    private redis: Redis,
    private matchmakingSeasonsService: MatchmakingSeasonsService,
  ) {
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

  @httpGet('/users/:id')
  @httpBefore(ensureLoggedIn)
  async getRankForUser(ctx: RouterContext): Promise<GetRankForUserResponse> {
    const { params } = validateRequest(ctx, {
      params: Joi.object<{ id: SbUserId }>({
        id: joiUserId().required(),
      }),
    })

    if (params.id !== ctx.session?.userId) {
      throw new LadderApiError(LadderErrorCode.OnlyAllowedOnSelf, 'only allowed on self')
    }

    const currentSeason = await this.matchmakingSeasonsService.getCurrentSeason()
    const [result, user] = await Promise.all([
      getInstantaneousRanksForUser(params.id, currentSeason.id),
      findUserById(params.id),
    ])

    if (!user) {
      throw new Error("couldn't find current user")
    }

    return {
      ranks: result.reduce<Partial<Record<MatchmakingType, LadderPlayer>>>((acc, r) => {
        acc[r.matchmakingType] = {
          rank: r.rank,
          userId: r.userId,
          rating: r.lifetimeGames >= NUM_PLACEMENT_MATCHES ? r.rating : 0,
          points: r.points,
          bonusUsed: r.bonusUsed,
          lifetimeGames: r.lifetimeGames,
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
        }
        return acc
      }, {}),
      user,
      currentSeason: toMatchmakingSeasonJson(currentSeason),
    }
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
        rating: r.lifetimeGames >= NUM_PLACEMENT_MATCHES ? r.rating : 0,
        points: r.points,
        bonusUsed: r.bonusUsed,
        lifetimeGames: r.lifetimeGames,
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
