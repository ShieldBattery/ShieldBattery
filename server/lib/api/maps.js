import httpErrors from 'http-errors'
import { storeMap } from '../maps/store'
import { listMaps } from '../models/maps'
import { checkAllPermissions } from '../permissions/check-permissions'
import { MAP_UPLOADING } from '../../../app/common/flags'
import handleMultipartFiles from '../file-upload/handle-multipart-files'
import ensureLoggedIn from '../session/ensure-logged-in'

export default function(router) {
  router
    .get('/', ensureLoggedIn, list)
    .post('/', ensureLoggedIn, uploadPermissionCheck(), handleMultipartFiles, upload)
}

const SUPPORTED_EXTENSIONS = ['scx', 'scm']

function uploadPermissionCheck() {
  if (!MAP_UPLOADING) {
    return checkAllPermissions('manageMaps')
  } else {
    return async (ctx, next) => {
      await next()
    }
  }
}

async function upload(ctx, next) {
  const { filename, modifiedDate, extension } = ctx.request.body
  const { path } = ctx.request.files.map

  if (!path) {
    throw new httpErrors.BadRequest('map file must be specified')
  } else if (!extension) {
    throw new httpErrors.BadRequest('extension must be specified')
  }

  const lowerCaseExtension = extension.toLowerCase()
  if (!SUPPORTED_EXTENSIONS.includes(lowerCaseExtension)) {
    throw new httpErrors.BadRequest('Unsupported extension: ' + lowerCaseExtension)
  }

  const map = await storeMap(lowerCaseExtension, filename, modifiedDate, path)
  ctx.body = {
    map,
  }
}

async function list(ctx, next) {
  const { query } = ctx.query
  let { limit, page } = ctx.query

  limit = parseInt(limit, 10)
  if (!limit || isNaN(limit) || limit < 0 || limit > 100) {
    limit = 60
  }

  page = parseInt(page, 10)
  if (!page || isNaN(page) || page < 0) {
    page = 0
  }

  if (query && !ctx.session.permissions.manageMapPools) {
    throw new httpErrors.Forbidden('Not enough permissions')
  }

  const maps = await listMaps(limit, page, query)
  ctx.body = {
    maps,
    page: 0,
    limit: maps.length,
    total: maps.length,
  }
}
