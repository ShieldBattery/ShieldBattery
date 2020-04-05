import httpErrors from 'http-errors'
import { storeMap } from '../maps/store'
import {
  getMaps,
  getMapInfo,
  getFavoritedMaps,
  updateMap,
  removeMap,
  addMapToFavorites,
  removeMapFromFavorites,
} from '../models/maps'
import { checkAllPermissions } from '../permissions/check-permissions'
import { MAP_UPLOADING } from '../../../app/common/flags'
import {
  MAP_VISIBILITY_OFFICIAL,
  MAP_VISIBILITY_PRIVATE,
  MAP_VISIBILITY_PUBLIC,
} from '../../../app/common/constants'
import { SORT_BY_NAME, SORT_BY_NUM_OF_PLAYERS, SORT_BY_DATE } from '../../../app/common/maps'
import { featureEnabled } from '../flags/feature-enabled'
import handleMultipartFiles from '../file-upload/handle-multipart-files'
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

export default function(router) {
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
      featureEnabled(MAP_UPLOADING),
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

const SUPPORTED_EXTENSIONS = ['scx', 'scm']
const VISIBILITIES = [MAP_VISIBILITY_OFFICIAL, MAP_VISIBILITY_PRIVATE, MAP_VISIBILITY_PUBLIC]
const SORT_ORDERS = [SORT_BY_NAME, SORT_BY_NUM_OF_PLAYERS, SORT_BY_DATE]

async function list(ctx, next) {
  const { q, visibility } = ctx.query
  let { sort, numPlayers, tileset, limit, page } = ctx.query

  sort = parseInt(sort, 10)
  if (!SORT_ORDERS.includes(sort)) {
    throw new httpErrors.BadRequest('Invalid sort order option: ' + sort)
  }

  numPlayers = JSON.parse(numPlayers)
  if (!Array.isArray(numPlayers) || numPlayers.some(n => n < 2 || n > 8)) {
    throw new httpErrors.BadRequest('Invalid filter for number of players: ' + numPlayers)
  }

  tileset = JSON.parse(tileset)
  if (!Array.isArray(tileset) || tileset.some(n => n < 0 || n > 7)) {
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

  if (!VISIBILITIES.includes(visibility)) {
    throw new httpErrors.BadRequest('Invalid map visibility: ' + visibility)
  }

  let uploadedBy = null
  if (visibility === MAP_VISIBILITY_PRIVATE) {
    uploadedBy = ctx.session.userId
  }

  const filters = { numPlayers, tileset }
  const favoritedBy = ctx.session.userId
  const [mapsResult, favoritedMaps] = await Promise.all([
    getMaps(visibility, sort, filters, limit, page, favoritedBy, uploadedBy, q),
    visibility === MAP_VISIBILITY_PRIVATE
      ? getFavoritedMaps(favoritedBy, sort, filters, q)
      : Promise.resolve([]),
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
  if (!SUPPORTED_EXTENSIONS.includes(lowerCaseExtension)) {
    throw new httpErrors.BadRequest('Unsupported extension: ' + lowerCaseExtension)
  }

  const visibility = ctx.request.path.endsWith('/official')
    ? MAP_VISIBILITY_OFFICIAL
    : MAP_VISIBILITY_PRIVATE
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

  if (
    [MAP_VISIBILITY_OFFICIAL, MAP_VISIBILITY_PUBLIC].includes(map.visibility) &&
    !ctx.session.permissions.manageMaps
  ) {
    throw new httpErrors.Forbidden('Not enough permissions')
  }
  if (map.visibility === MAP_VISIBILITY_PRIVATE && map.uploadedBy.id !== ctx.session.userId) {
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
  if (
    (map.visibility === MAP_VISIBILITY_OFFICIAL || map.visibility === MAP_VISIBILITY_PUBLIC) &&
    !ctx.session.permissions.manageMaps
  ) {
    throw new httpErrors.Forbidden('Not enough permissions')
  }
  if (map.visibility === MAP_VISIBILITY_PRIVATE && map.uploadedBy.id !== ctx.session.userId) {
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
