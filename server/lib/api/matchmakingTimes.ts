import Koa from 'koa'
import Router from '@koa/router'
import httpErrors from 'http-errors'
import Joi from 'joi'

import { checkAllPermissions } from '../permissions/check-permissions'
import ensureLoggedIn from '../session/ensure-logged-in'
import { isValidMatchmakingType } from '../../../common/constants'
import { MATCHMAKING } from '../../../common/flags'
import { AddMatchmakingTimeBody } from '../../../common/matchmaking'
import { featureEnabled } from '../flags/feature-enabled'
import { joiValidator } from '../validation/joi-validator'
import {
  getMatchmakingTimesHistory,
  addMatchmakingTime,
  getCurrentMatchmakingState,
  getMatchmakingTimeById,
  removeMatchmakingTime,
} from '../models/matchmaking-times'

export default function (router: Router) {
  router
    .get(
      '/:matchmakingType',
      featureEnabled(MATCHMAKING),
      ensureLoggedIn,
      checkAllPermissions('manageMatchmakingTimes'),
      getHistory,
    )
    .get('/:matchmakingType/current', featureEnabled(MATCHMAKING), ensureLoggedIn, getCurrent)
    .post(
      '/:matchmakingType',
      featureEnabled(MATCHMAKING),
      ensureLoggedIn,
      checkAllPermissions('manageMatchmakingTimes'),
      joiValidator({ body: addMatchmakingTimeSchema }),
      addNew,
    )
    .delete(
      '/:matchmakingTimeId',
      featureEnabled(MATCHMAKING),
      ensureLoggedIn,
      checkAllPermissions('manageMatchmakingTimes'),
      deleteFutureOne,
    )
}

async function getHistory(ctx: Koa.Context, next: Koa.Next) {
  const { matchmakingType } = ctx.params

  if (!isValidMatchmakingType(matchmakingType)) {
    throw new httpErrors.BadRequest('invalid matchmaking type')
  }

  ctx.body = await getMatchmakingTimesHistory(matchmakingType)
}

const addMatchmakingTimeSchema = Joi.object({
  startDate: Joi.number().required(),
})

async function addNew(ctx: Koa.Context, next: Koa.Next) {
  const { matchmakingType } = ctx.params
  const { startDate, enabled } = ctx.request.body as AddMatchmakingTimeBody

  if (!isValidMatchmakingType(matchmakingType)) {
    throw new httpErrors.BadRequest('invalid matchmaking type')
  } else if (!startDate || !Number.isInteger(startDate) || startDate < Date.now()) {
    throw new httpErrors.BadRequest('startDate must be a valid timestamp value in the future')
  }

  ctx.body = await addMatchmakingTime(matchmakingType, new Date(startDate), !!enabled)
}

async function getCurrent(ctx: Koa.Context, next: Koa.Next) {
  const { matchmakingType } = ctx.params

  if (!isValidMatchmakingType(matchmakingType)) {
    throw new httpErrors.BadRequest('invalid matchmaking type')
  }

  const current = await getCurrentMatchmakingState(matchmakingType)
  if (!current) {
    throw new httpErrors.NotFound('no matchmaking times found for this type')
  }
  ctx.body = current
}

async function deleteFutureOne(ctx: Koa.Context, next: Koa.Next) {
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
