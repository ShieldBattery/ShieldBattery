import Koa from 'koa'
import Router from '@koa/router'
import httpErrors from 'http-errors'
import Joi from 'joi'

import { checkAllPermissions } from '../permissions/check-permissions'
import ensureLoggedIn from '../session/ensure-logged-in'
import { MATCHMAKING_TYPES } from '../../../common/constants'
import { MATCHMAKING } from '../../../common/flags'
import { AddMatchmakingTimeBody } from '../../../common/matchmaking'
import { featureEnabled } from '../flags/feature-enabled'
import { joiValidator } from '../validation/joi-validator'
import {
  getMatchmakingTimesHistory,
  addMatchmakingTime,
  getMatchmakingTimeById,
  removeMatchmakingTime,
} from '../models/matchmaking-times'

const matchmakingTypeSchema = Joi.object({
  matchmakingType: Joi.valid(...MATCHMAKING_TYPES).required(),
})

const addMatchmakingTimeSchema = Joi.object({
  startDate: Joi.number().integer().greater(Date.now()).required(),
  enabled: Joi.boolean(),
})

export default function (router: Router) {
  router
    .get(
      '/:matchmakingType',
      featureEnabled(MATCHMAKING),
      ensureLoggedIn,
      checkAllPermissions('manageMatchmakingTimes'),
      joiValidator({ params: matchmakingTypeSchema }),
      getHistory,
    )
    .post(
      '/:matchmakingType',
      featureEnabled(MATCHMAKING),
      ensureLoggedIn,
      checkAllPermissions('manageMatchmakingTimes'),
      joiValidator({ params: matchmakingTypeSchema, body: addMatchmakingTimeSchema }),
      addNew,
    )
    .delete(
      '/:matchmakingTimeId',
      featureEnabled(MATCHMAKING),
      ensureLoggedIn,
      checkAllPermissions('manageMatchmakingTimes'),
      deleteFutureTime,
    )
}

async function getHistory(ctx: Koa.Context, next: Koa.Next) {
  const { matchmakingType } = ctx.params

  ctx.body = await getMatchmakingTimesHistory(matchmakingType)
}

async function addNew(ctx: Koa.Context, next: Koa.Next) {
  const { matchmakingType } = ctx.params
  const { startDate, enabled } = ctx.request.body as AddMatchmakingTimeBody

  ctx.body = await addMatchmakingTime(matchmakingType, new Date(startDate), !!enabled)
}

async function deleteFutureTime(ctx: Koa.Context, next: Koa.Next) {
  const { matchmakingTimeId } = ctx.params

  const matchmakingTime = await getMatchmakingTimeById(matchmakingTimeId)
  if (!matchmakingTime) {
    throw new httpErrors.NotFound("matchmaking time doesn't exist")
  } else if (matchmakingTime.startDate < Date.now()) {
    throw new httpErrors.BadRequest("can't delete matchmaking times in past")
  }

  await removeMatchmakingTime(matchmakingTimeId)
  ctx.status = 204
}
