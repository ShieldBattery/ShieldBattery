import { RouterContext } from '@koa/router'
import httpErrors from 'http-errors'
import Joi from 'joi'
import { SetRequired } from 'type-fest'
import {
  ALL_MAP_EXTENSIONS,
  ALL_MAP_SORT_TYPES,
  ALL_MAP_VISIBILITIES,
  ALL_TILESETS,
  GetBatchMapInfoResponse,
  GetFavoritedMapsQueryParams,
  GetFavoritesResponse,
  GetMapsQueryParams,
  GetMapsResponse,
  MAP_LIST_LIMIT,
  MapSortType,
  MapVisibility,
  MAX_MAP_FILE_SIZE_BYTES,
  SbMapId,
  toMapInfoJson,
  UpdateMapResponse,
  UploadMapResponse,
} from '../../../common/maps'
import { deleteFiles, getSignedUrl } from '../files'
import { handleMultipartFiles } from '../files/handle-multipart-files'
import { httpApi } from '../http/http-api'
import { httpBefore, httpDelete, httpGet, httpPatch, httpPost } from '../http/route-decorators'
import {
  addMapToFavorites,
  getFavoritedFromMapIds,
  getFavoritedMaps,
  getMapInfos,
  getMaps,
  removeMap,
  removeMapFromFavorites,
  updateMap,
  updateMapImages,
  veryDangerousDeleteAllMaps,
} from '../maps/map-models'
import { storeMap, storeRegeneratedImages } from '../maps/store'
import { checkAllPermissions } from '../permissions/check-permissions'
import ensureLoggedIn from '../session/ensure-logged-in'
import createThrottle from '../throttle/create-throttle'
import throttleMiddleware from '../throttle/middleware'
import { findUserById, findUsersById } from '../users/user-model'
import { validateRequest } from '../validation/joi-validator'
import { processStoredMapFile, reparseMapsAsNeeded } from './map-operations'
import { mapPath } from './paths'

const mapsListThrottle = createThrottle('mapslist', {
  rate: 30,
  burst: 300,
  window: 60000,
})
const mapUploadThrottle = createThrottle('mapupload', {
  rate: 10,
  burst: 20,
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

function getValidatedMapId(ctx: RouterContext) {
  const {
    params: { mapId },
  } = validateRequest(ctx, {
    params: Joi.object<{ mapId: SbMapId }>({
      mapId: Joi.string().required(),
    }),
  })

  return mapId
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
  @httpBefore(throttleMiddleware(mapsListThrottle, ctx => String(ctx.session?.user?.id ?? ctx.ip)))
  async list(ctx: RouterContext): Promise<GetMapsResponse> {
    const {
      query: { visibility, sort, numPlayers, tilesets, q: searchQuery, offset },
    } = validateRequest(ctx, {
      query: Joi.object<ServerGetMapsQueryParams>({
        visibility: Joi.string()
          .valid(...ALL_MAP_VISIBILITIES)
          .default(MapVisibility.Official),
        sort: Joi.number()
          .valid(...ALL_MAP_SORT_TYPES)
          .default(MapSortType.Name),
        numPlayers: Joi.array().items(Joi.number().min(2).max(8)).default([2, 3, 4, 5, 6, 7, 8]),
        tilesets: Joi.array()
          .items(Joi.number().valid(...ALL_TILESETS))
          .default(ALL_TILESETS),
        q: Joi.string().allow(''),
        offset: Joi.number().min(0),
      }),
    })

    if (!ctx.session?.user && visibility === MapVisibility.Private) {
      throw new httpErrors.BadRequest('Private maps are only available to logged in users')
    }

    const uploadedBy = visibility === MapVisibility.Private ? ctx.session!.user.id : undefined

    const mapsResult = await getMaps({
      visibility,
      sort,
      numPlayers,
      tilesets,
      uploadedBy,
      searchStr: searchQuery,
      limit: MAP_LIST_LIMIT,
      offset,
    })

    const [maps, users] = await Promise.all([
      reparseMapsAsNeeded(mapsResult),
      findUsersById(mapsResult.map(m => m.uploadedBy)),
    ])

    return {
      maps: maps.map(m => toMapInfoJson(m)),
      hasMoreMaps: maps.length >= MAP_LIST_LIMIT,
      users,
    }
  }

  @httpGet('/favorites')
  @httpBefore(
    ensureLoggedIn,
    throttleMiddleware(mapsListThrottle, ctx => String(ctx.session!.user.id)),
  )
  async listFavorites(ctx: RouterContext): Promise<GetFavoritesResponse> {
    const {
      query: { sort, numPlayers, tilesets, q: searchQuery },
    } = validateRequest(ctx, {
      query: Joi.object<ServerGetFavoritedMapsQueryParams>({
        sort: Joi.number()
          .valid(...ALL_MAP_SORT_TYPES)
          .default(MapSortType.Name),
        numPlayers: Joi.array().items(Joi.number().min(2).max(8)).default([2, 3, 4, 5, 6, 7, 8]),
        tilesets: Joi.array()
          .items(Joi.number().valid(...ALL_TILESETS))
          .default(ALL_TILESETS),
        q: Joi.string().allow(''),
      }),
    })

    const favoritedBy = ctx.session!.user.id
    const mapResult = await getFavoritedMaps({
      sort,
      numPlayers,
      tilesets,
      searchStr: searchQuery,
      favoritedBy,
    })

    const [maps, users] = await Promise.all([
      reparseMapsAsNeeded(mapResult),
      findUsersById(mapResult.map(m => m.uploadedBy)),
    ])

    return {
      favoritedMaps: maps.map(m => toMapInfoJson(m)),
      users,
    }
  }

  @httpGet('/batch-info')
  @httpBefore(throttleMiddleware(mapsListThrottle, ctx => String(ctx.session?.user?.id ?? ctx.ip)))
  async getInfo(ctx: RouterContext): Promise<GetBatchMapInfoResponse> {
    const { query } = validateRequest(ctx, {
      query: Joi.object<{ m: SbMapId[] }>({
        m: Joi.array().items(Joi.string()).single().min(1).max(40),
      }),
    })

    const mapIds = query.m
    const favoritedBy = ctx.session?.user.id

    const [mapsResult, favoritedMapIds] = await Promise.all([
      getMapInfos(mapIds),
      favoritedBy ? getFavoritedFromMapIds(favoritedBy, mapIds) : Promise.resolve([]),
    ])

    const [maps, users] = await Promise.all([
      reparseMapsAsNeeded(mapsResult),
      findUsersById(mapsResult.map(m => m.uploadedBy)),
    ])

    return {
      maps: maps.map(m => toMapInfoJson(m)),
      favoritedMapIds,
      users,
    }
  }

  @httpPost('/official')
  @httpBefore(
    ensureLoggedIn,
    checkAllPermissions('manageMaps'),
    handleMultipartFiles(MAX_MAP_FILE_SIZE_BYTES),
  )
  async uploadOfficial(ctx: RouterContext): Promise<UploadMapResponse> {
    if (!ctx.request.files?.file || Array.isArray(ctx.request.files.file)) {
      throw new httpErrors.BadRequest('A single map file must be provided')
    }

    const { filepath } = ctx.request.files!.file
    const { extension } = ctx.request.body

    if (!filepath) {
      throw new httpErrors.BadRequest('map file must be specified')
    } else if (!extension) {
      throw new httpErrors.BadRequest('extension must be specified')
    }

    const lowerCaseExtension = extension.toLowerCase()
    if (!ALL_MAP_EXTENSIONS.includes(lowerCaseExtension)) {
      throw new httpErrors.BadRequest('Unsupported extension: ' + lowerCaseExtension)
    }

    const [map, user] = await Promise.all([
      storeMap(filepath, lowerCaseExtension, ctx.session!.user.id, MapVisibility.Official),
      findUserById(ctx.session!.user.id),
    ])
    return {
      map: toMapInfoJson(map),
      users: user ? [user] : [],
    }
  }

  @httpPost('/')
  @httpBefore(
    ensureLoggedIn,
    throttleMiddleware(mapUploadThrottle, ctx => String(ctx.session!.user.id)),
    handleMultipartFiles(MAX_MAP_FILE_SIZE_BYTES),
  )
  async upload(ctx: RouterContext): Promise<UploadMapResponse> {
    if (!ctx.request.files?.file || Array.isArray(ctx.request.files.file)) {
      throw new httpErrors.BadRequest('A single map file must be provided')
    }

    const { filepath } = ctx.request.files!.file
    const { extension } = ctx.request.body

    if (!filepath) {
      throw new httpErrors.BadRequest('map file must be specified')
    } else if (!extension) {
      throw new httpErrors.BadRequest('extension must be specified')
    }

    const lowerCaseExtension = extension.toLowerCase()
    if (!ALL_MAP_EXTENSIONS.includes(lowerCaseExtension)) {
      throw new httpErrors.BadRequest('Unsupported extension: ' + lowerCaseExtension)
    }

    const [map, user] = await Promise.all([
      storeMap(filepath, lowerCaseExtension, ctx.session!.user.id, MapVisibility.Private),
      findUserById(ctx.session!.user.id),
    ])
    return {
      map: toMapInfoJson(map),
      users: user ? [user] : [],
    }
  }

  @httpPatch('/:mapId')
  @httpBefore(
    ensureLoggedIn,
    throttleMiddleware(mapUpdateThrottle, ctx => String(ctx.session!.user.id)),
  )
  async update(ctx: RouterContext): Promise<UpdateMapResponse> {
    const mapId = getValidatedMapId(ctx)
    const {
      body: { name, description },
    } = validateRequest(ctx, {
      body: Joi.object<{ name?: string; description?: string }>({
        name: Joi.string(),
        description: Joi.string(),
      }),
    })

    let map = (await getMapInfos([mapId]))[0]
    if (!map) {
      throw new httpErrors.NotFound('Map not found')
    }

    ;[map] = await reparseMapsAsNeeded([map])

    // TODO(tec27): These checks are bad and should be changed before we allow anyone to make maps
    // public
    if (
      [MapVisibility.Official, MapVisibility.Public].includes(map.visibility) &&
      !ctx.session!.permissions!.manageMaps
    ) {
      throw new httpErrors.Forbidden('Not enough permissions')
    }
    if (map.visibility === MapVisibility.Private && map.uploadedBy !== ctx.session!.user.id) {
      throw new httpErrors.Forbidden("Can't update maps of other users")
    }

    if (name !== undefined || description !== undefined) {
      map = await updateMap(mapId, name, description)
    }

    const user = await findUserById(map.uploadedBy)
    return {
      map: toMapInfoJson(map),
      users: user ? [user] : [],
    }
  }

  @httpDelete('/:mapId')
  @httpBefore(
    ensureLoggedIn,
    throttleMiddleware(mapRemoveThrottle, ctx => String(ctx.session!.user.id)),
  )
  async remove(ctx: RouterContext): Promise<void> {
    const mapId = getValidatedMapId(ctx)

    const map = (await getMapInfos([mapId]))[0]
    if (!map) {
      throw new httpErrors.NotFound('Map not found')
    }
    // TODO(tec27): These checks are bad and should be changed before we allow anyone to make maps
    // public
    if (
      (map.visibility === MapVisibility.Official || map.visibility === MapVisibility.Public) &&
      !ctx.session!.permissions!.manageMaps
    ) {
      throw new httpErrors.Forbidden('Not enough permissions')
    }
    if (map.visibility === MapVisibility.Private && map.uploadedBy !== ctx.session!.user.id) {
      throw new httpErrors.Forbidden("Can't remove maps of other users")
    }

    await removeMap(mapId)
    ctx.status = 204
  }

  @httpPost('/:mapId/favorite')
  @httpBefore(
    ensureLoggedIn,
    throttleMiddleware(mapFavoriteThrottle, ctx => String(ctx.session!.user.id)),
  )
  async addToFavorites(ctx: RouterContext): Promise<void> {
    const mapId = getValidatedMapId(ctx)

    await addMapToFavorites(mapId, ctx.session!.user.id)
    ctx.status = 204
  }

  @httpDelete('/:mapId/favorite')
  @httpBefore(
    ensureLoggedIn,
    throttleMiddleware(mapFavoriteThrottle, ctx => String(ctx.session!.user.id)),
  )
  async removeFromFavorites(ctx: RouterContext): Promise<void> {
    const mapId = getValidatedMapId(ctx)

    await removeMapFromFavorites(mapId, ctx.session!.user.id)
    ctx.status = 204
  }

  @httpPost('/:mapId/download-url')
  @httpBefore(throttleMiddleware(mapsListThrottle, ctx => String(ctx.session?.user?.id ?? ctx.ip)))
  async getDownloadUrl(ctx: RouterContext): Promise<{ url: string }> {
    const mapId = getValidatedMapId(ctx)

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

  @httpPost('/:mapId/regenerate')
  @httpBefore(ensureLoggedIn, checkAllPermissions('manageMaps'))
  async regenMapImage(ctx: RouterContext): Promise<void> {
    const mapId = getValidatedMapId(ctx)

    const map = (await getMapInfos([mapId]))[0]
    if (!map) {
      throw new httpErrors.NotFound('Map not found')
    }

    await updateMapImages(map.hash, async () => {
      await processStoredMapFile(
        map,
        async ({ path }) => await storeRegeneratedImages(path, map.mapData.format),
      )
    })

    // TODO(tec27): Should probably return the updated map info here, since the URLs will change
    ctx.status = 204
  }

  @httpDelete('/')
  @httpBefore(ensureLoggedIn, checkAllPermissions('massDeleteMaps'))
  async deleteAllMaps(ctx: RouterContext): Promise<void> {
    await veryDangerousDeleteAllMaps(async () => {
      await Promise.all([deleteFiles('maps/'), deleteFiles('map_images/')])
    })
    ctx.status = 204
  }
}
