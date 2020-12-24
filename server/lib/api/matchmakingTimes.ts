import Koa from 'koa'
import Router from '@koa/router'
import httpErrors from 'http-errors'
import Joi from 'joi'

import { checkAllPermissions } from '../permissions/check-permissions'
import ensureLoggedIn from '../session/ensure-logged-in'
import { MatchmakingType } from '../../../common/matchmaking'
import { MATCHMAKING } from '../../../common/flags'
import { AddMatchmakingTimeBody } from '../../../common/matchmaking'
import { featureEnabled } from '../flags/feature-enabled'
import { joiValidator } from '../validation/joi-validator'
import {
  getCurrentMatchmakingTime,
  getFutureMatchmakingTimes,
  getPastMatchmakingTimes,
  addMatchmakingTime,
  getMatchmakingTimeById,
  removeMatchmakingTime,
} from '../models/matchmaking-times'
import matchmakingStatusInstance from '../matchmaking/matchmaking-status-instance'

const matchmakingTypeSchema = Joi.object({
  matchmakingType: Joi.valid(...Object.values(MatchmakingType)).required(),
})

const addMatchmakingTimeSchema = Joi.object({
  startDate: Joi.number()
    .integer()
    .custom(value => {
      if (value < Date.now()) {
        throw new httpErrors.BadRequest('startDate must be a valid timestamp value in the future')
      }

      return value
    })
    .required(),
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
    .get(
      '/:matchmakingType/future',
      featureEnabled(MATCHMAKING),
      ensureLoggedIn,
      checkAllPermissions('manageMatchmakingTimes'),
      joiValidator({ params: matchmakingTypeSchema }),
      getFutureTimes,
    )
    .get(
      '/:matchmakingType/past',
      featureEnabled(MATCHMAKING),
      ensureLoggedIn,
      checkAllPermissions('manageMatchmakingTimes'),
      joiValidator({ params: matchmakingTypeSchema }),
      getPastTimes,
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

  const current = await getCurrentMatchmakingTime(matchmakingType)
  // NOTE(2Pac): `current` can be `null` in case all the times are in future (or there are none yet)
  const currentDate = current ? current.startDate : new Date()
  const [{ futureTimes, totalFutureTimes }, { pastTimes, totalPastTimes }] = await Promise.all([
    getFutureMatchmakingTimes(matchmakingType, currentDate),
    getPastMatchmakingTimes(matchmakingType, currentDate),
  ])

  ctx.body = {
    current,
    futureTimes,
    totalFutureTimes,
    pastTimes,
    totalPastTimes,
  }
}

async function getFutureTimes(ctx: Koa.Context, next: Koa.Next) {
  const { matchmakingType } = ctx.params
  let { limit, page } = ctx.query

  limit = parseInt(limit, 10)
  if (!limit || isNaN(limit) || limit < 0 || limit > 100) {
    limit = 10
  }

  page = parseInt(page, 10)
  if (!page || isNaN(page) || page < 0) {
    page = 0
  }

  const current = await getCurrentMatchmakingTime(matchmakingType)
  // NOTE(2Pac): `current` can be `null` in case all the times are in future (or there are none yet)
  const currentDate = current ? current.startDate : new Date()
  const { futureTimes, totalFutureTimes } = await getFutureMatchmakingTimes(
    matchmakingType,
    currentDate,
    limit,
    page,
  )

  ctx.body = {
    futureTimes,
    totalFutureTimes,
  }
}

async function getPastTimes(ctx: Koa.Context, next: Koa.Next) {
  const { matchmakingType } = ctx.params
  let { limit, page } = ctx.query

  limit = parseInt(limit, 10)
  if (!limit || isNaN(limit) || limit < 0 || limit > 100) {
    limit = 10
  }

  page = parseInt(page, 10)
  if (!page || isNaN(page) || page < 0) {
    page = 0
  }

  const current = await getCurrentMatchmakingTime(matchmakingType)
  // NOTE(2Pac): `current` can be `null` in case all the times are in future (or there are none yet)
  const currentDate = current ? current.startDate : new Date()
  const { pastTimes, totalPastTimes } = await getPastMatchmakingTimes(
    matchmakingType,
    currentDate,
    limit,
    page,
  )

  ctx.body = {
    pastTimes,
    totalPastTimes,
  }
}

async function addNew(ctx: Koa.Context, next: Koa.Next) {
  const { matchmakingType } = ctx.params
  const { startDate, enabled } = ctx.request.body as AddMatchmakingTimeBody

  ctx.body = await addMatchmakingTime(matchmakingType, new Date(startDate), !!enabled)

  matchmakingStatusInstance?.maybePublish(matchmakingType)
}

async function deleteFutureTime(ctx: Koa.Context, next: Koa.Next) {
  const { matchmakingTimeId } = ctx.params

  const matchmakingTime = await getMatchmakingTimeById(matchmakingTimeId)
  if (!matchmakingTime) {
    throw new httpErrors.NotFound("matchmaking time doesn't exist")
  } else if (new Date(matchmakingTime.startDate) < new Date()) {
    throw new httpErrors.BadRequest("can't delete matchmaking times in past")
  }

  await removeMatchmakingTime(matchmakingTimeId)

  matchmakingStatusInstance?.maybePublish(matchmakingTime.type)

  ctx.status = 204
}
