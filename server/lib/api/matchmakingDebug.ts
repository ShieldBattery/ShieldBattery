import Router, { RouterContext } from '@koa/router'
import { BadRequest } from 'http-errors'
import Joi from 'joi'
import { container } from 'tsyringe'
import { ALL_MATCHMAKING_TYPES, MatchmakingType } from '../../../common/matchmaking'
import { MatchmakingDebugDataService } from '../matchmaking/debug-data'
import { checkAllPermissions } from '../permissions/check-permissions'
import ensureLoggedIn from '../session/ensure-logged-in'
import { validateRequest } from '../validation/joi-validator'

export default function (router: Router) {
  router
    .use(ensureLoggedIn, checkAllPermissions('debug'))
    .get('/:matchmakingType/queueSize', getQueueSizeHistory)
}

interface MatchmakingTypeParams {
  matchmakingType: MatchmakingType
}

interface QueueSizeHistoryQuery {
  startDate?: Date
  endDate?: Date
}

// NOTE(tec27): The extra minute is just a bit of leeway in case two dates are created a bit apart
const MAX_HISTORY_REQUEST_MS = 7 * 24 * 60 * 60 * 1000 + 60 * 1000

async function getQueueSizeHistory(ctx: RouterContext) {
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

  ctx.body = {
    startDate,
    endDate,
    history,
  }
}
