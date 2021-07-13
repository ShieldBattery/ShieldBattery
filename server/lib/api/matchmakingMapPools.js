import httpErrors from 'http-errors'
import { isValidMatchmakingType } from '../../../common/matchmaking'
import { getMapInfo } from '../maps/map-models'
import {
  addMapPool,
  getCurrentMapPool,
  getMapPoolById,
  getMapPoolHistory,
  removeMapPool as removeMapPoolDb,
} from '../models/matchmaking-map-pools'
import { checkAllPermissions } from '../permissions/check-permissions'
import ensureLoggedIn from '../session/ensure-logged-in'

export default function (router) {
  router
    .get('/:matchmakingType', ensureLoggedIn, checkAllPermissions('manageMapPools'), getHistory)
    .get('/:matchmakingType/current', ensureLoggedIn, getCurrent)
    .post(
      '/:matchmakingType',
      ensureLoggedIn,
      checkAllPermissions('manageMapPools'),
      createNewMapPool,
    )
    .delete('/:mapPoolId', ensureLoggedIn, checkAllPermissions('manageMapPools'), removeMapPool)
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

  const { mapPools, total } = await getMapPoolHistory(matchmakingType, limit, pageNumber)
  const pools = await Promise.all(
    mapPools.map(async m => ({
      ...m,
      startDate: +m.startDate,
      maps: await getMapInfo(m.maps, ctx.session.userId),
    })),
  )

  ctx.body = {
    pools,
    page: pageNumber,
    limit,
    total,
  }
}

async function createNewMapPool(ctx, next) {
  const { matchmakingType } = ctx.params
  const { maps, startDate } = ctx.request.body

  if (!isValidMatchmakingType(matchmakingType)) {
    throw new httpErrors.BadRequest('invalid matchmaking type')
  } else if (!Array.isArray(maps) || maps.length < 1) {
    throw new httpErrors.BadRequest('maps must be a non-empty array')
  } else if (!startDate || !Number.isInteger(startDate) || startDate < Date.now()) {
    throw new httpErrors.BadRequest('startDate must be a valid timestamp value in the future')
  }

  const mapPool = await addMapPool(matchmakingType, maps, new Date(startDate))
  ctx.body = {
    ...mapPool,
    startDate: +mapPool.startDate,
    maps: await getMapInfo(mapPool.maps, ctx.session.userId),
  }
}

async function getCurrent(ctx, next) {
  const { matchmakingType } = ctx.params

  if (!isValidMatchmakingType(matchmakingType)) {
    throw new httpErrors.BadRequest('invalid matchmaking type')
  }

  const mapPool = await getCurrentMapPool(matchmakingType)
  if (!mapPool) {
    throw new httpErrors.NotFound('no matchmaking map pool for this type')
  }
  ctx.body = {
    ...mapPool,
    maps: await getMapInfo(mapPool.maps, ctx.session.userId),
  }
}

async function removeMapPool(ctx, next) {
  const { mapPoolId } = ctx.params

  const mapPool = await getMapPoolById(mapPoolId)
  if (!mapPool) {
    throw new httpErrors.NotFound("map pool doesn't exist")
  } else if (mapPool.startDate < Date.now()) {
    throw new httpErrors.BadRequest("can't delete map pools in past")
  }

  await removeMapPoolDb(mapPoolId)
  ctx.status = 204
}
