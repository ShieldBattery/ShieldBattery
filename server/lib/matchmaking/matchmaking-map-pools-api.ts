import { RouterContext } from '@koa/router'
import httpErrors from 'http-errors'
import Joi from 'joi'
import { toMapInfoJson } from '../../../common/maps'
import { ALL_MATCHMAKING_TYPES, MatchmakingType } from '../../../common/matchmaking'
import {
  CreateMatchmakingMapPoolRequest,
  CreateMatchmakingMapPoolResponse,
  GetMatchmakingMapPoolResponse,
  GetMatchmakingMapPoolsHistoryResponse,
  MATCHMAKING_MAP_POOLS_LIMIT,
  toMatchmakingMapPoolJson,
} from '../../../common/matchmaking/matchmaking-map-pools'
import { httpApi, httpBeforeAll } from '../http/http-api'
import { httpBefore, httpDelete, httpGet, httpPost } from '../http/route-decorators'
import { getMapInfos } from '../maps/map-models'
import { reparseMapsAsNeeded } from '../maps/map-operations'
import { checkAllPermissions } from '../permissions/check-permissions'
import ensureLoggedIn from '../session/ensure-logged-in'
import { validateRequest } from '../validation/joi-validator'
import {
  addMapPool,
  getCurrentMapPool,
  getMapPoolById,
  getMapPoolHistory,
  removeMapPool,
} from './matchmaking-map-pools-models'

function getValidatedMatchmakingType(ctx: RouterContext) {
  const {
    params: { matchmakingType },
  } = validateRequest(ctx, {
    params: Joi.object<{ matchmakingType: MatchmakingType }>({
      matchmakingType: Joi.valid(...ALL_MATCHMAKING_TYPES).required(),
    }),
  })

  return matchmakingType
}

@httpApi('/matchmaking-map-pools')
@httpBeforeAll(ensureLoggedIn)
export class MatchmakingMapPoolsApi {
  @httpGet('/:matchmakingType')
  @httpBefore(checkAllPermissions('manageMapPools'))
  async getHistory(ctx: RouterContext): Promise<GetMatchmakingMapPoolsHistoryResponse> {
    const matchmakingType = getValidatedMatchmakingType(ctx)

    const {
      query: { offset },
    } = validateRequest(ctx, {
      query: Joi.object<{ offset: number }>({
        offset: Joi.number().min(0).required(),
      }),
    })

    const mapPools = await getMapPoolHistory({
      matchmakingType,
      limit: MATCHMAKING_MAP_POOLS_LIMIT,
      offset,
    })

    const mapInfosResult = await getMapInfos(mapPools.flatMap(p => p.maps))
    const mapInfos = await reparseMapsAsNeeded(mapInfosResult)

    return {
      pools: mapPools.map(p => toMatchmakingMapPoolJson(p)),
      mapInfos: mapInfos.map(m => toMapInfoJson(m)),
      hasMorePools: mapPools.length >= MATCHMAKING_MAP_POOLS_LIMIT,
    }
  }

  @httpGet('/:matchmakingType/current')
  async getCurrent(ctx: RouterContext): Promise<GetMatchmakingMapPoolResponse> {
    const matchmakingType = getValidatedMatchmakingType(ctx)

    const pool = await getCurrentMapPool(matchmakingType)
    if (!pool) {
      throw new httpErrors.NotFound('no matchmaking map pool for this type')
    }

    const mapInfosResult = await getMapInfos(pool.maps)
    const mapInfos = await reparseMapsAsNeeded(mapInfosResult)

    return {
      pool: toMatchmakingMapPoolJson(pool),
      mapInfos: mapInfos.map(m => toMapInfoJson(m)),
    }
  }

  @httpPost('/:matchmakingType')
  @httpBefore(checkAllPermissions('manageMapPools'))
  async createNewMapPool(ctx: RouterContext): Promise<CreateMatchmakingMapPoolResponse> {
    const matchmakingType = getValidatedMatchmakingType(ctx)

    const {
      body: { maps, maxVetoCount, startDate },
    } = validateRequest(ctx, {
      body: Joi.object<CreateMatchmakingMapPoolRequest>({
        maps: Joi.array().items(Joi.string()).single().required(),
        maxVetoCount: Joi.number().min(0).required(),
        startDate: Joi.date().timestamp().min(Date.now()).required(),
      }),
    })

    // TODO(2Pac): Validate maps based on matchmaking type (e.g. so a 2-player map can't be used in
    // a 2v2 map pool)

    const mapPool = await addMapPool({
      matchmakingType,
      maps,
      maxVetoCount,
      startDate: new Date(startDate),
    })
    const mapInfosResult = await getMapInfos(mapPool.maps)
    const mapInfos = await reparseMapsAsNeeded(mapInfosResult)

    return {
      pool: toMatchmakingMapPoolJson(mapPool),
      mapInfos: mapInfos.map(m => toMapInfoJson(m)),
    }
  }

  @httpDelete('/:mapPoolId')
  @httpBefore(checkAllPermissions('manageMapPools'))
  async removeMapPool(ctx: RouterContext): Promise<void> {
    const {
      params: { mapPoolId },
    } = validateRequest(ctx, {
      params: Joi.object<{ mapPoolId: number }>({
        mapPoolId: Joi.number().min(1).required(),
      }),
    })

    const mapPool = await getMapPoolById(mapPoolId)
    if (!mapPool) {
      throw new httpErrors.NotFound("map pool doesn't exist")
    } else if (Number(mapPool.startDate) < Date.now()) {
      throw new httpErrors.BadRequest("can't delete map pools in past")
    }

    await removeMapPool(mapPoolId)
    ctx.status = 204
  }
}
