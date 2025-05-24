import { RouterContext } from '@koa/router'
import httpErrors from 'http-errors'
import Joi from 'joi'
import {
  ALL_MAP_EXTENSIONS,
  ALL_MAP_SORT_TYPES,
  ALL_MAP_VISIBILITIES,
  GetBatchMapInfoResponse,
  GetMapDetailsResponse,
  GetMapsResponse,
  MapVisibility,
  toMapInfoJson,
  UpdateMapResponse,
  UploadMapResponse,
} from '../../../common/maps'
import { deleteFiles } from '../files'
import { handleMultipartFiles } from '../files/handle-multipart-files'
import { httpApi } from '../http/http-api'
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
import { findUserById, findUsersById } from '../users/user-model'
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
export class MapsApi {
  @httpGet('/')
  @httpBefore(throttleMiddleware(mapsListThrottle, ctx => String(ctx.session?.user?.id ?? ctx.ip)))
  async list(ctx: RouterContext): Promise<GetMapsResponse> {
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

    let limitVal = Number(limit)
    if (!limitVal || isNaN(limitVal) || limitVal < 0 || limitVal > 100) {
      limitVal = 60
    }

    let pageVal = Number(page)
    if (!pageVal || isNaN(pageVal) || pageVal < 0) {
      pageVal = 0
    }

    if (!ALL_MAP_VISIBILITIES.includes(visibility as MapVisibility)) {
      throw new httpErrors.BadRequest('Invalid map visibility: ' + visibility)
    }

    if (!ctx.session?.user && visibility === MapVisibility.Private) {
      throw new httpErrors.BadRequest('Private maps are only available to logged in users')
    }

    const uploadedBy = visibility === MapVisibility.Private ? ctx.session!.user!.id : undefined

    const filters = { numPlayers: numPlayersVal, tileset: tilesetVal }
    const favoritedBy = ctx.session?.user.id
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
      favoritedBy
        ? getFavoritedMaps(favoritedBy, sortVal, filters, q as string)
        : Promise.resolve([]),
    ])
    const { total, maps } = mapsResult

    const userIds = new Set(Array.from(maps, m => m.uploadedBy))
    for (const map of favoritedMaps) {
      userIds.add(map.uploadedBy)
    }
    const users = await findUsersById(Array.from(userIds))

    return {
      maps: maps.map(m => toMapInfoJson(m)),
      favoritedMaps: favoritedMaps.map(m => toMapInfoJson(m)),
      page: pageVal,
      limit: limitVal,
      total,
      users,
    }
  }

  @httpGet('/batch-info')
  @httpBefore(throttleMiddleware(mapsListThrottle, ctx => String(ctx.session?.user?.id ?? ctx.ip)))
  async getInfo(ctx: RouterContext): Promise<GetBatchMapInfoResponse> {
    const { query } = validateRequest(ctx, {
      query: Joi.object<{ m: string[] }>({
        m: Joi.array().items(Joi.string()).single().min(1).max(40),
      }),
    })

    const mapIds = query.m

    const mapsResult = await getMapInfo(mapIds, ctx.session?.user.id)
    const userIds = new Set(Array.from(mapsResult, m => m.uploadedBy))
    const [maps, users] = await Promise.all([
      reparseMapsAsNeeded(mapsResult, ctx.session?.user.id),
      findUsersById(Array.from(userIds)),
    ])

    return {
      maps: maps.map(m => toMapInfoJson(m)),
      users,
    }
  }

  @httpPost('/official')
  @httpBefore(ensureLoggedIn, checkAllPermissions('manageMaps'), handleMultipartFiles())
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
      storeMap(filepath, lowerCaseExtension, ctx.session!.user!.id, MapVisibility.Official),
      findUserById(ctx.session!.user!.id),
    ])
    return {
      map: toMapInfoJson(map),
      users: user ? [user] : [],
    }
  }

  @httpPost('/')
  @httpBefore(
    ensureLoggedIn,
    throttleMiddleware(mapUploadThrottle, ctx => String(ctx.session!.user!.id)),
    handleMultipartFiles(),
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
      storeMap(filepath, lowerCaseExtension, ctx.session!.user!.id, MapVisibility.Private),
      findUserById(ctx.session!.user!.id),
    ])
    return {
      map: toMapInfoJson(map),
      users: user ? [user] : [],
    }
  }

  @httpGet('/:mapId')
  @httpBefore(throttleMiddleware(mapsListThrottle, ctx => String(ctx.session?.user?.id ?? ctx.ip)))
  async getDetails(ctx: RouterContext): Promise<GetMapDetailsResponse> {
    const { mapId } = ctx.params

    const mapResult = await getMapInfo([mapId], ctx.session?.user.id)
    if (!mapResult.length) {
      throw new httpErrors.NotFound('Map not found')
    }

    const [[map], user] = await Promise.all([
      reparseMapsAsNeeded(mapResult, ctx.session?.user.id),
      findUserById(mapResult[0].uploadedBy),
    ])

    return {
      map: toMapInfoJson(map),
      users: user ? [user] : [],
    }
  }

  @httpPatch('/:mapId')
  @httpBefore(
    ensureLoggedIn,
    throttleMiddleware(mapUpdateThrottle, ctx => String(ctx.session!.user!.id)),
  )
  async update(ctx: RouterContext): Promise<UpdateMapResponse> {
    const { mapId } = ctx.params
    const { name, description } = ctx.request.body

    if (!name) {
      throw new httpErrors.BadRequest("Map name can't be empty")
    }

    let map = (await getMapInfo([mapId], ctx.session!.user!.id))[0]
    if (!map) {
      throw new httpErrors.NotFound('Map not found')
    }

    ;[map] = await reparseMapsAsNeeded([map], ctx.session!.user!.id)

    // TODO(tec27): These checks are bad and should be changed before we allow anyone to make maps
    // public
    if (
      [MapVisibility.Official, MapVisibility.Public].includes(map.visibility) &&
      !ctx.session!.permissions!.manageMaps
    ) {
      throw new httpErrors.Forbidden('Not enough permissions')
    }
    if (map.visibility === MapVisibility.Private && map.uploadedBy !== ctx.session!.user!.id) {
      throw new httpErrors.Forbidden("Can't update maps of other users")
    }

    map = await updateMap(mapId, ctx.session!.user!.id, name, description)
    const user = await findUserById(map.uploadedBy)
    return {
      map: toMapInfoJson(map),
      users: user ? [user] : [],
    }
  }

  @httpDelete('/:mapId')
  @httpBefore(
    ensureLoggedIn,
    throttleMiddleware(mapRemoveThrottle, ctx => String(ctx.session!.user!.id)),
  )
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
      !ctx.session!.permissions!.manageMaps
    ) {
      throw new httpErrors.Forbidden('Not enough permissions')
    }
    if (map.visibility === MapVisibility.Private && map.uploadedBy !== ctx.session!.user!.id) {
      throw new httpErrors.Forbidden("Can't remove maps of other users")
    }

    await removeMap(mapId)
    ctx.status = 204
  }

  @httpPost('/:mapId/favorite')
  @httpBefore(
    ensureLoggedIn,
    throttleMiddleware(mapFavoriteThrottle, ctx => String(ctx.session!.user!.id)),
  )
  async addToFavorites(ctx: RouterContext): Promise<void> {
    await addMapToFavorites(ctx.params.mapId, ctx.session!.user!.id)
    ctx.status = 204
  }

  @httpDelete('/:mapId/favorite')
  @httpBefore(
    ensureLoggedIn,
    throttleMiddleware(mapFavoriteThrottle, ctx => String(ctx.session!.user!.id)),
  )
  async removeFromFavorites(ctx: RouterContext): Promise<void> {
    await removeMapFromFavorites(ctx.params.mapId, ctx.session!.user!.id)
    ctx.status = 204
  }

  @httpPost('/:mapId/regenerate')
  @httpBefore(ensureLoggedIn, checkAllPermissions('manageMaps'))
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
  @httpBefore(ensureLoggedIn, checkAllPermissions('massDeleteMaps'))
  async deleteAllMaps(ctx: RouterContext): Promise<void> {
    await veryDangerousDeleteAllMaps(async () => {
      await Promise.all([deleteFiles('maps/'), deleteFiles('map_images/')])
    })
    ctx.status = 204
  }
}
