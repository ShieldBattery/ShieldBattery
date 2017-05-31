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
  router.get('/:matchmakingType', ensureLoggedIn, getHistory)
    .get('/current/:matchmakingType', ensureLoggedIn, getCurrent)
    .post('/:matchmakingType', ensureLoggedIn, checkAllPermissions('manageMapPools'), setNewMapPool)
}

async function getHistory(ctx, next) {
  const { matchmakingType } = ctx.params

  if (!isValidMatchmakingType(matchmakingType)) {
    throw new httpErrors.BadRequest('invalid matchmaking type')
  }

  const mapPoolHistory = await getMapPoolHistory(matchmakingType)
  if (!mapPoolHistory) {
    throw new httpErrors.NotFound('no matchmaking map pool history for this type')
  }
  ctx.body = await Promise.all(mapPoolHistory.map(async m => ({
    startDate: +m.startDate,
    maps: await mapInfo(...m.maps),
  })))
}

async function setNewMapPool(ctx, next) {
  const { matchmakingType } = ctx.params
  const { maps } = ctx.request.body

  if (!isValidMatchmakingType(matchmakingType)) {
    throw new httpErrors.BadRequest('invalid matchmaking type')
  } else if (!maps || maps instanceof Array && maps.length < 1) {
    throw new httpErrors.BadRequest('maps must be specified')
  }

  await addMapPool(matchmakingType, maps)
  ctx.status = 201
  ctx.body = {}
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
