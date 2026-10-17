import { RouterContext } from '@koa/router'
import httpErrors from 'http-errors'
import Joi from 'joi'
import { SetRequired } from 'type-fest'
import {
  ALL_MAP_SORT_TYPES,
  ALL_MAP_VISIBILITIES,
  ALL_TILESETS,
  filterColorCodes,
  GetBatchMapInfoResponse,
  GetFavoritedMapsQueryParams,
  GetFavoritesResponse,
  GetMapsQueryParams,
  GetMapsResponse,
  MAP_LIST_LIMIT,
  MapInfo,
  MapSortType,
  MapVisibility,
  SbMapId,
  toMapInfoJson,
  UpdateMapResponse,
} from '../../../common/maps'
import { deleteFiles, getSignedUrl } from '../files'
import { httpApi } from '../http/http-api'
import { httpBefore, httpDelete, httpGet, httpPatch, httpPost } from '../http/route-decorators'
import {
  addMapToFavorites,
  delistMap,
  getFavoritedFromMapIds,
  getFavoritedMaps,
  getLibraryFromMapIds,
  getMapInfos,
  getMaps,
  MapListSource,
  removeMapFromFavorites,
  removeMapFromLibrary,
  resolveMapId,
  resolveMapIds,
  updateMap,
  veryDangerousDeleteAllMaps,
} from '../maps/map-models'
import { checkAllPermissions } from '../permissions/check-permissions'
import ensureLoggedIn from '../session/ensure-logged-in'
import createThrottle from '../throttle/create-throttle'
import throttleMiddleware, { throttleByUser, throttleByUserOrIp } from '../throttle/middleware'
import { findUsersById } from '../users/user-model'
import { validateRequest } from '../validation/joi-validator'
import { mapPath } from './paths'

const mapsListThrottle = createThrottle('mapslist', {
  rate: 30,
  burst: 300,
  window: 60000,
})
const mapUpdateThrottle = createThrottle('mapupdate', {
  rate: 20,
  burst: 60,
  window: 60000,
})
const mapFavoriteThrottle = createThrottle('mapfavorite', {
  rate: 30,
  burst: 70,
  window: 60000,
})
const mapRemoveThrottle = createThrottle('mapremove', {
  rate: 20,
  burst: 40,
  window: 60000,
})

async function getValidatedMapId(ctx: RouterContext): Promise<SbMapId> {
  const {
    params: { mapId },
  } = validateRequest(ctx, {
    params: Joi.object<{ mapId: SbMapId }>({
      mapId: Joi.string().required(),
    }),
  })

  return await resolveMapId(mapId)
}

/** Returns the users who published `maps`, for including alongside them in a response. */
function findPublishers(maps: ReadonlyArray<MapInfo>) {
  return findUsersById(maps.flatMap(m => (m.publishedBy !== undefined ? [m.publishedBy] : [])))
}

/** Returns which of `maps` are in the requesting user's own maps. */
function getLibraryMapIds(ctx: RouterContext, maps: ReadonlyArray<MapInfo>) {
  const userId = ctx.session?.user.id
  return userId
    ? getLibraryFromMapIds(
        userId,
        maps.map(m => m.id),
      )
    : Promise.resolve([])
}

type ServerGetMapsQueryParams = SetRequired<
  GetMapsQueryParams,
  'visibility' | 'sort' | 'numPlayers' | 'tilesets'
>

type ServerGetFavoritedMapsQueryParams = SetRequired<
  GetFavoritedMapsQueryParams,
  'sort' | 'numPlayers' | 'tilesets'
>

@httpApi('/maps')
export class MapsApi {
  @httpGet('/')
  @httpBefore(throttleMiddleware(mapsListThrottle, throttleByUserOrIp))
  async list(ctx: RouterContext): Promise<GetMapsResponse> {
    const {
      query: { visibility, sort, numPlayers, tilesets, q: searchQuery, offset },
    } = validateRequest(ctx, {
      query: Joi.object<ServerGetMapsQueryParams>({
        visibility: Joi.string()
          // TODO(2Pac): Remove once app versions that still request `PRIVATE` have aged out.
          // That value was renamed to `UNLISTED` and has the same meaning.
          .replace(/^PRIVATE$/, MapVisibility.Unlisted)
          .valid(...ALL_MAP_VISIBILITIES)
          .default(MapVisibility.Official),
        sort: Joi.number()
          .valid(...ALL_MAP_SORT_TYPES)
          .default(MapSortType.Name),
        numPlayers: Joi.array()
          .items(Joi.number().min(2).max(8))
          .single()
          .default([2, 3, 4, 5, 6, 7, 8]),
        tilesets: Joi.array()
          .items(Joi.number().valid(...ALL_TILESETS))
          .single()
          .default(ALL_TILESETS),
        q: Joi.string().allow(''),
        offset: Joi.number().min(0),
      }),
    })

    if (!ctx.session?.user && visibility === MapVisibility.Unlisted) {
      throw new httpErrors.BadRequest('Unlisted maps are only available to logged in users')
    }

    // Unlisted maps aren't in any listing, so their "listing" is the user's own maps instead
    const source: MapListSource =
      visibility === MapVisibility.Unlisted
        ? { libraryOf: ctx.session!.user.id }
        : { listing: visibility }

    const maps = await getMaps({
      source,
      sort,
      numPlayers,
      tilesets,
      searchStr: searchQuery,
      limit: MAP_LIST_LIMIT,
      offset,
    })

    const [libraryMapIds, users] = await Promise.all([
      getLibraryMapIds(ctx, maps),
      findPublishers(maps),
    ])

    return {
      maps: maps.map(m => toMapInfoJson(m)),
      hasMoreMaps: maps.length >= MAP_LIST_LIMIT,
      libraryMapIds,
      users,
    }
  }

  @httpGet('/favorites')
  @httpBefore(ensureLoggedIn, throttleMiddleware(mapsListThrottle, throttleByUser))
  async listFavorites(ctx: RouterContext): Promise<GetFavoritesResponse> {
    const {
      query: { sort, numPlayers, tilesets, q: searchQuery },
    } = validateRequest(ctx, {
      query: Joi.object<ServerGetFavoritedMapsQueryParams>({
        sort: Joi.number()
          .valid(...ALL_MAP_SORT_TYPES)
          .default(MapSortType.Name),
        numPlayers: Joi.array()
          .items(Joi.number().min(2).max(8))
          .single()
          .default([2, 3, 4, 5, 6, 7, 8]),
        tilesets: Joi.array()
          .items(Joi.number().valid(...ALL_TILESETS))
          .single()
          .default(ALL_TILESETS),
        q: Joi.string().allow(''),
      }),
    })

    const favoritedBy = ctx.session!.user.id
    const maps = await getFavoritedMaps({
      sort,
      numPlayers,
      tilesets,
      searchStr: searchQuery,
      favoritedBy,
    })

    const [libraryMapIds, users] = await Promise.all([
      getLibraryMapIds(ctx, maps),
      findPublishers(maps),
    ])

    return {
      favoritedMaps: maps.map(m => toMapInfoJson(m)),
      libraryMapIds,
      users,
    }
  }

  @httpGet('/batch-info')
  @httpBefore(throttleMiddleware(mapsListThrottle, throttleByUserOrIp))
  async getInfo(ctx: RouterContext): Promise<GetBatchMapInfoResponse> {
    const { query } = validateRequest(ctx, {
      query: Joi.object<{ m: SbMapId[] }>({
        m: Joi.array().items(Joi.string()).single().min(1).max(40),
      }),
    })

    const mapIds = await resolveMapIds(query.m)
    const favoritedBy = ctx.session?.user.id

    const [maps, favoritedMapIds] = await Promise.all([
      getMapInfos(mapIds),
      favoritedBy ? getFavoritedFromMapIds(favoritedBy, mapIds) : Promise.resolve([]),
    ])

    const [libraryMapIds, users] = await Promise.all([
      getLibraryMapIds(ctx, maps),
      findPublishers(maps),
    ])

    return {
      maps: maps.map(m => toMapInfoJson(m)),
      favoritedMapIds,
      libraryMapIds,
      users,
    }
  }

  @httpPatch('/:mapId')
  @httpBefore(ensureLoggedIn, throttleMiddleware(mapUpdateThrottle, throttleByUser))
  async update(ctx: RouterContext): Promise<UpdateMapResponse> {
    const mapId = await getValidatedMapId(ctx)
    const {
      body: { name: rawName, description: rawDescription },
    } = validateRequest(ctx, {
      body: Joi.object<{ name?: string; description?: string }>({
        name: Joi.string(),
        description: Joi.string(),
      }),
    })

    // BW color codes would show up as unprintable characters wherever the name is displayed
    const name = rawName !== undefined ? filterColorCodes(rawName) : undefined
    const description = rawDescription !== undefined ? filterColorCodes(rawDescription) : undefined
    if (name === '' || description === '') {
      throw new httpErrors.BadRequest('Name and description must contain printable characters')
    }

    let map = (await getMapInfos([mapId]))[0]
    if (!map) {
      throw new httpErrors.NotFound('Map not found')
    }

    // Curated names and descriptions are only set while a map is listed. A map that was never
    // listed uses the file's own; a delisted one keeps the ones it was listed under, which games
    // played on it were shown with
    if (map.visibility === MapVisibility.Unlisted) {
      throw new httpErrors.Forbidden("Unlisted maps can't be renamed")
    }
    if (!ctx.session!.permissions!.manageMaps) {
      throw new httpErrors.Forbidden('Not enough permissions')
    }

    if (name !== undefined || description !== undefined) {
      map = await updateMap(mapId, name, description)
    }

    const users = await findPublishers([map])
    return {
      map: toMapInfoJson(map),
      users,
    }
  }

  /** Removes a map from the requesting user's own maps. */
  @httpDelete('/:mapId')
  @httpBefore(ensureLoggedIn, throttleMiddleware(mapRemoveThrottle, throttleByUser))
  async remove(ctx: RouterContext): Promise<void> {
    const mapId = await getValidatedMapId(ctx)

    if (await removeMapFromLibrary(mapId, ctx.session!.user.id)) {
      ctx.status = 204
      return
    }

    // TODO(2Pac): Remove once app versions from before `/delist` existed have aged out. Those
    // remove listed maps through this endpoint.
    if (ctx.session!.permissions!.manageMaps) {
      const map = (await getMapInfos([mapId]))[0]
      if (map && map.visibility !== MapVisibility.Unlisted) {
        await delistMap(mapId, ctx.session!.user.id)
        ctx.status = 204
        return
      }
    }

    throw new httpErrors.NotFound('Map not found in your maps')
  }

  /** Removes a map from the listings, leaving it reachable by ID. */
  @httpPost('/:mapId/delist')
  @httpBefore(ensureLoggedIn, checkAllPermissions('manageMaps'))
  async delist(ctx: RouterContext): Promise<void> {
    const mapId = await getValidatedMapId(ctx)

    const map = (await getMapInfos([mapId]))[0]
    if (!map) {
      throw new httpErrors.NotFound('Map not found')
    }

    await delistMap(mapId, ctx.session!.user.id)
    ctx.status = 204
  }

  @httpPost('/:mapId/favorite')
  @httpBefore(ensureLoggedIn, throttleMiddleware(mapFavoriteThrottle, throttleByUser))
  async addToFavorites(ctx: RouterContext): Promise<void> {
    const mapId = await getValidatedMapId(ctx)

    await addMapToFavorites(mapId, ctx.session!.user.id)
    ctx.status = 204
  }

  @httpDelete('/:mapId/favorite')
  @httpBefore(ensureLoggedIn, throttleMiddleware(mapFavoriteThrottle, throttleByUser))
  async removeFromFavorites(ctx: RouterContext): Promise<void> {
    const mapId = await getValidatedMapId(ctx)

    await removeMapFromFavorites(mapId, ctx.session!.user.id)
    ctx.status = 204
  }

  @httpPost('/:mapId/download-url')
  @httpBefore(throttleMiddleware(mapsListThrottle, throttleByUserOrIp))
  async getDownloadUrl(ctx: RouterContext): Promise<{ url: string }> {
    const mapId = await getValidatedMapId(ctx)

    const map = (await getMapInfos([mapId]))[0]
    if (!map) {
      throw new httpErrors.NotFound('Map not found')
    }

    const path = mapPath(map.hash, map.mapData.format)
    const url = await getSignedUrl(path, {
      contentDisposition: `attachment; filename="${map.name}.${map.mapData.format}"`,
    })

    return { url }
  }

  @httpDelete('/')
  @httpBefore(ensureLoggedIn, checkAllPermissions('massDeleteMaps'))
  async deleteAllMaps(ctx: RouterContext): Promise<void> {
    await veryDangerousDeleteAllMaps(async () => {
      await Promise.all([
        deleteFiles('maps/'),
        deleteFiles('map_images/'),
        deleteFiles('map_rejects/'),
      ])
    })
    ctx.status = 204
  }
}
