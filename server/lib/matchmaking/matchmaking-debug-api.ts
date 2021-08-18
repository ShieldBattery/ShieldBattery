import Router, { RouterContext } from '@koa/router'
import { BadRequest } from 'http-errors'
import Joi from 'joi'
import { container } from 'tsyringe'
import { ALL_MATCHMAKING_TYPES, MatchmakingType } from '../../../common/matchmaking'
import { httpApi, HttpApi, httpBeforeAll } from '../http/http-api'
import { httpGet } from '../http/route-decorators'
import { MatchmakingDebugDataService } from '../matchmaking/debug-data'
import { checkAllPermissions } from '../permissions/check-permissions'
import ensureLoggedIn from '../session/ensure-logged-in'
import { validateRequest } from '../validation/joi-validator'

interface MatchmakingTypeParams {
  matchmakingType: MatchmakingType
}

interface QueueSizeHistoryQuery {
  startDate?: Date
  endDate?: Date
}

// NOTE(tec27): The extra minute is just a bit of leeway in case two dates are created a bit apart
const MAX_HISTORY_REQUEST_MS = 7 * 24 * 60 * 60 * 1000 + 60 * 1000

@httpApi('/matchmakingDebug')
@httpBeforeAll(ensureLoggedIn, checkAllPermissions('debug'))
export class MatchmakingDebugApi implements HttpApi {
  applyRoutes(router: Router): void {}

  @httpGet('/:matchmakingType/queueSize')
  async getQueueSizeHistory(
    ctx: RouterContext,
  ): Promise<{ startDate: Date; endDate: Date; history: Array<{ time: number; size: number }> }> {
    const { params, query } = validateRequest(ctx, {
      params: Joi.object<MatchmakingTypeParams>({
        matchmakingType: Joi.valid(...ALL_MATCHMAKING_TYPES).required(),
      }),
      query: Joi.object<QueueSizeHistoryQuery>({
        startDate: Joi.date().timestamp('javascript'),
        endDate: Joi.date().timestamp('javascript'),
      }),
    })

    const debugDataService = container.resolve(MatchmakingDebugDataService)

    let startDate: Date
    if (query.startDate) {
      startDate = query.startDate
    } else {
      startDate = new Date()
      startDate.setDate(startDate.getDate() - 7)
    }
    const endDate = query.endDate ?? new Date()

    if (endDate < startDate) {
      throw new BadRequest('endDate must be after startDate')
    } else if (+endDate - +startDate > MAX_HISTORY_REQUEST_MS) {
      throw new BadRequest(`requested history range must be less than ${MAX_HISTORY_REQUEST_MS}ms`)
    }

    const history = await debugDataService.retrieveQueueSizeHistory(
      params.matchmakingType,
      startDate,
      endDate,
    )

    return {
      startDate,
      endDate,
      history,
    }
  }
}
