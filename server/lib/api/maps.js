import httpErrors from 'http-errors'
import { storeMap } from '../maps/store'
import { getOfficialMaps, getPrivateMaps, getPublicMaps } from '../models/maps'
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

const mapsUploadThrottle = createThrottle('mapsupload', {
  rate: 10,
  burst: 20,
  window: 60000,
})

export default function(router) {
  router
    .get('/', throttleMiddleware(mapsListThrottle, ctx => ctx.session.userId), ensureLoggedIn, list)
    .post(
      '/',
      throttleMiddleware(mapsUploadThrottle, ctx => ctx.session.userId),
      featureEnabled(MAP_UPLOADING),
      ensureLoggedIn,
      handleMultipartFiles,
      upload,
    )
    .post('/official', checkAllPermissions('manageMaps'), handleMultipartFiles, upload)
}

const SUPPORTED_EXTENSIONS = ['scx', 'scm']

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

  if (q && !ctx.session.permissions.manageMaps) {
    throw new httpErrors.Forbidden('Not enough permissions')
  }

  let result
  switch (visibility) {
    case MAP_VISIBILITY_OFFICIAL:
      result = await getOfficialMaps(limit, page, q)
      break
    case MAP_VISIBILITY_PRIVATE:
      result = await getPrivateMaps(ctx.session.userId, limit, page, q)
      break
    case MAP_VISIBILITY_PUBLIC:
      result = await getPublicMaps(limit, page, q)
      break
    default:
      throw new httpErrors.BadRequest('Invalid map visibility: ' + visibility)
  }

  const { total, maps } = result
  ctx.body = {
    maps,
    page,
    limit,
    total,
  }
}
