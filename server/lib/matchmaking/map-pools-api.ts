import { RouterContext } from '@koa/router'
import httpErrors from 'http-errors'
import Joi from 'joi'
import { MapInfoJson, toMapInfoJson } from '../../../common/maps'
import {
  ALL_MATCHMAKING_TYPES,
  GetMatchmakingMapPoolBody,
  MatchmakingType,
} from '../../../common/matchmaking'
import { httpApi, httpBeforeAll } from '../http/http-api'
import { httpBefore, httpDelete, httpGet, httpPost } from '../http/route-decorators'
import { getMapInfo } from '../maps/map-models'
import { reparseMapsAsNeeded } from '../maps/map-operations'
import {
  addMapPool,
  getCurrentMapPool,
  getMapPoolById,
  getMapPoolHistory,
  removeMapPool,
} from '../models/matchmaking-map-pools'
import { checkAllPermissions } from '../permissions/check-permissions'
import ensureLoggedIn from '../session/ensure-logged-in'
import { validateRequest } from '../validation/joi-validator'

interface GetMapPoolsHistoryPayload {
  pools: Array<{
    id: number
    type: MatchmakingType
    startDate: number
    maps: MapInfoJson[]
  }>
  page: number
  limit: number
  total: number
}

const MATCHMAKING_TYPE_PARAMS = Joi.object<{ matchmakingType: MatchmakingType }>({
  matchmakingType: Joi.valid(...ALL_MATCHMAKING_TYPES).required(),
})

@httpApi('/matchmaking-map-pools')
@httpBeforeAll(ensureLoggedIn)
export class MatchmakingMapPoolsApi {
  @httpGet('/:matchmakingType')
  @httpBefore(checkAllPermissions('manageMapPools'))
  async getHistory(ctx: RouterContext): Promise<GetMapPoolsHistoryPayload> {
    const { params, query } = validateRequest(ctx, {
      params: MATCHMAKING_TYPE_PARAMS,
      query: Joi.object<{ limit: number; page: number }>({
        limit: Joi.number().min(1).max(100).default(10),
        page: Joi.number().min(0).default(0),
      }),
    })

    const { matchmakingType } = params
    const { limit, page: pageNumber } = query

    const { mapPools, total } = await getMapPoolHistory(matchmakingType, limit, pageNumber)
    const pools = await Promise.all(
      mapPools.map(async m => ({
        ...m,
        startDate: Number(m.startDate),
        maps: (
          await reparseMapsAsNeeded(
            await getMapInfo(m.maps, ctx.session!.userId),
            ctx.session!.userId,
          )
        ).map(m => toMapInfoJson(m)),
      })),
    )

    return {
      pools,
      page: pageNumber,
      limit,
      total,
    }
  }

  @httpGet('/:matchmakingType/current')
  async getCurrent(ctx: RouterContext): Promise<GetMatchmakingMapPoolBody> {
    const { params } = validateRequest(ctx, {
      params: MATCHMAKING_TYPE_PARAMS,
    })
    const { matchmakingType } = params

    const pool = await getCurrentMapPool(matchmakingType)
    if (!pool) {
      throw new httpErrors.NotFound('no matchmaking map pool for this type')
    }

    const maps = await getMapInfo(pool.maps, ctx.session!.userId)

    return {
      pool: {
        ...pool,
        startDate: Number(pool?.startDate),
      },
      mapInfos: maps.map(m => toMapInfoJson(m)),
    }
  }

  @httpPost('/:matchmakingType')
  @httpBefore(checkAllPermissions('manageMapPools'))
  async createNewMapPool(ctx: RouterContext) {
    const { params, body } = validateRequest(ctx, {
      params: MATCHMAKING_TYPE_PARAMS,
      body: Joi.object<{ maps: string[]; startDate: Date }>({
        maps: Joi.array().items(Joi.string()).required(),
        startDate: Joi.date().timestamp().min(Date.now()),
      }),
    })

    const { matchmakingType } = params
    const { maps, startDate } = body

    // TODO(2Pac): Validate maps based on matchmaking type (e.g. so a 2-player map can't be used in
    // a 2v2 map pool)

    const mapPool = await addMapPool(matchmakingType, maps, new Date(startDate))
    return {
      ...mapPool,
      startDate: Number(mapPool.startDate),
      maps: (await getMapInfo(mapPool.maps, ctx.session!.userId)).map(m => toMapInfoJson(m)),
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
