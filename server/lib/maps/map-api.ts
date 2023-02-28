import { RouterContext } from '@koa/router'
import httpErrors from 'http-errors'
import Joi from 'joi'
import {
  ALL_MAP_EXTENSIONS,
  ALL_MAP_SORT_TYPES,
  ALL_MAP_VISIBILITIES,
  GetBatchMapInfoResponse,
  MapVisibility,
  toMapInfoJson,
} from '../../../common/maps'
import { deleteFiles } from '../file-upload'
import { handleMultipartFiles } from '../file-upload/handle-multipart-files'
import { httpApi, httpBeforeAll } from '../http/http-api'
import { httpBefore, httpDelete, httpGet, httpPatch, httpPost } from '../http/route-decorators'
import {
  addMapToFavorites,
  getFavoritedMaps,
  getMapInfo,
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
import { validateRequest } from '../validation/joi-validator'
import { processStoredMapFile, reparseMapsAsNeeded } from './map-operations'

const mapsListThrottle = createThrottle('mapslist', {
  rate: 30,
  burst: 50,
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

@httpApi('/maps')
@httpBeforeAll(ensureLoggedIn)
export class MapsApi {
  @httpGet('/')
  @httpBefore(throttleMiddleware(mapsListThrottle, ctx => String(ctx.session!.userId)))
  async list(ctx: RouterContext): Promise<any> {
    // TODO(tec27): Use validateRequest for this stuff to remove the need for all the casts

    const { q, visibility } = ctx.query
    const { sort, numPlayers, tileset, limit, page } = ctx.query

    const sortVal = parseInt(sort as string, 10)
    if (sortVal && !ALL_MAP_SORT_TYPES.includes(sortVal)) {
      throw new httpErrors.BadRequest('Invalid sort order option: ' + sort)
    }

    const numPlayersVal = numPlayers && JSON.parse(numPlayers as string)
    if (
      numPlayersVal &&
      (!Array.isArray(numPlayersVal) || numPlayersVal.some(n => n < 2 || n > 8))
    ) {
      throw new httpErrors.BadRequest('Invalid filter for number of players: ' + numPlayers)
    }

    const tilesetVal = tileset && JSON.parse(tileset as string)
    if (tilesetVal && (!Array.isArray(tilesetVal) || tilesetVal.some(n => n < 0 || n > 7))) {
      throw new httpErrors.BadRequest('Invalid filter for tileset: ' + tileset)
    }

    let limitVal = parseInt(limit as string, 10)
    if (!limitVal || isNaN(limitVal) || limitVal < 0 || limitVal > 100) {
      limitVal = 60
    }

    let pageVal = parseInt(page as string, 10)
    if (!pageVal || isNaN(pageVal) || pageVal < 0) {
      pageVal = 0
    }

    if (!ALL_MAP_VISIBILITIES.includes(visibility as MapVisibility)) {
      throw new httpErrors.BadRequest('Invalid map visibility: ' + visibility)
    }

    const uploadedBy = visibility === MapVisibility.Private ? ctx.session!.userId : undefined

    const filters = { numPlayers: numPlayersVal, tileset: tilesetVal }
    const favoritedBy = ctx.session!.userId
    const [mapsResult, favoritedMaps] = await Promise.all([
      getMaps(
        visibility as MapVisibility,
        sortVal,
        filters,
        limitVal,
        pageVal,
        favoritedBy,
        uploadedBy,
        q as string,
      ),
      getFavoritedMaps(favoritedBy, sortVal, filters, q as string),
    ])
    const { total, maps } = mapsResult
    return {
      maps,
      favoritedMaps,
      page,
      limit,
      total,
    }
  }

  @httpGet('/batch-info')
  @httpBefore(throttleMiddleware(mapsListThrottle, ctx => String(ctx.session!.userId)))
  async getInfo(ctx: RouterContext): Promise<GetBatchMapInfoResponse> {
    const { query } = validateRequest(ctx, {
      query: Joi.object<{ m: string[] }>({
        m: Joi.array().items(Joi.string()).single().min(1).max(40),
      }),
    })

    const mapIds = query.m

    let maps = await getMapInfo(mapIds, ctx.session!.userId)
    maps = await reparseMapsAsNeeded(maps, ctx.session!.userId)

    return {
      maps: maps.map(m => toMapInfoJson(m)),
    }
  }

  @httpPost('/official')
  @httpBefore(checkAllPermissions('manageMaps'), handleMultipartFiles())
  async upload2(ctx: RouterContext): Promise<any> {
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

    const map = await storeMap(
      filepath,
      lowerCaseExtension,
      ctx.session!.userId,
      MapVisibility.Official,
    )
    return {
      map,
    }
  }

  @httpPost('/')
  @httpBefore(
    throttleMiddleware(mapUploadThrottle, ctx => String(ctx.session!.userId)),
    handleMultipartFiles(),
  )
  async upload(ctx: RouterContext): Promise<any> {
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

    const map = await storeMap(
      filepath,
      lowerCaseExtension,
      ctx.session!.userId,
      MapVisibility.Private,
    )
    return {
      map,
    }
  }

  @httpGet('/:mapId')
  @httpBefore(throttleMiddleware(mapsListThrottle, ctx => String(ctx.session!.userId)))
  async getDetails(ctx: RouterContext): Promise<any> {
    const { mapId } = ctx.params

    const mapResult = await getMapInfo([mapId], ctx.session!.userId)
    if (!mapResult.length) {
      throw new httpErrors.NotFound('Map not found')
    }

    const [map] = await reparseMapsAsNeeded(mapResult, ctx.session!.userId)

    return {
      map: toMapInfoJson(map),
    }
  }

  @httpPatch('/:mapId')
  @httpBefore(throttleMiddleware(mapUpdateThrottle, ctx => String(ctx.session!.userId)))
  async update(ctx: RouterContext): Promise<any> {
    const { mapId } = ctx.params
    const { name, description } = ctx.request.body

    if (!name) {
      throw new httpErrors.BadRequest("Map name can't be empty")
    }

    let map = (await getMapInfo([mapId], ctx.session!.userId))[0]
    if (!map) {
      throw new httpErrors.NotFound('Map not found')
    }

    ;[map] = await reparseMapsAsNeeded([map], ctx.session!.userId)

    // TODO(tec27): These checks are bad and should be changed before we allow anyone to make maps
    // public
    if (
      [MapVisibility.Official, MapVisibility.Public].includes(map.visibility) &&
      !ctx.session!.permissions.manageMaps
    ) {
      throw new httpErrors.Forbidden('Not enough permissions')
    }
    if (map.visibility === MapVisibility.Private && map.uploadedBy.id !== ctx.session!.userId) {
      throw new httpErrors.Forbidden("Can't update maps of other users")
    }

    map = await updateMap(mapId, ctx.session!.userId, name, description)
    return {
      map,
    }
  }

  @httpDelete('/:mapId')
  @httpBefore(throttleMiddleware(mapRemoveThrottle, ctx => String(ctx.session!.userId)))
  async remove(ctx: RouterContext): Promise<void> {
    const { mapId } = ctx.params

    const map = (await getMapInfo([mapId]))[0]
    if (!map) {
      throw new httpErrors.NotFound('Map not found')
    }
    // TODO(tec27): These checks are bad and should be changed before we allow anyone to make maps
    // public
    if (
      (map.visibility === MapVisibility.Official || map.visibility === MapVisibility.Public) &&
      !ctx.session!.permissions.manageMaps
    ) {
      throw new httpErrors.Forbidden('Not enough permissions')
    }
    if (map.visibility === MapVisibility.Private && map.uploadedBy.id !== ctx.session!.userId) {
      throw new httpErrors.Forbidden("Can't remove maps of other users")
    }

    await removeMap(mapId)
    ctx.status = 204
  }

  @httpPost('/:mapId/favorite')
  @httpBefore(throttleMiddleware(mapFavoriteThrottle, ctx => String(ctx.session!.userId)))
  async addToFavorites(ctx: RouterContext): Promise<void> {
    await addMapToFavorites(ctx.params.mapId, ctx.session!.userId)
    ctx.status = 204
  }

  @httpDelete('/:mapId/favorite')
  @httpBefore(throttleMiddleware(mapFavoriteThrottle, ctx => String(ctx.session!.userId)))
  async removeFromFavorites(ctx: RouterContext): Promise<void> {
    await removeMapFromFavorites(ctx.params.mapId, ctx.session!.userId)
    ctx.status = 204
  }

  @httpPost('/:mapId/regenerate')
  @httpBefore(checkAllPermissions('manageMaps'))
  async regenMapImage(ctx: RouterContext): Promise<void> {
    const { mapId } = ctx.params

    const map = (await getMapInfo([mapId]))[0]
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
  @httpBefore(checkAllPermissions('massDeleteMaps'))
  async deleteAllMaps(ctx: RouterContext): Promise<void> {
    await veryDangerousDeleteAllMaps(async () => {
      await Promise.all([deleteFiles('maps/'), deleteFiles('map_images/')])
    })
    ctx.status = 204
  }
}
