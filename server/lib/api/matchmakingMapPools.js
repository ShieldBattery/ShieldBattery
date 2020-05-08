import httpErrors from 'http-errors'
import { checkAllPermissions } from '../permissions/check-permissions'
import ensureLoggedIn from '../session/ensure-logged-in'
import { isValidMatchmakingType } from '../../../app/common/constants'
import { MATCHMAKING } from '../../../app/common/flags'
import { getMapInfo } from '../models/maps'
import { featureEnabled } from '../flags/feature-enabled'
import {
  getMapPoolHistory,
  addMapPool,
  getCurrentMapPool,
  getMapPoolById,
  removeMapPool as removeMapPoolDb,
} from '../models/matchmaking-map-pools'

export default function (router) {
  router
    .get(
      '/:matchmakingType',
      featureEnabled(MATCHMAKING),
      ensureLoggedIn,
      checkAllPermissions('manageMapPools'),
      getHistory,
    )
    .get('/:matchmakingType/current', featureEnabled(MATCHMAKING), ensureLoggedIn, getCurrent)
    .post(
      '/:matchmakingType',
      featureEnabled(MATCHMAKING),
      ensureLoggedIn,
      checkAllPermissions('manageMapPools'),
      createNewMapPool,
    )
    .delete(
      '/:mapPoolId',
      featureEnabled(MATCHMAKING),
      ensureLoggedIn,
      checkAllPermissions('manageMapPools'),
      removeMapPool,
    )
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
  const pools = await Promise.all(
    mapPoolHistory.map(async m => ({
      startDate: +m.startDate,
      maps: await getMapInfo(m.maps, ctx.session.userId),
    })),
  )

  ctx.body = {
    matchmakingType,
    page: pageNumber,
    limit,
    pools,
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

  await addMapPool(matchmakingType, maps, new Date(startDate))
  ctx.status = 204
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
