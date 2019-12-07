import httpErrors from 'http-errors'
import { storeMap } from '../maps/store'
import {
  getMaps,
  getMapInfo,
  updateMap,
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

export default function(router) {
  router
    .get('/', throttleMiddleware(mapsListThrottle, ctx => ctx.session.userId), ensureLoggedIn, list)
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

// TODO(2Pac): Allow updating the map file itself
async function update(ctx, next) {
  const { mapId } = ctx.params
  const { name, description, visibility } = ctx.request.body

  let map = (await getMapInfo([mapId], ctx.session.userId))[0]
  if (!map) {
    throw new httpErrors.NotFound('Map not found')
  }

  if (!name && !description && !visibility) {
    ctx.body = {
      map,
    }

    return
  }
  if (visibility && !VISIBILITIES.includes(visibility)) {
    throw new httpErrors.BadRequest('Invalid map visibility: ' + visibility)
  }

  if (visibility === MAP_VISIBILITY_OFFICIAL) {
    throw new httpErrors.Forbidden("Can't change visibility to 'OFFICIAL'")
  }
  if (map.visibility === MAP_VISIBILITY_OFFICIAL) {
    if (!ctx.session.permissions.manageMaps) {
      throw new httpErrors.Forbidden('Not enough permissions')
    }
    if (visibility && visibility !== map.visibility) {
      throw new httpErrors.Forbidden("Can't change visibility of 'OFFICIAL' maps")
    }
  }
  // Admins can update maps of other users (in case the name contains a dirty word, like 'protoss')
  if (map.uploadedBy.id !== ctx.session.userId && !ctx.session.permissions.manageMaps) {
    throw new httpErrors.Forbidden("Can't update maps of other users")
  }

  map = await updateMap(mapId, ctx.session.userId, name, description, visibility)
  ctx.body = {
    map,
  }
}

async function list(ctx, next) {
  const { q, visibility } = ctx.query
  let { limit, page } = ctx.query

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

  if (q && !ctx.session.permissions.manageMaps) {
    throw new httpErrors.Forbidden('Not enough permissions')
  }

  const favoritedBy = ctx.session.userId
  const visibilityArray = [visibility]
  let uploadedBy = null
  if (visibility === MAP_VISIBILITY_PRIVATE) {
    visibilityArray.push(MAP_VISIBILITY_PUBLIC)
    uploadedBy = ctx.session.userId
  }

  const result = await getMaps(visibilityArray, limit, page, favoritedBy, uploadedBy, q)
  const { total, maps } = result
  ctx.body = {
    maps,
    page,
    limit,
    total,
  }
}

async function addToFavorites(ctx, next) {
  await addMapToFavorites(ctx.params.mapId, ctx.session.userId)
  ctx.status = 204
}

async function removeFromFavorites(ctx, next) {
  await removeMapFromFavorites(ctx.params.mapId, ctx.session.userId)
  ctx.status = 204
}
