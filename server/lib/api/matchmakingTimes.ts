import Router, { RouterContext } from '@koa/router'
import httpErrors from 'http-errors'
import Joi from 'joi'
import Koa from 'koa'
import { container } from 'tsyringe'
import {
  AddMatchmakingTimeBody,
  ALL_MATCHMAKING_TYPES,
  MatchmakingType,
} from '../../../common/matchmaking.js'
import MatchmakingStatusService from '../matchmaking/matchmaking-status.js'
import {
  addMatchmakingTime,
  getCurrentMatchmakingTime,
  getFutureMatchmakingTimes,
  getMatchmakingTimeById,
  getPastMatchmakingTimes,
  removeMatchmakingTime,
} from '../models/matchmaking-times.js'
import { getSingleQueryParam } from '../network/query-param.js'
import { checkAllPermissions } from '../permissions/check-permissions.js'
import ensureLoggedIn from '../session/ensure-logged-in.js'
import { joiValidator } from '../validation/joi-validator.js'

const matchmakingTypeSchema = Joi.object({
  matchmakingType: Joi.valid(...ALL_MATCHMAKING_TYPES).required(),
})

interface MatchmakingTypeParams {
  matchmakingType: MatchmakingType
}

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
    .get<void, RouterContext>(
      '/:matchmakingType',
      ensureLoggedIn,
      checkAllPermissions('manageMatchmakingTimes'),
      joiValidator({ params: matchmakingTypeSchema }),
      getHistory,
    )
    .get<void, RouterContext>(
      '/:matchmakingType/future',
      ensureLoggedIn,
      checkAllPermissions('manageMatchmakingTimes'),
      joiValidator({ params: matchmakingTypeSchema }),
      getFutureTimes,
    )
    .get<void, RouterContext>(
      '/:matchmakingType/past',
      ensureLoggedIn,
      checkAllPermissions('manageMatchmakingTimes'),
      joiValidator({ params: matchmakingTypeSchema }),
      getPastTimes,
    )
    .post<void, RouterContext>(
      '/:matchmakingType',
      ensureLoggedIn,
      checkAllPermissions('manageMatchmakingTimes'),
      joiValidator({ params: matchmakingTypeSchema, body: addMatchmakingTimeSchema }),
      addNew,
    )
    .delete(
      '/:matchmakingTimeId',
      ensureLoggedIn,
      checkAllPermissions('manageMatchmakingTimes'),
      deleteFutureTime,
    )
}

async function getHistory(ctx: RouterContext, next: Koa.Next) {
  const { matchmakingType } = ctx.params as any as MatchmakingTypeParams

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

async function getFutureTimes(ctx: RouterContext, next: Koa.Next) {
  const { matchmakingType } = ctx.params as any as MatchmakingTypeParams

  let limit = parseInt(getSingleQueryParam(ctx.query.limit) ?? '', 10)
  if (!limit || isNaN(limit) || limit < 1 || limit > 100) {
    limit = 10
  }

  let page = parseInt(getSingleQueryParam(ctx.query.page) ?? '', 10)
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

async function getPastTimes(ctx: RouterContext, next: Koa.Next) {
  const { matchmakingType } = ctx.params as any as MatchmakingTypeParams

  let limit = parseInt(getSingleQueryParam(ctx.query.limit) ?? '', 10)
  if (!limit || isNaN(limit) || limit < 0 || limit > 100) {
    limit = 10
  }

  let page = parseInt(getSingleQueryParam(ctx.query.page) ?? '', 10)
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

async function addNew(ctx: RouterContext, next: Koa.Next) {
  const { matchmakingType } = ctx.params as any as MatchmakingTypeParams
  const { startDate, enabled } = ctx.request.body as AddMatchmakingTimeBody

  ctx.body = await addMatchmakingTime(matchmakingType, new Date(startDate), !!enabled)

  const matchmakingStatus = container.resolve(MatchmakingStatusService)
  matchmakingStatus.maybePublish(matchmakingType)
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

  const matchmakingStatus = container.resolve(MatchmakingStatusService)
  matchmakingStatus.maybePublish(matchmakingTime.type)

  ctx.status = 204
}
