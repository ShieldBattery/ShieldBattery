import { RouterContext } from '@koa/router'
import httpErrors from 'http-errors'
import Joi from 'joi'
import Koa from 'koa'
import { JsonObject, SetRequired } from 'type-fest'
import { assertUnreachable } from '../../../common/assert-unreachable'
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
  MapExtension,
  MapInfo,
  MapServiceErrorCode,
  MapSortType,
  MapVisibility,
  MAX_MAP_FILE_SIZE_BYTES,
  SbMapId,
  toMapInfoJson,
  UpdateMapResponse,
  UploadMapResponse,
} from '../../../common/maps'
import { asHttpError } from '../errors/error-with-payload'
import { deleteFiles, getSignedUrl } from '../files'
import { handleMultipartFiles } from '../files/handle-multipart-files'
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
  updateMapImages,
  veryDangerousDeleteAllMaps,
} from '../maps/map-models'
import { MapServiceError, storeMap, storeRegeneratedImages } from '../maps/store'
import { checkAllPermissions } from '../permissions/check-permissions'
import ensureLoggedIn from '../session/ensure-logged-in'
import createThrottle from '../throttle/create-throttle'
import throttleMiddleware, { throttleByUser, throttleByUserOrIp } from '../throttle/middleware'
import { findUsersById } from '../users/user-model'
import { validateRequest } from '../validation/joi-validator'
import { processStoredMapFile, reparseMapsAsNeeded } from './map-operations'
import { mapPath } from './paths'

function convertMapServiceError(err: unknown) {
  if (!(err instanceof MapServiceError)) {
    throw err
  }

  switch (err.code) {
    case MapServiceErrorCode.NoPlayerSlots:
    case MapServiceErrorCode.InvalidMapFile:
      throw asHttpError(400, err)
    default:
      assertUnreachable(err.code)
  }
}

async function convertMapServiceErrors(ctx: RouterContext, next: Koa.Next) {
  try {
    await next()
  } catch (err) {
    convertMapServiceError(err)
  }
}

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

    const mapsResult = await getMaps({
      source,
      sort,
      numPlayers,
      tilesets,
      searchStr: searchQuery,
      limit: MAP_LIST_LIMIT,
      offset,
    })

    const [maps, libraryMapIds, users] = await Promise.all([
      reparseMapsAsNeeded(mapsResult),
      getLibraryMapIds(ctx, mapsResult),
      findPublishers(mapsResult),
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
    const mapResult = await getFavoritedMaps({
      sort,
      numPlayers,
      tilesets,
      searchStr: searchQuery,
      favoritedBy,
    })

    const [maps, libraryMapIds, users] = await Promise.all([
      reparseMapsAsNeeded(mapResult),
      getLibraryMapIds(ctx, mapResult),
      findPublishers(mapResult),
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

    const [mapsResult, favoritedMapIds] = await Promise.all([
      getMapInfos(mapIds),
      favoritedBy ? getFavoritedFromMapIds(favoritedBy, mapIds) : Promise.resolve([]),
    ])

    const [maps, libraryMapIds, users] = await Promise.all([
      reparseMapsAsNeeded(mapsResult),
      getLibraryMapIds(ctx, mapsResult),
      findPublishers(mapsResult),
    ])

    return {
      maps: maps.map(m => toMapInfoJson(m)),
      favoritedMapIds,
      libraryMapIds,
      users,
    }
  }

  @httpPost('/official')
  @httpBefore(
    convertMapServiceErrors,
    ensureLoggedIn,
    checkAllPermissions('manageMaps'),
    handleMultipartFiles(MAX_MAP_FILE_SIZE_BYTES),
  )
  async uploadOfficial(ctx: RouterContext): Promise<UploadMapResponse> {
    if (!ctx.request.files?.file || Array.isArray(ctx.request.files.file)) {
      throw new httpErrors.BadRequest('A single map file must be provided')
    }

    const { filepath } = ctx.request.files!.file
    const { extension } = (ctx.request.body ?? { extension: undefined }) as JsonObject

    if (!filepath) {
      throw new httpErrors.BadRequest('map file must be specified')
    } else if (!extension || typeof extension !== 'string') {
      throw new httpErrors.BadRequest('extension must be specified')
    }

    const lowerCaseExtension = extension.toLowerCase() as MapExtension
    if (!ALL_MAP_EXTENSIONS.includes(lowerCaseExtension)) {
      throw new httpErrors.BadRequest('Unsupported extension: ' + lowerCaseExtension)
    }

    const map = await storeMap(
      filepath,
      lowerCaseExtension,
      ctx.session!.user.id,
      MapVisibility.Official,
    )
    const [libraryMapIds, users] = await Promise.all([
      getLibraryMapIds(ctx, [map]),
      findPublishers([map]),
    ])
    return {
      map: toMapInfoJson(map),
      libraryMapIds,
      users,
    }
  }

  @httpPost('/')
  @httpBefore(
    convertMapServiceErrors,
    ensureLoggedIn,
    throttleMiddleware(mapUploadThrottle, throttleByUser),
    handleMultipartFiles(MAX_MAP_FILE_SIZE_BYTES),
  )
  async upload(ctx: RouterContext): Promise<UploadMapResponse> {
    if (!ctx.request.files?.file || Array.isArray(ctx.request.files.file)) {
      throw new httpErrors.BadRequest('A single map file must be provided')
    }

    const { filepath } = ctx.request.files!.file
    const { extension } = (ctx.request.body ?? { extension: undefined }) as JsonObject

    if (!filepath) {
      throw new httpErrors.BadRequest('map file must be specified')
    } else if (!extension || typeof extension !== 'string') {
      throw new httpErrors.BadRequest('extension must be specified')
    }

    const lowerCaseExtension = extension.toLowerCase() as MapExtension
    if (!ALL_MAP_EXTENSIONS.includes(lowerCaseExtension)) {
      throw new httpErrors.BadRequest('Unsupported extension: ' + lowerCaseExtension)
    }

    const map = await storeMap(
      filepath,
      lowerCaseExtension,
      ctx.session!.user.id,
      MapVisibility.Unlisted,
    )
    const [libraryMapIds, users] = await Promise.all([
      getLibraryMapIds(ctx, [map]),
      findPublishers([map]),
    ])
    return {
      map: toMapInfoJson(map),
      libraryMapIds,
      users,
    }
  }

  @httpPatch('/:mapId')
  @httpBefore(ensureLoggedIn, throttleMiddleware(mapUpdateThrottle, throttleByUser))
  async update(ctx: RouterContext): Promise<UpdateMapResponse> {
    const mapId = await getValidatedMapId(ctx)
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

    // An unlisted map is shared by everyone who uploaded the same file, so it always uses the
    // file's own name and description
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

  @httpPost('/:mapId/regenerate')
  @httpBefore(ensureLoggedIn, checkAllPermissions('manageMaps'))
  async regenMapImage(ctx: RouterContext): Promise<void> {
    const mapId = await getValidatedMapId(ctx)

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
