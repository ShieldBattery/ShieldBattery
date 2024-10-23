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
import { SbUserId } from '../../../common/users/sb-user'
import { CodedError, makeErrorConverterMiddleware } from '../errors/coded-error'
import { asHttpError } from '../errors/error-with-payload'
import { httpApi, httpBeforeAll } from '../http/http-api'
import { httpBefore, httpGet } from '../http/route-decorators'
import logger from '../logging/logger'
import { MatchmakingSeasonsService } from '../matchmaking/matchmaking-seasons'
import { getManyMatchmakingRatings, getMatchmakingRatingsForUser } from '../matchmaking/models'
import { Redis } from '../redis/redis'
import ensureLoggedIn from '../session/ensure-logged-in'
import createThrottle from '../throttle/create-throttle'
import throttleMiddleware from '../throttle/middleware'
import { findUserById, findUsersById } from '../users/user-model'
import { joiUserId } from '../users/user-validators'
import { validateRequest } from '../validation/joi-validator'
import {
  doFullRankingsUpdate,
  getRankings,
  getRankingsForUser,
  seasonNeedsFullRankingsUpdate,
} from './rankings'

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
  private runOnce = false

  constructor(
    private redis: Redis,
    private matchmakingSeasonsService: MatchmakingSeasonsService,
  ) {
    // Migrate rankings to Redis on startup if needed
    Promise.resolve()
      .then(async () => {
        const currentSeason = await this.matchmakingSeasonsService.getCurrentSeason()
        await Promise.all(
          ALL_MATCHMAKING_TYPES.map(async type => {
            if (await seasonNeedsFullRankingsUpdate(this.redis, type, currentSeason.id)) {
              logger.info(`doing full rankings update for ${type}:${currentSeason.id}`)
              await doFullRankingsUpdate(this.redis, type, currentSeason.id)
            }
          }),
        )
      })
      .catch(err => {
        logger.error({ err }, 'error migrating ladder rankings to redis')
      })
  }

  @httpGet('/users/:id')
  @httpBefore(ensureLoggedIn)
  async getRankForUser(ctx: RouterContext): Promise<GetRankForUserResponse> {
    const { params } = validateRequest(ctx, {
      params: Joi.object<{ id: SbUserId }>({
        id: joiUserId().required(),
      }),
    })

    if (params.id !== ctx.session?.user?.id) {
      throw new LadderApiError(LadderErrorCode.OnlyAllowedOnSelf, 'only allowed on self')
    }

    const currentSeason = await this.matchmakingSeasonsService.getCurrentSeason()
    const [user, ratings, ranks] = await Promise.all([
      findUserById(params.id),
      getMatchmakingRatingsForUser(params.id, currentSeason.id),
      getRankingsForUser(this.redis, params.id, currentSeason.id),
    ])

    if (!user) {
      throw new Error("couldn't find current user")
    }

    return {
      ranks: ratings.reduce<Partial<Record<MatchmakingType, LadderPlayer>>>((acc, r) => {
        acc[r.matchmakingType] = {
          rank: ranks.get(r.matchmakingType) ?? -2,
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

    const season = await this.matchmakingSeasonsService.getCurrentSeason()
    let rankings = await getRankings(this.redis, params.matchmakingType, season.id)
    const [ratings, unfilteredUsers] = await Promise.all([
      getManyMatchmakingRatings(rankings, params.matchmakingType, season.id, query.q),
      findUsersById(rankings),
    ])
    const ratingsMap = new Map(ratings.map(r => [r.userId, r]))
    let users = unfilteredUsers
    if (query.q && ratings.length < rankings.length) {
      rankings = rankings.filter(r => ratingsMap.has(r))
      users = unfilteredUsers.filter(u => ratingsMap.has(u.id))
    }

    const players: LadderPlayer[] = []
    let lastRank = 0
    let lastPoints = NaN
    for (let i = 0; i < rankings.length; i++) {
      const r = ratingsMap.get(rankings[i])!
      if (r.points !== lastPoints) {
        lastRank = i + 1
        lastPoints = r.points
      }
      players.push({
        rank: lastRank,
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
    }

    return {
      totalCount: rankings.length,
      players,
      users,
      lastUpdated: Date.now(),
    }
  }
}
