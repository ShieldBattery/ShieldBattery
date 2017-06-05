import httpErrors from 'http-errors'
import { checkAllPermissions } from '../permissions/check-permissions'
import ensureLoggedIn from '../session/ensure-logged-in'
import { isValidMatchmakingType } from '../../../app/common/constants'
import { mapInfo } from '../maps/store'
import {
  getMapPoolHistory,
  addMapPool,
  getCurrentMapPool,
} from '../models/matchmaking-map-pools'

export default function(router) {
  router.get('/:matchmakingType', ensureLoggedIn, checkAllPermissions('manageMapPools'), getHistory)
    .get('/:matchmakingType/current', ensureLoggedIn, getCurrent)
    .post('/:matchmakingType', ensureLoggedIn, checkAllPermissions('manageMapPools'), setNewMapPool)
}

async function getHistory(ctx, next) {
  const { matchmakingType } = ctx.params
  let { limit, page: pageNumber } = ctx.query

  if (!isValidMatchmakingType(matchmakingType)) {
    throw new httpErrors.BadRequest('invalid matchmaking type')
  }

  limit = parseInt(limit, 10)
  if (!limit || isNaN(limit) || limit < 0 || limit > 100) {
    limit = 10
  }

  pageNumber = parseInt(pageNumber, 10)
  if (!pageNumber || isNaN(pageNumber) || pageNumber < 0) {
    pageNumber = 0
  }

  const mapPoolHistory = await getMapPoolHistory(matchmakingType, limit, pageNumber)
  if (!mapPoolHistory) {
    throw new httpErrors.NotFound('no matchmaking map pool history for this type')
  }
  const pools = await Promise.all(mapPoolHistory.map(async m => ({
    startDate: +m.startDate,
    maps: await mapInfo(...m.maps),
  })))

  ctx.body = {
    matchmakingType,
    page: pageNumber,
    limit,
    pools,
  }
}

async function setNewMapPool(ctx, next) {
  const { matchmakingType } = ctx.params
  const { maps } = ctx.request.body
  let { startDate } = ctx.request.body

  if (!isValidMatchmakingType(matchmakingType)) {
    throw new httpErrors.BadRequest('invalid matchmaking type')
  } else if (!Array.isArray(maps)) {
    throw new httpErrors.BadRequest('maps must be an array')
  } else if (maps.length < 1) {
    throw new httpErrors.BadRequest('maps cant be an empty array')
  } else if (startDate && !Number.isInteger(startDate)) {
    throw new httpErrors.BadRequest('startDate must be an integer')
  } else if (startDate && startDate < 0) {
    throw new httpErrors.BadRequest('startDate must be a positive integer')
  }

  if (startDate) {
    startDate = new Date(startDate)
  }

  await addMapPool(matchmakingType, maps, startDate)
  ctx.status = 204
}

async function getCurrent(ctx, next) {
  const { matchmakingType } = ctx.params

  if (!isValidMatchmakingType(matchmakingType)) {
    throw new httpErrors.BadRequest('invalid matchmaking type')
  }

  const maps = await getCurrentMapPool(matchmakingType)
  if (!maps) {
    throw new httpErrors.NotFound('no matchmaking map pool for this type')
  }
  ctx.body = await mapInfo(...maps)
}
