import { RouterContext } from '@koa/router'
import httpErrors from 'http-errors'
import Joi from 'joi'
import { container } from 'tsyringe'
import { ALL_MATCHMAKING_TYPES, MatchmakingType } from '../../../common/matchmaking'
import {
  AddMatchmakingTimeRequest,
  GetFutureMatchmakingTimesResponse,
  GetPastMatchmakingTimesResponse,
  MATCHMAKING_TIMES_LIMIT,
  MatchmakingTimeJson,
  toMatchmakingTimeJson,
} from '../../../common/matchmaking/matchmaking-times'
import { httpApi, httpBeforeAll } from '../http/http-api'
import { httpDelete, httpGet, httpPost } from '../http/route-decorators'
import {
  addMatchmakingTime,
  getCurrentMatchmakingTime,
  getFutureMatchmakingTimes,
  getMatchmakingTimeById,
  getPastMatchmakingTimes,
  removeMatchmakingTime,
} from '../models/matchmaking-times'
import { checkAllPermissions } from '../permissions/check-permissions'
import ensureLoggedIn from '../session/ensure-logged-in'
import { validateRequest } from '../validation/joi-validator'
import MatchmakingStatusService from './matchmaking-status'

function getValidatedMatchmakingType(ctx: RouterContext) {
  const {
    params: { matchmakingType },
  } = validateRequest(ctx, {
    params: Joi.object<{ matchmakingType: MatchmakingType }>({
      matchmakingType: Joi.valid(...ALL_MATCHMAKING_TYPES).required(),
    }),
  })

  return matchmakingType
}

@httpApi('/matchmaking-times')
@httpBeforeAll(ensureLoggedIn, checkAllPermissions('manageMatchmakingTimes'))
export class MatchmakingTimesApi {
  @httpGet('/:matchmakingType/current')
  async getCurrentTime(ctx: RouterContext): Promise<MatchmakingTimeJson | undefined> {
    const matchmakingType = getValidatedMatchmakingType(ctx)

    const current = await getCurrentMatchmakingTime(matchmakingType)

    return current ? toMatchmakingTimeJson(current) : undefined
  }

  @httpGet('/:matchmakingType/future')
  async getFutureTimes(ctx: RouterContext): Promise<GetFutureMatchmakingTimesResponse> {
    const matchmakingType = getValidatedMatchmakingType(ctx)
    const {
      query: { offset },
    } = validateRequest(ctx, {
      query: Joi.object<{ offset: number }>({
        offset: Joi.number().min(0).required(),
      }),
    })

    const current = await getCurrentMatchmakingTime(matchmakingType)
    const currentDate = current ? current.startDate : new Date()
    const futureTimes = await getFutureMatchmakingTimes({
      matchmakingType,
      date: currentDate,
      limit: MATCHMAKING_TIMES_LIMIT,
      offset,
    })

    return {
      futureTimes: futureTimes.map(t => toMatchmakingTimeJson(t)),
      hasMoreFutureTimes: futureTimes.length >= MATCHMAKING_TIMES_LIMIT,
    }
  }

  @httpGet('/:matchmakingType/past')
  async getPastTimes(ctx: RouterContext): Promise<GetPastMatchmakingTimesResponse> {
    const matchmakingType = getValidatedMatchmakingType(ctx)
    const {
      query: { offset },
    } = validateRequest(ctx, {
      query: Joi.object<{ offset: number }>({
        offset: Joi.number().min(0).required(),
      }),
    })

    const current = await getCurrentMatchmakingTime(matchmakingType)
    const currentDate = current ? current.startDate : new Date()
    const pastTimes = await getPastMatchmakingTimes({
      matchmakingType,
      date: currentDate,
      limit: MATCHMAKING_TIMES_LIMIT,
      offset,
    })

    return {
      pastTimes: pastTimes.map(t => toMatchmakingTimeJson(t)),
      hasMorePastTimes: pastTimes.length >= MATCHMAKING_TIMES_LIMIT,
    }
  }

  @httpPost('/:matchmakingType')
  async addNew(ctx: RouterContext): Promise<MatchmakingTimeJson> {
    const matchmakingType = getValidatedMatchmakingType(ctx)
    const {
      body: { startDate, enabled, applyToAllMatchmakingTypes },
    } = validateRequest(ctx, {
      body: Joi.object<AddMatchmakingTimeRequest>({
        startDate: Joi.date().timestamp().greater('now').required(),
        enabled: Joi.boolean().required(),
        applyToAllMatchmakingTypes: Joi.boolean().required(),
      }),
    })

    const result = await addMatchmakingTime(matchmakingType, new Date(startDate), enabled)

    if (applyToAllMatchmakingTypes) {
      await Promise.all(
        ALL_MATCHMAKING_TYPES.filter(type => type !== matchmakingType).map(type =>
          addMatchmakingTime(type, new Date(startDate), enabled),
        ),
      )
    }

    const matchmakingStatus = container.resolve(MatchmakingStatusService)
    matchmakingStatus.maybePublish(matchmakingType)

    return toMatchmakingTimeJson(result)
  }

  @httpDelete('/:matchmakingTimeId')
  async deleteFutureTime(ctx: RouterContext): Promise<void> {
    const {
      params: { matchmakingTimeId },
    } = validateRequest(ctx, {
      params: Joi.object<{ matchmakingTimeId: string }>({
        matchmakingTimeId: Joi.string().required(),
      }),
    })

    const matchmakingTime = await getMatchmakingTimeById(matchmakingTimeId)
    if (!matchmakingTime) {
      throw new httpErrors.NotFound("matchmaking time doesn't exist")
    } else if (new Date(matchmakingTime.startDate) < new Date()) {
      throw new httpErrors.BadRequest("can't delete matchmaking times in past")
    }

    await removeMatchmakingTime(matchmakingTimeId)

    const matchmakingStatus = container.resolve(MatchmakingStatusService)
    matchmakingStatus.maybePublish(matchmakingTime.matchmakingType)
  }
}
