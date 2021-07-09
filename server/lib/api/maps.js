import { writeFile as fsWriteFile } from 'fs/promises'
import httpErrors from 'http-errors'
import { withFile as withTmpFile } from 'tmp-promise'
import {
  ALL_MAP_EXTENSIONS,
  ALL_MAP_SORT_TYPES,
  ALL_MAP_VISIBILITIES,
  MapVisibility,
} from '../../../common/maps'
import { deleteFiles, readFile } from '../file-upload'
import handleMultipartFiles from '../file-upload/handle-multipart-files'
import {
  addMapToFavorites,
  getFavoritedMaps,
  getMapInfo,
  getMaps,
  removeMap,
  removeMapFromFavorites,
  updateMap,
  veryDangerousDeleteAllMaps,
} from '../maps/map-models'
import { mapPath, storeMap, storeRegeneratedImages } from '../maps/store'
import { checkAllPermissions } from '../permissions/check-permissions'
import ensureLoggedIn from '../session/ensure-logged-in'
import createThrottle from '../throttle/create-throttle'
import throttleMiddleware from '../throttle/middleware'

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

export default function (router) {
  router
    .get(
      '/',
      throttleMiddleware(mapsListThrottle, ctx => ctx.session.userId),
      ensureLoggedIn,
      list,
    )
    .get(
      '/:mapId',
      throttleMiddleware(mapsListThrottle, ctx => ctx.session.userId),
      ensureLoggedIn,
      getDetails,
    )
    .post(
      '/',
      throttleMiddleware(mapUploadThrottle, ctx => ctx.session.userId),
      ensureLoggedIn,
      handleMultipartFiles,
      upload,
    )
    .patch(
      '/:mapId',
      throttleMiddleware(mapUpdateThrottle, ctx => ctx.session.userId),
      ensureLoggedIn,
      update,
    )
    .delete(
      '/:mapId',
      throttleMiddleware(mapRemoveThrottle, ctx => ctx.session.userId),
      ensureLoggedIn,
      remove,
    )
    .post('/official', checkAllPermissions('manageMaps'), handleMultipartFiles, upload)
    .post('/:mapId/regenerate', checkAllPermissions('manageMaps'), regenMapImage)
    .delete('/', checkAllPermissions('massDeleteMaps'), deleteAllMaps)
    .post(
      '/favorites/:mapId',
      throttleMiddleware(mapFavoriteThrottle, ctx => ctx.session.userId),
      ensureLoggedIn,
      addToFavorites,
    )
    .delete(
      '/favorites/:mapId',
      throttleMiddleware(mapFavoriteThrottle, ctx => ctx.session.userId),
      ensureLoggedIn,
      removeFromFavorites,
    )
}

async function list(ctx, next) {
  const { q, visibility } = ctx.query
  let { sort, numPlayers, tileset, limit, page } = ctx.query

  sort = parseInt(sort, 10)
  if (sort && !ALL_MAP_SORT_TYPES.includes(sort)) {
    throw new httpErrors.BadRequest('Invalid sort order option: ' + sort)
  }

  numPlayers = numPlayers && JSON.parse(numPlayers)
  if (numPlayers && (!Array.isArray(numPlayers) || numPlayers.some(n => n < 2 || n > 8))) {
    throw new httpErrors.BadRequest('Invalid filter for number of players: ' + numPlayers)
  }

  tileset = tileset && JSON.parse(tileset)
  if (tileset && (!Array.isArray(tileset) || tileset.some(n => n < 0 || n > 7))) {
    throw new httpErrors.BadRequest('Invalid filter for tileset: ' + tileset)
  }

  limit = parseInt(limit, 10)
  if (!limit || isNaN(limit) || limit < 0 || limit > 100) {
    limit = 60
  }

  page = parseInt(page, 10)
  if (!page || isNaN(page) || page < 0) {
    page = 0
  }

  if (!ALL_MAP_VISIBILITIES.includes(visibility)) {
    throw new httpErrors.BadRequest('Invalid map visibility: ' + visibility)
  }

  let uploadedBy = null
  if (visibility === MapVisibility.Private) {
    uploadedBy = ctx.session.userId
  }

  const filters = { numPlayers, tileset }
  const favoritedBy = ctx.session.userId
  const [mapsResult, favoritedMaps] = await Promise.all([
    getMaps(visibility, sort, filters, limit, page, favoritedBy, uploadedBy, q),
    getFavoritedMaps(favoritedBy, sort, filters, q),
  ])
  const { total, maps } = mapsResult
  ctx.body = {
    maps,
    favoritedMaps,
    page,
    limit,
    total,
  }
}

async function getDetails(ctx, next) {
  const { mapId } = ctx.params

  const map = (await getMapInfo([mapId], ctx.session.userId))[0]
  if (!map) {
    throw new httpErrors.NotFound('Map not found')
  }

  ctx.body = {
    map,
  }
}

async function upload(ctx, next) {
  const { path } = ctx.request.files.file
  const { extension } = ctx.request.body

  if (!path) {
    throw new httpErrors.BadRequest('map file must be specified')
  } else if (!extension) {
    throw new httpErrors.BadRequest('extension must be specified')
  }

  const lowerCaseExtension = extension.toLowerCase()
  if (!ALL_MAP_EXTENSIONS.includes(lowerCaseExtension)) {
    throw new httpErrors.BadRequest('Unsupported extension: ' + lowerCaseExtension)
  }

  const visibility = ctx.request.path.endsWith('/official')
    ? MapVisibility.Official
    : MapVisibility.Private
  const map = await storeMap(path, lowerCaseExtension, ctx.session.userId, visibility)
  ctx.body = {
    map,
  }
}

async function update(ctx, next) {
  const { mapId } = ctx.params
  const { name, description } = ctx.request.body

  if (!name) {
    throw new httpErrors.BadRequest("Map name can't be empty")
  } else if (!description) {
    throw new httpErrors.BadRequest("Map description can't be empty")
  }

  let map = (await getMapInfo([mapId], ctx.session.userId))[0]
  if (!map) {
    throw new httpErrors.NotFound('Map not found')
  }

  // TODO(tec27): These checks are bad and should be changed before we allow anyone to make maps
  // public
  if (
    [MapVisibility.Official, MapVisibility.Public].includes(map.visibility) &&
    !ctx.session.permissions.manageMaps
  ) {
    throw new httpErrors.Forbidden('Not enough permissions')
  }
  if (map.visibility === MapVisibility.Private && map.uploadedBy.id !== ctx.session.userId) {
    throw new httpErrors.Forbidden("Can't update maps of other users")
  }

  map = await updateMap(mapId, ctx.session.userId, name, description)
  ctx.body = {
    map,
  }
}

async function remove(ctx, next) {
  const { mapId } = ctx.params

  const map = (await getMapInfo([mapId]))[0]
  if (!map) {
    throw new httpErrors.NotFound('Map not found')
  }
  // TODO(tec27): These checks are bad and should be changed before we allow anyone to make maps
  // public
  if (
    (map.visibility === MapVisibility.Official || map.visibility === MapVisibility.Public) &&
    !ctx.session.permissions.manageMaps
  ) {
    throw new httpErrors.Forbidden('Not enough permissions')
  }
  if (map.visibility === MapVisibility.Private && map.uploadedBy.id !== ctx.session.userId) {
    throw new httpErrors.Forbidden("Can't remove maps of other users")
  }

  await removeMap(mapId)
  ctx.status = 204
}

async function addToFavorites(ctx, next) {
  await addMapToFavorites(ctx.params.mapId, ctx.session.userId)
  ctx.status = 204
}

async function removeFromFavorites(ctx, next) {
  await removeMapFromFavorites(ctx.params.mapId, ctx.session.userId)
  ctx.status = 204
}

async function deleteAllMaps(ctx, next) {
  await veryDangerousDeleteAllMaps(() =>
    Promise.all([deleteFiles('maps/'), deleteFiles('map_images/')]),
  )
  ctx.status = 204
}

async function regenMapImage(ctx, next) {
  const { mapId } = ctx.params

  const map = (await getMapInfo([mapId]))[0]
  if (!map) {
    throw new httpErrors.NotFound('Map not found')
  }

  const mapBufferPromise = readFile(mapPath(map.hash, map.mapData.format))
  await withTmpFile(async ({ path }) => {
    await fsWriteFile(path, await mapBufferPromise)
    await storeRegeneratedImages(path, map.mapData.format)
  })

  ctx.status = 204
}
